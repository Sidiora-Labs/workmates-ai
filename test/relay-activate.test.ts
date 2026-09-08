import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";

import { startHarness, type Harness } from "./helpers/server.ts";

const KEY = `wm_live_${"a1b2c3d4".repeat(4)}`;

function stubRelay() {
  const seen: Array<{ method: string; path: string; auth: string | null }> = [];
  let reply: { status: number; body: unknown } = {
    status: 201,
    body: { spaceId: "space-cloud", agentToken: "agent-token", clientToken: "client-token" },
  };

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? "").split("?")[0];
    seen.push({ method: req.method ?? "", path, auth: req.headers.authorization ?? null });
    if (path === "/space/agent/stream") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ kind: "hello", spaceId: "space-cloud" })}\n\n`);
      return;
    }
    req.resume();
    req.on("end", () => {
      if (path === "/spaces") {
        res.writeHead(reply.status, { "content-type": "application/json" });
        return res.end(JSON.stringify(reply.body));
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });

  return {
    server,
    answerSpacesWith(status: number, body: unknown) {
      reply = { status, body };
    },
    get spaceCalls() {
      return seen.filter((s) => s.path === "/spaces");
    },
  };
}

let h: Harness;
let relay: ReturnType<typeof stubRelay>;
let relayUrl = "";

before(async () => {
  relay = stubRelay();
  await new Promise<void>((r) => relay.server.listen(0, "127.0.0.1", () => r()));
  relayUrl = `http://127.0.0.1:${(relay.server.address() as { port: number }).port}`;
  h = await startHarness({ WORKMATES_RELAY_URL: relayUrl });
  await h.fetch("/api/pair", { method: "PUT", body: JSON.stringify({ enabled: true }) });
});

after(async () => {
  relay?.server.close();
  await h?.stop();
});

async function waitFor<T>(check: () => Promise<T | null>, timeoutMs = 10_000): Promise<T | null> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const found = await check();
    if (found) return found;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

const activate = (key: unknown) =>
  h.fetch("/api/relay/activate", { method: "POST", body: JSON.stringify({ key }) });

describe("activating Cloud", () => {
  test("a key that is not a key is refused before the relay is dialled", async () => {
    const dialled = relay.spaceCalls.length;
    const wrong = [
      "",
      "   ",
      "wm_live_",
      `wm_test_${"a1b2c3d4".repeat(4)}`,
      `wm_live_${"A1B2C3D4".repeat(4)}`,
      `wm_live_${"a".repeat(31)}`,
      `wm_live_${"a".repeat(33)}`,
      `wm_live_${"z".repeat(32)}`,
      `${KEY} `.repeat(2).trim(),
      `x${KEY}`,
      42,
      null,
      { key: KEY },
    ];
    for (const key of wrong) {
      const res = await activate(key);
      assert.equal(res.status, 400, `${JSON.stringify(key)} should be refused`);
    }
    assert.equal((await h.fetch("/api/relay/activate", { method: "POST", body: "{}" })).status, 400);

    assert.equal(
      relay.spaceCalls.length,
      dialled,
      "a key that could not possibly work was still sent to the relay",
    );
  });

  test("a card that failed is quoted back in billing's own words", async () => {
    const declined = "Your card was declined on 3 August. Update it at workmate.centra.ag/account.";
    relay.answerSpacesWith(402, { error: declined });

    const res = await activate(KEY);
    assert.equal(res.status, 402);
    assert.equal((await res.json()).error, declined, "the person was told nothing they can act on");

    const call = relay.spaceCalls.at(-1)!;
    assert.equal(call.method, "POST");
    assert.equal(call.path, "/spaces");
    assert.equal(call.auth, `Bearer ${KEY}`);

    const status = await h.json("/api/relay/status");
    assert.equal(status.enabled, false);
    assert.equal(status.connected, false);
  });

  test("a relay that quotes the request back does not get to leak the key", async () => {
    relay.answerSpacesWith(500, { error: `no space minted for ${KEY}` });
    const res = await activate(KEY);
    assert.equal(res.status, 502);
    const { error } = await res.json();
    assert.ok(!error.includes(KEY), "the key came back in an error message");
    assert.match(error, /\[redacted\]/);
  });

  test("a minted space is saved, and the line comes up", async () => {
    relay.answerSpacesWith(201, {
      spaceId: "space-cloud",
      agentToken: "agent-token",
      clientToken: "client-token",
    });

    const res = await activate(`  ${KEY}  `);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.enabled, true);
    assert.equal(body.spaceId, "space-cloud");
    assert.equal(body.url, relayUrl);

    const file = readFileSync(join(h.home, ".workmates", "config.json"), "utf8");
    assert.deepEqual(JSON.parse(file).relay, {
      url: relayUrl,
      agentToken: "agent-token",
      clientToken: "client-token",
      enabled: true,
    });
    assert.ok(!file.includes("wm_live_"), "the licence key was written to the config file");

    const up = await waitFor(async () => {
      const state = await h.json("/api/relay/status");
      return state.connected ? state : null;
    });
    assert.ok(up, "the relay link never came up after activation");
    assert.equal(up.spaceId, "space-cloud");
    assert.equal(up.enabled, true);
  });

  test("the key never appears in a log line", async () => {
    const logs = h.logs();
    assert.ok(!logs.includes(KEY), "the licence key was printed");
    assert.ok(!logs.includes("wm_live_"), "something printed the shape of a licence key");
    assert.ok(!logs.includes("a1b2c3d4"), "something printed the body of a licence key");
  });

  test("only this machine may activate Cloud", async () => {
    const res = await h.fetchAs("https://evil.example", "/api/relay/activate", {
      method: "POST",
      body: JSON.stringify({ key: KEY }),
    });
    assert.equal(res.status, 403);
    assert.equal((await h.fetchAs("https://evil.example", "/api/relay/status")).status, 403);
  });
});

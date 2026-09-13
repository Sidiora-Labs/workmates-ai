import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { startHarness } from "./helpers/server.ts";
import { checkCloudServer, startDesktopProxy } from "../electron/desktop-proxy.mjs";

test("browser and desktop share a persistent hosted workspace, sessions, uploads and live events", { timeout: 60_000 }, async () => {
  const data = mkdtempSync(join(tmpdir(), "workmates-hosted-"));
  const token = randomBytes(32).toString("hex");
  const env = { WORKMATES_HOSTED: "1", WORKMATES_SERVER_TOKEN: token, WORKMATES_DATA_DIR: data, WORKMATES_STATIC_DIR: resolve("dist"), WORKMATES_PUBLIC_URL: "" };
  let server = await startHarness(env);
  const proxy = await startDesktopProxy({ staticDir: resolve("dist"), backend: () => ({ url: server.url, token }) });
  try {
    assert.equal(await checkCloudServer(server.url, token), server.url);
    await assert.rejects(checkCloudServer(server.url, "wrong".repeat(10)), /accept/);
    const page = await fetch(`${server.url}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy")!, /frame-src 'self' https:\/\/\*\.on\.ascii\.dev(?:;|$)/);
    assert.equal((await fetch(`${server.url}/assets/missing.js`)).status, 404);
    const manifest = await fetch(`${server.url}/manifest.webmanifest`);
    assert.match(manifest.headers.get("content-type")!, /manifest/);
    for (const icon of (await manifest.json()).icons) assert.equal((await fetch(`${server.url}${icon.src}`)).status, 200);
    assert.equal((await fetch(`${server.url}/api/bots`)).status, 401);
    const login = () => fetch(`${server.url}/api/session`, { method: "POST", headers: { origin: server.url, authorization: `Bearer ${token}` } });
    assert.equal((await fetch(`${server.url}/api/session`, { method: "POST", headers: { origin: "https://elsewhere.example", authorization: `Bearer ${token}` } })).status, 403);
    const signedIn = await login();
    assert.equal(signedIn.status, 200);
    const setCookie = signedIn.headers.get("set-cookie")!;
    assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /SameSite=Strict/);
    assert.ok(!setCookie.includes(token));
    const cookie = setCookie.split(";")[0];
    const browserHeaders = () => ({ cookie, origin: server.url, "content-type": "application/json" });
    assert.equal((await fetch(`${server.url}/api/health`, { headers: browserHeaders() }).then((r) => r.json())).authenticated, true);
    assert.equal((await fetch(`${server.url}/api/bots`, { headers: { cookie, origin: "https://elsewhere.example" } })).status, 401);
    const created = await fetch(`${proxy.origin}/api/bots`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Shared workspace agent" }) });
    assert.equal(created.status, 201);
    const bot = (await created.json()).bot;
    const events = await fetch(`${server.url}/api/events`, { headers: browserHeaders(), signal: AbortSignal.timeout(10_000) });
    const reader = events.body!.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value), /hello/);
    const patch = await fetch(`${proxy.origin}/api/bots/${bot.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Updated from desktop" }) });
    assert.equal(patch.status, 200);
    let frames = "";
    while (!frames.includes("Updated from desktop")) frames += new TextDecoder().decode((await reader.read()).value);
    await reader.cancel();
    const upload = await fetch(`${server.url}/api/attachments/file`, { method: "POST", headers: { ...browserHeaders(), "x-workmates-file-name": encodeURIComponent("phone notes.txt") }, body: "Notes uploaded from mobile" });
    assert.equal(upload.status, 200);
    const attachment = await upload.json();
    assert.ok(attachment.path.startsWith(data));
    assert.equal(readFileSync(attachment.path, "utf8"), "Notes uploaded from mobile");
    await server.stop();
    server = await startHarness(env);
    const persisted = await fetch(`${server.url}/api/bots`, { headers: browserHeaders() }).then((r) => r.json());
    assert.equal(persisted.bots.find((b: { id: string }) => b.id === bot.id).title, "Updated from desktop");
    assert.equal((await fetch(`${proxy.origin}/api/bots`)).status, 200);
    assert.equal(readFileSync(attachment.path, "utf8"), "Notes uploaded from mobile");
    assert.equal((await fetch(`${server.url}/api/session`, { method: "DELETE", headers: browserHeaders() })).status, 200);
    assert.equal((await fetch(`${server.url}/api/bots`, { headers: browserHeaders() })).status, 401);
    assert.equal((await fetch(`${proxy.origin}/api/bots`)).status, 200);
  } finally { await proxy.close(); await server.stop(); rmSync(data, { recursive: true, force: true }); }
});

test("local mode keeps its existing access and ignores browser owner sessions", { timeout: 30_000 }, async () => {
  const server = await startHarness({ WORKMATES_HOSTED: "0" });
  try {
    assert.equal((await server.fetch("/api/bots")).status, 200);
    assert.equal((await server.fetchRemote("/api/bots")).status, 403);
  } finally { await server.stop(); }
});

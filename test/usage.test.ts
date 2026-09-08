import { test } from "node:test";
import assert from "node:assert/strict";

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localDate, summarize, UsageStore, type UsageBucket } from "../server/stores/usage.ts";

const freshStore = () => new UsageStore(join(mkdtempSync(join(tmpdir(), "workmates-usage-")), "usage.json"));

const bucket = (over: Partial<UsageBucket> = {}): UsageBucket => ({
  date: "2026-03-17",
  botId: "bot1",
  provider: "claude",
  turns: 1,
  input: 100,
  output: 50,
  cost: 0,
  costKnown: false,
  ...over,
});

const march = (day: number) => new Date(2026, 2, day, 12, 0, 0);

test("a local date is the day you are actually having", () => {
  assert.equal(localDate(new Date(2026, 2, 17, 23, 30)), "2026-03-17");
  assert.equal(localDate(new Date(2026, 0, 5, 0, 15)), "2026-01-05");
});

test("every day in range appears, including the quiet ones", () => {
  const s = summarize([bucket({ date: "2026-03-17" })], 7, march(17));
  assert.equal(s.daily.length, 7, "one point per day");
  assert.equal(s.daily[6].date, "2026-03-17", "oldest first, today last");
  assert.equal(s.daily[6].input, 100);
  assert.equal(s.daily[0].turns, 0, "a day with nothing on it is still a day");
});

test("totals split by agent and by provider without double counting", () => {
  const s = summarize(
    [
      bucket({ botId: "a", provider: "claude", input: 100, output: 10, turns: 1 }),
      bucket({ botId: "b", provider: "claude", input: 200, output: 20, turns: 2 }),
      bucket({ botId: "a", provider: "codex", input: 300, output: 30, turns: 3 }),
    ],
    7,
    march(17),
  );
  assert.equal(s.total.input, 600);
  assert.equal(s.total.output, 60);
  assert.equal(s.total.turns, 6);

  const agentA = s.byAgent.find((r) => r.botId === "a");
  assert.equal(agentA?.input, 400, "one agent's work across two providers adds up");

  const claude = s.byProvider.find((r) => r.provider === "claude");
  assert.equal(claude?.turns, 3, "one provider's work across two agents adds up");
});

test("busiest first, so the list answers 'what is this costing me'", () => {
  const s = summarize(
    [
      bucket({ botId: "quiet", input: 10, output: 1 }),
      bucket({ botId: "busy", input: 900, output: 90 }),
    ],
    7,
    march(17),
  );
  assert.equal(s.byAgent[0].botId, "busy");
});

test("a provider that never reports a price does not look free", () => {
  const s = summarize([bucket({ provider: "codex", cost: 0, costKnown: false })], 7, march(17));
  assert.equal(s.costKnown, false);
  assert.equal(s.total.cost, 0);

  const withPrice = summarize(
    [
      bucket({ provider: "codex", cost: 0, costKnown: false }),
      bucket({ provider: "claude", cost: 0.42, costKnown: true }),
    ],
    7,
    march(17),
  );
  assert.equal(withPrice.costKnown, true, "one priced provider is enough to show a figure");
  assert.ok(Math.abs(withPrice.total.cost - 0.42) < 1e-9);
});

test("buckets outside the window are left out of the totals", () => {
  const s = summarize(
    [bucket({ date: "2026-03-17", input: 100 }), bucket({ date: "2026-03-01", input: 999 })],
    7,
    march(17),
  );
  assert.equal(s.daily.length, 7);
  assert.ok(s.daily.every((d) => d.date >= "2026-03-11"));
});

test("a cumulative reporter is banked once, not once per update", () => {
  const store = freshStore();
  store.noteTokens("bot1", "codex", 1_200, 40);
  store.noteTokens("bot1", "codex", 2_400, 90);
  store.noteTokens("bot1", "codex", 3_100, 150);
  store.recordTurn("bot1", "codex", null);

  const summary = summarize(store.since(1), 1);
  assert.equal(summary.total.input, 3_100, "the final total, not the sum of the reports");
  assert.equal(summary.total.output, 150);
  assert.equal(summary.total.turns, 1);
});

test("a second turn starts its own high-water mark", () => {
  const store = freshStore();
  store.noteTokens("bot1", "codex", 5_000, 100);
  store.recordTurn("bot1", "codex", null);
  store.noteTokens("bot1", "codex", 900, 30);
  store.recordTurn("bot1", "codex", null);

  const summary = summarize(store.since(1), 1);
  assert.equal(summary.total.input, 5_900, "5000 then 900, not 5000 then 5000");
  assert.equal(summary.total.turns, 2);
});

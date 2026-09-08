import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { assemble, blockedOn, tally, whyBusy, type Block, type Lane } from "../server/agents/activity.ts";
import type { Message } from "../server/stores/store.ts";

const card = (over: Partial<Message> & { card: Message["card"] }): Message => ({
  id: "m1",
  role: "bot",
  kind: "options",
  at: 1_000,
  ...over,
});

const nothingLive = { request: () => false, run: () => null };

describe("what a lane has stopped on", () => {
  test("an open permission request whose turn can still hear the answer", () => {
    const found = blockedOn(
      [card({ card: { title: "Run this?", subtitle: "rm -rf build", options: [], requestId: "r1" } })],
      { request: (id) => id === "r1", run: () => null },
    );
    assert.equal(found?.kind, "approval");
    assert.equal(found?.asks, "rm -rf build");
    assert.equal(found?.messageId, "m1");
  });

  test("the same card once nobody is behind it", () => {
    const found = blockedOn(
      [card({ card: { title: "Run this?", subtitle: "", options: [], requestId: "r1" } })],
      nothingLive,
    );
    assert.equal(found, null);
  });

  test("a workflow gate, with its deadline", () => {
    const found = blockedOn(
      [card({ card: { title: "Send the invoice?", subtitle: "", options: [], runId: "run-1" } })],
      { request: () => false, run: (id) => (id === "run-1" ? { until: 9_000, name: "Invoices" } : null) },
    );
    assert.equal(found?.kind, "workflow");
    assert.equal(found?.until, 9_000);
    assert.equal(found?.runId, "run-1");
    assert.equal(found?.asks, "Send the invoice?");
  });

  test("a gate whose run has moved on is not waiting on anybody", () => {
    const found = blockedOn(
      [card({ card: { title: "Send it?", subtitle: "", options: [], runId: "run-1" } })],
      nothingLive,
    );
    assert.equal(found, null);
  });

  test("answered cards are done, of either kind", () => {
    const live = { request: () => true, run: () => ({ until: 1, name: "w" }) };
    assert.equal(blockedOn([card({ card: { title: "x", subtitle: "", options: [], requestId: "r", answered: "yes" } })], live), null);
    assert.equal(blockedOn([card({ card: { title: "x", subtitle: "", options: [], runId: "run-1", answered: "Approve" } })], live), null);
  });

  test("a dismissed approval is done, because dismissing one denies it", () => {
    const live = { request: () => true, run: () => ({ until: 1, name: "w" }) };
    assert.equal(blockedOn([card({ card: { title: "x", subtitle: "", options: [], requestId: "r", dismissed: true } })], live), null);
  });

  test("a dismissed gate is not done for the list, because the run is still parked", () => {
    const live = { request: () => true, run: () => ({ until: 99, name: "Invoices" }) };
    const found = blockedOn(
      [card({ card: { title: "Pay it?", subtitle: "", options: [], runId: "run-1", dismissed: true } })],
      live,
      { includingPutAside: true },
    );
    assert.equal(found?.kind, "workflow");
    assert.equal(found?.runId, "run-1");
    assert.equal(found?.until, 99);
  });

  test("but the lane it was on is not waiting, because opening it shows nothing", () => {
    const live = { request: () => true, run: () => ({ until: 99, name: "Invoices" }) };
    assert.equal(
      blockedOn(
        [card({ card: { title: "Pay it?", subtitle: "", options: [], runId: "run-1", dismissed: true } })],
        live,
      ),
      null,
    );
  });

  test("a dismissed gate whose run has closed is done", () => {
    const found = blockedOn(
      [card({ card: { title: "Pay it?", subtitle: "", options: [], runId: "run-1", dismissed: true } })],
      { request: () => true, run: () => null },
    );
    assert.equal(found, null);
  });

  test("the newest open card wins, because that is the one on screen", () => {
    const found = blockedOn(
      [
        card({ id: "old", at: 1, card: { title: "First", subtitle: "", options: [], requestId: "r1" } }),
        card({ id: "new", at: 2, card: { title: "Second", subtitle: "", options: [], requestId: "r2" } }),
      ],
      { request: () => true, run: () => null },
    );
    assert.equal(found?.messageId, "new");
  });

  test("a lane with nothing in it is not waiting", () => {
    assert.equal(blockedOn([], { request: () => true, run: () => ({ until: 1, name: "w" }) }), null);
    const text: Message = { id: "t", role: "bot", kind: "text", text: "hello", at: 1 };
    assert.equal(blockedOn([text], { request: () => true, run: () => ({ until: 1, name: "w" }) }), null);
  });
});

describe("why a lane is busy", () => {
  const empty = { routines: new Map(), jobs: new Map(), workflows: new Map() };

  test("nobody set it off but you", () => {
    assert.deepEqual(whyBusy("t1", empty), { kind: "you", because: "you asked" });
  });

  test("a routine names itself", () => {
    const why = whyBusy("t1", { ...empty, routines: new Map([["t1", "Morning brief"]]) });
    assert.equal(why.kind, "routine");
    assert.match(why.because, /Morning brief/);
  });

  test("a job names the work", () => {
    const why = whyBusy("t1", { ...empty, jobs: new Map([["t1", "Write the launch note"]]) });
    assert.equal(why.kind, "job");
    assert.match(why.because, /Write the launch note/);
  });

  test("a workflow names itself and the step", () => {
    const why = whyBusy("t1", {
      ...empty,
      workflows: new Map([["t1", { name: "Invoice check", step: "triage" }]]),
    });
    assert.equal(why.kind, "workflow");
    assert.match(why.because, /Invoice check/);
    assert.match(why.because, /triage/);
  });
});

describe("putting it together", () => {
  const lane = (
    over: Partial<Lane> & { threadId: string; botId: string; blocked?: Block },
  ): Lane & { blocked?: Block } => ({
    botName: over.botId,
    laneTitle: "General",
    busy: false,
    ...over,
  });

  const base = {
    routines: new Map<string, string>(),
    jobs: new Map<string, string>(),
    workflows: new Map<string, { name: string; step: string }>(),
    spend: [] as Array<{ botId: string; turns: number; input: number; output: number; cost: number }>,
    costKnown: false,
    at: 10_000,
  };

  test("an idle workspace is empty rather than absent", () => {
    const out = assemble({ ...base, lanes: [lane({ threadId: "t1", botId: "a" })] });
    assert.deepEqual(out.waiting, []);
    assert.deepEqual(out.running, []);
    assert.deepEqual(out.today, { turns: 0, input: 0, output: 0, cost: 0 });
  });

  test("waiting comes before running, whatever the clock says", () => {
    const out = assemble({
      ...base,
      lanes: [
        lane({ threadId: "t1", botId: "a", busy: true, since: 1 }),
        lane({
          threadId: "t2",
          botId: "b",
          blocked: { messageId: "m", asks: "ok?", since: 9_000, kind: "approval" },
        }),
      ],
    });
    assert.equal(out.waiting.length, 1);
    assert.equal(out.running.length, 1);
    assert.equal(out.waiting[0].botId, "b");
  });

  test("oldest first inside each group", () => {
    const out = assemble({
      ...base,
      lanes: [
        lane({ threadId: "new", botId: "a", busy: true, since: 500 }),
        lane({ threadId: "old", botId: "b", busy: true, since: 100 }),
      ],
    });
    assert.deepEqual(out.running.map((r) => r.threadId), ["old", "new"]);
  });

  test("a lane that is busy and blocked counts as blocked", () => {
    const out = assemble({
      ...base,
      lanes: [
        lane({
          threadId: "t1",
          botId: "a",
          busy: true,
          since: 1,
          blocked: { messageId: "m", asks: "ok?", since: 2, kind: "approval" },
        }),
      ],
    });
    assert.equal(out.waiting.length, 1);
    assert.equal(out.running.length, 0);
  });

  test("each running row says what set it off", () => {
    const out = assemble({
      ...base,
      routines: new Map([["t1", "Morning brief"]]),
      lanes: [lane({ threadId: "t1", botId: "a", busy: true, since: 1 })],
    });
    assert.equal(out.running[0].kind, "routine");
    assert.match(out.running[0].because, /Morning brief/);
  });

  test("agents roll up their own work and their own spend", () => {
    const out = assemble({
      ...base,
      spend: [{ botId: "a", turns: 3, input: 900, output: 100, cost: 0.5 }],
      costKnown: true,
      lanes: [
        lane({ threadId: "t1", botId: "a", botName: "Ivy", busy: true, since: 1 }),
        lane({ threadId: "t2", botId: "a", botName: "Ivy", busy: true, since: 2 }),
        lane({
          threadId: "t3",
          botId: "b",
          botName: "Kit",
          blocked: { messageId: "m", asks: "?", since: 3, kind: "approval" },
        }),
      ],
    });
    const ivy = out.agents.find((a) => a.botId === "a")!;
    assert.equal(ivy.running, 2);
    assert.equal(ivy.waiting, 0);
    assert.equal(ivy.today.turns, 3);
    assert.equal(out.agents[0].botId, "b");
  });

  test("an agent that spent today is counted even with nothing running", () => {
    const out = assemble({
      ...base,
      spend: [{ botId: "a", turns: 2, input: 100, output: 20, cost: 0 }],
      lanes: [lane({ threadId: "t1", botId: "a", botName: "Ivy" })],
    });
    assert.equal(out.agents.length, 1);
    assert.equal(out.agents[0].today.turns, 2);
    assert.equal(out.agents[0].running, 0);
  });

  test("the total is the sum of what was spent, not of what is running", () => {
    const out = assemble({
      ...base,
      spend: [
        { botId: "a", turns: 1, input: 10, output: 1, cost: 0.25 },
        { botId: "b", turns: 2, input: 20, output: 2, cost: 0.75 },
      ],
      costKnown: true,
      lanes: [lane({ threadId: "t1", botId: "a", botName: "Ivy" })],
    });
    assert.deepEqual(out.today, { turns: 3, input: 30, output: 3, cost: 1 });
    assert.equal(out.costKnown, true);
  });

  test("cost stays unknown when no provider reported one", () => {
    const out = assemble({ ...base, lanes: [] });
    assert.equal(out.costKnown, false);
  });
});

describe("the ambient line", () => {
  test("nothing happening says nothing", () => {
    assert.equal(tally({ waiting: [], running: [] }), null);
  });

  test("what wants a person comes first", () => {
    const line = tally({ waiting: [{} as never], running: [{} as never, {} as never] });
    assert.equal(line, "1 waiting on you, 2 running");
  });

  test("running alone", () => {
    assert.equal(tally({ waiting: [], running: [{} as never] }), "1 running");
  });
});

describe("a room is not an agent", () => {
  test("a gate parked on a room's card still wants an answer", () => {
    const out = assemble({
      routines: new Map(),
      jobs: new Map(),
      workflows: new Map(),
      spend: [],
      costKnown: false,
      at: 10_000,
      lanes: [
        {
          threadId: "room-1",
          botId: "room-1",
          botName: "Sales",
          laneTitle: "Room",
          busy: false,
          room: true,
          blocked: { messageId: "m", asks: "Send it?", since: 1, kind: "workflow", runId: "r" },
        },
      ],
    });
    assert.equal(out.waiting.length, 1);
    assert.equal(out.waiting[0].botName, "Sales");
    assert.deepEqual(out.agents, [], "a room was counted as an agent");
  });
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { engineIsFresh, freshTurnText } from "../server/agents/turn-context.ts";

describe("engine freshness", () => {
  test("a switch is fresh, a return visit is fresh, staying is not", () => {
    const base = { resumeCursors: {}, hasUserTurn: true };
    assert.equal(engineIsFresh({ ...base, instanceId: "a", lastInstanceId: "a" }), false);
    assert.equal(engineIsFresh({ ...base, instanceId: "b", lastInstanceId: "a" }), true);
    assert.equal(
      engineIsFresh({
        instanceId: "a",
        lastInstanceId: "b",
        resumeCursors: { a: "cursor-1" },
        hasUserTurn: true,
      }),
      true,
    );
  });

  test("legacy lanes fall back to the cursor map", () => {
    assert.equal(
      engineIsFresh({ instanceId: "a", resumeCursors: { a: "c1" }, hasUserTurn: true }),
      false,
    );
    assert.equal(
      engineIsFresh({ instanceId: "a", resumeCursors: { b: "c2" }, hasUserTurn: true }),
      true,
    );
    assert.equal(
      engineIsFresh({ instanceId: "a", resumeCursors: { a: "c1", b: "c2" }, hasUserTurn: true }),
      true,
    );
  });

  test("a lane with no user turn never replays", () => {
    assert.equal(
      engineIsFresh({ instanceId: "b", lastInstanceId: "a", resumeCursors: {}, hasUserTurn: false }),
      false,
    );
  });

  test("the replay carries the labelled story and the new message", () => {
    const text = freshTurnText(
      [
        { role: "user", text: "Plan the launch." },
        { role: "assistant", text: "Drafted a three week plan." },
      ],
      "Now compress it to two weeks.",
    );
    assert.match(text, /picking up this conversation mid-thread/);
    assert.match(text, /User: Plan the launch\./);
    assert.match(text, /Assistant: Drafted a three week plan\./);
    assert.match(text, /--- the new message ---\n\nNow compress it to two weeks\./);
    assert.equal(freshTurnText([], "hi"), "hi");
  });
});

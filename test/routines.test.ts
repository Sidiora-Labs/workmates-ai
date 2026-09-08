import { test } from "node:test";
import assert from "node:assert/strict";

import {
  describe,
  GRACE_MS,
  isDue,
  lastScheduledBefore,
  nextScheduledAfter,
  normalize,
  parseTime,
  type Routine,
} from "../server/stores/routines.ts";

const routine = (over: Partial<Routine> = {}): Routine => ({
  id: "r1",
  targetId: "bot1",
  targetKind: "agent",
  prompt: "Brief me",
  time: "09:00",
  days: [],
  enabled: true,
  createdAt: 0,
  ...over,
});

const at = (iso: string) => new Date(iso);

test("a time is only a time when it is one", () => {
  assert.equal(parseTime("09:00"), 540);
  assert.equal(parseTime("9:05"), 545);
  assert.equal(parseTime("23:59"), 1439);
  for (const bad of ["24:00", "09:60", "0900", "9", "", "nine", null, 900]) {
    assert.equal(parseTime(bad), null, `${JSON.stringify(bad)} is not a time`);
  }
});

test("a daily routine's last slot is today once the time has passed", () => {
  const now = at("2026-03-17T10:00:00");
  const slot = lastScheduledBefore(routine(), now);
  assert.ok(slot);
  assert.equal(slot.getHours(), 9);
  assert.equal(slot.getDate(), 17);
});

test("before its time, a daily routine's last slot is yesterday", () => {
  const now = at("2026-03-17T08:00:00");
  const slot = lastScheduledBefore(routine(), now);
  assert.ok(slot);
  assert.equal(slot.getDate(), 16);
});

test("day filters are respected in both directions", () => {
  const mondaysOnly = routine({ days: [1] });
  const tuesday = at("2026-03-17T10:00:00");

  const last = lastScheduledBefore(mondaysOnly, tuesday);
  assert.ok(last);
  assert.equal(last.getDay(), 1, "the previous slot is Monday");
  assert.equal(last.getDate(), 16);

  const next = nextScheduledAfter(mondaysOnly, tuesday);
  assert.ok(next);
  assert.equal(next.getDay(), 1, "the next slot is the following Monday");
  assert.equal(next.getDate(), 23);
});

test("a due routine fires once, then not again for the same slot", () => {
  const now = at("2026-03-17T09:00:30");
  const r = routine();
  assert.equal(isDue(r, now), true);

  r.lastRunAt = at("2026-03-17T09:00:05").getTime();
  assert.equal(isDue(r, now), false, "already served this slot");

  assert.equal(isDue(r, at("2026-03-18T09:00:10")), true);
});

test("a run missed by more than the grace window is skipped, not fired late", () => {
  const r = routine();
  const late = at("2026-03-17T23:40:00");
  assert.equal(isDue(r, late), false);

  const slightlyLate = at("2026-03-17T10:30:00");
  assert.equal(isDue(r, slightlyLate), true);
  assert.ok(GRACE_MS > 60 * 60_000, "the window is generous enough to survive a meeting");
});

test("a disabled routine never fires", () => {
  assert.equal(isDue(routine({ enabled: false }), at("2026-03-17T09:00:10")), false);
});

test("a routine on a day it does not run stays quiet", () => {
  const weekdays = routine({ days: [1, 2, 3, 4, 5] });
  assert.equal(isDue(weekdays, at("2026-03-22T09:00:10")), false);
});

test("normalize refuses what it cannot store and clamps the rest", () => {
  assert.equal(normalize(null), null);
  assert.equal(normalize({ prompt: "hi", time: "09:00" }), null, "no target");
  assert.equal(normalize({ targetId: "b", time: "09:00" }), null, "no prompt");
  assert.equal(normalize({ targetId: "b", prompt: "hi", time: "99:99" }), null, "no valid time");

  const clean = normalize({
    targetId: "  bot1  ",
    targetKind: "nonsense",
    prompt: "  Brief me  ",
    time: "9:05",
    days: [1, 1, 9, -2, 3, "x"],
    enabled: false,
  });
  assert.ok(clean);
  assert.equal(clean.targetId, "bot1");
  assert.equal(clean.targetKind, "agent", "an unknown kind falls back to the safe one");
  assert.equal(clean.prompt, "Brief me");
  assert.equal(clean.time, "09:05", "normalised to two digits so clients can compare strings");
  assert.deepEqual(clean.days, [1, 3], "duplicates and out-of-range days dropped");
  assert.equal(clean.enabled, false);
});

test("an over-long prompt is cut rather than rejected", () => {
  const clean = normalize({ targetId: "b", prompt: "x".repeat(9_000), time: "09:00" });
  assert.ok(clean);
  assert.equal(clean.prompt.length, 2_000);
});

test("the schedule reads like something a person would say", () => {
  assert.equal(describe(routine({ days: [] })), "Every day at 09:00");
  assert.equal(describe(routine({ days: [1, 2, 3, 4, 5] })), "Weekdays at 09:00");
  assert.equal(describe(routine({ days: [0, 6] })), "Weekends at 09:00");
  assert.equal(describe(routine({ days: [3] })), "Every Wednesday at 09:00");
  assert.equal(describe(routine({ days: [1, 4] })), "Mon, Thu at 09:00");
});

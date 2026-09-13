import { test } from "node:test";
import assert from "node:assert/strict";
import { boxError } from "../server/integrations/box.ts";

test("Box errors retain actionable account feedback without exposing credentials", () => {
  const body = { error: { code: "trial_auto_stop_required", message: "Free-trial auto-stop is 2 hours maximum." } };
  assert.match(boxError("creation", 400, body).message, /400.*2 hours maximum/);
  assert.equal(boxError("listing", 401, { error: "Rejected credential sample-key" }, "sample-key").message,
    "Box listing failed (401): Rejected credential [redacted]");
  const long = boxError("creation", 400, { message: "a".repeat(995) + "sample-key" }, "sample-key").message;
  assert.ok(!long.includes("sample"));
  assert.equal(boxError("creation", 502, null).message, "Box creation failed (502)");
});

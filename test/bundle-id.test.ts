import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const packagedId = () => read("../electron-builder.yml").match(/^appId:\s*(\S+)/m)?.[1];
const cuaHostId = () => read("../electron/cua.mjs").match(/HOST_BUNDLE_ID\s*=\s*"([^"]+)"/)?.[1];

test("the packaged app and the computer-use host claim the same bundle id", () => {
  const packaged = packagedId();
  const host = cuaHostId();
  assert.ok(packaged, "electron-builder.yml has no appId");
  assert.ok(host, "electron/cua.mjs has no HOST_BUNDLE_ID");
  assert.equal(host, packaged);
});

test("the bundle id sits under the domain we own", () => {
  assert.match(packagedId()!, /^ag\.centra\.workmate\./);
});

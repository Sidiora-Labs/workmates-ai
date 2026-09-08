import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

const EXEMPT = new Map<string, string>([
  [
    "server/core/config.ts",
    "the one-time migration that adopts a pre-rename ~/.bloks workspace, so " +
      "existing agents keep their signing keys and their hash-chained record",
  ],
  ["test/naming.test.ts", "this file names the thing it hunts for"],
]);

const BINARY = /\.(png|jpg|jpeg|gif|ico|icns|webp|woff2?|ttf|otf|pdf|zip|mp4|mov)$/i;

function tracked(): string[] {
  return execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter((f) => f && !BINARY.test(f));
}

test("nothing in the tracked tree still carries the old name", () => {
  const hits: string[] = [];
  for (const file of tracked()) {
    if (EXEMPT.has(file)) continue;
    let body: string;
    try {
      body = readFileSync(new URL(file, new URL("..", import.meta.url)), "utf8");
    } catch {
      continue;
    }
    const found = body.match(/blok/i);
    if (found) {
      const line = body.slice(0, body.indexOf(found[0])).split("\n").length;
      hits.push(`${file}:${line}`);
    }
  }
  assert.deepEqual(hits, [], `the old name survives in:\n${hits.join("\n")}`);
});

test("every exemption is a file that exists and still needs one", () => {
  const files = new Set(tracked());
  for (const [file, why] of EXEMPT) {
    assert.ok(files.has(file), `${file} is exempted but not tracked: drop the exemption`);
    const body = readFileSync(new URL(file, new URL("..", import.meta.url)), "utf8");
    assert.match(body, /blok/i, `${file} no longer mentions the old name, so the exemption (${why}) is stale`);
  }
});

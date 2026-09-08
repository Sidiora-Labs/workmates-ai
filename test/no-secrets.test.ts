import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

const SHAPES: [string, RegExp][] = [
  ["a Stripe secret key", /\b[sr]k_(?:live|test)_[A-Za-z0-9]{20,}/],
  ["a Stripe webhook signing secret", /\bwhsec_[A-Za-z0-9]{20,}/],
  ["a GitHub token", /\b(?:ghp|gho|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}/],
  ["an AWS access key id", /\bAKIA[0-9A-Z]{16}\b/],
  ["an OpenAI style key", /\bsk-[A-Za-z0-9]{32,}/],
  ["a private key block", /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/],
  ["a Workmates Cloud licence key", /\bwm_live_[0-9a-f]{32}\b/],
  ["an Apple app-specific password", /\b[a-z]{4}-[a-z]{4}-[a-z]{4}-[a-z]{4}\b/],
];

const EXEMPT = new Set(["test/no-secrets.test.ts"]);

const BINARY = /\.(png|jpg|jpeg|gif|ico|icns|webp|woff2?|ttf|otf|pdf|zip|mp4|mov)$/i;

function tracked(): string[] {
  return execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter((line) => line && !BINARY.test(line) && !EXEMPT.has(line));
}

test("no tracked file carries anything shaped like a credential", () => {
  const hits: string[] = [];
  for (const file of tracked()) {
    let body: string;
    try {
      body = readFileSync(new URL(file, new URL("..", import.meta.url)), "utf8");
    } catch {
      continue;
    }
    for (const [what, shape] of SHAPES) {
      const found = body.match(shape);
      if (found) hits.push(`${file}: ${what} (${found[0].slice(0, 12)}...)`);
    }
  }
  assert.deepEqual(hits, [], `credential-shaped strings in tracked files:\n${hits.join("\n")}`);
});

test("the ignore rules cover the file names secrets actually arrive in", () => {
  const ignore = readFileSync(new URL("../.gitignore", import.meta.url), "utf8");
  for (const rule of [".env", ".dev.vars", "*.p12", "*.p8", "*.pem"]) {
    assert.ok(ignore.includes(rule), `.gitignore no longer covers ${rule}`);
  }
});

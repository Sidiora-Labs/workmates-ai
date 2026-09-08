import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (relative: string) => readFileSync(join(root, relative), "utf8");

function extraResources(): Array<{ from: string; to: string }> {
  const lines = read("electron-builder.yml").split("\n");
  const start = lines.findIndex((line) => line === "extraResources:");
  if (start === -1) return [];
  const block: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    block.push(line);
  }
  const pairs: Array<{ from: string; to: string }> = [];
  for (let i = 0; i < block.length; i++) {
    const from = block[i].match(/^\s*-\s*from:\s*(\S+)/)?.[1];
    if (!from) continue;
    const to = block[i + 1]?.match(/^\s*to:\s*(\S+)/)?.[1];
    if (to) pairs.push({ from, to });
  }
  return pairs;
}

function shippedAs(sourceDir: string): string | undefined {
  return extraResources().find((entry) => entry.from === sourceDir)?.to;
}

test("the agent's command line ships where the server looks for it", () => {
  const expression = read("server/index.ts").match(
    /AGENT_CLI\s*=\s*fileURLToPath\(new URL\("([^"]+)"/,
  )?.[1];
  assert.ok(expression, "AGENT_CLI is no longer a literal relative URL; update this test");

  const serverTo = shippedAs("dist-server");
  assert.equal(serverTo, "server", "the compiled server is no longer copied to Resources/server");

  const packagedServerDir = join("/Resources", serverTo!);
  const wanted = resolve(packagedServerDir, expression!);
  const topLevel = wanted.slice("/Resources/".length).split("/")[0];

  const shipped = extraResources().some((entry) => entry.to === topLevel);
  assert.ok(
    shipped,
    `the server resolves its CLI to Resources/${topLevel}, which electron-builder does not copy: ` +
      `add it to extraResources or every agent command fails in the packaged app`,
  );

  const source = extraResources().find((entry) => entry.to === topLevel)!.from;
  const relative = wanted.slice(`/Resources/${topLevel}/`.length);
  assert.ok(
    existsSync(join(root, source, relative)),
    `${join(source, relative)} is missing from the repository`,
  );
});

test("every extraResources entry has something to copy", () => {
  const entries = extraResources();
  assert.ok(entries.length >= 3, "the top-level block should hold ui, server and the CLI");
  for (const entry of entries) {
    if (entry.from.startsWith("dist")) continue;
    assert.ok(
      existsSync(join(root, entry.from)),
      `electron-builder copies ${entry.from}, which does not exist`,
    );
  }
});

test("the platform sections are not read as top-level entries", () => {
  for (const entry of extraResources()) {
    assert.ok(
      !entry.from.startsWith("electron/resources/"),
      `${entry.from} belongs to a platform section, not the top-level block`,
    );
  }
});

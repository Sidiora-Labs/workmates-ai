import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

test("every ledger kind has a label in the record panel", () => {
  const declared = source("../server/stores/ledger.ts").match(/export type LedgerKind =([\s\S]*?);/);
  assert.ok(declared, "LedgerKind is not where this test expects it");
  const kinds = [...declared[1].matchAll(/"([\w.]+)"/g)].map((m) => m[1]);
  assert.ok(kinds.length >= 8, "no kinds were found, so this test proves nothing");

  const labels = source("../src/components/settings/RecordPanel.tsx").match(
    /const LABEL: Record<string, string> = \{([\s\S]*?)\};/,
  );
  assert.ok(labels, "the LABEL map is not where this test expects it");
  const known = new Set([...labels[1].matchAll(/"?([\w.]+)"?:\s*"/g)].map((m) => m[1]));

  const missing = kinds.filter((kind) => !known.has(kind));
  assert.deepEqual(missing, [], `these would show as raw identifiers: ${missing.join(", ")}`);
});

test("the editor's step naming agrees with the server's", () => {
  const client = source("../src/components/workspace/Workflows.tsx").match(
    /function stepId\(text: string, taken: string\[\]\): string \{([\s\S]*?)\n\}/,
  );
  const server = source("../server/stores/workflows.ts").match(
    /export function slug\(text: string, taken: string\[\] = \[\]\): string \{([\s\S]*?)\n\}/,
  );
  assert.ok(client, "the editor's stepId is not where this test expects it");
  assert.ok(server, "the server's slug is not where this test expects it");

  const rule = /\.toLowerCase\(\)[\s\S]*?replace\(\/\[\^a-z0-9\]\+\/g, "-"\)[\s\S]*?replace\(\/\^-\+\|-\+\$\/g, ""\)[\s\S]*?slice\(0, 24\) \|\| "step"/;
  assert.match(client[1], rule, "the editor stopped naming steps the way the server does");
  assert.match(server[1], rule, "the server changed how it names steps");
});

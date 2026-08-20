import { appendFileSync } from "node:fs";
import { join } from "node:path";

import { NATIVE_DIR } from "../core/config.ts";

export function appendNative(threadId: string, entry: { dir: "in" | "out"; source: string; msg: unknown }) {
  try {
    appendFileSync(
      join(NATIVE_DIR, `${threadId}.ndjson`),
      JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n",
    );
  } catch {
  }
}

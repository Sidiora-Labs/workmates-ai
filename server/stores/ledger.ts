import { createHash } from "node:crypto";
import { appendFileSync, chmodSync, createReadStream, existsSync, mkdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";

import { DATA_DIR } from "../core/config.ts";
import { statementOf, verifyStatement } from "../core/identity.ts";

export const GENESIS_PREV = "0".repeat(64);

export const RECENT_KEPT = 500;

export type LedgerKind =
  | "genesis"
  | "approval"
  | "agent.created"
  | "agent.imported"
  | "agent.exported"
  | "agent.archived"
  | "agent.restored"
  | "agent.deleted"
  | "skill.installed"
  | "skill.deleted"
  | "routine.ran"
  | "job.posted"
  | "workflow.ran"
  | "policy.changed"
  | "control.taken"
  | "control.released";

export interface LedgerEntry {
  seq: number;
  at: number;
  kind: LedgerKind;
  actor: string;
  summary: string;
  detail?: Record<string, string | number | boolean>;
  prev: string;
  hash: string;
}

export interface LedgerDraft {
  at: number;
  kind: LedgerKind;
  actor: string;
  summary: string;
  detail?: Record<string, string | number | boolean>;
  by?: { fingerprint: string; signature: string };
}

export function canonical(entry: Omit<LedgerEntry, "hash">): string {
  const detail = entry.detail ?? {};
  const parts = Object.keys(detail)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${JSON.stringify(detail[key])}`);
  return [
    `"seq":${JSON.stringify(entry.seq)}`,
    `"at":${JSON.stringify(entry.at)}`,
    `"kind":${JSON.stringify(entry.kind)}`,
    `"actor":${JSON.stringify(entry.actor)}`,
    `"summary":${JSON.stringify(entry.summary)}`,
    `"detail":{${parts.join(",")}}`,
    `"prev":${JSON.stringify(entry.prev)}`,
  ].join(",");
}

export function hashEntry(entry: Omit<LedgerEntry, "hash">): string {
  return createHash("sha256").update(canonical(entry), "utf8").digest("hex");
}

function detailOf(draft: LedgerDraft): { detail?: Record<string, string | number | boolean> } {
  const detail = { ...(draft.detail ?? {}) };
  if (draft.by?.fingerprint && draft.by.signature) {
    detail.by = draft.by.fingerprint;
    detail.sig = draft.by.signature;
  }
  return Object.keys(detail).length ? { detail } : {};
}

export function seal(draft: LedgerDraft, previous: Pick<LedgerEntry, "seq" | "hash"> | null): LedgerEntry {
  const body: Omit<LedgerEntry, "hash"> = {
    seq: previous ? previous.seq + 1 : 0,
    at: draft.at,
    kind: draft.kind,
    actor: draft.actor,
    summary: draft.summary,
    ...detailOf(draft),
    prev: previous ? previous.hash : GENESIS_PREV,
  };
  return { ...body, hash: hashEntry(body) };
}

export const genesisDraft = (at: number): LedgerDraft => ({
  at,
  kind: "genesis",
  actor: "Workmates",
  summary: "The record starts here.",
});

export type VerifyResult =
  | { ok: true; entries: number; through: number | null }
  | { ok: false; entries: number; seq: number | null; reason: string };

export function verifyChain(entries: LedgerEntry[]): VerifyResult {
  if (!entries.length) return { ok: true, entries: 0, through: null };

  let previous: LedgerEntry | null = null;
  for (const entry of entries) {
    const at = typeof entry?.seq === "number" ? entry.seq : null;

    if (!previous) {
      if (entry.seq !== 0) {
        return { ok: false, entries: entries.length, seq: at, reason: "the record does not start at its beginning" };
      }
      if (entry.kind !== "genesis" || entry.prev !== GENESIS_PREV) {
        return { ok: false, entries: entries.length, seq: at, reason: "the first entry is not the one the record began with" };
      }
    } else {
      if (entry.seq !== previous.seq + 1) {
        return { ok: false, entries: entries.length, seq: at, reason: "an entry is missing from the middle of the record" };
      }
      if (entry.prev !== previous.hash) {
        return { ok: false, entries: entries.length, seq: at, reason: "an entry does not follow the one before it" };
      }
    }

    const { hash, ...body } = entry;
    if (hash !== hashEntry(body)) {
      return { ok: false, entries: entries.length, seq: at, reason: "an entry has been changed since it was written" };
    }
    previous = entry;
  }

  return { ok: true, entries: entries.length, through: previous!.seq };
}

export function parseEntry(value: unknown): LedgerEntry | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.seq !== "number" || !Number.isInteger(v.seq) || v.seq < 0) return null;
  if (typeof v.at !== "number") return null;
  if (typeof v.kind !== "string" || typeof v.actor !== "string") return null;
  if (typeof v.summary !== "string") return null;
  if (typeof v.prev !== "string" || typeof v.hash !== "string") return null;
  let detail: LedgerEntry["detail"];
  if (v.detail !== undefined) {
    if (typeof v.detail !== "object" || v.detail === null || Array.isArray(v.detail)) return null;
    detail = {};
    for (const [key, item] of Object.entries(v.detail as Record<string, unknown>)) {
      if (typeof item !== "string" && typeof item !== "number" && typeof item !== "boolean") return null;
      detail[key] = item;
    }
  }
  return {
    seq: v.seq,
    at: v.at,
    kind: v.kind as LedgerKind,
    actor: v.actor,
    summary: v.summary,
    ...(detail && Object.keys(detail).length ? { detail } : {}),
    prev: v.prev,
    hash: v.hash,
  };
}

const LEDGER_FILE = join(DATA_DIR, "record.ndjson");

const MAX_SUMMARY = 300;
const MAX_DETAIL_KEYS = 12;
const MAX_DETAIL_VALUE = 300;

export function clamped(draft: LedgerDraft): LedgerDraft {
  const detail: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(draft.detail ?? {})) {
    if (Object.keys(detail).length >= MAX_DETAIL_KEYS) break;
    if (value === undefined || value === null || value === "") continue;
    detail[key.slice(0, 40)] = typeof value === "string" ? value.slice(0, MAX_DETAIL_VALUE) : value;
  }
  return {
    at: draft.at,
    kind: draft.kind,
    actor: draft.actor.slice(0, 80) || "Workmates",
    summary: draft.summary.slice(0, MAX_SUMMARY),
    ...(Object.keys(detail).length ? { detail } : {}),
    ...(draft.by ? { by: draft.by } : {}),
  };
}

export function attribution(entry: LedgerEntry): { state: "unsigned" | "ok" | "bad"; by?: string } {
  const by = entry.detail?.by;
  const sig = entry.detail?.sig;
  if (typeof by !== "string" || typeof sig !== "string") return { state: "unsigned" };
  const held = verifyStatement(by, statementOf(entry), sig);
  return { state: held ? "ok" : "bad", by };
}

export class Ledger {
  private last: LedgerEntry | null = null;
  private recent: LedgerEntry[] = [];
  private unreadable = 0;
  private ready: Promise<void>;
  private file: string;

  constructor(file: string = LEDGER_FILE) {
    this.file = file;
    this.ready = this.load();
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  private async load() {
    if (!existsSync(this.file)) return;
    await this.eachLine((entry) => {
      if (!entry) {
        this.unreadable++;
        return;
      }
      this.last = entry;
      this.recent.push(entry);
      if (this.recent.length > RECENT_KEPT) this.recent.shift();
    });
  }

  private async eachLine(each: (entry: LedgerEntry | null) => void) {
    const lines = createInterface({
      input: createReadStream(this.file, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
    for await (const line of lines) {
      if (!line.trim()) continue;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        each(null);
        continue;
      }
      each(parseEntry(value));
    }
  }

  async append(draft: LedgerDraft): Promise<LedgerEntry | null> {
    await this.ready;
    try {
      mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
      if (!this.last) this.write(seal(genesisDraft(draft.at), null));
      const entry = seal(clamped(draft), this.last);
      this.write(entry);
      return entry;
    } catch {
      return null;
    }
  }

  private write(entry: LedgerEntry) {
    appendFileSync(this.file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    try {
      chmodSync(this.file, 0o600);
    } catch {
    }
    this.last = entry;
    this.recent.push(entry);
    if (this.recent.length > RECENT_KEPT) this.recent.shift();
  }

  list(limit = 100): LedgerEntry[] {
    return this.recent.slice(-Math.max(0, limit)).reverse();
  }

  get strayLines(): number {
    return this.unreadable;
  }

  async verify(): Promise<VerifyResult> {
    await this.ready;
    if (!existsSync(this.file)) return { ok: true, entries: 0, through: null };
    const entries: LedgerEntry[] = [];
    let stray: number | null = null;
    await this.eachLine((entry) => {
      if (!entry) {
        if (stray === null) stray = entries.length;
        return;
      }
      entries.push(entry);
    });
    if (stray !== null) {
      return {
        ok: false,
        entries: entries.length,
        seq: null,
        reason: "the record has a line in it that is not an entry",
      };
    }
    const walked = verifyChain(entries);
    if (!walked.ok) return walked;
    for (const entry of entries) {
      if (attribution(entry).state === "bad") {
        return {
          ok: false,
          entries: entries.length,
          seq: entry.seq,
          reason: "an entry claims to be signed by an agent that did not sign it",
        };
      }
    }
    return walked;
  }
}

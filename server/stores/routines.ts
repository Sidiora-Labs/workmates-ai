import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { DATA_DIR } from "../core/config.ts";
import { newId } from "../core/contracts.ts";

export interface Routine {
  id: string;
  targetId: string;
  targetKind: "agent" | "room";
  name?: string;
  prompt: string;
  time: string;
  days: number[];
  repeat?: "weekly" | "once";
  date?: string;
  durationMin?: number;
  runsOn?: "cloud" | "local" | "off";
  enabled: boolean;
  createdAt: number;
  lastRunAt?: number;
  runs?: RoutineRun[];
}

export interface RoutineRun {
  id: string;
  startedAt: number;
  endedAt?: number;
  state: "running" | "ok" | "failed";
  summary?: string;
  error?: string;
  threadId?: string;
}

export const MAX_RUNS = 20;

export const MAX_ROUTINES = 50;
export const MAX_ROUTINE_PROMPT = 2_000;

export const GRACE_MS = 2 * 60 * 60_000;

const ROUTINES_FILE = join(DATA_DIR, "routines.json");

export function parseTime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function onceInstant(routine: Routine): Date | null {
  const minutes = parseTime(routine.time);
  const match = routine.date?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (minutes === null || !match) return null;
  const at = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  at.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return at;
}

export function lastScheduledBefore(routine: Routine, now: Date): Date | null {
  if (routine.repeat === "once") {
    const at = onceInstant(routine);
    return at && at.getTime() <= now.getTime() ? at : null;
  }
  const minutes = parseTime(routine.time);
  if (minutes === null) return null;
  const runsOn = (day: number) => routine.days.length === 0 || routine.days.includes(day);

  for (let back = 0; back <= 7; back++) {
    const day = new Date(now);
    day.setDate(day.getDate() - back);
    day.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    if (day.getTime() <= now.getTime() && runsOn(day.getDay())) return day;
  }
  return null;
}

export function nextScheduledAfter(routine: Routine, now: Date): Date | null {
  if (routine.repeat === "once") {
    const at = onceInstant(routine);
    return at && at.getTime() > now.getTime() ? at : null;
  }
  const minutes = parseTime(routine.time);
  if (minutes === null) return null;
  const runsOn = (day: number) => routine.days.length === 0 || routine.days.includes(day);

  for (let ahead = 0; ahead <= 7; ahead++) {
    const day = new Date(now);
    day.setDate(day.getDate() + ahead);
    day.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    if (day.getTime() > now.getTime() && runsOn(day.getDay())) return day;
  }
  return null;
}

export function isDue(routine: Routine, now: Date, graceMs: number = GRACE_MS): boolean {
  if (!routine.enabled) return false;
  const slot = lastScheduledBefore(routine, now);
  if (!slot) return false;
  if (now.getTime() - slot.getTime() > graceMs) return false;
  if (routine.lastRunAt !== undefined && routine.lastRunAt >= slot.getTime()) return false;
  return true;
}

export function normalize(raw: unknown): Omit<Routine, "id" | "createdAt"> | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const targetId = typeof o.targetId === "string" ? o.targetId.trim() : "";
  if (!targetId) return null;
  const targetKind = o.targetKind === "room" ? "room" : "agent";

  const prompt = typeof o.prompt === "string" ? o.prompt.trim().slice(0, MAX_ROUTINE_PROMPT) : "";
  if (!prompt) return null;

  const minutes = parseTime(o.time);
  if (minutes === null) return null;

  const days = Array.isArray(o.days)
    ? [...new Set(o.days.filter((d): d is number => typeof d === "number" && d >= 0 && d <= 6))].sort()
    : [];

  const name = typeof o.name === "string" ? o.name.trim().slice(0, 60) : "";
  const repeat = o.repeat === "once" ? ("once" as const) : undefined;
  const date =
    typeof o.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : undefined;
  if (repeat === "once" && !date) return null;
  const durationMin =
    typeof o.durationMin === "number" && Number.isFinite(o.durationMin)
      ? Math.max(15, Math.min(480, Math.round(o.durationMin / 15) * 15))
      : undefined;
  const runsOn =
    o.runsOn === "cloud" || o.runsOn === "local" || o.runsOn === "off" ? o.runsOn : undefined;

  return {
    targetId,
    targetKind,
    prompt,
    time: formatTime(minutes),
    days,
    enabled: o.enabled !== false,
    name: name || undefined,
    repeat,
    date: repeat === "once" ? date : undefined,
    durationMin,
    runsOn,
  };
}

export function describe(routine: Routine): string {
  if (routine.repeat === "once") {
    const at = onceInstant(routine);
    return at
      ? `Once on ${at.toLocaleDateString([], { month: "short", day: "numeric" })} at ${routine.time}`
      : `Once at ${routine.time}`;
  }
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const weekdays = [1, 2, 3, 4, 5];
  const weekend = [0, 6];
  const same = (a: number[], b: number[]) => a.length === b.length && a.every((d, i) => d === b[i]);

  if (routine.days.length === 0) return `Every day at ${routine.time}`;
  if (same(routine.days, weekdays)) return `Weekdays at ${routine.time}`;
  if (same(routine.days, weekend)) return `Weekends at ${routine.time}`;
  if (routine.days.length === 1) return `Every ${names[routine.days[0]]} at ${routine.time}`;
  return `${routine.days.map((d) => names[d].slice(0, 3)).join(", ")} at ${routine.time}`;
}

export class RoutineStore {
  routines: Routine[] = [];

  constructor() {
    mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    try {
      const parsed = JSON.parse(readFileSync(ROUTINES_FILE, "utf8"));
      this.routines = Array.isArray(parsed) ? parsed.filter(isRoutine) : [];
    } catch {
      this.routines = [];
    }
  }

  private save() {
    writeFileSync(ROUTINES_FILE, JSON.stringify(this.routines, null, 2), { mode: 0o600 });
  }

  get(id: string): Routine | null {
    return this.routines.find((r) => r.id === id) ?? null;
  }

  forTarget(targetId: string): Routine[] {
    return this.routines.filter((r) => r.targetId === targetId);
  }

  create(input: Omit<Routine, "id" | "createdAt">): Routine | null {
    if (this.routines.length >= MAX_ROUTINES) return null;
    const routine: Routine = { ...input, id: newId(), createdAt: Date.now() };
    this.routines.push(routine);
    this.save();
    return routine;
  }

  patch(id: string, patch: Partial<Routine>): Routine | null {
    const routine = this.get(id);
    if (!routine) return null;
    if (patch.prompt !== undefined) routine.prompt = patch.prompt;
    if (patch.time !== undefined) routine.time = patch.time;
    if (patch.days !== undefined) routine.days = patch.days;
    if (patch.enabled !== undefined) routine.enabled = patch.enabled;
    if (patch.lastRunAt !== undefined) routine.lastRunAt = patch.lastRunAt;
    if ("name" in patch) routine.name = patch.name || undefined;
    if ("durationMin" in patch) routine.durationMin = patch.durationMin;
    if ("runsOn" in patch) routine.runsOn = patch.runsOn;
    if ("repeat" in patch) routine.repeat = patch.repeat;
    if ("date" in patch) routine.date = patch.date;
    this.save();
    return routine;
  }

  remove(id: string): boolean {
    const before = this.routines.length;
    this.routines = this.routines.filter((r) => r.id !== id);
    if (this.routines.length === before) return false;
    this.save();
    return true;
  }

  removeForTarget(targetId: string): void {
    const before = this.routines.length;
    this.routines = this.routines.filter((r) => r.targetId !== targetId);
    if (this.routines.length !== before) this.save();
  }

  markRan(id: string, at: number): void {
    const routine = this.get(id);
    if (!routine) return;
    routine.lastRunAt = at;
    if (routine.repeat === "once") routine.enabled = false;
    this.save();
  }

  beginRun(id: string, threadId?: string): RoutineRun | null {
    const routine = this.get(id);
    if (!routine) return null;
    const run: RoutineRun = {
      id: newId(),
      startedAt: Date.now(),
      state: "running",
      ...(threadId ? { threadId } : {}),
    };
    routine.runs = [run, ...(routine.runs ?? [])].slice(0, MAX_RUNS);
    this.save();
    return run;
  }

  endRun(
    routineId: string,
    runId: string,
    outcome: { state: "ok" | "failed"; summary?: string; error?: string },
  ): void {
    const routine = this.get(routineId);
    const run = routine?.runs?.find((r) => r.id === runId);
    if (!routine || !run) return;
    run.state = outcome.state;
    run.endedAt = Date.now();
    if (outcome.summary) run.summary = outcome.summary.slice(0, 300);
    if (outcome.error) run.error = outcome.error.slice(0, 300);
    this.save();
  }

  settleOrphanRuns(): void {
    let touched = false;
    for (const routine of this.routines) {
      for (const run of routine.runs ?? []) {
        if (run.state === "running") {
          run.state = "failed";
          run.endedAt = run.startedAt;
          run.error = "Workmates closed before this run finished.";
          touched = true;
        }
      }
    }
    if (touched) this.save();
  }

  due(now: Date): Routine[] {
    return this.routines.filter((r) => isDue(r, now));
  }
}

function isRoutine(value: unknown): value is Routine {
  const r = value as Routine | null;
  return (
    typeof r === "object" &&
    r !== null &&
    typeof r.id === "string" &&
    typeof r.targetId === "string" &&
    (r.targetKind === "agent" || r.targetKind === "room") &&
    typeof r.prompt === "string" &&
    parseTime(r.time) !== null &&
    Array.isArray(r.days) &&
    typeof r.enabled === "boolean"
  );
}

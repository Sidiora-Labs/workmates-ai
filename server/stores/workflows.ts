import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { DATA_DIR } from "../core/config.ts";
import { newId } from "../core/contracts.ts";

export type TriggerKind = "manual" | "message" | "reaction" | "webhook";

export interface Trigger {
  kind: TriggerKind;
  targetId?: string;
  targetKind?: "agent" | "room";
  contains?: string;
  emoji?: string;
  from?: "user" | "anyone";
}

export type StepAction = "ask" | "post" | "approve";

export type ConditionOp =
  | "contains"
  | "not-contains"
  | "equals"
  | "starts-with"
  | "ends-with"
  | "empty"
  | "not-empty";

export interface Condition {
  left: string;
  op: ConditionOp;
  right?: string;
}

export interface Step {
  id: string;
  action: StepAction;
  targetId?: string;
  text: string;
  when?: Condition;
  timeoutMin?: number;
  onTimeout?: "stop" | "continue";
}

export interface Workflow {
  id: string;
  name: string;
  trigger: Trigger;
  steps: Step[];
  enabled: boolean;
  createdAt: number;
  lastRunAt?: number;
  runs?: WorkflowRun[];
}

export type RunState = "running" | "waiting" | "done" | "failed" | "stopped";

export interface RunStep {
  stepId: string;
  startedAt: number;
  endedAt?: number;
  state: "running" | "ok" | "skipped" | "waiting" | "failed" | "timed-out";
  summary?: string;
  error?: string;
}

export interface Waiting {
  stepId: string;
  threadId: string;
  messageId: string;
  until: number;
  onTimeout: "stop" | "continue";
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  startedAt: number;
  endedAt?: number;
  state: RunState;
  cursor: number;
  trigger: Record<string, string>;
  values: Record<string, Record<string, string>>;
  steps: RunStep[];
  waiting?: Waiting;
  error?: string;
}

export const MAX_WORKFLOWS = 40;
export const MAX_STEPS = 12;
export const MAX_STEP_TEXT = 2_000;
export const MAX_NAME = 80;
export const MAX_RUNS = 20;
export const MAX_TIMEOUT_MIN = 7 * 24 * 60;
export const DEFAULT_TIMEOUT_MIN = 24 * 60;

export interface Scope {
  trigger: Record<string, string>;
  steps: Record<string, Record<string, string>>;
}

export function scopeOf(run: Pick<WorkflowRun, "trigger" | "values">): Scope {
  return { trigger: run.trigger ?? {}, steps: run.values ?? {} };
}

const REFERENCE = /\{\{\s*([\w.-]+)\s*\}\}/g;

function lookup(path: string, scope: Scope): string | null {
  const parts = path.split(".");
  if (parts[0] === "trigger" && parts.length === 2) {
    const value = scope.trigger[parts[1]];
    return value === undefined ? null : String(value);
  }
  if (parts[0] === "steps" && parts.length === 3) {
    const value = scope.steps[parts[1]]?.[parts[2]];
    return value === undefined ? null : String(value);
  }
  return null;
}

export function fill(template: string, scope: Scope): string {
  return String(template ?? "").replace(REFERENCE, (_whole, path: string) => lookup(path, scope) ?? "");
}

export function referencesIn(template: string): string[] {
  const out: string[] = [];
  for (const match of String(template ?? "").matchAll(REFERENCE)) out.push(match[1]);
  return out;
}

export function holds(condition: Condition | undefined, scope: Scope): boolean {
  if (!condition) return true;
  const left = fill(condition.left ?? "", scope).trim().toLowerCase();
  const right = fill(condition.right ?? "", scope).trim().toLowerCase();
  switch (condition.op) {
    case "contains":
      return Boolean(right) && left.includes(right);
    case "not-contains":
      return !right || !left.includes(right);
    case "equals":
      return left === right;
    case "starts-with":
      return Boolean(right) && left.startsWith(right);
    case "ends-with":
      return Boolean(right) && left.endsWith(right);
    case "empty":
      return left === "";
    case "not-empty":
      return left !== "";
    default:
      return false;
  }
}

const OPS: ConditionOp[] = [
  "contains",
  "not-contains",
  "equals",
  "starts-with",
  "ends-with",
  "empty",
  "not-empty",
];
const ACTIONS: StepAction[] = ["ask", "post", "approve"];
const TRIGGERS: TriggerKind[] = ["manual", "message", "reaction", "webhook"];

export function slug(text: string, taken: string[] = []): string {
  const base =
    String(text ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "step";
  if (!taken.includes(base)) return base;
  for (let n = 2; n < 100; n++) {
    const tried = `${base}-${n}`;
    if (!taken.includes(tried)) return tried;
  }
  return `${base}-${taken.length + 1}`;
}

export function whereToAsk(
  workflow: { trigger?: Trigger; steps: Step[] },
  index: number,
): { id: string; kind: "agent" | "room" } | null {
  const step = workflow.steps[index];
  if (step?.targetId) return { id: step.targetId, kind: "agent" };
  for (let i = index - 1; i >= 0; i--) {
    const earlier = workflow.steps[i];
    if (!earlier.targetId) continue;
    return { id: earlier.targetId, kind: earlier.action === "post" ? "room" : "agent" };
  }
  const trigger = workflow.trigger;
  if (trigger?.targetId) return { id: trigger.targetId, kind: trigger.targetKind ?? "agent" };
  return null;
}

export function problems(input: { name?: string; trigger?: Trigger; steps?: Step[] }): string[] {
  const found: string[] = [];
  const trigger = input.trigger;
  if (!trigger) {
    found.push("pick something that sets this off");
  } else if (!TRIGGERS.includes(trigger.kind)) {
    found.push(`there is no "${trigger.kind}" trigger. The ones there are: ${TRIGGERS.join(", ")}`);
  } else if ((trigger.kind === "message" || trigger.kind === "reaction") && !trigger.targetId) {
    found.push(`a ${trigger.kind} trigger needs somewhere to watch`);
  } else if (trigger.kind === "reaction" && !trigger.emoji) {
    found.push("a reaction trigger needs an emoji");
  }

  const steps = input.steps ?? [];
  if (!steps.length) found.push("a workflow needs at least one step");
  if (steps.length > MAX_STEPS) found.push(`a workflow holds at most ${MAX_STEPS} steps`);

  const seen: string[] = [];
  steps.forEach((step, index) => {
    const where = `step ${index + 1}`;
    if (!step.id) found.push(`${where} has no name`);
    else if (seen.includes(step.id)) found.push(`two steps are both called "${step.id}"`);
    if (!ACTIONS.includes(step.action)) found.push(`${where} does not say what to do`);
    if (!String(step.text ?? "").trim()) found.push(`${where} has nothing to say`);
    if ((step.action === "ask" || step.action === "post") && !step.targetId) {
      found.push(step.action === "ask" ? `${where} does not say who to ask` : `${where} does not say which room`);
    }
    if (step.action === "approve" && !whereToAsk({ trigger: input.trigger, steps }, index)) {
      found.push(`${where} has nowhere to put its question: name an agent on it`);
    }
    if (step.when && !OPS.includes(step.when.op)) found.push(`${where} has a condition nobody can check`);

    const references = [
      ...referencesIn(step.text ?? ""),
      ...referencesIn(step.when?.left ?? ""),
      ...referencesIn(step.when?.right ?? ""),
    ];
    for (const reference of references) {
      const parts = reference.split(".");
      if (parts[0] === "trigger") continue;
      if (parts[0] !== "steps" || parts.length !== 3) {
        found.push(`${where} mentions {{${reference}}}, which is not a thing a step can read`);
        continue;
      }
      if (parts[1] === step.id) {
        found.push(`${where} reads its own answer, which does not exist yet`);
      } else if (!seen.includes(parts[1])) {
        found.push(`${where} reads "${parts[1]}", which has not run by then`);
      }
    }
    if (step.id) seen.push(step.id);
  });
  return found;
}

export function clean(raw: unknown): Omit<Workflow, "id" | "createdAt"> | null {
  if (typeof raw !== "object" || raw === null) return null;
  const v = raw as Record<string, unknown>;
  const rawTrigger = (typeof v.trigger === "object" && v.trigger !== null ? v.trigger : {}) as Record<string, unknown>;
  const named = rawTrigger.kind;
  const kind = (
    named === undefined || named === null || named === ""
      ? "manual"
      : TRIGGERS.includes(named as TriggerKind)
        ? named
        : String(named)
  ) as TriggerKind;
  const trigger: Trigger = { kind };
  if (typeof rawTrigger.targetId === "string" && /^[\w-]{1,64}$/.test(rawTrigger.targetId)) {
    trigger.targetId = rawTrigger.targetId;
  }
  if (rawTrigger.targetKind === "agent" || rawTrigger.targetKind === "room") {
    trigger.targetKind = rawTrigger.targetKind;
  }
  if (typeof rawTrigger.contains === "string" && rawTrigger.contains.trim()) {
    trigger.contains = rawTrigger.contains.trim().slice(0, 120);
  }
  if (typeof rawTrigger.emoji === "string" && rawTrigger.emoji.trim()) {
    trigger.emoji = [...rawTrigger.emoji.trim()].slice(0, 4).join("");
  }
  trigger.from = rawTrigger.from === "anyone" ? "anyone" : "user";

  const takenIds: string[] = [];
  const steps: Step[] = (Array.isArray(v.steps) ? v.steps : [])
    .slice(0, MAX_STEPS)
    .map((entry) => {
      const s = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
      const action = ACTIONS.includes(s.action as StepAction) ? (s.action as StepAction) : "ask";
      const text = String(s.text ?? "").slice(0, MAX_STEP_TEXT);
      const wanted = typeof s.id === "string" && s.id.trim() ? s.id : text || action;
      const id = slug(wanted, takenIds);
      takenIds.push(id);
      const step: Step = { id, action, text };
      if (typeof s.targetId === "string" && /^[\w-]{1,64}$/.test(s.targetId)) step.targetId = s.targetId;
      const rawWhen = (typeof s.when === "object" && s.when !== null ? s.when : null) as Record<string, unknown> | null;
      if (rawWhen && OPS.includes(rawWhen.op as ConditionOp)) {
        step.when = {
          left: String(rawWhen.left ?? "").slice(0, MAX_STEP_TEXT),
          op: rawWhen.op as ConditionOp,
          right: String(rawWhen.right ?? "").slice(0, MAX_STEP_TEXT),
        };
      }
      if (action === "approve") {
        const asked = Number(s.timeoutMin);
        step.timeoutMin = Number.isFinite(asked)
          ? Math.max(1, Math.min(MAX_TIMEOUT_MIN, Math.round(asked)))
          : DEFAULT_TIMEOUT_MIN;
        step.onTimeout = s.onTimeout === "continue" ? "continue" : "stop";
      }
      return step;
    });

  return {
    name: String(v.name ?? "").trim().slice(0, MAX_NAME) || "Untitled workflow",
    trigger,
    steps,
    enabled: v.enabled !== false,
  };
}

export type NextMove =
  | { kind: "done" }
  | { kind: "step"; step: Step; index: number }
  | { kind: "skip"; step: Step; index: number };

export function nextMove(workflow: Pick<Workflow, "steps">, run: WorkflowRun): NextMove {
  const index = run.cursor;
  const step = workflow.steps[index];
  if (!step) return { kind: "done" };
  return holds(step.when, scopeOf(run)) ? { kind: "step", step, index } : { kind: "skip", step, index };
}

export function settled(run: WorkflowRun): boolean {
  return run.state === "done" || run.state === "failed" || run.state === "stopped";
}

export function waitUntil(step: Step, now: number): number {
  const minutes = Math.max(1, Math.min(MAX_TIMEOUT_MIN, step.timeoutMin ?? DEFAULT_TIMEOUT_MIN));
  return now + minutes * 60_000;
}

export function timedOut(runs: WorkflowRun[], now: number): WorkflowRun[] {
  return runs.filter((run) => run.state === "waiting" && run.waiting && run.waiting.until <= now);
}

export function firesOn(
  trigger: Trigger,
  event: { kind: "message" | "reaction"; targetId: string; text?: string; emoji?: string; fromUser: boolean },
): boolean {
  if (trigger.kind !== event.kind) return false;
  if (!trigger.targetId || trigger.targetId !== event.targetId) return false;
  if (trigger.from !== "anyone" && !event.fromUser) return false;
  if (event.kind === "reaction") return Boolean(trigger.emoji) && trigger.emoji === event.emoji;
  if (!trigger.contains) return true;
  return (event.text ?? "").toLowerCase().includes(trigger.contains.toLowerCase());
}

export function describe(workflow: Workflow): string {
  const when =
    workflow.trigger.kind === "manual"
      ? "When you run it"
      : workflow.trigger.kind === "webhook"
        ? "When its webhook fires"
        : workflow.trigger.kind === "reaction"
          ? `When someone reacts ${workflow.trigger.emoji ?? ""}`.trim()
          : workflow.trigger.contains
            ? `When a message mentions "${workflow.trigger.contains}"`
            : "When a message lands";
  const count = workflow.steps.length;
  const gates = workflow.steps.filter((s) => s.action === "approve").length;
  const body = `${count} ${count === 1 ? "step" : "steps"}`;
  return gates ? `${when}, ${body}, ${gates === 1 ? "one waits for you" : `${gates} wait for you`}` : `${when}, ${body}`;
}

const WORKFLOWS_FILE = join(DATA_DIR, "workflows.json");

export class WorkflowStore {
  workflows: Workflow[] = [];

  constructor() {
    try {
      const parsed = JSON.parse(readFileSync(WORKFLOWS_FILE, "utf8"));
      if (Array.isArray(parsed)) {
        this.workflows = parsed.filter((w) => w?.id && typeof w.name === "string" && Array.isArray(w.steps));
      }
    } catch {
    }
  }

  private save() {
    try {
      mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
      writeFileSync(WORKFLOWS_FILE, JSON.stringify(this.workflows, null, 2), { mode: 0o600 });
    } catch {
    }
  }

  list(): Workflow[] {
    return [...this.workflows].sort((a, b) => (b.lastRunAt ?? b.createdAt) - (a.lastRunAt ?? a.createdAt));
  }

  get(id: string): Workflow | null {
    return this.workflows.find((w) => w.id === id) ?? null;
  }

  create(input: Omit<Workflow, "id" | "createdAt">, now: number): Workflow | null {
    if (this.workflows.length >= MAX_WORKFLOWS) return null;
    const workflow: Workflow = { ...input, id: newId(), createdAt: now };
    this.workflows.unshift(workflow);
    this.save();
    return workflow;
  }

  patch(id: string, input: Partial<Omit<Workflow, "id" | "createdAt">>): Workflow | null {
    const workflow = this.get(id);
    if (!workflow) return null;
    Object.assign(workflow, input);
    this.save();
    return workflow;
  }

  remove(id: string): boolean {
    const before = this.workflows.length;
    this.workflows = this.workflows.filter((w) => w.id !== id);
    if (this.workflows.length === before) return false;
    this.save();
    return true;
  }

  watching(targetId: string): Workflow[] {
    return this.workflows.filter((w) => w.enabled && w.trigger.targetId === targetId);
  }

  begin(workflowId: string, trigger: Record<string, string>, now: number): WorkflowRun | null {
    const workflow = this.get(workflowId);
    if (!workflow) return null;
    const run: WorkflowRun = {
      id: newId(),
      workflowId,
      startedAt: now,
      state: "running",
      cursor: 0,
      trigger,
      values: {},
      steps: [],
    };
    workflow.runs = [run, ...(workflow.runs ?? [])].slice(0, MAX_RUNS);
    workflow.lastRunAt = now;
    this.save();
    return run;
  }

  run(runId: string): { workflow: Workflow; run: WorkflowRun } | null {
    for (const workflow of this.workflows) {
      const run = workflow.runs?.find((r) => r.id === runId);
      if (run) return { workflow, run };
    }
    return null;
  }

  waiting(): WorkflowRun[] {
    return this.workflows.flatMap((w) => (w.runs ?? []).filter((r) => r.state === "waiting"));
  }

  runAwaiting(threadId: string, messageId: string): { workflow: Workflow; run: WorkflowRun } | null {
    for (const workflow of this.workflows) {
      const run = (workflow.runs ?? []).find(
        (r) => r.state === "waiting" && r.waiting?.threadId === threadId && r.waiting?.messageId === messageId,
      );
      if (run) return { workflow, run };
    }
    return null;
  }

  update(runId: string, change: (run: WorkflowRun) => void): WorkflowRun | null {
    const found = this.run(runId);
    if (!found) return null;
    change(found.run);
    this.save();
    return found.run;
  }

  settleOrphanRuns(now: number): number {
    let settled = 0;
    for (const workflow of this.workflows) {
      for (const run of workflow.runs ?? []) {
        if (run.state !== "running") continue;
        run.state = "failed";
        run.endedAt = now;
        run.error = "Workmates stopped while this was running.";
        for (const step of run.steps) {
          if (step.state === "running") {
            step.state = "failed";
            step.endedAt = now;
          }
        }
        settled++;
      }
    }
    if (settled) this.save();
    return settled;
  }

  removeTarget(targetId: string) {
    let touched = false;
    for (const workflow of this.workflows) {
      if (workflow.trigger.targetId === targetId) {
        workflow.enabled = false;
        delete workflow.trigger.targetId;
        touched = true;
      }
      for (const step of workflow.steps) {
        if (step.targetId === targetId) {
          delete step.targetId;
          workflow.enabled = false;
          touched = true;
        }
      }
    }
    if (touched) this.save();
  }
}

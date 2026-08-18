import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { DATA_DIR } from "../core/config.ts";
import { newId } from "../core/contracts.ts";

export type Effect = "allow" | "deny";

export type Field = "tool" | "command" | "path" | "url" | "agent";

export type Op = "contains" | "not-contains" | "equals" | "starts-with" | "ends-with";

export const FIELDS: Field[] = ["tool", "command", "path", "url", "agent"];
export const OPS: Op[] = ["contains", "not-contains", "equals", "starts-with", "ends-with"];

export interface Rule {
  id: string;
  effect: Effect;
  field: Field;
  op: Op;
  value: string;
  botId?: string;
  enabled: boolean;
  createdAt: number;
}

export interface Ask {
  tool: string;
  command?: string;
  path?: string;
  url?: string;
  botId: string;
  agent: string;
}

export type Decision =
  | { verdict: "allow"; rule: Rule; because: string }
  | { verdict: "deny"; rule: Rule; because: string }
  | { verdict: "ask"; because: string };

export const MAX_RULES = 100;
export const MAX_VALUE = 200;

export function targetOf(tool: string, input: Record<string, unknown>, who: { botId: string; agent: string }): Ask {
  const text = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim() ? value : undefined;
  const first = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const found = text(input?.[key]);
      if (found) return found;
    }
    return undefined;
  };
  return {
    tool: (tool ?? "").trim() || "tool",
    command: first("command", "cmd", "script"),
    path: first("file_path", "path", "filePath", "notebook_path", "target_file"),
    url: first("url", "uri"),
    botId: who.botId,
    agent: who.agent,
  };
}

function valueOf(field: Field, ask: Ask): string | undefined {
  switch (field) {
    case "tool":
      return ask.tool;
    case "command":
      return ask.command;
    case "path":
      return ask.path;
    case "url":
      return ask.url;
    case "agent":
      return ask.agent;
    default:
      return undefined;
  }
}

export function applies(rule: Rule, ask: Ask): boolean | "unknown" {
  if (!FIELDS.includes(rule.field)) return "unknown";
  if (!OPS.includes(rule.op)) return "unknown";
  if (rule.botId && rule.botId !== ask.botId) return false;

  const found = valueOf(rule.field, ask);
  if (found === undefined) return false;

  const left = found.toLowerCase();
  const right = (rule.value ?? "").trim().toLowerCase();
  switch (rule.op) {
    case "contains":
      return Boolean(right) && left.includes(right);
    case "not-contains":
      return Boolean(right) && !left.includes(right);
    case "equals":
      return left === right;
    case "starts-with":
      return Boolean(right) && left.startsWith(right);
    case "ends-with":
      return Boolean(right) && left.endsWith(right);
    default:
      return "unknown";
  }
}

export function describe(rule: Rule): string {
  const op = rule.op.replace(/-/g, " ");
  return `${rule.effect} when ${rule.field} ${op} "${rule.value}"`;
}

export function decide(rules: Rule[], ask: Ask): Decision {
  const live = rules.filter((rule) => rule.enabled);
  const denies = live.filter((rule) => rule.effect === "deny");
  const allows = live.filter((rule) => rule.effect === "allow");

  for (const rule of denies) {
    const hit = applies(rule, ask);
    if (hit === true || hit === "unknown") {
      return {
        verdict: "deny",
        rule,
        because: hit === "unknown" ? `${describe(rule)}, which this version cannot check` : describe(rule),
      };
    }
  }
  for (const rule of allows) {
    if (applies(rule, ask) === true) {
      return { verdict: "allow", rule, because: describe(rule) };
    }
  }
  return { verdict: "ask", because: "no rule covers this" };
}

export function refusal(decision: Extract<Decision, { verdict: "deny" }>): string {
  return `Workmates: a rule in this workspace refuses this (${decision.because}). Do not try another way round it; carry on with what you can do without it, and say what you could not do.`;
}

export interface NewRule {
  effect?: unknown;
  field?: unknown;
  op?: unknown;
  value?: unknown;
  botId?: unknown;
  enabled?: unknown;
}

export function cleanRule(input: NewRule): { rule: Omit<Rule, "id" | "createdAt"> } | { error: string } {
  const effect = input.effect === "deny" ? "deny" : input.effect === "allow" ? "allow" : null;
  if (!effect) return { error: "a rule has to allow or deny" };
  if (!FIELDS.includes(input.field as Field)) return { error: "a rule has to be about something we can look at" };
  if (!OPS.includes(input.op as Op)) return { error: "a rule has to compare in a way we can check" };
  const value = String(input.value ?? "").trim().slice(0, MAX_VALUE);
  if (!value) return { error: "a rule needs something to compare against" };
  const botId =
    typeof input.botId === "string" && /^[\w-]{1,64}$/.test(input.botId) ? input.botId : undefined;
  return {
    rule: {
      effect,
      field: input.field as Field,
      op: input.op as Op,
      value,
      ...(botId ? { botId } : {}),
      enabled: input.enabled !== false,
    },
  };
}

export interface Hold {
  botId: string;
  since: number;
  why: string;
  turnedAway: number;
}

export class Wheel {
  private held = new Map<string, Hold>();

  take(botId: string, why: string, now: number): Hold {
    const hold: Hold = {
      botId,
      since: now,
      why: why.trim().slice(0, 200) || "you are using it",
      turnedAway: 0,
    };
    this.held.set(botId, hold);
    return hold;
  }

  noteTurnedAway(botId: string): void {
    const hold = this.held.get(botId);
    if (hold) hold.turnedAway += 1;
  }

  release(botId: string): Hold | null {
    const hold = this.held.get(botId) ?? null;
    this.held.delete(botId);
    return hold;
  }

  heldBy(botId: string): Hold | null {
    return this.held.get(botId) ?? null;
  }

  all(): Hold[] {
    return [...this.held.values()].sort((a, b) => a.since - b.since);
  }
}

export function pausedMessage(hold: Hold): string {
  return `Workmates: somebody has taken over this computer (${hold.why}). Do not do this another way and do not retry: stop here, say what you were about to do, and wait to be asked again.`;
}

export function heldRefusal(hold: Hold, botName: string): string {
  return `You have ${botName}'s computer (${hold.why}). Hand the wheel back to let it work.`;
}

const RULES_FILE = join(DATA_DIR, "rules.json");

export class PolicyStore {
  rules: Rule[] = [];

  constructor(file: string = RULES_FILE) {
    this.file = file;
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8"));
      if (Array.isArray(parsed)) {
        this.rules = parsed.filter((r) => r?.id && typeof r.value === "string");
      }
    } catch {
    }
  }

  private readonly file: string;

  private save() {
    try {
      mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
      writeFileSync(this.file, JSON.stringify(this.rules, null, 2), { mode: 0o600 });
    } catch {
    }
  }

  list(): Rule[] {
    return [...this.rules].sort(
      (a, b) => (a.effect === b.effect ? a.createdAt - b.createdAt : a.effect === "deny" ? -1 : 1),
    );
  }

  add(rule: Omit<Rule, "id" | "createdAt">, now: number): Rule | null {
    if (this.rules.length >= MAX_RULES) return null;
    const made: Rule = { ...rule, id: newId(), createdAt: now };
    this.rules.push(made);
    this.save();
    return made;
  }

  setEnabled(id: string, enabled: boolean): Rule | null {
    const rule = this.rules.find((r) => r.id === id);
    if (!rule) return null;
    rule.enabled = enabled;
    this.save();
    return rule;
  }

  remove(id: string): boolean {
    const before = this.rules.length;
    this.rules = this.rules.filter((r) => r.id !== id);
    if (this.rules.length === before) return false;
    this.save();
    return true;
  }

  removeForBot(botId: string) {
    const before = this.rules.length;
    this.rules = this.rules.filter((r) => r.botId !== botId);
    if (this.rules.length !== before) this.save();
  }
}

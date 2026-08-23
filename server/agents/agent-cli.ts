import { randomBytes } from "node:crypto";

export interface AgentToken {
  token: string;
  botId: string;
  taskId: string;
  expiresAt: number;
  spent: number;
}

export const TOKEN_TTL_MS = 60 * 60 * 1000;

export const TURN_BUDGET = 12;

export interface Rule {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  why: string;
}

export const RULES: Rule[] = [
  { method: "GET", path: "/api/agent/whoami", why: "find out who this credential says you are" },

  { method: "GET", path: "/api/bots", why: "see who else is in the workspace" },
  { method: "GET", path: "/api/rooms", why: "see which rooms exist" },

  { method: "POST", path: "/api/bots/:id/messages", why: "say something to another agent" },
  { method: "POST", path: "/api/rooms/:room/messages", why: "say something in a room it is in" },

  { method: "POST", path: "/api/bots", why: "hire a teammate" },
  { method: "POST", path: "/api/rooms", why: "open a room" },
  { method: "PATCH", path: "/api/rooms/:room", why: "change a room it is in" },

  { method: "GET", path: "/api/routines", why: "see what is scheduled" },
  { method: "POST", path: "/api/routines", why: "file a routine" },
  { method: "PATCH", path: "/api/routines/:id", why: "change a routine" },
  { method: "DELETE", path: "/api/routines/:id", why: "drop a routine" },
  { method: "GET", path: "/api/jobs", why: "read the job board" },
  { method: "POST", path: "/api/jobs", why: "post work to the board" },

  { method: "GET", path: "/api/bots/:me/memory", why: "read its own memory" },
  { method: "PUT", path: "/api/bots/:me/memory", why: "write its own memory" },
  { method: "GET", path: "/api/bots/:me/artifacts", why: "list what it has produced" },

  { method: "GET", path: "/api/skills", why: "see the skill library" },
  { method: "GET", path: "/api/skills/:id", why: "read one of its skills in full" },

  { method: "POST", path: "/api/bots/:me/show", why: "answer with a chart, a table or another component" },
  { method: "PATCH", path: "/api/bots/:me", why: "change its own settings" },
];

export const NEVER = [
  "/api/config",
  "/api/providers",
  "/api/custom-endpoints",
  "/api/instances",
  "/api/pair",
  "/api/mcp-servers",
  "/api/ledger",
  "/api/relay",
  "/api/calls",
  "/api/terminal",
  "/api/usage",
];

const PATH_PART = /^[\w.-]+$/;

export type InRoom = (roomId: string) => boolean;

const NO_ROOMS: InRoom = () => false;

export function matches(pattern: string, path: string, botId: string, inRoom: InRoom = NO_ROOMS): boolean {
  const want = pattern.split("/");
  const got = path.split("/");
  if (want.length !== got.length) return false;
  for (let i = 0; i < want.length; i++) {
    if (want[i] === ":me") {
      if (got[i] !== botId) return false;
      continue;
    }
    if (want[i] === ":room") {
      if (!PATH_PART.test(got[i] ?? "") || !inRoom(got[i])) return false;
      continue;
    }
    if (want[i] === ":id") {
      if (!PATH_PART.test(got[i] ?? "")) return false;
      continue;
    }
    if (want[i] !== got[i]) return false;
  }
  return true;
}

function shapeMatches(pattern: string, path: string, botId: string): boolean {
  return matches(pattern.replace(/:room/g, ":id"), path, botId);
}

export interface Decision {
  ok: boolean;
  reason?: string;
}

export function allows(botId: string, method: string, path: string, inRoom: InRoom = NO_ROOMS): Decision {
  const clean = path.split("?")[0].replace(/\/+$/, "") || "/";
  for (const prefix of NEVER) {
    if (clean === prefix || clean.startsWith(`${prefix}/`)) {
      return { ok: false, reason: `${prefix} is not something an agent can reach` };
    }
  }
  const verb = method.toUpperCase();
  for (const rule of RULES) {
    if (rule.method === verb && matches(rule.path, clean, botId, inRoom)) return { ok: true };
  }
  const roomRule = RULES.find(
    (rule) => rule.path.includes(":room") && rule.method === verb && shapeMatches(rule.path, clean, botId),
  );
  if (roomRule) {
    return { ok: false, reason: "an agent can only speak in and change the rooms it is in" };
  }
  const otherVerb = RULES.find((rule) => shapeMatches(rule.path, clean, botId));
  if (otherVerb) {
    const verbs = RULES.filter((rule) => shapeMatches(rule.path, clean, botId)).map((r) => r.method);
    return { ok: false, reason: `${clean} allows ${verbs.join(", ")} for an agent, not ${verb}` };
  }
  if (/^\/api\/bots\/[\w-]+\/(memory|artifacts)$/.test(clean)) {
    return { ok: false, reason: "an agent can only read and write its own memory and files" };
  }
  return { ok: false, reason: `${verb} ${clean} is not on the list of things an agent can do` };
}

export function capabilities(): string[] {
  return RULES.map((rule) => rule.why);
}

export const CLI_DRIVERS = new Set(["claudeAgent", "codex", "antigravity", "opencode", "grokCli", "pi"]);

export function runsAProcess(driverKind: string): boolean {
  return CLI_DRIVERS.has(driverKind);
}

export class AgentTokens {
  private byToken = new Map<string, AgentToken>();

  mint(botId: string, taskId: string, now: number): AgentToken {
    const minted: AgentToken = {
      token: `wm_${randomBytes(24).toString("base64url")}`,
      botId,
      taskId,
      expiresAt: now + TOKEN_TTL_MS,
      spent: 0,
    };
    this.byToken.set(minted.token, minted);
    return minted;
  }

  identify(token: string | null | undefined, now: number): AgentToken | null {
    if (!token) return null;
    const found = this.byToken.get(token);
    if (!found) return null;
    if (found.expiresAt <= now) {
      this.byToken.delete(token);
      return null;
    }
    return found;
  }

  revokeTask(taskId: string) {
    for (const [token, held] of this.byToken) {
      if (held.taskId === taskId) this.byToken.delete(token);
    }
  }

  spend(token: AgentToken): boolean {
    if (token.spent >= TURN_BUDGET) return false;
    token.spent++;
    return true;
  }

  revokeBot(botId: string) {
    for (const [token, held] of this.byToken) {
      if (held.botId === botId) this.byToken.delete(token);
    }
  }

  sweep(now: number) {
    for (const [token, held] of this.byToken) {
      if (held.expiresAt <= now) this.byToken.delete(token);
    }
  }

  get size(): number {
    return this.byToken.size;
  }
}

export function cliBriefing(command: string): string {
  return [
    `You can act on this workspace yourself, not only describe what should happen. Run \`${command} help\` to see how.`,
    "Use it when you have decided something needs doing: hiring a teammate, opening a room, filing a routine, posting a job, saying something to another agent.",
    "It answers JSON. Your credential is already in the environment and only lasts this turn.",
  ].join(" ");
}

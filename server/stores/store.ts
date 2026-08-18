import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { DATA_DIR } from "../core/config.ts";
import { newId, type ModelSelection, type ThreadId } from "../core/contracts.ts";

export type MateColor =
  | "green"
  | "blue"
  | "red"
  | "orange"
  | "purple"
  | "cyan"
  | "pink"
  | "yellow"
  | "teal"
  | "coral";

export type MateShape =
  | "star"
  | "burst"
  | "diamond"
  | "bit"
  | "triangle"
  | "cloud"
  | "drop"
  | "invader";

export type MateExpression =
  | "deadpan"
  | "friendly"
  | "focused"
  | "thinking"
  | "excited"
  | "sleepy"
  | "surprised"
  | "skeptical"
  | "worried"
  | "mischievous";

export interface OptionCardData {
  title: string;
  subtitle: string;
  options: string[];
  answered?: string;
  dismissed?: boolean;
  requestId?: string;
  tool?: string;
  runId?: string;
  team?: {
    room: string;
    brief: string;
    members: Array<{ name: string; title: string; description: string; skills: string[] }>;
  };
}

export interface Message {
  decisionChoice?: number;
  id: string;
  role: "bot" | "user";
  from?: string;
  kind:
    | "text"
    | "options"
    | "activity"
    | "screen"
    | "notice"
    | "artifact"
    | "connector"
    | "secret"
    | "component";
  text?: string;
  card?: OptionCardData;
  component?: Record<string, unknown>;
  tool?: { name: string; ok?: boolean };
  png?: string;
  mime?: string;
  replyTo?: { id?: string; author: string; excerpt: string };
  artifact?: { name: string; mime: string; size: number };
  queued?: boolean;
  editedAt?: number;
  deleted?: boolean;
  reactions?: Record<string, string[]>;
  secret?: {
    envName: string;
    label: string;
    hint?: string;
    status: "needs-value" | "saved" | "dismissed";
    resumeKey?: string;
    resumed?: boolean;
  };
  connector?: {
    slug: string;
    label: string;
    status: "needs-auth" | "authorizing" | "connected" | "failed" | "dismissed";
    authUrl?: string;
    resumeKey?: string;
    resumed?: boolean;
    error?: string;
  };
  at: number;
}

export interface TaskRecord {
  lastInstanceId?: string;
  id: ThreadId;
  title: string;
  busy?: boolean;
  cwd?: string | null;
  usage?: { input: number; output: number; turns: number };
  context?: {
    summary: string;
    through: number;
    at: number;
    microFrom?: number;
  };
  lastInput?: number;
  resumeCursors: Record<string, unknown>;
  createdAt: number;
}

export const MAX_TASKS = 3;

export interface BotRecord {
  id: string;
  threadId: ThreadId;
  name: string;
  title: string;
  description: string;
  notifications: boolean;
  color: MateColor;
  shape?: MateShape;
  skills?: string[];
  skillIds?: string[];
  seniority?: number;
  effort?: "low" | "medium" | "high";
  mascotExpression?: MateExpression | null;
  avatarAt?: number | null;
  unread: boolean;
  modelSelection: ModelSelection;
  resumeCursors: Record<string, unknown>;
  computer?: "cloud" | "sandbox" | "local" | "off" | null;
  cwd?: string | null;
  composio?: boolean;
  browser?: boolean;
  mcpServers?: string[];
  voice?: { provider: "elevenlabs" | "openai"; id: string; name?: string } | null;
  speakReplies?: boolean;
  withoutComponents?: string[];
  pinned?: boolean;
  hidden?: boolean;
  section?: string | null;
  approvals?: "ask" | "edits" | "auto";
  archivedAt?: number;
  busy?: boolean;
  tasks: TaskRecord[];
  activeTaskId: ThreadId;
  createdAt: number;
}

const BOTS_FILE = join(DATA_DIR, "bots.json");
const messagesFile = (threadId: string) => join(DATA_DIR, `messages-${threadId}.json`);

const COLORS: MateColor[] = [
  "green",
  "blue",
  "red",
  "orange",
  "purple",
  "cyan",
  "pink",
  "yellow",
  "teal",
  "coral",
];

const SHAPES: MateShape[] = [
  "star",
  "burst",
  "diamond",
  "bit",
  "triangle",
  "cloud",
  "drop",
  "invader",
];

export interface NewBotProfile {
  name?: string;
  title?: string;
  description?: string;
  color?: MateColor;
  shape?: MateShape;
  skills?: string[];
  skillIds?: string[];
  seniority?: number;
  greeting?: string;
  setup?: { title: string; subtitle: string; options: string[] };
}

const DEFAULT_GREETING = "I'm ready. Tell me what you need and I'll get to work.";

const DEFAULT_SETUP: OptionCardData = {
  title: "How should we work together?",
  subtitle: "This shapes how much I check in versus just handle things.",
  options: [
    "Check with me before acting",
    "Act on the small stuff, ask on the big",
    "Keep me posted, I trust you",
  ],
};

export class Store {
  bots: BotRecord[] = [];
  private messages = new Map<string, Message[]>();
  private defaultSelection: () => ModelSelection;

  constructor(defaultSelection: () => ModelSelection) {
    this.defaultSelection = defaultSelection;
    mkdirSync(DATA_DIR, { recursive: true });
    try {
      this.bots = JSON.parse(readFileSync(BOTS_FILE, "utf8"));
    } catch {
      this.bots = [];
    }
    for (const b of this.bots) {
      b.busy = false;
      if (!Array.isArray(b.tasks) || b.tasks.length === 0) {
        b.tasks = [
          {
            id: b.threadId,
            title: "General",
            resumeCursors: b.resumeCursors ?? {},
            createdAt: b.createdAt,
          },
        ];
        b.activeTaskId = b.threadId;
      }
      for (const t of b.tasks) t.busy = false;
      if (!b.activeTaskId || !b.tasks.some((t) => t.id === b.activeTaskId)) {
        b.activeTaskId = b.tasks[0].id;
        b.threadId = b.tasks[0].id;
      }
    }
  }

  private saveBots() {
    writeFileSync(BOTS_FILE, JSON.stringify(this.bots, null, 2));
  }

  messagesFor(threadId: string): Message[] {
    let list = this.messages.get(threadId);
    if (!list) {
      try {
        list = JSON.parse(readFileSync(messagesFile(threadId), "utf8"));
      } catch {
        list = [];
      }
      this.messages.set(threadId, list!);
    }
    return list!;
  }

  appendMessage(threadId: string, message: Omit<Message, "id" | "at"> & { at?: number }): Message {
    const full: Message = { id: newId(), at: Date.now(), ...message };
    const list = this.messagesFor(threadId);
    list.push(full);
    writeFileSync(messagesFile(threadId), JSON.stringify(list, null, 2));
    return full;
  }

  toggleReaction(
    threadId: string,
    messageId: string,
    emoji: string,
    who: string,
  ): { message: Message; added: boolean } | null {
    const message = this.messagesFor(threadId).find((m) => m.id === messageId);
    if (!message) return null;

    const reactions = { ...(message.reactions ?? {}) };
    const current = reactions[emoji] ?? [];
    const had = current.includes(who);
    const next = had ? current.filter((id) => id !== who) : [...current, who];

    if (next.length === 0) delete reactions[emoji];
    else reactions[emoji] = next;

    const patched = this.patchMessage(threadId, messageId, {
      reactions: Object.keys(reactions).length ? reactions : undefined,
    });
    return patched ? { message: patched, added: !had } : null;
  }

  patchMessage(threadId: string, messageId: string, patch: Partial<Message>): Message | null {
    const list = this.messagesFor(threadId);
    const idx = list.findIndex((m) => m.id === messageId);
    if (idx === -1) return null;
    const card = "card" in patch ? patch.card : list[idx].card;
    list[idx] = { ...list[idx], ...patch, card };
    writeFileSync(messagesFile(threadId), JSON.stringify(list, null, 2));
    return list[idx];
  }

  bot(id: string) {
    return this.bots.find((b) => b.id === id) ?? null;
  }

  botByThread(threadId: string) {
    return this.bots.find((b) => b.tasks.some((t) => t.id === threadId)) ?? null;
  }

  createBot(profile: NewBotProfile = {}): BotRecord {
    const bot: BotRecord = {
      id: newId(),
      threadId: newId(),
      name: profile.name?.trim() || "Assistant",
      title: profile.title ?? "",
      description: profile.description ?? "",
      notifications: true,
      color: profile.color ?? COLORS[this.bots.length % COLORS.length],
      shape: profile.shape ?? SHAPES[this.bots.length % SHAPES.length],
      ...(profile.skills?.length ? { skills: profile.skills } : {}),
      ...(profile.skillIds?.length ? { skillIds: profile.skillIds } : {}),
      ...(profile.seniority ? { seniority: profile.seniority } : {}),
      unread: false,
      modelSelection: this.defaultSelection(),
      resumeCursors: {},
      createdAt: Date.now(),
      tasks: [],
      activeTaskId: "",
    };
    bot.tasks = [{ id: bot.threadId, title: "General", resumeCursors: {}, createdAt: bot.createdAt }];
    bot.activeTaskId = bot.threadId;
    this.bots.unshift(bot);
    this.saveBots();
    this.appendMessage(bot.threadId, {
      role: "bot",
      kind: "text",
      text: profile.greeting?.trim() || DEFAULT_GREETING,
    });
    this.appendMessage(bot.threadId, {
      role: "bot",
      kind: "options",
      card: profile.setup ?? DEFAULT_SETUP,
    });
    return bot;
  }

  archiveBot(id: string, now: number): BotRecord | null {
    const bot = this.bot(id);
    if (!bot || bot.archivedAt) return null;
    bot.archivedAt = now;
    bot.hidden = true;
    this.saveBots();
    return bot;
  }

  restoreBot(id: string): BotRecord | null {
    const bot = this.bot(id);
    if (!bot || (!bot.archivedAt && !bot.hidden)) return null;
    delete bot.archivedAt;
    delete bot.hidden;
    this.saveBots();
    return bot;
  }

  deleteBot(id: string): boolean {
    const bot = this.bot(id);
    if (!bot) return false;
    this.bots = this.bots.filter((b) => b.id !== id);
    for (const task of bot.tasks) {
      this.messages.delete(task.id);
      try {
        unlinkSync(messagesFile(task.id));
      } catch {}
    }
    this.saveBots();
    return true;
  }

  patchBot(id: string, patch: Partial<BotRecord>): BotRecord | null {
    const bot = this.bot(id);
    if (!bot) return null;
    Object.assign(bot, patch);
    this.saveBots();
    return bot;
  }

  setResumeCursor(threadId: string, instanceId: string, cursor: unknown) {
    const found = this.taskByThread(threadId);
    if (!found) return;
    found.task.resumeCursors[instanceId] = cursor;
    this.saveBots();
  }

  taskByThread(threadId: string): { bot: BotRecord; task: TaskRecord } | null {
    for (const bot of this.bots) {
      const task = bot.tasks.find((t) => t.id === threadId);
      if (task) return { bot, task };
    }
    return null;
  }

  createTask(botId: string, title: string): TaskRecord | null {
    const bot = this.bot(botId);
    if (!bot || bot.tasks.length >= MAX_TASKS) return null;
    const task: TaskRecord = { id: newId(), title, resumeCursors: {}, createdAt: Date.now() };
    bot.tasks.push(task);
    this.setActiveTask(botId, task.id);
    return task;
  }

  setActiveTask(botId: string, taskId: string): boolean {
    const bot = this.bot(botId);
    const task = bot?.tasks.find((t) => t.id === taskId);
    if (!bot || !task) return false;
    bot.activeTaskId = task.id;
    bot.threadId = task.id;
    this.saveBots();
    return true;
  }

  deleteTask(botId: string, taskId: string): "ok" | "busy" | "last" | "missing" {
    const bot = this.bot(botId);
    const task = bot?.tasks.find((t) => t.id === taskId);
    if (!bot || !task) return "missing";
    if (task.busy) return "busy";
    if (bot.tasks.length <= 1) return "last";
    bot.tasks = bot.tasks.filter((t) => t.id !== taskId);
    this.messages.delete(task.id);
    try {
      unlinkSync(messagesFile(task.id));
    } catch {}
    if (bot.activeTaskId === task.id) {
      this.setActiveTask(botId, bot.tasks[0].id);
    } else {
      this.saveBots();
    }
    return "ok";
  }

  patchTaskTitle(botId: string, taskId: string, title: string) {
    const bot = this.bot(botId);
    const task = bot?.tasks.find((t) => t.id === taskId);
    if (!task || !title.trim()) return;
    task.title = title.trim();
    this.saveBots();
  }

  pinTaskCwd(threadId: string, cwd: string | null): string | null {
    const found = this.taskByThread(threadId);
    if (!found) return cwd;
    if (found.task.cwd === undefined) {
      found.task.cwd = cwd;
      this.saveBots();
    }
    return found.task.cwd;
  }

  addTaskUsage(threadId: string, input: number, output: number) {
    const found = this.taskByThread(threadId);
    if (!found) return;
    const safe = (n: number) => Math.max(0, Math.trunc(Number.isFinite(n) ? n : 0));
    const usage = found.task.usage ?? { input: 0, output: 0, turns: 0 };
    usage.input += safe(input);
    usage.output += safe(output);
    usage.turns += 1;
    found.task.usage = usage;
    found.task.lastInput = safe(input);
    this.saveBots();
  }

  setTaskContext(
    threadId: string,
    context: { summary: string; through: number; at: number; microFrom?: number } | null,
  ) {
    const found = this.taskByThread(threadId);
    if (!found) return;
    if (context) found.task.context = context;
    else delete found.task.context;
    this.saveBots();
  }

  markTaskDispatched(botId: string, taskId: string, instanceId: string): void {
    const bot = this.bot(botId);
    const task = bot?.tasks.find((t) => t.id === taskId);
    if (!task || task.lastInstanceId === instanceId) return;
    task.lastInstanceId = instanceId;
    this.saveBots();
  }

  setTaskBusy(threadId: string, busy: boolean): BotRecord | null {
    const found = this.taskByThread(threadId);
    if (!found) return null;
    found.task.busy = busy;
    found.bot.busy = found.bot.tasks.some((t) => t.busy);
    this.saveBots();
    return found.bot;
  }

  seedIfEmpty() {
    if (this.bots.length) return;
    this.createBot({
      name: "Nova",
      title: "Generalist",
      color: "blue",
      shape: "star",
      greeting:
        "I'm Nova, and I'll take anything you throw at me. Tell me what you need, or make more of us, each with its own job.",
    });
  }
}

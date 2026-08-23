import type { MateColor, MateExpression, MateShape } from "../stores/store.ts";

export const AGENT_FILE_KIND = "workmates.agent";
export const AGENT_FILE_VERSION = 1;

export const AGENT_FILE_EXTENSION = ".workmates-agent.json";

export const LIMITS = {
  file: 8 * 1024 * 1024,
  name: 80,
  title: 160,
  description: 4_000,
  capability: 400,
  capabilities: 12,
  memory: 256 * 1024,
  topics: 50,
  topicBytes: 256 * 1024,
  skills: 40,
  skillBytes: 16_000,
  avatar: 2 * 1024 * 1024,
} as const;

const COLORS = new Set<MateColor>([
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
]);

const SHAPES = new Set<MateShape>([
  "star",
  "burst",
  "diamond",
  "bit",
  "triangle",
  "cloud",
  "drop",
  "invader",
]);

const EXPRESSIONS = new Set<MateExpression>([
  "deadpan",
  "friendly",
  "focused",
  "thinking",
  "excited",
  "sleepy",
  "surprised",
  "skeptical",
  "worried",
  "mischievous",
]);

const TOPIC_NAME = /^[\w][\w .-]{0,120}\.md$/;

const AVATAR_MIME = /^image\/(jpeg|png|webp)$/;

export interface PortableAgent {
  name: string;
  title: string;
  description: string;
  color?: MateColor;
  shape?: MateShape;
  capabilities?: string[];
  seniority?: number;
  effort?: "low" | "medium" | "high";
  mascotExpression?: MateExpression | null;
  model?: { instanceId: string; model: string };
  voice?: { provider: "elevenlabs" | "openai"; id: string; name?: string };
}

export interface PortableSkill {
  id: string;
  name: string;
  description: string;
  body: string;
}

export interface PortableTopic {
  name: string;
  text: string;
}

export interface AgentFile {
  kind: typeof AGENT_FILE_KIND;
  version: number;
  exportedAt: number;
  app?: string;
  agent: PortableAgent;
  memory?: { text: string; topics: PortableTopic[] };
  skills?: PortableSkill[];
  avatar?: { mime: string; data: string };
}

export interface PackInput {
  bot: {
    name?: string;
    title?: string;
    description?: string;
    color?: MateColor;
    shape?: MateShape;
    skills?: string[];
    seniority?: number;
    effort?: "low" | "medium" | "high";
    mascotExpression?: MateExpression | null;
    modelSelection?: { instanceId: string; model: string };
    voice?: { provider: "elevenlabs" | "openai"; id: string; name?: string } | null;
  };
  memory?: string;
  topics?: PortableTopic[];
  skills?: PortableSkill[];
  avatar?: { mime: string; data: string } | null;
  exportedAt: number;
  app?: string;
}

function trim(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function bytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function clampBytes(text: string, max: number): string {
  if (bytes(text) <= max) return text;
  return Buffer.from(text, "utf8")
    .subarray(0, max)
    .toString("utf8")
    .replace(/�+$/, "");
}

export function packAgent(input: PackInput): AgentFile {
  const bot = input.bot;
  const agent: PortableAgent = {
    name: trim(bot.name, LIMITS.name) || "Agent",
    title: trim(bot.title, LIMITS.title),
    description: trim(bot.description, LIMITS.description),
  };
  if (bot.color && COLORS.has(bot.color)) agent.color = bot.color;
  if (bot.shape && SHAPES.has(bot.shape)) agent.shape = bot.shape;
  const capabilities = (bot.skills ?? [])
    .filter((s): s is string => typeof s === "string" && Boolean(s.trim()))
    .slice(0, LIMITS.capabilities)
    .map((s) => s.trim().slice(0, LIMITS.capability));
  if (capabilities.length) agent.capabilities = capabilities;
  if (typeof bot.seniority === "number" && Number.isFinite(bot.seniority)) {
    agent.seniority = Math.max(1, Math.min(5, Math.round(bot.seniority)));
  }
  if (bot.effort === "low" || bot.effort === "medium" || bot.effort === "high") {
    agent.effort = bot.effort;
  }
  if (bot.mascotExpression && EXPRESSIONS.has(bot.mascotExpression)) {
    agent.mascotExpression = bot.mascotExpression;
  }
  if (bot.modelSelection?.instanceId && bot.modelSelection.model) {
    agent.model = {
      instanceId: String(bot.modelSelection.instanceId).slice(0, 120),
      model: String(bot.modelSelection.model).slice(0, 200),
    };
  }
  if (bot.voice?.id && (bot.voice.provider === "elevenlabs" || bot.voice.provider === "openai")) {
    agent.voice = {
      provider: bot.voice.provider,
      id: String(bot.voice.id).slice(0, 120),
      ...(bot.voice.name ? { name: String(bot.voice.name).slice(0, 80) } : {}),
    };
  }

  const file: AgentFile = {
    kind: AGENT_FILE_KIND,
    version: AGENT_FILE_VERSION,
    exportedAt: input.exportedAt,
    agent,
  };
  if (input.app) file.app = input.app.slice(0, 40);

  const memoryText = clampBytes(typeof input.memory === "string" ? input.memory : "", LIMITS.memory);
  const topics = (input.topics ?? [])
    .filter((t) => TOPIC_NAME.test(t?.name ?? ""))
    .slice(0, LIMITS.topics)
    .map((t) => ({ name: t.name, text: clampBytes(String(t.text ?? ""), LIMITS.topicBytes) }));
  if (memoryText.trim() || topics.length) {
    file.memory = { text: memoryText, topics };
  }

  const skills = (input.skills ?? [])
    .filter((s) => s && typeof s.body === "string" && s.body.trim())
    .slice(0, LIMITS.skills)
    .map((s) => ({
      id: slug(s.id || s.name),
      name: trim(s.name, LIMITS.name) || slug(s.id || s.name),
      description: trim(s.description, 200),
      body: clampBytes(s.body.trim(), LIMITS.skillBytes),
    }));
  if (skills.length) file.skills = skills;

  if (input.avatar?.data && AVATAR_MIME.test(input.avatar.mime ?? "")) {
    if (Buffer.from(input.avatar.data, "base64").length <= LIMITS.avatar) {
      file.avatar = { mime: input.avatar.mime, data: input.avatar.data };
    }
  }

  return file;
}

export function slug(input: string): string {
  const out = String(input ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return out || "skill";
}

export function fileNameFor(name: string): string {
  return `${slug(name) || "agent"}${AGENT_FILE_EXTENSION}`;
}

export type ParseResult = { ok: true; file: AgentFile } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseAgentFile(value: unknown): ParseResult {
  if (!isRecord(value)) return { ok: false, error: "that is not an agent file" };
  if (value.kind !== AGENT_FILE_KIND) return { ok: false, error: "that is not an agent file" };
  const version = value.version;
  if (typeof version !== "number" || !Number.isFinite(version)) {
    return { ok: false, error: "that agent file has no version" };
  }
  if (version > AGENT_FILE_VERSION) {
    return { ok: false, error: "that agent was exported by a newer version of Workmates" };
  }

  const raw = value.agent;
  if (!isRecord(raw)) return { ok: false, error: "that agent file has no agent in it" };
  const name = trim(raw.name, LIMITS.name);
  if (!name) return { ok: false, error: "that agent has no name" };

  const agent: PortableAgent = {
    name,
    title: trim(raw.title, LIMITS.title),
    description: trim(raw.description, LIMITS.description),
  };
  if (typeof raw.color === "string" && COLORS.has(raw.color as MateColor)) {
    agent.color = raw.color as MateColor;
  }
  if (typeof raw.shape === "string" && SHAPES.has(raw.shape as MateShape)) {
    agent.shape = raw.shape as MateShape;
  }
  if (Array.isArray(raw.capabilities)) {
    const list = raw.capabilities
      .filter((s): s is string => typeof s === "string" && Boolean(s.trim()))
      .slice(0, LIMITS.capabilities)
      .map((s) => s.trim().slice(0, LIMITS.capability));
    if (list.length) agent.capabilities = list;
  }
  if (typeof raw.seniority === "number" && Number.isFinite(raw.seniority)) {
    agent.seniority = Math.max(1, Math.min(5, Math.round(raw.seniority)));
  }
  if (raw.effort === "low" || raw.effort === "medium" || raw.effort === "high") {
    agent.effort = raw.effort;
  }
  if (typeof raw.mascotExpression === "string" && EXPRESSIONS.has(raw.mascotExpression as MateExpression)) {
    agent.mascotExpression = raw.mascotExpression as MateExpression;
  }
  if (isRecord(raw.model) && typeof raw.model.instanceId === "string" && typeof raw.model.model === "string") {
    agent.model = {
      instanceId: raw.model.instanceId.slice(0, 120),
      model: raw.model.model.slice(0, 200),
    };
  }
  if (
    isRecord(raw.voice) &&
    (raw.voice.provider === "elevenlabs" || raw.voice.provider === "openai") &&
    typeof raw.voice.id === "string" &&
    raw.voice.id
  ) {
    agent.voice = {
      provider: raw.voice.provider,
      id: raw.voice.id.slice(0, 120),
      ...(typeof raw.voice.name === "string" ? { name: raw.voice.name.slice(0, 80) } : {}),
    };
  }

  const file: AgentFile = {
    kind: AGENT_FILE_KIND,
    version,
    exportedAt: typeof value.exportedAt === "number" ? value.exportedAt : 0,
    agent,
  };
  if (typeof value.app === "string") file.app = value.app.slice(0, 40);

  if (value.memory !== undefined) {
    if (!isRecord(value.memory)) return { ok: false, error: "that agent file's memory is malformed" };
    const text = typeof value.memory.text === "string" ? value.memory.text : "";
    if (bytes(text) > LIMITS.memory) return { ok: false, error: "that agent's memory is too large" };
    const rawTopics = Array.isArray(value.memory.topics) ? value.memory.topics : [];
    if (rawTopics.length > LIMITS.topics) {
      return { ok: false, error: "that agent carries too many memory files" };
    }
    const topics: PortableTopic[] = [];
    for (const entry of rawTopics) {
      if (!isRecord(entry) || typeof entry.name !== "string" || !TOPIC_NAME.test(entry.name)) {
        return { ok: false, error: "that agent file names a memory file we will not write" };
      }
      const body = typeof entry.text === "string" ? entry.text : "";
      if (bytes(body) > LIMITS.topicBytes) {
        return { ok: false, error: `that agent's ${entry.name} is too large` };
      }
      topics.push({ name: entry.name, text: body });
    }
    if (text || topics.length) file.memory = { text, topics };
  }

  if (value.skills !== undefined) {
    if (!Array.isArray(value.skills)) return { ok: false, error: "that agent file's skills are malformed" };
    if (value.skills.length > LIMITS.skills) {
      return { ok: false, error: "that agent carries too many skills" };
    }
    const skills: PortableSkill[] = [];
    for (const entry of value.skills) {
      if (!isRecord(entry)) return { ok: false, error: "that agent file's skills are malformed" };
      const body = typeof entry.body === "string" ? entry.body.trim() : "";
      if (!body) continue;
      if (bytes(body) > LIMITS.skillBytes) {
        return { ok: false, error: "one of that agent's skills is too large" };
      }
      const id = slug(typeof entry.id === "string" && entry.id ? entry.id : String(entry.name ?? ""));
      skills.push({
        id,
        name: trim(entry.name, LIMITS.name) || id,
        description: trim(entry.description, 200),
        body,
      });
    }
    if (skills.length) file.skills = skills;
  }

  if (value.avatar !== undefined) {
    if (!isRecord(value.avatar)) return { ok: false, error: "that agent file's picture is malformed" };
    const mime = typeof value.avatar.mime === "string" ? value.avatar.mime : "";
    const data = typeof value.avatar.data === "string" ? value.avatar.data : "";
    if (!AVATAR_MIME.test(mime)) return { ok: false, error: "that agent's picture is not an image" };
    const decoded = Buffer.from(data, "base64");
    if (!decoded.length) return { ok: false, error: "that agent's picture is empty" };
    if (decoded.length > LIMITS.avatar) return { ok: false, error: "that agent's picture is too large" };
    file.avatar = { mime, data };
  }

  return { ok: true, file };
}

export function parseAgentDocument(text: string): ParseResult {
  if (bytes(text) > LIMITS.file) return { ok: false, error: "that agent file is too large" };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: "that file is not an agent file" };
  }
  return parseAgentFile(value);
}

export interface PreviewContext {
  skillIds: string[];
  instanceIds: string[];
  voiceReady?: boolean;
}

export interface AgentPreview {
  name: string;
  title: string;
  description: string;
  color?: MateColor;
  shape?: MateShape;
  capabilities: string[];
  seniority?: number;
  skills: Array<{ id: string; name: string; description: string; alreadyHere: boolean }>;
  memoryBytes: number;
  topics: number;
  hasPhoto: boolean;
  exportedAt: number;
  notes: string[];
}

export function describeAgentFile(file: AgentFile, ctx: PreviewContext): AgentPreview {
  const known = new Set(ctx.skillIds);
  const skills = (file.skills ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    alreadyHere: known.has(s.id),
  }));

  const notes: string[] = [];
  const fresh = skills.filter((s) => !s.alreadyHere).length;
  if (fresh) {
    notes.push(
      fresh === 1
        ? "One skill will be added to your library."
        : `${fresh} skills will be added to your library.`,
    );
  }
  const clashes = skills.filter((s) => s.alreadyHere);
  if (clashes.length) {
    notes.push(
      clashes.length === 1
        ? `You already have a skill called ${clashes[0].name}. Yours is kept.`
        : `You already have ${clashes.length} of these skills. Yours are kept.`,
    );
  }
  if (file.agent.model && !ctx.instanceIds.includes(file.agent.model.instanceId)) {
    notes.push("It was running on an engine you have not set up. Yours will be used instead.");
  }
  if (file.agent.voice && ctx.voiceReady === false) {
    notes.push("It has a voice, which needs a speech key here before it can talk.");
  }
  const memoryBytes = bytes(file.memory?.text ?? "");
  if (memoryBytes || file.memory?.topics.length) {
    notes.push("Its memory comes with it, so it arrives knowing what it knew.");
  }
  notes.push("Its conversations stay behind. This is the agent, not the history.");

  return {
    name: file.agent.name,
    title: file.agent.title,
    description: file.agent.description,
    color: file.agent.color,
    shape: file.agent.shape,
    capabilities: file.agent.capabilities ?? [],
    seniority: file.agent.seniority,
    skills,
    memoryBytes,
    topics: file.memory?.topics.length ?? 0,
    hasPhoto: Boolean(file.avatar),
    exportedAt: file.exportedAt,
    notes,
  };
}

export function profileFromFile(file: AgentFile): {
  profile: {
    name: string;
    title: string;
    description: string;
    color?: MateColor;
    shape?: MateShape;
    skills?: string[];
    skillIds?: string[];
    seniority?: number;
  };
  patch: {
    effort?: "low" | "medium" | "high";
    mascotExpression?: MateExpression;
    voice?: { provider: "elevenlabs" | "openai"; id: string; name?: string };
  };
} {
  const a = file.agent;
  return {
    profile: {
      name: a.name,
      title: a.title,
      description: a.description,
      ...(a.color ? { color: a.color } : {}),
      ...(a.shape ? { shape: a.shape } : {}),
      ...(a.capabilities?.length ? { skills: a.capabilities } : {}),
      ...(file.skills?.length ? { skillIds: file.skills.map((s) => s.id) } : {}),
      ...(a.seniority ? { seniority: a.seniority } : {}),
    },
    patch: {
      ...(a.effort ? { effort: a.effort } : {}),
      ...(a.mascotExpression ? { mascotExpression: a.mascotExpression } : {}),
      ...(a.voice ? { voice: a.voice } : {}),
    },
  };
}

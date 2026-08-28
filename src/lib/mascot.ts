export const MATE_COLOR_NAMES = [
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
] as const;

export type MateColor = (typeof MATE_COLOR_NAMES)[number];

export const MATE_COLORS: Record<MateColor, string> = {
  green: "#3bc76b",
  blue: "#4c86f5",
  red: "#f04438",
  orange: "#ff9432",
  purple: "#a468f7",
  cyan: "#3fc3f0",
  pink: "#f972b6",
  yellow: "#ffd93b",
  teal: "#2ec9a9",
  coral: "#ff7a63",
};

export const MATE_SHAPES = [
  "star",
  "burst",
  "diamond",
  "bit",
  "triangle",
  "cloud",
  "drop",
  "invader",
] as const;

export type MateShape = (typeof MATE_SHAPES)[number];

export const MATE_EXPRESSIONS = [
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
] as const;

export type MateExpression = (typeof MATE_EXPRESSIONS)[number];

type MascotMessage = {
  kind: string;
  tool?: { ok?: boolean };
};

export type MascotBotProfile = {
  id?: string;
  name: string;
  title?: string;
  description?: string;
  shape?: MateShape | null;
  mascotExpression?: MateExpression | null;
  busy?: boolean;
  unread?: boolean;
  messages?: MascotMessage[];
};

export function shapeForBot(bot: MascotBotProfile): MateShape {
  if (bot.shape && MATE_SHAPES.includes(bot.shape)) return bot.shape;
  const key = bot.id ?? bot.name;
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return MATE_SHAPES[Math.abs(hash) % MATE_SHAPES.length];
}

export function expressionForBot(bot: MascotBotProfile): MateExpression {
  if (bot.mascotExpression) return bot.mascotExpression;

  const last = bot.messages?.[bot.messages.length - 1];

  if (last?.kind === "activity" && last.tool?.ok === false) return "worried";
  if (bot.busy) return "focused";
  if (bot.unread) return "surprised";
  if (last?.kind === "options") return "thinking";

  const profile = `${bot.name} ${bot.title ?? ""} ${bot.description ?? ""}`.toLowerCase();
  const matches = (words: RegExp) => words.test(profile);

  if (matches(/\b(code|coding|developer|development|engineer|engineering|build|debug|program|software)\b/)) {
    return "focused";
  }
  if (matches(/\b(research|researcher|search|investigate|strategy|strategist|study|learn|knowledge)\b/)) {
    return "thinking";
  }
  if (matches(/\b(marketing|growth|launch|campaign|social|sales|outreach|brand)\b/)) {
    return "excited";
  }
  if (matches(/\b(overnight|night|background|async|queue|batch|long-running)\b/)) {
    return "sleepy";
  }
  if (matches(/\b(monitor|monitoring|incident|alert|watch|status|uptime)\b/)) {
    return "surprised";
  }
  if (matches(/\b(review|reviewer|audit|critic|critique|quality|qa|test|legal)\b/)) {
    return "skeptical";
  }
  if (matches(/\b(security|secure|compliance|risk|privacy|finance|financial)\b/)) {
    return "worried";
  }
  if (matches(/\b(design|designer|creative|brainstorm|art|illustration|music|story)\b/)) {
    return "mischievous";
  }
  if (matches(/\b(support|help|success|onboarding|coach|teacher|guide|welcome)\b/)) {
    return "friendly";
  }

  return "deadpan";
}

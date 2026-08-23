const LIMITS: Array<[RegExp, number]> = [
  [/^claude-fable-5-1(?:$|-)/i, 1_000_000],
  [/^claude/i, 200_000],
  [/^gemini/i, 1_000_000],
  [/^grok/i, 131_072],
  [/^(gpt-4o|gpt-4\.1|o[134])/i, 128_000],
  [/^gpt-5/i, 400_000],
  [/^gpt-6-astra(?:$|-)/i, 272_000],
  [/^deepseek/i, 65_536],
  [/^kimi|^moonshot/i, 131_072],
  [/^llama/i, 131_072],
  [/^mistral|^magistral|^devstral/i, 131_072],
  [/^qwen/i, 131_072],
  [/^glm/i, 131_072],
];

export const DEFAULT_LIMIT = 32_000;

export function contextLimitFor(model: string | undefined | null): number {
  const name = (model ?? "").trim();
  for (const [pattern, limit] of LIMITS) {
    if (pattern.test(name)) return limit;
  }
  return DEFAULT_LIMIT;
}

export function estimateTokens(text: string): number {
  return Math.ceil((text ?? "").length / 4);
}

export interface Turn {
  role: "user" | "assistant";
  text: string;
}

export function transcriptTokens(turns: Turn[]): number {
  return turns.reduce((total, turn) => total + estimateTokens(turn.text) + 4, 0);
}

export interface Pressure {
  used: number;
  limit: number;
  fraction: number;
}

export function pressure(used: number, limit: number): Pressure {
  const safeLimit = limit > 0 ? limit : DEFAULT_LIMIT;
  const safeUsed = Math.max(0, used);
  return { used: safeUsed, limit: safeLimit, fraction: Math.min(1, safeUsed / safeLimit) };
}

export const COMPACT_AT = 0.8;

export function shouldCompact(used: number, limit: number, at: number = COMPACT_AT): boolean {
  if (used <= 0 || limit <= 0) return false;
  if (at <= 0 || at >= 1) return false;
  return used / limit > at;
}

export interface Plan {
  fold: Turn[];
  keep: Turn[];
}

export function planCompaction(turns: Turn[], budget: number, minKeep = 6): Plan {
  if (turns.length <= minKeep) return { fold: [], keep: turns };

  const keep: Turn[] = [];
  let used = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const cost = estimateTokens(turns[i].text) + 4;
    if (keep.length >= minKeep && used + cost > budget) break;
    keep.unshift(turns[i]);
    used += cost;
  }
  return { fold: turns.slice(0, turns.length - keep.length), keep };
}

export function summaryPrompt(existing: string | null, fold: Turn[]): string {
  const conversation = fold
    .map((turn) => `${turn.role === "user" ? "Them" : "You"}: ${turn.text}`)
    .join("\n\n")
    .slice(0, 40_000);
  return [
    existing
      ? "Here is a summary of a conversation so far, and the part that came after it. Produce one summary covering both."
      : "Summarise this part of a conversation so it can be carried forward.",
    "",
    ...(existing ? ["Summary so far:", existing, ""] : []),
    "The conversation:",
    conversation,
    "",
    "Keep: decisions made, facts established, anything asked for that is not finished, names, numbers, file paths, and how the person wants to be worked with.",
    "Drop: pleasantries, restatements, and anything already superseded.",
    "Write it as notes to yourself, in the second person about them. Under 400 words. No preamble.",
  ].join("\n");
}

export function summaryTurn(summary: string): Turn {
  return {
    role: "assistant",
    text: `[Earlier in this conversation, summarised]\n${summary}`,
  };
}

export function compactionNotice(folded: number): string {
  return folded === 1
    ? "This conversation reached the model's limit, so the earliest message was summarised. Everything since is intact, and the summary carries forward what mattered."
    : `This conversation reached the model's limit, so the earliest ${folded} messages were summarised. Everything since is intact, and the summary carries forward what mattered.`;
}

export const MICRO_TAIL = 8;

export const DEFRAG_AT = 2_000;

export interface MicroPlan {
  absorb: Turn | null;
  through: number;
  verbatim: boolean;
}

export function planMicro(turns: Turn[], through: number, tail: number = MICRO_TAIL): MicroPlan {
  const at = Math.max(0, Math.min(through, turns.length));
  const nothing: MicroPlan = { absorb: null, through: at, verbatim: false };
  if (turns.length - at <= Math.max(1, tail)) return nothing;

  const next = turns[at];
  if (!next) return nothing;
  if (next.role === "user") return { absorb: null, through: at + 1, verbatim: true };
  if (!next.text.trim()) return { absorb: null, through: at + 1, verbatim: true };
  return { absorb: next, through: at + 1, verbatim: false };
}

export function carriedVerbatim(turns: Turn[], from: number, through: number): Turn[] {
  const start = Math.max(0, Math.min(from, turns.length));
  const end = Math.max(start, Math.min(through, turns.length));
  return turns.slice(start, end).filter((t) => t.role === "user");
}

export function needsDefrag(summary: string, at: number = DEFRAG_AT): boolean {
  return estimateTokens(summary ?? "") > Math.max(1, at);
}

export function defragPrompt(summary: string): string {
  return [
    "This is a running summary of a conversation, written in pieces over time.",
    "Rewrite it as one summary, keeping every fact and dropping the repetition and the scaffolding.",
    "",
    summary,
    "",
    "Keep: decisions made, facts established, anything asked for that is not finished, names, numbers, file paths, and how the person wants to be worked with.",
    "Write it as notes to yourself, in the second person about them. Under 400 words. No preamble.",
  ].join("\n");
}

export function absorbPrompt(existing: string | null, one: Turn): string {
  return [
    existing
      ? "Here is a running summary of a conversation, and one more thing that was said after it. Fold the new part into the summary and return the whole thing."
      : "Summarise this so it can be carried forward as the beginning of a running summary.",
    "",
    ...(existing ? ["Summary so far:", existing, ""] : []),
    "Newly said:",
    `${one.role === "user" ? "Them" : "You"}: ${one.text.slice(0, 20_000)}`,
    "",
    "Keep: decisions made, facts established, anything asked for that is not finished, names, numbers, file paths, and how the person wants to be worked with.",
    "Drop: pleasantries, restatements, and anything already superseded.",
    "Write it as notes to yourself, in the second person about them. Under 400 words. No preamble.",
  ].join("\n");
}

export interface Covered {
  summary: string;
  through: number;
  microFrom?: number;
}

export function assembleTranscript(
  all: Turn[],
  covered: Covered | null,
  budget: number,
): { turns: Turn[]; dropped: number } {
  const after = covered ? all.slice(covered.through) : all;
  const plan = planCompaction(after.slice(0, -1), budget);
  const spoken =
    covered && covered.microFrom !== undefined
      ? carriedVerbatim(all, covered.microFrom, covered.through)
      : [];
  return {
    turns: [...(covered ? [summaryTurn(covered.summary)] : []), ...spoken, ...plan.keep],
    dropped: plan.fold.length,
  };
}

const TOO_LONG = [
  /context[_ ]length/i,
  /maximum context/i,
  /context window/i,
  /too many tokens/i,
  /prompt is too long/i,
  /reduce the length/i,
  /input length and `max_tokens`/i,
  /exceeds the (model|maximum)/i,
  /string too long/i,
];

export function isContextError(message: string | null | undefined): boolean {
  const text = message ?? "";
  return TOO_LONG.some((pattern) => pattern.test(text));
}

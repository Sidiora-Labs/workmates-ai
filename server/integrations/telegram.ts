import { clamp } from "../core/limits.ts";

const API = "https://api.telegram.org";

export interface TelegramState {
  token?: string;
  chatIds?: number[];
  botId?: string;
  pairing?: string | null;
  offset?: number;
  enabled?: boolean;
}

export interface Incoming {
  chatId: number;
  from: string;
  text: string;
  updateId: number;
}

export function parseUpdates(payload: unknown): Incoming[] {
  const result = (payload as { ok?: boolean; result?: unknown[] })?.result;
  if (!Array.isArray(result)) return [];
  const out: Incoming[] = [];
  for (const raw of result) {
    if (!raw || typeof raw !== "object") continue;
    const update = raw as Record<string, any>;
    const message = update.message ?? update.edited_message;
    const chatId = Number(message?.chat?.id);
    const text = typeof message?.text === "string" ? message.text.trim() : "";
    const updateId = Number(update.update_id);
    if (!Number.isFinite(chatId) || !Number.isFinite(updateId) || !text) continue;
    out.push({
      chatId,
      updateId,
      text: text.slice(0, 4_000),
      from: String(message?.from?.first_name ?? "someone").slice(0, 60),
    });
  }
  return out;
}

export type Decision =
  | { kind: "pair"; chatId: number }
  | { kind: "deliver"; chatId: number; text: string }
  | { kind: "refuse"; chatId: number }
  | { kind: "ignore" };

export function decide(state: TelegramState, message: Incoming): Decision {
  const allowed = state.chatIds ?? [];
  if (allowed.includes(message.chatId)) {
    return { kind: "deliver", chatId: message.chatId, text: message.text };
  }
  if (state.pairing && message.text.trim() === state.pairing) {
    return { kind: "pair", chatId: message.chatId };
  }
  return { kind: "refuse", chatId: message.chatId };
}

export function pairingWord(random: () => number = Math.random): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let word = "";
  for (let i = 0; i < 8; i++) word += alphabet[Math.floor(random() * alphabet.length)];
  return word;
}

async function call(token: string, method: string, body: unknown, timeoutMs = 15_000) {
  const response = await fetch(`${API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Telegram answered HTTP ${response.status}`);
  return response.json();
}

export async function whoAmI(token: string): Promise<{ username: string }> {
  const body = (await call(token, "getMe", {})) as { result?: { username?: string } };
  const username = body?.result?.username;
  if (!username) throw new Error("that token was refused");
  return { username };
}

export async function send(token: string, chatId: number, text: string): Promise<void> {
  await call(token, "sendMessage", { chat_id: chatId, text: text.slice(0, 4_000) });
}

export async function poll(token: string, offset: number): Promise<Incoming[]> {
  const body = await call(
    token,
    "getUpdates",
    { offset, timeout: 20, allowed_updates: ["message"] },
    30_000,
  );
  return parseUpdates(body);
}

export function nextOffset(current: number, messages: Incoming[]): number {
  return messages.reduce((highest, message) => Math.max(highest, message.updateId + 1), current);
}

export function cleanToken(value: unknown): string | undefined {
  return clamp(value, 120);
}

export function interpretAnswer(text: string, options: string[]): { option?: string; free?: string } {
  const said = text.trim();
  const n = Number(said);
  if (Number.isInteger(n) && n >= 1 && n <= options.length) return { option: options[n - 1] };
  const lower = said.toLowerCase();
  const exact = options.find((o) => o.toLowerCase() === lower);
  if (exact) return { option: exact };
  if (/^(y|yes|ok|okay|sure|allow|approve|go|do it)\b/.test(lower) && options[0]) return { option: options[0] };
  if (/^(n|no|nope|deny|decline|stop|don'?t)\b/.test(lower) && options[1]) return { option: options[1] };
  return { free: said };
}

export function describeCard(card: { title?: string; subtitle?: string; options?: string[] }): string {
  const lines = [card.title || "Your agent needs you"];
  if (card.subtitle) lines.push(card.subtitle.slice(0, 600));
  const options = card.options ?? [];
  if (options.length) {
    lines.push("");
    options.forEach((o, i) => lines.push(`${i + 1}. ${o}`));
    lines.push("", "Reply with a number, or yes / no.");
  } else {
    lines.push("", "Reply with your answer.");
  }
  return lines.join("\n");
}

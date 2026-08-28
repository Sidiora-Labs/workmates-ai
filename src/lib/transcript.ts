import type { Message } from "@/state/reducer";

export function showTypingDots(
  busy: boolean | undefined,
  streaming: string | undefined,
  last: Message | undefined,
): boolean {
  if (!busy || streaming) return false;
  if (!last) return true;
  return !(last.role === "bot" && last.kind === "text");
}

export const TRANSCRIPT_WINDOW = 120;

export function windowStart(total: number, boundary: number | null): number {
  if (boundary === null || boundary >= total) return Math.max(0, total - TRANSCRIPT_WINDOW);
  return Math.max(0, boundary);
}

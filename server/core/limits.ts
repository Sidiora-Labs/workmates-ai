export const MAX_MESSAGE_CHARS = 100_000;

export const MAX_NAME_CHARS = 80;
export const MAX_TITLE_CHARS = 160;

export const MAX_DESCRIPTION_CHARS = 4_000;

export const MAX_SKILL_CHARS = 400;
export const MAX_SKILLS = 12;

export const MAX_BODY_BYTES = 2_000_000;

export const MAX_SSE_CLIENTS = 32;

export const MAX_CUSTOM_ENDPOINTS = 16;
export const MAX_CUSTOM_KEYS = 8;
export const MAX_KEY_CHARS = 400;
export const MAX_URL_CHARS = 400;

export function clamp(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

export function clampList(value: unknown, max: number, count: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value
    .map((item) => clamp(item, max))
    .filter((item): item is string => Boolean(item))
    .slice(0, count);
  return out.length ? out : undefined;
}

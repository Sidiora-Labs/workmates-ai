export const DEFAULT_SIZE = Object.freeze({ width: 1440, height: 920 });

export const MIN_SIZE = Object.freeze({ width: 900, height: 600 });

const wholeNumber = (value) => Number.isInteger(value) && Number.isFinite(value);
const clamp = (value, low, high) => Math.min(Math.max(value, low), high);

export function parseWindowState(raw) {
  let value;
  try {
    value = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  const bounds = value?.bounds;
  if (!bounds || typeof bounds !== "object") return null;
  const { x, y, width, height } = bounds;
  if (![x, y, width, height].every(wholeNumber) || width <= 0 || height <= 0) return null;
  return { bounds: { x, y, width, height }, maximized: value.maximized === true };
}

const overlap = (a, b) => {
  const w = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return w * h;
};

export function resolveWindowState(saved, workAreas) {
  const areas = (workAreas ?? []).filter(
    (a) => a && [a.x, a.y, a.width, a.height].every(wholeNumber) && a.width > 0 && a.height > 0,
  );
  const primary = areas[0];
  const fallback = {
    width: primary ? Math.min(DEFAULT_SIZE.width, primary.width) : DEFAULT_SIZE.width,
    height: primary ? Math.min(DEFAULT_SIZE.height, primary.height) : DEFAULT_SIZE.height,
  };
  const state = parseWindowState(saved);
  if (!state || !primary) return { bounds: fallback, maximized: false };

  let home = primary;
  let shared = 0;
  for (const area of areas) {
    const pixels = overlap(state.bounds, area);
    if (pixels > shared) {
      shared = pixels;
      home = area;
    }
  }

  const width = clamp(state.bounds.width, Math.min(MIN_SIZE.width, home.width), home.width);
  const height = clamp(state.bounds.height, Math.min(MIN_SIZE.height, home.height), home.height);
  const bounds =
    shared > 0
      ? {
          x: clamp(state.bounds.x, home.x, home.x + home.width - width),
          y: clamp(state.bounds.y, home.y, home.y + home.height - height),
          width,
          height,
        }
      : {
          x: home.x + Math.round((home.width - width) / 2),
          y: home.y + Math.round((home.height - height) / 2),
          width,
          height,
        };
  return { bounds, maximized: state.maximized };
}

export function normalizeBadgeCount(value) {
  if (!Number.isFinite(value)) return 0;
  return clamp(Math.trunc(value), 0, 999);
}

export interface FindableMessage {
  kind?: string;
  text?: string;
  deleted?: boolean;
}

export function findHits(messages: readonly FindableMessage[], query: string): number[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];
  const hits: number[] = [];
  messages.forEach((message, index) => {
    if (message.deleted) return;
    if (message.kind && message.kind !== "text" && message.kind !== "notice") return;
    if ((message.text ?? "").toLowerCase().includes(needle)) hits.push(index);
  });
  return hits;
}

export function splitHighlight(text: string, query: string): Array<{ text: string; hit: boolean }> {
  const needle = query.trim();
  if (needle.length < 2) return [{ text, hit: false }];
  const parts: Array<{ text: string; hit: boolean }> = [];
  const lower = text.toLowerCase();
  const target = needle.toLowerCase();
  let at = 0;
  for (;;) {
    const found = lower.indexOf(target, at);
    if (found === -1) break;
    if (found > at) parts.push({ text: text.slice(at, found), hit: false });
    parts.push({ text: text.slice(found, found + target.length), hit: true });
    at = found + target.length;
  }
  if (at < text.length) parts.push({ text: text.slice(at), hit: false });
  return parts.length ? parts : [{ text, hit: false }];
}

export function stepHit(current: number, total: number, by: number): number {
  if (total === 0) return 0;
  return (current + by + total) % total;
}

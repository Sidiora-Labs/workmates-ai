import type { Message } from "@/state/reducer";

export interface Thread {
  root: Message;
  replies: Message[];
  lastAt: number;
  participants: string[];
}

export type NameOf = (message: Message) => string;

const AT = (message: Message): number => (typeof message.at === "number" ? message.at : 0);

export function rootIds(messages: Message[]): Map<string, string> {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const roots = new Map<string, string>();

  for (const message of messages) {
    let current = message;
    const seen = new Set<string>([current.id]);
    for (;;) {
      const parentId = current.replyTo?.id;
      if (!parentId) break;
      const parent = byId.get(parentId);
      if (!parent || seen.has(parent.id)) break;
      seen.add(parent.id);
      current = parent;
      const known = roots.get(current.id);
      if (known) {
        current = byId.get(known) ?? current;
        break;
      }
    }
    roots.set(message.id, current.id);
  }
  return roots;
}

export function threadsFrom(messages: Message[], nameOf: NameOf): Thread[] {
  const readable = messages.filter((m) => !m.deleted);
  const roots = rootIds(readable);
  const byId = new Map(readable.map((m) => [m.id, m]));

  const threads = new Map<string, Thread>();
  for (const message of readable) {
    const rootId = roots.get(message.id) ?? message.id;
    const root = byId.get(rootId);
    if (!root) continue;
    let thread = threads.get(rootId);
    if (!thread) {
      thread = { root, replies: [], lastAt: AT(root), participants: [] };
      threads.set(rootId, thread);
    }
    if (message.id !== rootId) thread.replies.push(message);
    thread.lastAt = Math.max(thread.lastAt, AT(message));
    const who = nameOf(message);
    if (who && !thread.participants.includes(who)) thread.participants.push(who);
  }

  for (const thread of threads.values()) {
    thread.replies.sort((a, b) => AT(a) - AT(b));
  }
  return [...threads.values()].sort((a, b) => b.lastAt - a.lastAt);
}

export function replyCounts(messages: Message[]): Map<string, number> {
  const roots = rootIds(messages.filter((m) => !m.deleted));
  const counts = new Map<string, number>();
  for (const [id, rootId] of roots) {
    if (id === rootId) continue;
    counts.set(rootId, (counts.get(rootId) ?? 0) + 1);
  }
  return counts;
}

export function replyLabel(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "1 reply" : `${count} replies`;
}

export function preview(message: Message, max = 140): string {
  const text = (message.text ?? "").replace(/\s+/g, " ").trim();
  if (text) return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  switch (message.kind) {
    case "artifact":
      return message.artifact?.name ?? "a file";
    case "options":
      return message.card?.title ?? "a question";
    case "activity":
      return message.tool?.name ?? "did something";
    case "screen":
      return "a screenshot";
    default:
      return "…";
  }
}

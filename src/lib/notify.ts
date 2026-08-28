export interface NotifiableMessage {
  role?: string;
  kind?: string;
  text?: string;
  from?: string;
  card?: { requestId?: string; title?: string };
}

export interface NotifyContext {
  focused: boolean;
  selectedId: string;
  threadId: string;
  bot?: { id: string; name: string; notifications?: boolean };
  room?: { id: string; name: string };
  mentionsUser?: boolean;
}

export interface Notice {
  title: string;
  body: string;
  target: string;
  urgent: boolean;
  avatar?: string;
}

const MAX_BODY = 180;

function preview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_BODY ? `${flat.slice(0, MAX_BODY - 1)}…` : flat;
}

export function noticeFor(message: NotifiableMessage, ctx: NotifyContext): Notice | null {
  if (message.role !== "bot") return null;

  const who = ctx.room ? ctx.room.name : (ctx.bot?.name ?? "An agent");
  const target = ctx.room ? ctx.room.id : (ctx.bot?.id ?? ctx.threadId);
  const watching = ctx.focused && ctx.selectedId === target;

  if (message.kind === "options" && message.card?.requestId) {
    if (watching) return null;
    return {
      title: ctx.room ? `${who}: someone needs you` : `${who} needs you`,
      body: preview(message.card.title || "An agent is waiting for your answer."),
      target,
      urgent: true,
    };
  }

  if (message.kind !== "text" || !message.text?.trim()) return null;
  if (watching) return null;

  if (ctx.room) {
    if (!ctx.mentionsUser) return null;
    return { title: `${who}`, body: preview(message.text), target, urgent: false };
  }

  if (ctx.bot?.notifications === false) return null;
  return { title: who, body: preview(message.text), target, urgent: false };
}

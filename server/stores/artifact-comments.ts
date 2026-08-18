import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { DATA_DIR } from "../core/config.ts";
import { newId } from "../core/contracts.ts";

export interface Anchor {
  kind: "cell" | "line" | "page";
  row?: number;
  column?: number;
  index?: number;
}

export interface ArtifactComment {
  id: string;
  botId: string;
  artifact: string;
  anchor: Anchor;
  text: string;
  author: string;
  at: number;
  resolved?: boolean;
}

export const MAX_COMMENT_CHARS = 1_000;
export const MAX_COMMENTS = 200;

const FILE = join(DATA_DIR, "artifact-comments.json");

export function describeAnchor(anchor: Anchor): string {
  if (anchor.kind === "cell") {
    const column = anchor.column ?? 0;
    let name = "";
    for (let n = column; ; n = Math.floor(n / 26) - 1) {
      name = String.fromCharCode(65 + (n % 26)) + name;
      if (n < 26) break;
    }
    return `cell ${name}${(anchor.row ?? 0) + 1}`;
  }
  if (anchor.kind === "line") return `line ${(anchor.index ?? 0) + 1}`;
  return `page ${(anchor.index ?? 0) + 1}`;
}

export function parseAnchor(raw: unknown): Anchor | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  const whole = (value: unknown) =>
    typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 1_000_000;
  if (a.kind === "cell") {
    if (!whole(a.row) || !whole(a.column)) return null;
    return { kind: "cell", row: a.row as number, column: a.column as number };
  }
  if (a.kind === "line" || a.kind === "page") {
    if (!whole(a.index)) return null;
    return { kind: a.kind, index: a.index as number };
  }
  return null;
}

export class ArtifactCommentStore {
  comments: ArtifactComment[] = [];

  constructor() {
    mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    try {
      const raw = JSON.parse(readFileSync(FILE, "utf8"));
      this.comments = Array.isArray(raw) ? raw.filter(valid) : [];
    } catch {
      this.comments = [];
    }
  }

  private save() {
    writeFileSync(FILE, JSON.stringify(this.comments, null, 2), { mode: 0o600 });
  }

  for(botId: string, artifact: string): ArtifactComment[] {
    return this.comments
      .filter((c) => c.botId === botId && c.artifact === artifact)
      .sort((a, b) => a.at - b.at);
  }

  add(
    botId: string,
    artifact: string,
    anchor: Anchor,
    text: string,
    author = "user",
  ): ArtifactComment | null {
    if (this.for(botId, artifact).length >= MAX_COMMENTS) return null;
    const comment: ArtifactComment = {
      id: newId(),
      botId,
      artifact,
      anchor,
      text: text.slice(0, MAX_COMMENT_CHARS),
      author,
      at: Date.now(),
    };
    this.comments.push(comment);
    this.save();
    return comment;
  }

  setResolved(id: string, resolved: boolean): ArtifactComment | null {
    const comment = this.comments.find((c) => c.id === id);
    if (!comment) return null;
    comment.resolved = resolved || undefined;
    this.save();
    return comment;
  }

  removeForBot(botId: string) {
    const before = this.comments.length;
    this.comments = this.comments.filter((c) => c.botId !== botId);
    if (this.comments.length !== before) this.save();
  }

  remove(id: string): boolean {
    const before = this.comments.length;
    this.comments = this.comments.filter((c) => c.id !== id);
    if (this.comments.length === before) return false;
    this.save();
    return true;
  }

  removeFor(botId: string, artifact?: string): void {
    const before = this.comments.length;
    this.comments = this.comments.filter(
      (c) => c.botId !== botId || (artifact !== undefined && c.artifact !== artifact),
    );
    if (this.comments.length !== before) this.save();
  }
}

function valid(row: any): row is ArtifactComment {
  return (
    row &&
    typeof row.id === "string" &&
    typeof row.botId === "string" &&
    typeof row.artifact === "string" &&
    typeof row.text === "string" &&
    row.anchor &&
    ["cell", "line", "page"].includes(row.anchor.kind)
  );
}

export type PasteAttachment = {
  kind: "paste";
  id: string;
  text: string;
  bytes: number;
  lines: number;
};

export type FileAttachment = {
  kind: "file";
  id: string;
  path: string;
  name: string;
  bytes: number;
};

export type ImageAttachment = {
  kind: "image";
  id: string;
  path: string;
  name: string;
  bytes: number;
  mime: string;
};

export type Attachment = PasteAttachment | FileAttachment | ImageAttachment;

export const PASTE_CHARS = 900;
export const PASTE_LINES = 12;

export function isLongPaste(text: string): boolean {
  return text.length >= PASTE_CHARS || text.split("\n").length >= PASTE_LINES;
}

export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export function isImage(file: { type: string }): boolean {
  return IMAGE_MIMES.has(file.type.split(";")[0]!.trim().toLowerCase());
}

const newId = () =>
  globalThis.crypto?.randomUUID?.() ?? `a${Math.random().toString(36).slice(2)}`;

export function pasteAttachment(text: string): PasteAttachment {
  return {
    kind: "paste",
    id: newId(),
    text,
    bytes: new TextEncoder().encode(text).length,
    lines: text.split("\n").length,
  };
}

export function fileAttachment(name: string, path: string, bytes: number): FileAttachment {
  return { kind: "file", id: newId(), path, name, bytes };
}

export const INLINE_TEXT_LIMIT = 512 * 1024;

type IncomingFile = Pick<File, "name" | "size" | "type" | "text">;

export async function intakeFiles<T extends IncomingFile>(
  files: readonly T[],
  handlers: {
    pathOf: (file: T) => string;
    uploadImage: (file: T) => Promise<ImageAttachment | null>;
    uploadFile?: (file: T) => Promise<FileAttachment>;
  },
): Promise<{ attachments: Attachment[]; refused: string | null }> {
  const attachments: Attachment[] = [];
  const complaints: string[] = [];
  for (const file of files) {
    if (isImage(file)) {
      try {
        const uploaded = await handlers.uploadImage(file);
        if (uploaded) attachments.push(uploaded);
      } catch (error) {
        complaints.push(`${file.name || "image"}: ${error instanceof Error ? error.message : "upload failed"}`);
      }
      continue;
    }
    if (handlers.uploadFile) {
      try { attachments.push(await handlers.uploadFile(file)); }
      catch (error) { complaints.push(`${file.name}: ${error instanceof Error ? error.message : "upload failed"}`); }
      continue;
    }
    let path = "";
    try {
      path = handlers.pathOf(file);
    } catch {
    }
    if (path) {
      attachments.push(fileAttachment(file.name, path, file.size));
      continue;
    }
    if ((file.type.startsWith("text/") || file.type === "application/json") && file.size <= INLINE_TEXT_LIMIT) {
      try {
        attachments.push(pasteAttachment(await file.text()));
        continue;
      } catch {
      }
    }
    complaints.push(`${file.name || "that file"} has no path Workmates can hand to an agent`);
  }
  return { attachments, refused: complaints.length ? complaints.join("; ") : null };
}

export async function uploadImageAttachment(file: File): Promise<ImageAttachment | null> {
  if (!isImage(file)) return null;
  if (file.size > IMAGE_MAX_BYTES) throw new Error(`${file.name || "image"} is over 10 MB`);
  const response = await fetch("/api/attachments", {
    method: "POST",
    headers: { "content-type": file.type },
    body: new Uint8Array(await file.arrayBuffer()),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.error ?? "upload failed");
  }
  const saved = await response.json();
  return {
    kind: "image",
    id: newId(),
    path: saved.path,
    name: file.name || "pasted image",
    bytes: saved.bytes,
    mime: saved.mime,
  };
}

export async function uploadFileAttachment(file: File): Promise<FileAttachment> {
  if (file.size > 25 * 1024 * 1024) throw new Error("files top out at 25 MB");
  const response = await fetch("/api/attachments/file", {
    method: "POST",
    headers: { "content-type": "application/octet-stream", "x-workmates-file-name": encodeURIComponent(file.name) },
    body: file,
  });
  const saved = await response.json().catch(() => null);
  if (!response.ok) throw new Error(saved?.error || "upload failed");
  return fileAttachment(file.name, saved.path, saved.bytes);
}

export function composeOutgoing(text: string, attachments: Attachment[]): string {
  const parts = [text.trim()];
  for (const a of attachments) {
    if (a.kind === "paste") parts.push(`<pasted-text>\n${a.text}\n</pasted-text>`);
    else if (a.kind === "image") parts.push(`<attached-image path="${escapeAttr(a.path)}" />`);
    else parts.push(`<attached-file path="${escapeAttr(a.path)}" />`);
  }
  return parts.filter(Boolean).join("\n\n");
}

function escapeAttr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\n", "&#10;")
    .replaceAll("\r", "&#13;");
}

const unescapeAttr = (raw: string) =>
  raw
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#10;", "\n")
    .replaceAll("&#13;", "\r")
    .replaceAll("&amp;", "&");

export function splitAttachments(text: string): {
  display: string;
  images: string[];
  files: string[];
} {
  const images: string[] = [];
  const files: string[] = [];
  const display = text
    .replace(/<attached-image\s+path="([^"]*)"\s*\/>(?:\s*\n)?/g, (_whole, raw: string) => {
      const path = unescapeAttr(raw);
      if (path) images.push(path);
      return "";
    })
    .replace(/<attached-file\s+path="([^"]*)"\s*\/>(?:\s*\n)?/g, (_whole, raw: string) => {
      const path = unescapeAttr(raw);
      if (path) files.push(path);
      return "";
    });
  return { display: display.trim(), images, files };
}

export function attachmentBasename(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? "";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

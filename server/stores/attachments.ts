import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, join } from "node:path";

import { DATA_DIR } from "../core/config.ts";

const ATTACHMENTS_DIR = join(DATA_DIR, "attachments");

export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const FILE_MAX_BYTES = 25 * 1024 * 1024;

export async function saveFileAttachment(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const reply = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const encoded = req.headers["x-workmates-file-name"];
  let name: string;
  try {
    name = basename(decodeURIComponent(typeof encoded === "string" ? encoded : "file").replaceAll("\\", "/"));
  } catch {
    return reply(400, { error: "invalid filename" });
  }
  name = name.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 180);
  if (!name || name === "." || name === "..") name = "file";
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > FILE_MAX_BYTES) return reply(413, { error: "files top out at 25 MB" });
    chunks.push(Buffer.from(chunk));
  }
  const directory = join(ATTACHMENTS_DIR, randomUUID());
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, name);
  writeFileSync(path, Buffer.concat(chunks), { mode: 0o600 });
  reply(200, { path, name, bytes });
}

const EXTENSION_FOR: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

const MIME_FOR: Record<string, string> = Object.fromEntries(
  Object.entries(EXTENSION_FOR).map(([mime, ext]) => [ext, mime]),
);

const SAFE_NAME = /^[0-9a-f-]{36}\.(png|jpg|gif|webp)$/;

export function extensionFor(contentType: string | undefined): string | null {
  return EXTENSION_FOR[(contentType ?? "").split(";")[0]!.trim().toLowerCase()] ?? null;
}

export function saveAttachment(req: IncomingMessage, res: ServerResponse): void {
  const extension = extensionFor(req.headers["content-type"]);
  if (!extension) {
    res.writeHead(415, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "only png, jpeg, gif and webp images upload" }));
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  req.on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (size > IMAGE_MAX_BYTES) {
      req.destroy();
      res.writeHead(413, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "images top out at 10 MB" }));
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => {
    if (res.writableEnded) return;
    if (!size) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "empty upload" }));
      return;
    }
    mkdirSync(ATTACHMENTS_DIR, { recursive: true });
    const name = `${randomUUID()}.${extension}`;
    const path = join(ATTACHMENTS_DIR, name);
    writeFileSync(path, Buffer.concat(chunks));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ path, mime: MIME_FOR[extension], bytes: size }));
  });
  req.on("error", () => {
    if (!res.writableEnded) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "upload failed" }));
    }
  });
}

export function serveAttachment(name: string, res: ServerResponse): void {
  if (!SAFE_NAME.test(name)) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "no such attachment" }));
    return;
  }
  const path = join(ATTACHMENTS_DIR, name);
  if (!existsSync(path)) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "no such attachment" }));
    return;
  }
  res.writeHead(200, {
    "content-type": MIME_FOR[name.split(".").at(-1)!] ?? "application/octet-stream",
    "content-length": statSync(path).size,
    "cache-control": "private, max-age=31536000, immutable",
  });
  createReadStream(path).pipe(res);
}

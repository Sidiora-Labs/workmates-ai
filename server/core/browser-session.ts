import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { IncomingMessage } from "node:http";
import { DATA_DIR } from "./config.ts";
import { HOSTED, SERVER_TOKEN, publicOrigin } from "./hosting.ts";

const COOKIE = "workmates_session";
const TTL = 30 * 24 * 60 * 60;
const file = join(DATA_DIR, "browser-sessions.json");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
let sessions: { hash: string; expires: number }[] = [];
try {
  const saved = JSON.parse(readFileSync(file, "utf8"));
  if (saved.key === hash(SERVER_TOKEN) && Array.isArray(saved.sessions)) {
    sessions = saved.sessions.filter((s: { hash?: unknown; expires?: unknown }) =>
      typeof s.hash === "string" && /^[a-f0-9]{64}$/.test(s.hash) && typeof s.expires === "number" && s.expires > Date.now());
  }
} catch {}

export function sameBrowserOrigin(req: IncomingMessage): boolean {
  if (req.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = req.headers.origin;
  if (!origin) return req.method === "GET" || req.method === "HEAD";
  const expected = publicOrigin() || `http://${req.headers.host}`;
  return origin === expected;
}

function cookieToken(req: IncomingMessage): string {
  return req.headers.cookie?.split(/;\s*/).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) ?? "";
}

export function browserOwner(req: IncomingMessage): boolean {
  if (!HOSTED || !sameBrowserOrigin(req)) return false;
  const offered = Buffer.from(hash(cookieToken(req)));
  return sessions.some((s) => s.expires > Date.now() && timingSafeEqual(offered, Buffer.from(s.hash)));
}

function save(): void {
  sessions = sessions.filter((s) => s.expires > Date.now()).slice(-128);
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify({ key: hash(SERVER_TOKEN), sessions }), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}

export function sessionCookie(req: IncomingMessage, signOut = false): string {
  const oldHash = hash(cookieToken(req));
  sessions = sessions.filter((s) => s.hash !== oldHash);
  const token = signOut ? "" : randomBytes(32).toString("base64url");
  if (!signOut) sessions.push({ hash: hash(token), expires: Date.now() + TTL * 1000 });
  save();
  const secure = publicOrigin().startsWith("https:") || req.headers["x-forwarded-proto"] === "https";
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${signOut ? 0 : TTL}${secure ? "; Secure" : ""}`;
}

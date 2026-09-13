import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { bearerToken } from "./http-guard.ts";

export const HOSTED = process.env.WORKMATES_HOSTED === "1";
export const SERVER_TOKEN = process.env.WORKMATES_SERVER_TOKEN ?? "";
export const SERVER_PORT = Number(process.env.WORKMATES_PORT || process.env.PORT || 8799);

const configuredOrigin = process.env.WORKMATES_PUBLIC_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "");

export function publicOrigin(): string {
  if (!configuredOrigin) return "";
  const url = new URL(configuredOrigin);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
      url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("WORKMATES_PUBLIC_URL must be an HTTPS origin without a path");
  }
  return url.origin;
}

export function validateHosting(): void {
  if (!Number.isInteger(SERVER_PORT) || SERVER_PORT < 1 || SERVER_PORT > 65535) {
    throw new Error("PORT must be a valid TCP port");
  }
  if (HOSTED && (SERVER_TOKEN.length < 32 || /\s/.test(SERVER_TOKEN))) {
    throw new Error("Set WORKMATES_SERVER_TOKEN to a random token of at least 32 characters");
  }
  publicOrigin();
}

export function isServerOwner(req: IncomingMessage): boolean {
  const offered = bearerToken(req);
  if (!HOSTED || !offered || !SERVER_TOKEN) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(offered), digest(SERVER_TOKEN));
}

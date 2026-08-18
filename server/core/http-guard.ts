import type { IncomingMessage } from "node:http";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

function hostnameOf(value: string): string {
  if (value.startsWith("[")) return value.slice(0, value.indexOf("]") + 1);
  const colon = value.lastIndexOf(":");
  return colon === -1 ? value : value.slice(0, colon);
}

function isLoopbackPeer(req: IncomingMessage): boolean {
  const addr = req.socket?.remoteAddress;
  if (!addr) return false;
  const bare = addr.startsWith("::ffff:") ? addr.slice(7) : addr;
  return bare === "127.0.0.1" || bare === "::1" || bare.startsWith("127.");
}

export function isLocalRequest(req: IncomingMessage): boolean {
  if (!isLoopbackPeer(req)) return false;

  const host = req.headers.host;
  if (!host || !LOOPBACK_HOSTS.has(hostnameOf(host))) return false;

  const origin = req.headers.origin;
  if (!origin || origin === "null") return true;

  try {
    return LOOPBACK_HOSTS.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

export function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const space = header.indexOf(" ");
  if (space === -1) return null;
  if (header.slice(0, space).toLowerCase() !== "bearer") return null;
  return header.slice(space + 1).trim() || null;
}

export function isSameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin || origin === "null") return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

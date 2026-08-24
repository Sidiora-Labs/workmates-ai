import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";

const INFO = "workmates-relay-v1";
const NONCE_BYTES = 12;

export type Direction = "phone-to-mac" | "mac-to-phone";

export function deviceKey(hash: string, direction: Direction): Buffer {
  return Buffer.from(
    hkdfSync("sha256", Buffer.from(hash, "hex"), Buffer.alloc(0), `${INFO}:${direction}`, 32),
  );
}

export function keyFromToken(token: string, direction: Direction): Buffer {
  return deviceKey(createHash("sha256").update(token).digest("hex"), direction);
}

export interface Envelope {
  d: string;
  n: string;
  c: string;
}

export function seal(key: Buffer, deviceId: string, value: unknown): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const body = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(value), "utf8")),
    cipher.final(),
  ]);
  const envelope: Envelope = {
    d: deviceId,
    n: nonce.toString("base64"),
    c: Buffer.concat([body, cipher.getAuthTag()]).toString("base64"),
  };
  return Buffer.from(JSON.stringify(envelope), "utf8").toString("base64");
}

export function peek(payload: string): Envelope | null {
  try {
    const raw = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
    if (typeof raw?.d !== "string" || typeof raw?.n !== "string" || typeof raw?.c !== "string") {
      return null;
    }
    return raw as Envelope;
  } catch {
    return null;
  }
}

export function open(key: Buffer, envelope: Envelope): unknown | null {
  try {
    const nonce = Buffer.from(envelope.n, "base64");
    const blob = Buffer.from(envelope.c, "base64");
    if (nonce.length !== NONCE_BYTES || blob.length <= 16) return null;
    const tag = blob.subarray(blob.length - 16);
    const body = blob.subarray(0, blob.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(body), decipher.final()]);
    return JSON.parse(plain.toString("utf8"));
  } catch {
    return null;
  }
}

export interface RelayRequest {
  method: string;
  path: string;
  body?: unknown;
  ts?: number;
  nonce?: string;
}

export interface RelayResponse {
  status: number;
  body?: unknown;
}

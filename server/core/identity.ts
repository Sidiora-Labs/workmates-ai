import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { DATA_DIR } from "./config.ts";

const IDENTITIES = join(DATA_DIR, "identities");

export interface Identity {
  botId: string;
  fingerprint: string;
  createdAt: number;
}

export function short(fingerprint: string): string {
  const clean = (fingerprint ?? "").trim().toLowerCase();
  if (clean.length <= 12) return clean;
  return `${clean.slice(0, 8)}…${clean.slice(-4)}`;
}

export function statementOf(entry: {
  kind: string;
  at: number;
  actor: string;
  summary: string;
}): string {
  return [entry.kind, entry.at, entry.actor, entry.summary].join("\u0000");
}

const cache = new Map<string, Identity>();

function fileFor(botId: string): string {
  if (!/^[\w-]{1,64}$/.test(botId)) throw new Error("bad agent id");
  return join(IDENTITIES, `${botId}.pem`);
}

function rawPublic(publicKey: ReturnType<typeof createPublicKey>): string {
  const der = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  return der.subarray(der.length - 32).toString("hex");
}

export function identityFor(botId: string, now: number = Date.now()): Identity {
  const known = cache.get(botId);
  if (known) return known;
  const file = fileFor(botId);
  let identity: Identity;
  try {
    const pem = readFileSync(file, "utf8");
    identity = { botId, fingerprint: rawPublic(createPublicKey(createPrivateKey(pem))), createdAt: now };
  } catch {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    mkdirSync(IDENTITIES, { recursive: true, mode: 0o700 });
    writeFileSync(file, privateKey.export({ format: "pem", type: "pkcs8" }) as string, { mode: 0o600 });
    try {
      chmodSync(file, 0o600);
    } catch {
    }
    identity = { botId, fingerprint: rawPublic(publicKey), createdAt: now };
  }
  cache.set(botId, identity);
  return identity;
}

export function signAs(botId: string, statement: string): string | null {
  try {
    const key = createPrivateKey(readFileSync(fileFor(botId), "utf8"));
    return sign(null, Buffer.from(statement, "utf8"), key).toString("base64");
  } catch {
    return null;
  }
}

export function verifyStatement(fingerprint: string, statement: string, signature: string): boolean {
  try {
    const raw = Buffer.from(fingerprint, "hex");
    if (raw.length !== 32) return false;
    const der = Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      raw,
    ]);
    const key = createPublicKey({ key: der, format: "der", type: "spki" });
    return verify(null, Buffer.from(statement, "utf8"), key, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

export function forget(botId: string) {
  cache.delete(botId);
  try {
    unlinkSync(fileFor(botId));
  } catch {
  }
}

import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { networkInterfaces } from "node:os";

import { loadConfig, saveConfig } from "../core/config.ts";

export interface PairedDevice {
  id: string;
  name: string;
  hash: string;
  pairedAt: number;
}

export interface PairingStatus {
  enabled: boolean;
  listening: "loopback" | "network";
  restartRequired: boolean;
  pending: boolean;
  devices: Array<{ id: string; name: string; pairedAt: number; lastSeen?: number }>;
  addresses: string[];
}

const CODE_TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;
const MAX_DEVICES = 16;
const MAX_NAME = 60;

let pending: { code: string; token: string; expires: number; tries: number } | null = null;

let boundToNetwork = false;

const seen = new Map<string, number>();

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

function isDevice(value: unknown): value is PairedDevice {
  const d = value as PairedDevice | null;
  return (
    typeof d === "object" &&
    d !== null &&
    typeof d.id === "string" &&
    typeof d.name === "string" &&
    typeof d.hash === "string" &&
    /^[0-9a-f]{64}$/.test(d.hash) &&
    typeof d.pairedAt === "number"
  );
}

export function pairedDevices(): PairedDevice[] {
  return devices();
}

function devices(): PairedDevice[] {
  const list = loadConfig().remote?.devices;
  return Array.isArray(list) ? list.filter(isDevice) : [];
}

function putDevices(list: PairedDevice[]): void {
  saveConfig({ remote: { ...loadConfig().remote, devices: list } });
}

export function remoteEnabled(): boolean {
  return loadConfig().remote?.enabled === true;
}

export function setRemoteEnabled(on: boolean): void {
  saveConfig({ remote: { ...loadConfig().remote, enabled: on } });
  if (!on) pending = null;
}

export function bindHost(): string {
  return remoteEnabled() ? "0.0.0.0" : "127.0.0.1";
}

export function noteBound(host: string): void {
  boundToNetwork = host !== "127.0.0.1";
}

export function startPairing(ttlMs: number = CODE_TTL_MS): {
  code: string;
  token: string;
  expiresAt: number;
} {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const token = `workmates_pair_${randomBytes(24).toString("base64url")}`;
  pending = { code, token, expires: Date.now() + ttlMs, tries: 0 };
  return { code, token, expiresAt: pending.expires };
}

export function cancelPairing(): void {
  pending = null;
}

export function pairingPending(): boolean {
  return Boolean(pending && Date.now() <= pending.expires);
}

function cleanName(value: unknown): string {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return (name || "A device").slice(0, MAX_NAME);
}

export function claimPairing(
  code: unknown,
  name: unknown,
): { token: string; device: Omit<PairedDevice, "hash"> } | null {
  if (!pending || Date.now() > pending.expires) {
    pending = null;
    return null;
  }
  if (++pending.tries > MAX_ATTEMPTS) {
    pending = null;
    return null;
  }
  const offered = typeof code === "string" ? code : "";
  const matches =
    (offered.length === pending.code.length && sameSecret(offered, pending.code)) ||
    (offered.length === pending.token.length && sameSecret(offered, pending.token));
  if (!matches) return null;

  pending = null;
  const token = randomBytes(32).toString("base64url");
  const device: PairedDevice = {
    id: randomBytes(8).toString("hex"),
    name: cleanName(name),
    hash: sha256(token),
    pairedAt: Date.now(),
  };
  const list = [...devices(), device].slice(-MAX_DEVICES);
  putDevices(list);
  const { hash: _hash, ...safe } = device;
  return { token, device: safe };
}

export function deviceForToken(token: string | null): PairedDevice | null {
  if (!token) return null;
  const digest = sha256(token);
  for (const device of devices()) {
    if (typeof device?.hash === "string" && sameSecret(digest, device.hash)) {
      seen.set(device.id, Date.now());
      return device;
    }
  }
  return null;
}

export function revokeDevice(id: string): boolean {
  const list = devices();
  const left = list.filter((d) => d.id !== id);
  if (left.length === list.length) return false;
  putDevices(left);
  seen.delete(id);
  return true;
}

export function revokeAll(): void {
  putDevices([]);
  seen.clear();
}

export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      if (entry.address.startsWith("169.254.")) continue;
      out.push(entry.address);
    }
  }
  return out;
}

export function pairingStatus(): PairingStatus {
  const enabled = remoteEnabled();
  return {
    enabled,
    listening: boundToNetwork ? "network" : "loopback",
    restartRequired: enabled !== boundToNetwork,
    pending: pairingPending(),
    devices: devices().map((d) => ({
      id: d.id,
      name: d.name,
      pairedAt: d.pairedAt,
      ...(seen.has(d.id) ? { lastSeen: seen.get(d.id) } : {}),
    })),
    addresses: enabled ? lanAddresses() : [],
  };
}

import { copyFileSync, existsSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export interface ImportedCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expires?: number;
}

const SERVICE: Record<string, string> = {
  Chrome: "Chrome Safe Storage",
  Brave: "Brave Safe Storage",
  Edge: "Microsoft Edge Safe Storage",
};

export function cookieStores(): Array<{ browser: string; path: string }> {
  const home = homedir();
  const mac = (vendor: string, app: string) =>
    join(home, "Library", "Application Support", vendor, app, "Default", "Cookies");
  const candidates =
    process.platform === "darwin"
      ? [
          { browser: "Chrome", path: mac("Google", "Chrome") },
          { browser: "Brave", path: mac("BraveSoftware", "Brave-Browser") },
          { browser: "Edge", path: mac("Microsoft", "Edge") },
        ]
      : process.platform === "linux"
        ? [{ browser: "Chrome", path: join(home, ".config", "google-chrome", "Default", "Cookies") }]
        : [
            {
              browser: "Chrome",
              path: join(
                home,
                "AppData",
                "Local",
                "Google",
                "Chrome",
                "User Data",
                "Default",
                "Network",
                "Cookies",
              ),
            },
          ];
  return candidates.filter((entry) => existsSync(entry.path));
}

export function safeStorageKey(browser: string): Promise<string> {
  const service = SERVICE[browser];
  if (process.platform !== "darwin" || !service) {
    return Promise.resolve("peanuts");
  }
  return new Promise((resolve, reject) => {
    execFile(
      "security",
      ["find-generic-password", "-w", "-s", service, "-a", browser],
      { timeout: 60_000 },
      (error, stdout) => {
        if (error) reject(new Error(`could not read the ${browser} key from your keychain`));
        else resolve(stdout.trim());
      },
    );
  });
}

const IV = Buffer.alloc(16, 0x20);

export function decryptValue(encrypted: Buffer, passphrase: string): string | null {
  if (!encrypted.length) return "";
  const version = encrypted.subarray(0, 3).toString();
  if (version !== "v10" && version !== "v11") return encrypted.toString("utf8");
  const iterations = process.platform === "darwin" ? 1003 : 1;
  const key = pbkdf2Sync(passphrase, "saltysalt", iterations, 16, "sha1");
  try {
    const decipher = createDecipheriv("aes-128-cbc", key, IV);
    decipher.setAutoPadding(false);
    const plain = Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()]);
    const pad = plain[plain.length - 1];
    const body = pad > 0 && pad <= 16 ? plain.subarray(0, plain.length - pad) : plain;
    return body.toString("utf8");
  } catch {
    return null;
  }
}

export function matchesSite(cookieDomain: string, site: string): boolean {
  const host = cookieDomain.replace(/^\./, "").toLowerCase();
  const wanted = site
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .replace(/^\./, "")
    .toLowerCase();
  if (!wanted || !host) return false;
  return host === wanted || host.endsWith(`.${wanted}`);
}

export async function readCookies(
  storePath: string,
  browser: string,
  sites: string[],
): Promise<ImportedCookie[]> {
  if (!sites.length) return [];
  const passphrase = await safeStorageKey(browser);
  const copy = join(tmpdir(), `workmates-cookies-${process.pid}.sqlite`);
  copyFileSync(storePath, copy);
  try {
    const db = new DatabaseSync(copy, { readOnly: true });
    const rows = db
      .prepare(
        "SELECT host_key, name, encrypted_value, path, is_secure, is_httponly, expires_utc FROM cookies",
      )
      .all() as Array<Record<string, unknown>>;
    db.close();

    const out: ImportedCookie[] = [];
    for (const row of rows) {
      const domain = String(row.host_key ?? "");
      if (!sites.some((site) => matchesSite(domain, site))) continue;
      const value = decryptValue(Buffer.from((row.encrypted_value as Uint8Array) ?? []), passphrase);
      if (value === null) continue;
      const expires = Number(row.expires_utc ?? 0);
      out.push({
        name: String(row.name ?? ""),
        value,
        domain,
        path: String(row.path ?? "/"),
        secure: Boolean(row.is_secure),
        httpOnly: Boolean(row.is_httponly),
        ...(expires ? { expires: Math.floor(expires / 1_000_000 - 11_644_473_600) } : {}),
      });
    }
    return out;
  } finally {
    rmSync(copy, { force: true });
  }
}

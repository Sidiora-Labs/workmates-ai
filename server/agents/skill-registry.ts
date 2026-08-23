import { createHash } from "node:crypto";

export const REGISTRY_URL = "https://supabase.paxeer.app/storage/v1/object/public/json/index.json";

export const CATALOG_TTL_MS = 30 * 60 * 1000;

export const MAX_CATALOG_BYTES = 512 * 1024;
export const MAX_ENTRY_BODY = 16_000;

export interface RegistryEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  tags: string[];
  body: string;
  sha256: string;
  author?: string;
}

export function hashBody(body: string): string {
  return createHash("sha256").update(body.trim(), "utf8").digest("hex");
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function parseCatalog(value: unknown): RegistryEntry[] {
  const list = Array.isArray((value as any)?.skills) ? (value as any).skills : value;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: RegistryEntry[] = [];
  for (const raw of list) {
    if (typeof raw !== "object" || raw === null) continue;
    const entry = raw as Record<string, unknown>;
    const id = typeof entry.id === "string" ? entry.id.trim().toLowerCase() : "";
    const body = typeof entry.body === "string" ? entry.body.trim() : "";
    if (!SLUG.test(id) || seen.has(id) || !body) continue;
    if (Buffer.byteLength(body, "utf8") > MAX_ENTRY_BODY) continue;
    seen.add(id);
    out.push({
      id,
      name: (typeof entry.name === "string" ? entry.name : id).trim().slice(0, 80) || id,
      description: (typeof entry.description === "string" ? entry.description : "").trim().slice(0, 200),
      version: (typeof entry.version === "string" ? entry.version : "1").trim().slice(0, 24) || "1",
      tags: Array.isArray(entry.tags)
        ? entry.tags.filter((t): t is string => typeof t === "string").slice(0, 8).map((t) => t.slice(0, 24))
        : [],
      body,
      sha256: hashBody(body),
      ...(typeof entry.author === "string" ? { author: entry.author.slice(0, 60) } : {}),
    });
  }
  return out;
}

export interface InstalledMark {
  registry?: string;
  version?: string;
  sha256?: string;
}

export type SkillState =
  | "available"
  | "current"
  | "outdated"
  | "edited"
  | "edited-and-outdated"
  | "yours"
  | "bundled";

export interface Standing {
  state: SkillState;
  says: string;
  action: string | null;
  destructive: boolean;
}

export function standing(
  entry: RegistryEntry,
  installed: { body: string; source?: "builtin" | "user" } | null,
  mark: InstalledMark | null,
): Standing {
  if (!installed) {
    return { state: "available", says: "Not installed", action: "Install", destructive: false };
  }
  if (installed.source === "builtin") {
    return {
      state: "bundled",
      says: "Workmates ships a skill with this name. Installing the catalog's shadows it, and removing that copy brings the bundled one back",
      action: "Install",
      destructive: false,
    };
  }
  const here = hashBody(installed.body);

  if (!mark?.registry || !mark.sha256) {
    return {
      state: "yours",
      says: "You have a skill with this name that you wrote yourself",
      action: "Replace",
      destructive: true,
    };
  }

  const edited = here !== mark.sha256;
  const behind = entry.sha256 !== mark.sha256;

  if (edited && behind) {
    return {
      state: "edited-and-outdated",
      says: `You have changed this, and version ${entry.version} has since been published`,
      action: "Replace",
      destructive: true,
    };
  }
  if (edited) {
    return {
      state: "edited",
      says: "You have changed this since installing it. Restoring puts the catalog's version back and drops your edits",
      action: "Restore",
      destructive: true,
    };
  }
  if (behind) {
    return {
      state: "outdated",
      says: `Version ${entry.version} is available`,
      action: "Update",
      destructive: false,
    };
  }
  return { state: "current", says: `Up to date, version ${mark.version ?? entry.version}`, action: null, destructive: false };
}

export interface Listing extends RegistryEntry {
  standing: Standing;
}

export function listing(
  catalog: RegistryEntry[],
  installed: Map<string, { body: string; source?: "builtin" | "user" } & InstalledMark>,
): Listing[] {
  return catalog.map((entry) => {
    const here = installed.get(entry.id) ?? null;
    return {
      ...entry,
      standing: standing(entry, here, here),
    };
  });
}

export function updateCount(entries: Listing[]): number {
  return entries.filter((entry) => entry.standing.state === "outdated").length;
}

export function markFor(entry: RegistryEntry): Required<InstalledMark> {
  return { registry: entry.id, version: entry.version, sha256: entry.sha256 };
}

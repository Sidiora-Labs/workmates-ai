import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { InstanceConfigMap } from "./contracts.ts";
import { CUSTOM_SPEC, PROVIDER_SPECS, specFor } from "../integrations/providers.ts";

export interface ProviderConfig {
  key?: string;
  url?: string;
}

export interface CustomKey {
  id: string;
  label?: string;
  key: string;
}

export interface CustomEndpoint {
  id: string;
  name: string;
  url: string;
  keys: CustomKey[];
  activeKeyId?: string;
}

export interface AppConfig {
  providers?: Record<string, ProviderConfig>;
  xai?: { key?: string; url?: string };
  composio?: { key?: string; apiKey?: string; url?: string };
  speech?: {
    elevenlabsKey?: string;
    openaiKey?: string;
    useDiscoveredOpenAI?: boolean;
  };
  box?: { token?: string };
  shortcuts?: { quickAsk?: string | null };
  custom?: CustomEndpoint[];
  telegram?: {
    token?: string;
    chatIds?: number[];
    botId?: string;
    pairing?: string | null;
    offset?: number;
    enabled?: boolean;
  };
  mcpServers?: Array<{
    id: string;
    name: string;
    transport: "stdio" | "http";
    command?: string;
    args?: string[];
    url?: string;
    headers?: Record<string, string>;
  }>;
  secrets?: Record<string, string>;
  setupDoneAt?: number;
  profile?: { about?: string };
  compaction?: { micro?: boolean };
  skills?: { propose?: boolean };
  relay?: { url?: string; agentToken?: string; clientToken?: string; enabled?: boolean };
  remote?: { enabled?: boolean; devices?: unknown[] };
  instances?: InstanceConfigMap;
}

export const DATA_DIR = process.env.WORKMATES_DATA_DIR
  ? resolve(process.env.WORKMATES_DATA_DIR)
  : join(homedir(), ".workmates");
export const EVENTS_DIR = join(DATA_DIR, "events");
export const NATIVE_DIR = join(DATA_DIR, "native");
export const SKILLS_DIR = join(DATA_DIR, "skills");
export const AVATARS_DIR = join(DATA_DIR, "avatars");

export const APP_VERSION: string = (() => {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const up of ["..", "../..", "../../.."]) {
    try {
      const version = JSON.parse(readFileSync(join(here, up, "package.json"), "utf8")).version;
      if (typeof version === "string" && version) return version;
    } catch {
    }
  }
  return "";
})();

function adoptFormerWorkspace() {
  if (process.env.WORKMATES_DATA_DIR) return;
  const former = join(homedir(), ".bloks");
  if (existsSync(DATA_DIR) || !existsSync(former)) return;
  try {
    renameSync(former, DATA_DIR);
    console.log(`[workmates] moved the workspace at ${former} to ${DATA_DIR}`);
  } catch {
  }
}

export function ensureDirs() {
  adoptFormerWorkspace();
  for (const dir of [DATA_DIR, EVENTS_DIR, NATIVE_DIR, SKILLS_DIR]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  try {
    chmodSync(DATA_DIR, 0o700);
    chmodSync(join(DATA_DIR, "config.json"), 0o600);
  } catch {
  }
}

export function loadConfig(): AppConfig {
  let cfg: AppConfig = {};
  try {
    cfg = JSON.parse(readFileSync(join(DATA_DIR, "config.json"), "utf8"));
  } catch {
  }
  cfg.xai = { key: process.env.XAI_API_KEY, ...cfg.xai };
  cfg.composio = { key: process.env.COMPOSIO_KEY, ...cfg.composio };
  cfg.box = { token: process.env.BOX_TOKEN, ...cfg.box };
  cfg.providers = { ...cfg.providers };
  for (const spec of PROVIDER_SPECS) {
    const fromEnv = process.env[envVarFor(spec.kind)];
    if (fromEnv) cfg.providers[spec.kind] = { key: fromEnv, ...cfg.providers[spec.kind] };
  }
  if (cfg.xai?.key && !cfg.providers.grok?.key) {
    cfg.providers.grok = { key: cfg.xai.key, ...(cfg.xai.url ? { url: cfg.xai.url } : {}) };
  }
  return cfg;
}

export function envVarFor(kind: string): string {
  return `${kind.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
}

export function connectedProviders(cfg: AppConfig): string[] {
  return PROVIDER_SPECS.filter((spec) => {
    const entry = cfg.providers?.[spec.kind];
    return spec.auth === "none" ? Boolean(entry) : Boolean(entry?.key);
  }).map((spec) => spec.kind);
}

export function saveConfig(patch: Partial<AppConfig>): void {
  const p = join(DATA_DIR, "config.json");
  let disk: Record<string, unknown> = {};
  try {
    disk = JSON.parse(readFileSync(p, "utf8"));
  } catch {
  }
  for (const key of [
    "xai",
    "composio",
    "box",
    "profile",
    "providers",
    "remote",
    "speech",
    "secrets",
    "relay",
    "shortcuts",
    "compaction",
    "skills",
    "telegram",
  ] as const) {
    if (patch[key] && typeof patch[key] === "object") {
      disk[key] = { ...(disk[key] as object), ...patch[key] };
    }
  }
  if (Array.isArray((patch as Record<string, unknown>).mcpServers)) {
    disk.mcpServers = (patch as Record<string, unknown>).mcpServers;
  }
  if (Array.isArray((patch as Record<string, unknown>).custom)) {
    disk.custom = (patch as Record<string, unknown>).custom;
  }
  if (typeof (patch as Record<string, unknown>).setupDoneAt === "number") {
    disk.setupDoneAt = (patch as Record<string, unknown>).setupDoneAt;
  }
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(p, JSON.stringify(disk, null, 2), { mode: 0o600 });
  try {
    chmodSync(p, 0o600);
  } catch {
  }
}

export function disconnectProvider(kind: string): void {
  const p = join(DATA_DIR, "config.json");
  let disk: Record<string, any> = {};
  try {
    disk = JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return;
  }
  if (disk.providers) delete disk.providers[kind];
  if (kind === "grok") delete disk.xai;
  writeFileSync(p, JSON.stringify(disk, null, 2), { mode: 0o600 });
  try {
    chmodSync(p, 0o600);
  } catch {
  }
}

const BUILT_IN_CLI_INSTANCES: InstanceConfigMap = {
  claude: { driver: "claudeAgent" },
  codex: { driver: "codex" },
  gemini_cli: { driver: "geminiCli" },
  opencode: { driver: "opencode" },
  grok_cli: { driver: "grokCli" },
  antigravity: { driver: "antigravity" },
  pi: { driver: "pi" },
  computer: { driver: "boxAgent" },
};

export function instanceConfigs(cfg: AppConfig): InstanceConfigMap {
  const map: InstanceConfigMap =
    cfg.instances && Object.keys(cfg.instances).length
      ? { ...cfg.instances }
      : Object.fromEntries(
          Object.entries(BUILT_IN_CLI_INSTANCES).map(([id, entry]) => [id, { ...entry }]),
        );
  for (const [id, entry] of Object.entries(BUILT_IN_CLI_INSTANCES)) {
    if (Object.values(map).some((e) => e.driver === entry.driver)) continue;
    map[id] = { ...entry };
  }
  for (const kind of connectedProviders(cfg)) {
    if (Object.values(map).some((e) => e.driver === kind)) continue;
    const spec = specFor(kind);
    map[kind] = {
      driver: kind,
      displayName: spec?.name,
      ...(cfg.providers?.[kind]?.url ? { config: { url: cfg.providers[kind].url } } : {}),
    };
  }
  for (const endpoint of cfg.custom ?? []) {
    const cred = activeCustomKey(endpoint);
    if (!endpoint.url || !cred?.key) continue;
    map[customInstanceId(endpoint.id)] = {
      driver: CUSTOM_SPEC.kind,
      displayName: endpoint.name,
      config: { url: endpoint.url },
      environment: { [envVarFor(CUSTOM_SPEC.kind)]: cred.key },
    };
  }
  for (const entry of Object.values(map)) {
    entry.environment = {
      ...cfg.secrets,
      ...Object.fromEntries(
        Object.entries(cfg.providers ?? {})
          .filter(([, v]) => v?.key)
          .map(([kind, v]) => [envVarFor(kind), v.key!]),
      ),
      ...(cfg.xai?.key ? { XAI_API_KEY: cfg.xai.key } : {}),
      ...(cfg.box?.token ? { BOX_TOKEN: cfg.box.token } : {}),
      ...entry.environment,
    };
  }
  return map;
}

export function customInstanceId(endpointId: string): string {
  return `custom_${endpointId}`;
}

export function activeCustomKey(endpoint: CustomEndpoint): CustomKey | undefined {
  if (endpoint.activeKeyId) {
    const named = endpoint.keys.find((k) => k.id === endpoint.activeKeyId && k.key);
    if (named) return named;
  }
  return endpoint.keys.find((k) => k.key);
}

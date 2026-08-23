const TOKEN_FORMATS = [
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bxai-[A-Za-z0-9]{16,}/g,
  /\bck_[A-Za-z0-9_-]{10,}/g,
  /\bak_[A-Za-z0-9_-]{10,}/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abposr]-[A-Za-z0-9-]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\bnpm_[A-Za-z0-9]{20,}/g,
];

const KEYED_VALUE =
  /\b([A-Za-z0-9_.-]*(?:api[_-]?key|apikey|secret|token|password|credential)s?)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s"',;)\]}]+)/gi;

const BEARER = /(\bbearer\s+)([A-Za-z0-9._~+/=-]{8,})/gi;

const mask = () => "«redacted»";

export function scrubSecrets(text: string): string {
  let out = String(text ?? "");
  out = out.replace(KEYED_VALUE, (_whole, key: string) => `${key}=${mask()}`);
  out = out.replace(BEARER, (_whole, lead: string) => `${lead}${mask()}`);
  for (const format of TOKEN_FORMATS) out = out.replace(format, mask);
  return out;
}

export interface DiagnosticsFacts {
  version: string;
  platform: string;
  arch: string;
  node: string;
  uptimeSeconds: number;
  config: unknown;
  engines: Array<{ name: string; connected: boolean; agentic: boolean }>;
  counts: { agents: number; rooms: number; skills: number };
}

export function diagnosticsReport(facts: DiagnosticsFacts): string {
  const lines = [
    "## Workmates diagnostics",
    "",
    `- Version: ${facts.version}`,
    `- Platform: ${facts.platform} ${facts.arch}, Node ${facts.node}`,
    `- Server uptime: ${Math.round(facts.uptimeSeconds)}s`,
    `- Agents: ${facts.counts.agents}, rooms: ${facts.counts.rooms}, skills: ${facts.counts.skills}`,
    "",
    "### Engines",
    ...facts.engines.map(
      (engine) =>
        `- ${engine.name}: ${engine.connected ? "connected" : "not connected"}${engine.agentic ? "" : " (chat only)"}`,
    ),
    "",
    "### Configured credentials (presence only, never values)",
    "```json",
    JSON.stringify(facts.config, null, 2),
    "```",
  ];
  return scrubSecrets(lines.join("\n"));
}

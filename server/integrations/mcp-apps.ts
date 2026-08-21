import type { McpResource, McpResourceContents, McpTool } from "./mcp-client.ts";

export interface McpApp {
  uri: string;
  name: string;
  description: string;
}

export const MAX_APP_BYTES = 1024 * 1024;

export function isApp(resource: Pick<McpResource, "uri" | "mimeType">): boolean {
  if (typeof resource?.uri !== "string") return false;
  if (resource.uri.startsWith("ui://")) return true;
  return resource.mimeType === "text/html" || resource.mimeType === "text/html+skybridge";
}

export function appFrom(resource: McpResource): McpApp {
  const tail = resource.uri.split(/[/?#]/).filter(Boolean).pop() ?? resource.uri;
  const fallback = tail.replace(/[-_]+/g, " ").replace(/\.\w+$/, "").trim();
  return {
    uri: resource.uri,
    name: (resource.name || fallback || resource.uri).slice(0, 80),
    description: (resource.description ?? "").slice(0, 200),
  };
}

export function appsIn(resources: McpResource[]): McpApp[] {
  return resources.filter(isApp).map(appFrom);
}

export function documentIn(parts: McpResourceContents[]): string | null {
  for (const part of parts) {
    if (typeof part.text === "string" && part.text.trim()) {
      return part.text.slice(0, MAX_APP_BYTES);
    }
    if (typeof part.blob === "string" && part.blob) {
      const decoded = Buffer.from(part.blob, "base64");
      if (decoded.length && decoded.length <= MAX_APP_BYTES) return decoded.toString("utf8");
    }
  }
  return null;
}

export const APP_CSP =
  "default-src 'none'; " +
  "script-src 'unsafe-inline' 'unsafe-eval'; " +
  "style-src 'unsafe-inline'; " +
  "img-src data: blob:; " +
  "font-src data:; " +
  "media-src data: blob:; " +
  "form-action 'none'; " +
  "base-uri 'none'; " +
  "frame-src 'none'; " +
  "connect-src 'none'";

export interface AppTheme {
  scheme: "dark" | "light";
  background: string;
  foreground: string;
  muted: string;
  border: string;
  accent: string;
}

const CSS_COLOR = /^[#a-zA-Z0-9(),.%\s/-]{0,64}$/;

function safeColor(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text && CSS_COLOR.test(text) ? text : fallback;
}

export function themeFrom(value: unknown): AppTheme {
  const v = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const dark = v.scheme === "dark";
  return {
    scheme: dark ? "dark" : "light",
    background: safeColor(v.background, dark ? "#232326" : "#ffffff"),
    foreground: safeColor(v.foreground, dark ? "#f2f2f5" : "#1d1d1f"),
    muted: safeColor(v.muted, dark ? "#a1a1aa" : "#66666e"),
    border: safeColor(v.border, dark ? "#3a3a40" : "#e6e6e9"),
    accent: safeColor(v.accent, dark ? "#8f9bff" : "#4a59e6"),
  };
}

export function frameDocument(html: string, theme: AppTheme): string {
  return [
    "<!doctype html><html><head>",
    `<meta http-equiv="Content-Security-Policy" content="${APP_CSP}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta name="color-scheme" content="${theme.scheme}">`,
    "<style>",
    ":root{",
    `color-scheme:${theme.scheme};`,
    `--workmates-bg:${theme.background};`,
    `--workmates-fg:${theme.foreground};`,
    `--workmates-muted:${theme.muted};`,
    `--workmates-border:${theme.border};`,
    `--workmates-accent:${theme.accent};`,
    "}",
    "html,body{margin:0;padding:0;",
    `background:${theme.background};color:${theme.foreground};`,
    'font:14px/1.5 ui-sans-serif,-apple-system,system-ui,"Segoe UI",sans-serif;}',
    "</style>",
    "</head><body>",
    html,
    "</body></html>",
  ].join("");
}

export type AppMessage =
  | { kind: "tool"; tool: string; args: Record<string, unknown> }
  | { kind: "prompt"; text: string }
  | { kind: "notify"; text: string }
  | { kind: "link"; href: string }
  | { kind: "size"; height: number };

export const MAX_PROMPT_CHARS = 4_000;

export function parseAppMessage(value: unknown): AppMessage | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, any>;
  const type = typeof v.type === "string" ? v.type : "";
  const payload = (typeof v.payload === "object" && v.payload !== null ? v.payload : v) as Record<string, any>;

  if (type === "tool") {
    const tool = typeof payload.toolName === "string" ? payload.toolName : payload.name;
    if (typeof tool !== "string" || !tool.trim()) return null;
    const args = typeof payload.params === "object" && payload.params !== null
      ? payload.params
      : typeof payload.arguments === "object" && payload.arguments !== null
        ? payload.arguments
        : {};
    return { kind: "tool", tool: tool.slice(0, 120), args: args as Record<string, unknown> };
  }
  if (type === "prompt" || type === "intent") {
    const text = typeof payload.prompt === "string" ? payload.prompt : payload.text;
    if (typeof text !== "string" || !text.trim()) return null;
    return { kind: "prompt", text: text.slice(0, MAX_PROMPT_CHARS) };
  }
  if (type === "notify") {
    const text = typeof payload.message === "string" ? payload.message : payload.text;
    if (typeof text !== "string" || !text.trim()) return null;
    return { kind: "notify", text: text.slice(0, 300) };
  }
  if (type === "link") {
    const href = typeof payload.url === "string" ? payload.url : payload.href;
    if (typeof href !== "string" || !/^https?:\/\//i.test(href)) return null;
    return { kind: "link", href: href.slice(0, 2_000) };
  }
  if (type === "size" || type === "ui-size-change") {
    const height = Number(payload.height);
    if (!Number.isFinite(height)) return null;
    return { kind: "size", height: Math.max(120, Math.min(4_000, Math.round(height))) };
  }
  return null;
}

export function textOf(result: unknown): string {
  const content = (result as any)?.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part: any) => part?.type === "text" && typeof part.text === "string")
    .map((part: any) => part.text)
    .join("\n")
    .slice(0, 4_000);
}

export function allowsTool(tools: McpTool[], name: string): boolean {
  return tools.some((tool) => tool.name === name);
}

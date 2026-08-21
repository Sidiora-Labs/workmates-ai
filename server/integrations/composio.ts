import type { AppConfig } from "../core/config.ts";

const MCP_ENDPOINT = "https://connect.composio.dev/mcp";
const CATALOG_ENDPOINT = "https://backend.composio.dev/api/v3";

const CONNECTIONS_TOOL = "COMPOSIO_MANAGE_CONNECTIONS";

function unwrapMcp(body: string): any {
  const envelope = body.startsWith("{")
    ? body
    : body
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice("data: ".length);
  if (!envelope) throw new Error("the connector service returned nothing");

  const message = JSON.parse(envelope);
  if (message.error) throw new Error(message.error.message || "connector service error");

  const inner = message.result?.content?.find((part: any) => part.type === "text")?.text;
  if (!inner) return message.result ?? null;
  try {
    return JSON.parse(inner);
  } catch {
    return { text: inner };
  }
}

export interface McpAccess {
  key: string;
  url?: string;
}

async function mcpRequest(access: McpAccess, method: string, params: unknown): Promise<string> {
  const response = await fetch(access.url || MCP_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "x-consumer-api-key": access.key,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`connector service: HTTP ${response.status}`);
  return response.text();
}

function mcpResult(body: string): any {
  const envelope = body.startsWith("{")
    ? body
    : body
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice("data: ".length);
  if (!envelope) throw new Error("the connector service returned nothing");
  const message = JSON.parse(envelope);
  if (message.error) throw new Error(message.error.message || "connector service error");
  return message.result ?? null;
}

export async function listMcpTools(
  access: McpAccess,
): Promise<Array<{ name: string; description: string; inputSchema: unknown }>> {
  const result = mcpResult(await mcpRequest(access, "tools/list", {}));
  const tools = Array.isArray(result?.tools) ? result.tools : [];
  return tools
    .filter((tool: any) => typeof tool?.name === "string")
    .map((tool: any) => ({
      name: tool.name,
      description: typeof tool.description === "string" ? tool.description : "",
      inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
    }));
}

export async function callMcpTool(access: McpAccess, name: string, args: unknown): Promise<string> {
  const result = mcpResult(
    await mcpRequest(access, "tools/call", { name, arguments: args ?? {} }),
  );
  const text = (result?.content ?? [])
    .filter((part: any) => part?.type === "text" && typeof part.text === "string")
    .map((part: any) => part.text)
    .join("\n");
  return text || JSON.stringify(result ?? null);
}

async function callMcp(cfg: AppConfig, tool: string, args: unknown) {
  const key = cfg.composio?.key;
  if (!key) {
    throw new Error('no connector key configured. Add {"composio":{"key":"ck_…"}} to ~/.workmates/config.json');
  }
  const body = await mcpRequest({ key, url: cfg.composio?.url }, "tools/call", {
    name: tool,
    arguments: args,
  });
  return unwrapMcp(body);
}

export function keyVerdict(status: number): boolean | null {
  if (status >= 200 && status < 300) return true;
  if (status === 401 || status === 403) return false;
  return null;
}

export async function validateConnectKey(cfg: AppConfig, key: string): Promise<boolean | null> {
  try {
    const response = await fetch(cfg.composio?.url || MCP_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "x-consumer-api-key": key,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      signal: AbortSignal.timeout(10_000),
    });
    return keyVerdict(response.status);
  } catch {
    return null;
  }
}

export async function validateApiKey(apiKey: string): Promise<boolean | null> {
  try {
    const response = await fetch(`${CATALOG_ENDPOINT}/toolkits?limit=1`, {
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(10_000),
    });
    return keyVerdict(response.status);
  } catch {
    return null;
  }
}

function manageConnections(cfg: AppConfig, slug: string, action: string, extra: object = {}) {
  return callMcp(cfg, CONNECTIONS_TOOL, { toolkits: [{ name: slug, action, ...extra }] });
}

function accountsIn(payload: any, slug: string): any[] {
  return payload?.data?.results?.[slug]?.accounts ?? [];
}

export interface ConnectorState {
  connected: boolean;
  status: string;
}

export async function connectorStates(
  cfg: AppConfig,
  slugs: string[],
): Promise<Record<string, ConnectorState>> {
  const payload = await callMcp(cfg, CONNECTIONS_TOOL, {
    toolkits: slugs.map((name) => ({ name, action: "list" })),
  });
  const results = payload?.data?.results ?? {};

  const states: Record<string, ConnectorState> = {};
  for (const slug of slugs) {
    const entry = results[slug];
    const liveAccount = (entry?.accounts ?? []).some((account: any) =>
      /active/i.test(account.status ?? ""),
    );
    const liveService = /^active$/i.test(entry?.status ?? "");
    states[slug] = {
      connected: liveAccount || liveService,
      status: entry?.status ?? "unknown",
    };
  }
  return states;
}

export async function disconnectConnector(cfg: AppConfig, slug: string) {
  const listed = await manageConnections(cfg, slug, "list");
  const ids = accountsIn(listed, slug)
    .map((account: any) => account.id ?? account.account_id ?? account.nanoid)
    .filter(Boolean);

  for (const id of ids) {
    await manageConnections(cfg, slug, "remove", { account_id: id });
  }
  return { removed: ids.length };
}

export async function beginConnectorAuth(cfg: AppConfig, slug: string) {
  const payload = await manageConnections(cfg, slug, "add");
  const candidates = JSON.stringify(payload).match(/https:\/\/[^"\\\s]+/g) ?? [];
  const url = candidates.find((u) => /composio|connect|auth/i.test(u)) ?? candidates[0];
  if (!url) throw new Error(`no sign-in link came back for ${slug}`);
  return { url };
}

export interface ConnectorCard {
  slug: string;
  label: string;
  blurb: string;
  logo: string | null;
  domain: string | null;
}

const SHIPPED: ConnectorCard[] = [
  { slug: "slack", label: "Slack", blurb: "Read channels, post updates", domain: "slack.com", logo: null },
  { slug: "github", label: "GitHub", blurb: "Issues, pull requests, code", domain: "github.com", logo: null },
  { slug: "gmail", label: "Gmail", blurb: "Send and read mail", domain: "gmail.com", logo: null },
  { slug: "googlecalendar", label: "Google Calendar", blurb: "Check and book time", domain: "calendar.google.com", logo: null },
  { slug: "googlesheets", label: "Google Sheets", blurb: "Read and update sheets", domain: "sheets.google.com", logo: null },
  { slug: "googledocs", label: "Google Docs", blurb: "Draft and revise documents", domain: "docs.google.com", logo: null },
  { slug: "googledrive", label: "Google Drive", blurb: "Find and organise files", domain: "drive.google.com", logo: null },
  { slug: "outlook", label: "Outlook", blurb: "Mail and calendar, Microsoft side", domain: "outlook.com", logo: null },
  { slug: "microsoft_teams", label: "Microsoft Teams", blurb: "Chats, channels, meetings", domain: "teams.microsoft.com", logo: null },
  { slug: "excel", label: "Excel", blurb: "Read and update workbooks", domain: "microsoft.com", logo: null },
  { slug: "one_drive", label: "OneDrive", blurb: "Files and folders, Microsoft side", domain: "onedrive.live.com", logo: null },
  { slug: "notion", label: "Notion", blurb: "Pages and databases", domain: "notion.so", logo: null },
  { slug: "linear", label: "Linear", blurb: "Track issues and cycles", domain: "linear.app", logo: null },
  { slug: "whatsapp", label: "WhatsApp", blurb: "Business messages", domain: "whatsapp.com", logo: null },
  { slug: "instagram", label: "Instagram", blurb: "Posts, stories, audience", domain: "instagram.com", logo: null },
  { slug: "facebook", label: "Facebook", blurb: "Pages and posts", domain: "facebook.com", logo: null },
  { slug: "sentry", label: "Sentry", blurb: "Errors as they happen", domain: "sentry.io", logo: null },
  { slug: "posthog", label: "PostHog", blurb: "Product analytics and flags", domain: "posthog.com", logo: null },
  { slug: "discord", label: "Discord", blurb: "Channels and messages", domain: "discord.com", logo: null },
  { slug: "x", label: "X (Twitter)", blurb: "Read and post", domain: "x.com", logo: null },
  { slug: "reddit", label: "Reddit", blurb: "Follow and post to subreddits", domain: "reddit.com", logo: null },
  { slug: "zapier", label: "Zapier", blurb: "Reach thousands of other apps", domain: "zapier.com", logo: null },
  { slug: "hubspot", label: "HubSpot", blurb: "Contacts and deals", domain: "hubspot.com", logo: null },
  { slug: "salesforce", label: "Salesforce", blurb: "Records and reports", domain: "salesforce.com", logo: null },
  { slug: "jira", label: "Jira", blurb: "Tickets and sprints", domain: "atlassian.com", logo: null },
  { slug: "asana", label: "Asana", blurb: "Tasks and projects", domain: "asana.com", logo: null },
  { slug: "trello", label: "Trello", blurb: "Boards and cards", domain: "trello.com", logo: null },
  { slug: "dropbox", label: "Dropbox", blurb: "Files and folders", domain: "dropbox.com", logo: null },
  { slug: "airtable", label: "Airtable", blurb: "Bases and records", domain: "airtable.com", logo: null },
  { slug: "figma", label: "Figma", blurb: "Designs and comments", domain: "figma.com", logo: null },
  { slug: "stripe", label: "Stripe", blurb: "Customers and payments", domain: "stripe.com", logo: null },
];

export const SHIPPED_CONNECTOR_SLUGS = SHIPPED.map((card) => card.slug);

export function connectorCatalogFallback(): ConnectorCard[] {
  return SHIPPED;
}

const CATALOG_TTL_MS = 10 * 60_000;
let cachedCatalog: { fetchedAt: number; cards: ConnectorCard[] } | null = null;

function cardFromApi(row: any): ConnectorCard {
  return {
    slug: String(row.slug ?? row.key ?? row.name ?? "").toLowerCase(),
    label: row.name ?? row.slug ?? "",
    blurb: String(row.meta?.description ?? row.description ?? "").slice(0, 90),
    logo: row.meta?.logo ?? row.logo ?? null,
    domain: null,
  };
}

export async function connectorCatalog(
  cfg: AppConfig,
): Promise<{ cards: ConnectorCard[]; source: "api" | "curated" }> {
  if (cachedCatalog && Date.now() - cachedCatalog.fetchedAt < CATALOG_TTL_MS) {
    return { cards: cachedCatalog.cards, source: "api" };
  }

  const key = cfg.composio?.apiKey ?? cfg.composio?.key;
  if (key) {
    try {
      const response = await fetch(`${CATALOG_ENDPOINT}/toolkits?limit=500&sort_by=usage`, {
        headers: { "x-api-key": key },
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) {
        const body: any = await response.json();
        const rows = body.items ?? body.data ?? [];
        if (Array.isArray(rows) && rows.length) {
          const cards = rows.map(cardFromApi);
          cachedCatalog = { fetchedAt: Date.now(), cards };
          return { cards, source: "api" };
        }
      }
    } catch {
    }
  }
  return { cards: SHIPPED, source: "curated" };
}

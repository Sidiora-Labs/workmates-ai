import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import { attachRpc, type RpcLink } from "../harness/jsonrpc-stdio.ts";

export interface McpServerConfig {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpResource {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface McpResourceContents {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
}

const CLIENT_INFO = { name: "workmates", version: "1" };
const PROTOCOL = "2025-06-18";

export const CALL_TIMEOUT_MS = 20_000;
export const IDLE_MS = 5 * 60 * 1000;
export const MAX_RESOURCE_BYTES = 2 * 1024 * 1024;

export interface McpConnection {
  request(method: string, params?: unknown): Promise<any>;
  close(): void;
}

function connectStdio(config: McpServerConfig): McpConnection {
  if (!config.command) throw new Error("that server has no command to run");
  const child = spawn(config.command, config.args ?? [], {
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  }) as ChildProcessWithoutNullStreams;

  let link: RpcLink | null = attachRpc({
    stdin: child.stdin,
    stdout: child.stdout,
    onRequest: (message) => {
      if (message?.id !== undefined) {
        link?.replyError(message.id, -32601, "this client does not serve requests");
      }
    },
    onNotify: () => {},
  });
  child.stderr.resume();

  const close = () => {
    link?.failPending(new Error("the connection closed"));
    link = null;
    try {
      child.kill("SIGTERM");
    } catch {
    }
  };
  child.on("error", (e) => {
    link?.failPending(new Error(`that server would not start: ${e.message}`));
    link = null;
  });
  child.on("exit", () => {
    link?.failPending(new Error("the server exited"));
    link = null;
  });

  return {
    request: (method, params) => {
      if (!link) return Promise.reject(new Error("the server is not running"));
      return link.request(method, params);
    },
    close,
  };
}

export function unwrapFrame(body: string): any {
  const text = body.trim();
  const envelope = text.startsWith("{")
    ? text
    : text
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .find((line) => line.startsWith("{"));
  if (!envelope) throw new Error("that server returned nothing we could read");
  const message = JSON.parse(envelope);
  if (message.error) throw new Error(message.error.message || "that server returned an error");
  return message.result ?? null;
}

function connectHttp(config: McpServerConfig): McpConnection {
  if (!config.url) throw new Error("that server has no address");
  const url = config.url;
  let id = 0;
  let session: string | null = null;
  let closed = false;

  return {
    async request(method, params) {
      if (closed) throw new Error("the connection closed");
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(session ? { "mcp-session-id": session } : {}),
          ...(config.headers ?? {}),
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
      session = response.headers.get("mcp-session-id") ?? session;
      if (!response.ok) throw new Error(`that server answered HTTP ${response.status}`);
      return unwrapFrame(await response.text());
    },
    close() {
      closed = true;
    },
  };
}

interface Held {
  connection: McpConnection;
  ready: Promise<void>;
  usedAt: number;
}

export class McpClient {
  private held = new Map<string, Held>();

  private open(config: McpServerConfig): Held {
    const connection =
      config.transport === "http" ? connectHttp(config) : connectStdio(config);
    const ready = (async () => {
      await McpClient.timed(
        connection.request("initialize", {
          protocolVersion: PROTOCOL,
          capabilities: {},
          clientInfo: CLIENT_INFO,
        }),
        "the handshake",
      );
      await connection.request("notifications/initialized").catch(() => {});
    })();
    const held: Held = { connection, ready, usedAt: Date.now() };
    this.held.set(config.id, held);
    return held;
  }

  private async use(config: McpServerConfig): Promise<McpConnection> {
    let held = this.held.get(config.id);
    if (!held) held = this.open(config);
    held.usedAt = Date.now();
    try {
      await held.ready;
    } catch (e) {
      this.close(config.id);
      throw e;
    }
    return held.connection;
  }

  private static timed<T>(work: Promise<T>, what: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`that server did not answer ${what} in time`)),
        CALL_TIMEOUT_MS,
      );
      work.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  async tools(config: McpServerConfig): Promise<McpTool[]> {
    const connection = await this.use(config);
    const result = await McpClient.timed(connection.request("tools/list", {}), "what tools it has");
    const list = Array.isArray(result?.tools) ? result.tools : [];
    return list.filter((t: any) => typeof t?.name === "string").slice(0, 200);
  }

  async resources(config: McpServerConfig): Promise<McpResource[]> {
    const connection = await this.use(config);
    const result = await McpClient.timed(connection.request("resources/list", {}), "what it publishes").catch(
      () => null,
    );
    const list = Array.isArray(result?.resources) ? result.resources : [];
    return list.filter((r: any) => typeof r?.uri === "string").slice(0, 200);
  }

  async read(config: McpServerConfig, uri: string): Promise<McpResourceContents[]> {
    const connection = await this.use(config);
    const result = await McpClient.timed(connection.request("resources/read", { uri }), "that app");
    const parts = Array.isArray(result?.contents) ? result.contents : [];
    return parts.filter((p: any) => typeof p?.uri === "string");
  }

  async call(config: McpServerConfig, name: string, args: unknown): Promise<any> {
    const connection = await this.use(config);
    return await McpClient.timed(
      connection.request("tools/call", { name, arguments: args ?? {} }),
      "that tool",
    );
  }

  close(id: string) {
    const held = this.held.get(id);
    if (!held) return;
    this.held.delete(id);
    try {
      held.connection.close();
    } catch {
    }
  }

  closeAll() {
    for (const id of [...this.held.keys()]) this.close(id);
  }

  sweep(now: number) {
    for (const [id, held] of this.held) {
      if (now - held.usedAt > IDLE_MS) this.close(id);
    }
  }
}

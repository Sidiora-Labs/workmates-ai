import { execFile, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DATA_DIR } from "../core/config.ts";
import { createAskBroker, summarise, type AskBroker } from "../harness/ask-broker.ts";

function askChoices(input: any): string[] | undefined {
  if (Array.isArray(input?.choices)) return (input.choices as string[]).slice(0, 5);
  const options = input?.questions?.[0]?.options;
  if (Array.isArray(options)) {
    const labels = options
      .map((o: any) => (typeof o === "string" ? o : typeof o?.label === "string" ? o.label : null))
      .filter((l: unknown): l is string => Boolean(l));
    if (labels.length) return labels.slice(0, 5);
  }
  return undefined;
}
import type {
  DriverCreateInput,
  ProviderDriver,
  ProviderInstance,
  ProviderSnapshot,
  RuntimeEvent,
  RuntimeEventListener,
  SendTurnInput,
} from "../core/contracts.ts";
import { newEventId, newId } from "../core/contracts.ts";
import { appendNative } from "./native.ts";
import { describeEarlyExit, describeSpawnError } from "./spawn-error.ts";

const DRIVER_KIND = "claudeAgent";

const MODELS = {
  default: "claude-sonnet-5",
  options: [
    { id: "claude-fable-5-1", label: "Claude Fable 5.1" },
    { id: "claude-fable-5", label: "Claude Fable 5" },
    { id: "claude-opus-5", label: "Claude Opus 5" },
    { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  ],
};

const ONE_SHOT_MODEL = "claude-haiku-4-5";

export interface ClaudeConfig {
  cli: string;
  permissionMode: "acceptEdits" | "auto" | "bypassPermissions";
}

const PERMISSION_MODES = ["acceptEdits", "auto", "bypassPermissions"] as const;

function decodeConfig(raw: unknown): ClaudeConfig {
  const source = (raw ?? {}) as Record<string, unknown>;
  const mode = source.permissionMode;

  if (mode !== undefined && !PERMISSION_MODES.includes(mode as (typeof PERMISSION_MODES)[number])) {
    throw new Error(`claude: invalid permissionMode ${JSON.stringify(mode)}`);
  }
  return {
    cli: typeof source.cli === "string" ? source.cli : "claude",
    permissionMode: (mode as ClaudeConfig["permissionMode"]) ?? "acceptEdits",
  };
}

function helperEntry(name: string): string {
  const asTypeScript = join(dirname(fileURLToPath(import.meta.url)), "..", "proxies", `${name}.ts`);
  return existsSync(asTypeScript) ? asTypeScript : asTypeScript.replace(/\.ts$/, ".js");
}

const COMPUTER_HELPER = helperEntry("computer-proxy");
const SANDBOX_HELPER = helperEntry("sandbox-proxy");
const BROWSER_HELPER = helperEntry("browser-proxy");
const PERMISSION_HELPER = helperEntry("permission-proxy");

const RUN_AS_NODE = { ELECTRON_RUN_AS_NODE: "1" };

function brokerSocket(threadId: string) {
  const tag = threadId.replace(/[^\w-]/g, "").slice(0, 8);
  return join(DATA_DIR, `perm-${tag}.sock`);
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text" && block.text)
    .map((block) => block.text)
    .join("");
}

export const ClaudeDriver: ProviderDriver<ClaudeConfig> = {
  driverKind: DRIVER_KIND,
  metadata: { displayName: "Claude", supportsMultipleInstances: true },
  models: MODELS,
  decodeConfig,
  defaultConfig: () => decodeConfig({}),

  async create(input: DriverCreateInput<ClaudeConfig>): Promise<ProviderInstance> {
    const { instanceId, config } = input;
    const listeners = new Set<RuntimeEventListener>();

    interface RunningTurn {
      turnId: string;
      abort: () => void;
      broker?: AskBroker;
    }
    const running = new Map<string, RunningTurn>();

    const emit = (event: RuntimeEvent) => {
      for (const listener of [...listeners]) listener(event);
    };
    const envelope = (threadId: string, turnId: string) => ({
      eventId: newEventId(),
      provider: DRIVER_KIND,
      threadId,
      turnId,
      createdAt: new Date().toISOString(),
    });

    const sendTurn = async (turn: SendTurnInput) => {
      const { threadId } = turn;
      if (running.has(threadId)) throw new Error("a turn is already running on this thread");

      const turnId = newId();
      const resume = typeof turn.resumeCursor === "string" ? turn.resumeCursor : null;

      const argv = [
        "-p",
        "--output-format", "stream-json",
        "--input-format", "stream-json",
        "--verbose",
        "--permission-mode", config.permissionMode === "auto" ? "acceptEdits" : config.permissionMode,
      ];
      if (resume) argv.push("--resume", resume);
      else argv.push("--session-id", newId());
      if (turn.model) argv.push("--model", turn.model);
      for (const dir of turn.extraDirs ?? []) argv.push("--add-dir", dir);

      let personaDir: string | null = null;
      if (turn.system) {
        personaDir = mkdtempSync(join(tmpdir(), "workmates-persona-"));
        const personaFile = join(personaDir, "system.md");
        writeFileSync(personaFile, turn.system, { mode: 0o600 });
        argv.push("--append-system-prompt-file", personaFile);
      }

      const mcpServers: Record<string, unknown> = {};
      const allowed: string[] = [];

      for (const server of turn.integrations?.mcpServers ?? []) {
        const slug = "u_" + server.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40);
        if (slug === "u_" || mcpServers[slug]) continue;
        mcpServers[slug] =
          server.transport === "http"
            ? { type: "http", url: server.url, ...(server.headers ? { headers: server.headers } : {}) }
            : { command: server.command, args: server.args ?? [] };
        allowed.push(`mcp__${slug}`);
      }

      if (turn.integrations?.composio?.key) {
        mcpServers.composio = {
          type: "http",
          url: turn.integrations.composio.url || "https://connect.composio.dev/mcp",
          headers: { "x-consumer-api-key": turn.integrations.composio.key },
        };
        allowed.push("mcp__composio");
      }

      if (turn.integrations?.computer) {
        mcpServers.computer = {
          command: process.execPath,
          args: [COMPUTER_HELPER],
          env: {
            ...RUN_AS_NODE,
            WORKMATES_BOX_ID: turn.integrations.computer.boxId,
            WORKMATES_BOX_TOKEN: turn.integrations.computer.token,
          },
        };
        allowed.push("mcp__computer");
      } else if (turn.integrations?.localComputer) {
        mcpServers.computer = { ...turn.integrations.localComputer };
        allowed.push("mcp__computer");
      }

      if (turn.integrations?.sandbox) {
        mcpServers.sandbox = {
          command: process.execPath,
          args: [SANDBOX_HELPER],
          env: {
            ...RUN_AS_NODE,
            WORKMATES_SBX_RUNTIME: turn.integrations.sandbox.runtime,
            WORKMATES_SBX_NAME: turn.integrations.sandbox.name,
          },
        };
        allowed.push("mcp__sandbox");
      }

      if (turn.integrations?.browser) {
        mcpServers.browser = {
          command: process.execPath,
          args: [BROWSER_HELPER],
          env: {
            ...RUN_AS_NODE,
            WORKMATES_BROWSER_PROFILE: turn.integrations.browser.profileDir,
            WORKMATES_BROWSER_PORT: String(turn.integrations.browser.port),
          },
        };
        allowed.push("mcp__browser");
      }

      let broker: AskBroker | undefined;
      if (config.permissionMode !== "bypassPermissions") {
        const socketPath = brokerSocket(threadId);
        broker = createAskBroker({
          socketPath,
          onAsk: (ask) =>
            emit({
              ...envelope(threadId, turnId),
              type: "request.opened",
              requestId: ask.id,
              requestType: ask.kind,
              tool: ask.tool,
              input: ask.input,
              summary: summarise(ask),
              choices: askChoices(ask.input),
            }),
          onResolve: (resolved) =>
            emit({
              ...envelope(threadId, turnId),
              type: "request.resolved",
              requestId: resolved.id,
              behavior: resolved.behavior,
              source: resolved.source,
            }),
        });
        argv.push("--permission-prompt-tool", "mcp__workmates__approve");
        mcpServers.rooms = {
          command: process.execPath,
          args: [PERMISSION_HELPER, socketPath],
          env: { ...RUN_AS_NODE },
        };
        allowed.push("mcp__workmates");
      }

      if (Object.keys(mcpServers).length) {
        argv.push("--mcp-config", JSON.stringify({ mcpServers }));
        argv.push("--allowedTools", allowed.join(","));
      }

      const env: Record<string, string | undefined> = {
        ...process.env,
        NPM_CONFIG_LOGLEVEL: "error",
        ...(turn.env ?? {}),
      };
      delete env.ANTHROPIC_API_KEY;
      delete env.CLAUDECODE;
      delete env.CLAUDE_CODE_ENTRYPOINT;

      const child = spawn(config.cli, argv, {
        cwd: turn.cwd ?? homedir(),
        env,
        stdio: ["pipe", "pipe", "pipe"],
        detached: true,
      });

      let finished = false;
      const finish = (ok: boolean, stopReason: string | null, cost: number | null = null) => {
        if (finished) return;
        finished = true;
        broker?.close();
        if (personaDir) {
          try {
            rmSync(personaDir, { recursive: true, force: true });
          } catch {
          }
        }
        running.delete(threadId);
        emit({ ...envelope(threadId, turnId), type: "turn.completed", ok, stopReason, cost });
      };

      const consume = (raw: string) => {
        let frame: any;
        try {
          frame = JSON.parse(raw);
        } catch {
          return;
        }
        appendNative(threadId, { dir: "in", source: "claude.sdk.message", msg: frame });

        switch (frame.type) {
          case "system":
            if (frame.subtype === "init") {
              emit({
                ...envelope(threadId, turnId),
                type: "session.started",
                sessionId: frame.session_id,
                model: frame.model,
              });
            } else if (frame.subtype === "thinking_tokens") {
              emit({
                ...envelope(threadId, turnId),
                type: "item.updated",
                itemType: "reasoning",
                tokens: frame.estimated_tokens,
              });
            }
            break;

          case "assistant": {
            const message = frame.message ?? {};
            const text = textOf(message.content);
            if (text.trim()) {
              emit({
                ...envelope(threadId, turnId),
                type: "content.delta",
                streamKind: "assistant_text",
                delta: text,
              });
              emit({
                ...envelope(threadId, turnId),
                type: "item.completed",
                itemType: "assistant_text",
                text,
              });
            }
            for (const block of Array.isArray(message.content) ? message.content : []) {
              if (block.type !== "tool_use") continue;
              emit({
                ...envelope(threadId, turnId),
                type: "item.started",
                itemType: "tool",
                itemId: block.id,
                title: block.name,
              });
            }
            if (message.usage) {
              emit({
                ...envelope(threadId, turnId),
                type: "thread.token-usage.updated",
                input: (message.usage.input_tokens || 0) + (message.usage.cache_read_input_tokens || 0),
                output: message.usage.output_tokens || 0,
              });
            }
            break;
          }

          case "user":
            for (const block of Array.isArray(frame.message?.content) ? frame.message.content : []) {
              if (block.type !== "tool_result") continue;
              emit({
                ...envelope(threadId, turnId),
                type: "item.completed",
                itemType: "tool",
                itemId: block.tool_use_id,
                ok: !block.is_error,
              });
            }
            break;

          case "result":
            finish(
              frame.is_error !== true,
              frame.stop_reason ?? frame.terminal_reason ?? null,
              frame.total_cost_usd ?? null,
            );
            break;
        }
      };

      let stdout = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        for (;;) {
          const cut = stdout.indexOf("\n");
          if (cut === -1) break;
          const line = stdout.slice(0, cut);
          stdout = stdout.slice(cut + 1);
          if (line.trim()) consume(line);
        }
      });

      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
        if (stderr.length > 8192) stderr = stderr.slice(-8192);
      });

      child.on("error", (error) => {
        emit({
          ...envelope(threadId, turnId),
          type: "runtime.error",
          message: describeSpawnError(error, {
            name: "Claude Code",
            command: config.cli,
            install: "npm i -g @anthropic-ai/claude-code",
            signIn: "run `claude` once to sign in",
          }),
        });
        finish(false, "spawn_error");
      });

      child.on("close", (code) => {
        if (finished) return;
        emit({
          ...envelope(threadId, turnId),
          type: "runtime.error",
          message: describeEarlyExit(code, stderr, {
            name: "Claude Code",
            signIn: "run `claude` once in a terminal",
          }),
        });
        finish(false, "exit_before_result");
      });

      const abort = () => {
        try {
          process.kill(-child.pid!, "SIGTERM");
        } catch {
          try {
            child.kill("SIGTERM");
          } catch {
          }
        }
      };

      running.set(threadId, { turnId, abort, broker });
      emit({ ...envelope(threadId, turnId), type: "turn.started" });

      const prompt = { type: "user", message: { role: "user", content: turn.text } };
      child.stdin.write(JSON.stringify(prompt) + "\n");
      child.stdin.end();
      appendNative(threadId, { dir: "out", source: "claude.sdk.message", msg: prompt });

      return { turnId };
    };

    const snapshot = async (): Promise<ProviderSnapshot> => {
      const version = await new Promise<string | null>((resolve) => {
        execFile(config.cli, ["--version"], { timeout: 8_000 }, (error, stdout) =>
          resolve(error ? null : stdout.trim()),
        );
      });
      if (!version) return { state: "unavailable", reason: `\`${config.cli}\` CLI not found` };

      const authenticated = await new Promise<boolean>((resolve) => {
        execFile(config.cli, ["auth", "status"], { timeout: 8_000 }, (error, stdout) => {
          if (error) {
            return resolve(existsSync(join(homedir(), ".claude", ".credentials.json")));
          }
          try {
            resolve(JSON.parse(stdout).loggedIn === true);
          } catch {
            resolve(true);
          }
        });
      });
      return { state: "available", version, authenticated };
    };

    return {
      instanceId,
      driverKind: DRIVER_KIND,
      displayName: input.displayName,
      enabled: input.enabled,
      models: MODELS,
      snapshot,

      adapter: {
        provider: DRIVER_KIND,
        capabilities: { sessionModelSwitch: "in-session" },
        sendTurn,

        interruptTurn: async (threadId) => running.get(threadId)?.abort(),

        respondToRequest: async (threadId, requestId, decision) => {
          const broker = running.get(threadId)?.broker;
          if (!broker) throw new Error("nothing on this thread is waiting to be answered");
          if (!broker.answer(requestId, decision.behavior, decision.message)) {
            throw new Error("no such pending request (it may have timed out)");
          }
        },

        hasSession: (threadId) => running.has(threadId),

        stopAll: async () => {
          for (const turn of running.values()) turn.abort();
        },

        onEvent: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },

      generateText: (prompt: string) =>
        new Promise((resolve, reject) => {
          execFile(
            config.cli,
            ["-p", prompt, "--model", ONE_SHOT_MODEL, "--output-format", "text"],
            { timeout: 60_000, env: { ...process.env } },
            (error, stdout) => (error ? reject(error) : resolve(stdout.trim())),
          );
        }),

      dispose: async () => {
        for (const turn of running.values()) turn.abort();
        listeners.clear();
      },
    };
  },
};

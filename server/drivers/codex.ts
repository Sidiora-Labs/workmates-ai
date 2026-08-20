import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { attachRpc } from "../harness/jsonrpc-stdio.ts";
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

const DRIVER_KIND = "codex";
const NATIVE_SOURCE = "codex.app-server";

const MODELS = {
  default: "gpt-5.6-sol",
  options: [
    { id: "gpt-6-astra", label: "GPT-6 Astra" },
    { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
    { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
    { id: "gpt-5.4", label: "GPT-5.4" },
  ],
};

export interface CodexConfig {
  cli: string;
  fullAuto: boolean;
}

function decodeConfig(raw: unknown): CodexConfig {
  const source = (raw ?? {}) as Record<string, unknown>;
  return {
    cli: typeof source.cli === "string" ? source.cli : "codex",
    fullAuto: source.fullAuto === true,
  };
}

const UNANSWERED_QUESTION = "No answer was given. Use your best judgment.";
const UNANSWERED_PERMISSION =
  "Workmates: nobody answered this permission request in time. Skip this action and finish what you can without it.";
const ASK_TIMEOUT_MS = 15 * 60_000;

const LEGACY_APPROVAL_METHODS = new Set(["execCommandApproval", "applyPatchApproval"]);
const QUESTION_METHOD = "item/tool/requestUserInput";
const MCP_ELICITATION_METHOD = "mcpServer/elicitation/request";
const EDIT_APPROVAL_METHODS = new Set(["item/fileChange/requestApproval", "applyPatchApproval"]);

function toolOf(method: string, params: any): string {
  if (EDIT_APPROVAL_METHODS.has(method)) return "edit";
  if (method === QUESTION_METHOD) return "ask_user";
  if (method === MCP_ELICITATION_METHOD) return `mcp__${params.serverName ?? "unknown"}`;
  return "shell";
}

function summarise(params: any, fallback: string): string {
  if (typeof params.message === "string") return params.message;
  if (typeof params.command === "string") return params.command.slice(0, 200);
  if (Array.isArray(params.questions)) {
    return params.questions
      .map((q: any) => q.question ?? q.header)
      .filter(Boolean)
      .join(" · ");
  }
  if (typeof params.reason === "string") return params.reason;
  return fallback;
}

function toolLabel(item: any): string | null {
  switch (item.type) {
    case "commandExecution":
      return String(item.command ?? "shell").slice(0, 80);
    case "fileChange":
      return "edit";
    case "mcpToolCall":
      return item.tool ?? item.name ?? "mcp";
    case "webSearch":
      return "web_search";
    default:
      return null;
  }
}

const TOOL_ITEM_TYPES = new Set(["commandExecution", "fileChange", "mcpToolCall"]);

function connectorsHelper(): string {
  const asTypeScript = join(dirname(fileURLToPath(import.meta.url)), "..", "proxies", "connectors-proxy.ts");
  return existsSync(asTypeScript) ? asTypeScript : asTypeScript.replace(/\.ts$/, ".js");
}

export const CodexDriver: ProviderDriver<CodexConfig> = {
  driverKind: DRIVER_KIND,
  metadata: { displayName: "Codex", supportsMultipleInstances: true },
  models: MODELS,
  decodeConfig,
  defaultConfig: () => decodeConfig({}),

  async create(input: DriverCreateInput<CodexConfig>): Promise<ProviderInstance> {
    const { instanceId, config } = input;
    const listeners = new Set<RuntimeEventListener>();

    type Answer = (behavior: string, message?: string, source?: string, reply?: boolean) => void;
    interface RunningTurn {
      turnId: string;
      abort: () => void;
      asks: Map<string, Answer>;
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

      const env: Record<string, string | undefined> = {
        ...process.env,
        ...(turn.env ?? {}),
        NPM_CONFIG_LOGLEVEL: "error",
      };
      delete env.OPENAI_API_KEY;

      const appServerArgs = ["app-server"];
      if (turn.integrations?.composio?.key) {
        env.WORKMATES_COMPOSIO_KEY = turn.integrations.composio.key;
        if (turn.integrations.composio.url) env.WORKMATES_COMPOSIO_URL = turn.integrations.composio.url;
        env.ELECTRON_RUN_AS_NODE = "1";
        const prefix = "mcp_servers.workmates_connectors";
        appServerArgs.push(
          "-c", `${prefix}.command=${JSON.stringify(process.execPath)}`,
          "-c", `${prefix}.args=${JSON.stringify([connectorsHelper()])}`,
          "-c", `${prefix}.env_vars=${JSON.stringify(["WORKMATES_COMPOSIO_KEY", "WORKMATES_COMPOSIO_URL", "ELECTRON_RUN_AS_NODE"])}`,
        );
      }

      const child = spawn(config.cli, appServerArgs, {
        cwd: turn.cwd ?? homedir(),
        env,
        stdio: ["pipe", "pipe", "pipe"],
        detached: true,
      });

      const asks = new Map<string, Answer>();
      const rpcAsks = new Map<unknown, { requestId: string; providerThreadId: unknown }>();
      let finished = false;

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

      const rpc = attachRpc({
        stdin: child.stdin,
        stdout: child.stdout,
        onFrame: (msg, dir) => appendNative(threadId, { dir, source: NATIVE_SOURCE, msg }),
        onRequest: (msg) => onAgentRequest(msg),
        onNotify: (msg) => onAgentNotification(msg),
      });

      const finish = (ok: boolean, stopReason: string | null) => {
        if (finished) return;
        finished = true;
        for (const answer of [...asks.values()]) answer("deny", "Workmates: the turn ended", "turn-ended");
        rpc.failPending(new Error("turn settled"));
        running.delete(threadId);
        emit({ ...envelope(threadId, turnId), type: "turn.completed", ok, stopReason, cost: null });
        abort();
      };

      function onAgentRequest(msg: any) {
        const method = String(msg.method ?? "");
        const params = msg.params ?? {};
        const legacy = LEGACY_APPROVAL_METHODS.has(method);
        const isQuestion = method === QUESTION_METHOD;
        const isMcp = method === MCP_ELICITATION_METHOD;
        const tool = toolOf(method, params);

        if (isMcp && !(
          params.mode === "form" &&
          params.requestedSchema?.type === "object" &&
          Object.keys(params.requestedSchema.properties ?? {}).length === 0 &&
          (params.requestedSchema.required ?? []).length === 0
        )) {
          rpc.reply(msg.id, { action: "cancel", content: null, _meta: null });
          emit({
            ...envelope(threadId, turnId),
            type: "runtime.error",
            message: "Workmates cannot display this MCP input form or URL confirmation yet. The request was cancelled.",
          });
          return;
        }

        const permissionReply = (allowed: boolean, source: string) =>
          isMcp
            ? {
                action: allowed ? "accept" : source === "user" ? "decline" : "cancel",
                content: allowed ? {} : null,
                _meta: null,
              }
            : { decision: allowed ? (legacy ? "approved" : "accept") : legacy ? "denied" : "decline" };

        const requestId = newId();
        const logDecision = (stage: string, behavior?: string, source?: string) =>
          appendNative(threadId, {
            dir: "out",
            source: "workmates.approval",
            msg: {
              stage, requestId, rpcRequestId: msg.id, method, threadId, turnId,
              providerThreadId: params.threadId, providerTurnId: params.turnId, behavior, source,
            },
          });
        logDecision("opened");

        if (config.fullAuto && !isQuestion) {
          logDecision("resolved", "allow", "auto");
          return rpc.reply(msg.id, permissionReply(true, "auto"));
        }

        const answer: Answer = (behavior, message, source = "user", reply = true) => {
          if (!asks.delete(requestId)) return;
          rpcAsks.delete(msg.id);
          clearTimeout(timer);
          logDecision("resolved", behavior, source);

          if (reply && isQuestion) {
            const answers: Record<string, { answers: string[] }> = {};
            for (const q of Array.isArray(params.questions) ? params.questions : []) {
              answers[q.id] = { answers: [message || UNANSWERED_QUESTION] };
            }
            rpc.reply(msg.id, { answers });
          } else if (reply) {
            const allowed = behavior === "allow";
            rpc.reply(msg.id, permissionReply(allowed, source));
          }

          emit({
            ...envelope(threadId, turnId),
            type: "request.resolved",
            requestId,
            behavior,
            source,
          });
        };

        const timer = setTimeout(() => {
          if (isQuestion) answer("answer", UNANSWERED_QUESTION, "timeout");
          else answer("deny", UNANSWERED_PERMISSION, "timeout");
          if (isMcp) emit({
            ...envelope(threadId, turnId),
            type: "runtime.error",
            message: "The MCP approval timed out. Workmates cancelled the request because no answer arrived in time.",
          });
        }, ASK_TIMEOUT_MS);
        timer.unref?.();

        asks.set(requestId, answer);
        rpcAsks.set(msg.id, { requestId, providerThreadId: params.threadId });
        emit({
          ...envelope(threadId, turnId),
          type: "request.opened",
          requestId,
          requestType: isQuestion ? "question" : "permission",
          tool,
          summary: summarise(params, tool),
          choices: isQuestion
            ? (params.questions?.[0]?.options ?? []).map((o: any) => o.label).slice(0, 5)
            : undefined,
        });
      }

      function onAgentNotification(msg: any) {
        const params = msg.params ?? {};

        switch (msg.method) {
          case "serverRequest/resolved": {
            const pending = rpcAsks.get(params.requestId);
            if (pending && pending.providerThreadId === params.threadId) {
              asks.get(pending.requestId)?.("deny", "Workmates: the request closed", "engine", false);
            }
            break;
          }
          case "item/started": {
            const item = params.item ?? {};
            const label = toolLabel(item);
            if (!label) break;
            emit({
              ...envelope(threadId, turnId),
              type: "item.started",
              itemType: "tool",
              itemId: item.id,
              title: label,
            });
            break;
          }

          case "item/completed": {
            const item = params.item ?? {};
            if (item.type === "agentMessage") {
              if (!item.text?.trim()) break;
              emit({
                ...envelope(threadId, turnId),
                type: "content.delta",
                streamKind: "assistant_text",
                delta: item.text,
              });
              emit({
                ...envelope(threadId, turnId),
                type: "item.completed",
                itemType: "assistant_text",
                text: item.text,
              });
            } else if (TOOL_ITEM_TYPES.has(item.type)) {
              emit({
                ...envelope(threadId, turnId),
                type: "item.completed",
                itemType: "tool",
                itemId: item.id,
                ok: item.status !== "failed" && item.status !== "declined",
              });
            } else if (item.type === "reasoning") {
              emit({
                ...envelope(threadId, turnId),
                type: "item.updated",
                itemType: "reasoning",
                tokens: null,
              });
            }
            break;
          }

          case "thread/tokenUsage/updated": {
            const total = params.tokenUsage?.total;
            if (!total) break;
            emit({
              ...envelope(threadId, turnId),
              type: "thread.token-usage.updated",
              input: total.inputTokens ?? 0,
              output: total.outputTokens ?? 0,
            });
            break;
          }

          case "turn/completed": {
            const completed = params.turn ?? {};
            const ok = completed.status === "completed";
            finish(ok, ok ? null : (completed.error?.message ?? completed.status ?? "failed"));
            break;
          }

          case "error":
            if (params.message) {
              emit({ ...envelope(threadId, turnId), type: "runtime.error", message: params.message });
            }
            break;
        }
      }

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
            name: "Codex",
            command: config.cli,
            install: "npm i -g @openai/codex",
            signIn: "run `codex login`",
          }),
        });
        finish(false, "spawn_error");
      });

      child.on("close", (code) => {
        if (finished) return;
        emit({
          ...envelope(threadId, turnId),
          type: "runtime.error",
          message: describeEarlyExit(code, stderr, { name: "Codex", signIn: "run `codex login`" }),
        });
        finish(false, "exit_before_result");
      });

      running.set(threadId, { turnId, abort, asks });
      emit({ ...envelope(threadId, turnId), type: "turn.started" });

      void (async () => {
        try {
          await rpc.request("initialize", { clientInfo: { name: "workmates", version: "1" } });
          rpc.notify("initialized", {});

          const cursor = typeof turn.resumeCursor === "string" ? turn.resumeCursor : null;
          let codexThread: string | null = null;
          let reportedModel: string | null = null;

          if (cursor) {
            try {
              const resumed = await rpc.request("thread/resume", { threadId: cursor });
              codexThread = resumed?.thread?.id ?? cursor;
            } catch {
            }
          }

          if (!codexThread) {
            const startParams: Record<string, unknown> = {
              cwd: turn.cwd ?? homedir(),
              model: turn.model || null,
              sandbox: config.fullAuto ? "danger-full-access" : "workspace-write",
              approvalPolicy: config.fullAuto ? "never" : "on-request",
              ephemeral: false,
            };
            if (turn.effort) startParams.reasoningEffort = turn.effort;
            let started: any;
            try {
              started = await rpc.request("thread/start", startParams);
            } catch (error) {
              if (!turn.effort) throw error;
              delete startParams.reasoningEffort;
              started = await rpc.request("thread/start", startParams);
            }
            codexThread = started?.thread?.id ?? null;
            reportedModel = started?.model ?? null;
          }

          emit({
            ...envelope(threadId, turnId),
            type: "session.started",
            sessionId: codexThread,
            model: reportedModel ?? turn.model ?? null,
          });

          await rpc.request("turn/start", {
            threadId: codexThread,
            input: [
              { type: "text", text: turn.system ? `${turn.system}\n\n${turn.text}` : turn.text },
            ],
          });
        } catch (error) {
          if (finished) return;
          emit({
            ...envelope(threadId, turnId),
            type: "runtime.error",
            message: (error as Error).message,
          });
          finish(false, "rpc_error");
        }
      })();

      return { turnId };
    };

    const snapshot = async (): Promise<ProviderSnapshot> => {
      const version = await new Promise<string | null>((resolve) => {
        execFile(config.cli, ["--version"], { timeout: 8_000 }, (error, stdout) =>
          resolve(error ? null : stdout.trim()),
        );
      });
      if (!version) return { state: "unavailable", reason: `\`${config.cli}\` CLI not found` };
      return { state: "available", version };
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
        capabilities: { sessionModelSwitch: "unsupported" },
        sendTurn,

        interruptTurn: async (threadId) => running.get(threadId)?.abort(),

        respondToRequest: async (threadId, requestId, decision) => {
          const answer = running.get(threadId)?.asks.get(requestId);
          if (!answer) {
            appendNative(threadId, {
              dir: "out",
              source: "workmates.approval",
              msg: { stage: "unavailable", threadId, requestId, reason: "no matching pending request" },
            });
            throw new Error("no such pending request");
          }
          answer(decision.behavior, decision.message);
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

      dispose: async () => {
        for (const turn of running.values()) turn.abort();
        listeners.clear();
      },
    };
  },
};

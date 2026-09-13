import { execFile } from "node:child_process";

import type {
  DriverCreateInput,
  ModelCatalog,
  ProviderDriver,
  ProviderInstance,
  ProviderSnapshot,
  RuntimeEvent,
  RuntimeEventListener,
  SendTurnInput,
} from "../core/contracts.ts";
import { callMcpTool, listMcpTools, type McpAccess } from "../integrations/composio.ts";
import { newEventId, newId } from "../core/contracts.ts";
import type { ProviderSpec } from "../integrations/providers.ts";
import { appendNative } from "./native.ts";

export interface CompatConfig {
  url: string;
  apiKeyEnv: string;
}

const CATALOG_TTL_MS = 10 * 60_000;

function labelFor(id: string): string {
  const tail = id.split("/").pop() ?? id;
  return tail
    .replace(/[-_]/g, " ")
    .replace(/\b(gpt|ai|llm|fp8|moe)\b/gi, (s) => s.toUpperCase())
    .replace(/\b[a-z]/g, (s) => s.toUpperCase())
    .trim();
}

export function chooseModels(spec: ProviderSpec, ids: string[]): ModelCatalog | null {
  const clean = [...new Set(ids.filter((id) => typeof id === "string" && id))]
    .filter((id) => !/embed|whisper|tts|guard|moderation|image|vision-only|rerank/i.test(id));
  if (!clean.length) return null;

  const ranked = spec.prefer?.length
    ? clean
        .map((id) => ({ id, rank: spec.prefer!.findIndex((re) => re.test(id)) }))
        .map((e) => ({ ...e, rank: e.rank < 0 ? spec.prefer!.length : e.rank }))
        .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id))
        .map((e) => e.id)
    : [...clean].sort();
  const preferredDefault = ranked.includes(spec.models.default) ? spec.models.default : ranked[0];
  return {
    default: preferredDefault,
    options: ranked.map((id) => ({ id, label: labelFor(id) })),
  };
}

const ASK_TIMEOUT_MS = 15 * 60_000;
const UNANSWERED =
  "Nobody answered in time. Use your best judgment and continue.";

const BOX_API = "https://ascii.dev/api/box/v1";

function toolSchemas(hasComputer: boolean, hasSandbox: boolean) {
  const tools: any[] = [
    {
      type: "function",
      function: {
        name: "ask_user",
        description:
          "Ask the person you work for a question and wait for their answer. Use it for decisions that are genuinely theirs: preferences, missing facts, sign-off before something consequential.",
        parameters: {
          type: "object",
          properties: {
            question: { type: "string", description: "The question, with enough context to answer at a glance" },
            choices: {
              type: "array",
              items: { type: "string" },
              description: "Optional 2-5 likely answers, offered as one-tap buttons",
            },
          },
          required: ["question"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "request_secret",
        description:
          "Ask the user for an API key or other secret via a secure field in the chat. The value reaches your tools as an environment variable on your next turn and never appears in the conversation. After calling this, wrap up your turn; the task resumes when they save it.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "What the secret is, e.g. Transistor API key" },
            hint: { type: "string", description: "Where to find it, one line" },
          },
          required: ["name"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "request_connection",
        description:
          "Ask the user to connect an app (Slack, Gmail, GitHub...) so you can use it. A sign-in card appears in the chat; never paste sign-in links yourself. After calling this, wrap up your turn: the task resumes automatically once the user connects.",
        parameters: {
          type: "object",
          properties: {
            apps: {
              type: "array",
              items: { type: "string" },
              description: "App slugs to connect, lowercase",
            },
            reason: { type: "string", description: "One line on why, shown to the user" },
          },
          required: ["apps"],
        },
      },
    },
  ];
  if (hasSandbox) {
    tools.push({
      type: "function",
      function: {
        name: "sandbox_exec",
        description:
          "Run a shell command in your own Linux sandbox (Ubuntu, persistent /work). Returns stdout, stderr and the exit code. Shell and files only; there is no display.",
        parameters: {
          type: "object",
          properties: { command: { type: "string" } },
          required: ["command"],
        },
      },
    });
  }
  if (hasComputer) {
    tools.push(
      {
        type: "function",
        function: {
          name: "computer_exec",
          description:
            "Run a shell command on your own cloud computer (Linux, passwordless sudo). Returns stdout, stderr and the exit code.",
          parameters: {
            type: "object",
            properties: { command: { type: "string" } },
            required: ["command"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "open_url",
          description: "Open a URL in the cloud computer's own browser.",
          parameters: {
            type: "object",
            properties: { url: { type: "string" } },
            required: ["url"],
          },
        },
      },
    );
  }
  return tools;
}

async function boxExec(
  computer: { boxId: string; token: string },
  command: string,
  signal: AbortSignal,
): Promise<string> {
  const res = await fetch(`${BOX_API}/boxes/${computer.boxId}/commands`, {
    method: "POST",
    headers: { authorization: `Bearer ${computer.token}`, "content-type": "application/json" },
    body: JSON.stringify({ command: command.slice(0, 4000) }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
  });
  const body: any = await res.json().catch(() => null);
  if (!res.ok) return `the computer refused: HTTP ${res.status}`;
  const stderr = body?.stderr ? `\n[stderr]\n${String(body.stderr).slice(-1500)}` : "";
  return `exit ${body?.exitCode ?? "?"}\n${String(body?.stdout ?? "").slice(-5000)}${stderr}`;
}

function sandboxExec(handle: { runtime: string; name: string }, command: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      handle.runtime,
      ["exec", handle.name, "sh", "-lc", command.slice(0, 4000)],
      { timeout: 120_000, maxBuffer: 4_000_000, signal },
      (error, stdout, stderr) => {
        const code = error ? ((error as any).code ?? 1) : 0;
        const tail = stderr ? `\n[stderr]\n${String(stderr).slice(-1500)}` : "";
        resolve(`exit ${code}\n${String(stdout).slice(-5000)}${tail}`);
      },
    );
  });
}

export function openAiCompatDriver(spec: ProviderSpec): ProviderDriver<CompatConfig> {
  const keyEnv = `${spec.kind.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;

  const decodeConfig = (raw: unknown): CompatConfig => {
    const o = (raw ?? {}) as Record<string, unknown>;
    return {
      url: typeof o.url === "string" && o.url ? o.url.replace(/\/+$/, "") : spec.url,
      apiKeyEnv: typeof o.apiKeyEnv === "string" ? o.apiKeyEnv : keyEnv,
    };
  };

  return {
    driverKind: spec.kind,
    metadata: { displayName: spec.name, supportsMultipleInstances: true },
    models: spec.models,
    decodeConfig,
    defaultConfig: () => decodeConfig({}),

    async create(input: DriverCreateInput<CompatConfig>): Promise<ProviderInstance> {
      const { instanceId, config } = input;
      const apiKey =
        input.environment[config.apiKeyEnv] ??
        process.env[config.apiKeyEnv] ??
        (spec.kind === "grok" ? (input.environment.XAI_API_KEY ?? process.env.XAI_API_KEY) : "") ??
        "";
      const needsKey = spec.auth !== "none";
      const listeners = new Set<RuntimeEventListener>();
      const active = new Map<
        string,
        {
          abort: AbortController;
          turnId: string;
          asks: Map<string, (answer: string) => void>;
        }
      >();

      const models: ModelCatalog = { default: spec.models.default, options: [...spec.models.options] };
      let catalogAt = 0;
      let refreshing: Promise<void> | null = null;
      let rejected: string | null = null;

      const emit = (event: RuntimeEvent) => {
        for (const l of [...listeners]) l(event);
      };
      const base = (threadId: string, turnId: string) => ({
        eventId: newEventId(),
        provider: spec.kind,
        threadId,
        turnId,
        createdAt: new Date().toISOString(),
      });
      const headers = () => ({
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        "content-type": "application/json",
        ...spec.headers,
      });

      const refreshCatalog = () => {
        if (refreshing) return refreshing;
        refreshing = (async () => {
          try {
            const res = await fetch(`${config.url}/models`, {
              headers: headers(),
              signal: AbortSignal.timeout(8_000),
            });
            rejected = res.status === 401 || res.status === 403 ? "that key was rejected" : null;
            if (!res.ok) return;
            const json: any = await res.json();
            const rows: any[] = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
            const next = chooseModels(
              spec,
              rows.map((r) => String(r?.id ?? r?.name ?? "")),
            );
            if (next) {
              models.default = next.default;
              models.options = next.options;
            }
            catalogAt = Date.now();
          } catch {
          } finally {
            refreshing = null;
          }
        })();
        return refreshing;
      };

      const complete = async (
        messages: Array<{ role: string; content: string }>,
        model: string,
        opts: { stream: boolean; signal?: AbortSignal; onDelta?: (d: string) => void },
      ): Promise<{ text: string; usage: { input: number; output: number } | null }> => {
        const res = await fetch(`${config.url}/chat/completions`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ model, messages, stream: opts.stream }),
          signal: opts.signal ?? AbortSignal.timeout(120_000),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`${spec.name} HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
        }
        if (!opts.stream) {
          const json: any = await res.json();
          return {
            text: json.choices?.[0]?.message?.content ?? "",
            usage: json.usage
              ? { input: json.usage.prompt_tokens ?? 0, output: json.usage.completion_tokens ?? 0 }
              : null,
          };
        }
        let text = "";
        let usage: { input: number; output: number } | null = null;
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf("\n")) !== -1) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (data === "[DONE]") continue;
            let chunk: any;
            try {
              chunk = JSON.parse(data);
            } catch {
              continue;
            }
            if (chunk.error) throw new Error(String(chunk.error.message ?? chunk.error).slice(0, 200));
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) {
              text += delta;
              opts.onDelta?.(delta);
            }
            if (chunk.usage) {
              usage = {
                input: chunk.usage.prompt_tokens ?? 0,
                output: chunk.usage.completion_tokens ?? 0,
              };
            }
          }
        }
        return { text, usage };
      };

      const completeRaw = async (
        messages: any[],
        model: string,
        tools: any[],
        signal: AbortSignal,
      ): Promise<{ message: any; usage: { input: number; output: number } | null }> => {
        const res = await fetch(`${config.url}/chat/completions`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ model, messages, ...(tools.length ? { tools } : {}), stream: false }),
          signal,
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`${spec.name} HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
        }
        const json: any = await res.json();
        return {
          message: json.choices?.[0]?.message ?? {},
          usage: json.usage
            ? { input: json.usage.prompt_tokens ?? 0, output: json.usage.completion_tokens ?? 0 }
            : null,
        };
      };

      const runWithTools = async (
        threadId: string,
        turnId: string,
        messages: any[],
        model: string,
        turn: SendTurnInput,
        signal: AbortSignal,
      ) => {
        const computer = turn.integrations?.computer;
        const sandbox = turn.integrations?.sandbox;
        const tools = toolSchemas(Boolean(computer), Boolean(sandbox));
        const connectors: McpAccess | null = turn.integrations?.composio?.key
          ? turn.integrations.composio
          : null;
        const connectorTools = new Set<string>();
        if (connectors) {
          try {
            for (const tool of await listMcpTools(connectors, signal)) {
              connectorTools.add(tool.name);
              tools.push({
                type: "function",
                function: {
                  name: tool.name,
                  description: tool.description.slice(0, 1024),
                  parameters: tool.inputSchema,
                },
              });
            }
          } catch {
          }
        }
        let usageTotal = { input: 0, output: 0 };

        let requestedFinal = false;
        while (true) {
          signal.throwIfAborted();
          const { message, usage } = await completeRaw(messages, model, requestedFinal ? [] : tools, signal);
          signal.throwIfAborted();
          appendNative(threadId, { dir: "in", source: `${spec.kind}.chat.completions`, msg: { message, usage } });
          if (usage) {
            usageTotal = { input: usageTotal.input + usage.input, output: usageTotal.output + usage.output };
          }
          const calls: any[] = Array.isArray(message.tool_calls) ? message.tool_calls : [];

          if (requestedFinal && calls.length) throw new Error("The provider did not return a final response. Your completed tool work is retained.");
          if (!calls.length) {
            const text = typeof message.content === "string" ? message.content : "";
            if (!text.trim()) {
              if (requestedFinal) throw new Error("The provider returned an empty final response. Your completed tool work is retained.");
              requestedFinal = true;
              messages.push({ role: "user", content: "Provide your final response now, using the tool results above. Explain the outcome and anything still incomplete. Do not call more tools." });
              continue;
            }
            if (text.trim()) {
              emit({ ...base(threadId, turnId), type: "content.delta", streamKind: "assistant_text", delta: text });
              emit({ ...base(threadId, turnId), type: "item.completed", itemType: "assistant_text", text });
            }
            if (usageTotal.input || usageTotal.output) {
              emit({ ...base(threadId, turnId), type: "thread.token-usage.updated", ...usageTotal });
            }
            return;
          }

          messages.push(message);
          for (const call of calls) {
            signal.throwIfAborted();
            const name = call.function?.name ?? "tool";
            let args: any = {};
            try {
              args = JSON.parse(call.function?.arguments || "{}");
            } catch {
            }

            emit({
              ...base(threadId, turnId),
              type: "item.started",
              itemType: "tool",
              itemId: call.id,
              title: name === "ask_user" ? "ask_user" : `${name}: ${String(args.command ?? args.url ?? "").slice(0, 60)}`,
            });

            signal.throwIfAborted();
            let result: string;
            let ok = true;
            if (name === "ask_user") {
              result = await askUser(threadId, turnId, args);
            } else if (name === "request_connection") {
              result = await requestConnection(threadId, turnId, args);
            } else if (name === "request_secret") {
              result = await requestSecret(threadId, turnId, args);
            } else if (name === "sandbox_exec" && sandbox) {
              result = await sandboxExec(sandbox, String(args.command ?? ""), signal);
              ok = result.startsWith("exit 0\n");
            } else if (name === "computer_exec" && computer) {
              result = await boxExec(computer, String(args.command ?? ""), signal);
              ok = result.startsWith("exit 0\n");
            } else if (name === "open_url" && computer) {
              const url = String(args.url ?? "");
              if (/^https?:\/\//.test(url)) {
                const quoted = url.replace(/'/g, "%27");
                result = await boxExec(
                  computer,
                  "export DISPLAY=${DISPLAY:-:0}; " +
                    `(google-chrome '${quoted}' || chromium '${quoted}' || xdg-open '${quoted}') >/dev/null 2>&1 & sleep 2; echo opened`,
                  signal,
                );
              } else {
                result = "only http(s) URLs can be opened";
                ok = false;
              }
            } else if (connectors && connectorTools.has(name)) {
              try {
                result = await callMcpTool(connectors, name, args, signal);
              } catch (error) {
                result = `the connector call failed: ${error instanceof Error ? error.message : "unknown error"}`;
                ok = false;
              }
            } else {
              result = `the tool "${name}" is not available in this session`;
              ok = false;
            }

            signal.throwIfAborted();
            emit({ ...base(threadId, turnId), type: "item.completed", itemType: "tool", itemId: call.id, ok });
            const outcome = { role: "tool", tool_call_id: call.id, content: result };
            messages.push(outcome);
            appendNative(threadId, { dir: "in", source: `${spec.kind}.tool`, msg: outcome });
          }
        }
      };

      const askUser = (threadId: string, turnId: string, args: any): Promise<string> => {
        const requestId = newId();
        const question = String(args.question ?? "The agent needs your input.");
        const choices = Array.isArray(args.choices)
          ? args.choices.map((c: unknown) => String(c)).slice(0, 5)
          : undefined;

        return new Promise<string>((resolve) => {
          const entry = active.get(threadId);
          if (!entry) return resolve(UNANSWERED);

          const timer = setTimeout(() => {
            entry.asks.delete(requestId);
            emit({
              ...base(threadId, turnId),
              type: "request.resolved",
              requestId,
              behavior: "answer",
              source: "timeout",
            });
            resolve(UNANSWERED);
          }, ASK_TIMEOUT_MS);
          timer.unref?.();

          entry.asks.set(requestId, (answer) => {
            clearTimeout(timer);
            entry.asks.delete(requestId);
            emit({
              ...base(threadId, turnId),
              type: "request.resolved",
              requestId,
              behavior: "answer",
              source: "user",
            });
            resolve(answer);
          });

          emit({
            ...base(threadId, turnId),
            type: "request.opened",
            requestId,
            requestType: "question",
            tool: "ask_user",
            summary: question.slice(0, 300),
            choices,
          });
        });
      };

      const requestSecret = (threadId: string, turnId: string, args: any): Promise<string> => {
        const requestId = newId();
        return new Promise<string>((resolve) => {
          const entry = active.get(threadId);
          if (!entry) return resolve(UNANSWERED);
          entry.asks.set(requestId, (answer) => {
            entry.asks.delete(requestId);
            emit({
              ...base(threadId, turnId),
              type: "request.resolved",
              requestId,
              behavior: "answer",
              source: "user",
            });
            resolve(answer);
          });
          emit({
            ...base(threadId, turnId),
            type: "request.opened",
            requestId,
            requestType: "question",
            tool: "request_secret",
            input: { name: args.name, hint: args.hint },
            summary: "Request a secret",
          });
        });
      };

      const requestConnection = (threadId: string, turnId: string, args: any): Promise<string> => {
        const requestId = newId();
        return new Promise<string>((resolve) => {
          const entry = active.get(threadId);
          if (!entry) return resolve(UNANSWERED);
          entry.asks.set(requestId, (answer) => {
            entry.asks.delete(requestId);
            emit({
              ...base(threadId, turnId),
              type: "request.resolved",
              requestId,
              behavior: "answer",
              source: "user",
            });
            resolve(answer);
          });
          emit({
            ...base(threadId, turnId),
            type: "request.opened",
            requestId,
            requestType: "question",
            tool: "request_connection",
            input: { apps: args.apps, reason: args.reason },
            summary: "Connect apps",
          });
        });
      };

      const sendTurn = async (turn: SendTurnInput) => {
        const { threadId } = turn;
        if (needsKey && !apiKey) throw new Error(`${spec.name} is not connected yet`);
        if (active.has(threadId)) throw new Error("a turn is already running on this thread");
        const turnId = newId();
        const abort = new AbortController();
        const asks = new Map<string, (answer: string) => void>();
        active.set(threadId, { abort, turnId, asks });
        abort.signal.addEventListener("abort", () => {
          for (const settle of [...asks.values()]) settle("The user stopped this turn.");
        }, { once: true });

        const system = [
          turn.system,
          spec.tools ? "Continue the authorized task across as many tool rounds as needed. Complete the work before ending your turn. Your final response must explain the result and any real blockers or unfinished work. Do not end with only a progress update or an offer to continue work already requested." : "",
        ].filter(Boolean).join("\n\n");
        const messages = [
          ...(system ? [{ role: "system", content: system }] : []),
          ...(turn.transcript ?? []).map((m) => ({
            role: m.role === "assistant" ? "assistant" : "user",
            content: m.text,
          })),
          { role: "user", content: turn.text },
        ];
        appendNative(threadId, {
          dir: "out",
          source: `${spec.kind}.chat.completions`,
          msg: { model: turn.model, messages },
        });

        emit({ ...base(threadId, turnId), type: "turn.started" });
        emit({
          ...base(threadId, turnId),
          type: "session.started",
          sessionId: null,
          model: turn.model ?? models.default,
        });

        (async () => {
          try {
            if (spec.tools) {
              await runWithTools(
                threadId,
                turnId,
                messages,
                turn.model || models.default,
                turn,
                abort.signal,
              );
              active.delete(threadId);
              emit({ ...base(threadId, turnId), type: "turn.completed", ok: true, stopReason: null, cost: null });
              return;
            }
            const { text, usage } = await complete(messages, turn.model || models.default, {
              stream: true,
              signal: abort.signal,
              onDelta: (delta) =>
                emit({ ...base(threadId, turnId), type: "content.delta", streamKind: "assistant_text", delta }),
            });
            appendNative(threadId, { dir: "in", source: `${spec.kind}.chat.completions`, msg: { text, usage } });
            if (text.trim()) {
              emit({ ...base(threadId, turnId), type: "item.completed", itemType: "assistant_text", text });
            }
            if (usage) {
              emit({ ...base(threadId, turnId), type: "thread.token-usage.updated", ...usage });
            }
            active.delete(threadId);
            emit({ ...base(threadId, turnId), type: "turn.completed", ok: true, stopReason: null, cost: null });
          } catch (e) {
            const entry = active.get(threadId);
            for (const settle of entry?.asks.values() ?? []) settle("The turn ended before you answered.");
            active.delete(threadId);
            const aborted = (e as Error).name === "AbortError";
            if (!aborted) {
              emit({ ...base(threadId, turnId), type: "runtime.error", message: (e as Error).message });
            }
            emit({
              ...base(threadId, turnId),
              type: "turn.completed",
              ok: false,
              stopReason: aborted ? "interrupted" : "error",
              cost: null,
            });
          }
        })();

        return { turnId };
      };

      const snapshot = async (): Promise<ProviderSnapshot> => {
        if (needsKey && !apiKey) {
          return { state: "unavailable", reason: `${spec.name} is not connected. ${spec.keyHint}.` };
        }
        if (Date.now() - catalogAt > CATALOG_TTL_MS) {
          const first = catalogAt === 0;
          const refresh = refreshCatalog();
          if (first) await Promise.race([refresh, new Promise((r) => setTimeout(r, 2_500))]);
        }
        if (spec.auth === "none") {
          try {
            const res = await fetch(`${config.url}/models`, { signal: AbortSignal.timeout(1_500) });
            if (!res.ok) throw new Error(String(res.status));
          } catch {
            return { state: "unavailable", reason: `${spec.name} is not running on this machine` };
          }
        }
        if (rejected) {
          return { state: "unavailable", reason: `${spec.name}: ${rejected}. ${spec.keyHint}.` };
        }
        return { state: "available", authenticated: needsKey ? true : undefined, version: null };
      };

      return {
        instanceId,
        driverKind: spec.kind,
        displayName: input.displayName ?? spec.name,
        enabled: input.enabled,
        models,
        snapshot,
        adapter: {
          provider: spec.kind,
          capabilities: { sessionModelSwitch: "in-session", replaysNatively: true },
          sendTurn,
          interruptTurn: async (threadId) => active.get(threadId)?.abort.abort(),
          respondToRequest: async (threadId, requestId, decision) => {
            const settle = active.get(threadId)?.asks.get(requestId);
            if (!settle) throw new Error("no such pending request (it may have timed out)");
            settle(decision.message ?? decision.behavior);
          },
          hasSession: (threadId) => active.has(threadId),
          stopAll: async () => {
            for (const { abort } of active.values()) abort.abort();
          },
          onEvent: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        },
        generateText: async (prompt: string) => {
          const { text } = await complete([{ role: "user", content: prompt }], spec.small || models.default, {
            stream: false,
          });
          return text;
        },
        dispose: async () => {
          for (const { abort } of active.values()) abort.abort();
          listeners.clear();
        },
      };
    },
  };
}

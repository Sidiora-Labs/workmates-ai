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

const DRIVER_KIND = "boxAgent";
const BOX_API = "https://ascii.dev/api/box/v1";

const MODELS = {
  default: "claude-fable-5",
  options: [
    { id: "claude-fable-5", label: "Claude Fable 5 · on the box" },
    { id: "sonnet", label: "Claude Sonnet · on the box" },
    { id: "gpt-5.4", label: "GPT-5.4 (Codex) · on the box" },
  ],
};

const agentFor = (model: string) => (model.startsWith("gpt") ? "codex" : "claude-code");

const MAX_TURN_MS = 30 * 60_000;

const SAYS_SOMETHING = /assistant|message|output/i;
const DID_SOMETHING = /tool|command|exec|browse/i;

const SUCCEEDED = /completed|succeeded|done/i;
const FAILED = /failed|error|cancelled|interrupted/i;

export interface BoxAgentConfig {
  pollMs: number;
}

function decodeConfig(raw: unknown): BoxAgentConfig {
  const source = (raw ?? {}) as Record<string, unknown>;
  return { pollMs: typeof source.pollMs === "number" ? source.pollMs : 2500 };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const BoxAgentDriver: ProviderDriver<BoxAgentConfig> = {
  driverKind: DRIVER_KIND,
  metadata: { displayName: "Computer", supportsMultipleInstances: false },
  models: MODELS,
  decodeConfig,
  defaultConfig: () => decodeConfig({}),

  async create(input: DriverCreateInput<BoxAgentConfig>): Promise<ProviderInstance> {
    const { instanceId, config } = input;
    const token = input.environment.BOX_TOKEN ?? process.env.BOX_TOKEN ?? "";
    const listeners = new Set<RuntimeEventListener>();

    interface RunningTurn {
      turnId: string;
      boxId: string;
      cancel: () => void;
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

    const call = async (path: string, init: RequestInit = {}) => {
      const response = await fetch(`${BOX_API}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          ...(init.headers ?? {}),
        },
        signal: (init as any).signal ?? AbortSignal.timeout(30_000),
      });
      const body: any = await response.json().catch(() => null);
      if (!response.ok || body?.ok === false) {
        throw new Error(body?.code ?? body?.error ?? `box HTTP ${response.status}`);
      }
      return body;
    };

    const sendTurn = async (turn: SendTurnInput) => {
      const { threadId } = turn;
      const boxId = turn.integrations?.computer?.boxId;

      if (!token) {
        throw new Error('box not configured. Add {"box":{"token":"…"}} to ~/.workmates/config.json');
      }
      if (!boxId) {
        throw new Error("this agent has no computer yet, open the Computer panel and provision one");
      }
      if (running.has(threadId)) throw new Error("a turn is already running on this thread");

      const turnId = newId();
      const model = turn.model || MODELS.default;

      const prompt = [
        turn.system,
        "This machine is yours: the desktop, the browser and the shell all belong to you, and nothing here is shared with anyone else.",
        "",
        turn.text,
      ]
        .filter((part) => part !== undefined)
        .join("\n");

      const started: any = await call(`/boxes/${boxId}/prompt`, {
        method: "POST",
        body: JSON.stringify({ provider: agentFor(model), model, prompt }),
      });
      appendNative(threadId, {
        dir: "out",
        source: "box.prompt",
        msg: { model, prompt, response: started },
      });

      const promptId = started?.prompt?.id ?? started?.promptId ?? started?.id ?? null;

      let cancelled = false;
      running.set(threadId, {
        turnId,
        boxId,
        cancel: () => {
          cancelled = true;
          void call(`/boxes/${boxId}/interrupt`, { method: "POST" }).catch(() => {});
        },
      });

      emit({ ...envelope(threadId, turnId), type: "turn.started" });
      emit({ ...envelope(threadId, turnId), type: "session.started", sessionId: promptId, model });

      void (async () => {
        const seen = new Set<string>();
        const startedAt = Date.now();
        let lastSpoken = "";

        const settle = (ok: boolean, stopReason: string | null) => {
          running.delete(threadId);
          emit({ ...envelope(threadId, turnId), type: "turn.completed", ok, stopReason, cost: null });
        };

        try {
          while (!cancelled) {
            await sleep(config.pollMs);

            const payload: any = await call(`/boxes/${boxId}/events`).catch(() => null);
            for (const event of payload?.events ?? payload?.items ?? []) {
              const key = String(event.id ?? event.eventId ?? JSON.stringify(event).slice(0, 120));
              if (seen.has(key)) continue;
              seen.add(key);
              appendNative(threadId, { dir: "in", source: "box.events", msg: event });

              const kind = String(event.type ?? event.kind ?? "");
              const text = event.text ?? event.message ?? event.data?.text ?? null;

              if (SAYS_SOMETHING.test(kind) && typeof text === "string" && text.trim()) {
                lastSpoken = text;
                emit({
                  ...envelope(threadId, turnId),
                  type: "content.delta",
                  streamKind: "assistant_text",
                  delta: text,
                });
              } else if (DID_SOMETHING.test(kind)) {
                emit({
                  ...envelope(threadId, turnId),
                  type: "item.started",
                  itemType: "tool",
                  itemId: key,
                  title: String(event.title ?? event.command ?? kind).slice(0, 80),
                });
              }
            }

            if (promptId) {
              const status: any = await call(`/boxes/${boxId}/prompts/${promptId}`).catch(() => null);
              appendNative(threadId, { dir: "in", source: "box.prompt.status", msg: status });
              const state = String(status?.prompt?.status ?? status?.status ?? "");

              if (SUCCEEDED.test(state)) {
                const result = status?.prompt?.result ?? status?.result ?? lastSpoken;
                const final = typeof result === "string" && result.trim() ? result : "";

                if (final && final !== lastSpoken) {
                  emit({
                    ...envelope(threadId, turnId),
                    type: "content.delta",
                    streamKind: "assistant_text",
                    delta: final,
                  });
                }
                emit({
                  ...envelope(threadId, turnId),
                  type: "item.completed",
                  itemType: "assistant_text",
                  text: final || lastSpoken || "(finished)",
                });
                return settle(true, null);
              }

              if (FAILED.test(state)) {
                if (lastSpoken) {
                  emit({
                    ...envelope(threadId, turnId),
                    type: "item.completed",
                    itemType: "assistant_text",
                    text: lastSpoken,
                  });
                }
                return settle(false, state);
              }
            }

            if (Date.now() - startedAt > MAX_TURN_MS) {
              throw new Error("box run exceeded 30 minutes, interrupted");
            }
          }

          settle(false, "interrupted");
        } catch (error) {
          emit({
            ...envelope(threadId, turnId),
            type: "runtime.error",
            message: (error as Error).message,
          });
          settle(false, "error");
        }
      })();

      return { turnId };
    };

    const snapshot = async (): Promise<ProviderSnapshot> => {
      if (!token) {
        return {
          state: "unavailable",
          reason: 'no Box token. Add {"box":{"token":"…"}} to ~/.workmates/config.json',
        };
      }
      try {
        await call("/me");
        return { state: "available", authenticated: true, version: null };
      } catch (error) {
        return { state: "unavailable", reason: `box API unreachable: ${(error as Error).message}` };
      }
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

        interruptTurn: async (threadId) => running.get(threadId)?.cancel(),

        respondToRequest: async () => {
          throw new Error("box agent asks are not wired yet");
        },

        hasSession: (threadId) => running.has(threadId),

        stopAll: async () => {
          for (const turn of running.values()) turn.cancel();
        },

        onEvent: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },

      dispose: async () => {
        for (const turn of running.values()) turn.cancel();
        listeners.clear();
      },
    };
  },
};

import { createServer, type Server } from "node:net";
import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";

export interface PendingAsk {
  id: string;
  kind: "permission" | "question";
  tool: string;
  input: Record<string, unknown>;
  at: number;
}

export interface ResolvedAsk extends PendingAsk {
  behavior: string;
  source: string;
}

const DEFAULT_TIMEOUT_MS = 15 * 60_000;

const TIMED_OUT_PERMISSION =
  "Workmates: nobody answered this permission request in time. Skip this action and finish what you can without it.";
const TIMED_OUT_QUESTION = "Workmates: nobody answered in time. Use your best judgment and continue.";
const TURN_ENDED_PERMISSION = "Workmates: the turn ended";
const TURN_ENDED_QUESTION = "Workmates: the turn is ending, wrap up.";

export function summarise(ask: PendingAsk): string {
  const input = ask.input ?? {};
  if (typeof input.question === "string") return input.question.slice(0, 300);
  if (Array.isArray(input.questions) && typeof input.questions[0]?.question === "string") {
    const first = input.questions[0].question.slice(0, 300);
    return input.questions.length > 1 ? `${first} (+${input.questions.length - 1} more)` : first;
  }
  if (typeof input.command === "string") return input.command.slice(0, 200);
  if (typeof input.url === "string") return input.url.slice(0, 200);

  const serialised = JSON.stringify(input);
  return serialised === "{}" ? (ask.tool ?? "tool") : serialised.slice(0, 200);
}

export interface AskBrokerOptions {
  socketPath: string;
  onAsk: (ask: PendingAsk) => void;
  onResolve: (resolved: ResolvedAsk) => void;
  timeoutMs?: number;
}

export interface AskBroker {
  answer(askId: string, behavior: string, message?: string): boolean;
  close(): void;
}

export function createAskBroker(options: AskBrokerOptions): AskBroker {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  interface Entry {
    ask: PendingAsk;
    settle: (behavior: string, message: string | undefined, source: string) => void;
  }
  const open = new Map<string, Entry>();

  try {
    unlinkSync(options.socketPath);
  } catch {
  }

  const server: Server = createServer((connection) => {
    connection.on("error", () => {});

    let pending = "";
    connection.on("data", (chunk) => {
      pending += chunk;
      for (;;) {
        const cut = pending.indexOf("\n");
        if (cut === -1) break;
        const line = pending.slice(0, cut);
        pending = pending.slice(cut + 1);

        let frame: any;
        try {
          frame = JSON.parse(line);
        } catch {
          continue;
        }
        if (frame.t !== "ask") continue;

        const id = String(frame.id ?? randomUUID());
        const kind = frame.kind === "question" ? ("question" as const) : ("permission" as const);
        const ask: PendingAsk = {
          id,
          kind,
          tool: frame.tool ?? "tool",
          input: frame.input ?? {},
          at: Date.now(),
        };

        const settle = (behavior: string, message: string | undefined, source: string) => {
          if (!open.delete(id)) return;
          clearTimeout(timer);
          try {
            connection.write(JSON.stringify({ t: "answer", id, behavior, message }) + "\n");
          } catch {
          }
          options.onResolve({ ...ask, behavior, source });
        };

        const timer = setTimeout(() => {
          if (kind === "question") settle("answer", TIMED_OUT_QUESTION, "timeout");
          else settle("deny", TIMED_OUT_PERMISSION, "timeout");
        }, timeoutMs);
        timer.unref?.();

        open.set(id, { ask, settle });
        options.onAsk(ask);
      }
    });
  });

  server.on("error", () => {});
  server.listen(options.socketPath);

  return {
    answer(askId, behavior, message) {
      const entry = open.get(askId);
      if (!entry) return false;

      const permitted = entry.ask.kind === "question" ? ["answer"] : ["allow", "deny"];
      if (!permitted.includes(behavior)) return false;

      entry.settle(behavior, message, "user");
      return true;
    },

    close() {
      for (const entry of [...open.values()]) {
        if (entry.ask.kind === "question") {
          entry.settle("answer", TURN_ENDED_QUESTION, "shutdown");
        } else {
          entry.settle("deny", TURN_ENDED_PERMISSION, "shutdown");
        }
      }
      try {
        server.close();
      } catch {
      }
      try {
        unlinkSync(options.socketPath);
      } catch {
      }
    },
  };
}

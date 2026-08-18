import type { Readable, Writable } from "node:stream";

export interface RpcLink {
  request(method: string, params?: unknown): Promise<any>;
  notify(method: string, params?: unknown): void;
  reply(id: unknown, result: unknown): void;
  replyError(id: unknown, code: number, message: string): void;
  failPending(reason: Error): void;
}

export interface RpcOptions {
  stdin: Writable;
  stdout: Readable;
  onRequest: (message: any) => void;
  onNotify: (message: any) => void;
  onFrame?: (message: any, direction: "in" | "out") => void;
}

export function attachRpc(options: RpcOptions): RpcLink {
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  let nextId = 1;

  options.stdin.on("error", () => {});

  const write = (frame: unknown) => {
    try {
      options.stdin.write(JSON.stringify(frame) + "\n");
    } catch {
    }
    options.onFrame?.(frame, "out");
  };

  let buffered = "";
  options.stdout.on("data", (chunk) => {
    buffered += chunk;
    for (;;) {
      const cut = buffered.indexOf("\n");
      if (cut === -1) break;
      const line = buffered.slice(0, cut);
      buffered = buffered.slice(cut + 1);
      if (!line.trim()) continue;

      let frame: any;
      try {
        frame = JSON.parse(line);
      } catch {
        continue;
      }
      options.onFrame?.(frame, "in");

      const hasId = frame.id !== undefined;
      const isReply = hasId && (frame.result !== undefined || frame.error !== undefined);

      if (isReply) {
        const waiting = pending.get(frame.id);
        if (!waiting) continue;
        pending.delete(frame.id);
        if (frame.error) {
          waiting.reject(new Error(frame.error.message ?? JSON.stringify(frame.error)));
        } else {
          waiting.resolve(frame.result);
        }
      } else if (hasId && frame.method) {
        options.onRequest(frame);
      } else if (frame.method) {
        options.onNotify(frame);
      }
    }
  });

  return {
    request(method, params) {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        write({ jsonrpc: "2.0", id, method, params });
      });
    },
    notify(method, params) {
      write({ jsonrpc: "2.0", method, params });
    },
    reply(id, result) {
      write({ jsonrpc: "2.0", id, result });
    },
    replyError(id, code, message) {
      write({ jsonrpc: "2.0", id, error: { code, message } });
    },
    failPending(reason) {
      for (const waiting of pending.values()) waiting.reject(reason);
      pending.clear();
    },
  };
}

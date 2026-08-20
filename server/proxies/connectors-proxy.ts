import { readJsonLines } from "../core/ndjson.ts";

const ENDPOINT = process.env.WORKMATES_COMPOSIO_URL || "https://connect.composio.dev/mcp";
const KEY = process.env.WORKMATES_COMPOSIO_KEY ?? "";

const emit = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`);

let inFlight = 0;
let closing = false;
const settle = () => {
  inFlight -= 1;
  if (closing && inFlight === 0) process.exit(0);
};

async function forward(id: unknown, method: string, params: unknown) {
  inFlight += 1;
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "x-consumer-api-key": KEY,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`connector service: HTTP ${response.status}`);
    const body = await response.text();
    const envelope = body.startsWith("{")
      ? body
      : body
          .split("\n")
          .find((line) => line.startsWith("data: "))
          ?.slice("data: ".length);
    if (!envelope) throw new Error("the connector service returned nothing");
    const message = JSON.parse(envelope);
    if (message.error) return emit({ jsonrpc: "2.0", id, error: message.error });
    emit({ jsonrpc: "2.0", id, result: message.result ?? null });
  } catch (error) {
    emit({
      jsonrpc: "2.0",
      id,
      error: { code: -32000, message: (error as Error).message || "connector call failed" },
    });
  } finally {
    settle();
  }
}

async function dispatch(message: any) {
  switch (message.method) {
    case "initialize":
      return emit({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: message.params?.protocolVersion ?? "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "workmates-connectors", version: "1" },
        },
      });

    case "tools/list":
      return forward(message.id, "tools/list", message.params ?? {});

    case "tools/call":
      return forward(message.id, "tools/call", message.params ?? {});
  }

  if (String(message.method ?? "").startsWith("notifications/")) return;
  if (message.id != null) {
    emit({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32601, message: `method not found: ${message.method}` },
    });
  }
}

readJsonLines(process.stdin, (message) => void dispatch(message));
process.stdin.on("end", () => {
  closing = true;
  if (inFlight === 0) process.exit(0);
});

import { connect } from "node:net";
import { randomUUID } from "node:crypto";

import { readJsonLines } from "../core/ndjson.ts";

const BROKER_GONE = "Workmates: permission broker unavailable, skip this action";

const socketPath = process.argv[2] ?? "";
const outstanding = new Map<string, (reply: any) => void>();
const socket = connect(socketPath);

function abandonAll() {
  for (const settle of outstanding.values()) {
    settle({ behavior: "deny", message: BROKER_GONE });
  }
  outstanding.clear();
}
socket.on("error", abandonAll);
socket.on("close", abandonAll);
readJsonLines(socket, (frame) => {
  if (frame.t !== "answer") return;
  outstanding.get(frame.id)?.(frame);
  outstanding.delete(frame.id);
});

function askHuman(request: object): Promise<any> {
  const id = randomUUID();
  return new Promise((settle) => {
    outstanding.set(id, settle);
    if (socket.destroyed) return abandonAll();
    try {
      socket.write(JSON.stringify({ ...request, id }) + "\n");
    } catch {
      abandonAll();
    }
  });
}

const writeFrame = (frame: unknown) => process.stdout.write(JSON.stringify(frame) + "\n");

const PUBLISHED_TOOLS = [
  {
    name: "approve",
    description: "Ask the Workmates user whether a tool use is allowed",
    inputSchema: {
      type: "object",
      properties: {
        tool_name: { type: "string" },
        input: { type: "object" },
        tool_use_id: { type: "string" },
      },
      required: ["tool_name", "input"],
    },
  },
  {
    name: "request_connection",
    description:
      "Ask the user to connect an app (Slack, Gmail, GitHub, and so on) so you can use it. A sign-in card appears in the chat; never paste sign-in links into chat yourself. After calling this, wrap up your turn: the app resumes the task automatically once the user connects.",
    inputSchema: {
      type: "object",
      properties: {
        apps: {
          type: "array",
          items: { type: "string" },
          description: "App slugs to connect, lowercase, e.g. [\"slack\", \"gmail\"]",
        },
        reason: { type: "string", description: "One line on why, shown to the user" },
      },
      required: ["apps"],
    },
  },
  {
    name: "request_secret",
    description:
      "Ask the user for an API key or other secret value via a secure field in the chat. The value is stored on their Mac and handed to your shell tools as an environment variable on your next turn; it never appears in the conversation. After calling this, wrap up your turn: the task resumes automatically once they save it.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "What the secret is, e.g. \"Transistor API key\"" },
        hint: { type: "string", description: "One line on where to find it, shown under the field" },
      },
      required: ["name"],
    },
  },
  {
    name: "ask_user",
    description:
      "Put a question to the person you work for and wait for their reply. Use it for anything that is genuinely theirs to decide: a preference, a missing fact, or sign-off before something consequential. Guessing is worse than asking here. Their answer comes back as text.",
    inputSchema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The question. Carry enough context that it can be answered without going and looking something up.",
        },
        choices: {
          type: "array",
          items: { type: "string" },
          description: "Optional. Two to five likely answers, offered as buttons so a reply takes one tap.",
        },
      },
      required: ["question"],
    },
  },
];

function proposedRules(args: any): unknown[] | null {
  if (Array.isArray(args.permission_suggestions)) return args.permission_suggestions;
  if (Array.isArray(args.suggestions)) return args.suggestions;
  return null;
}

function permissionVerdict(reply: any, args: any): string {
  if (reply.behavior !== "allow") {
    return JSON.stringify({
      behavior: "deny",
      message: reply.message || "Denied from Workmates",
    });
  }
  const rules = reply.always ? proposedRules(args) : null;
  return JSON.stringify({
    behavior: "allow",
    updatedInput: args.input ?? {},
    ...(rules ? { updatedPermissions: rules } : {}),
  });
}

async function dispatch(message: any) {
  switch (message.method) {
    case "initialize":
      return writeFrame({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: message.params?.protocolVersion ?? "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "workmates-permissions", version: "1" },
        },
      });

    case "tools/list":
      return writeFrame({ jsonrpc: "2.0", id: message.id, result: { tools: PUBLISHED_TOOLS } });

    case "tools/call": {
      const args = message.params?.arguments ?? {};
      const name = message.params?.name;
      const isQuestion = name === "ask_user";
      const isConnection = name === "request_connection";
      const isSecret = name === "request_secret";

      const reply = await askHuman(
        isSecret
          ? {
              t: "ask",
              kind: "question",
              tool: "request_secret",
              input: { name: args.name, hint: args.hint },
            }
          : isConnection
          ? {
              t: "ask",
              kind: "question",
              tool: "request_connection",
              input: { apps: args.apps, reason: args.reason },
            }
          : isQuestion
            ? {
                t: "ask",
                kind: "question",
                tool: "ask_user",
                input: { question: args.question, choices: args.choices },
              }
            : { t: "ask", tool: args.tool_name, input: args.input },
      );

      const text =
        isQuestion || isConnection || isSecret
          ? reply.message || "No answer was given. Use your best judgment."
          : permissionVerdict(reply, args);

      return writeFrame({
        jsonrpc: "2.0",
        id: message.id,
        result: { content: [{ type: "text", text }] },
      });
    }
  }

  if (String(message.method ?? "").startsWith("notifications/")) return;
  if (message.id != null) {
    writeFrame({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32601, message: `method not found: ${message.method}` },
    });
  }
}

readJsonLines(process.stdin, (message) => void dispatch(message));
process.stdin.on("end", () => process.exit(0));

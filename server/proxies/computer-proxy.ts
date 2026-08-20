import { readJsonLines } from "../core/ndjson.ts";

const BOX_API = "https://ascii.dev/api/box/v1";
const boxId = process.env.WORKMATES_BOX_ID ?? "";
const token = process.env.WORKMATES_BOX_TOKEN ?? "";

const SHOT_WIDTH = 1280;
const SHOT_PATH = "/tmp/workmates-shot.png";

const WITH_DISPLAY = "export DISPLAY=${DISPLAY:-:0}; ";

async function runOnBox(command: string, timeoutMs = 60_000) {
  const response = await fetch(`${BOX_API}/boxes/${boxId}/commands`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ command }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body: any = await response.json().catch(() => null);

  return {
    ok: response.ok && body?.exitCode === 0,
    exitCode: body?.exitCode ?? null,
    stdout: body?.stdout ?? "",
    stderr: body?.stderr ?? "",
  };
}

async function readBoxFile(path: string): Promise<string | null> {
  const response = await fetch(
    `${BOX_API}/boxes/${boxId}/files?path=${encodeURIComponent(path)}&encoding=base64`,
    { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) },
  );
  const body: any = await response.json().catch(() => null);
  const content = body?.content;
  return response.ok && typeof content === "string" && content ? content : null;
}

const shellQuote = (value: string) => value.replace(/'/g, "'\\''");

async function viaCua(command: string, params: Record<string, unknown>, timeoutMs = 30_000) {
  const payload = shellQuote(JSON.stringify({ command, params }));
  const result = await runOnBox(
    `curl -sf -m ${Math.floor(timeoutMs / 1000)} -X POST http://127.0.0.1:8000/cmd ` +
      `-H 'Content-Type: application/json' -d '${payload}'`,
    timeoutMs + 15_000,
  );
  if (!result.ok || !result.stdout.trim()) return null;

  const line = result.stdout.split("\n").find((l: string) => l.startsWith("data: "));
  if (!line) return null;
  try {
    const parsed = JSON.parse(line.slice("data: ".length));
    return parsed?.success === false ? null : parsed;
  } catch {
    return null;
  }
}

let displaySize: { width: number; height: number } | null | undefined;
async function geometry() {
  if (displaySize !== undefined) return displaySize;

  const result = await runOnBox(`${WITH_DISPLAY}xdotool getdisplaygeometry`);
  const parsed = result.stdout.trim().match(/^(\d+)\s+(\d+)/);
  displaySize = parsed ? { width: Number(parsed[1]), height: Number(parsed[2]) } : null;
  return displaySize;
}

const CAPTURE = [
  "export DISPLAY=${DISPLAY:-:0}",
  `f=${SHOT_PATH}`,
  'scrot -o "$f" 2>/dev/null || import -window root "$f" 2>/dev/null || ffmpeg -y -f x11grab -i "$DISPLAY" -frames:v 1 "$f" >/dev/null 2>&1',
  `command -v convert >/dev/null && convert "$f" -resize ${SHOT_WIDTH}x "$f" 2>/dev/null || true`,
  'test -s "$f" && echo captured',
].join("; ");

const emit = (frame: unknown) => process.stdout.write(JSON.stringify(frame) + "\n");

const say = (id: unknown, text: string, failed = false) =>
  emit({
    jsonrpc: "2.0",
    id,
    result: { content: [{ type: "text", text }], ...(failed ? { isError: true } : {}) },
  });

const TOOLS = [
  {
    name: "screenshot",
    description:
      "See the agent's cloud computer screen (returns an image). Call before and after acting to ground yourself. The desktop runs Chrome and a full Linux GUI.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "click",
    description:
      "Click on the computer's screen. Use pixel coordinates as they appear in the most recent screenshot. Scaling to the real display resolution is handled for you.",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        button: { type: "string", enum: ["left", "right"], description: "default left" },
        double: { type: "boolean", description: "double-click" },
      },
      required: ["x", "y"],
    },
  },
  {
    name: "type_text",
    description: "Type text at the current focus on the computer.",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  },
  {
    name: "press_key",
    description:
      'Press a key or chord on the computer, xdotool syntax: "Return", "Tab", "ctrl+c", "alt+F4", "ctrl+shift+t".',
    inputSchema: { type: "object", properties: { keys: { type: "string" } }, required: ["keys"] },
  },
  {
    name: "scroll",
    description: "Scroll the computer screen up or down by N clicks.",
    inputSchema: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["up", "down"] },
        clicks: { type: "number", description: "default 3" },
      },
      required: ["direction"],
    },
  },
  {
    name: "computer_exec",
    description:
      "Run a shell command on the agent's cloud computer (Linux, passwordless sudo, X11 desktop). Returns stdout/stderr/exit code.",
    inputSchema: {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
    },
  },
  {
    name: "open_url",
    description: "Open a URL in the computer's own Chrome, then screenshot to see the result.",
    inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  },
];

async function invoke(id: unknown, name: string, args: any) {
  switch (name) {
    case "screenshot": {
      const captured = await runOnBox(CAPTURE, 60_000);
      if (!/captured/.test(captured.stdout)) {
        const why = captured.stderr.slice(0, 200) || "capture produced no file";
        return say(id, `screenshot failed: ${why}`, true);
      }
      const data = await readBoxFile(SHOT_PATH);
      if (!data) return say(id, "screenshot failed: could not read the frame back", true);

      return emit({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "image", data, mimeType: "image/png" }] },
      });
    }

    case "click": {
      const x = Math.round(Number(args.x));
      const y = Math.round(Number(args.y));
      if (!Number.isFinite(x) || !Number.isFinite(y)) return say(id, "click needs numeric x,y", true);

      const display = await geometry();
      const scale = display ? display.width / SHOT_WIDTH : 1;
      const px = Math.round(x * scale);
      const py = Math.round(y * scale);

      const button = args.button === "right" ? 3 : 1;
      const repeat = args.double ? "--repeat 2 --delay 150 " : "";
      const result = await runOnBox(`${WITH_DISPLAY}xdotool mousemove ${px} ${py} click ${repeat}${button}`);
      if (!result.ok) return say(id, `click failed: ${result.stderr.slice(0, 200)}`, true);

      const scaled =
        scale !== 1 ? ` (scaled to ${px},${py} on the ${display!.width}x${display!.height} display)` : "";
      const kind = `${args.double ? " (double)" : ""}${args.button === "right" ? " (right)" : ""}`;
      return say(id, `clicked ${x},${y}${scaled}${kind}. Screenshot to verify`);
    }

    case "type_text": {
      const text = String(args.text ?? "");
      if (!text) return say(id, "nothing to type", true);

      if (!(await viaCua("type_text", { text }))) {
        const result = await runOnBox(`${WITH_DISPLAY}xdotool type --delay 12 '${shellQuote(text)}'`);
        if (!result.ok) return say(id, `type failed: ${result.stderr.slice(0, 200)}`, true);
      }
      return say(id, `typed ${text.length} chars`);
    }

    case "press_key": {
      const keys = String(args.keys ?? "").replace(/[^\w+]/g, "");
      if (!keys) return say(id, "press_key needs keys", true);

      const result = await runOnBox(`${WITH_DISPLAY}xdotool key ${keys}`);
      return result.ok
        ? say(id, `pressed ${keys}`)
        : say(id, `key failed: ${result.stderr.slice(0, 200)}`, true);
    }

    case "scroll": {
      const clicks = Math.min(Math.max(Math.round(Number(args.clicks) || 3), 1), 20);
      const up = args.direction === "up";

      if (!(await viaCua(up ? "scroll_up" : "scroll_down", { clicks }))) {
        const result = await runOnBox(`${WITH_DISPLAY}xdotool click --repeat ${clicks} ${up ? 4 : 5}`);
        if (!result.ok) return say(id, `scroll failed: ${result.stderr.slice(0, 200)}`, true);
      }
      return say(id, `scrolled ${args.direction} ${clicks}`);
    }

    case "computer_exec": {
      const result = await runOnBox(String(args.command ?? "").slice(0, 4000), 120_000);
      const stderr = result.stderr ? `\n[stderr]\n${result.stderr.slice(-2000)}` : "";
      return say(id, `exit ${result.exitCode}\n${result.stdout.slice(-6000)}${stderr}`);
    }

    case "open_url": {
      const url = String(args.url ?? "");
      if (!/^https?:\/\//.test(url)) return say(id, "only http(s) URLs", true);

      const safe = url.replace(/'/g, "%27");
      await runOnBox(
        `${WITH_DISPLAY}(google-chrome '${safe}' || chromium '${safe}' || chromium-browser '${safe}' || xdg-open '${safe}') >/dev/null 2>&1 & sleep 3; echo opened`,
        30_000,
      );
      return say(id, `opened ${url}. Take a screenshot to see it`);
    }

    default:
      return say(id, `unknown tool ${name}`, true);
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
          serverInfo: { name: "workmates-computer", version: "2" },
        },
      });

    case "tools/list":
      return emit({ jsonrpc: "2.0", id: message.id, result: { tools: TOOLS } });

    case "tools/call":
      try {
        return await invoke(message.id, message.params?.name, message.params?.arguments ?? {});
      } catch (error) {
        return say(message.id, `computer tool failed: ${(error as Error).message}`, true);
      }
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
process.stdin.on("end", () => process.exit(0));

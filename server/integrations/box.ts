import type { AppConfig } from "../core/config.ts";

const BOX_API = "https://ascii.dev/api/box/v1";

const AWAKE = new Set(["idle", "ready", "running"]);

const BOX_PREFIX = "/opt/workmates";
const SHOT_PATH = "/tmp/workmates-shot.png";

function request(cfg: AppConfig, path: string, init: RequestInit = {}) {
  return fetch(`${BOX_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${cfg.box?.token}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

async function call(cfg: AppConfig, path: string, init: RequestInit = {}) {
  const response = await request(cfg, path, init);
  const body: any = await response.json().catch(() => null);
  return { ok: response.ok && body?.ok !== false, status: response.status, body };
}

export function boxError(action: string, status: number, body: any, token = "") {
  const detail = body?.error?.message ?? body?.message ?? (typeof body?.error === "string" ? body.error : "");
  const safeDetail = token ? String(detail).split(token).join("[redacted]") : String(detail);
  return new Error(`Box ${action} failed (${status})${safeDetail ? `: ${safeDetail.slice(0, 1000)}` : ""}`);
}

export function boxConfigured(cfg: AppConfig) {
  return Boolean(cfg.box?.token);
}

async function nameFor(botId: string, prefix: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(botId));
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 6);
  const stem = botId.slice(0, 8).toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${prefix}-${stem}-${hash}`;
}

async function candidateNames(botId: string) {
  return [await nameFor(botId, "workmates"), await nameFor(botId, "ogb")];
}

export async function findBox(cfg: AppConfig, botId: string) {
  const names = await candidateNames(botId);
  const { ok, status, body } = await call(cfg, "/boxes");
  if (!ok) throw boxError("listing", status, body, cfg.box?.token);
  const boxes: any[] = body?.boxes ?? [];
  return boxes.find((box) => names.includes(box.name) && box.state !== "error") ?? null;
}

async function waitUntilAwake(cfg: AppConfig, boxId: string, budgetMs = 90_000) {
  const deadline = Date.now() + budgetMs;

  while (Date.now() < deadline) {
    const { body } = await call(cfg, `/boxes/${boxId}`);
    const state = body?.box?.state;

    if (AWAKE.has(state)) return body.box;
    if (state === "error") return null;
    if (state === "archived") {
      await call(cfg, `/boxes/${boxId}/resume`, { method: "POST" });
    }
    await sleep(2500);
  }
  return null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function mintDesktopUrl(cfg: AppConfig, boxId: string, budgetMs = 60_000) {
  const deadline = Date.now() + budgetMs;

  while (Date.now() < deadline) {
    const { body } = await call(cfg, `/boxes/${boxId}/desktop?vnc=1`, { method: "POST" });
    const url = body?.desktopUrl ?? body?.url;
    if (url) return url;
    if (!body?.provisioning) break;
    await sleep(3000);
  }

  const { ok, status, body } = await call(cfg, `/boxes/${boxId}/desktop`, { method: "POST" });
  if (!ok) throw boxError("desktop connection", status, body, cfg.box?.token);
  const url = body?.desktopUrl ?? body?.url;
  if (!url) throw new Error("The desktop is still starting. Try opening it again in a moment.");
  return url;
}

export async function runCommand(
  cfg: AppConfig,
  boxId: string,
  command: string,
  { timeoutMs = 120_000 } = {},
) {
  const response = await request(cfg, `/boxes/${boxId}/commands`, {
    method: "POST",
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

function bootstrapScript(botName: string) {
  const installCua = [
    "sudo apt-get update -qq || true",
    "sudo apt-get install -y -qq gnome-screenshot xclip wmctrl xdotool imagemagick scrot >/dev/null 2>&1 || true",
    "curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null 2>&1 || true",
    'export PATH="$HOME/.local/bin:$PATH"',
    `sudo mkdir -p ${BOX_PREFIX} && sudo chown "$(whoami)" ${BOX_PREFIX}`,
    `uv venv ${BOX_PREFIX}/venv --python 3.13 >/dev/null 2>&1 || uv venv ${BOX_PREFIX}/venv >/dev/null 2>&1 || true`,
    `[ -x ${BOX_PREFIX}/venv/bin/python ] && uv pip install --python ${BOX_PREFIX}/venv/bin/python cua-computer-server >/dev/null 2>&1 || true`,
    `[ -x ${BOX_PREFIX}/venv/bin/python ] && ${BOX_PREFIX}/venv/bin/python -c 'import computer_server' 2>/dev/null && touch ${BOX_PREFIX}/cua-ready || true`,
  ].join("; ");

  const safeName = botName.replace(/["'\\]/g, "");

  return [
    `command -v xdotool >/dev/null || sudo apt-get install -y -qq xdotool scrot imagemagick >/dev/null 2>&1 || true`,

    `[ -f ${BOX_PREFIX}/cua-ready ] || [ -f /tmp/workmates-cua-installing ] || { touch /tmp/workmates-cua-installing; nohup bash -c '${installCua.replace(/'/g, "'\\''")}; rm -f /tmp/workmates-cua-installing' > /tmp/workmates-cua-install.log 2>&1 & }`,

    `if [ -f ${BOX_PREFIX}/cua-ready ] && ! pgrep -f "computer_server" >/dev/null 2>&1; then DISPLAY=\${DISPLAY:-:0} nohup ${BOX_PREFIX}/venv/bin/python -m computer_server --host 127.0.0.1 --port 8000 --width 1280 --height 800 > /tmp/workmates-cua-server.log 2>&1 & fi`,

    `tmux has-session -t work 2>/dev/null || tmux new-session -d -s work 'echo; echo "  ▦ ${safeName}'"'"'s computer, Workmates"; echo; exec bash -i'`,

    "echo bootstrapped",
  ].join("\n");
}

export async function boxStatus(cfg: AppConfig, botId: string) {
  if (!boxConfigured(cfg)) return { configured: false, box: null };

  const box = await findBox(cfg, botId);
  return {
    configured: true,
    box: box
      ? { boxId: box.id, state: box.state, desktopAvailable: box.desktopAvailable ?? null }
      : null,
  };
}

const provisioning = new Map<string, Promise<Awaited<ReturnType<typeof provisionBoxOnce>>>>();

export function provisionBox(cfg: AppConfig, botId: string, botName: string) {
  const existing = provisioning.get(botId);
  if (existing) return existing;
  const pending = provisionBoxOnce(cfg, botId, botName).finally(() => provisioning.delete(botId));
  provisioning.set(botId, pending);
  return pending;
}

async function provisionBoxOnce(cfg: AppConfig, botId: string, botName: string) {
  if (!boxConfigured(cfg)) {
    throw new Error('box provider not enabled. Add {"box":{"token":"…"}} to ~/.workmates/config.json');
  }

  const name = await nameFor(botId, "workmates");
  let box = await findBox(cfg, botId);
  const existed = Boolean(box);

  if (!box) {
    let created = await call(cfg, "/boxes", {
      method: "POST",
      body: JSON.stringify({ ttlSeconds: 8 * 60 * 60 }),
    });
    if (!created.ok && created.status === 400 && (created.body?.error?.code ?? created.body?.code) === "trial_auto_stop_required") {
      created = await call(cfg, "/boxes", {
        method: "POST",
        body: JSON.stringify({ ttlSeconds: 2 * 60 * 60 }),
      });
    }
    if (!created.ok || !created.body?.box?.id) {
      throw boxError("creation", created.status, created.body, cfg.box?.token);
    }
    box = created.body.box;
    await call(cfg, `/boxes/${box.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
  }

  const awake = await waitUntilAwake(cfg, box.id);
  if (!awake) throw new Error("box did not become ready within 90s, retry in a minute");

  const script = bootstrapScript(botName);
  for (let attempt = 0; attempt < 5; attempt++) {
    const result = await runCommand(cfg, box.id, script);
    if (result.ok || result.exitCode !== null) break;
    await sleep(3000);
  }

  return {
    boxId: box.id,
    machineName: name,
    reused: existed,
    state: awake.state,
    joinUrl: await mintDesktopUrl(cfg, box.id),
  };
}

export async function joinBox(cfg: AppConfig, botId: string) {
  const box = await findBox(cfg, botId);
  if (!box) throw new Error("no computer yet, provision it first");

  const awake = await waitUntilAwake(cfg, box.id);
  if (!awake) throw new Error("the box did not wake in time, try again");

  return { joinUrl: await mintDesktopUrl(cfg, box.id), state: awake.state ?? null };
}

export async function sleepBox(cfg: AppConfig, botId: string) {
  const box = await findBox(cfg, botId);
  if (!box) throw new Error("no computer for this agent");

  await call(cfg, `/boxes/${box.id}/stop`, { method: "POST" }).catch(() => {});
  return { ok: true };
}

export async function execOnBox(cfg: AppConfig, botId: string, command: string) {
  const box = await findBox(cfg, botId);
  if (!box) throw new Error("no computer for this agent yet");

  const awake = await waitUntilAwake(cfg, box.id, 60_000);
  if (!awake) throw new Error("box did not wake");

  const result = await runCommand(cfg, box.id, String(command ?? "").slice(0, 4000));
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.slice(-4000),
    stderr: result.stderr.slice(-2000),
  };
}

const CAPTURE_SCRIPT = [
  "export DISPLAY=${DISPLAY:-:0}",
  `f=${SHOT_PATH}`,
  'scrot -o "$f" 2>/dev/null || import -window root "$f" 2>/dev/null || ffmpeg -y -f x11grab -i "$DISPLAY" -frames:v 1 "$f" >/dev/null 2>&1',
  'command -v convert >/dev/null && convert "$f" -resize 1024x "$f" 2>/dev/null || true',
  'test -s "$f" && echo captured',
].join("; ");

export async function screenshotBox(cfg: AppConfig, botId: string) {
  const box = await findBox(cfg, botId);
  if (!box) throw new Error("no computer for this agent yet");
  if (!AWAKE.has(box.state)) throw new Error(`box is ${box.state}`);

  const captured = await runCommand(cfg, box.id, CAPTURE_SCRIPT, { timeoutMs: 60_000 });
  if (!/captured/.test(captured.stdout)) {
    throw new Error(captured.stderr.slice(0, 200) || "screen capture failed on the box");
  }

  const { ok, body } = await call(
    cfg,
    `/boxes/${box.id}/files?path=${encodeURIComponent(SHOT_PATH)}&encoding=base64`,
  );
  const png = body?.content;
  if (!ok || typeof png !== "string" || !png) {
    throw new Error("could not read the frame back from the box");
  }
  return { png, format: "png" };
}

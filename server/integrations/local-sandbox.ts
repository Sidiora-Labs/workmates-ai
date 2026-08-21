import { execFile } from "node:child_process";

const IMAGE = "ubuntu:24.04";

const RUNTIME_OVERRIDE = process.env.WORKMATES_SANDBOX_RUNTIME;

const RUNTIMES = ["container", "docker"] as const;
export type SandboxRuntime = (typeof RUNTIMES)[number] | string;

interface RunResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(binary: string, args: string[], timeoutMs = 60_000): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(binary, args, { timeout: timeoutMs, maxBuffer: 4_000_000 }, (error, stdout, stderr) => {
      const code = (error as any)?.code;
      resolve({
        ok: !error,
        code: typeof code === "number" ? code : error ? 1 : 0,
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
      });
    });
  });
}

let cachedRuntime: string | null | undefined;

export async function sandboxRuntime(): Promise<string | null> {
  if (cachedRuntime !== undefined) return cachedRuntime;
  if (RUNTIME_OVERRIDE) {
    cachedRuntime = RUNTIME_OVERRIDE;
    return cachedRuntime;
  }
  for (const candidate of RUNTIMES) {
    const probe = await run(candidate, ["--version"], 5_000);
    if (probe.ok) {
      cachedRuntime = candidate;
      return cachedRuntime;
    }
  }
  cachedRuntime = null;
  return null;
}

async function nameFor(botId: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(botId));
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 6);
  const stem = botId.slice(0, 8).toLowerCase().replace(/[^a-z0-9]/g, "");
  return { container: `workmates-sbx-${stem}-${hash}`, volume: `workmates-work-${stem}-${hash}` };
}

export interface SandboxStatus {
  available: boolean;
  runtime: string | null;
  state: "none" | "running" | "stopped";
  name?: string;
}

export async function sandboxStatus(botId: string): Promise<SandboxStatus> {
  const runtime = await sandboxRuntime();
  if (!runtime) return { available: false, runtime: null, state: "none" };

  const { container } = await nameFor(botId);
  const all = await run(runtime, ["ps", "-a", "--format", "{{.Names}}\t{{.Status}}"], 15_000);
  const line = all.stdout.split("\n").find((row) => row.startsWith(container));
  if (!line) return { available: true, runtime, state: "none", name: container };

  const up = /\bUp\b|running/i.test(line);
  return { available: true, runtime, state: up ? "running" : "stopped", name: container };
}

export async function provisionSandbox(botId: string): Promise<SandboxStatus> {
  const runtime = await sandboxRuntime();
  if (!runtime) {
    throw new Error(
      "no container runtime found. Install Apple's container CLI (github.com/apple/container) or Docker, then try again",
    );
  }
  const { container, volume } = await nameFor(botId);
  const current = await sandboxStatus(botId);

  if (current.state === "none") {
    await run(runtime, ["volume", "create", volume], 30_000);
    const created = await run(
      runtime,
      [
        "run",
        "--detach",
        "--name", container,
        "--volume", `${volume}:/work`,
        "--workdir", "/work",
        IMAGE,
        "sleep", "infinity",
      ],
      300_000,
    );
    if (!created.ok) {
      throw new Error(`the sandbox could not start: ${created.stderr.slice(0, 300) || "runtime error"}`);
    }
  } else if (current.state === "stopped") {
    const started = await run(runtime, ["start", container], 60_000);
    if (!started.ok) {
      throw new Error(`the sandbox would not wake: ${started.stderr.slice(0, 300) || "runtime error"}`);
    }
  }
  return sandboxStatus(botId);
}

export async function execInSandbox(botId: string, command: string) {
  const runtime = await sandboxRuntime();
  if (!runtime) throw new Error("no container runtime found");
  const { container } = await nameFor(botId);

  const result = await run(
    runtime,
    ["exec", container, "sh", "-lc", command.slice(0, 4000)],
    120_000,
  );
  return {
    exitCode: result.code,
    stdout: result.stdout.slice(-5000),
    stderr: result.stderr.slice(-2000),
  };
}

export async function stopSandbox(botId: string) {
  const runtime = await sandboxRuntime();
  if (!runtime) throw new Error("no container runtime found");
  const { container } = await nameFor(botId);
  await run(runtime, ["stop", container], 60_000);
  return sandboxStatus(botId);
}

export async function destroySandbox(botId: string) {
  const runtime = await sandboxRuntime();
  if (!runtime) return;
  const { container, volume } = await nameFor(botId);
  await run(runtime, ["rm", "-f", container], 60_000);
  await run(runtime, ["volume", "rm", volume], 30_000);
}

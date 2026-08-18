import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { join } from "node:path";

export interface TerminalInfo {
  botId: string;
  cwd: string;
  shell: string;
  pty: boolean;
  provider: string;
  cols: number;
  rows: number;
  startedAt: number;
  exitedAt?: number;
  exitCode?: number | null;
}

export const MIN_COLS = 20;
export const MAX_COLS = 500;
export const MIN_ROWS = 5;
export const MAX_ROWS = 200;

export const SCROLLBACK_BYTES = 128 * 1024;

export const MAX_SESSIONS = 12;

export const IDLE_MS = 8 * 60 * 60 * 1000;

export const MAX_INPUT_BYTES = 8 * 1024;

export function clampCols(value: unknown): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(MIN_COLS, Math.min(MAX_COLS, n)) : 80;
}

export function clampRows(value: unknown): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(MIN_ROWS, Math.min(MAX_ROWS, n)) : 24;
}

export function shellFor(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string {
  if (platform === "win32") return env.COMSPEC || "powershell.exe";
  const chosen = env.SHELL;
  if (chosen && chosen.startsWith("/") && !chosen.includes("false") && !chosen.includes("nologin")) {
    return chosen;
  }
  return platform === "darwin" ? "/bin/zsh" : "/bin/bash";
}

export interface PtyProvider {
  name: "script" | "expect" | "python";
  file: string;
  args: (cols: number, rows: number) => string[];
}

function innerCommand(cols: number, rows: number): string {
  return `stty rows ${rows} cols ${cols} 2>/dev/null; exec "$WORKMATES_SHELL" -i`;
}

const SCRIPT: PtyProvider = {
  name: "script",
  file: "script",
  args: (cols, rows) => ["-qfc", innerCommand(cols, rows), "/dev/null"],
};

const EXPECT: PtyProvider = {
  name: "expect",
  file: "expect",
  args: (cols, rows) => [
    "-c",
    `set stty_init "rows ${rows} cols ${cols}"; spawn -noecho /bin/sh -c {${innerCommand(cols, rows)}}; interact`,
  ],
};

const PYTHON: PtyProvider = {
  name: "python",
  file: "python3",
  args: (cols, rows) => [
    "-c",
    `import pty; pty.spawn(["/bin/sh", "-c", ${JSON.stringify(innerCommand(cols, rows))}])`,
  ],
};

export function ptyProviders(platform: NodeJS.Platform): PtyProvider[] {
  if (platform === "win32") return [];
  if (platform === "linux") return [SCRIPT, EXPECT, PYTHON];
  return [EXPECT, PYTHON, SCRIPT];
}

export function chooseProvider(
  platform: NodeJS.Platform,
  lookup: (file: string) => boolean,
): PtyProvider | null {
  for (const provider of ptyProviders(platform)) {
    if (lookup(provider.file)) return provider;
  }
  return null;
}

export function onPath(file: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (file.includes("/")) return canRun(file);
  for (const dir of (env.PATH ?? "").split(":")) {
    if (dir && canRun(join(dir, file))) return true;
  }
  return false;
}

function canRun(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function spawnPlan(
  platform: NodeJS.Platform,
  shell: string,
  cols: number,
  rows: number,
  lookup: (file: string) => boolean = onPath,
): { file: string; args: string[]; pty: boolean; provider: string } {
  const provider = chooseProvider(platform, lookup);
  if (!provider) return { file: shell, args: [], pty: false, provider: "none" };
  return { file: provider.file, args: provider.args(cols, rows), pty: true, provider: provider.name };
}

export function resizeLine(cols: number, rows: number): string {
  return ` stty rows ${rows} cols ${cols} 2>/dev/null\n`;
}

export function worthResizing(
  from: { cols: number; rows: number },
  to: { cols: number; rows: number },
): boolean {
  return Math.abs(from.cols - to.cols) >= 2 || Math.abs(from.rows - to.rows) >= 2;
}

export class Scrollback {
  private chunks: Buffer[] = [];
  private size = 0;
  private limit: number;

  constructor(limit: number = SCROLLBACK_BYTES) {
    this.limit = limit;
  }

  push(chunk: Buffer) {
    this.chunks.push(chunk);
    this.size += chunk.length;
    while (this.size > this.limit && this.chunks.length > 1) {
      this.size -= this.chunks.shift()!.length;
    }
    if (this.size > this.limit && this.chunks.length === 1) {
      const only = this.chunks[0];
      this.chunks[0] = only.subarray(only.length - this.limit);
      this.size = this.limit;
    }
  }

  get bytes(): number {
    return this.size;
  }

  read(): Buffer {
    return Buffer.concat(this.chunks);
  }

  clear() {
    this.chunks = [];
    this.size = 0;
  }
}

type Listener = (chunk: Buffer) => void;
type Ending = () => void;

export class TerminalSession {
  readonly botId: string;
  readonly cwd: string;
  readonly shell: string;
  readonly pty: boolean;
  readonly provider: string;
  readonly startedAt: number;
  cols: number;
  rows: number;
  exitedAt?: number;
  exitCode?: number | null;
  idleSince = 0;

  private child: ChildProcessWithoutNullStreams | null = null;
  private scrollback = new Scrollback();
  private listeners = new Set<Listener>();
  private endings = new Set<Ending>();

  constructor(input: { botId: string; cwd: string; cols: number; rows: number; now: number }) {
    this.botId = input.botId;
    this.cwd = input.cwd;
    this.cols = clampCols(input.cols);
    this.rows = clampRows(input.rows);
    this.startedAt = input.now;
    this.shell = shellFor(process.platform, process.env);

    const plan = spawnPlan(process.platform, this.shell, this.cols, this.rows);
    this.pty = plan.pty;
    this.provider = plan.provider;
    this.child = spawn(plan.file, plan.args, {
      cwd: this.cwd,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLUMNS: String(this.cols),
        LINES: String(this.rows),
        WORKMATES_SHELL: this.shell,
        WORKMATES_TERMINAL: "1",
      },
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams;

    const take = (chunk: Buffer) => {
      this.scrollback.push(chunk);
      for (const listener of this.listeners) listener(chunk);
    };
    this.child.stdout.on("data", take);
    this.child.stderr.on("data", take);
    this.child.on("error", (e) => {
      take(Buffer.from(`\r\n[the shell would not start: ${e.message}]\r\n`));
      this.settle(null);
    });
    this.child.on("exit", (code) => {
      take(Buffer.from(`\r\n[the shell exited${code === null ? "" : ` with ${code}`}]\r\n`));
      this.settle(code);
    });
  }

  private settle(code: number | null) {
    if (this.exitedAt) return;
    this.exitedAt = Date.now();
    this.exitCode = code;
    this.child = null;
    for (const ending of this.endings) ending();
  }

  get alive(): boolean {
    return Boolean(this.child) && !this.exitedAt;
  }

  get watchers(): number {
    return this.listeners.size;
  }

  info(): TerminalInfo {
    return {
      botId: this.botId,
      cwd: this.cwd,
      shell: this.shell,
      pty: this.pty,
      provider: this.provider,
      cols: this.cols,
      rows: this.rows,
      startedAt: this.startedAt,
      ...(this.exitedAt ? { exitedAt: this.exitedAt, exitCode: this.exitCode ?? null } : {}),
    };
  }

  attach(listener: Listener, onEnd?: Ending): { replay: Buffer; detach: () => void } {
    this.listeners.add(listener);
    if (onEnd) this.endings.add(onEnd);
    this.idleSince = 0;
    return {
      replay: this.scrollback.read(),
      detach: () => {
        this.listeners.delete(listener);
        if (onEnd) this.endings.delete(onEnd);
        if (!this.listeners.size) this.idleSince = Date.now();
      },
    };
  }

  write(data: string): boolean {
    if (!this.child?.stdin.writable) return false;
    this.child.stdin.write(data.slice(0, MAX_INPUT_BYTES));
    return true;
  }

  resize(cols: number, rows: number) {
    const next = { cols: clampCols(cols), rows: clampRows(rows) };
    if (!worthResizing(this, next)) return;
    this.cols = next.cols;
    this.rows = next.rows;
    if (this.pty) this.write(resizeLine(next.cols, next.rows));
  }

  close() {
    this.listeners.clear();
    this.endings.clear();
    const child = this.child;
    this.settle(null);
    if (!child) return;
    try {
      child.kill("SIGHUP");
    } catch {}
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
    }, 2_000).unref?.();
  }
}

export class TerminalStore {
  private sessions = new Map<string, TerminalSession>();

  get(botId: string): TerminalSession | null {
    return this.sessions.get(botId) ?? null;
  }

  list(): TerminalInfo[] {
    return [...this.sessions.values()].map((s) => s.info());
  }

  open(input: { botId: string; cwd: string; cols: number; rows: number; now: number }): TerminalSession {
    const existing = this.sessions.get(input.botId);
    if (existing && existing.alive && existing.cwd === input.cwd) return existing;
    if (existing) {
      existing.close();
      this.sessions.delete(input.botId);
    }
    if (this.sessions.size >= MAX_SESSIONS) {
      const [oldest] = [...this.sessions.values()].sort(
        (a, b) => (a.idleSince || Infinity) - (b.idleSince || Infinity),
      );
      if (oldest) this.close(oldest.botId);
    }
    const session = new TerminalSession(input);
    this.sessions.set(input.botId, session);
    return session;
  }

  close(botId: string) {
    const session = this.sessions.get(botId);
    if (!session) return;
    session.close();
    this.sessions.delete(botId);
  }

  closeAll() {
    for (const botId of [...this.sessions.keys()]) this.close(botId);
  }

  sweep(now: number) {
    for (const [botId, session] of this.sessions) {
      const gone = session.exitedAt && now - session.exitedAt > 60_000 && !session.watchers;
      const stale = session.idleSince && now - session.idleSince > IDLE_MS;
      if (gone || stale) this.close(botId);
    }
  }
}

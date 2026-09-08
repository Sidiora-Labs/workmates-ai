import { spawn, type ChildProcess } from "node:child_process";
import { request as httpRequest } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { envVarFor } from "../../server/core/config.ts";
import { PROVIDER_SPECS } from "../../server/integrations/providers.ts";

const ENTRY = fileURLToPath(new URL("../../server/index.ts", import.meta.url));

function blankProviderKeys(): Record<string, string> {
  const blanked: Record<string, string> = {};
  for (const spec of PROVIDER_SPECS) blanked[envVarFor(spec.kind)] = "";
  return blanked;
}

export interface Harness {
  url: string;
  home: string;
  fetch(path: string, init?: RequestInit): Promise<Response>;
  fetchAs(origin: string, path: string, init?: RequestInit): Promise<Response>;
  json(path: string, init?: RequestInit): Promise<any>;
  fetchRemote(
    path: string,
    init?: { method?: string; body?: string; token?: string; origin?: string; host?: string },
  ): Promise<{ status: number; body: any }>;
  logs(): string;
  stop(): Promise<void>;
}

export async function startHarness(extraEnv: Record<string, string> = {}): Promise<Harness> {
  const home = mkdtempSync(join(tmpdir(), "workmates-test-"));
  const port = 20_000 + Math.floor(Math.random() * 20_000);

  const child: ChildProcess = spawn(process.execPath, [ENTRY], {
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      WORKMATES_PORT: String(port),
      ...blankProviderKeys(),
      XAI_API_KEY: "",
      COMPOSIO_KEY: "",
      BOX_TOKEN: "",
      PATH: "/nonexistent",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr?.on("data", (c) => (stderr += c));
  let stdout = "";
  child.stdout?.on("data", (c) => (stdout += c));

  const url = `http://127.0.0.1:${port}`;
  const request = (origin: string | null, path: string, init: RequestInit = {}) =>
    fetch(`${url}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(origin ? { origin } : {}),
        ...init.headers,
      },
    });

  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) {
      rmSync(home, { recursive: true, force: true });
      throw new Error(`harness exited ${child.exitCode}: ${stderr.slice(-800)}`);
    }
    try {
      const res = await request(null, "/api/health");
      if (res.ok) break;
    } catch {
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  return {
    url,
    home,
    fetch: (path, init) => request("http://localhost:5199", path, init),
    fetchAs: (origin, path, init) => request(origin, path, init),
    async json(path, init) {
      const res = await request("http://localhost:5199", path, init);
      return res.json();
    },
    logs: () => stdout + stderr,
    async stop() {
      child.kill("SIGTERM");
      await new Promise((r) => {
        child.once("exit", r);
        setTimeout(r, 3_000);
      });
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          rmSync(home, { recursive: true, force: true });
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
        }
      }
    },
    fetchRemote(path, init = {}) {
      return new Promise((resolve, reject) => {
        const headers: Record<string, string> = {
          "content-type": "application/json",
          host: init.host ?? `192.168.1.20:${port}`,
        };
        if (init.token) headers.authorization = `Bearer ${init.token}`;
        if (init.origin) headers.origin = init.origin;
        const req = httpRequest(
          { host: "127.0.0.1", port, path, method: init.method ?? "GET", headers },
          (res) => {
            let data = "";
            res.on("data", (c) => (data += c));
            res.on("end", () => {
              let body: any = null;
              try {
                body = data ? JSON.parse(data) : null;
              } catch {
                body = data;
              }
              resolve({ status: res.statusCode ?? 0, body });
            });
          },
        );
        req.on("error", reject);
        if (init.body) req.write(init.body);
        req.end();
      });
    },
  };
}

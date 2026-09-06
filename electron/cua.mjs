import { app, ipcMain } from "electron";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const INSTALLED_BINARY = "/Applications/CuaDriver.app/Contents/MacOS/cua-driver";
const INSTALLED_SOCKET = path.join(app.getPath("home"), "Library/Caches/cua-driver/cua-driver.sock");

const HOST_BUNDLE_ID = "ag.centra.workmate.app";

const DESCRIPTOR_FILE = () => path.join(app.getPath("userData"), "cua-connection.json");

let host = null;
let descriptor = null;

export function resolveDriverBinary() {
  if (process.env.CUA_DRIVER_PATH) return process.env.CUA_DRIVER_PATH;

  if (app.isPackaged) {
    const bundled = path.join(process.resourcesPath, "cua-driver");
    if (fs.existsSync(bundled)) return bundled;
  }
  return fs.existsSync(INSTALLED_BINARY) ? INSTALLED_BINARY : null;
}

function socketAnswers(socketPath) {
  return new Promise((resolve) => {
    if (!fs.existsSync(socketPath)) return resolve(false);

    const probe = net.createConnection(socketPath);
    const settle = (answered) => {
      probe.destroy();
      resolve(answered);
    };
    probe.once("connect", () => settle(true));
    probe.once("error", () => settle(false));
    setTimeout(() => settle(false), 1500).unref();
  });
}

async function startEmbeddedHost(binary) {
  const { EmbeddedCuaDriverHost } = await import("@trycua/cua-driver/embedded");

  host = new EmbeddedCuaDriverHost(binary, HOST_BUNDLE_ID);
  const started = await host.start();

  return {
    mode: "embedded",
    socketPath: started.socketPath,
    mcpCommand: binary,
    mcpArgs: ["mcp", "--embedded", "--socket", started.socketPath],
    mcpEnv: {
      CUA_DRIVER_EMBEDDED: "1",
      CUA_DRIVER_HOST_BUNDLE_ID: HOST_BUNDLE_ID,
    },
  };
}

export async function startCua() {
  const binary = resolveDriverBinary();
  if (!binary) {
    return publish({ mode: "unavailable", reason: "cua-driver binary not found" });
  }

  if (app.isPackaged || process.env.WORKMATES_CUA_EMBEDDED === "1") {
    try {
      return publish(await startEmbeddedHost(binary));
    } catch (error) {
      return publish({
        mode: "unavailable",
        reason: `embedded host failed: ${error?.message ?? error}`,
      });
    }
  }

  if (await socketAnswers(INSTALLED_SOCKET)) {
    return publish({
      mode: "standalone",
      socketPath: INSTALLED_SOCKET,
      mcpCommand: binary,
      mcpArgs: ["mcp"],
      mcpEnv: {},
    });
  }

  return publish({
    mode: "unavailable",
    reason:
      "no running cua-driver daemon; run `cua-driver serve` or grant via `cua-driver permissions grant`",
  });
}

function publish(next) {
  descriptor = next;
  try {
    fs.writeFileSync(DESCRIPTOR_FILE(), JSON.stringify(descriptor, null, 2));
  } catch {
  }
  return descriptor;
}

export function cuaPermissionsStatus() {
  const binary = resolveDriverBinary();
  if (!binary) return { available: false };

  const result = spawnSync(binary, ["permissions", "status", "--json"], {
    encoding: "utf8",
    timeout: 5000,
  });
  try {
    return { available: true, ...JSON.parse(result.stdout) };
  } catch {
    return { available: true, raw: result.stdout?.trim() };
  }
}

export async function stopCua() {
  if (!host) return;
  try {
    await host.stop();
    host.uniffiDestroy?.();
  } catch {
  }
  host = null;
}

export function registerCuaIpc() {
  ipcMain.handle("cua:connection", () => descriptor);
  ipcMain.handle("cua:permissions", () => cuaPermissionsStatus());
}

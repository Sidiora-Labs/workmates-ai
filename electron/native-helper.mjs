import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function nativeHelper(name) {
  if (app.isPackaged) return path.join(process.resourcesPath, name);

  const bin = path.join(__dirname, "resources", name);
  const src = `${bin}.swift`;
  const stale = !existsSync(bin) || statSync(bin).mtimeMs < statSync(src).mtimeMs;
  if (stale) execFileSync("swiftc", ["-O", src, "-o", bin], { stdio: "pipe", timeout: 120_000 });
  return bin;
}

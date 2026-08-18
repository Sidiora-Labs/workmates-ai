import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

function candidateDirs(): string[] {
  const home = homedir();

  if (process.platform === "win32") {
    const appData = process.env.APPDATA || join(home, "AppData", "Roaming");
    const local = process.env.LOCALAPPDATA || join(home, "AppData", "Local");
    return [
      join(appData, "npm"),
      join(local, "Programs"),
      join(home, ".grok", "bin"),
      join(home, ".local", "bin"),
    ];
  }

  const dirs = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    join(home, ".local", "bin"),
    join(home, ".local", "share", "pnpm"),
    join(home, ".grok", "bin"),
    join(home, ".npm-global", "bin"),
    join(home, "Library", "pnpm"),
    join(home, ".volta", "bin"),
    join(home, "bin"),
  ];

  const nvmVersions = join(home, ".nvm", "versions", "node");
  try {
    const newest = readdirSync(nvmVersions).sort().at(-1);
    if (newest) dirs.push(join(nvmVersions, newest, "bin"));
  } catch {
  }

  const prefix = process.env.npm_config_prefix || process.env.PREFIX;
  if (prefix) dirs.push(join(prefix, "bin"));

  return dirs;
}

export function onPath(cli: string): boolean {
  return (process.env.PATH ?? "").split(delimiter).some((dir) => dir && existsSync(join(dir, cli)));
}

export function widenPath() {
  const current = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const have = new Set(current);

  const missing = candidateDirs().filter((dir) => !have.has(dir) && existsSync(dir));
  if (missing.length) {
    process.env.PATH = [...current, ...missing].join(delimiter);
  }
}

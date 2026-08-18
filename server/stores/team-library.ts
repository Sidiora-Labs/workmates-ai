import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { DATA_DIR } from "../core/config.ts";

export interface SavedTeam {
  id: string;
  name: string;
  members: unknown[];
  savedAt: number;
}

const FILE = join(DATA_DIR, "team-library.json");
const MAX_TEAMS = 50;

export class TeamLibrary {
  private teams: SavedTeam[] = [];

  constructor(file: string = FILE) {
    this.file = file;
    mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8"));
      if (Array.isArray(parsed)) this.teams = parsed.filter((t) => t && typeof t.id === "string");
    } catch {
    }
  }

  private readonly file: string;

  list(): SavedTeam[] {
    return this.teams;
  }

  save(name: string, members: unknown[]): SavedTeam {
    const team: SavedTeam = { id: randomUUID(), name, members, savedAt: Date.now() };
    this.teams = [team, ...this.teams.filter((t) => t.name !== name)].slice(0, MAX_TEAMS);
    this.write();
    return team;
  }

  remove(id: string) {
    this.teams = this.teams.filter((t) => t.id !== id);
    this.write();
  }

  private write() {
    writeFileSync(this.file, JSON.stringify(this.teams, null, 2), { mode: 0o600 });
  }
}

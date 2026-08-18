import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { DATA_DIR } from "../core/config.ts";
import { newId } from "../core/contracts.ts";

export interface RoomRecord {
  id: string;
  name: string;
  memberIds: string[];
  leadOnly?: boolean;
  archived?: boolean;
  section?: string | null;
  cwd?: string;
  pinnedCwd?: string | null;
  createdAt: number;
}

const ROOMS_FILE = join(DATA_DIR, "rooms.json");

export const MAX_MEMBERS = 8;

export class RoomStore {
  rooms: RoomRecord[] = [];

  constructor() {
    mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    try {
      this.rooms = JSON.parse(readFileSync(ROOMS_FILE, "utf8"));
    } catch {
      this.rooms = [];
    }
  }

  private save() {
    writeFileSync(ROOMS_FILE, JSON.stringify(this.rooms, null, 2), { mode: 0o600 });
  }

  get(id: string): RoomRecord | null {
    return this.rooms.find((b) => b.id === id) ?? null;
  }

  pinCwd(id: string): string | null {
    const room = this.get(id);
    if (!room) return null;
    if (room.pinnedCwd === undefined) {
      room.pinnedCwd = room.cwd ?? null;
      this.save();
    }
    return room.pinnedCwd;
  }

  create(name: string, memberIds: string[]): RoomRecord {
    const room: RoomRecord = {
      id: newId(),
      name: name.trim() || "New room",
      memberIds: [...new Set(memberIds)].slice(0, MAX_MEMBERS),
      createdAt: Date.now(),
    };
    this.rooms.unshift(room);
    this.save();
    return room;
  }

  patch(
    id: string,
    patch: Partial<Pick<RoomRecord, "name" | "memberIds" | "leadOnly" | "cwd" | "archived" | "section">>,
  ): RoomRecord | null {
    const room = this.get(id);
    if (!room) return null;
    if (typeof patch.name === "string" && patch.name.trim()) room.name = patch.name.trim();
    if (Array.isArray(patch.memberIds)) {
      room.memberIds = [...new Set(patch.memberIds)].slice(0, MAX_MEMBERS);
    }
    if (typeof patch.leadOnly === "boolean") room.leadOnly = patch.leadOnly;
    if (typeof patch.archived === "boolean") room.archived = patch.archived || undefined;
    if ("cwd" in patch) room.cwd = patch.cwd ?? undefined;
    if ("section" in patch) room.section = patch.section ?? undefined;
    this.save();
    return room;
  }

  remove(id: string): boolean {
    const before = this.rooms.length;
    this.rooms = this.rooms.filter((b) => b.id !== id);
    if (this.rooms.length === before) return false;
    this.save();
    return true;
  }

  removeMember(botId: string) {
    let touched = false;
    for (const room of this.rooms) {
      if (!room.memberIds.includes(botId)) continue;
      room.memberIds = room.memberIds.filter((id) => id !== botId);
      touched = true;
    }
    if (touched) this.save();
  }

  roomsFor(botId: string): RoomRecord[] {
    return this.rooms.filter((b) => b.memberIds.includes(botId));
  }
}

export function addressees(
  text: string,
  members: Array<{ id: string; name: string }>,
): { ids: string[]; mentioned: boolean } {
  let remaining = text.toLowerCase();
  const byLength = [...members].sort((a, b) => b.name.length - a.name.length);
  const hit: string[] = [];
  for (const member of byLength) {
    const needle = `@${member.name.toLowerCase()}`;
    if (!needle.slice(1) || !remaining.includes(needle)) continue;
    hit.push(member.id);
    remaining = remaining.split(needle).join(" ");
  }
  if (hit.length) {
    const order = new Set(hit);
    return { ids: members.filter((m) => order.has(m.id)).map((m) => m.id), mentioned: true };
  }
  return { ids: members.map((m) => m.id), mentioned: false };
}

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { DATA_DIR } from "../core/config.ts";
import { newId } from "../core/contracts.ts";
import type { MateColor, MateShape } from "./store.ts";

export const MAX_PROJECTS = 60;
export const MAX_NAME = 60;
export const MAX_BRIEF = 4_000;
export const MAX_FOLDERS = 8;
export const MAX_INCLUDES = 24;

export interface Project {
  id: string;
  name: string;
  brief: string;
  color: MateColor;
  shape: MateShape;
  folders: string[];
  include: string[];
  memberIds: string[];
  createdAt: number;
  lastOpenedAt?: number;
  archivedAt?: number;
}

export type FolderState = "ok" | "missing" | "not-a-folder";

export interface FolderStanding {
  path: string;
  state: FolderState;
}

export interface ProjectStanding extends Project {
  folderStates: FolderStanding[];
  broken: boolean;
}

export function workingFolder(standing: ProjectStanding): string | null {
  return standing.folderStates.find((folder) => folder.state === "ok")?.path ?? null;
}

export function briefFor(project: Project): string {
  const lines: string[] = [`You are working on ${project.name}.`];
  if (project.brief.trim()) lines.push(project.brief.trim());
  if (project.folders.length > 1) {
    lines.push(`Its folders: ${project.folders.join(", ")}. You are running in the first of them.`);
  }
  if (project.include.length) {
    lines.push(
      `What matters here: ${project.include.join(", ")}. Anything else in these folders is probably not what you were asked about.`,
    );
  }
  return lines.join("\n\n");
}

export function missingFolderMessage(project: Project, missing: string[]): string {
  const list = missing.join(", ");
  return missing.length === 1
    ? `${project.name} points at ${list}, which is not there any more. Nothing will run in it until that folder is back or the project points somewhere else.`
    : `${project.name} points at folders that are not there any more: ${list}. Nothing will run in it until they are back or the project points somewhere else.`;
}

const COLORS: MateColor[] = ["green", "blue", "red", "orange", "purple", "cyan", "pink", "yellow", "teal", "coral"];
const SHAPES: MateShape[] = ["star", "burst", "diamond", "bit", "triangle", "cloud", "drop", "invader"];

export interface NewProject {
  name?: string;
  brief?: string;
  color?: string;
  shape?: string;
  folders?: string[];
  include?: string[];
  memberIds?: string[];
}

export function cleanInput(input: NewProject, existing?: Project): Partial<Project> {
  const out: Partial<Project> = {};
  if (input.name !== undefined) out.name = String(input.name).trim().slice(0, MAX_NAME);
  if (input.brief !== undefined) out.brief = String(input.brief).slice(0, MAX_BRIEF);
  if (typeof input.color === "string" && COLORS.includes(input.color as MateColor)) {
    out.color = input.color as MateColor;
  }
  if (typeof input.shape === "string" && SHAPES.includes(input.shape as MateShape)) {
    out.shape = input.shape as MateShape;
  }
  if (Array.isArray(input.folders)) {
    out.folders = input.folders
      .filter((f): f is string => typeof f === "string" && Boolean(f.trim()))
      .map((f) => f.trim())
      .slice(0, MAX_FOLDERS);
  }
  if (Array.isArray(input.include)) {
    out.include = input.include
      .filter((f): f is string => typeof f === "string" && Boolean(f.trim()))
      .map((f) => f.trim().slice(0, 120))
      .slice(0, MAX_INCLUDES);
  }
  if (Array.isArray(input.memberIds)) {
    out.memberIds = input.memberIds
      .filter((id): id is string => typeof id === "string" && /^[\w-]{1,64}$/.test(id))
      .slice(0, 40);
  }
  if (!out.name && !existing?.name) out.name = "Untitled project";
  return out;
}

const PROJECTS_FILE = join(DATA_DIR, "projects.json");

export class ProjectStore {
  projects: Project[] = [];

  constructor() {
    try {
      const parsed = JSON.parse(readFileSync(PROJECTS_FILE, "utf8"));
      if (Array.isArray(parsed)) {
        this.projects = parsed.filter((p) => p?.id && typeof p.name === "string");
      }
    } catch {
    }
  }

  private save() {
    try {
      mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
      writeFileSync(PROJECTS_FILE, JSON.stringify(this.projects, null, 2), { mode: 0o600 });
    } catch {
    }
  }

  list(includeArchived = false): Project[] {
    return this.projects
      .filter((p) => includeArchived || !p.archivedAt)
      .sort((a, b) => (b.lastOpenedAt ?? b.createdAt) - (a.lastOpenedAt ?? a.createdAt));
  }

  get(id: string): Project | null {
    return this.projects.find((p) => p.id === id) ?? null;
  }

  create(input: NewProject, now: number): Project {
    const clean = cleanInput(input);
    const project: Project = {
      id: newId(),
      name: clean.name ?? "Untitled project",
      brief: clean.brief ?? "",
      color: clean.color ?? COLORS[this.projects.length % COLORS.length],
      shape: clean.shape ?? SHAPES[this.projects.length % SHAPES.length],
      folders: clean.folders ?? [],
      include: clean.include ?? [],
      memberIds: clean.memberIds ?? [],
      createdAt: now,
    };
    this.projects.unshift(project);
    if (this.projects.length > MAX_PROJECTS) this.projects.length = MAX_PROJECTS;
    this.save();
    return project;
  }

  patch(id: string, input: NewProject): Project | null {
    const project = this.get(id);
    if (!project) return null;
    Object.assign(project, cleanInput(input, project));
    this.save();
    return project;
  }

  opened(id: string, now: number): Project | null {
    const project = this.get(id);
    if (!project) return null;
    project.lastOpenedAt = now;
    this.save();
    return project;
  }

  archive(id: string, now: number): Project | null {
    const project = this.get(id);
    if (!project) return null;
    project.archivedAt = now;
    this.save();
    return project;
  }

  remove(id: string): boolean {
    const before = this.projects.length;
    this.projects = this.projects.filter((p) => p.id !== id);
    if (this.projects.length === before) return false;
    this.save();
    return true;
  }

  removeMember(botId: string) {
    let touched = false;
    for (const project of this.projects) {
      const next = project.memberIds.filter((id) => id !== botId);
      if (next.length !== project.memberIds.length) {
        project.memberIds = next;
        touched = true;
      }
    }
    if (touched) this.save();
  }

  forAgent(botId: string): Project | null {
    return this.list().find((project) => project.memberIds.includes(botId)) ?? null;
  }
}

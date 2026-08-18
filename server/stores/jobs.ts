import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { DATA_DIR } from "../core/config.ts";
import { newId } from "../core/contracts.ts";

export type JobState = "open" | "claimed" | "done" | "failed" | "cancelled";

export interface JobOffer {
  botId: string;
  name: string;
  at: number;
  passed?: string;
}

export interface Job {
  id: string;
  title: string;
  brief: string;
  postedAt: number;
  state: JobState;
  offers: JobOffer[];
  claimedBy?: string;
  claimedName?: string;
  claimedAt?: number;
  threadId?: string;
  finishedAt?: number;
  result?: string;
}

export const MAX_JOBS = 200;
export const MAX_TITLE = 120;
export const MAX_BRIEF = 4_000;
export const MAX_RESULT = 2_000;

export const PASS_MARKER = "PASS";

export interface Candidate {
  id: string;
  name: string;
  title?: string;
  description?: string;
  skills?: string[];
  seniority?: number;
  hidden?: boolean;
}

const NOISE = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "your", "our",
  "you", "are", "was", "were", "will", "can", "should", "would", "have", "has",
  "any", "all", "out", "get", "make", "made", "one", "two", "new", "who", "how",
  "what", "when", "where", "some", "each", "them", "they", "their", "then",
  "than", "over", "under", "about", "please", "need", "needs", "want", "job",
  "work", "task", "help", "using", "use", "way", "off", "not", "but",
]);

export function words(text: string): string[] {
  return (text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !NOISE.has(word));
}

function stem(word: string): string {
  return word
    .replace(/(ing|ers|ed|es|s)$/,
      (suffix) => (word.length - suffix.length >= 4 ? "" : suffix))
    .slice(0, 12);
}

function bag(text: string): Set<string> {
  return new Set(words(text).map(stem));
}

export function scoreAgent(job: { title: string; brief: string }, agent: Candidate): number {
  const asked = bag(`${job.title} ${job.brief}`);
  if (!asked.size) return 0;

  const role = bag(`${agent.title ?? ""} ${agent.name ?? ""}`);
  const skills = bag((agent.skills ?? []).join(" "));
  const about = bag(agent.description ?? "");

  let hit = 0;
  for (const word of asked) {
    if (role.has(word)) hit += 1;
    else if (skills.has(word)) hit += 0.8;
    else if (about.has(word)) hit += 0.4;
  }
  const overlap = Math.min(1, hit / asked.size);
  const rank = ((agent.seniority ?? 3) - 3) * 0.01;
  return Math.max(0, Math.min(1, overlap + rank));
}

export interface Ranked {
  agent: Candidate;
  score: number;
}

export function rankAgents(
  job: { title: string; brief: string },
  agents: Candidate[],
  passedOver: string[] = [],
): Ranked[] {
  const already = new Set(passedOver);
  return agents
    .filter((agent) => !agent.hidden && !already.has(agent.id))
    .map((agent) => ({ agent, score: scoreAgent(job, agent) }))
    .sort((a, b) => b.score - a.score || a.agent.name.localeCompare(b.agent.name));
}

export function nextFor(job: Job, agents: Candidate[]): Candidate | null {
  const asked = job.offers.map((offer) => offer.botId);
  return rankAgents(job, agents, asked)[0]?.agent ?? null;
}

export type Claim =
  | { taken: true; result: string }
  | { taken: false; because: string };

export function readClaim(reply: string): Claim {
  const text = (reply ?? "").trim();
  const first = text.split("\n")[0]?.trim() ?? "";
  if (new RegExp(`^${PASS_MARKER}\\b`).test(first)) {
    const because = first.slice(PASS_MARKER.length).replace(/^[\s:,.-]+/, "").trim();
    return { taken: false, because: (because || "no reason given").slice(0, MAX_RESULT) };
  }
  return { taken: true, result: text.slice(0, MAX_RESULT) };
}

export function offerText(job: Job): string {
  return [
    "This came in on the job board. Nobody has been named for it.",
    "",
    job.title,
    job.brief && job.brief !== job.title ? `\n${job.brief}` : "",
    "",
    `If this is not your kind of work, reply with one line starting with ${PASS_MARKER} and why, and do nothing else.`,
    "Otherwise take it, do it, and finish with one line saying what you did.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

const JOBS_FILE = join(DATA_DIR, "jobs.json");

export class JobStore {
  jobs: Job[] = [];

  constructor() {
    try {
      const parsed = JSON.parse(readFileSync(JOBS_FILE, "utf8"));
      if (Array.isArray(parsed)) this.jobs = parsed.filter((job) => job?.id && job?.title);
    } catch {
    }
    for (const job of this.jobs) {
      if (job.state === "claimed") {
        job.state = "failed";
        job.result = "Workmates closed while this was running.";
        job.finishedAt = Date.now();
      }
    }
  }

  private save() {
    try {
      mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
      writeFileSync(JOBS_FILE, JSON.stringify(this.jobs, null, 2), { mode: 0o600 });
    } catch {
    }
  }

  list(): Job[] {
    return [...this.jobs].sort((a, b) => b.postedAt - a.postedAt);
  }

  get(id: string): Job | null {
    return this.jobs.find((job) => job.id === id) ?? null;
  }

  post(input: { title: string; brief: string; now: number }): Job {
    const job: Job = {
      id: newId(),
      title: input.title.trim().slice(0, MAX_TITLE),
      brief: input.brief.trim().slice(0, MAX_BRIEF),
      postedAt: input.now,
      state: "open",
      offers: [],
    };
    this.jobs.unshift(job);
    if (this.jobs.length > MAX_JOBS) this.jobs.length = MAX_JOBS;
    this.save();
    return job;
  }

  patch(id: string, patch: Partial<Job>): Job | null {
    const job = this.get(id);
    if (!job) return null;
    Object.assign(job, patch);
    this.save();
    return job;
  }

  offer(id: string, agent: Candidate, threadId: string, now: number): Job | null {
    const job = this.get(id);
    if (!job) return null;
    job.offers.push({ botId: agent.id, name: agent.name, at: now });
    job.state = "claimed";
    job.claimedBy = agent.id;
    job.claimedName = agent.name;
    job.claimedAt = now;
    job.threadId = threadId;
    this.save();
    return job;
  }

  passed(id: string, because: string, now: number): Job | null {
    const job = this.get(id);
    if (!job) return null;
    const last = job.offers[job.offers.length - 1];
    if (last) last.passed = because.slice(0, MAX_RESULT);
    job.state = "open";
    job.claimedBy = undefined;
    job.claimedName = undefined;
    job.claimedAt = undefined;
    job.threadId = undefined;
    job.finishedAt = now;
    this.save();
    return job;
  }

  finish(id: string, outcome: { ok: boolean; result: string; now: number }): Job | null {
    const job = this.get(id);
    if (!job) return null;
    job.state = outcome.ok ? "done" : "failed";
    job.result = outcome.result.slice(0, MAX_RESULT);
    job.finishedAt = outcome.now;
    this.save();
    return job;
  }

  cancel(id: string, now: number): Job | null {
    const job = this.get(id);
    if (!job) return null;
    job.state = "cancelled";
    job.finishedAt = now;
    this.save();
    return job;
  }

  remove(id: string): boolean {
    const before = this.jobs.length;
    this.jobs = this.jobs.filter((job) => job.id !== id);
    if (this.jobs.length === before) return false;
    this.save();
    return true;
  }

  releaseAgent(botId: string, _now: number, why = "The agent that took this was deleted.") {
    let touched = false;
    for (const job of this.jobs) {
      if (job.claimedBy !== botId) continue;
      job.state = "open";
      job.claimedBy = undefined;
      job.claimedName = undefined;
      job.threadId = undefined;
      job.result = why;
      job.finishedAt = undefined;
      touched = true;
    }
    if (touched) this.save();
  }
}

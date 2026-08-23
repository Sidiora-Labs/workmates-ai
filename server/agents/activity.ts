import type { Message } from "../stores/store.ts";

export type WorkKind = "you" | "routine" | "job" | "workflow";

export type WaitKind = "approval" | "workflow";

export interface Spend {
  turns: number;
  input: number;
  output: number;
  cost: number;
}

const noSpend = (): Spend => ({ turns: 0, input: 0, output: 0, cost: 0 });

export interface Lane {
  threadId: string;
  botId: string;
  botName: string;
  laneTitle: string;
  busy: boolean;
  since?: number;
  context?: { used: number; limit: number; fraction: number };
  room?: boolean;
}

export interface Block {
  messageId: string;
  asks: string;
  since: number;
  kind: WaitKind;
  until?: number;
  runId?: string;
}

export interface RunningWork extends Lane {
  kind: WorkKind;
  because: string;
}

export interface WaitingWork extends Block {
  threadId: string;
  botId: string;
  botName: string;
  laneTitle: string;
}

export interface AgentRoll {
  botId: string;
  botName: string;
  running: number;
  waiting: number;
  today: Spend;
}

export interface Paused {
  botId: string;
  botName: string;
  since: number;
  why: string;
  turnedAway: number;
}

export interface Activity {
  waiting: WaitingWork[];
  running: RunningWork[];
  paused: Paused[];
  agents: AgentRoll[];
  today: Spend;
  costKnown: boolean;
  at: number;
}

export function blockedOn(
  messages: Message[],
  live: {
    request: (requestId: string) => boolean;
    run: (runId: string) => { until: number; name: string } | null;
  },
  { includingPutAside = false }: { includingPutAside?: boolean } = {},
): Block | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    const card = message.card;
    if (message.kind !== "options" || !card || card.answered) continue;

    if (card.dismissed && !(card.runId && includingPutAside)) continue;

    if (card.requestId && live.request(card.requestId)) {
      return {
        messageId: message.id,
        asks: card.subtitle || card.title || "a question",
        since: message.at ?? 0,
        kind: "approval",
      };
    }
    if (card.runId) {
      const parked = live.run(card.runId);
      if (parked) {
        return {
          messageId: message.id,
          asks: card.title || card.subtitle || "a question",
          since: message.at ?? 0,
          kind: "workflow",
          until: parked.until,
          runId: card.runId,
        };
      }
    }
  }
  return null;
}

export function whyBusy(
  threadId: string,
  sources: {
    routines: Map<string, string>;
    jobs: Map<string, string>;
    workflows: Map<string, { name: string; step: string }>;
  },
): { kind: WorkKind; because: string } {
  const routine = sources.routines.get(threadId);
  if (routine) return { kind: "routine", because: `the routine ${routine}` };
  const job = sources.jobs.get(threadId);
  if (job) return { kind: "job", because: `a job from the board: ${job}` };
  const workflow = sources.workflows.get(threadId);
  if (workflow) {
    return { kind: "workflow", because: `${workflow.name}, at ${workflow.step}` };
  }
  return { kind: "you", because: "you asked" };
}

export interface AssembleInput {
  lanes: Array<Lane & { blocked?: Block | null }>;
  routines: Map<string, string>;
  jobs: Map<string, string>;
  workflows: Map<string, { name: string; step: string }>;
  spend: Array<{ botId: string } & Spend>;
  paused?: Paused[];
  costKnown: boolean;
  at: number;
}

export function assemble(input: AssembleInput): Activity {
  const waiting: WaitingWork[] = [];
  const running: RunningWork[] = [];

  for (const lane of input.lanes) {
    const { blocked, ...rest } = lane;
    if (blocked) {
      waiting.push({
        ...blocked,
        threadId: lane.threadId,
        botId: lane.botId,
        botName: lane.botName,
        laneTitle: lane.laneTitle,
      });
      continue;
    }
    if (rest.busy) {
      running.push({ ...rest, ...whyBusy(lane.threadId, input) });
    }
  }

  waiting.sort((a, b) => a.since - b.since);
  running.sort((a, b) => (a.since ?? 0) - (b.since ?? 0));

  const spent = new Map(input.spend.map((s) => [s.botId, s]));
  const seen = new Map<string, AgentRoll>();
  const roll = (botId: string, botName: string): AgentRoll => {
    let row = seen.get(botId);
    if (!row) {
      const today = spent.get(botId);
      row = {
        botId,
        botName,
        running: 0,
        waiting: 0,
        today: today
          ? { turns: today.turns, input: today.input, output: today.output, cost: today.cost }
          : noSpend(),
      };
      seen.set(botId, row);
    }
    return row;
  };

  const rooms = new Set(input.lanes.filter((lane) => lane.room).map((lane) => lane.botId));
  for (const work of running) if (!rooms.has(work.botId)) roll(work.botId, work.botName).running++;
  for (const work of waiting) if (!rooms.has(work.botId)) roll(work.botId, work.botName).waiting++;
  for (const s of input.spend) {
    const named = input.lanes.find((lane) => lane.botId === s.botId);
    if (named) roll(s.botId, named.botName);
  }

  const today = noSpend();
  for (const s of input.spend) {
    today.turns += s.turns;
    today.input += s.input;
    today.output += s.output;
    today.cost += s.cost;
  }

  const agents = [...seen.values()].sort(
    (a, b) =>
      b.waiting - a.waiting ||
      b.running - a.running ||
      b.today.input + b.today.output - (a.today.input + a.today.output),
  );

  return {
    waiting,
    running,
    paused: input.paused ?? [],
    agents,
    today,
    costKnown: input.costKnown,
    at: input.at,
  };
}

export function tally(activity: Pick<Activity, "waiting" | "running">): string | null {
  const bits: string[] = [];
  if (activity.waiting.length) {
    bits.push(`${activity.waiting.length} waiting on you`);
  }
  if (activity.running.length) {
    bits.push(`${activity.running.length} running`);
  }
  return bits.length ? bits.join(", ") : null;
}

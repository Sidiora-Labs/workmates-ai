#!/usr/bin/env node
const BASE = process.env.WORKMATES_URL || "http://127.0.0.1:8799";
const TOKEN = process.env.WORKMATES_TOKEN || "";

const COMMANDS = {
  whoami: {
    use: "whoami",
    about: "who this credential says you are",
    run: () => request("GET", "/api/agent/whoami"),
  },
  agents: {
    use: "agents",
    about: "everyone in the workspace, with their roles and skills",
    run: async () => {
      const { bots } = await request("GET", "/api/bots?messages=0");
      return bots.map((bot) => ({
        id: bot.id,
        name: bot.name,
        title: bot.title,
        skills: bot.skills ?? [],
        busy: Boolean(bot.busy),
      }));
    },
  },
  rooms: {
    use: "rooms",
    about: "the rooms that exist, and who is in them",
    run: async () => {
      const { rooms } = await request("GET", "/api/rooms");
      return (rooms ?? []).map((room) => ({ id: room.id, name: room.name, members: room.memberIds }));
    },
  },
  say: {
    use: "say <agent-id|room-id> <text…>",
    about: "say something to another agent, or in a room",
    run: async (args) => {
      const [target, ...rest] = args;
      const text = rest.join(" ");
      if (!target || !text) throw new Error("say needs someone to say it to, and something to say");
      try {
        return await request("POST", `/api/bots/${target}/messages`, { text });
      } catch (error) {
        if (!/no such agent/i.test(String(error.message))) throw error;
        return await request("POST", `/api/rooms/${target}/messages`, { text });
      }
    },
  },
  hire: {
    use: 'hire --name <name> --title <role> [--about <description>] [--skills "a,b,c"]',
    about: "add a teammate to the workspace",
    run: (args) => {
      const flags = parseFlags(args);
      if (!flags.name) throw new Error("hire needs a --name");
      return request("POST", "/api/bots", {
        name: flags.name,
        title: flags.title ?? "",
        description: flags.about ?? "",
        skills: flags.skills ? flags.skills.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
      });
    },
  },
  room: {
    use: 'room --name <name> --members "id,id"',
    about: "open a room and put people in it",
    run: (args) => {
      const flags = parseFlags(args);
      if (!flags.name) throw new Error("room needs a --name");
      return request("POST", "/api/rooms", {
        name: flags.name,
        memberIds: (flags.members ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      });
    },
  },
  routines: {
    use: "routines",
    about: "what is scheduled, for everyone",
    run: () => request("GET", "/api/routines"),
  },
  routine: {
    use: 'routine --prompt <text> --time HH:MM [--days "1,2,3"] [--name <name>]',
    about: "file a routine for yourself",
    run: async (args) => {
      const flags = parseFlags(args);
      if (!flags.prompt) throw new Error("a routine needs a --prompt");
      if (!/^\d{1,2}:\d{2}$/.test(flags.time ?? "")) throw new Error("a routine needs a --time like 09:00");
      const me = await request("GET", "/api/agent/whoami");
      return request("POST", "/api/routines", {
        targetId: me.botId,
        targetKind: "agent",
        name: flags.name,
        prompt: flags.prompt,
        time: flags.time,
        days: (flags.days ?? "").split(",").map((d) => Number(d.trim())).filter((d) => Number.isInteger(d)),
      });
    },
  },
  jobs: {
    use: "jobs",
    about: "the job board",
    run: () => request("GET", "/api/jobs"),
  },
  post: {
    use: "post --title <title> [--brief <text>]",
    about: "put work on the board without naming who does it",
    run: (args) => {
      const flags = parseFlags(args);
      if (!flags.title && !flags.brief) throw new Error("a job needs a --title or a --brief");
      return request("POST", "/api/jobs", { title: flags.title ?? "", brief: flags.brief ?? "" });
    },
  },
  memory: {
    use: "memory [--write <text>]",
    about: "read what you remember between conversations, or replace it",
    run: async (args) => {
      const flags = parseFlags(args);
      const me = await request("GET", "/api/agent/whoami");
      if (flags.write === undefined) return request("GET", `/api/bots/${me.botId}/memory`);
      return request("PUT", `/api/bots/${me.botId}/memory`, { text: flags.write });
    },
  },
  skills: {
    use: "skills",
    about: "the skill library, names and what each is for",
    run: async () => {
      const { skills } = await request("GET", "/api/skills");
      return (skills ?? []).map((s) => ({ id: s.id, name: s.name, description: s.description }));
    },
  },
  show: {
    use: "show <kind> <json>",
    about: "answer with a component instead of prose: chart, table, decision, steps, quote, refused",
    run: async ([kind, ...rest]) => {
      if (!kind) throw new Error("show needs a kind: chart, table, decision, steps, quote or refused");
      const body = rest.join(" ").trim();
      if (!body) throw new Error("show needs the component as JSON");
      let data;
      try {
        data = JSON.parse(body);
      } catch {
        throw new Error("that is not JSON. Pass the component as one JSON object");
      }
      const me = await request("GET", "/api/agent/whoami");
      return request("POST", `/api/bots/${me.botId}/show`, { kind, data });
    },
  },
  skill: {
    use: "skill <id>",
    about: "read one skill in full",
    run: ([id]) => {
      if (!id) throw new Error("skill needs an id, from `skills`");
      return request("GET", `/api/skills/${encodeURIComponent(id)}`);
    },
  },
};

function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;
    const equals = arg.indexOf("=");
    if (equals > 0) {
      flags[arg.slice(2, equals)] = arg.slice(equals + 1);
      continue;
    }
    const next = args[i + 1];
    flags[arg.slice(2)] = next && !next.startsWith("--") ? (i++, next) : "true";
  }
  return flags;
}

async function request(method, path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`,
      origin: BASE,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`the workspace answered something that is not JSON: ${text.slice(0, 200)}`);
  }
  if (!response.ok) throw new Error(parsed.error ?? `${response.status} ${response.statusText}`);
  return parsed;
}

function help() {
  return {
    about:
      "Act on this Workmates workspace as yourself. Every command answers JSON. " +
      "Your credential is in the environment and lasts one turn.",
    commands: Object.entries(COMMANDS).map(([name, command]) => ({
      use: command.use,
      about: command.about,
      name,
    })),
  };
}

const [name, ...args] = process.argv.slice(2);

try {
  if (!name || name === "help" || name === "--help" || name === "-h") {
    process.stdout.write(`${JSON.stringify(help(), null, 2)}\n`);
    process.exit(0);
  }
  const command = COMMANDS[name];
  if (!command) {
    process.stdout.write(
      `${JSON.stringify({ error: `no such command: ${name}`, ...help() }, null, 2)}\n`,
    );
    process.exit(2);
  }
  if (!TOKEN) throw new Error("no credential in this environment, so there is nobody to act as");
  const result = await command.run(args);
  process.stdout.write(`${JSON.stringify(result ?? { ok: true }, null, 2)}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ error: String(error?.message ?? error) }, null, 2)}\n`);
  process.exit(1);
}

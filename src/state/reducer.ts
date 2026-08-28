import type { MateColor, MateExpression, MateShape } from "@/lib/mascot";

export type { MateColor, MateShape } from "@/lib/mascot";

export interface OptionCardData {
  title: string;
  subtitle: string;
  options: string[];
  answered?: string;
  dismissed?: boolean;
  requestId?: string;
  tool?: string;
  runId?: string;
  team?: TeamPlan;
}

export interface TeamPlan {
  room: string;
  brief: string;
  members: Array<{ name: string; title: string; description: string; skills: string[] }>;
}

export interface Message {
  decisionChoice?: number;
  queued?: boolean;
  reactions?: Record<string, string[]>;
  editedAt?: number;
  deleted?: boolean;
  secret?: {
    envName: string;
    label: string;
    hint?: string;
    status: "needs-value" | "saved" | "dismissed";
    resumeKey?: string;
    resumed?: boolean;
  };
  connector?: {
    slug: string;
    label: string;
    status: "needs-auth" | "authorizing" | "connected" | "failed" | "dismissed";
    authUrl?: string;
    resumeKey?: string;
    resumed?: boolean;
    error?: string;
  };
  id: string;
  role: "bot" | "user";
  from?: string;
  kind: "text" | "options" | "activity" | "screen" | "notice" | "artifact" | "connector" | "secret" | "component";
  text?: string;
  card?: OptionCardData;
  component?: Record<string, unknown>;
  tool?: { name: string; ok?: boolean };
  png?: string;
  mime?: string;
  replyTo?: { id?: string; author: string; excerpt: string };
  artifact?: { name: string; mime: string; size: number };
  at: number;
}

export interface ModelSelection {
  instanceId: string;
  model: string;
}

export interface TaskSummary {
  id: string;
  title: string;
  state: "working" | "needs-you" | "idle";
  createdAt: number;
  usage?: { input: number; output: number; turns: number };
  context?: { used: number; limit: number; fraction: number; summarised: boolean };
}

export interface Bot {
  id: string;
  threadId: string;
  name: string;
  title: string;
  description: string;
  notifications: boolean;
  color: MateColor;
  shape?: MateShape;
  skills?: string[];
  skillIds?: string[];
  seniority?: number;
  effort?: "low" | "medium" | "high";
  mascotExpression?: MateExpression | null;
  avatarAt?: number | null;
  unread: boolean;
  busy?: boolean;
  held?: { since: number; why: string; turnedAway: number } | null;
  archivedAt?: number | null;
  tasks?: TaskSummary[];
  activeTaskId?: string;
  modelSelection: ModelSelection;
  computer?: "cloud" | "sandbox" | "local" | "off" | null;
  cwd?: string | null;
  composio?: boolean;
  browser?: boolean;
  mcpServers?: string[];
  voice?: { provider: "elevenlabs" | "openai"; id: string; name?: string } | null;
  speakReplies?: boolean;
  fingerprint?: string;
  withoutComponents?: string[];
  pinned?: boolean;
  section?: string | null;
  approvals?: "ask" | "edits" | "auto";
  hidden?: boolean;
  messages: Message[];
}

export interface ConfigStatus {
  xai?: { configured: boolean
  setupDone?: boolean;
};
  composio: { configured: boolean; apiKeyConfigured?: boolean };
  box: { configured: boolean };
  speech?: { elevenlabs: boolean; openai: boolean; openaiSource?: "env" | "codex"; openaiAvailable?: "env" | "codex" };
  profile?: { about: string };
  compaction?: { micro: boolean };
  skills?: { propose: boolean };
}

export interface InstanceInfo {
  instanceId: string;
  driverKind: string;
  displayName: string;
  snapshot: {
    state: "available" | "unavailable";
    reason?: string;
    authenticated?: boolean;
    version?: string | null;
  };
  models: { default: string; options: Array<{ id: string; label: string }> };
}

export interface NewAgentProfile {
  name?: string;
  title?: string;
  description?: string;
  color?: MateColor;
  shape?: MateShape;
  skills?: string[];
  skillIds?: string[];
  greeting?: string;
  setup?: { title: string; subtitle: string; options: string[] };
}

export interface Room {
  id: string;
  name: string;
  memberIds: string[];
  leadOnly?: boolean;
  cwd?: string;
  pinnedCwd?: string | null;
  section?: string | null;
  createdAt: number;
  messages: Message[];
}

export interface ProviderRow {
  kind: string;
  name: string;
  auth: "oauth" | "key" | "cli" | "none";
  keyHint: string;
  signInHint?: string;
  keyPrefix?: string;
  docsUrl: string;
  connected: boolean;
  needsSignIn?: boolean;
  agentic: boolean;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  body: string;
  source: "builtin" | "user";
}

export interface AppState {
  bots: Bot[];
  rooms: Room[];
  instances: InstanceInfo[];
  providers: ProviderRow[];
  config: ConfigStatus | null;
  selectedId: string;
  settingsOpen: boolean;
  pluginsOpen: boolean;
  computerOpen: boolean;
  appSettingsOpen: boolean;
  newAgentOpen: boolean;
  newAgentFirstRun: boolean;
  skillsOpen: boolean;
  routinesOpen: boolean;
  newRoomOpen: boolean;
  projectsOpen: boolean;
  activityOpen: boolean;
  projectId: string | null;
  streaming: Record<string, string>;
  screens: Record<string, { png: string; mime: string }>;
  provisioning: Record<string, boolean>;
  connected: boolean;
  error: string | null;
}

export type Action =
  | { type: "hydrate"; bots: Bot[] }
  | { type: "hydrateRooms"; rooms: Room[] }
  | { type: "roomPatched"; room: Omit<Room, "messages"> }
  | { type: "roomDeleted"; roomId: string }
  | { type: "createRoom"; name: string; memberIds: string[] }
  | { type: "deleteRoom"; roomId: string }
  | { type: "patchRoom"; roomId: string; patch: { archived?: boolean; name?: string; section?: string | null } }
  | { type: "sendToRoom"; roomId: string; text: string; replyTo?: Message["replyTo"] }
  | { type: "toggleNewRoom"; open?: boolean }
  | { type: "instances"; instances: InstanceInfo[] }
  | { type: "providers"; providers: ProviderRow[] }
  | { type: "connectProvider"; kind: string; key?: string; url?: string }
  | { type: "disconnectProvider"; kind: string }
  | { type: "configStatus"; config: ConfigStatus }
  | { type: "select"; id: string }
  | { type: "send"; botId: string; text: string; replyTo?: Message["replyTo"] }
  | { type: "answerCard"; botId: string; messageId: string; answer: string; roomId?: string }
  | { type: "dismissCard"; botId: string; messageId: string; roomId?: string }
  | { type: "hireTeam"; botId: string; messageId: string }
  | { type: "newBot"; profile?: NewAgentProfile }
  | { type: "toggleNewAgent"; open?: boolean; firstRun?: boolean }
  | { type: "toggleSkills"; open?: boolean }
  | { type: "toggleRoutines"; open?: boolean }
  | { type: "toggleActivity"; open?: boolean }
  | { type: "newTask"; botId: string }
  | { type: "selectTask"; botId: string; taskId: string }
  | { type: "closeTask"; botId: string; taskId: string }
  | { type: "botAdded"; bot: Bot }
  | { type: "deleteBot"; botId: string; forget?: boolean }
  | { type: "restoreBot"; botId: string }
  | { type: "duplicateBot"; botId: string }
  | { type: "markUnread"; botId: string }
  | { type: "botPatched"; bot: Partial<Bot> & { id: string } }
  | { type: "messageAdded"; threadId: string; message: Message }
  | { type: "messagePatched"; threadId: string; message: Message }
  | { type: "streamDelta"; threadId: string; delta: string }
  | { type: "streamClear"; threadId: string }
  | { type: "screenFrame"; botId: string; png: string; mime: string }
  | { type: "provisioning"; botId: string; on: boolean }
  | { type: "setModel"; botId: string; selection: ModelSelection }
  | { type: "interrupt"; botId: string }
  | { type: "connected"; value: boolean }
  | { type: "error"; message: string | null }
  | { type: "toggleSettings"; open?: boolean }
  | { type: "togglePlugins"; open?: boolean }
  | { type: "toggleComputer"; open?: boolean }
  | { type: "toggleAppSettings"; open?: boolean }
  | { type: "toggleProjects"; open?: boolean }
  | { type: "openProject"; id: string | null }
  | {
      type: "updateBot";
      botId: string;
      patch: Partial<
        Pick<
          Bot,
          | "name"
          | "title"
          | "description"
          | "notifications"
          | "computer"
          | "color"
          | "shape"
          | "skills"
          | "skillIds"
          | "seniority"
          | "effort"
          | "mascotExpression"
          | "pinned"
          | "hidden"
          | "section"
          | "approvals"
          | "composio"
          | "mcpServers"
        >
      >;
    };

function updateBot(state: AppState, botId: string, fn: (b: Bot) => Bot): AppState {
  return { ...state, bots: state.bots.map((b) => (b.id === botId ? fn(b) : b)) };
}

export function findCard(
  state: AppState,
  ref: { botId: string; messageId: string; roomId?: string },
): OptionCardData | undefined {
  const messages = ref.roomId
    ? state.rooms.find((b) => b.id === ref.roomId)?.messages
    : state.bots.find((b) => b.id === ref.botId)?.messages;
  return messages?.find((m) => m.id === ref.messageId)?.card;
}

const withCard = (messages: Message[], messageId: string, patch: Partial<OptionCardData>) =>
  messages.map((m) => (m.id === messageId && m.card ? { ...m, card: { ...m.card, ...patch } } : m));

function patchCard(
  state: AppState,
  botId: string,
  messageId: string,
  patch: Partial<OptionCardData>,
  roomId?: string,
): AppState {
  if (roomId) {
    return {
      ...state,
      rooms: state.rooms.map((b) =>
        b.id === roomId ? { ...b, messages: withCard(b.messages, messageId, patch) } : b,
      ),
    };
  }
  return updateBot(state, botId, (b) => ({ ...b, messages: withCard(b.messages, messageId, patch) }));
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "hydrate": {
      const wanted = state.selectedId || readSelected();
      const match = action.bots.find((b) => b.id === wanted);
      const selectedId = match
        ? match.hidden
          ? (action.bots.find((b) => !b.hidden)?.id ?? "")
          : wanted
        : wanted && !action.bots.some((b) => b.id === wanted)
          ? wanted
          : (action.bots.find((b) => !b.hidden)?.id ?? "");
      return { ...state, bots: action.bots, selectedId };
    }
    case "hydrateRooms": {
      const wanted = state.selectedId || readSelected();
      const selectedId = action.rooms.some((b) => b.id === wanted) ? wanted : state.selectedId;
      return { ...state, rooms: action.rooms, selectedId };
    }
    case "roomPatched": {
      const existing = state.rooms.find((b) => b.id === action.room.id);
      return {
        ...state,
        rooms: existing
          ? state.rooms.map((b) => (b.id === action.room.id ? { ...b, ...action.room } : b))
          : [{ ...action.room, messages: [] }, ...state.rooms],
      };
    }
    case "roomDeleted": {
      const rooms = state.rooms.filter((b) => b.id !== action.roomId);
      const selectedId =
        state.selectedId === action.roomId ? (state.bots[0]?.id ?? "") : state.selectedId;
      return { ...state, rooms, selectedId };
    }
    case "toggleNewRoom":
      return { ...state, newRoomOpen: action.open ?? !state.newRoomOpen };
    case "toggleProjects":
      return { ...state, projectsOpen: action.open ?? !state.projectsOpen };
    case "openProject": {
      try {
        if (action.id) localStorage.setItem("workmates-project", action.id);
        else localStorage.removeItem("workmates-project");
      } catch {
      }
      return { ...state, projectId: action.id };
    }
    case "instances":
      return { ...state, instances: action.instances };
    case "providers":
      return { ...state, providers: action.providers };
    case "configStatus":
      return { ...state, config: action.config };
    case "select":
      writeSelected(action.id);
      return updateBot({ ...state, selectedId: action.id }, action.id, (b) => ({ ...b, unread: false }));
    case "answerCard":
      return patchCard(state, action.botId, action.messageId, { answered: action.answer }, action.roomId);
    case "dismissCard":
      return patchCard(state, action.botId, action.messageId, { dismissed: true }, action.roomId);
    case "hireTeam":
      return patchCard(state, action.botId, action.messageId, { answered: "Hire the team" });
    case "botAdded":
      writeSelected(action.bot.id);
      return {
        ...state,
        bots: [action.bot, ...state.bots],
        selectedId: action.bot.id,
        newAgentOpen: false,
        newAgentFirstRun: false,
      };
    case "toggleNewAgent":
      return {
        ...state,
        newAgentOpen: action.open ?? !state.newAgentOpen,
        newAgentFirstRun: (action.open ?? !state.newAgentOpen) ? (action.firstRun ?? false) : false,
      };
    case "toggleSkills":
      return { ...state, skillsOpen: action.open ?? !state.skillsOpen };
    case "toggleRoutines":
      return { ...state, routinesOpen: action.open ?? !state.routinesOpen };
    case "toggleActivity":
      return { ...state, activityOpen: action.open ?? !state.activityOpen };
    case "newTask":
    case "selectTask":
    case "closeTask":
      return state;
    case "deleteBot": {
      if (!action.forget) {
        const moved = state.bots.map((b) =>
          b.id === action.botId ? { ...b, hidden: true, archivedAt: Date.now() } : b,
        );
        const selectedId =
          state.selectedId === action.botId ? (moved.find((b) => !b.hidden)?.id ?? "") : state.selectedId;
        if (selectedId !== state.selectedId) writeSelected(selectedId);
        return { ...state, bots: moved, selectedId };
      }
      const bots = state.bots.filter((b) => b.id !== action.botId);
      const selectedId =
        state.selectedId === action.botId ? (bots.find((b) => !b.hidden)?.id ?? "") : state.selectedId;
      if (selectedId !== state.selectedId) writeSelected(selectedId);
      return { ...state, bots, selectedId };
    }
    case "restoreBot":
      return updateBot(state, action.botId, (b) => ({ ...b, hidden: false, archivedAt: null }));
    case "markUnread":
      return updateBot(state, action.botId, (b) => ({ ...b, unread: true }));
    case "botPatched": {
      const known = state.bots.some((b) => b.id === action.bot.id);
      if (!known) {
        const arrival = action.bot as Partial<Bot> & { id: string; threadId?: string };
        if (!arrival.threadId) return state;
        return { ...state, bots: [{ messages: [], ...arrival } as Bot, ...state.bots] };
      }
      return updateBot(state, action.bot.id, (b) => ({
        ...b,
        ...action.bot,
        messages: (action.bot as Partial<Bot>).messages ?? b.messages,
      }));
    }
    case "messageAdded": {
      const room = state.rooms.find((b) => b.id === action.threadId);
      if (room) {
        return {
          ...state,
          rooms: state.rooms.map((b) =>
            b.id === room.id && !b.messages.some((m) => m.id === action.message.id)
              ? { ...b, messages: [...b.messages, action.message] }
              : b,
          ),
        };
      }
      const bot = state.bots.find((b) => b.threadId === action.threadId);
      if (!bot) return state;
      const next = updateBot(state, bot.id, (b) =>
        b.messages.some((m) => m.id === action.message.id)
          ? b
          : { ...b, messages: [...b.messages, action.message] },
      );
      if (action.message.role === "bot" && action.message.kind === "text") {
        const { [action.threadId]: _, ...rest } = next.streaming;
        return { ...next, streaming: rest };
      }
      return next;
    }
    case "messagePatched": {
      const room = state.rooms.find((b) => b.id === action.threadId);
      if (room) {
        return {
          ...state,
          rooms: state.rooms.map((b) =>
            b.id === room.id
              ? { ...b, messages: b.messages.map((m) => (m.id === action.message.id ? action.message : m)) }
              : b,
          ),
        };
      }
      const bot = state.bots.find((b) => b.threadId === action.threadId);
      if (!bot) return state;
      return updateBot(state, bot.id, (b) => ({
        ...b,
        messages: b.messages.map((m) => (m.id === action.message.id ? action.message : m)),
      }));
    }
    case "streamDelta":
      return {
        ...state,
        streaming: {
          ...state.streaming,
          [action.threadId]: (state.streaming[action.threadId] ?? "") + action.delta,
        },
      };
    case "streamClear": {
      const { [action.threadId]: _, ...rest } = state.streaming;
      return { ...state, streaming: rest };
    }
    case "screenFrame":
      return {
        ...state,
        screens: { ...state.screens, [action.botId]: { png: action.png, mime: action.mime } },
        provisioning: { ...state.provisioning, [action.botId]: false },
      };
    case "provisioning":
      return { ...state, provisioning: { ...state.provisioning, [action.botId]: action.on } };
    case "setModel":
      return updateBot(state, action.botId, (b) => ({ ...b, modelSelection: action.selection }));
    case "connected":
      return { ...state, connected: action.value };
    case "error":
      return { ...state, error: action.message };
    case "toggleSettings": {
      const open = action.open ?? !state.settingsOpen;
      return {
        ...state,
        settingsOpen: open,
        computerOpen: open ? false : state.computerOpen,
        appSettingsOpen: open ? false : state.appSettingsOpen,
      };
    }
    case "togglePlugins":
      return { ...state, pluginsOpen: action.open ?? !state.pluginsOpen };
    case "toggleComputer": {
      const open = action.open ?? !state.computerOpen;
      return {
        ...state,
        computerOpen: open,
        settingsOpen: open ? false : state.settingsOpen,
        appSettingsOpen: open ? false : state.appSettingsOpen,
      };
    }
    case "toggleAppSettings": {
      const open = action.open ?? !state.appSettingsOpen;
      return {
        ...state,
        appSettingsOpen: open,
        settingsOpen: open ? false : state.settingsOpen,
        computerOpen: open ? false : state.computerOpen,
        pluginsOpen: open ? false : state.pluginsOpen,
      };
    }
    case "updateBot":
      return updateBot(state, action.botId, (b) => ({ ...b, ...action.patch }));
    case "patchRoom": {
      const rooms = action.patch.archived
        ? state.rooms.filter((b) => b.id !== action.roomId)
        : state.rooms.map((b) => (b.id === action.roomId ? { ...b, ...action.patch } : b));
      const selectedId =
        action.patch.archived && state.selectedId === action.roomId
          ? (state.bots.find((b) => !b.hidden)?.id ?? "")
          : state.selectedId;
      return { ...state, rooms, selectedId };
    }
    case "createRoom":
    case "deleteRoom":
    case "sendToRoom":
    case "send":
    case "newBot":
    case "duplicateBot":
    case "interrupt":
    case "connectProvider":
    case "disconnectProvider":
      return state;
  }
}

function readSelected(): string {
  try {
    return localStorage.getItem("workmates-selected") ?? "";
  } catch {
    return "";
  }
}

function writeSelected(id: string) {
  try {
    if (id) localStorage.setItem("workmates-selected", id);
    else localStorage.removeItem("workmates-selected");
  } catch {
  }
}

export const initialState: AppState = {
  bots: [],
  rooms: [],
  instances: [],
  providers: [],
  config: null,
  selectedId: readSelected(),
  settingsOpen: false,
  pluginsOpen: false,
  computerOpen: false,
  appSettingsOpen: false,
  newAgentOpen: false,
  newAgentFirstRun: false,
  skillsOpen: false,
  routinesOpen: false,
  newRoomOpen: false,
  projectsOpen: false,
  activityOpen: false,
  projectId: (() => {
    try {
      return localStorage.getItem("workmates-project");
    } catch {
      return null;
    }
  })(),
  streaming: {},
  screens: {},
  provisioning: {},
  connected: false,
  error: null,
};

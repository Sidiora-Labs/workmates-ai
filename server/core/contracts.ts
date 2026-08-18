export type DriverKind = string;
export type InstanceId = string;
export type ThreadId = string;
export type TurnId = string;

export interface ModelSelection {
  instanceId: InstanceId;
  model: string;
}

export interface InstanceConfig {
  driver: DriverKind;
  displayName?: string;
  accentColor?: string;
  environment?: Record<string, string>;
  enabled?: boolean;
  config?: unknown;
}

export type InstanceConfigMap = Record<InstanceId, InstanceConfig>;

export interface RuntimeEventBase {
  eventId: string;
  provider: DriverKind;
  providerInstanceId?: InstanceId;
  threadId: ThreadId;
  createdAt: string;
  turnId?: TurnId;
  itemId?: string;
  requestId?: string;
  raw?: { source: string; payload: unknown };
}

export type RuntimeEvent = RuntimeEventBase &
  (
    | { type: "session.started"; sessionId: string | null; model?: string | null }
    | { type: "session.exited"; reason?: string }
    | { type: "turn.started" }
    | {
        type: "turn.completed";
        ok: boolean;
        stopReason?: string | null;
        cost?: number | null;
        denials?: string[];
      }
    | { type: "item.started"; itemType: "tool" | "reasoning"; title?: string }
    | { type: "item.updated"; itemType: "tool" | "reasoning"; tokens?: number | null }
    | { type: "item.completed"; itemType: "tool"; ok: boolean }
    | { type: "item.completed"; itemType: "assistant_text"; text: string }
    | { type: "content.delta"; streamKind: "assistant_text" | "reasoning_text"; delta: string }
    | {
        type: "request.opened";
        requestType: "permission" | "question";
        tool: string;
        input?: unknown;
        summary: string;
        choices?: string[];
      }
    | { type: "request.resolved"; behavior: string; source: string }
    | { type: "thread.token-usage.updated"; input: number; output: number }
    | { type: "runtime.error"; message: string }
  );

export type RuntimeEventListener = (event: RuntimeEvent) => void;

export interface SendTurnInput {
  threadId: ThreadId;
  text: string;
  model?: string;
  effort?: "low" | "medium" | "high";
  resumeCursor?: unknown;
  transcript?: Array<{ role: "user" | "assistant"; text: string }>;
  system?: string;
  integrations?: {
    composio?: { url?: string; key: string };
    computer?: { boxId: string; token: string };
    localComputer?: { command: string; args: string[]; env: Record<string, string> };
    sandbox?: { runtime: string; name: string };
    browser?: { profileDir: string; port: number };
    mcpServers?: Array<{
      name: string;
      transport: "stdio" | "http";
      command?: string;
      args?: string[];
      url?: string;
      headers?: Record<string, string>;
    }>;
  };
  cwd?: string;
  extraDirs?: string[];
  env?: Record<string, string>;
}

export interface TurnStartResult {
  turnId: TurnId;
}

export interface ProviderAdapter {
  readonly provider: DriverKind;
  readonly capabilities: {
    sessionModelSwitch: "in-session" | "unsupported";
    replaysNatively?: boolean;
  };
  sendTurn(input: SendTurnInput): Promise<TurnStartResult>;
  interruptTurn(threadId: ThreadId, turnId?: TurnId): Promise<void>;
  respondToRequest(
    threadId: ThreadId,
    requestId: string,
    decision: { behavior: "allow" | "deny" | "answer"; message?: string },
  ): Promise<void>;
  hasSession(threadId: ThreadId): boolean;
  stopAll(): Promise<void>;
  onEvent(listener: RuntimeEventListener): () => void;
}

export interface ProviderSnapshot {
  state: "available" | "unavailable";
  reason?: string;
  authenticated?: boolean;
  version?: string | null;
}

export interface ModelCatalog {
  default: string;
  options: Array<{ id: string; label: string }>;
}

export interface DriverCreateInput<Config> {
  instanceId: InstanceId;
  displayName: string | undefined;
  environment: Record<string, string>;
  enabled: boolean;
  config: Config;
}

export interface ProviderInstance {
  readonly instanceId: InstanceId;
  readonly driverKind: DriverKind;
  readonly displayName: string | undefined;
  readonly enabled: boolean;
  readonly models: ModelCatalog;
  readonly adapter: ProviderAdapter;
  catalogReady?: Promise<void>;
  snapshot(): Promise<ProviderSnapshot>;
  generateText?(prompt: string): Promise<string>;
  dispose(): Promise<void>;
}

export interface ProviderDriver<Config = unknown> {
  readonly driverKind: DriverKind;
  readonly metadata: { displayName: string; supportsMultipleInstances?: boolean };
  decodeConfig(raw: unknown): Config;
  defaultConfig(): Config;
  readonly models: ModelCatalog;
  create(input: DriverCreateInput<Config>): Promise<ProviderInstance>;
}

export type AnyProviderDriver = ProviderDriver<any>;

let eventCounter = 0;

export const newEventId = () => `ev-${Date.now().toString(36)}-${(eventCounter++).toString(36)}`;

export const newId = () => crypto.randomUUID();

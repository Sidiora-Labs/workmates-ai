import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import { noticeFor } from "@/lib/notify";
import { maybeAutoSpeak } from "@/components/chat/Voice";
import {
  findCard,
  initialState,
  reducer,
  type Action,
  type AppState,
  type Bot,
  type OptionCardData,
} from "./reducer";

export * from "./reducer";

export async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  return body;
}

const StoreContext = createContext<{
  state: AppState;
  dispatch: React.Dispatch<Action>;
} | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, rawDispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const patchTimers = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; patch: Record<string, unknown> }>());

  const dispatch = useMemo(() => {
    const showError = (e: unknown) => {
      rawDispatch({ type: "error", message: e instanceof Error ? e.message : String(e) });
      setTimeout(() => rawDispatch({ type: "error", message: null }), 6000);
    };
    const persistCard = (botId: string, messageId: string, patch: Partial<OptionCardData>) => {
      fetch(`/api/bots/${botId}/cards/${messageId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      }).catch(() => {});
    };

    const wrapped: React.Dispatch<Action> = (action) => {
      rawDispatch(action);
      switch (action.type) {
        case "send":
          api(`/api/bots/${action.botId}/messages`, {
            method: "POST",
            body: JSON.stringify({ text: action.text, replyTo: action.replyTo }),
          }).catch(showError);
          break;
        case "answerCard": {
          const card = findCard(stateRef.current, action);
          if (card?.runId) {
            api(`/api/workflows/runs/${card.runId}/answer`, {
              method: "POST",
              body: JSON.stringify({ answer: action.answer }),
            }).catch(showError);
          } else if (card?.requestId) {
            const behavior =
              action.answer === "Allow" ? "allow" : action.answer === "Deny" ? "deny" : "answer";
            api(`/api/bots/${action.botId}/respond`, {
              method: "POST",
              body: JSON.stringify({
                requestId: card.requestId,
                behavior,
                message: behavior === "answer" ? action.answer : undefined,
              }),
            }).catch(showError);
          } else if (action.roomId) {
            api(`/api/rooms/${action.roomId}/messages`, {
              method: "POST",
              body: JSON.stringify({ text: action.answer }),
            }).catch(showError);
          } else {
            persistCard(action.botId, action.messageId, { answered: action.answer });
            api(`/api/bots/${action.botId}/messages`, {
              method: "POST",
              body: JSON.stringify({ text: action.answer }),
            }).catch(showError);
          }
          break;
        }
        case "connectProvider":
          api(`/api/providers/${action.kind}/connect`, {
            method: "POST",
            body: JSON.stringify({ key: action.key ?? "", url: action.url ?? "" }),
          })
            .then(({ providers }) => {
              rawDispatch({ type: "providers", providers });
              return api("/api/instances").then(({ instances }) =>
                rawDispatch({ type: "instances", instances }),
              );
            })
            .catch(showError);
          break;
        case "disconnectProvider":
          api(`/api/providers/${action.kind}`, { method: "DELETE" })
            .then(({ providers }) => {
              rawDispatch({ type: "providers", providers });
              return api("/api/instances").then(({ instances }) =>
                rawDispatch({ type: "instances", instances }),
              );
            })
            .catch(showError);
          break;
        case "hireTeam":
          api(`/api/teams/${action.messageId}/hire`, {
            method: "POST",
            body: JSON.stringify({ botId: action.botId }),
          })
            .then(({ room }) =>
              api("/api/rooms").then(({ rooms }) => {
                rawDispatch({ type: "hydrateRooms", rooms });
                rawDispatch({ type: "select", id: room.id });
              }),
            )
            .catch(showError);
          break;
        case "dismissCard": {
          const card = findCard(stateRef.current, action);
          if (card?.requestId) {
            api(`/api/bots/${action.botId}/respond`, {
              method: "POST",
              body: JSON.stringify({ requestId: card.requestId, behavior: "deny", message: "Dismissed by user." }),
            }).catch(() => {});
          } else if (!action.roomId) {
            persistCard(action.botId, action.messageId, { dismissed: true });
          }
          break;
        }
        case "newBot":
          api("/api/bots", {
            method: "POST",
            body: JSON.stringify(action.profile ?? {}),
          })
            .then(({ bot }) => rawDispatch({ type: "botAdded", bot }))
            .catch(showError);
          break;
        case "duplicateBot": {
          const source = stateRef.current.bots.find((b) => b.id === action.botId);
          if (!source) break;
          api("/api/bots", { method: "POST" })
            .then(({ bot }) =>
              api(`/api/bots/${bot.id}`, {
                method: "PATCH",
                body: JSON.stringify({
                  name: `${source.name} copy`,
                  title: source.title,
                  description: source.description,
                  notifications: source.notifications,
                  modelSelection: source.modelSelection,
                  ...(source.computer ? { computer: source.computer } : {}),
                }),
              }).then(({ bot: patched }) =>
                rawDispatch({ type: "botAdded", bot: { ...bot, ...patched, messages: bot.messages } }),
              ),
            )
            .catch(showError);
          break;
        }
        case "deleteBot":
          api(`/api/bots/${action.botId}${action.forget ? "?forget=1" : ""}`, { method: "DELETE" }).catch(
            showError,
          );
          break;
        case "restoreBot":
          api(`/api/bots/${action.botId}/restore`, { method: "POST" }).catch(showError);
          break;
        case "createRoom":
          api("/api/rooms", {
            method: "POST",
            body: JSON.stringify({ name: action.name, memberIds: action.memberIds }),
          })
            .then(({ room }) => {
              rawDispatch({ type: "roomPatched", room });
              rawDispatch({ type: "hydrateRooms", rooms: [] });
              return api("/api/rooms").then(({ rooms }) => {
                rawDispatch({ type: "hydrateRooms", rooms });
                rawDispatch({ type: "select", id: room.id });
                rawDispatch({ type: "toggleNewRoom", open: false });
              });
            })
            .catch(showError);
          break;
        case "patchRoom":
          api(`/api/rooms/${action.roomId}`, {
            method: "PATCH",
            body: JSON.stringify(action.patch),
          }).catch(() => {});
          break;
        case "deleteRoom":
          api(`/api/rooms/${action.roomId}`, { method: "DELETE" })
            .then(() => rawDispatch({ type: "roomDeleted", roomId: action.roomId }))
            .catch(showError);
          break;
        case "newTask":
          api(`/api/bots/${action.botId}/tasks`, { method: "POST", body: "{}" })
            .then((r) => r.bot && rawDispatch({ type: "botPatched", bot: r.bot }))
            .catch(showError);
          break;
        case "selectTask":
          api(`/api/bots/${action.botId}/tasks/${action.taskId}/activate`, { method: "POST" })
            .then((r) => r.bot && rawDispatch({ type: "botPatched", bot: r.bot }))
            .catch(showError);
          break;
        case "closeTask":
          api(`/api/bots/${action.botId}/tasks/${action.taskId}`, { method: "DELETE" })
            .then((r) => r.bot && rawDispatch({ type: "botPatched", bot: r.bot }))
            .catch(showError);
          break;
        case "sendToRoom":
          api(`/api/rooms/${action.roomId}/messages`, {
            method: "POST",
            body: JSON.stringify({ text: action.text, replyTo: action.replyTo }),
          }).catch(showError);
          break;
        case "markUnread":
          api(`/api/bots/${action.botId}`, { method: "PATCH", body: JSON.stringify({ unread: true }) }).catch(
            () => {},
          );
          break;
        case "select": {
          const bot = stateRef.current.bots.find((b) => b.id === action.id);
          if (bot?.unread) {
            api(`/api/bots/${action.id}`, { method: "PATCH", body: JSON.stringify({ unread: false }) }).catch(() => {});
          }
          break;
        }
        case "setModel":
          api(`/api/bots/${action.botId}`, {
            method: "PATCH",
            body: JSON.stringify({ modelSelection: action.selection }),
          }).catch(showError);
          break;
        case "interrupt":
          api(`/api/bots/${action.botId}/interrupt`, { method: "POST" }).catch(showError);
          break;
        case "updateBot": {
          const timers = patchTimers.current;
          const pending = timers.get(action.botId);
          const patch = { ...pending?.patch, ...action.patch };
          if (pending) clearTimeout(pending.timer);
          timers.set(action.botId, {
            patch,
            timer: setTimeout(() => {
              timers.delete(action.botId);
              api(`/api/bots/${action.botId}`, { method: "PATCH", body: JSON.stringify(patch) }).catch(showError);
            }, 400),
          });
          break;
        }
        default:
          break;
      }
    };
    return wrapped;
  }, []);

  const replayUntil = useRef(0);
  const lastBanner = useRef(new Map<string, number>());

  const announce = useCallback((threadId: string, message: unknown) => {
    const bridge = window.rooms;
    if (!bridge || !message) return;
    const current = stateRef.current;
    const bot = current.bots.find((b) => b.tasks?.some((t) => t.id === threadId));
    const room = current.rooms.find((r) => r.id === threadId);
    if (!bot && !room) return;
    const text = (message as { text?: string }).text ?? "";
    const notice = noticeFor(message as never, {
      focused: document.hasFocus() && document.visibilityState === "visible",
      selectedId: current.selectedId,
      threadId,
      ...(bot ? { bot: { id: bot.id, name: bot.name, notifications: bot.notifications } } : {}),
      ...(room ? { room: { id: room.id, name: room.name } } : {}),
      mentionsUser: /(^|\s)@(you|me)\b/i.test(text),
    });
    if (!notice) return;
    const now = Date.now();
    const previous = lastBanner.current.get(threadId) ?? 0;
    if (!notice.urgent && now - previous < 4000) return;
    lastBanner.current.set(threadId, now);
    if (bot?.avatarAt) notice.avatar = `/api/bots/${bot.id}/avatar?v=${bot.avatarAt}`;
    void bridge.notifyShow(notice).catch(() => {});
  }, []);

  useEffect(() => {
    const bridge = window.rooms;
    if (!bridge?.onNotifyActivate) return;
    return bridge.onNotifyActivate(({ target }) => {
      if (target) rawDispatch({ type: "select", id: target });
    });
  }, []);

  useEffect(() => {
    let alive = true;
    const loadAll = () => {
      api("/api/bots")
        .then(({ bots }) => alive && rawDispatch({ type: "hydrate", bots }))
        .catch(() => {});
      api("/api/rooms")
        .then(({ rooms }) => alive && rawDispatch({ type: "hydrateRooms", rooms }))
        .catch(() => {});
      api("/api/instances")
        .then(({ instances }) => alive && rawDispatch({ type: "instances", instances }))
        .catch(() => {});
      api("/api/providers")
        .then(({ providers }) => alive && rawDispatch({ type: "providers", providers }))
        .catch(() => {});
      api("/api/config")
        .then((config) => alive && rawDispatch({ type: "configStatus", config }))
        .catch(() => {});
    };
    let es: EventSource | null = null;
    let lastSeq = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      if (!alive) return;
      es = new EventSource(lastSeq ? `/api/events?since=${lastSeq}` : "/api/events");
      es.onopen = () => rawDispatch({ type: "connected", value: true });
      es.onerror = () => {
        rawDispatch({ type: "connected", value: false });
        es?.close();
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(connect, 1500);
      };
      es.onmessage = onFrame;
    };

    const onFrame = (raw: MessageEvent) => {
      let frame: any;
      try {
        frame = JSON.parse(raw.data);
      } catch {
        return;
      }
      if (typeof frame._seq === "number") lastSeq = frame._seq;
      switch (frame.kind) {
        case "hello":
          replayUntil.current = typeof frame._seq === "number" ? frame._seq : 0;
          if (!frame.resumed) loadAll();
          break;
        case "message": {
          rawDispatch({ type: "messageAdded", threadId: frame.threadId, message: frame.message });
          const msg = frame.message;
          if (msg?.role === "bot" && msg.kind === "text" && msg.text) {
            const owner = stateRef.current.bots.find((b) =>
              b.tasks?.some((t) => t.id === frame.threadId),
            );
            if (owner) maybeAutoSpeak(owner, msg.text);
          }
          if (typeof frame._seq !== "number" || frame._seq > replayUntil.current) {
            announce(frame.threadId, msg);
          }
          break;
        }
        case "message.patch":
          rawDispatch({ type: "messagePatched", threadId: frame.threadId, message: frame.message });
          break;
        case "bot": {
          const bot = frame.bot as Partial<Bot> & { id: string };
          if (bot.unread && bot.id === stateRef.current.selectedId) {
            bot.unread = false;
            fetch(`/api/bots/${bot.id}`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ unread: false }),
            }).catch(() => {});
          }
          rawDispatch({ type: "botPatched", bot });
          break;
        }
        case "runtime": {
          const event = frame.event;
          if (event.type === "content.delta" && event.streamKind === "assistant_text") {
            rawDispatch({ type: "streamDelta", threadId: event.threadId, delta: event.delta });
          } else if (event.type === "turn.completed") {
            rawDispatch({ type: "streamClear", threadId: event.threadId });
          }
          break;
        }
        case "screen":
          rawDispatch({ type: "screenFrame", botId: frame.botId, png: frame.png, mime: frame.mime ?? "image/png" });
          break;
        case "computer":
          rawDispatch({ type: "provisioning", botId: frame.botId, on: frame.state === "provisioning" });
          break;
        case "room":
          rawDispatch({ type: "roomPatched", room: frame.room });
          break;
        case "room.deleted":
          rawDispatch({ type: "roomDeleted", roomId: frame.roomId });
          break;
        case "providers":
          rawDispatch({ type: "providers", providers: frame.providers });
          api("/api/instances")
            .then(({ instances }) => rawDispatch({ type: "instances", instances }))
            .catch(() => {});
          break;
        case "instances":
          if (Array.isArray(frame.instances)) rawDispatch({ type: "instances", instances: frame.instances });
          break;
        case "bot.deleted":
          rawDispatch({ type: "deleteBot", botId: frame.botId });
          break;
        case "config":
          rawDispatch({
            type: "configStatus",
            config: { xai: frame.xai, composio: frame.composio, box: frame.box, profile: frame.profile },
          });
          api("/api/instances")
            .then(({ instances }) => rawDispatch({ type: "instances", instances }))
            .catch(() => {});
          break;
      }
    };
    connect();
    return () => {
      alive = false;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
    };
  }, []);

  const value = useMemo(() => ({ state, dispatch }), [state, dispatch]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore outside provider");
  return ctx;
}

export function formatTime(at: number) {
  return new Date(at).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatWhen(at: number) {
  const then = new Date(at);
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (at >= midnight) return formatTime(at);
  if (at >= midnight - 86_400_000) return "Yesterday";
  if (at >= midnight - 6 * 86_400_000) return then.toLocaleDateString([], { weekday: "short" });
  return then.toLocaleDateString([], { month: "short", day: "numeric" });
}

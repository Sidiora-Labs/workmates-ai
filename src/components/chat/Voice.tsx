import { useCallback, useEffect, useRef, useState } from "react";
import Check from "lucide-react/dist/esm/icons/check.mjs";
import Mic from "lucide-react/dist/esm/icons/mic.mjs";
import Phone from "lucide-react/dist/esm/icons/phone.mjs";
import PhoneOff from "lucide-react/dist/esm/icons/phone-off.mjs";
import Volume2 from "lucide-react/dist/esm/icons/volume-2.mjs";
import { api, useStore, type Bot, type Message } from "@/state/store";
import { MATE_COLORS, type MateColor } from "@/lib/mascot";
import { AgentAvatar } from "../agents/Avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { routeSpokenToRoom } from "@/lib/spokenRouting";

interface VoiceOption {
  provider: "elevenlabs" | "openai";
  id: string;
  name: string;
}

const PREVIEW_LINE = "Hi, this is how I sound. Ready when you are.";

async function fetchSpeech(botId: string, text?: string): Promise<HTMLAudioElement> {
  const res = await fetch(`/api/bots/${botId}/speak`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "speech failed");
  const url = URL.createObjectURL(await res.blob());
  const audio = new Audio(url);
  audio.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });
  return audio;
}

export async function claimCall(targetId: string): Promise<
  { ok: true; token: string; stop: () => void } | { ok: false; reason: string }
> {
  try {
    const r = await api("/api/calls/claim", {
      method: "POST",
      body: JSON.stringify({ targetId, device: "this Mac" }),
    });
    const token: string = r.token;
    const timer = setInterval(() => {
      api("/api/calls/renew", { method: "POST", body: JSON.stringify({ token }) }).catch(() => {});
    }, Math.max(4000, (r.ttlMs ?? 20000) / 3));
    return {
      ok: true,
      token,
      stop: () => {
        clearInterval(timer);
        void api("/api/calls", { method: "DELETE", body: JSON.stringify({ token }) }).catch(
          () => {},
        );
      },
    };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

let callActive = false;
export function setCallActive(on: boolean) {
  callActive = on;
}

let autoAudio: HTMLAudioElement | null = null;

export function maybeAutoSpeak(
  bot: { id: string; voice?: unknown; speakReplies?: boolean },
  text: string,
) {
  if (!bot.speakReplies || !bot.voice || callActive) return;
  autoAudio?.pause();
  fetchSpeech(bot.id, text)
    .then((audio) => {
      if (callActive) return;
      autoAudio = audio;
      return audio.play();
    })
    .catch(() => {});
}

export function VoiceCard({ bot }: { bot: Bot }) {
  const { state } = useStore();
  const [open, setOpen] = useState(false);
  const [voices, setVoices] = useState<VoiceOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const configured = state.config?.speech?.elevenlabs || state.config?.speech?.openai;

  useEffect(() => {
    if (!open || voices !== null) return;
    api("/api/speech/voices")
      .then((r) => setVoices(r.voices ?? []))
      .catch((e: Error) => setError(e.message));
  }, [open, voices]);

  const choose = (voice: VoiceOption | null) => {
    setError(null);
    api(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ voice } ) }).catch(
      (e: Error) => setError(e.message),
    );
  };

  const preview = () => {
    if (previewing) return;
    setPreviewing(true);
    fetchSpeech(bot.id, PREVIEW_LINE)
      .then((audio) => {
        audio.addEventListener("ended", () => setPreviewing(false), { once: true });
        return audio.play();
      })
      .catch((e: Error) => {
        setError(e.message);
        setPreviewing(false);
      });
  };

  return (
    <div className="mt-4 rounded-2xl border bg-card p-4">
      <button className="flex w-full items-center justify-between text-left" onClick={() => setOpen(!open)}>
        <div>
          <div className="text-[13.5px] font-semibold text-foreground">Voice</div>
          <div className="mt-0.5 text-[12.5px] text-muted-foreground">
            {!configured
              ? "Add an ElevenLabs or OpenAI key in Settings → Voices first."
              : bot.voice
                ? `Speaks as ${bot.voice.name ?? bot.voice.id} · calls enabled`
                : "Pick a voice to enable calls with this agent."}
          </div>
        </div>
        <span className="text-[12px] text-muted-foreground">{open ? "Hide" : "Choose"}</span>
      </button>

      {open && (
        <div className="mt-3">
          {bot.voice && (
            <div className="mb-2 flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={preview} disabled={previewing}>
                <Volume2 size={13} />
                {previewing ? "Playing…" : "Preview"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => choose(null)}>
                Remove voice
              </Button>
              <label className="ml-auto flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={bot.speakReplies ?? false}
                  onChange={(e) =>
                    api(`/api/bots/${bot.id}`, {
                      method: "PATCH",
                      body: JSON.stringify({ speakReplies: e.target.checked }),
                    }).catch(() => {})
                  }
                  className="accent-[--brand]"
                />
                Read replies aloud
              </label>
            </div>
          )}
          <div className="flex max-h-[240px] flex-col gap-0.5 overflow-y-auto">
            {voices === null && !error && (
              <div className="py-3 text-[12.5px] text-muted-foreground">Loading voices…</div>
            )}
            {voices?.length === 0 && (
              <div className="py-3 text-[12.5px] text-muted-foreground">
                No voices available. Check your keys in Settings → Voices.
              </div>
            )}
            {(voices ?? []).map((voice) => {
              const active = bot.voice?.provider === voice.provider && bot.voice?.id === voice.id;
              return (
                <button
                  key={`${voice.provider}:${voice.id}`}
                  onClick={() => choose(voice)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors duration-150",
                    active ? "bg-brand-soft" : "hover:bg-accent",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-full",
                      active ? "bg-brand-ink text-brand-foreground" : "border",
                    )}
                  >
                    {active && <Check size={10} strokeWidth={3} />}
                  </span>
                  <span className="flex-1 truncate text-[13px] font-medium text-foreground">
                    {voice.name}
                  </span>
                  <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {voice.provider === "elevenlabs" ? "11L" : "OpenAI"}
                  </span>
                </button>
              );
            })}
          </div>
          {error && <div className="mt-2 text-[12px] text-destructive">{error}</div>}
        </div>
      )}
    </div>
  );
}

type CallState = "listening" | "transcribing" | "thinking" | "speaking" | "idle";

function startRecognition(handlers: {
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onSilence: () => void;
  onError: (message: string) => void;
}): { stop: () => void; needsManualFinish: boolean } | null {
  const Recognition =
    (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
  const bridge = (window as any).rooms;
  if (Recognition) {
    const recog = new Recognition();
    recog.continuous = false;
    recog.interimResults = true;
    recog.onresult = (event: any) => {
      const result = event.results[event.results.length - 1];
      handlers.onPartial(result[0].transcript);
      if (result.isFinal) {
        recog.stop();
        handlers.onFinal(result[0].transcript);
      }
    };
    recog.onerror = (event: any) => {
      if (event.error === "no-speech") handlers.onSilence();
      else handlers.onError(`microphone: ${event.error}`);
    };
    recog.start();
    return { stop: () => recog.stop(), needsManualFinish: false };
  }
  if (bridge?.speechStart) {
    const offTranscript = bridge.onSpeechTranscript((line: { text?: string }) => {
      if (typeof line.text === "string") handlers.onPartial(line.text);
    });
    void bridge.speechStart();
    return {
      stop: () => {
        offTranscript?.();
        void bridge.speechStop?.();
      },
      needsManualFinish: true,
    };
  }
  handlers.onError("No microphone input is available here.");
  return null;
}

export function CallOverlay({ bot, onClose }: { bot: Bot; onClose: () => void }) {
  const { dispatch } = useStore();
  const [callState, setCallState] = useState<CallState>("idle");
  const [heard, setHeard] = useState("");
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recogRef = useRef<any>(null);
  const baselineCount = useRef(bot.messages.length);
  const live = useRef(true);
  const botRef = useRef(bot);
  botRef.current = bot;

  const [needsManualFinish, setNeedsManualFinish] = useState(false);
  const heardRef = useRef("");

  const stopAudio = () => {
    audioRef.current?.pause();
    audioRef.current = null;
  };

  const listen = useCallback(() => {
    if (!live.current) return;
    setHeard("");
    heardRef.current = "";
    setError(null);
    setCallState("listening");
    const session = startRecognition({
      onPartial: (text) => {
        setHeard(text);
        heardRef.current = text;
      },
      onFinal: (text) => finishUtterance(text),
      onSilence: () => listen(),
      onError: (message) => setError(message),
    });
    recogRef.current = session;
    setNeedsManualFinish(Boolean(session?.needsManualFinish));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finishUtterance = (text: string) => {
    const said = text.trim();
    if (!said) return listen();
    baselineCount.current = botRef.current.messages.length;
    setCallState("thinking");
    dispatch({ type: "send", botId: botRef.current.id, text: said });
  };

  useEffect(() => {
    if (callState !== "thinking") return;
    const fresh = bot.messages.slice(baselineCount.current);
    const reply = [...fresh].reverse().find((m) => m.role === "bot" && m.kind === "text" && m.text);
    if (!reply || bot.busy) return;
    setCallState("speaking");
    fetchSpeech(bot.id, reply.text)
      .then((audio) => {
        if (!live.current) return;
        audioRef.current = audio;
        audio.addEventListener("ended", () => live.current && listen(), { once: true });
        return audio.play();
      })
      .catch((e: Error) => {
        setError(e.message);
        if (live.current) listen();
      });
  }, [bot.messages, bot.busy, callState, bot.id, listen]);

  const lease = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    setCallActive(true);
    void claimCall(bot.id).then((claim) => {
      if (!claim.ok) {
        setError(claim.reason);
        return;
      }
      lease.current = claim;
      if (live.current) listen();
    });
    return () => {
      setCallActive(false);
      live.current = false;
      recogRef.current?.stop?.();
      stopAudio();
      lease.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listen]);

  const hangUp = () => {
    live.current = false;
    recogRef.current?.stop?.();
    stopAudio();
    onClose();
  };

  const bargeIn = () => {
    stopAudio();
    listen();
  };

  const stateLabel =
    callState === "listening"
      ? heard || "Listening…"
      : callState === "thinking"
        ? "Thinking…"
        : callState === "speaking"
          ? "Speaking"
          : "";

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in flex-col items-center justify-center bg-background/95 backdrop-blur-sm">
      <span className="absolute right-5 top-5 rounded-full border border-warning/50 bg-warning/10 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-warning">
        Beta
      </span>
      <div className="flex flex-col items-center gap-5">
        <div
          className={cn(
            "rounded-full p-2 transition-shadow duration-500",
            callState === "listening" && "shadow-[0_0_0_10px_color-mix(in_srgb,var(--brand)_14%,transparent)]",
            callState === "speaking" && "call-speaking-ring",
          )}
          style={{ "--ring-tint": MATE_COLORS[bot.color as MateColor] } as React.CSSProperties}
        >
          <AgentAvatar bot={bot} size={132} />
        </div>
        <div className="text-center">
          <div className="text-[19px] font-semibold text-foreground">{bot.name}</div>
          <div className="mt-1 min-h-[20px] max-w-[340px] px-4 text-[13.5px] text-muted-foreground">
            {error ?? stateLabel}
          </div>
        </div>

        <div className="mt-4 flex items-center gap-4">
          {callState === "speaking" && (
            <button
              onClick={bargeIn}
              title="Interrupt and talk"
              className="flex size-14 items-center justify-center rounded-full border bg-card text-foreground shadow-sm transition-transform active:scale-95"
            >
              <Mic size={20} />
            </button>
          )}
          {needsManualFinish && callState === "listening" && (
            <Button
              variant="secondary"
              onClick={() => {
                recogRef.current?.stop?.();
                finishUtterance(heardRef.current);
              }}
            >
              Done talking
            </Button>
          )}
          <button
            onClick={hangUp}
            title="End call"
            className="flex size-14 items-center justify-center rounded-full bg-destructive text-white shadow-md transition-transform active:scale-95"
          >
            <PhoneOff size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function CallButton({ bot }: { bot: Bot }) {
  const [calling, setCalling] = useState(false);
  if (!bot.voice) return null;
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        title={`Call ${bot.name}`}
        aria-label={`Call ${bot.name}`}
        onClick={() => setCalling(true)}
      >
        <Phone size={16} />
      </Button>
      {calling && <CallOverlay bot={bot} onClose={() => setCalling(false)} />}
    </>
  );
}

export function GroupCallOverlay({
  room,
  members,
  onClose,
}: {
  room: { id: string; name: string; messages: Message[] };
  members: Bot[];
  onClose: () => void;
}) {
  const { state, dispatch } = useStore();
  const [callState, setCallState] = useState<CallState>("idle");
  const [heard, setHeard] = useState("");
  const [caption, setCaption] = useState("");
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsManualFinish, setNeedsManualFinish] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recogRef = useRef<{ stop: () => void } | null>(null);
  const heardRef = useRef("");
  const baseline = useRef(room.messages.length);
  const spoken = useRef(new Set<string>());
  const callStateRef = useRef<CallState>("idle");
  const botsRef = useRef(state.bots);
  botsRef.current = state.bots;
  const queue = useRef<Promise<void>>(Promise.resolve());
  const generation = useRef(0);
  const live = useRef(true);

  const liveMembers = state.bots.filter((b) => members.some((m) => m.id === b.id));
  const anyBusy = liveMembers.some((m) => m.busy);

  const stopAudio = () => {
    audioRef.current?.pause();
    audioRef.current = null;
  };

  const listen = useCallback(() => {
    if (!live.current) return;
    setHeard("");
    heardRef.current = "";
    setSpeakingId(null);
    setError(null);
    setCallState("listening");
    callStateRef.current = "listening";
    const session = startRecognition({
      onPartial: (text) => {
        setHeard(text);
        heardRef.current = text;
      },
      onFinal: (text) => finishUtterance(text),
      onSilence: () => listen(),
      onError: (message) => setError(message),
    });
    recogRef.current = session;
    setNeedsManualFinish(Boolean(session?.needsManualFinish));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finishUtterance = (text: string) => {
    const said = text.trim();
    if (!said) return listen();
    baseline.current = room.messages.length;
    setCallState("thinking");
    callStateRef.current = "thinking";
    dispatch({
      type: "sendToRoom",
      roomId: room.id,
      text: routeSpokenToRoom(said, members.map((m) => m.name)),
    });
  };

  useEffect(() => {
    if (callState !== "thinking" && callState !== "speaking") return;
    const liveRoom = state.rooms.find((r) => r.id === room.id);
    if (!liveRoom) return;
    const fresh = liveRoom.messages
      .slice(baseline.current)
      .filter((m) => m.role === "bot" && m.kind === "text" && m.text && !spoken.current.has(m.id));
    for (const message of fresh) {
      spoken.current.add(message.id);
      const speaker = liveMembers.find((b) => b.id === message.from);
      const gen = generation.current;
      queue.current = queue.current
        .catch(() => {})
        .then(async () => {
          if (!live.current || gen !== generation.current) return;
          setCallState("speaking");
          callStateRef.current = "speaking";
          setSpeakingId(speaker?.id ?? null);
          setCaption(`${speaker?.name ?? "Agent"}: ${message.text!.slice(0, 120)}`);
          if (speaker?.voice) {
            try {
              const audio = await fetchSpeech(speaker.id, message.text!);
              if (!live.current || gen !== generation.current) return;
              audioRef.current = audio;
              await new Promise<void>((resolve) => {
                audio.addEventListener("ended", () => resolve(), { once: true });
                audio.addEventListener("error", () => resolve(), { once: true });
                void audio.play().catch(() => resolve());
              });
            } catch {
            }
          } else {
            await new Promise((r) => setTimeout(r, Math.min(4000, 1200 + message.text!.length * 25)));
          }
        });
    }
    const gen = generation.current;
    queue.current = queue.current.catch(() => {}).then(() => {
      if (!live.current || gen !== generation.current) return;
      if (callStateRef.current === "listening") return;
      const stillBusy = botsRef.current.some(
        (b) => members.some((m) => m.id === b.id) && b.busy,
      );
      if (!stillBusy) listen();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.rooms, state.bots, callState]);

  const lease = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    setCallActive(true);
    for (const m of room.messages) spoken.current.add(m.id);
    void claimCall(room.id).then((claim) => {
      if (!claim.ok) {
        setError(claim.reason);
        return;
      }
      lease.current = claim;
      if (live.current) listen();
    });
    return () => {
      setCallActive(false);
      live.current = false;
      generation.current += 1;
      recogRef.current?.stop?.();
      stopAudio();
      lease.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const interrupt = () => {
    generation.current += 1;
    queue.current = Promise.resolve();
    stopAudio();
    if (anyBusy) {
      for (const m of liveMembers.filter((b) => b.busy)) {
        dispatch({ type: "interrupt", botId: m.id });
      }
    }
    listen();
  };

  const hangUp = () => {
    live.current = false;
    generation.current += 1;
    recogRef.current?.stop?.();
    stopAudio();
    onClose();
  };

  const stateLabel =
    callState === "listening"
      ? heard || "Listening. Say a name or just talk."
      : callState === "thinking"
        ? "The room is thinking…"
        : caption;

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in flex-col items-center justify-center bg-background/95 backdrop-blur-sm">
      <span className="absolute right-5 top-5 rounded-full border border-warning/50 bg-warning/10 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-warning">
        Beta
      </span>
      <div className="flex flex-col items-center gap-6">
        <div className="flex items-end gap-3">
          {liveMembers.map((member) => {
            const focused = speakingId === member.id || (speakingId === null && member.busy);
            return (
              <div
                key={member.id}
                className={cn(
                  "flex flex-col items-center gap-1.5 transition-all duration-300",
                  focused ? "scale-110" : "opacity-70",
                )}
              >
                <div
                  className={cn("rounded-full", speakingId === member.id && "call-speaking-ring")}
                  style={{ "--ring-tint": MATE_COLORS[member.color as MateColor] } as React.CSSProperties}
                >
                  <AgentAvatar bot={member} size={focused ? 76 : 60} />
                </div>
                <span className="text-[11.5px] font-medium text-muted-foreground">{member.name}</span>
              </div>
            );
          })}
        </div>
        <div className="text-center">
          <div className="text-[18px] font-semibold text-foreground">{room.name}</div>
          <div className="mt-1 min-h-[20px] max-w-[420px] px-4 text-[13.5px] text-muted-foreground">
            {error ?? stateLabel}
          </div>
        </div>
        <div className="flex items-center gap-4">
          {callState === "speaking" && (
            <button
              onClick={interrupt}
              title="Interrupt and talk"
              className="flex size-14 items-center justify-center rounded-full border bg-card text-foreground shadow-sm transition-transform active:scale-95"
            >
              <Mic size={20} />
            </button>
          )}
          {needsManualFinish && callState === "listening" && (
            <Button
              variant="secondary"
              onClick={() => {
                recogRef.current?.stop?.();
                finishUtterance(heardRef.current);
              }}
            >
              Done talking
            </Button>
          )}
          <button
            onClick={hangUp}
            title="End call"
            className="flex size-14 items-center justify-center rounded-full bg-destructive text-white shadow-md transition-transform active:scale-95"
          >
            <PhoneOff size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function GroupCallButton({
  room,
  members,
}: {
  room: { id: string; name: string; messages: Message[] };
  members: Bot[];
}) {
  const [calling, setCalling] = useState(false);
  const voiced = members.filter((m) => m.voice).length;
  if (voiced === 0) return null;
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        title={
          voiced === members.length
            ? `Call ${room.name}`
            : `Call ${room.name} (${members.length - voiced} member${members.length - voiced === 1 ? "" : "s"} without a voice will show as text)`
        }
        aria-label={`Call ${room.name}`}
        onClick={() => setCalling(true)}
      >
        <Phone size={16} />
      </Button>
      {calling && <GroupCallOverlay room={room} members={members} onClose={() => setCalling(false)} />}
    </>
  );
}

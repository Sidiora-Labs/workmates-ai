import TabGeneral from "lucide-react/dist/esm/icons/settings-2.mjs";
import TabEngines from "lucide-react/dist/esm/icons/cpu.mjs";
import TabApps from "lucide-react/dist/esm/icons/layout-grid.mjs";
import TabLocalVm from "lucide-react/dist/esm/icons/box.mjs";
import TabVoices from "lucide-react/dist/esm/icons/mic.mjs";
import TabDevices from "lucide-react/dist/esm/icons/smartphone.mjs";
import TabRules from "lucide-react/dist/esm/icons/shield-check.mjs";
import TabRecord from "lucide-react/dist/esm/icons/scroll-text.mjs";
import { useEffect, useRef, useState } from "react";
import Check from "lucide-react/dist/esm/icons/check.mjs";
import Monitor from "lucide-react/dist/esm/icons/monitor.mjs";
import Moon from "lucide-react/dist/esm/icons/moon.mjs";
import Sun from "lucide-react/dist/esm/icons/sun.mjs";
import { api, useStore } from "@/state/store";
import { useTheme, type Theme } from "@/lib/theme";
import type { UpdateState } from "@/types/bridge";
import { RecordPanel } from "./RecordPanel";
import { RulesPanel } from "./RulesPanel";
import { ApiKeyRow } from "./ApiKeys";
import { McpServersCard } from "./McpServers";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { EnginesPanel } from "./EnginesPanel";
import { CloudSection } from "./CloudSection";
import { DevicesSection } from "./DevicesSection";
import { TelegramSection } from "./TelegramSection";
import { LocalVmSection } from "./LocalVmSection";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";
import { ServerConnectionCard, isRemoteServer } from "./ServerConnection";

const THEME_OPTIONS: Array<{ value: Theme; label: string; icon: React.ReactNode }> = [
  { value: "light", label: "Light", icon: <Sun size={14} /> },
  { value: "dark", label: "Dark", icon: <Moon size={14} /> },
  { value: "system", label: "System", icon: <Monitor size={14} /> },
];

function Compaction() {
  const { state, dispatch } = useStore();
  const on = state.config?.compaction?.micro ?? false;
  const [saving, setSaving] = useState(false);

  const set = (micro: boolean) => {
    setSaving(true);
    api("/api/config", { method: "PUT", body: JSON.stringify({ compaction: { micro } }) })
      .then((status) => dispatch({ type: "configStatus", config: status }))
      .catch(() => {})
      .finally(() => setSaving(false));
  };

  return (
    <div className="mt-4 rounded-[10px] border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[13.5px] font-semibold text-foreground">
            Summarise as you go
            <InfoTip text="A long conversation has to be summarised to keep fitting. Off, that happens once when it fills up, which is a pause before your next message. On, one message is folded in after each turn instead, so it never pauses. The cost: folding rewrites what was already sent, so the provider cannot reuse its cache, which on some providers costs more than the pause it removes. Your own messages are never summarised either way." />
          </div>
          <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
            Fold the conversation a little after each turn instead of all at once when it fills up.
          </div>
        </div>
        <Switch aria-label="Summarise as you go" checked={on} disabled={saving} onCheckedChange={set} />
      </div>
    </div>
  );
}

function ProposeSkills() {
  const { state, dispatch } = useStore();
  const on = state.config?.skills?.propose ?? false;
  const [saving, setSaving] = useState(false);

  const set = (propose: boolean) => {
    setSaving(true);
    api("/api/config", { method: "PUT", body: JSON.stringify({ skills: { propose } }) })
      .then((status) => dispatch({ type: "configStatus", config: status }))
      .catch(() => {})
      .finally(() => setSaving(false));
  };

  return (
    <div className="mt-4 rounded-[10px] border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[13.5px] font-semibold text-foreground">
            Suggest skills
            <InfoTip text="Nothing is ever installed on its own. A suggestion waits in Skills with the words already written, and keeping it is one press. Reading a session back costs one cheap call, on your own key, for work you did not ask for, which is why this is off until you turn it on." />
          </div>
          <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
            After a conversation that worked something out, read it back and write the procedure
            down as a skill. Most conversations teach nothing and nothing is suggested for them.
          </div>
        </div>
        <Switch aria-label="Suggest skills" checked={on} disabled={saving} onCheckedChange={set} />
      </div>
    </div>
  );
}

function AboutCard() {
  const [version, setVersion] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateState>({ state: "idle" });

  useEffect(() => {
    void window.rooms?.appVersion?.().then(setVersion);
    void window.rooms?.updateState?.().then(setUpdate);
    return window.rooms?.onUpdateState?.(setUpdate);
  }, []);

  const line =
    update.state === "checking"
      ? "Checking…"
      : update.state === "downloading"
        ? `Downloading ${update.version ?? "the update"}${update.percent ? ` (${update.percent}%)` : ""}…`
        : update.state === "current"
          ? "You are on the latest version."
          : update.state === "ready"
            ? `${update.version ?? "An update"} is downloaded and ready.`
            : update.state === "error"
              ? "The update check didn't reach the server. It will retry on next launch."
              : update.state === "dev"
                ? "Updates apply to the installed app, not a dev build."
                : null;

  return (
    <div className="mt-4 rounded-[10px] border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="text-[13.5px] font-semibold text-foreground">
          Workmates {version ?? ""}
        </div>
        {update.state === "ready" ? (
          <Button size="sm" onClick={() => void window.rooms?.updateInstall?.()}>
            Restart to update
          </Button>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            disabled={!window.rooms || update.state === "checking" || update.state === "downloading"}
            onClick={() => void window.rooms?.updateCheck?.().then(setUpdate)}
          >
            Check for updates
          </Button>
        )}
      </div>
      {line && <div className="mt-1.5 text-[12.5px] text-muted-foreground">{line}</div>}
      <div className="mt-2 text-[12.5px] text-muted-foreground">
        Something broken, or missing?{" "}
        <a
          href={`https://github.com/Sidiora-Labs/workmates-ai/issues/new?body=${encodeURIComponent(`\n\n---\nWorkmates ${version ?? ""} on ${navigator.platform}`)}`}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2 hover:text-foreground"
        >
          Send feedback
        </a>
        {" "}(opens GitHub; paste the diagnostics below into anything gnarly).
      </div>
    </div>
  );
}

function Diagnostics() {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const copy = async () => {
    try {
      const report = await fetch("/api/diagnostics").then((r) => {
        if (!r.ok) throw new Error();
        return r.text();
      });
      await navigator.clipboard.writeText(report);
      setFailed(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setFailed(true);
    }
  };
  return (
    <div className="mt-4 rounded-[10px] border bg-card p-4">
      <div className="flex items-center gap-1.5 text-[13.5px] font-semibold text-foreground">
        Diagnostics
        <InfoTip text="The report holds versions, engine connection states, which keys are set as yes or no, and agent counts. Never the keys themselves, and the finished text is scrubbed for anything credential-shaped besides." />
      </div>
      <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
        Copies a short report about this install, ready to paste into a bug report.
      </div>
      <button
        onClick={() => void copy()}
        className="mt-3 rounded-xl border bg-background px-3 py-1.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-accent"
      >
        {copied ? "Copied" : "Copy diagnostics"}
      </button>
      {failed && (
        <div className="mt-2 text-[12px] text-destructive">
          Couldn't build the report. Is the server running?
        </div>
      )}
    </div>
  );
}

function AboutYou() {
  const { state, dispatch } = useStore();
  const saved = state.config?.profile?.about ?? "";
  const [value, setValue] = useState(saved);
  const [justSaved, setJustSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydrated = useRef(false);

  useEffect(() => {
    if (hydrated.current || !state.config) return;
    hydrated.current = true;
    setValue(saved);
  }, [state.config, saved]);

  const save = (next: string) => {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      api("/api/config", {
        method: "PUT",
        body: JSON.stringify({ profile: { about: next } }),
      })
        .then((status) => {
          dispatch({ type: "configStatus", config: status });
          setJustSaved(true);
          setTimeout(() => setJustSaved(false), 1600);
        })
        .catch(() => {});
    }, 600);
  };

  return (
    <div className="mt-4 rounded-[10px] border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="text-[13.5px] font-semibold text-foreground">About you</div>
        {justSaved && (
          <span className="flex items-center gap-1 text-[11.5px] text-success">
            <Check size={12} /> Saved
          </span>
        )}
      </div>
      <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
        Optional context every agent gets. Saved in your workspace.
      </div>
      <Textarea
        value={value}
        onChange={(e) => save(e.target.value)}
        placeholder="e.g. I'm a founder building a local-first agent app. Keep replies short and skip the preamble."
        className="mt-3 min-h-[88px] resize-none text-[13px]"
      />
    </div>
  );
}

function OpenAIKeyHint() {
  const { state, dispatch } = useStore();
  const speech = state.config?.speech;
  const sourceName = (s: "env" | "codex") =>
    s === "codex" ? "your Codex sign-in" : "your environment";

  const setConsent = (on: boolean) =>
    api("/api/config", {
      method: "PUT",
      body: JSON.stringify({ speech: { useDiscoveredOpenAI: on } }),
    })
      .then((status) => dispatch({ type: "configStatus", config: status }))
      .catch(() => {});

  if (speech?.openaiAvailable) {
    return (
      <div className="-mt-1 rounded-xl border border-warning/40 bg-warning/10 p-3">
        <div className="text-[12.5px] font-medium text-foreground">
          Found an OpenAI API key from {sourceName(speech.openaiAvailable)}
        </div>
        <div className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
          Workmates can use it for voices, which would bill that key's account per character
          spoken. Nothing is used until you say so.
        </div>
        <Button size="sm" className="mt-2" onClick={() => setConsent(true)}>
          Use that key for voices
        </Button>
      </div>
    );
  }
  if (speech?.openaiSource) {
    return (
      <div className="-mt-2 flex items-center gap-2 text-[11.5px] text-success">
        Using the API key from {sourceName(speech.openaiSource)} for voices.
        <button className="text-muted-foreground underline hover:text-foreground" onClick={() => setConsent(false)}>
          Stop using it
        </button>
      </div>
    );
  }
  return null;
}

const SETTINGS_TABS = [
  ["general", "General", TabGeneral, "bg-muted-foreground"],
  ["engines", "Engines", TabEngines, "bg-warning"],
  ["apps", "Apps", TabApps, "bg-brand-ink"],
  ["localvm", "Local VM", TabLocalVm, "bg-success"],
  ["voices", "Voices", TabVoices, "bg-destructive"],
  ["devices", "Devices", TabDevices, "bg-brand-ink"],
  ["rules", "Rules", TabRules, "bg-warning"],
  ["record", "Record", TabRecord, "bg-muted-foreground"],
] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number][0];

function QuickAskShortcut() {
  const [accelerator, setAccelerator] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/config")
      .then((r) => r.json())
      .then((c) => setAccelerator(c.shortcuts?.quickAsk ?? null))
      .catch(() => {});
  }, []);

  const save = async (next: string | null) => {
    setProblem(null);
    const took = (await window.rooms?.shortcutApply(next)) ?? null;
    if (next && !took) {
      setProblem("Another app already owns those keys. Try a different combination.");
      return;
    }
    setAccelerator(took);
    await fetch("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ shortcuts: { quickAsk: took } }),
    }).catch(() => {});
  };

  const capture = (e: React.KeyboardEvent) => {
    e.preventDefault();
    const key = e.key;
    if (key === "Escape") return setCapturing(false);
    if (["Shift", "Control", "Alt", "Meta"].includes(key)) return;
    const parts: string[] = [];
    if (e.metaKey) parts.push("Command");
    if (e.ctrlKey) parts.push("Control");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    if (parts.length === 0) {
      setProblem("A global shortcut needs at least one modifier, or it would fire while you type.");
      return;
    }
    parts.push(key.length === 1 ? key.toUpperCase() : key);
    setCapturing(false);
    void save(parts.join("+"));
  };

  if (!window.rooms) return null;

  return (
    <div className="mt-4 rounded-[10px] border bg-card p-4">
      <div className="text-[13.5px] font-semibold text-foreground">Quick ask</div>
      <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
        A shortcut that works anywhere on this Mac. It opens one line over whatever
        you are doing, sends it to an agent, and gets out of the way.
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => {
            setProblem(null);
            setCapturing(true);
          }}
          onKeyDown={capturing ? capture : undefined}
          className={cn(
            "min-w-[168px] rounded-xl border px-3 py-2 text-[13px] transition-colors",
            capturing
              ? "border-brand bg-brand-soft text-foreground"
              : "border-input text-foreground hover:border-foreground/25",
          )}
        >
          {capturing ? "Press the keys…" : (accelerator ?? "Not set")}
        </button>
        {accelerator && !capturing && (
          <button
            onClick={() => void save(null)}
            className="rounded-lg px-2 py-1 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>
      {problem && <div className="mt-2 text-[12px] text-destructive">{problem}</div>}
      <div className="mt-2 text-[11.5px] text-muted-foreground">
        Tab picks a different agent, Enter sends, Escape closes.
      </div>
    </div>
  );
}

export function AppSettingsPanel() {
  const { dispatch } = useStore();
  const { theme, setTheme } = useTheme();
  const [tab, setTab] = useState<SettingsTab>("general");

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && dispatch({ type: "toggleAppSettings", open: false })}
    >
      <DialogContent className="flex h-[85vh] max-h-[640px] w-full max-w-[720px] flex-col gap-0 overflow-hidden p-0">
        <div className="flex h-[52px] shrink-0 items-center border-b px-5">
          <DialogTitle className="text-[14.5px]">Settings</DialogTitle>
        </div>

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <nav
            className={cn(
              "flex shrink-0 gap-0.5 overflow-x-auto border-b p-2",
              "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
              "sm:w-[172px] sm:flex-col sm:overflow-x-visible sm:border-b-0 sm:border-r sm:bg-sidebar/60 sm:p-2",
            )}
          >
            {SETTINGS_TABS.map(([key, label, Icon, tile]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={cn(
                  "flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-[7px] px-2 py-[5px] text-[13px] transition-colors duration-150 sm:w-full sm:text-left",
                  tab === key
                    ? "bg-brand-ink font-medium text-brand-foreground"
                    : "text-foreground hover:bg-accent/60",
                )}
              >
                <span
                  className={cn(
                    "flex size-[22px] shrink-0 items-center justify-center rounded-[6px] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]",
                    tile,
                  )}
                >
                  <Icon size={13} strokeWidth={2.25} />
                </span>
                {label}
              </button>
            ))}
          </nav>

          <div className="min-w-0 flex-1 overflow-y-auto px-4 pb-6 sm:px-5">
            {tab === "general" && (
              <>
                <ServerConnectionCard />
                <div className="mt-4 rounded-[10px] border bg-card p-4">
                  <div className="text-[13.5px] font-semibold text-foreground">Appearance</div>
                  <div className="mt-0.5 text-[12.5px] text-muted-foreground">
                    How Workmates looks on this Mac
                  </div>
                  <div className="mt-3 flex gap-1 rounded-xl bg-muted p-1">
                    {THEME_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => setTheme(option.value)}
                        className={cn(
                          "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-[12.5px] transition-colors duration-150",
                          theme === option.value
                            ? "bg-background font-medium text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {option.icon}
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                <QuickAskShortcut />
                <Compaction />
                <ProposeSkills />
                <AboutYou />
                <Diagnostics />
                <AboutCard />
              </>
            )}

            {tab === "engines" && <EnginesPanel />}

            {tab === "apps" && (
              <>
              <div className="mt-4 rounded-[10px] border bg-card p-4">
                <div className="text-[13.5px] font-semibold text-foreground">Apps and computers</div>
                <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
                  Shared by all agents. Keys stay on {isRemoteServer() ? "your server" : "this computer"}.
                </div>
                <div className="mt-4 flex flex-col gap-4">
                  <ApiKeyRow
                    section="composio"
                    label="Composio Connect key"
                    placeholder="ck_…"
                    info={{
                      text: "Composio issues two different keys. This is the Connect key (starts with ck_), the one that links accounts like Slack and Gmail. The key is checked with Composio when you save it.",
                      linkLabel: "Get a Connect key at composio.dev",
                      linkHref: "https://composio.dev",
                    }}
                  />
                  <ApiKeyRow
                    section="composioApi"
                    label="Composio API key (optional)"
                    placeholder="ak_…  unlocks the full app catalog"
                    info={{
                      text: "The other Composio key: a project API key (starts with ak_), separate from the Connect key above. Only used to browse the full app catalog; connections work without it.",
                    }}
                  />
                  <ApiKeyRow
                    section="box"
                    label="Box API key"
                    placeholder="Paste your Box API key"
                    info={{
                      text: "Gives agents an isolated remote Linux computer with a desktop and a terminal. Box is a paid service after its trial, so usage can incur charges.",
                      linkLabel: "Open the Box API key guide",
                      linkHref: "https://docs.ascii.dev/box/api-keys",
                    }}
                  />
                </div>
              </div>
              <McpServersCard />
              </>
            )}

            {tab === "localvm" && <LocalVmSection />}

            {tab === "rules" && <RulesPanel />}

            {tab === "record" && <RecordPanel />}

            {tab === "devices" && (
              <>
                <DevicesSection />
                <TelegramSection />
                <CloudSection />
              </>
            )}

            {tab === "voices" && (
              <div className="mt-4 rounded-[10px] border bg-card p-4">
                <div className="text-[13.5px] font-semibold text-foreground">Voices</div>
                <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
                  Give agents a voice and take calls with them. Either key works.
                </div>
                <div className="mt-4 flex flex-col gap-4">
                  <ApiKeyRow section="elevenlabs" label="ElevenLabs API key" placeholder="sk_…" />
                  <ApiKeyRow section="openaiSpeech" label="OpenAI API key (speech)" placeholder="sk-…" />
                  <OpenAIKeyHint />
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

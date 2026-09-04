import { useEffect, useState } from "react";
import Loader2 from "lucide-react/dist/esm/icons/loader-2.mjs";
import { StoreProvider, useStore } from "@/state/store";
import { Onboarding } from "@/components/welcome/Onboarding";
import { Intro, introPending } from "@/components/welcome/Intro";
import { initAnalytics, setupDone, workspaceSetupDone } from "@/lib/analytics";
import { unreadCount } from "@/lib/unread";
import { Sidebar } from "@/components/workspace/Sidebar";
import { ChatView } from "@/components/chat/ChatView";
import { NewAgentScreen } from "@/components/agents/NewAgentScreen";
import { SettingsPanel } from "@/components/agents/SettingsPanel";
import { PluginsPanel } from "@/components/settings/PluginsPanel";
import { SkillsPanel } from "@/components/settings/SkillsPanel";
import { RoomView } from "@/components/rooms/RoomView";
import { NewRoomDialog } from "@/components/rooms/NewRoomDialog";
import { ComputerPanel } from "@/components/workspace/ComputerPanel";
import { AutomationsPanel } from "@/components/workspace/AutomationsPanel";
import { AppSettingsPanel } from "@/components/settings/AppSettingsPanel";
import { ProjectsPanel } from "@/components/workspace/ProjectsPanel";
import { ActivityPanel } from "@/components/workspace/Activity";
import { CommandPalette } from "@/components/workspace/CommandPalette";
import { QuickAsk } from "@/components/chat/QuickAsk";

function Shell() {
  const { state, dispatch } = useStore();
  const room = state.rooms.find((b) => b.id === state.selectedId);
  const bot = room
    ? null
    : (state.bots.find((b) => b.id === state.selectedId && !b.hidden) ??
      state.bots.find((b) => !b.hidden) ??
      null);

  const waiting = unreadCount(state.bots);
  useEffect(() => {
    window.rooms?.badgeSet?.(waiting);
  }, [waiting]);
  return (
    <div className="relative flex h-full min-w-0 flex-col overflow-hidden md:flex-row">
      <Sidebar />
      {state.routinesOpen ? (
        <AutomationsPanel onClose={() => dispatch({ type: "toggleRoutines", open: false })} />
      ) : room ? (
        <RoomView room={room} />
      ) : bot ? (
        <ChatView bot={bot} />
      ) : (
        <main className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
          <Loader2 size={20} className="animate-spin" />
          <div className="text-[14px]">
            {state.connected ? "No agents yet" : "Connecting to the Workmates server…"}
          </div>
          {!state.connected && (
            <div className="text-[12px]">
              Start it with <code className="rounded bg-muted px-1.5 py-0.5">pnpm dev:server</code>
            </div>
          )}
        </main>
      )}
      {state.settingsOpen && bot && <SettingsPanel bot={bot} />}
      {state.computerOpen && bot && <ComputerPanel bot={bot} />}
      {state.appSettingsOpen && <AppSettingsPanel />}
      {state.pluginsOpen && <PluginsPanel />}
      {state.skillsOpen && <SkillsPanel />}
      {state.newRoomOpen && <NewRoomDialog />}
      {state.newAgentOpen && <NewAgentScreen />}
      {state.projectsOpen && <ProjectsPanel />}
      {state.activityOpen && <ActivityPanel />}
      <CommandPalette />
    </div>
  );
}

export default function App() {
  if (new URLSearchParams(location.search).has("quick")) return <QuickAsk />;

  const forced = new URLSearchParams(location.search).has("intro");
  const [introOpen, setIntroOpen] = useState(
    () => (introPending() && !setupDone()) || forced,
  );
  const [setupOpen, setSetupOpen] = useState(() => !setupDone());
  const [settled, setSettled] = useState(() => introPending() && !setupDone());
  useEffect(() => {
    initAnalytics();
    void workspaceSetupDone()
      .then((done) => {
        if (forced) return;
        setIntroOpen(done ? false : introPending());
        setSetupOpen(!done);
      })
      .finally(() => setSettled(true));
  }, [forced]);
  if (!settled) return <div className="h-full bg-background" />;
  return (
    <StoreProvider>
      <Shell />
      {setupOpen && !introOpen && <Onboarding onDone={() => setSetupOpen(false)} />}
      {introOpen && <Intro onDone={() => setIntroOpen(false)} />}
    </StoreProvider>
  );
}

import { useEffect, useState, type ReactNode } from "react";
import type { ServerConnection } from "@/types/bridge";
import { Button } from "@/components/ui/button";

let remote = false;
export const isRemoteServer = () => remote;

function ConnectionForm({ status, problem, retry }: { status: ServerConnection; problem?: string; retry?: () => void }) {
  const [mode, setMode] = useState<"local" | "remote">(status.mode === "local" ? "local" : "remote");
  const [url, setUrl] = useState(status.url);
  const [token, setToken] = useState("");
  const [remember, setRemember] = useState(status.canRememberKey);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <form className="space-y-4" onSubmit={(event) => {
      event.preventDefault(); setSaving(true); setError("");
      void window.rooms?.configureServer({ mode, url, token, remember })
        .then(() => window.location.reload())
        .catch((reason) => setError(String(reason.message || reason).replace(/^Error invoking remote method '[^']+': Error: /, "")))
        .finally(() => setSaving(false));
    }}>
      <div><h2 className="text-lg font-semibold">Connect your workspace</h2>
        <p className="mt-1 text-sm text-muted-foreground">Choose where your agents run and your work is saved.</p></div>
      <div className="grid grid-cols-2 gap-2">
        {([['local', 'This computer'], ['remote', 'Cloud server']] as const).map(([value, label]) => (
          <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)}
            className={`rounded-lg border px-3 py-3 text-sm ${mode === value ? 'border-foreground bg-muted font-medium' : 'border-input text-muted-foreground'}`}>{label}</button>
        ))}
      </div>
      {mode === "remote" ? <>
        <label className="block text-sm">Server address
          <input className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2" type="url" required
            placeholder="https://your-server.up.railway.app" value={url} onChange={(event) => setUrl(event.target.value)} autoComplete="url" />
        </label>
        <label className="block text-sm">Server access key
          <input className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2" type="password"
            placeholder={status.configured && status.mode === "remote" ? "Leave blank to keep the saved key" : "Paste the key configured on your server"}
            value={token} onChange={(event) => setToken(event.target.value)} autoComplete="new-password" spellCheck={false} />
        </label>
        {status.canRememberKey ? <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />Remember the key in this computer’s secure storage
        </label> : <p className="text-xs text-muted-foreground">The key stays in memory for this session. Unlock your system keyring to remember it between restarts.</p>}
        <p className="text-xs leading-relaxed text-muted-foreground">Agents, credentials, and project files live on your server. Attachments are uploaded from this computer. Existing local work is kept here when you switch.</p>
      </> : <p className="text-sm text-muted-foreground">Run agents and keep workspace data on this computer.</p>}
      {(error || problem) && <p role="alert" className="text-sm text-destructive">{error || problem}</p>}
      <div className="flex gap-2"><Button type="submit" disabled={saving}>{saving ? "Connecting…" : "Connect workspace"}</Button>
        {retry && <Button type="button" variant="outline" disabled={saving} onClick={retry}>Retry connection</Button>}</div>
    </form>
  );
}

export function ServerConnectionCard() {
  const [status, setStatus] = useState<ServerConnection | null>(null);
  useEffect(() => { void window.rooms?.serverConnection?.().then(setStatus); }, []);
  if (!status) return null;
  return <div className="mt-4 rounded-[10px] border bg-card p-4"><ConnectionForm status={status} /></div>;
}

export function ServerConnectionGate({ children }: { children: ReactNode }) {
  const desktop = Boolean(window.rooms?.serverConnection);
  const [status, setStatus] = useState<ServerConnection | null>(null);
  const [ready, setReady] = useState(!desktop);
  const [problem, setProblem] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!desktop) return;
    let alive = true; setProblem("");
    void (async () => {
      try {
        const connection = await window.rooms!.serverConnection();
        if (!alive) return;
        remote = connection.mode === "remote"; setStatus(connection);
        if (!connection.configured) return;
        const response = await fetch("/api/health", { signal: AbortSignal.timeout(15_000) });
        const health = await response.json();
        if (!response.ok || health.app !== "workmates") throw new Error("Your Workmates server could not be reached.");
        if (remote && !health.authenticated) throw new Error("The server access key needs updating.");
        if (alive) setReady(true);
      } catch (error) { if (alive) setProblem(error instanceof Error ? error.message : "Could not connect to your workspace."); }
    })();
    return () => { alive = false; };
  }, [desktop, attempt]);
  if (ready) return children;
  return <main className="flex h-full items-center justify-center overflow-y-auto bg-background p-6 text-foreground">
    <div className="w-full max-w-md rounded-2xl border bg-card p-6"><div className="mb-6 text-sm font-semibold tracking-tight">Workmates</div>
      {status ? <ConnectionForm key={`${status.mode}:${attempt}`} status={status} problem={problem} retry={() => setAttempt((value) => value + 1)} /> :
        <p role={problem ? "alert" : "status"} className="text-sm text-muted-foreground">{problem || "Opening your workspace…"}</p>}
    </div>
  </main>;
}

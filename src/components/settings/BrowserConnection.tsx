import { useState } from "react";
import { Button } from "@/components/ui/button";

export function BrowserConnection({ problem, retry }: { problem?: string; retry: () => void }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <form className="space-y-4" onSubmit={(event) => {
    event.preventDefault(); setBusy(true); setError("");
    void fetch("/api/session", { method: "POST", headers: { authorization: `Bearer ${token.trim()}` } })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json()).error || "Could not sign in.");
        setToken(""); retry();
      }).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not reach your server."))
      .finally(() => setBusy(false));
  }}>
    <div><h1 className="text-xl font-semibold">Your workspace, anywhere</h1>
      <p className="mt-2 text-sm text-muted-foreground">Sign in to use the same agents, conversations, and files as your desktop app.</p></div>
    <label className="block text-sm">Server access key
      <input type="password" required value={token} onChange={(event) => setToken(event.target.value)}
        autoComplete="current-password" spellCheck={false} placeholder="Paste your server access key"
        className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-3 text-base" />
    </label>
    {(error || problem) && <p role="alert" className="text-sm text-destructive">{error || problem}</p>}
    <div className="flex flex-wrap gap-2"><Button disabled={busy} type="submit">{busy ? "Signing in…" : "Sign in"}</Button>
      <Button type="button" variant="outline" onClick={retry}>Retry connection</Button></div>
    <p className="text-xs leading-relaxed text-muted-foreground">Use your browser’s Install app or Add to Home Screen option to keep Workmates on your phone.</p>
  </form>;
}

export function BrowserConnectionCard() {
  const [error, setError] = useState("");
  return <div className="mt-4 space-y-3 rounded-[10px] border bg-card p-4">
    <h2 className="font-medium">Cloud workspace</h2>
    <p className="break-all text-sm text-muted-foreground">{window.location.origin}</p>
    <p className="text-sm text-muted-foreground">Your desktop app connects to this same address. To install on your phone, use Install app or Add to Home Screen in your browser.</p>
    <Button variant="outline" onClick={() => {
      void fetch("/api/session", { method: "DELETE" }).then((response) => {
        if (!response.ok) throw new Error("Could not sign out. Try again when connected.");
        window.location.reload();
      }).catch((reason) => setError(reason.message));
    }}>Sign out of this device</Button>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}

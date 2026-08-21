import { createHash, randomBytes } from "node:crypto";

const PENDING_TTL_MS = 10 * 60_000;

interface Pending {
  verifier: string;
  startedAt: number;
}

const pending = new Map<string, Pending>();

const base64url = (buf: Buffer) => buf.toString("base64url");

function sweep() {
  const now = Date.now();
  for (const [state, entry] of pending) {
    if (now - entry.startedAt > PENDING_TTL_MS) pending.delete(state);
  }
}

export interface OAuthProvider {
  kind: string;
  authorizeUrl(input: { challenge: string; callbackUrl: string; state: string }): string;
  exchange(input: { code: string; verifier: string; callbackUrl: string }): Promise<string>;
}

const OPENROUTER: OAuthProvider = {
  kind: "openrouter",
  authorizeUrl: ({ challenge, callbackUrl, state }) => {
    const params = new URLSearchParams({
      callback_url: `${callbackUrl}?state=${encodeURIComponent(state)}`,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    return `https://openrouter.ai/auth?${params}`;
  },
  exchange: async ({ code, verifier }) => {
    const res = await fetch("https://openrouter.ai/api/v1/auth/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
      signal: AbortSignal.timeout(20_000),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || !body?.key) {
      throw new Error(body?.error?.message ?? `OpenRouter returned HTTP ${res.status}`);
    }
    return String(body.key);
  },
};

const PROVIDERS: readonly OAuthProvider[] = [OPENROUTER];

export const supportsOAuth = (kind: string) => PROVIDERS.some((p) => p.kind === kind);

export function startOAuth(kind: string, callbackUrl: string): { url: string; state: string } {
  sweep();
  const provider = PROVIDERS.find((p) => p.kind === kind);
  if (!provider) throw Object.assign(new Error(`${kind} does not offer a browser sign-in`), { status: 400 });

  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(16));
  pending.set(state, { verifier, startedAt: Date.now() });
  return { url: provider.authorizeUrl({ challenge, callbackUrl, state }), state };
}

export async function finishOAuth(kind: string, state: string, code: string, callbackUrl: string) {
  sweep();
  const provider = PROVIDERS.find((p) => p.kind === kind);
  if (!provider) throw Object.assign(new Error(`unknown provider "${kind}"`), { status: 400 });
  const entry = pending.get(state);
  pending.delete(state);
  if (!entry) throw Object.assign(new Error("this sign-in expired, try again"), { status: 400 });
  return provider.exchange({ code, verifier: entry.verifier, callbackUrl });
}

export function callbackPage(ok: boolean, message: string): string {
  const tone = ok ? "#3bc76b" : "#f04438";
  return `<!doctype html><html><head><meta charset="utf-8"><title>Workmates</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
    font: 15px/1.6 ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif;
    background:#fff; color:#111 }
  @media (prefers-color-scheme: dark) { body { background:#0c0c0d; color:#f5f5f5 } }
  .card { max-width:26rem; padding:2rem; text-align:center }
  .dot { width:.6rem; height:.6rem; border-radius:99px; background:${tone}; display:inline-block; margin-right:.5rem }
  h1 { font-size:1.05rem; margin:0 0 .5rem }
  p { margin:0; opacity:.7 }
</style></head><body><div class="card">
<h1><span class="dot"></span>${ok ? "Connected" : "Could not connect"}</h1>
<p>${message}</p></div></body></html>`;
}

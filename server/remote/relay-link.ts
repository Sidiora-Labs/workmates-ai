import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";

import { deviceKey, open, peek, seal, type RelayRequest } from "./relay-crypto.ts";
import { pairedDevices } from "./pairing.ts";

const INTERNAL = randomBytes(32).toString("hex");
const RELAY_HEADER = "x-workmates-relay";
const DEVICE_HEADER = "x-workmates-relay-device";

export function relayDeviceFor(req: IncomingMessage): string | null {
  if (req.headers[RELAY_HEADER] !== INTERNAL) return null;
  const id = req.headers[DEVICE_HEADER];
  return typeof id === "string" && id ? id : null;
}

export interface RelayConfig {
  url: string;
  agentToken: string;
}

export interface RelayState {
  configured: boolean;
  connected: boolean;
  spaceId: string | null;
  problem: string | null;
  since: number | null;
}

const RETRY_MIN_MS = 2_000;
const RETRY_MAX_MS = 60_000;
const KEEPALIVE_MS = 30_000;
const WATCHDOG_MS = 60_000;
const REPLAY_WINDOW_MS = 120_000;

export class RelayLink {
  private config: RelayConfig | null = null;
  private controller: AbortController | null = null;
  private retry = RETRY_MIN_MS;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private generation = 0;
  private pushFailures = 0;
  private seenNonces = new Set<string>();
  private nonceSweep = 0;
  state: RelayState = { configured: false, connected: false, spaceId: null, problem: null, since: null };

  private readonly port: number;
  private readonly onChange: (state: RelayState) => void;

  constructor(port: number, onChange: (state: RelayState) => void = () => {}) {
    this.port = port;
    this.onChange = onChange;
  }

  configure(config: RelayConfig | null) {
    const same =
      this.config?.url === config?.url && this.config?.agentToken === config?.agentToken;
    if (same && !this.stopped) return;
    this.stop();
    this.config = config?.url && config?.agentToken ? config : null;
    this.state = {
      configured: Boolean(this.config),
      connected: false,
      spaceId: null,
      problem: null,
      since: null,
    };
    this.onChange(this.state);
    if (this.config) {
      this.stopped = false;
      void this.dial();
    }
  }

  stop() {
    this.stopped = true;
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.state.connected) {
      this.state = { ...this.state, connected: false, spaceId: null, since: null };
      this.onChange(this.state);
    }
  }

  publish(frame: unknown, wake?: string) {
    if (!this.config || !this.state.connected) return;
    const devices = pairedDevices();
    const frames = devices.map((d) => seal(deviceKey(d.hash, "mac-to-phone"), d.id, frame));
    void fetch(`${this.config.url}/space/agent/events`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ frames, ...(wake ? { wake } : {}) }),
      signal: AbortSignal.timeout(10_000),
    })
      .then((res) => {
        this.pushFailures = res.ok ? 0 : this.pushFailures + 1;
        if (this.pushFailures >= 4) this.controller?.abort();
      })
      .catch(() => {
        this.pushFailures++;
        if (this.pushFailures >= 4) this.controller?.abort();
      });
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.config!.agentToken}`,
      "content-type": "application/json",
    };
  }

  private rememberNonce(nonce: string) {
    this.seenNonces.add(nonce);
    if (Date.now() - this.nonceSweep > REPLAY_WINDOW_MS) {
      this.seenNonces = new Set([nonce]);
      this.nonceSweep = Date.now();
    }
  }

  private schedule() {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.dial(), this.retry);
    this.timer.unref?.();
    this.retry = Math.min(RETRY_MAX_MS, Math.round(this.retry * 1.8));
  }

  private setState(patch: Partial<RelayState>) {
    this.state = { ...this.state, ...patch };
    this.onChange(this.state);
  }

  private async dial() {
    if (this.stopped || !this.config) return;
    const gen = ++this.generation;
    const controller = new AbortController();
    this.controller = controller;
    let keepalive: ReturnType<typeof setInterval> | null = null;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    const clearTimers = () => {
      if (keepalive) clearInterval(keepalive);
      if (watchdog) clearTimeout(watchdog);
      keepalive = watchdog = null;
    };
    const alive = () => !this.stopped && gen === this.generation;
    try {
      const res = await fetch(`${this.config.url}/space/agent/stream`, {
        headers: { authorization: `Bearer ${this.config.agentToken}` },
        signal: controller.signal,
      });
      if (!alive()) return;
      if (!res.ok || !res.body) {
        if (res.status === 401 || res.status === 403) {
          this.setState({
            connected: false,
            problem: "The relay is not accepting this Mac yet. Retrying.",
          });
          this.retry = RETRY_MAX_MS;
          this.schedule();
          return;
        }
        throw new Error(`relay answered ${res.status}`);
      }

      this.setState({ connected: true, problem: null, since: Date.now() });
      this.pushFailures = 0;
      keepalive = setInterval(() => this.publish({ kind: "ping" }), KEEPALIVE_MS);
      keepalive.unref?.();

      const reader = res.body.getReader();
      const armWatchdog = () => {
        if (watchdog) clearTimeout(watchdog);
        watchdog = setTimeout(() => controller.abort(), WATCHDOG_MS);
        watchdog.unref?.();
      };
      armWatchdog();

      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (!alive()) return;
        if (done) break;
        armWatchdog();
        buffer += decoder.decode(value, { stream: true });
        if (buffer.length > 1_000_000) buffer = buffer.slice(-4096);
        let cut: number;
        while ((cut = buffer.indexOf("\n\n")) !== -1) {
          const chunk = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const line = chunk.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          let frame: any;
          try {
            frame = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }
          if (frame?.kind === "hello") {
            this.retry = RETRY_MIN_MS;
            this.setState({ spaceId: frame.spaceId ?? null });
          }
          if (frame?.kind === "ask" && typeof frame.id === "string") {
            void this.serve(frame.id, String(frame.payload ?? ""));
          }
        }
      }
      throw new Error("the relay closed the line");
    } catch (e) {
      if (!alive()) return;
      const problem = e instanceof Error ? e.message : "relay link failed";
      this.setState({ connected: false, spaceId: null, since: null, problem });
      this.schedule();
    } finally {
      clearTimers();
    }
  }

  private async serve(id: string, payload: string) {
    const envelope = peek(payload);
    const device = envelope ? pairedDevices().find((d) => d.id === envelope.d) : null;
    if (!envelope || !device) return void this.answer(id, 401, null, null, null);

    const readKey = deviceKey(device.hash, "phone-to-mac");
    const replyKey = deviceKey(device.hash, "mac-to-phone");
    const request = open(readKey, envelope) as RelayRequest | null;
    if (!request || typeof request.method !== "string" || typeof request.path !== "string") {
      return void this.answer(id, 400, null, replyKey, device.id);
    }
    const mutating = request.method !== "GET" && request.method !== "HEAD";
    if (mutating) {
      const fresh =
        typeof request.ts === "number" &&
        Math.abs(Date.now() - request.ts) <= REPLAY_WINDOW_MS &&
        typeof request.nonce === "string" &&
        request.nonce.length > 0;
      if (!fresh || this.seenNonces.has(request.nonce!)) {
        return void this.answer(id, 409, { error: "stale or replayed request" }, replyKey, device.id);
      }
      this.rememberNonce(request.nonce!);
    }
    if (!request.path.startsWith("/api/") || request.path.includes("..")) {
      return void this.answer(id, 404, { error: "no such route" }, replyKey, device.id);
    }

    try {
      const res = await fetch(`http://127.0.0.1:${this.port}${request.path}`, {
        method: request.method,
        headers: {
          "content-type": "application/json",
          origin: `http://127.0.0.1:${this.port}`,
          [RELAY_HEADER]: INTERNAL,
          [DEVICE_HEADER]: device.id,
        },
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: AbortSignal.timeout(15_000),
      });
      const text = await res.text();
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      this.answer(id, res.status, body, replyKey, device.id);
    } catch {
      this.answer(id, 502, { error: "the Mac could not answer that" }, replyKey, device.id);
    }
  }

  private answer(id: string, status: number, body: unknown, key: Buffer | null, deviceId: string | null) {
    if (!this.config) return;
    const payload = key && deviceId ? seal(key, deviceId, { status, body }) : "";
    void fetch(`${this.config.url}/space/agent/result`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ id, status, payload }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {});
  }
}

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { AppConfig } from "../core/config.ts";

export interface Voice {
  provider: "elevenlabs" | "openai";
  id: string;
  name: string;
}

export interface BotVoice {
  provider: "elevenlabs" | "openai";
  id: string;
  name?: string;
}

export const SPEAK_MAX_CHARS = 2_500;

const OPENAI_VOICES = [
  "alloy",
  "ash",
  "coral",
  "echo",
  "fable",
  "nova",
  "onyx",
  "sage",
  "shimmer",
].map((id) => ({
  provider: "openai" as const,
  id,
  name: id[0].toUpperCase() + id.slice(1),
}));

function discoveredOpenAIKey(): { key: string; source: "env" | "codex" } | null {
  if (process.env.OPENAI_API_KEY) return { key: process.env.OPENAI_API_KEY, source: "env" };
  try {
    const auth = JSON.parse(readFileSync(join(homedir(), ".codex", "auth.json"), "utf8"));
    if (typeof auth.OPENAI_API_KEY === "string" && auth.OPENAI_API_KEY) {
      return { key: auth.OPENAI_API_KEY, source: "codex" };
    }
  } catch {}
  return null;
}

function openaiKey(cfg: AppConfig): string | undefined {
  if (cfg.speech?.openaiKey) return cfg.speech.openaiKey;
  if (cfg.speech?.useDiscoveredOpenAI) return discoveredOpenAIKey()?.key;
  return undefined;
}

export function speechConfigured(cfg: AppConfig): {
  elevenlabs: boolean;
  openai: boolean;
  openaiSource?: "env" | "codex";
  openaiAvailable?: "env" | "codex";
} {
  const discovered = cfg.speech?.openaiKey ? null : discoveredOpenAIKey();
  const consented = Boolean(cfg.speech?.useDiscoveredOpenAI);
  return {
    elevenlabs: Boolean(cfg.speech?.elevenlabsKey),
    openai: Boolean(openaiKey(cfg)),
    ...(discovered && consented ? { openaiSource: discovered.source } : {}),
    ...(discovered && !consented ? { openaiAvailable: discovered.source } : {}),
  };
}

export async function listVoices(cfg: AppConfig): Promise<Voice[]> {
  const voices: Voice[] = [];
  if (cfg.speech?.elevenlabsKey) {
    try {
      const res = await fetch("https://api.elevenlabs.io/v1/voices", {
        headers: { "xi-api-key": cfg.speech.elevenlabsKey },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const body: any = await res.json();
        for (const v of body.voices ?? []) {
          if (typeof v?.voice_id === "string" && typeof v?.name === "string") {
            voices.push({ provider: "elevenlabs", id: v.voice_id, name: v.name });
          }
        }
      }
    } catch {
    }
  }
  if (openaiKey(cfg)) voices.push(...OPENAI_VOICES);
  return voices;
}

export async function speak(
  cfg: AppConfig,
  voice: BotVoice,
  text: string,
): Promise<{ stream: ReadableStream<Uint8Array>; mime: string }> {
  const clipped = text.slice(0, SPEAK_MAX_CHARS);
  if (voice.provider === "elevenlabs") {
    const key = cfg.speech?.elevenlabsKey;
    if (!key) throw new Error("no ElevenLabs key configured");
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice.id)}/stream?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": key, "content-type": "application/json" },
        body: JSON.stringify({
          text: clipped,
          model_id: "eleven_turbo_v2_5",
        }),
        signal: AbortSignal.timeout(60_000),
      },
    );
    if (!res.ok || !res.body) {
      throw new Error(`ElevenLabs refused: ${res.status} ${(await res.text().catch(() => "")).slice(0, 140)}`);
    }
    return { stream: res.body, mime: "audio/mpeg" };
  }

  const key = openaiKey(cfg);
  if (!key) throw new Error("no OpenAI speech key configured");
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice: voice.id,
      input: clipped,
      response_format: "mp3",
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok || !res.body) {
    throw new Error(`OpenAI speech refused: ${res.status} ${(await res.text().catch(() => "")).slice(0, 140)}`);
  }
  return { stream: res.body, mime: "audio/mpeg" };
}

export function parseBotVoice(raw: unknown): BotVoice | null | undefined {
  if (raw === null) return null;
  if (!raw || typeof raw !== "object") return undefined;
  const v = raw as Record<string, unknown>;
  if (v.provider !== "elevenlabs" && v.provider !== "openai") return undefined;
  if (typeof v.id !== "string" || !v.id || v.id.length > 120) return undefined;
  return {
    provider: v.provider,
    id: v.id,
    ...(typeof v.name === "string" ? { name: v.name.slice(0, 80) } : {}),
  };
}

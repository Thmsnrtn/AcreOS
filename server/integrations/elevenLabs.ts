/**
 * ElevenLabs voiceover integration — cloned founder voice for AcreOS ads.
 *
 * Voice clone setup (one-time, founder action):
 *   1. Founder records 1-3 min of clean audio (no background noise)
 *   2. Upload to ElevenLabs via their dashboard or POST /v1/voices/add
 *   3. Copy the resulting voiceId into Fly secret ELEVENLABS_FOUNDER_VOICE_ID
 *   4. The seeder picks up that env var on next deploy
 *
 * Until the voiceId is set, this module throws clear errors so the engine
 * fails loud — no silent fallback to a generic AI voice. Generic voices
 * are the single biggest quality regression we can ship; better to block
 * generation than to broadcast slop.
 *
 * Caching: identical script text + voice settings → same VO file. We hash
 * (text, voiceId, stability, similarityBoost) and short-circuit on cache
 * hit. Mostly a dev-loop optimization but also saves on regenerations
 * after founder rejection-with-script-edit.
 */

import crypto from "crypto";
import { logger } from "../utils/logger";
import { getStorage, type StoragePath } from "../services/cmo/storage";
import { estimateElevenLabsCostCents } from "../services/cmo/costTracker";

const ELEVEN_LABS_BASE_URL = "https://api.elevenlabs.io/v1";
const DEFAULT_MODEL_ID = "eleven_multilingual_v2"; // best quality for English at ~1 credit/char
// Output format: mp3_44100_128 (mp3 @ 44.1kHz, 128kbps stereo).
// Remotion can sync against MP3 directly; no need for WAV.
const DEFAULT_OUTPUT_FORMAT = "mp3_44100_128";

export interface VoiceSettings {
  voiceId: string;
  stability: number;       // 0-1. Higher = more consistent / less expressive
  similarityBoost: number; // 0-1. Higher = closer to source voice
}

export interface VoiceoverResult {
  storagePath: StoragePath;
  durationSec: number;
  charCount: number;
  costCents: number;
  cached: boolean;
}

function ensureApiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    throw new Error(
      "[cmo:voice] ELEVENLABS_API_KEY is not set. Provision an ElevenLabs Pro key " +
        "and `fly secrets set ELEVENLABS_API_KEY=...` before generating voiceovers.",
    );
  }
  return key;
}

function ensureVoiceId(settings: VoiceSettings): string {
  if (!settings.voiceId) {
    throw new Error(
      "[cmo:voice] no voiceId set on brand profile. " +
        "Clone the founder voice in ElevenLabs, then set ELEVENLABS_FOUNDER_VOICE_ID " +
        "(picked up by the brand profile seeder) or update the brand_profiles row directly.",
    );
  }
  return settings.voiceId;
}

function cacheKey(text: string, settings: VoiceSettings): string {
  const h = crypto.createHash("sha256");
  h.update(text);
  h.update("|");
  h.update(settings.voiceId);
  h.update("|");
  h.update(String(settings.stability));
  h.update("|");
  h.update(String(settings.similarityBoost));
  return h.digest("hex").slice(0, 16);
}

/**
 * Generate a voiceover MP3 from text via ElevenLabs.
 *
 * Returns the storage path of the resulting MP3 plus duration estimate and
 * cost. If the same text+settings was rendered before in this storage,
 * returns the cached path with `cached: true` and zero cost.
 */
export async function generateVoiceover(
  text: string,
  settings: VoiceSettings,
  outputKey: string,
): Promise<VoiceoverResult> {
  const apiKey = ensureApiKey();
  const voiceId = ensureVoiceId(settings);
  const storage = getStorage();

  const cacheBucketKey = `voice-cache/${cacheKey(text, settings)}.mp3`;
  if (await storage.exists(`local:${cacheBucketKey}` as StoragePath)) {
    logger.info(`[cmo:voice] cache hit for ${cacheBucketKey.slice(0, 30)}…`);
    return {
      storagePath: `local:${cacheBucketKey}` as StoragePath,
      durationSec: estimateDurationSec(text),
      charCount: text.length,
      costCents: 0,
      cached: true,
    };
  }

  const response = await fetch(
    `${ELEVEN_LABS_BASE_URL}/text-to-speech/${voiceId}?output_format=${DEFAULT_OUTPUT_FORMAT}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: DEFAULT_MODEL_ID,
        voice_settings: {
          stability: settings.stability,
          similarity_boost: settings.similarityBoost,
        },
      }),
    },
  );

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    throw new Error(`[cmo:voice] ElevenLabs returned ${response.status}: ${errBody.slice(0, 200)}`);
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());

  // Write to cache (for dedupe) AND the canonical output location.
  await storage.write(cacheBucketKey, audioBuffer);
  const outputPath = await storage.write(outputKey, audioBuffer);

  const charCount = text.length;
  const costCents = estimateElevenLabsCostCents(charCount);
  const durationSec = estimateDurationSec(text);

  logger.info(`[cmo:voice] generated ${charCount}ch ≈ ${durationSec}s ≈ ${(costCents / 100).toFixed(3)}USD`);

  return {
    storagePath: outputPath,
    durationSec,
    charCount,
    costCents,
    cached: false,
  };
}

/**
 * Spoken English averages ~150 words per minute = ~5 words / 2.5 chars per
 * second. Rough estimate; Remotion can read the actual MP3 duration at
 * compose time if exact sync is needed.
 */
function estimateDurationSec(text: string): number {
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return Math.max(2, Math.round((wordCount / 150) * 60));
}

/**
 * Health probe — returns true iff the API key validates against ElevenLabs.
 * Used by /api/health to surface "voice unavailable" before the founder
 * tries to render.
 */
export async function checkElevenLabsHealth(): Promise<{ ok: boolean; latencyMs?: number; message?: string }> {
  if (!process.env.ELEVENLABS_API_KEY) {
    return { ok: false, message: "ELEVENLABS_API_KEY not set" };
  }
  const start = Date.now();
  try {
    const response = await fetch(`${ELEVEN_LABS_BASE_URL}/user`, {
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY },
    });
    const latencyMs = Date.now() - start;
    if (!response.ok) {
      return { ok: false, latencyMs, message: `HTTP ${response.status}` };
    }
    return { ok: true, latencyMs };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "unknown error" };
  }
}

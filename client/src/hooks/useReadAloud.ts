/**
 * useReadAloud — browser-native text-to-speech via window.speechSynthesis.
 *
 * Phase 1 of read-aloud (Phase 2 Week 3 of _ACTION-PLAN). Free, no API
 * cost, runs in-browser. Phase 2 (Week 19-20) upgrades to streaming TTS
 * via ElevenLabs / OpenAI tts-1 — when that lands, this hook keeps the
 * same surface and the implementation flips under the hood.
 *
 * Beck §2, Tobias §2, Mavis §2, Tariq §1 flagged this as the minimum
 * accessibility bar before launch — every Pax response and every legal
 * document on screen must be readable aloud.
 *
 *   const { speak, stop, isSpeaking, isAvailable } = useReadAloud();
 *   if (isAvailable) <ReadAloudButton text={msg.content} />;
 *
 * User preferences (rate, voice URI) persist in localStorage under the
 * "read-aloud:*" namespace so they survive a refresh.
 */
import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY_RATE = "read-aloud:rate";
const STORAGE_KEY_VOICE = "read-aloud:voice";

export interface ReadAloudOptions {
  rate?: number;
  voice?: string; // SpeechSynthesisVoice.voiceURI
}

export interface UseReadAloudReturn {
  speak: (text: string, opts?: ReadAloudOptions) => void;
  stop: () => void;
  isSpeaking: boolean;
  isAvailable: boolean;
  voices: SpeechSynthesisVoice[];
  preferredRate: number;
  preferredVoice: string | null;
  setPreferredRate: (rate: number) => void;
  setPreferredVoice: (voiceURI: string | null) => void;
}

function readNumber(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function readString(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // private-mode / quota exceeded — silently drop
  }
}

/**
 * Pick a sensible default voice — preferring the user's preferred URI if
 * it's still available, else a high-quality English voice, else the first
 * voice the platform offers.
 */
function pickDefaultVoice(
  voices: SpeechSynthesisVoice[],
  preferredURI: string | null,
): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  if (preferredURI) {
    const match = voices.find((v) => v.voiceURI === preferredURI);
    if (match) return match;
  }
  // Prefer en-US default, then any en-* default, then first en-*, then first.
  const enUSDefault = voices.find((v) => v.default && v.lang === "en-US");
  if (enUSDefault) return enUSDefault;
  const enDefault = voices.find((v) => v.default && v.lang.startsWith("en"));
  if (enDefault) return enDefault;
  const firstEn = voices.find((v) => v.lang.startsWith("en"));
  if (firstEn) return firstEn;
  return voices[0];
}

export function useReadAloud(): UseReadAloudReturn {
  const isAvailable =
    typeof window !== "undefined" && "speechSynthesis" in window;

  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [preferredRate, setPreferredRateState] = useState<number>(() =>
    readNumber(STORAGE_KEY_RATE, 1),
  );
  const [preferredVoice, setPreferredVoiceState] = useState<string | null>(() =>
    readString(STORAGE_KEY_VOICE),
  );
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Voices populate asynchronously on most platforms — Chrome fires
  // "voiceschanged" once they're ready. Read both immediately and on the
  // event so we cover Safari (sync) and Chrome (async).
  useEffect(() => {
    if (!isAvailable) return;
    const synth = window.speechSynthesis;
    const sync = () => setVoices(synth.getVoices());
    sync();
    synth.addEventListener("voiceschanged", sync);
    return () => synth.removeEventListener("voiceschanged", sync);
  }, [isAvailable]);

  // If the tab unmounts mid-speech, cancel — leaving an utterance running
  // after navigation is jarring and breaks the "stop reading" affordance.
  useEffect(() => {
    if (!isAvailable) return;
    return () => {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    };
  }, [isAvailable]);

  const setPreferredRate = useCallback((rate: number) => {
    const clamped = Math.max(0.5, Math.min(2, rate));
    setPreferredRateState(clamped);
    writeStorage(STORAGE_KEY_RATE, String(clamped));
  }, []);

  const setPreferredVoice = useCallback((voiceURI: string | null) => {
    setPreferredVoiceState(voiceURI);
    writeStorage(STORAGE_KEY_VOICE, voiceURI);
  }, []);

  const stop = useCallback(() => {
    if (!isAvailable) return;
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
    utteranceRef.current = null;
    setIsSpeaking(false);
  }, [isAvailable]);

  const speak = useCallback(
    (text: string, opts?: ReadAloudOptions) => {
      if (!isAvailable) return;
      const trimmed = text?.trim();
      if (!trimmed) return;

      // Always cancel any in-flight utterance before starting a new one —
      // queuing "speaks" produces stuttery overlap on Safari.
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }

      const utter = new SpeechSynthesisUtterance(trimmed);
      utter.rate = opts?.rate ?? preferredRate;

      const targetVoiceURI = opts?.voice ?? preferredVoice;
      const chosen = pickDefaultVoice(voices, targetVoiceURI);
      if (chosen) {
        utter.voice = chosen;
        utter.lang = chosen.lang;
      }

      utter.onstart = () => setIsSpeaking(true);
      utter.onend = () => {
        if (utteranceRef.current === utter) {
          utteranceRef.current = null;
          setIsSpeaking(false);
        }
      };
      utter.onerror = () => {
        if (utteranceRef.current === utter) {
          utteranceRef.current = null;
          setIsSpeaking(false);
        }
      };

      utteranceRef.current = utter;
      try {
        window.speechSynthesis.speak(utter);
      } catch {
        utteranceRef.current = null;
        setIsSpeaking(false);
      }
    },
    [isAvailable, preferredRate, preferredVoice, voices],
  );

  return {
    speak,
    stop,
    isSpeaking,
    isAvailable,
    voices,
    preferredRate,
    preferredVoice,
    setPreferredRate,
    setPreferredVoice,
  };
}

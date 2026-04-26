/**
 * Sound effect hook.
 *
 * Replaces the prototype's `window.__playSound(kind)` and `window.__r3SoundOn`
 * globals (HANDOFF.md §4). Per founder decisions: off by default, respects
 * `prefers-reduced-motion`, user-toggleable in Settings → Preferences.
 *
 * Until the settings store is wired up in Phase 6 (Settings), this hook reads
 * the `acreos-sound-enabled` localStorage key as a placeholder. Setting that
 * key to "true" enables sound. Server-backed preferences will replace this
 * mechanism without changing the hook's public API.
 *
 * Audio file loading and playback is a stub for now — Phase 2 Shell adds
 * actual sounds for command-palette open, deal-closed celebration, etc.
 */
import { useEffect, useState } from "react";

export type SoundKind =
  | "tick"
  | "chime"
  | "pop"
  | "success"
  | "error";

const STORAGE_KEY = "acreos-sound-enabled";

function readEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function useSound() {
  const [enabled, setEnabledState] = useState<boolean>(() => readEnabled());

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setEnabledState(readEnabled());
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const reduced = prefersReducedMotion();

  const play = (_kind: SoundKind) => {
    if (!enabled || reduced) return;
    // Stub: actual audio playback wires up alongside the audio asset bundle
    // in Phase 2 Shell. The shape (kind dispatch) is locked here so consumers
    // don't have to change when audio lands.
  };

  const setEnabled = (next: boolean) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "true" : "false");
    } catch {
      // ignore storage failure (private mode, quota)
    }
    setEnabledState(next);
  };

  return {
    enabled: enabled && !reduced,
    reducedMotion: reduced,
    play,
    setEnabled,
  };
}

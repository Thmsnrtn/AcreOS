/**
 * useReadAloudPrefs — user-facing preferences for the read-aloud feature.
 *
 * Split out of useReadAloud so the button, settings panel, and any
 * auto-read effect share a single localStorage-backed source of truth.
 * Cross-tab updates are reflected via the "storage" event listener so
 * toggling the preference in /settings/accessibility immediately hides
 * existing buttons elsewhere in the app.
 *
 * Phase 2 may move these to a server-backed UserPreference table — when
 * it does, the surface here stays the same.
 */
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY_SHOW = "read-aloud:show-buttons";
const STORAGE_KEY_AUTO = "read-aloud:auto-read-pax";

function readBool(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    return raw === "true";
  } catch {
    return fallback;
  }
}

function writeBool(key: string, value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value ? "true" : "false");
  } catch {
    // ignore (private mode / quota)
  }
}

export interface UseReadAloudPrefsReturn {
  showButtons: boolean;
  autoReadPax: boolean;
  setShowButtons: (next: boolean) => void;
  setAutoReadPax: (next: boolean) => void;
}

export function useReadAloudPrefs(): UseReadAloudPrefsReturn {
  const [showButtons, setShowButtonsState] = useState<boolean>(() =>
    readBool(STORAGE_KEY_SHOW, true),
  );
  const [autoReadPax, setAutoReadPaxState] = useState<boolean>(() =>
    readBool(STORAGE_KEY_AUTO, false),
  );

  // Cross-tab sync — if the user toggles the pref in another tab, mirror
  // it here so existing buttons hide/show without a refresh.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === STORAGE_KEY_SHOW) {
        setShowButtonsState(ev.newValue !== "false");
      } else if (ev.key === STORAGE_KEY_AUTO) {
        setAutoReadPaxState(ev.newValue === "true");
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setShowButtons = useCallback((next: boolean) => {
    setShowButtonsState(next);
    writeBool(STORAGE_KEY_SHOW, next);
  }, []);

  const setAutoReadPax = useCallback((next: boolean) => {
    setAutoReadPaxState(next);
    writeBool(STORAGE_KEY_AUTO, next);
  }, []);

  return { showButtons, autoReadPax, setShowButtons, setAutoReadPax };
}

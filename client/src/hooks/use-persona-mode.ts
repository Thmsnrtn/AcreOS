/**
 * usePersonaMode — Atlas-vs-customer navigation switcher.
 *
 * Tom's #1 nav pain: "I am able to navigate into the founder dashboard
 * but once I'm there I have to hit back a bunch to leave it." This hook
 * gives every persona-switch surface (header dropdown, keyboard
 * shortcut, mobile sheet, Atlas tool) a single source of truth.
 *
 * Behavior:
 *   - mode is inferred from the current path (`/founder/*` → "founder",
 *     anything else → "customer") on every render, so the UI tracks
 *     actual location even if something else navigated.
 *   - The selected mode is mirrored to `localStorage['acr.persona-mode']`
 *     so a hard refresh on /today doesn't visually flip the toggle
 *     before the path resolves.
 *   - setMode("customer") navigates to /today; setMode("founder") to
 *     /founder. Both via wouter's useLocation so the SPA router stays
 *     in control (no full page reload).
 *
 * Pure helpers below are exported for unit-test coverage without
 * needing a renderer.
 */
import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";

export type PersonaMode = "founder" | "customer";

export const PERSONA_MODE_STORAGE_KEY = "acr.persona-mode";

/** Default landing path for each mode — also the navigation target. */
export const PERSONA_MODE_PATHS: Record<PersonaMode, string> = {
  founder: "/founder",
  customer: "/today",
};

/**
 * Pure: derive the current mode from a URL path.
 * `/founder` or `/founder/*` → "founder", anything else → "customer".
 */
export function inferModeFromPath(path: string): PersonaMode {
  if (path === "/founder" || path.startsWith("/founder/")) return "founder";
  return "customer";
}

/**
 * Pure: read the persisted mode from localStorage. Returns null if
 * nothing valid is stored (the caller then falls back to path inference).
 */
export function readStoredMode(): PersonaMode | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(PERSONA_MODE_STORAGE_KEY);
    if (raw === "founder" || raw === "customer") return raw;
    return null;
  } catch {
    // Safari private mode / disabled storage — fall back to path.
    return null;
  }
}

/** Pure: persist mode. Swallow storage errors (private mode etc.). */
export function writeStoredMode(mode: PersonaMode): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PERSONA_MODE_STORAGE_KEY, mode);
  } catch {
    /* noop */
  }
}

/**
 * Pure: should we suppress a keyboard shortcut because the user is
 * actively typing? Targets that count as "typing" are inputs, textareas,
 * and contenteditable elements. Used by both the global Cmd+; binding
 * and by anywhere else that wants the same gate.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  // isContentEditable is the canonical check, but jsdom doesn't reflect
  // it; fall back to the attribute so the same code path works in tests
  // and in real browsers (the attribute check is also a correct read
  // for nested contenteditable subtrees in actual browsers).
  if (target.isContentEditable) return true;
  const ce = target.getAttribute("contenteditable");
  if (ce !== null && ce !== "false") return true;
  return false;
}

export interface UsePersonaModeReturn {
  mode: PersonaMode;
  setMode: (next: PersonaMode) => void;
  toggle: () => void;
}

export function usePersonaMode(): UsePersonaModeReturn {
  const [location, navigate] = useLocation();

  // Mode is path-derived on every render so the UI stays consistent with
  // whatever wouter says. localStorage is only a hint for the very first
  // paint after a hard refresh (handled by the effect below).
  const mode: PersonaMode = inferModeFromPath(location);

  // On mount, reconcile: if a stored mode disagrees with the path, the
  // path wins (path is the source of truth) but we re-write storage so
  // the next refresh matches. This also handles the very first visit
  // where nothing is stored yet.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (hydrated) return;
    setHydrated(true);
    const stored = readStoredMode();
    if (stored !== mode) writeStoredMode(mode);
  }, [hydrated, mode]);

  const setMode = useCallback(
    (next: PersonaMode) => {
      writeStoredMode(next);
      if (next === mode) return;
      navigate(PERSONA_MODE_PATHS[next]);
    },
    [mode, navigate],
  );

  const toggle = useCallback(() => {
    const next: PersonaMode = mode === "founder" ? "customer" : "founder";
    setMode(next);
  }, [mode, setMode]);

  return { mode, setMode, toggle };
}

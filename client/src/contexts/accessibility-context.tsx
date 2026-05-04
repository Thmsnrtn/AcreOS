import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useLocalStorageState } from "@/hooks/use-local-storage-state";

/**
 * Accessibility & comfort preferences (Wave B accommodations).
 *
 * Phase 4 Week 23-26 — covers:
 *   • Beck §2-§4  — Lexend pairing + reading density (compact/comfortable/spacious)
 *   • Tobias §1   — cognitive-a11y mode (more time, less density)
 *   • Mavis §1    — older-user mode (larger taps, button shadows)
 *   • Earl §1     — picture-first parcel cards
 *   • Yelena §1   — focus mode + quiet hours
 *
 * Persistence: localStorage (per-browser). When user is logged in, a sync
 * hook (`use-sync-accessibility-prefs`) mirrors changes to `/api/user/preferences`
 * so the choice carries across devices.
 *
 * The provider attaches matching `data-*` attributes to `<html>`, which feed
 * the global CSS rules in `index.css` (font-family swap, line-height ramp,
 * tap-target floor, button shadow, etc.). Components can also read the
 * preferences directly via `useAccessibility()`.
 */

export type ReadingDensity = "compact" | "comfortable" | "spacious";
export type FontFamily = "system" | "lexend";

export interface QuietHours {
  enabled: boolean;
  /** 24h format, e.g. "22:00" */
  start: string;
  /** 24h format, e.g. "07:00" */
  end: string;
}

export interface AccessibilityPrefs {
  /** Lexend (dyslexia-friendly) vs system. */
  fontFamily: FontFamily;
  /** Reading density — drives line-height + font-size scale. */
  readingDensity: ReadingDensity;
  /** Cognitive a11y: extends form timeouts, reduces UI density. */
  cognitiveA11yMode: boolean;
  /** Older-user mode: tap targets 56px+, +2pt button text, button shadows. */
  largerTapsMode: boolean;
  /** Picture-first parcel cards (Earl §1). */
  pictureFirstParcels: boolean;
  /** Focus mode: hide notifications + bell + Pax rail until next break. */
  focusMode: boolean;
  /** Enforced quiet hours: no toasts/email/SMS in window. */
  quietHours: QuietHours;
  /** Reduced motion (mirrors prefers-reduced-motion when undefined). */
  reduceMotion: boolean | "system";
}

const DEFAULTS: AccessibilityPrefs = {
  fontFamily: "system",
  readingDensity: "comfortable",
  cognitiveA11yMode: false,
  largerTapsMode: false,
  pictureFirstParcels: false,
  focusMode: false,
  quietHours: { enabled: false, start: "22:00", end: "07:00" },
  reduceMotion: "system",
};

interface AccessibilityContextValue {
  prefs: AccessibilityPrefs;
  setPrefs: (next: Partial<AccessibilityPrefs>) => void;
  reset: () => void;
  /** True if the current local time is within the user's quiet-hours window. */
  isQuietNow: boolean;
  /** Effective form timeout multiplier (1× normal; 6× when cognitiveA11yMode). */
  timeoutMultiplier: number;
}

const AccessibilityContext = createContext<AccessibilityContextValue | null>(null);

const LS_KEY = "acreos:accessibility-prefs:v1";

function isQuietHoursActive(qh: QuietHours, now = new Date()): boolean {
  if (!qh.enabled) return false;
  const [sh, sm] = qh.start.split(":").map(Number);
  const [eh, em] = qh.end.split(":").map(Number);
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  // Window may cross midnight (e.g. 22:00 → 07:00).
  if (startMin <= endMin) {
    return minutesNow >= startMin && minutesNow < endMin;
  }
  return minutesNow >= startMin || minutesNow < endMin;
}

export function AccessibilityProvider({ children }: { children: ReactNode }) {
  const [prefs, setRaw] = useLocalStorageState<AccessibilityPrefs>(LS_KEY, DEFAULTS);

  const setPrefs = (next: Partial<AccessibilityPrefs>) => {
    setRaw((prev) => ({ ...prev, ...next }));
  };

  const reset = () => setRaw(DEFAULTS);

  // Reflect prefs onto <html data-*> for CSS hooks.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-font", prefs.fontFamily);
    root.setAttribute("data-density", prefs.readingDensity);
    root.toggleAttribute("data-cognitive-a11y", prefs.cognitiveA11yMode);
    root.toggleAttribute("data-larger-taps", prefs.largerTapsMode);
    root.toggleAttribute("data-picture-first", prefs.pictureFirstParcels);
    root.toggleAttribute("data-focus-mode", prefs.focusMode);
  }, [prefs]);

  const isQuietNow = useMemo(() => isQuietHoursActive(prefs.quietHours), [prefs.quietHours]);

  // Cognitive a11y stretches form-completion timers from 5 min → 30 min.
  const timeoutMultiplier = prefs.cognitiveA11yMode ? 6 : 1;

  const value = useMemo(
    () => ({ prefs, setPrefs, reset, isQuietNow, timeoutMultiplier }),
    // setPrefs and reset are stable (closure over setRaw); only re-emit on data change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prefs, isQuietNow, timeoutMultiplier],
  );

  return <AccessibilityContext.Provider value={value}>{children}</AccessibilityContext.Provider>;
}

export function useAccessibility(): AccessibilityContextValue {
  const ctx = useContext(AccessibilityContext);
  if (!ctx) {
    // Safe fallback so components don't crash if the provider is missing
    // (e.g. in stories/tests). Returns defaults; setters become no-ops.
    return {
      prefs: DEFAULTS,
      setPrefs: () => {},
      reset: () => {},
      isQuietNow: false,
      timeoutMultiplier: 1,
    };
  }
  return ctx;
}

/**
 * Convenience: should we suppress this notification right now?
 * Honors both focusMode and quietHours.
 */
export function useShouldSuppressNotification(): boolean {
  const { prefs, isQuietNow } = useAccessibility();
  return prefs.focusMode || isQuietNow;
}

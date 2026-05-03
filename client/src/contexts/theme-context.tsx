import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { clientLogger } from "@/lib/clientLogger";

/**
 * Theme system — five themes × light/dark + five font pairings.
 *
 * Spec: docs/exhaustive-completion/prototype-design-system.md (§3 themes,
 * §4 type pairings, §0.2 Phase B locked decisions).
 *
 * Apple-native auto semantics: when the user explicitly picks `light` or
 * `dark`, manual selection wins until they explicitly choose `auto`. OS
 * `prefers-color-scheme` changes do not flip the app under a manual pick.
 */

export type ThemeId = "homestead" | "quarry" | "nocturne" | "meadow" | "slate";
export type ThemeMode = "light" | "dark" | "auto";
export type FontPairing = "editorial" | "modern" | "classic" | "native" | "refined";
export type Density = "compact" | "comfortable" | "adaptive";
export type MotionPreference = "full" | "reduced";

export const THEME_IDS: ThemeId[] = ["homestead", "quarry", "nocturne", "meadow", "slate"];
export const FONT_PAIRINGS: FontPairing[] = ["editorial", "modern", "classic", "native", "refined"];
export const DENSITIES: Density[] = ["compact", "comfortable", "adaptive"];
export const MOTION_PREFERENCES: MotionPreference[] = ["full", "reduced"];

export interface ThemeConfig {
  theme: ThemeId;
  mode: ThemeMode;
  fontPairing: FontPairing;
  density: Density;
  motion: MotionPreference;
}

function getInitialMotion(): MotionPreference {
  if (typeof window === "undefined") return "full";
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "reduced" : "full";
}

const DEFAULT_CONFIG: ThemeConfig = {
  theme: "homestead",
  mode: "auto",
  fontPairing: "editorial",
  density: "adaptive",
  motion: "full",
};

const STORAGE_KEY = "acreos-theme-config";
const LEGACY_LIGHTDARK_KEY = "acreos-theme";

interface ThemeContextValue {
  themeConfig: ThemeConfig;
  setThemeConfig: (config: Partial<ThemeConfig>) => void;
  resolvedMode: "light" | "dark";
  // Legacy compat — kept for theme-toggle.tsx and any other consumer that
  // expects the simpler light/dark API. Do not extend; new code should use
  // themeConfig + setThemeConfig directly.
  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark") => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function getSystemPreference(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function loadStoredConfig(): ThemeConfig {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<ThemeConfig> & {
        // Legacy field names from the pre-port theme system.
        preset?: string;
        accent?: string;
      };
      const next: ThemeConfig = { ...DEFAULT_CONFIG };
      if (parsed.theme && (THEME_IDS as readonly string[]).includes(parsed.theme)) {
        next.theme = parsed.theme;
      }
      // Migrate legacy "system" mode value → "auto" (semantic rename).
      const m = parsed.mode as string | undefined;
      if (m === "light" || m === "dark" || m === "auto") next.mode = m;
      else if (m === "system") next.mode = "auto";
      if (parsed.fontPairing && (FONT_PAIRINGS as readonly string[]).includes(parsed.fontPairing)) {
        next.fontPairing = parsed.fontPairing;
      }
      if (parsed.density && (DENSITIES as readonly string[]).includes(parsed.density)) {
        next.density = parsed.density;
      }
      if (parsed.motion && (MOTION_PREFERENCES as readonly string[]).includes(parsed.motion)) {
        next.motion = parsed.motion;
      } else {
        // First load with no stored motion pref — honor OS prefers-reduced-motion.
        next.motion = getInitialMotion();
      }
      return next;
    }
    // Migrate from very-old "acreos-theme" light|dark key.
    const legacy = localStorage.getItem(LEGACY_LIGHTDARK_KEY) as "light" | "dark" | null;
    if (legacy) return { ...DEFAULT_CONFIG, mode: legacy, motion: getInitialMotion() };
  } catch {
    // localStorage unavailable / malformed — fall through to defaults.
  }
  return { ...DEFAULT_CONFIG, motion: getInitialMotion() };
}

/**
 * Server preferences sync — fetch on mount, debounced PATCH on change.
 * The local state remains canonical; failures log silently (per design-system
 * §0.2 + B.5 spec) and never block UI. localStorage hydration runs first to
 * avoid a flash; the server fetch overwrites only if it returns valid prefs.
 */
const PREFERENCES_ENDPOINT = "/api/me/preferences";
const PATCH_DEBOUNCE_MS = 300;

async function fetchServerPreferences(): Promise<Partial<ThemeConfig> | null> {
  try {
    const res = await fetch(PREFERENCES_ENDPOINT, { credentials: "include" });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<ThemeConfig>;
    return data;
  } catch {
    return null;
  }
}

async function patchServerPreferences(update: Partial<ThemeConfig>): Promise<void> {
  try {
    await fetch(PREFERENCES_ENDPOINT, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    clientLogger.warn("[theme] PATCH /api/me/preferences failed; local state retained", err);
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeConfig, setThemeConfigState] = useState<ThemeConfig>(loadStoredConfig);
  const pendingPatchRef = useRef<Partial<ThemeConfig>>({});
  const patchTimerRef = useRef<number | undefined>(undefined);

  const resolvedMode: "light" | "dark" =
    themeConfig.mode === "auto" ? getSystemPreference() : themeConfig.mode;

  // Hydrate from server on mount — server preferences (if available) win
  // over localStorage for cross-device consistency. If the user is
  // unauthenticated or the endpoint errors, local state stays as-is.
  useEffect(() => {
    let cancelled = false;
    fetchServerPreferences().then((server) => {
      if (cancelled || !server) return;
      setThemeConfigState((local) => {
        const next: ThemeConfig = { ...local };
        if (server.theme && (THEME_IDS as readonly string[]).includes(server.theme)) {
          next.theme = server.theme;
        }
        if (server.mode === "light" || server.mode === "dark" || server.mode === "auto") {
          next.mode = server.mode;
        }
        if (server.fontPairing && (FONT_PAIRINGS as readonly string[]).includes(server.fontPairing)) {
          next.fontPairing = server.fontPairing;
        }
        if (server.density && (DENSITIES as readonly string[]).includes(server.density)) {
          next.density = server.density;
        }
        if (server.motion && (MOTION_PREFERENCES as readonly string[]).includes(server.motion)) {
          next.motion = server.motion;
        }
        // Update localStorage to match server state.
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
        return next;
      });
    });
    return () => { cancelled = true; };
  }, []);

  // Track system preference — but only re-render when the user is on Auto.
  // Apple-native: a manual pick wins, OS flips do not surprise the user.
  useEffect(() => {
    if (themeConfig.mode !== "auto") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      // Touch state to force re-render; resolvedMode re-derives on every render.
      setThemeConfigState((c) => ({ ...c }));
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [themeConfig.mode]);

  // Apply .dark class for Tailwind darkMode: ["class"].
  useEffect(() => {
    const root = document.documentElement;
    if (resolvedMode === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
  }, [resolvedMode]);

  // Apply [data-theme] for the per-theme CSS blocks in index.css.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", themeConfig.theme);
  }, [themeConfig.theme]);

  // Apply [data-font-pairing] so fonts.css can switch pairings via attribute selectors.
  useEffect(() => {
    document.documentElement.setAttribute("data-font-pairing", themeConfig.fontPairing);
  }, [themeConfig.fontPairing]);

  // Apply [data-density] for surface-level density rules.
  useEffect(() => {
    document.documentElement.setAttribute("data-density", themeConfig.density);
  }, [themeConfig.density]);

  // Apply [data-motion] so motion-sensitive utilities can opt out.
  useEffect(() => {
    document.documentElement.setAttribute("data-motion", themeConfig.motion);
  }, [themeConfig.motion]);

  const setThemeConfig = (update: Partial<ThemeConfig>) => {
    setThemeConfigState((prev) => {
      const next = { ...prev, ...update };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        // Keep legacy light|dark key warm for any consumer still reading it.
        if (next.mode !== "auto") localStorage.setItem(LEGACY_LIGHTDARK_KEY, next.mode);
      } catch {
        // localStorage unavailable — skip persistence; in-memory state still updates.
      }
      return next;
    });

    // Server PATCH — debounced. Accumulate field updates from rapid clicks
    // (e.g. theme + mode toggled in succession) and flush as a single PATCH
    // after the user pauses. Failure logs silently; local state is canonical.
    pendingPatchRef.current = { ...pendingPatchRef.current, ...update };
    if (patchTimerRef.current !== undefined) {
      window.clearTimeout(patchTimerRef.current);
    }
    patchTimerRef.current = window.setTimeout(() => {
      const flush = pendingPatchRef.current;
      pendingPatchRef.current = {};
      patchTimerRef.current = undefined;
      if (Object.keys(flush).length > 0) {
        void patchServerPreferences(flush);
      }
    }, PATCH_DEBOUNCE_MS);
  };

  const setTheme = (t: "light" | "dark") => setThemeConfig({ mode: t });
  const toggleTheme = () =>
    setThemeConfig({ mode: resolvedMode === "light" ? "dark" : "light" });

  return (
    <ThemeContext.Provider
      value={{
        themeConfig,
        setThemeConfig,
        resolvedMode,
        theme: resolvedMode,
        setTheme,
        toggleTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}

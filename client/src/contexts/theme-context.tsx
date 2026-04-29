import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

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

export const THEME_IDS: ThemeId[] = ["homestead", "quarry", "nocturne", "meadow", "slate"];
export const FONT_PAIRINGS: FontPairing[] = ["editorial", "modern", "classic", "native", "refined"];

export interface ThemeConfig {
  theme: ThemeId;
  mode: ThemeMode;
  fontPairing: FontPairing;
}

const DEFAULT_CONFIG: ThemeConfig = {
  theme: "homestead",
  mode: "auto",
  fontPairing: "editorial",
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
      return next;
    }
    // Migrate from very-old "acreos-theme" light|dark key.
    const legacy = localStorage.getItem(LEGACY_LIGHTDARK_KEY) as "light" | "dark" | null;
    if (legacy) return { ...DEFAULT_CONFIG, mode: legacy };
  } catch {
    // localStorage unavailable / malformed — fall through to defaults.
  }
  return DEFAULT_CONFIG;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeConfig, setThemeConfigState] = useState<ThemeConfig>(loadStoredConfig);

  const resolvedMode: "light" | "dark" =
    themeConfig.mode === "auto" ? getSystemPreference() : themeConfig.mode;

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

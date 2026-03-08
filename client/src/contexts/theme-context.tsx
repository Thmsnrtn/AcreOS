import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type ThemeMode = "light" | "dark" | "system";
export type ThemeAccent = "terracotta" | "forest" | "ocean" | "amber" | "rose" | "slate";
export type ThemePreset = "default" | "midnight" | "forest" | "ocean" | "sunset" | "monochrome";

export interface ThemeConfig {
  mode: ThemeMode;
  accent: ThemeAccent;
  preset: ThemePreset;
}

const DEFAULT_CONFIG: ThemeConfig = {
  mode: "system",
  accent: "terracotta",
  preset: "default",
};

interface ThemeContextValue {
  themeConfig: ThemeConfig;
  setThemeConfig: (config: Partial<ThemeConfig>) => void;
  // Legacy compat
  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark") => void;
  toggleTheme: () => void;
  resolvedMode: "light" | "dark";
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function getSystemPreference(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeConfig, setThemeConfigState] = useState<ThemeConfig>(() => {
    if (typeof window === "undefined") return DEFAULT_CONFIG;
    try {
      const stored = localStorage.getItem("acreos-theme-config");
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<ThemeConfig>;
        return { ...DEFAULT_CONFIG, ...parsed };
      }
      // Migrate from old "acreos-theme" key
      const legacy = localStorage.getItem("acreos-theme") as "light" | "dark" | null;
      if (legacy) {
        return { ...DEFAULT_CONFIG, mode: legacy };
      }
    } catch {}
    return DEFAULT_CONFIG;
  });

  const resolvedMode: "light" | "dark" =
    themeConfig.mode === "system" ? getSystemPreference() : themeConfig.mode;

  // Track system preference
  useEffect(() => {
    if (themeConfig.mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      // Force re-render by touching state (no-op value change)
      setThemeConfigState((c) => ({ ...c }));
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [themeConfig.mode]);

  // Apply dark/light class
  useEffect(() => {
    const root = document.documentElement;
    if (resolvedMode === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [resolvedMode]);

  // Apply preset data-attribute
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", themeConfig.preset);
  }, [themeConfig.preset]);

  // Apply accent data-attribute
  useEffect(() => {
    document.documentElement.setAttribute("data-accent", themeConfig.accent);
  }, [themeConfig.accent]);

  const setThemeConfig = (update: Partial<ThemeConfig>) => {
    setThemeConfigState((prev) => {
      const next = { ...prev, ...update };
      try {
        localStorage.setItem("acreos-theme-config", JSON.stringify(next));
        // Keep legacy key for any code that reads it
        if (next.mode !== "system") {
          localStorage.setItem("acreos-theme", next.mode);
        }
      } catch {}
      return next;
    });
  };

  // Legacy compat
  const legacyTheme = resolvedMode;
  const setTheme = (t: "light" | "dark") => setThemeConfig({ mode: t });
  const toggleTheme = () =>
    setThemeConfig({ mode: resolvedMode === "light" ? "dark" : "light" });

  return (
    <ThemeContext.Provider
      value={{
        themeConfig,
        setThemeConfig,
        theme: legacyTheme,
        setTheme,
        toggleTheme,
        resolvedMode,
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

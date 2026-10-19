import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { clientLogger } from "@/lib/clientLogger";
import { okOrThrow } from "@/lib/fetch-honesty";
import { hasAnyClerkSession } from "@/lib/clerk-session-detect";
import { apiRequest } from "@/lib/queryClient";
import {
  COLORWAYS,
  COLORWAY_IDS,
  DEFAULT_COLORWAY,
  DEFAULT_DISPLAY_MODE,
  normalizeAppearance,
  normalizeColorway,
  normalizeDisplayMode,
  resolveDisplayMode,
  type ColorwayId,
  type DisplayMode,
} from "@shared/appearance";

/**
 * Personal appearance — one colorway (Fieldstone · Bedrock · Meridian) and one
 * display mode (Light · Dark · Match device). The canonical lists, defaults and
 * the migration of retired values live in shared/appearance.ts; this provider
 * only owns the lifecycle.
 *
 * Lifecycle rules (Fieldstone redesign, 2026-10-18):
 *   - localStorage is read synchronously at boot (and by the inline script in
 *     client/index.html before first paint) through the same normalization, so
 *     the boot palette and the hydrated palette agree.
 *   - An explicit Light/Dark wins over later OS changes until the person picks
 *     Match device; Match device follows the OS live, without a reload.
 *   - Changes persist locally at once, then sync to /api/me/preferences
 *     (debounced, batched). A failed sync keeps the local choice.
 *   - A slow server read can never undo a choice made after the page loaded:
 *     fields the person changed locally are not overwritten by hydration.
 *   - Font pairing, density and motion are no longer appearance choices. Their
 *     old stored values are dropped here; reading comfort and reduced motion
 *     belong to AccessibilityProvider.
 */

export type ThemeId = ColorwayId;
export type ThemeMode = DisplayMode;
export const THEME_IDS: readonly ThemeId[] = COLORWAY_IDS;

export interface ThemeConfig {
  theme: ThemeId;
  mode: ThemeMode;
}

const DEFAULT_CONFIG: ThemeConfig = { theme: DEFAULT_COLORWAY, mode: DEFAULT_DISPLAY_MODE };

export const THEME_STORAGE_KEY = "acreos-theme-config";
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

function devicePrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Stored blob → config. Exported for tests; mirrors the inline boot script. */
export function readStoredThemeConfig(storage: Pick<Storage, "getItem"> | null): ThemeConfig {
  if (!storage) return DEFAULT_CONFIG;
  try {
    const stored = storage.getItem(THEME_STORAGE_KEY);
    if (stored) {
      let parsed: unknown = null;
      try { parsed = JSON.parse(stored); } catch { parsed = null; }
      return normalizeAppearance(parsed);
    }
    // Very-old raw "light" | "dark" key.
    const legacyMode = normalizeDisplayMode(storage.getItem(LEGACY_LIGHTDARK_KEY));
    if (legacyMode) return { ...DEFAULT_CONFIG, mode: legacyMode };
  } catch {
    // Storage unavailable — fall through to defaults.
  }
  return DEFAULT_CONFIG;
}

function loadStoredConfig(): ThemeConfig {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  try {
    return readStoredThemeConfig(window.localStorage);
  } catch {
    return DEFAULT_CONFIG;
  }
}

function persistLocal(config: ThemeConfig) {
  try {
    // Only the two live fields are written, which also drops the retired
    // fontPairing / density / motion keys from an older stored blob.
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ theme: config.theme, mode: config.mode }));
    if (config.mode !== "auto") localStorage.setItem(LEGACY_LIGHTDARK_KEY, config.mode);
    else localStorage.removeItem(LEGACY_LIGHTDARK_KEY);
  } catch {
    // localStorage unavailable — in-memory state still updates.
  }
}

/** Write the colorway + mode onto <html>. Exported so the tenant overlay can
 *  re-assert the personal palette after removing company branding. */
export function applyThemeToDocument(config: ThemeConfig, deviceDark: boolean) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const resolved = resolveDisplayMode(config.mode, deviceDark);
  root.classList.toggle("dark", resolved === "dark");
  root.setAttribute("data-theme", config.theme);
  root.style.colorScheme = resolved;
  // Browser chrome (iOS status area, Android toolbar) follows the page the
  // person actually sees — colorway AND resolved mode, not the OS default.
  const page = COLORWAYS.find((c) => c.id === config.theme)?.[resolved].page;
  if (page) {
    for (const meta of Array.from(document.querySelectorAll('meta[name="theme-color"]'))) {
      meta.setAttribute("content", page);
    }
  }
}

const PREFERENCES_ENDPOINT = "/api/me/preferences";
const PATCH_DEBOUNCE_MS = 300;

async function fetchServerPreferences(): Promise<Record<string, unknown> | null> {
  try {
    // A failed read throws to the catch, which keeps the local theme and says
    // so — local state is canonical; nothing is shown as the server's (W10.1).
    const res = await okOrThrow(await fetch(PREFERENCES_ENDPOINT, { credentials: "include" }));
    return (await res.json()) as Record<string, unknown>;
  } catch (err) {
    clientLogger.info("[theme] could not read saved preferences; local theme kept", err);
    return null;
  }
}

async function patchServerPreferences(update: Partial<ThemeConfig>): Promise<void> {
  try {
    // apiRequest throws on a non-OK status, so a rejected write reaches the
    // catch rather than being logged as success.
    await apiRequest("PATCH", PREFERENCES_ENDPOINT, update);
  } catch (err) {
    clientLogger.warn("[theme] PATCH /api/me/preferences failed; local state retained", err);
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeConfig, setThemeConfigState] = useState<ThemeConfig>(loadStoredConfig);
  const [deviceDark, setDeviceDark] = useState<boolean>(devicePrefersDark);
  const pendingPatchRef = useRef<Partial<ThemeConfig>>({});
  const patchTimerRef = useRef<number | undefined>(undefined);
  // Fields the person changed in this page lifetime. Server hydration never
  // overwrites these — a slow GET must not undo a fresh choice.
  const locallyChangedRef = useRef<Set<keyof ThemeConfig>>(new Set());

  const resolvedMode = resolveDisplayMode(themeConfig.mode, deviceDark);

  // Hydrate from the server once. Only when the browser carries a Clerk
  // session: on public/logged-out pages there is nothing to hydrate and the
  // authed call would only emit a 401.
  useEffect(() => {
    if (!hasAnyClerkSession()) return;
    let cancelled = false;
    fetchServerPreferences().then((server) => {
      if (cancelled || !server) return;
      const serverTheme = normalizeColorway(server.theme);
      const serverMode = normalizeDisplayMode(server.mode);
      setThemeConfigState((local) => {
        const next: ThemeConfig = { ...local };
        if (serverTheme && !locallyChangedRef.current.has("theme")) next.theme = serverTheme;
        if (serverMode && !locallyChangedRef.current.has("mode")) next.mode = serverMode;
        if (next.theme === local.theme && next.mode === local.mode) return local;
        persistLocal(next);
        return next;
      });
    });
    return () => { cancelled = true; };
  }, []);

  // Follow the OS colour scheme live. A manual Light/Dark ignores it because
  // resolveDisplayMode only consults deviceDark on `auto`.
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => setDeviceDark(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Layout effect: the attributes land before any passive effect runs, so the
  // company-accent overlay (a child, whose effects run first) always reads the
  // NEW colorway's surfaces from getComputedStyle.
  useLayoutEffect(() => {
    applyThemeToDocument(themeConfig, deviceDark);
  }, [themeConfig, deviceDark]);

  // Flush a pending PATCH if the provider unmounts mid-debounce.
  useEffect(() => () => {
    if (patchTimerRef.current !== undefined) {
      window.clearTimeout(patchTimerRef.current);
      patchTimerRef.current = undefined;
      const flush = pendingPatchRef.current;
      pendingPatchRef.current = {};
      if (Object.keys(flush).length > 0 && hasAnyClerkSession()) void patchServerPreferences(flush);
    }
  }, []);

  const setThemeConfig = (update: Partial<ThemeConfig>) => {
    // Accept only valid values; anything else is ignored rather than stored.
    const clean: Partial<ThemeConfig> = {};
    const t = normalizeColorway(update.theme);
    const m = normalizeDisplayMode(update.mode);
    if (update.theme !== undefined && t) clean.theme = t;
    if (update.mode !== undefined && m) clean.mode = m;
    if (Object.keys(clean).length === 0) return;

    for (const k of Object.keys(clean) as (keyof ThemeConfig)[]) locallyChangedRef.current.add(k);

    setThemeConfigState((prev) => {
      const next = { ...prev, ...clean };
      persistLocal(next);
      return next;
    });

    // Debounced server sync — adjacent colorway/mode changes batch into one
    // PATCH carrying every field touched since the last flush.
    pendingPatchRef.current = { ...pendingPatchRef.current, ...clean };
    if (patchTimerRef.current !== undefined) window.clearTimeout(patchTimerRef.current);
    patchTimerRef.current = window.setTimeout(() => {
      const flush = pendingPatchRef.current;
      pendingPatchRef.current = {};
      patchTimerRef.current = undefined;
      if (Object.keys(flush).length > 0 && hasAnyClerkSession()) void patchServerPreferences(flush);
    }, PATCH_DEBOUNCE_MS);
  };

  const setTheme = (t: "light" | "dark") => setThemeConfig({ mode: t });
  const toggleTheme = () => setThemeConfig({ mode: resolvedMode === "light" ? "dark" : "light" });

  return (
    <ThemeContext.Provider
      value={{ themeConfig, setThemeConfig, resolvedMode, theme: resolvedMode, setTheme, toggleTheme }}
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

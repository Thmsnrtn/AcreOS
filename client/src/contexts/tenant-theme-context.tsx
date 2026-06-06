import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { hasAnyClerkSession } from "@/lib/clerk-session-detect";
import { useTheme } from "@/contexts/theme-context";

/**
 * TenantThemeProvider — per-organization first-party theming (Tahoe E5).
 *
 * Applies the org's brand affordances (accent color, logo, density) on top of
 * the user's personal theme (theme-context.tsx). It mounts INSIDE ThemeProvider
 * so it layers over — never replaces — the personal theme:
 *
 *   - Accent color → injected as the `--accent`, `--primary`, `--ring` CSS
 *     custom properties in HSL-component form (the same shape the design
 *     tokens in index.css use). NEVER a hardcoded color — every consumer
 *     reads the token. Cleared back to the theme default when unset.
 *   - Logo → exposed via context (`brandLogoUrl`) for nav/topbar consumers.
 *   - Density → only applied as the org default when the user has NOT picked
 *     a personal density (personal preference always wins). Mapped onto the
 *     existing `data-density` attribute so index.css density rules apply.
 *
 * Distinct from white_label_configs (reseller/Kim tenants on custom domains),
 * which useWhiteLabel handles. These columns live directly on `organizations`
 * and every org can set them from Settings → Appearance.
 */

export interface TenantTheme {
  brandAccentColor: string | null;
  brandLogoUrl: string | null;
  brandDensity: "compact" | "comfortable" | "adaptive" | null;
}

interface TenantThemeContextValue extends TenantTheme {
  /** True once the org theme has been fetched (or determined to be empty). */
  isLoaded: boolean;
}

const TenantThemeContext = createContext<TenantThemeContextValue>({
  brandAccentColor: null,
  brandLogoUrl: null,
  brandDensity: null,
  isLoaded: false,
});

/** Convert a 6-digit hex ("#1e3a5f") to HSL components ("215 52% 24%"). */
function hexToHslComponents(hex: string): string | null {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return null;
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

// The CSS variables we set/clear for the accent. We track them so we can fully
// remove an override when the org clears its accent (rather than leaving a
// stale inline style that would shadow the theme default).
const ACCENT_VARS = ["--accent", "--primary", "--ring"] as const;

export function TenantThemeProvider({ children }: { children: ReactNode }) {
  // The personal theme owns `data-density`; we only step in when the user is on
  // the default ("adaptive") so an org default never overrides a personal pick.
  const { themeConfig } = useTheme();

  const hasSession = hasAnyClerkSession();
  const { data, isSuccess } = useQuery<TenantTheme>({
    queryKey: ["/api/tenant-theme"],
    enabled: hasSession,
    queryFn: () =>
      fetch("/api/tenant-theme", { credentials: "include" })
        .then((r) =>
          r.ok
            ? (r.json() as Promise<TenantTheme>)
            : ({ brandAccentColor: null, brandLogoUrl: null, brandDensity: null } as TenantTheme),
        )
        .catch(
          () =>
            ({ brandAccentColor: null, brandLogoUrl: null, brandDensity: null }) as TenantTheme,
        ),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const accent = data?.brandAccentColor ?? null;
  const logo = data?.brandLogoUrl ?? null;
  const density = data?.brandDensity ?? null;

  // Apply / clear the accent CSS variables.
  useEffect(() => {
    const root = document.documentElement;
    if (accent) {
      const hsl = hexToHslComponents(accent);
      if (hsl) {
        for (const v of ACCENT_VARS) root.style.setProperty(v, hsl);
        return () => {
          for (const v of ACCENT_VARS) root.style.removeProperty(v);
        };
      }
    }
    // No accent (or invalid) — make sure no stale override lingers.
    for (const v of ACCENT_VARS) root.style.removeProperty(v);
  }, [accent]);

  // Apply the org density default ONLY when the user hasn't expressed a
  // personal density preference (i.e. still on the "adaptive" default).
  useEffect(() => {
    if (!density) return;
    if (themeConfig.density !== "adaptive") return; // personal pick wins
    document.documentElement.setAttribute("data-density", density);
  }, [density, themeConfig.density]);

  const value = useMemo<TenantThemeContextValue>(
    () => ({
      brandAccentColor: accent,
      brandLogoUrl: logo,
      brandDensity: density,
      isLoaded: !hasSession || isSuccess,
    }),
    [accent, logo, density, hasSession, isSuccess],
  );

  return <TenantThemeContext.Provider value={value}>{children}</TenantThemeContext.Provider>;
}

export function useTenantTheme(): TenantThemeContextValue {
  return useContext(TenantThemeContext);
}

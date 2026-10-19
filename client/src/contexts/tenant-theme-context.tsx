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
import { deriveTenantAccent, TENANT_ACCENT_VARS } from "@/lib/tenant-accent";

/**
 * TenantThemeProvider — per-organization first-party theming (Tahoe E5).
 *
 * Applies the org's brand affordances (accent color, logo, density) on top of
 * the user's personal theme (theme-context.tsx). It mounts INSIDE ThemeProvider
 * so it layers over — never replaces — the personal theme:
 *
 *   - Accent color → derived per colorway + mode by deriveTenantAccent()
 *     (lib/tenant-accent.ts) so its label clears AA and it stays visible as a
 *     focus ring, then written to BOTH token families (--primary/--ring AND
 *     --acr-brand/-ink/-soft/-soft-ink/--acr-ring/--acr-glow). Before the
 *     Fieldstone redesign it wrote the HSL family only — raw --acr-brand kept
 *     the personal colour — and also repainted --accent, the hover tint.
 *     Re-derived when the colorway or mode changes; on removal every override
 *     is cleared, so the personal colorway's stylesheet values return.
 *   - Logo → exposed via context (`brandLogoUrl`) for nav/topbar consumers.
 *   - Density → stored and exposed, but NOT applied: `data-density` is the
 *     person's Accessibility & comfort reading density, and organization
 *     branding never overrides a person's reading or accessibility settings.
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

export function TenantThemeProvider({ children }: { children: ReactNode }) {
  // The accent is derived against the CURRENT colorway + mode surfaces.
  const { themeConfig, resolvedMode } = useTheme();

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

  // Apply / clear the accent overrides. Clearing first means the surfaces read
  // below are the personal colorway's own, never a previous override.
  useEffect(() => {
    const root = document.documentElement;
    const clear = () => { for (const v of TENANT_ACCENT_VARS) root.style.removeProperty(v); };
    clear();
    if (!accent) return;
    const cs = getComputedStyle(root);
    const vars = deriveTenantAccent(accent, {
      mode: resolvedMode,
      bg: cs.getPropertyValue("--acr-bg").trim(),
      surface: cs.getPropertyValue("--acr-surface").trim(),
      ink: cs.getPropertyValue("--acr-ink").trim(),
    });
    if (!vars) return;
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    return clear;
  }, [accent, themeConfig.theme, resolvedMode]);

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

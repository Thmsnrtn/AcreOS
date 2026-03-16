/**
 * White-Label Branding Hook (T67)
 *
 * Fetches white-label config for the current org and injects CSS custom
 * properties (--primary, --accent, etc.) into :root to apply the tenant's
 * brand colors throughout the app.
 *
 * Also returns brandName and logoUrl for use in the nav bar / title.
 */

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

interface WhiteLabelConfig {
  tenantId?: string;
  brandName?: string;
  logoUrl?: string;
  faviconUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  customDomain?: string;
  poweredByText?: string;
  hidePoweredBy?: boolean;
  status?: string;
}

/** Convert a hex color like "#1e3a5f" to HSL components "215 52% 24%" */
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

function injectCssVariables(primary?: string, accent?: string): void {
  const root = document.documentElement;

  if (primary) {
    const hsl = hexToHslComponents(primary);
    if (hsl) {
      root.style.setProperty("--primary", hsl);
      root.style.setProperty("--ring", hsl);
    }
  }

  if (accent) {
    const hsl = hexToHslComponents(accent);
    if (hsl) {
      root.style.setProperty("--accent", hsl);
    }
  }
}

function updateFavicon(faviconUrl: string): void {
  const existing = document.querySelector("link[rel='icon']") as HTMLLinkElement | null;
  if (existing) {
    existing.href = faviconUrl;
  } else {
    const link = document.createElement("link");
    link.rel = "icon";
    link.href = faviconUrl;
    document.head.appendChild(link);
  }
}

export function useWhiteLabel() {
  const { data } = useQuery<{ config: WhiteLabelConfig | null }>({
    queryKey: ["/api/white-label/config"],
    queryFn: () =>
      fetch("/api/white-label/config")
        .then((r) => (r.ok ? r.json() : { config: null }))
        .catch(() => ({ config: null })),
    staleTime: 5 * 60 * 1000, // 5-minute cache
    retry: false,
  });

  const config = data?.config;

  useEffect(() => {
    if (!config) return;

    // Inject CSS variables for brand colors
    if (config.primaryColor || config.accentColor) {
      injectCssVariables(config.primaryColor, config.accentColor);
    }

    // Update page title
    if (config.brandName) {
      document.title = config.brandName;
    }

    // Update favicon
    if (config.faviconUrl) {
      updateFavicon(config.faviconUrl);
    }
  }, [config]);

  return {
    brandName: config?.brandName,
    logoUrl: config?.logoUrl,
    hidePoweredBy: config?.hidePoweredBy ?? false,
    poweredByText: config?.poweredByText,
    isWhiteLabel: !!config?.tenantId,
  };
}

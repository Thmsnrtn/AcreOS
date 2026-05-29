import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_SIDEBAR_ITEMS,
  DEFAULT_MOBILE_ITEMS,
  ALL_NAV_ITEMS,
} from "@/lib/nav-items";
import { clientLogger } from "@/lib/clientLogger";
import { hasAnyClerkSession } from "@/lib/clerk-session-detect";

/**
 * Sidebar + mobile-nav preferences.
 *
 * Phase C.1: lifted from localStorage-only to server-synced via
 * /api/me/preferences (sidebarConfig field). localStorage-first hydration
 * for first paint; server fetch on mount overwrites if it returns valid
 * preferences. Failures log silently — local state stays canonical
 * (mirrors theme-context.tsx pattern).
 *
 * Desktop sidebar consumption of `sidebarItems` is deferred to Phase E
 * (shell re-skin) per JUDGMENT-CALLS C.1.1; for now, only `MobileBottomNav`
 * applies the customization.
 */

const STORAGE_KEY = "acreOsNavPreferences";
const PREFERENCES_ENDPOINT = "/api/me/preferences";
const PATCH_DEBOUNCE_MS = 300;

interface NavPreferences {
  /** Ordered list of nav item IDs shown in the desktop sidebar */
  sidebarItems: string[];
  /** Ordered list of nav item IDs shown in the mobile bottom bar (max 4) */
  mobileItems: string[];
}

const DEFAULTS: NavPreferences = {
  sidebarItems: DEFAULT_SIDEBAR_ITEMS,
  mobileItems: DEFAULT_MOBILE_ITEMS,
};

function validate(parsed: Partial<NavPreferences> | null | undefined): NavPreferences {
  const allIds = new Set(ALL_NAV_ITEMS.map((i) => i.id));
  const sidebar = (parsed?.sidebarItems ?? DEFAULTS.sidebarItems).filter((id) => allIds.has(id));
  const mobile = (parsed?.mobileItems ?? DEFAULTS.mobileItems).filter((id) => allIds.has(id));
  return {
    sidebarItems: sidebar.length ? sidebar : DEFAULTS.sidebarItems,
    mobileItems: mobile.length ? mobile : DEFAULTS.mobileItems,
  };
}

function loadLocal(): NavPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return validate(JSON.parse(raw) as Partial<NavPreferences>);
  } catch {
    return DEFAULTS;
  }
}

function saveLocal(prefs: NavPreferences) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // storage full or private mode — silently ignore
  }
}

async function fetchServerNavPreferences(): Promise<Partial<NavPreferences> | null> {
  try {
    const res = await fetch(PREFERENCES_ENDPOINT, { credentials: "include" });
    if (!res.ok) return null;
    const data = await res.json();
    const cfg = data?.sidebarConfig;
    if (!cfg) return null;
    return { sidebarItems: cfg.sidebarItems, mobileItems: cfg.mobileItems };
  } catch {
    return null;
  }
}

async function patchServerNavPreferences(prefs: NavPreferences): Promise<void> {
  // Don't PATCH from unauthenticated contexts — the server will 401 and
  // the local state is canonical anyway.
  if (!hasAnyClerkSession()) return;
  try {
    await fetch(PREFERENCES_ENDPOINT, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sidebarConfig: prefs }),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    clientLogger.warn("[nav] PATCH /api/me/preferences sidebarConfig failed; local state retained", err);
  }
}

export function useNavPreferences() {
  const [prefs, setPrefs] = useState<NavPreferences>(loadLocal);
  const patchTimerRef = useRef<number | undefined>(undefined);

  // Hydrate from server on mount — but only when signed in. /api/me/preferences
  // requires auth, so calling it for unauthenticated visitors (e.g. anyone
  // mounting <MobileBottomNav> on a public page) just produces a 401 in the
  // console. Skip until a Clerk session cookie is present.
  useEffect(() => {
    if (!hasAnyClerkSession()) return;
    let cancelled = false;
    fetchServerNavPreferences().then((server) => {
      if (cancelled || !server) return;
      const next = validate(server);
      setPrefs(next);
      saveLocal(next);
    });
    return () => { cancelled = true; };
  }, []);

  const update = useCallback((next: NavPreferences) => {
    saveLocal(next);
    setPrefs(next);
    if (patchTimerRef.current !== undefined) {
      window.clearTimeout(patchTimerRef.current);
    }
    patchTimerRef.current = window.setTimeout(() => {
      patchTimerRef.current = undefined;
      void patchServerNavPreferences(next);
    }, PATCH_DEBOUNCE_MS);
  }, []);

  const setSidebarItems = useCallback(
    (items: string[]) => update({ ...prefs, sidebarItems: items }),
    [prefs, update],
  );

  const setMobileItems = useCallback(
    (items: string[]) => update({ ...prefs, mobileItems: items }),
    [prefs, update],
  );

  const reset = useCallback(() => {
    update(DEFAULTS);
  }, [update]);

  // 2026-05-29: the mobile bottom-nav is a fixed, predictable set
  // (DEFAULT_MOBILE_ITEMS = Today / Inbox / Pipeline / Portfolio) unless the
  // user explicitly customizes it. We previously substituted a server-inferred
  // persona default here, but that made the nav swap unpredictably (a Land
  // Investor could open the app and see a Wholesaler-shaped set when the
  // inference misfired). Land Investors are the launch vertical; per-persona
  // nav can return once those verticals ship and the inference is reliable.
  return {
    sidebarItems: prefs.sidebarItems,
    mobileItems: prefs.mobileItems,
    setSidebarItems,
    setMobileItems,
    reset,
  };
}

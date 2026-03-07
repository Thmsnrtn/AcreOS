import { useState, useCallback } from "react";
import { DEFAULT_SIDEBAR_ITEMS, DEFAULT_MOBILE_ITEMS, ALL_NAV_ITEMS } from "@/lib/nav-items";

const STORAGE_KEY = "acreOsNavPreferences";

interface NavPreferences {
  /** Ordered list of nav item IDs shown in the desktop sidebar */
  sidebarItems: string[];
  /** Ordered list of nav item IDs shown in the mobile bottom bar (max 4) */
  mobileItems: string[];
}

function load(): NavPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { sidebarItems: DEFAULT_SIDEBAR_ITEMS, mobileItems: DEFAULT_MOBILE_ITEMS };
    const parsed = JSON.parse(raw) as Partial<NavPreferences>;
    const allIds = new Set(ALL_NAV_ITEMS.map((i) => i.id));
    const validSidebar = (parsed.sidebarItems ?? DEFAULT_SIDEBAR_ITEMS).filter((id) => allIds.has(id));
    const validMobile  = (parsed.mobileItems  ?? DEFAULT_MOBILE_ITEMS ).filter((id) => allIds.has(id));
    return {
      sidebarItems: validSidebar.length ? validSidebar : DEFAULT_SIDEBAR_ITEMS,
      mobileItems:  validMobile.length  ? validMobile  : DEFAULT_MOBILE_ITEMS,
    };
  } catch {
    return { sidebarItems: DEFAULT_SIDEBAR_ITEMS, mobileItems: DEFAULT_MOBILE_ITEMS };
  }
}

function save(prefs: NavPreferences) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // storage full or private mode — silently ignore
  }
}

export function useNavPreferences() {
  const [prefs, setPrefs] = useState<NavPreferences>(load);

  const update = useCallback((next: NavPreferences) => {
    save(next);
    setPrefs(next);
  }, []);

  const setSidebarItems = useCallback(
    (items: string[]) => update({ ...prefs, sidebarItems: items }),
    [prefs, update]
  );

  const setMobileItems = useCallback(
    (items: string[]) => update({ ...prefs, mobileItems: items }),
    [prefs, update]
  );

  const reset = useCallback(() => {
    const defaults = { sidebarItems: DEFAULT_SIDEBAR_ITEMS, mobileItems: DEFAULT_MOBILE_ITEMS };
    save(defaults);
    setPrefs(defaults);
  }, []);

  return {
    sidebarItems: prefs.sidebarItems,
    mobileItems:  prefs.mobileItems,
    setSidebarItems,
    setMobileItems,
    reset,
  };
}

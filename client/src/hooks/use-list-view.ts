import { useCallback, useEffect, useRef, useState } from "react";
import { clientLogger } from "@/lib/clientLogger";

/**
 * Per-list-type view preferences. Phase C.3 of the port.
 *
 * Each list-bearing surface (pipeline, inbox, contacts, parcels, etc.)
 * registers a `listType` ID and reads its current view (rows / cards /
 * expand-on-click). Defaults per surface come from design-system §5.5;
 * users can override per list-type. Choices persist server-side via
 * `/api/me/preferences#listViews` and locally for fast first paint.
 */

export type ListView = "rows" | "cards" | "expand-on-click";

const STORAGE_KEY = "acreOsListViews";
const PREFERENCES_ENDPOINT = "/api/me/preferences";
const PATCH_DEBOUNCE_MS = 300;

/**
 * Default view per list-type (design-system §5.5). Pipeline/buyboxes are
 * card-shaped; inbox/contacts/audit are row-shaped; tables stay tabular.
 * Add new list-type IDs here as Phase E surfaces register theirs.
 */
export const LIST_VIEW_DEFAULTS: Record<string, ListView> = {
  inbox: "rows",
  contacts: "rows",
  audit: "rows",
  pipeline: "cards",
  buyboxes: "cards",
  lists: "rows",
  campaigns: "rows",
  deals: "rows",
  parcels: "rows",
  offers: "rows",
  documents: "rows",
  dispositions: "rows",
};

/** All list-types whose default isn't user-pickable (e.g. audit log is always rows). */
const NON_TOGGLEABLE = new Set<string>(["audit"]);

type ListViewMap = Record<string, ListView>;

function loadLocal(): ListViewMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as ListViewMap;
  } catch {
    return {};
  }
}

function saveLocal(map: ListViewMap) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

let memoState: ListViewMap = loadLocal();
const subscribers = new Set<() => void>();
let patchTimer: number | undefined;

async function fetchServer(): Promise<ListViewMap | null> {
  try {
    const res = await fetch(PREFERENCES_ENDPOINT, { credentials: "include" });
    if (!res.ok) return null;
    const data = await res.json();
    return (data?.listViews ?? null) as ListViewMap | null;
  } catch {
    return null;
  }
}

async function patchServer(map: ListViewMap): Promise<void> {
  try {
    await fetch(PREFERENCES_ENDPOINT, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listViews: map }),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    clientLogger.warn("[list-view] PATCH /api/me/preferences listViews failed; local state retained", err);
  }
}

function setListView(listType: string, view: ListView) {
  memoState = { ...memoState, [listType]: view };
  saveLocal(memoState);
  subscribers.forEach((s) => s());
  if (patchTimer !== undefined) window.clearTimeout(patchTimer);
  patchTimer = window.setTimeout(() => {
    patchTimer = undefined;
    void patchServer(memoState);
  }, PATCH_DEBOUNCE_MS);
}

let serverHydrated = false;
function hydrateOnce() {
  if (serverHydrated) return;
  serverHydrated = true;
  fetchServer().then((server) => {
    if (!server) return;
    memoState = { ...memoState, ...server };
    saveLocal(memoState);
    subscribers.forEach((s) => s());
  });
}

/**
 * Use the current view for a list-type. Defaults to the surface default
 * if the user hasn't picked. `onChange` triggers a debounced PATCH.
 */
export function useListView(listType: string): {
  view: ListView;
  setView: (view: ListView) => void;
  isToggleable: boolean;
} {
  const [, force] = useState(0);
  useEffect(() => {
    hydrateOnce();
    const cb = () => force((n) => n + 1);
    subscribers.add(cb);
    return () => { subscribers.delete(cb); };
  }, []);

  const stored = memoState[listType];
  const view: ListView = stored ?? LIST_VIEW_DEFAULTS[listType] ?? "rows";
  const setView = useCallback(
    (next: ListView) => setListView(listType, next),
    [listType],
  );
  return { view, setView, isToggleable: !NON_TOGGLEABLE.has(listType) };
}

/** All known list-types (defaults + user-overridden). For Settings UI. */
export function useAllListViews(): {
  views: ListViewMap;
  knownTypes: string[];
  setView: (listType: string, view: ListView) => void;
  reset: () => void;
} {
  const [, force] = useState(0);
  useEffect(() => {
    hydrateOnce();
    const cb = () => force((n) => n + 1);
    subscribers.add(cb);
    return () => { subscribers.delete(cb); };
  }, []);

  const views = { ...LIST_VIEW_DEFAULTS, ...memoState };
  const knownTypes = Object.keys(LIST_VIEW_DEFAULTS).filter((t) => !NON_TOGGLEABLE.has(t));
  const reset = useCallback(() => {
    memoState = {};
    saveLocal(memoState);
    subscribers.forEach((s) => s());
    if (patchTimer !== undefined) window.clearTimeout(patchTimer);
    patchTimer = window.setTimeout(() => {
      patchTimer = undefined;
      void patchServer({});
    }, PATCH_DEBOUNCE_MS);
  }, []);
  return {
    views,
    knownTypes,
    setView: (listType, view) => setListView(listType, view),
    reset,
  };
}

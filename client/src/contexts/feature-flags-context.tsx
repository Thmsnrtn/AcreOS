import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { hasAnyClerkSession } from "@/lib/clerk-session-detect";

/**
 * Client-side feature flag plumbing — design-system §8.
 *
 * Fetches /api/feature-flags on mount; evaluation is server-side, so the
 * client just stores `{ key, enabled }` for each flag. `useFlag(key)`
 * returns `false` until the fetch resolves (fail-closed for first paint;
 * matches server behavior for unknown flags).
 *
 * `<RequireFlag flag="...">` renders children only when the flag is
 * enabled, otherwise renders the fallback (default: a 404-style message).
 * Server enforces the same gate on the route — this is defense in depth
 * + immediate UX (no flash).
 */

const ENDPOINT = "/api/feature-flags";

interface FlagEntry {
  key: string;
  enabled: boolean;
  state: string;
}

interface FlagState {
  flags: Record<string, boolean>;
  loaded: boolean;
}

interface FlagsContextValue extends FlagState {
  /** Refresh from server — call after mutations elsewhere. */
  refresh: () => Promise<void>;
}

const FeatureFlagsContext = createContext<FlagsContextValue | undefined>(undefined);

export function FeatureFlagsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<FlagState>({ flags: {}, loaded: false });

  const refresh = async () => {
    try {
      const res = await fetch(ENDPOINT, { credentials: "include" });
      if (!res.ok) {
        // Fail-open on auth errors so unauthenticated routes still render;
        // server still enforces at the API level for protected resources.
        setState({ flags: {}, loaded: true });
        return;
      }
      const data = (await res.json()) as FlagEntry[];
      const map: Record<string, boolean> = {};
      for (const f of data) map[f.key] = f.enabled;
      setState({ flags: map, loaded: true });
    } catch {
      setState({ flags: {}, loaded: true });
    }
  };

  useEffect(() => {
    // Only hit the authed /api/feature-flags endpoint when the browser
    // actually carries a Clerk session. Public/logged-out pages (landing,
    // pricing, parcel-check) otherwise produce a wall of 401s in the console.
    // With no session we fall back to empty flags (fail-closed, matches
    // server behavior for unknown flags) without a network call.
    if (hasAnyClerkSession()) {
      void refresh();
    } else {
      setState({ flags: {}, loaded: true });
    }
  }, []);

  return (
    <FeatureFlagsContext.Provider value={{ ...state, refresh }}>
      {children}
    </FeatureFlagsContext.Provider>
  );
}

export function useFlag(key: string): boolean {
  const ctx = useContext(FeatureFlagsContext);
  if (!ctx) return false;
  return !!ctx.flags[key];
}

export function useAllFlags(): { flags: Record<string, boolean>; loaded: boolean } {
  const ctx = useContext(FeatureFlagsContext);
  if (!ctx) return { flags: {}, loaded: false };
  return { flags: ctx.flags, loaded: ctx.loaded };
}

/**
 * Server-side flag refetch trigger. Call after any flag-modifying action
 * (e.g. founder toggles a flag in /founder/features).
 */
export function useFeatureFlagsRefresh(): () => Promise<void> {
  const ctx = useContext(FeatureFlagsContext);
  return ctx?.refresh ?? (async () => { /* no-op when outside provider */ });
}

interface RequireFlagProps {
  flag: string;
  fallback?: ReactNode;
  children: ReactNode;
}

const DEFAULT_FALLBACK = (
  <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
    <h1 className="text-2xl font-semibold">Not available</h1>
    <p className="text-muted-foreground mt-2 max-w-md">
      This feature isn't enabled for your account.
    </p>
  </div>
);

export function RequireFlag({ flag, fallback = DEFAULT_FALLBACK, children }: RequireFlagProps) {
  const { flags, loaded } = useAllFlags();
  if (!loaded) {
    // Render nothing during initial load — first paint is brief and the
    // server already validated the user has access. Avoids flashing the
    // fallback for users who legitimately have the flag.
    return null;
  }
  if (!flags[flag]) return <>{fallback}</>;
  return <>{children}</>;
}

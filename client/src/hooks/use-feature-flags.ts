import { useQuery } from "@tanstack/react-query";
import { hasAnyClerkSession } from "@/lib/clerk-session-detect";
import { isFrozenRoute } from "@shared/feature-freeze";

export interface FeatureFlagsResponse {
  enabledKeys: string[];
  enabledRoutes: string[];
  /**
   * Explicit deny-lists: flags whose state is 'off' (off for every
   * audience). Checked BEFORE the enabled-list fallbacks so a full module
   * freeze (all flags off → enabledRoutes empty) still hides frozen doors
   * instead of tripping the "no flags = show everything" heuristic.
   * Optional for back-compat with servers that predate the field.
   */
  disabledKeys?: string[];
  disabledRoutes?: string[];
  /**
   * EVERY key/route any flag governs, whatever that flag's state.
   *
   * Without these, "not in the enabled list" had to stand in for "denied", and
   * it does not: a route no flag governs is UNCONTROLLED, not off. The
   * `enabledRoutes.length === 0` heuristic below papered over that only while
   * nothing was enabled — see the note on `resolveRouteEnabled`.
   *
   * Optional for back-compat with servers that predate the field.
   */
  controlledKeys?: string[];
  controlledRoutes?: string[];
}

/**
 * Pure route/flag decision logic, exported for tests. Precedence:
 * 0. FROZEN route (shared/feature-freeze.ts, deletion-ledger verdicts) →
 *    hidden — checked before EVERYTHING, including the fail-open rules, so
 *    an unseeded flags table or a /api/config/features outage can never
 *    un-hide a frozen door (launch-week WS1 fix, 2026-07-07)
 * 1. no data (loading / unauthenticated / error) → show everything
 * 2. explicit deny-list hit → hidden
 * 3. NOT GOVERNED BY ANY FLAG → shown
 * 4. governed → must be in the enabled-list
 *
 * ── THE DEFECT RULE 3 REPLACES (2026-08-18) ────────────────────────────────
 * It used to read "empty enabled-list → show everything; otherwise must be in
 * the enabled-list". `enabledRoutes` is the union of routes controlled by flags
 * whose state is `'on'` — so turning ON a single flag made the list non-empty
 * and EVERY route not in it failed rule 4. One flag enabled would have hidden
 * all five customer doors from the sidebar and 404'd them in the router
 * (`layout-sidebar.tsx:939`, `App.tsx:615`).
 *
 * The old rule conflated two different things: "no flag governs this route" and
 * "a flag governs it and that flag is off". The server now sends
 * `controlledRoutes` so they can be told apart, which is what the empty-list
 * heuristic was standing in for.
 *
 * Flags in state `tier:X` / `beta` / `founder-only` are deliberately in neither
 * the enabled nor the disabled list — that endpoint has no user context to
 * resolve them — so they ARE controlled and NOT enabled. Rule 4 hides their
 * routes for everyone, which is the same conservative answer the nav gave
 * before any flag was turned on, and audience resolution stays server-side.
 */
export function resolveRouteEnabled(data: FeatureFlagsResponse | undefined, route: string): boolean {
  if (isFrozenRoute(route)) return false;
  if (!data) return true;
  if (data.disabledRoutes?.includes(route)) return false;
  // A server that predates `controlledRoutes` cannot distinguish uncontrolled
  // from off, so fall open rather than guessing — the deny-list and the frozen
  // list, the two that must always hold, are already applied above. This
  // matches the file's posture everywhere else: uncertainty shows the door.
  if (!data.controlledRoutes) return true;
  if (!data.controlledRoutes.includes(route)) return true;
  return data.enabledRoutes.includes(route);
}

/** Same rule, same defect, same fix — for a flag key rather than a route. */
export function resolveFlagEnabled(data: FeatureFlagsResponse | undefined, key: string): boolean {
  if (!data) return true;
  if (data.disabledKeys?.includes(key)) return false;
  if (!data.controlledKeys) return true;
  if (!data.controlledKeys.includes(key)) return true;
  return data.enabledKeys.includes(key);
}

export function useFeatureFlags() {
  // /api/config/features requires auth — without a Clerk session cookie
  // it 401s on every public-page visit. Gate on a session cookie (the
  // proxy issues suffixed `__session_<hash>=` cookies; the shared helper
  // handles both that and the legacy bare name).
  const hasSession = hasAnyClerkSession();

  const { data, isLoading } = useQuery<FeatureFlagsResponse>({
    queryKey: ["/api/config/features"],
    enabled: hasSession,
    staleTime: 5 * 60 * 1000, // Cache 5 minutes — flags don't change often
    refetchOnWindowFocus: false,
  });

  return {
    enabledKeys: data?.enabledKeys ?? [],
    enabledRoutes: data?.enabledRoutes ?? [],
    isLoading: hasSession ? isLoading : false,
    isRouteEnabled: (route: string) => resolveRouteEnabled(data, route),
    isFlagEnabled: (key: string) => resolveFlagEnabled(data, key),
  };
}

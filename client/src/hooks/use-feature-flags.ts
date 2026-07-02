import { useQuery } from "@tanstack/react-query";
import { hasAnyClerkSession } from "@/lib/clerk-session-detect";

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
}

/**
 * Pure route/flag decision logic, exported for tests. Precedence:
 * 1. no data (loading / unauthenticated / error) → show everything
 * 2. explicit deny-list hit → hidden
 * 3. empty enabled-list → show everything (flags system unused)
 * 4. otherwise → must be in the enabled-list
 */
export function resolveRouteEnabled(data: FeatureFlagsResponse | undefined, route: string): boolean {
  if (!data) return true;
  if (data.disabledRoutes?.includes(route)) return false;
  if (data.enabledRoutes.length === 0) return true;
  return data.enabledRoutes.includes(route);
}

export function resolveFlagEnabled(data: FeatureFlagsResponse | undefined, key: string): boolean {
  if (!data) return true;
  if (data.disabledKeys?.includes(key)) return false;
  if (data.enabledKeys.length === 0) return true;
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

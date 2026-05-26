import { useQuery } from "@tanstack/react-query";
import { hasAnyClerkSession } from "@/lib/clerk-session-detect";

interface FeatureFlagsResponse {
  enabledKeys: string[];
  enabledRoutes: string[];
  // Mobile shell spike — sourced from founder_settings `mobile.new_shell_enabled`.
  // Optional so older server responses (without this field) still parse.
  mobileShellEnabled?: boolean;
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
    mobileShellEnabled: data?.mobileShellEnabled ?? false,
    isLoading: hasSession ? isLoading : false,
    isRouteEnabled: (route: string) => {
      if (!data) return true; // While loading (or unauthenticated), show everything
      // If no routes are configured at all, show everything (no flags = all enabled)
      if (data.enabledRoutes.length === 0) return true;
      return data.enabledRoutes.includes(route);
    },
    isFlagEnabled: (key: string) => {
      if (!data) return true;
      if (data.enabledKeys.length === 0) return true;
      return data.enabledKeys.includes(key);
    },
  };
}

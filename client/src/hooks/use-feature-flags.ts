import { useQuery } from "@tanstack/react-query";

interface FeatureFlagsResponse {
  enabledKeys: string[];
  enabledRoutes: string[];
}

export function useFeatureFlags() {
  const { data, isLoading } = useQuery<FeatureFlagsResponse>({
    queryKey: ["/api/config/features"],
    staleTime: 5 * 60 * 1000, // Cache 5 minutes — flags don't change often
    refetchOnWindowFocus: false,
  });

  return {
    enabledKeys: data?.enabledKeys ?? [],
    enabledRoutes: data?.enabledRoutes ?? [],
    isLoading,
    isRouteEnabled: (route: string) => {
      if (!data) return true; // While loading, show everything
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

import { useEffect } from "react";
import { prefetchRoute } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";

const NEXT_ROUTES: Record<string, string[]> = {
  "/": ["/leads", "/properties", "/deals"],
  "/leads": ["/properties", "/deals", "/campaigns"],
  "/properties": ["/deals", "/analytics", "/listings"],
  "/deals": ["/properties", "/analytics", "/documents"],
  "/analytics": ["/finance", "/portfolio"],
  "/campaigns": ["/leads", "/inbox"],
};

const API_FOR: Record<string, string[]> = {
  "/leads": ["/api/leads"],
  "/properties": ["/api/properties"],
  "/deals": ["/api/deals"],
  "/analytics": ["/api/dashboard/stats"],
  "/": ["/api/dashboard/stats"],
};

export function useNextRoutePrefetch(pathname: string | undefined) {
  const { isAuthenticated } = useAuth();
  useEffect(() => {
    if (!pathname) return;
    // Every target below is an authenticated API. Firing them while the
    // user is on the public landing page floods the console with 401s,
    // wastes server CPU, and (for third-party proxies) can count as
    // failed auth attempts. Skip prefetch until the user is signed in.
    if (!isAuthenticated) return;

    const apis = API_FOR[pathname] || [];
    apis.forEach(prefetchRoute);

    const nexts = NEXT_ROUTES[pathname] || [];
    nexts.forEach((route) => {
      const apis = API_FOR[route] || [];
      apis.forEach(prefetchRoute);
    });
  }, [pathname, isAuthenticated]);
}

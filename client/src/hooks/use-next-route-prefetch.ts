import { useEffect } from "react";
import { prefetchRoute } from "@/lib/queryClient";

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
  useEffect(() => {
    if (!pathname) return;
    const apis = API_FOR[pathname] || [];
    apis.forEach(prefetchRoute);

    const nexts = NEXT_ROUTES[pathname] || [];
    nexts.forEach((route) => {
      const apis = API_FOR[route] || [];
      apis.forEach(prefetchRoute);
    });
  }, [pathname]);
}

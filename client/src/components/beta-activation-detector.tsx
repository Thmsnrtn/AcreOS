import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";

/**
 * Invisible component that tracks sessions and page views for beta analytics.
 * Renders nothing — mounted in AppContent for all authenticated users.
 */
export function BetaActivationDetector() {
  const { user } = useAuth();
  const [location] = useLocation();
  const sessionIdRef = useRef<number | null>(null);
  const lastPathRef = useRef<string>("");

  // Start session on mount
  useEffect(() => {
    if (!user) return;

    let sessionId: number | null = null;

    apiRequest("POST", "/api/analytics/session/start", {})
      .then((res) => res.json())
      .then((data) => {
        sessionId = data.sessionId;
        sessionIdRef.current = sessionId;
      })
      .catch(() => { /* graceful degrade */ });

    return () => {
      if (sessionId) {
        // End session on unmount (page close). Wrap the body in a Blob with
        // explicit application/json type — sendBeacon with a raw string
        // sends Content-Type: text/plain by default, which the server's
        // validateContentType middleware rejects with 415. Matches the
        // pattern in lib/telemetry.ts.
        navigator.sendBeacon?.(
          "/api/analytics/session/end",
          new Blob([JSON.stringify({ sessionId })], { type: "application/json" })
        );
      }
    };
  }, [user]);

  // Track page views
  useEffect(() => {
    if (!user || !location || location === lastPathRef.current) return;
    lastPathRef.current = location;

    const sid = sessionIdRef.current;
    if (sid) {
      apiRequest("POST", "/api/analytics/pageview", { sessionId: sid, path: location }).catch(() => {});
    }
  }, [location, user]);

  return null;
}

/**
 * useIsFounder() — server-checked founder identity.
 *
 * Wraps the GET /api/auth/is-founder endpoint added in Phase 1.4. Returns
 * `true` only after the server confirms the current user matches
 * FOUNDER_EMAIL/FOUNDER_EMAILS or FOUNDER_USER_IDS. Returns `false` while
 * loading, on 404 (server says "no"), or any other error.
 *
 * The endpoint deliberately returns 404 — not 403 — to non-founders so
 * non-founders cannot distinguish missing from forbidden. This hook treats
 * 404 the same as "not a founder."
 *
 * Founder routes registered with this hook MUST also be guarded server-side
 * by `requireFounder`. The client check is for UX (hide founder UI from
 * non-founders); the server check is the authorization boundary.
 */
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";

export function useIsFounder(): boolean {
  const { isAuthenticated } = useAuth();

  const { data } = useQuery<boolean>({
    queryKey: ["auth", "is-founder"],
    queryFn: async () => {
      try {
        const res = await fetch("/api/auth/is-founder", {
          credentials: "include",
          cache: "no-store",
        });
        if (!res.ok) return false;
        const json = (await res.json()) as { isFounder?: boolean };
        return json.isFounder === true;
      } catch {
        return false;
      }
    },
    enabled: isAuthenticated,
    staleTime: Infinity,
    retry: false,
  });

  return data === true;
}

/**
 * Canonical Clerk session-touch helper.
 *
 * On a 401 from /api/* in a browser that still has a Clerk session cookie,
 * we POST to the Clerk proxy's session-touch endpoint to refresh the
 * `__session` JWT, then let the caller retry once. This closes a race
 * Cycle 3 r1 surfaced where the 45s keep-alive interval could fire after
 * the 60s+30s JWT validity window expired but before the next scheduled
 * touch — an in-flight fetch arrived with an expired cookie.
 *
 * Previously duplicated in:
 *   - client/src/hooks/use-auth.ts (touchClerkSession)
 *   - client/src/lib/queryClient.ts (refreshSessionCookie)
 *
 * The queryClient copy only handled the bare `__session=` cookie name,
 * which silently broke on browsers where Clerk had set the suffixed
 * `__session_<hash>=` form. This canonical version uses readClerkSessionJwt
 * (clerk-session-detect.ts) to tolerate both.
 */
import { readClerkSessionJwt } from "@/lib/clerk-session-detect";

export async function touchClerkSession(): Promise<void> {
  try {
    const jwt = readClerkSessionJwt();
    if (!jwt) return;
    const payload = JSON.parse(
      atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    const sid = payload?.sid;
    if (!sid) return;
    await fetch(
      `/__clerk/v1/client/sessions/${sid}/touch?__clerk_api_version=2025-11-10&_clerk_js_version=6.7.4`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "active_organization_id=",
        credentials: "include",
      },
    );
  } catch {
    // best effort
  }
}

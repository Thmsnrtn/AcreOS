/**
 * Which URL paths are owned by the FOUNDER build (dist/founder) rather than the
 * customer build (dist/public) — P1-9 / X-2, the two-output split.
 *
 * One list, read by BOTH sides so they cannot drift:
 *   - server/static.ts serves dist/founder/founder.html for these paths and the
 *     customer shell for everything else;
 *   - the client's cross-build navigation (client/src/lib/cross-build.ts) hands
 *     a wouter navigation off to a full page load when the target path belongs
 *     to the other build (wouter cannot cross builds).
 *
 * This is a build/serving split only. It is NOT an authorization list: every
 * founder surface stays guarded server-side (requireFounder) and by
 * FounderProtectedRoute, exactly as before.
 *
 * `/commissions` is deliberately absent: its page module is shared with the
 * customer's Finance → Commissions surface, so it stays in the customer build
 * (still behind FounderProtectedRoute).
 * `/founder-dashboard` is deliberately absent too: it is a legacy alias the
 * customer build redirects to `/founder`; it is neither `/founder` nor
 * `/founder/*`.
 */

/** Founder-gated pages that live at URLs outside the /founder prefix. */
const FOUNDER_GATED_NON_PREFIXED_PATHS = [
  "/admin/safety-gates",
  "/executive-dashboard",
  "/dunning",
  "/reseller",
  "/agent-performance",
  "/job-health",
] as const;

/** Strip query, fragment and trailing slashes; "" becomes "/". */
function normalizePath(rawPath: string): string {
  const path = rawPath.split("?")[0].split("#")[0].replace(/\/+$/, "");
  return path === "" ? "/" : path;
}

/** True when `rawPath` is served by (and routed inside) the founder build. */
export function isFounderBuildPath(rawPath: string): boolean {
  const path = normalizePath(rawPath);
  if (path === "/founder" || path.startsWith("/founder/")) return true;
  return (FOUNDER_GATED_NON_PREFIXED_PATHS as readonly string[]).includes(path);
}

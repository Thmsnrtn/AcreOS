/**
 * Route redirect map — Phase 2 Week 4 (P1-26 / Reyna §2).
 *
 * When the IA collapse landed, several legacy routes were aliased onto
 * canonical paths. Wouter `<Redirect />` sends users to the canonical
 * surface; this file documents the sunset schedule so we can remove the
 * legacy `<Route>` registrations 60 days from the redirect's introduction.
 *
 * Removal protocol:
 *   1. After `sunsetOn`, delete the legacy `<Route>` from `App.tsx` and
 *      its lazy-import. Wouter will fall through to `<NotFound />`.
 *   2. Search `git grep` for any in-app `<Link>` / `useLocation` push that
 *      still targets the legacy path; rewrite to `canonical`.
 *   3. Drop the entry from this map.
 *
 * Today: 2026-05-03. All redirects below sunset on 2026-07-02 (60 days).
 */

export interface RouteRedirect {
  /** Legacy path that should redirect. */
  legacy: string;
  /** Canonical path the user is sent to. */
  canonical: string;
  /** ISO date (YYYY-MM-DD) after which the legacy `<Route>` may be deleted. */
  sunsetOn: string;
  /** One-line rationale — why the duplicate existed and which is canonical. */
  reason: string;
}

export const ROUTE_REDIRECTS: readonly RouteRedirect[] = [
  {
    legacy: "/dashboard",
    canonical: "/today",
    sunsetOn: "2026-07-02",
    reason:
      "Both rendered TodayPage. /today is the v6 canonical hub; /dashboard pre-dates the rename and is kept only for old bookmarks.",
  },
  {
    legacy: "/team-inbox",
    canonical: "/team",
    sunsetOn: "2026-07-02",
    reason:
      "/team and /team-inbox both rendered TeamInboxPage. /team is the shorter, sidebar-linked canonical path.",
  },
  {
    legacy: "/founder-home",
    canonical: "/founder",
    sunsetOn: "2026-07-02",
    reason:
      "/founder and /founder-home both rendered FounderHomePage. /founder is the canonical founder-surface root.",
  },
] as const;

/** Lookup helper: returns the canonical path for a legacy path, or null. */
export function getCanonicalPath(legacy: string): string | null {
  return ROUTE_REDIRECTS.find((r) => r.legacy === legacy)?.canonical ?? null;
}

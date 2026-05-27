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
    canonical: "/founder/bridge",
    sunsetOn: "2026-07-26",
    reason:
      "IA consolidation (Lens 4): /founder/bridge is the canonical founder home. /founder-home, /founder-dashboard, /founder/now, /founder/cockpit, /founder/dashboard all redirected here.",
  },
  {
    legacy: "/founder-dashboard",
    canonical: "/founder/bridge",
    sunsetOn: "2026-07-26",
    reason:
      "IA consolidation (Lens 4): legacy 7,400-line operations console. Sidebar overflow still links here as 'Operations console (legacy)' but the route now redirects to bridge.",
  },
  {
    legacy: "/founder/now",
    canonical: "/founder/bridge",
    sunsetOn: "2026-07-26",
    reason:
      "IA consolidation (Lens 4): tile-driven daily inbox folded into the bridge surface.",
  },
  {
    legacy: "/founder/cockpit",
    canonical: "/founder/bridge",
    sunsetOn: "2026-07-26",
    reason:
      "IA consolidation (Lens 4): weekly steering folded into the bridge. /founder/steering still renders the cockpit component for the sidebar 'Steering' entry.",
  },
  {
    legacy: "/founder/dashboard",
    canonical: "/founder/bridge",
    sunsetOn: "2026-07-26",
    reason:
      "IA consolidation (Lens 4): legacy LegacyNowSurface tile layout folded into the bridge surface.",
  },
  /* ── Phase 4 Week 19-20 (cmdk-v2 / Anya §8) ─────────────────────────
   * ⌘K is the discoverability spine. The Pax assistant, AI hub and
   * agent surfaces are now reached via ⌘K → "Ask Pax" affordance, not
   * via memorizable URL prefixes that competed with ⌘K for muscle
   * memory. The legacy paths redirect to the AI hub for 60 days; on
   * sunsetOn they may be deleted from App.tsx outright.
   */
  {
    legacy: "/pax",
    canonical: "/ai",
    sunsetOn: "2026-07-02",
    reason:
      "Discoverability promotion: ⌘K is the canonical entry point to Pax. /pax remains aliased to /ai (the AI hub) until 2026-07-02; in-app references replaced with ⌘K hints in cmdk-v2.",
  },
  {
    legacy: "/agents",
    canonical: "/ai#agents",
    sunsetOn: "2026-07-02",
    reason:
      "Agents tab now lives inside the AI hub at /ai#agents. The standalone /agents URL is kept for old bookmarks; ⌘K is the primary discovery surface.",
  },
  {
    legacy: "/ai-team",
    canonical: "/ai#agents",
    sunsetOn: "2026-07-02",
    reason:
      "Synonym for /agents — same destination, kept for bookmark/email-link compatibility while in-app references migrate to ⌘K.",
  },
  {
    legacy: "/command-center",
    canonical: "/ai#chat",
    sunsetOn: "2026-07-02",
    reason:
      "Pre-cmdk-v2 name for the chat hub. Replaced by ⌘K's Ask Pax affordance; redirect kept for 60 days.",
  },
] as const;

/** Lookup helper: returns the canonical path for a legacy path, or null. */
export function getCanonicalPath(legacy: string): string | null {
  return ROUTE_REDIRECTS.find((r) => r.legacy === legacy)?.canonical ?? null;
}

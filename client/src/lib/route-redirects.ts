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
  /* /founder-home entry removed 2026-07-27: its 2026-07-26 sunset passed, so
   * per the removal protocol above the legacy <Route> was deleted from
   * App.tsx and the last in-app references (sidebar active-state checks)
   * were rewritten. The remaining founder aliases (sunset 2026-07-26/27,
   * passed) moved to FOUNDER_LEGACY_REDIRECTS below on 2026-08-10 — they
   * keep redirecting (live email/server links point at them) but through a
   * single catch-all route instead of 24 per-path registrations. */
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

/* ── Founder legacy-path collapse (F1 slice 1, 2026-08-10) ──────────────
 *
 * The founder surface carried 24 redirect-only <Route> registrations —
 * nearly a third of all path="/founder…" entries in App.tsx. They are now
 * ONE catch-all route (see FounderLegacyRedirect in App.tsx) that resolves
 * this map. All sunsets here have passed; the aliases survive only because
 * live artifacts (sent emails, action-queue rows, old bookmarks) still
 * point at them. Chains are pre-flattened: every value is a REAL registered
 * route in App.tsx, never another legacy key —
 * founderLegacyRedirects.test.ts enforces both properties.
 *
 * The query string is preserved on every redirect (wouter's <Redirect>
 * drops it otherwise), so e.g. /founder/asks?id=N still carries the ask id
 * to /founder/decisions?id=N. A canonical value may carry its own query
 * (a hub ?tab= pin); composeFounderRedirect merges it over the incoming
 * search, canonical params winning.
 */
export const FOUNDER_LEGACY_REDIRECTS: Readonly<Record<string, string>> = {
  // Retired founder homes — all fold into The Letter (/founder).
  "/founder-dashboard": "/founder", // legacy 7,400-line operations console
  "/founder/now": "/founder", // tile-driven daily inbox
  "/founder/cockpit": "/founder", // weekly steering (component lives on at /founder/steering)
  "/founder/dashboard": "/founder", // LegacyNowSurface tile layout
  "/founder/today": "/founder", // Solene-migration Today door, fused into the home
  "/founder/autopilot": "/founder", // the Letter overview, fused into the home (D6)
  "/founder/daily-digest": "/founder", // 2026-06-01 cut — page archived
  "/founder/todo": "/founder", // chained through /founder/today; flattened
  // Renames / consolidations with a real successor surface.
  "/founder/solene-chat": "/founder/chat", // internal codename out of the URL bar
  "/founder/asks": "/founder/decisions", // one "things that need me" queue (query preserved)
  "/founder/financials": "/founder/admin/costs", // 2026-06-01 cut — costs hub owns it
  "/founder/feature-flags": "/founder/features", // binary-flag page consolidated
  "/founder/activation": "/founder/onboarding", // 2026-06-01 cut
  "/founder/prompt-versions": "/founder/prompt-evolutions", // 2026-06-01 cut
  "/founder/agents": "/founder/agent-queue", // 2026-06-01 cut (/founder/agents/:codename stays real)
  // 2026-06-01 cut pages whose remit folded into the Bridge deep tool.
  "/founder/integrations": "/founder/bridge",
  "/founder/dsar": "/founder/bridge",
  "/founder/legal-holds": "/founder/bridge",
  "/founder/sub-processors": "/founder/bridge",
  "/founder/ml-snapshots": "/founder/bridge",
  "/founder/etl": "/founder/bridge",
  "/founder/title-partners": "/founder/bridge",
  "/founder/beta-analytics": "/founder/bridge",
  "/founder/v13": "/founder/bridge", // Census W3-1 retire 2026-06-11
  // ── F1 slice 2 (2026-08-10): observability cluster → /founder/admin/telemetry.
  // Six standalone routes folded into the tabbed hub (mirrors the
  // /founder/admin/costs consolidation); each alias pins its old tab.
  "/founder/ai-observatory": "/founder/admin/telemetry?tab=observatory",
  "/founder/telemetry": "/founder/admin/telemetry?tab=api",
  "/founder/traces": "/founder/admin/telemetry?tab=traces",
  "/founder/pax-traces": "/founder/admin/telemetry?tab=pax-traces",
  "/founder/pax-calibration": "/founder/admin/telemetry?tab=calibration",
  "/founder/event-log": "/founder/admin/telemetry?tab=events",
  // ── F1 slice 3 (2026-08-10): P6 Controls-absorption cluster → the Controls
  // door. Your Voice (standing orders), Launch readiness, Legal readiness,
  // System keys and the Recovery console are tabs of
  // /founder/autopilot/control now; each alias pins its tab.
  "/founder/autopilot/voice": "/founder/autopilot/control?tab=voice",
  "/founder/readiness": "/founder/autopilot/control?tab=readiness",
  "/founder/legal-readiness": "/founder/autopilot/control?tab=legal",
  "/founder/keys": "/founder/autopilot/control?tab=keys",
  "/founder/recovery-console": "/founder/autopilot/control?tab=recovery",
};

/**
 * The one catch-all pattern replacing the 24 registrations. A RegExp
 * (not a string) because wouter's segment-based string patterns cannot
 * express "/founder-dashboard OR /founder/<anything>" in one literal.
 * Deliberately does NOT match bare "/founder" (the real home, matched
 * earlier in the Switch) nor public marketing paths like /founders-club.
 */
export const FOUNDER_LEGACY_ROUTE_PATTERN = /^\/founder(?:-dashboard|\/.+)$/i;

/** Resolve a pathname against FOUNDER_LEGACY_REDIRECTS, or null. */
export function resolveFounderLegacyPath(pathname: string): string | null {
  const normalized = pathname.replace(/\/+$/, "").toLowerCase();
  return FOUNDER_LEGACY_REDIRECTS[normalized] ?? null;
}

/**
 * Compose the final redirect target from a canonical map value and the
 * incoming location's search string. Naive concatenation broke the moment a
 * canonical value carried its own query (`…?tab=api` + `?id=3` →
 * `…?tab=api?id=3`), so the two are merged as params — the canonical query
 * wins on conflict, because it pins which hub tab the legacy path maps to.
 */
export function composeFounderRedirect(canonical: string, incomingSearch: string): string {
  const [pathname, canonicalQuery] = canonical.split("?");
  const params = new URLSearchParams(incomingSearch);
  for (const [key, value] of new URLSearchParams(canonicalQuery ?? "")) {
    params.set(key, value);
  }
  const search = params.toString();
  return search ? `${pathname}?${search}` : pathname;
}

/* ── Settings legacy redirects (Wave 1.5, 2026-08-10) ───────────────────
 *
 * Same mechanism as the founder collapse above, but for the settings
 * surface: every legacy `?tab=`/`#hash` form on /settings (including the
 * upgrade-toast pseudo-query `#billing?tier=pro`), and the retired
 * /settings/email + /settings/mail slugs resolve onto the routed
 * `/settings/<section>` set. The map lives WITH the section registry in
 * `./settings-sections` — one source of truth with the rail and the ⌘K
 * palette, so a legacy value can only ever point at a live routed section
 * (settingsDecomposition.test.ts enforces it, mirroring
 * founderLegacyRedirects.test.ts). Re-exported here so this file remains
 * the one place to look for "where do old paths go".
 */
export {
  SETTINGS_LEGACY_REDIRECTS,
  resolveLegacySettingsTab,
  resolveLegacySettingsLocation,
} from "./settings-sections";

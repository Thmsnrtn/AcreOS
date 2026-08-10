/**
 * Single source of truth for the public AcreOS marketing routes.
 *
 * Used by:
 *  - `script/generate-sitemap.ts` to regenerate `client/public/sitemap.xml`
 *  - `script/prerender.ts` to know which routes to pre-render
 *  - any future "what does the search engine see" tooling
 *
 * Each entry should be:
 *  - publicly accessible without authentication
 *  - safe to crawl (no PII / no per-tenant data)
 *  - intentionally indexable (we set noindex via robots.txt for the rest)
 */

import {
  BUSINESS_TYPES,
  BUSINESS_TYPE_IDS,
  type BusinessTypeId,
} from "../business-types";

export interface PublicRoute {
  /** Path including leading slash. Use `/` for the root. */
  path: string;
  /** Sitemap changefreq hint. */
  changefreq:
    | "always"
    | "hourly"
    | "daily"
    | "weekly"
    | "monthly"
    | "yearly"
    | "never";
  /** Sitemap priority (0.0 — 1.0). */
  priority: number;
  /** Short human label — useful for build logs and tests. */
  label: string;
  /**
   * Whether this route should be statically pre-rendered at build time
   * (script/prerender.ts). Set false for routes that genuinely need the
   * client app to mount (auth, /status — pings live infra).
   */
  prerender: boolean;
}

// ───────────────────────────────────────────────────────────────────────────
// G1.3 — /for/<vertical> marketing pages, one per registered business type.
//
// The slug map is the single source of truth for the URL of each vertical's
// marketing page. Slugs are kebab-case, operator-plural where the registry
// label names an operator ("/for/land-flippers" per the G1 exit line) and
// strategy-named otherwise. The page itself
// (client/src/pages/for/vertical.tsx) renders PURELY from the registries
// (shared/business-types.ts + client/src/lib/onboarding-verticals.ts), so a
// registry change flows to every page without touching this file — only a
// brand-new vertical id needs a new slug here, and
// tests/unit/forVerticalRoutes.test.ts fails until it gets one.
// ───────────────────────────────────────────────────────────────────────────

export const FOR_VERTICAL_SLUGS: Record<BusinessTypeId, string> = {
  land_flipper: "land-flippers",
  note_investor: "note-investors",
  hybrid: "land-and-notes",
  residential_wholesaler: "residential-wholesalers",
  fix_and_flip: "fix-and-flip",
  buy_and_hold: "buy-and-hold",
  short_term_rental: "short-term-rentals",
  commercial: "commercial-real-estate",
  creative_finance: "creative-finance",
  developer: "developers",
  subdivider: "subdividers",
  tax_lien_deed: "tax-liens",
  multifamily: "multifamily",
  mobile_home: "mobile-home-parks",
  agent_investor: "agent-investors",
};

/** Canonical /for path for a registered vertical. */
export function forVerticalPath(id: BusinessTypeId): string {
  return `/for/${FOR_VERTICAL_SLUGS[id]}`;
}

/** Reverse lookup: /for/:vertical slug → registry id, or null if unknown. */
export function slugToBusinessTypeId(slug: string): BusinessTypeId | null {
  for (const id of BUSINESS_TYPE_IDS) {
    if (FOR_VERTICAL_SLUGS[id] === slug) return id;
  }
  return null;
}

/**
 * One PublicRoute per registered vertical, derived from the live registry so
 * the sitemap + robots.txt can never drop (or strand) a vertical's page.
 *
 * prerender:false deliberately: script/prerender.ts FAILS THE BUILD for any
 * prerender:true route without a META_BY_PATH entry, and authoring those 15
 * head-meta entries lives in that script (same posture as the /compare
 * landers). The pages are still sitemap-listed, robots-allowed, and
 * internally linked from the landing footer; flipping prerender on is a
 * deliberate follow-up in script/prerender.ts, not here.
 */
export function listForVerticalRoutes(): PublicRoute[] {
  return BUSINESS_TYPE_IDS.map((id) => ({
    path: forVerticalPath(id),
    changefreq: "monthly" as const,
    priority: 0.8,
    label: `For ${BUSINESS_TYPES[id].label}`,
    prerender: false,
  }));
}

export const PUBLIC_ROUTES: PublicRoute[] = [
  { path: "/", changefreq: "weekly", priority: 1.0, label: "Landing", prerender: true },
  { path: "/pricing", changefreq: "monthly", priority: 0.9, label: "Pricing", prerender: true },
  { path: "/why", changefreq: "monthly", priority: 0.8, label: "Why we built this", prerender: true },
  // The Land Credit Score — AcreOS's category-defining owned noun. Public,
  // ungated explainer (client/src/pages/landing/LandCreditScore.tsx). High
  // priority: this is the term we want to own in search.
  { path: "/land-credit-score", changefreq: "monthly", priority: 0.9, label: "Land Credit Score", prerender: true },
  { path: "/security", changefreq: "monthly", priority: 0.7, label: "Security", prerender: true },
  // Routed + sitemapped by the canonical generator but was missing from
  // this enumeration (slice-4 audit drift note): robots Allow follows from
  // listing it here. Carries the provable-claims section (G1.4).
  { path: "/transparency", changefreq: "monthly", priority: 0.6, label: "Transparency & proof", prerender: false },
  { path: "/glossary", changefreq: "monthly", priority: 0.7, label: "Glossary", prerender: true },
  // Learn hub — lists every authored state×vertical + county primer. Fully
  // static (registries resolve at build time, no client fetch), so it
  // pre-renders and is the crawlable parent of the /learn/* deep pages.
  { path: "/learn", changefreq: "weekly", priority: 0.8, label: "Learn hub", prerender: true },
  // Comparison landers — high-intent "[competitor] alternative" search
  // traffic. prerender:false because the page mounts a noindex meta tag
  // until the founder fills in positioning copy (see ComparisonPage.tsx).
  // Once those go live we flip prerender on and drop the noindex guard.
  // NOTE: deliberately ABSENT from sitemap.xml while noindex'd — the
  // canonical generator (scripts/generate-sitemap.mjs, the only one; its
  // .ts twin was deleted 2026-08-10 after regenerating with it broke the
  // build's --check) excludes them, and a sitemapped-noindex page is a
  // Search Console error. These rows still drive robots Allow + prerender.
  { path: "/compare/acreos-vs-propstream", changefreq: "monthly", priority: 0.7, label: "Compare · PropStream", prerender: false },
  { path: "/compare/acreos-vs-dealmachine", changefreq: "monthly", priority: 0.7, label: "Compare · DealMachine", prerender: false },
  { path: "/changelog", changefreq: "weekly", priority: 0.6, label: "Changelog", prerender: true },
  { path: "/auth", changefreq: "monthly", priority: 0.5, label: "Sign in", prerender: false },
  { path: "/status", changefreq: "daily", priority: 0.5, label: "Status", prerender: false },
  { path: "/legal/sub-processors", changefreq: "monthly", priority: 0.4, label: "Sub-processors", prerender: false },
  { path: "/terms", changefreq: "yearly", priority: 0.3, label: "Terms", prerender: false },
  // ToS §16 promises this page exists — it was in the committed sitemap but
  // never in this enumeration, so a regeneration silently dropped it (slice-3
  // audit catch). Enumerated so that can never happen again.
  { path: "/terms/history", changefreq: "yearly", priority: 0.2, label: "Terms history", prerender: false },
  { path: "/privacy", changefreq: "yearly", priority: 0.3, label: "Privacy", prerender: false },
  // Published field notes (community letters) — live public route + its own
  // crawler feed (sitemap-notes.xml, appended in buildRobots).
  { path: "/field-notes", changefreq: "weekly", priority: 0.5, label: "Field notes", prerender: false },
  // Free public tools — high-intent "free [x]" search traffic. These prove
  // the data moat without auth, so they should be indexed. prerender:false
  // because they mount interactive widgets that need the client app to boot.
  { path: "/tools/parcel-check", changefreq: "monthly", priority: 0.8, label: "Free parcel check", prerender: false },
  { path: "/tools/calculator", changefreq: "monthly", priority: 0.8, label: "Free land deal calculator", prerender: false },
  // Public read-only demo workspace (G1.2). prerender:false — the page
  // mounts a live /api/demo/status fetch and renders an honest
  // "demo not provisioned" state when no demo org is configured.
  { path: "/demo", changefreq: "monthly", priority: 0.7, label: "Live demo", prerender: false },
  // G1.3 — one /for/<vertical> page per registered business type, derived
  // from the live registry (see listForVerticalRoutes above).
  ...listForVerticalRoutes(),
];

export const SITE_BASE_URL = "https://acreos.io";

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

export const PUBLIC_ROUTES: PublicRoute[] = [
  { path: "/", changefreq: "weekly", priority: 1.0, label: "Landing", prerender: true },
  { path: "/pricing", changefreq: "monthly", priority: 0.9, label: "Pricing", prerender: true },
  { path: "/why", changefreq: "monthly", priority: 0.8, label: "Why we built this", prerender: true },
  // The Land Credit Score — AcreOS's category-defining owned noun. Public,
  // ungated explainer (client/src/pages/landing/LandCreditScore.tsx). High
  // priority: this is the term we want to own in search.
  { path: "/land-credit-score", changefreq: "monthly", priority: 0.9, label: "Land Credit Score", prerender: true },
  { path: "/security", changefreq: "monthly", priority: 0.7, label: "Security", prerender: true },
  { path: "/glossary", changefreq: "monthly", priority: 0.7, label: "Glossary", prerender: true },
  // Comparison landers — high-intent "[competitor] alternative" search
  // traffic. prerender:false because the page mounts a noindex meta tag
  // until the founder fills in positioning copy (see ComparisonPage.tsx).
  // Once those go live we flip prerender on and drop the noindex guard.
  { path: "/compare/acreos-vs-propstream", changefreq: "monthly", priority: 0.7, label: "Compare · PropStream", prerender: false },
  { path: "/compare/acreos-vs-dealmachine", changefreq: "monthly", priority: 0.7, label: "Compare · DealMachine", prerender: false },
  { path: "/changelog", changefreq: "weekly", priority: 0.6, label: "Changelog", prerender: true },
  { path: "/auth", changefreq: "monthly", priority: 0.5, label: "Sign in", prerender: false },
  { path: "/status", changefreq: "daily", priority: 0.5, label: "Status", prerender: false },
  { path: "/legal/sub-processors", changefreq: "monthly", priority: 0.4, label: "Sub-processors", prerender: false },
  { path: "/terms", changefreq: "yearly", priority: 0.3, label: "Terms", prerender: false },
  { path: "/privacy", changefreq: "yearly", priority: 0.3, label: "Privacy", prerender: false },
  // Free public tools — high-intent "free [x]" search traffic. These prove
  // the data moat without auth, so they should be indexed. prerender:false
  // because they mount interactive widgets that need the client app to boot.
  { path: "/tools/parcel-check", changefreq: "monthly", priority: 0.8, label: "Free parcel check", prerender: false },
  { path: "/tools/calculator", changefreq: "monthly", priority: 0.8, label: "Free land deal calculator", prerender: false },
];

export const SITE_BASE_URL = "https://acreos.io";

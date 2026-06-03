// ============================================================================
// SHARED/SCHEMA/SOREN-SEO.TS
// ----------------------------------------------------------------------------
// Soren (CGO) — SEO ranking ledger for the /learn programmatic pages.
//
// One table: `soren_seo_rankings`. Each row is a (page × keyword × check)
// observation. `google_rank` is nullable — null means the page was not
// found in the first 100 SERP results. The `source` column ('serp_scrape'
// today; 'value_serp' / 'data_for_seo' as paid APIs land) lets a future
// data-provider swap happen without a schema migration.
//
// Indexed on (page_path, checked_at) for trend queries and (target_keyword,
// checked_at) for keyword-level reports. The shape stays narrow on purpose
// — Soren expands fields (SERP feature flags, knowledge-panel presence,
// People-Also-Ask presence) in follow-on dispatches.
// ============================================================================

import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

// ============================================
// SOREN_SEO_RANKINGS
// ============================================
export const sorenSeoRankings = pgTable(
  "soren_seo_rankings",
  {
    id: serial("id").primaryKey(),
    pagePath: text("page_path").notNull(), // e.g. /learn/land-flipping/texas
    targetKeyword: text("target_keyword").notNull(),
    // null = not found in the first SERP_MAX_RANK results (100 by default).
    googleRank: integer("google_rank"),
    // Provenance — lets the founder reason about reading reliability.
    // 'serp_scrape' is the free fallback; swap to 'value_serp' or
    // 'data_for_seo' when budget allows.
    source: text("source").notNull().default("serp_scrape"),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("soren_seo_rankings_page_checked_idx").on(t.pagePath, t.checkedAt),
    index("soren_seo_rankings_keyword_checked_idx").on(t.targetKeyword, t.checkedAt),
  ],
);

export type SorenSeoRanking = typeof sorenSeoRankings.$inferSelect;
export type InsertSorenSeoRanking = typeof sorenSeoRankings.$inferInsert;

/**
 * The SERP_MAX_RANK is the depth we scan. Rank values higher than this
 * are reported as null — Google rarely surfaces a programmatic-SEO page
 * past page 10, and parsing further pages costs CAPTCHA-friction without
 * actionable signal.
 */
export const SOREN_SERP_MAX_RANK = 100;

/**
 * Rank-change drift threshold. A ≥10-position move (either direction)
 * fires a structured warn log. Smaller moves are noise (Google's
 * per-query personalisation alone can swing 3-5 positions).
 */
export const SOREN_RANK_CHANGE_THRESHOLD = 10;

/**
 * Soren's SEO target — the canonical host used for rank matching. A SERP
 * result whose URL contains this string + the page path counts as our
 * own page. Setting it here (not env-driven) so the test fixture is
 * deterministic — flip via service-level override if a staging host needs
 * to track separately.
 */
export const SOREN_SEO_HOST = "acreos.io";

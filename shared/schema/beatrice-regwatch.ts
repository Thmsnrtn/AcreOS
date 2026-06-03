// ============================================================================
// SHARED/SCHEMA/BEATRICE-REGWATCH.TS
// ----------------------------------------------------------------------------
// Beatrice (CRO) — regulatory-news feed for AcreOS-relevant federal + state
// regulator activity.
//
// One table: `beatrice_reg_events`. Each row is one (source × source_url)
// item that matched the AcreOS-relevance keyword filter. Items that don't
// match are dropped at ingest time — Beatrice doesn't want the table
// flooded with irrelevant CFPB press releases.
//
// Idempotency on (source, source_url) so the daily cron is a no-op for
// items already-seen. `beatrice_reviewed` is the manual marker Beatrice
// flips after triage (per docs/legal/beatrice-regwatch-discipline.md).
// ============================================================================

import {
  pgTable,
  text,
  serial,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ============================================
// BEATRICE_REG_EVENTS
// ============================================
// One row per matched regulatory event. The `severity_keyword_match` jsonb
// list captures which AcreOS-relevance keywords fired — the fan-out shape
// matters: an event matching "TCPA" + "consumer credit" is higher signal
// than one matching only "consumer credit".
export const beatriceRegEvents = pgTable(
  "beatrice_reg_events",
  {
    id: serial("id").primaryKey(),
    source: text("source").notNull(), // 'cfpb' | 'ftc' | 'state_ag_tx' | 'state_ag_ca' | ...
    sourceUrl: text("source_url").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    severityKeywordMatch: jsonb("severity_keyword_match").$type<string[]>().notNull().default([]),
    beatriceReviewed: boolean("beatrice_reviewed").notNull().default(false),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNotes: text("review_notes"),
  },
  (t) => [
    // Dedup at ingest time — the cron fetches the same RSS feed daily.
    uniqueIndex("beatrice_reg_events_source_url_uk").on(t.source, t.sourceUrl),
    index("beatrice_reg_events_published_idx").on(t.publishedAt),
    index("beatrice_reg_events_reviewed_idx").on(t.beatriceReviewed, t.publishedAt),
    index("beatrice_reg_events_source_idx").on(t.source, t.publishedAt),
  ],
);

export type BeatriceRegEvent = typeof beatriceRegEvents.$inferSelect;
export type InsertBeatriceRegEvent = typeof beatriceRegEvents.$inferInsert;

/**
 * Sources Beatrice currently scans. Stored as a const list (not env-driven)
 * so test fixtures can pin against it. Adding a new source is a one-line
 * extension here + a corresponding URL in REG_SOURCE_FEEDS below.
 *
 * State-AG sources start with TX + CA (the two largest jurisdictions for
 * AcreOS operators); additional states are added quarterly per the
 * discipline doc.
 */
export const BEATRICE_REG_SOURCES = [
  "cfpb",
  "ftc",
  "state_ag_tx",
  "state_ag_ca",
] as const;
export type BeatriceRegSource = (typeof BEATRICE_REG_SOURCES)[number];

/**
 * RSS feed URLs per source. CFPB + FTC are official. State-AG RSS feeds
 * are inconsistent — TX and CA both publish press-release RSS; other
 * states require scraping or are HTML-only. Marked nullable so a source
 * registered without a stable feed is a known-skip, not an error.
 */
export const REG_SOURCE_FEEDS: Record<BeatriceRegSource, string | null> = {
  cfpb: "https://files.consumerfinance.gov/f/documents/cfpb_consumer-financial-protection-bureau-rss.xml",
  ftc: "https://www.ftc.gov/news-events/news/press-releases/rss.xml",
  state_ag_tx: "https://www.texasattorneygeneral.gov/rss.xml",
  state_ag_ca: "https://oag.ca.gov/news/press-releases/feed",
};

/**
 * AcreOS-relevance keyword filter. An RSS item is persisted only when
 * its title + summary match at least one of these keywords (case-insensitive).
 * The list is intentionally narrow — false-positives are noise; false-
 * negatives are recoverable on the next cron tick if a keyword is added.
 *
 * Group rationale:
 *   - Note / mortgage servicing: Reg Z, RESPA, loan-servicing, mortgage,
 *     note are direct hits on our acquired-notes + originated-notes flows.
 *   - Land sales: land contract, tax deed catch our flipping verticals.
 *   - Privacy: CCPA, GLBA gate our customer-data posture.
 *   - Communications: TCPA, CAN-SPAM gate outbound (email + SMS).
 *   - Anti-discrimination: fair housing, ECOA gate any lending decision flow.
 */
export const BEATRICE_RELEVANCE_KEYWORDS = [
  // Mortgage / note servicing
  "mortgage",
  "note",
  "reg z",
  "regulation z",
  "respa",
  "loan servicing",
  "loan modification",
  // Land
  "land contract",
  "tax deed",
  "tax sale",
  // Consumer credit
  "consumer credit",
  "consumer financial",
  "TILA",
  "truth in lending",
  // Privacy
  "CCPA",
  "GLBA",
  "gramm-leach",
  "data breach",
  // Communications
  "TCPA",
  "CAN-SPAM",
  "robocall",
  // Anti-discrimination
  "fair housing",
  "ECOA",
  "equal credit",
] as const;

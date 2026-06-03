// ============================================================================
// SHARED/SCHEMA/EXTERNAL-WATCH.TS
// ----------------------------------------------------------------------------
// Layer 1 capability #4 (#17 in the full 32-capability map) — external-world
// feedback loops. Extends Beatrice's regulatory-news shape (CFPB + FTC RSS)
// to other "changing tides" Tom named: Anthropic API changelog (model
// upgrades, deprecations, pricing), npm vulnerability feed, and (later
// dispatches) Fly platform updates, Stripe API versioning, comparable-org
// engineering blogs.
//
// One table: `external_watch_events`. Each row is one (source × source_url)
// item that the per-source service decided to persist. Sources are
// responsible for their own filtering — we accept the row as-given and
// dedupe on (source, source_url).
//
// `ack_status` is the founder-facing review marker: pending → acknowledged /
// actioned / dismissed. Mirrors Beatrice's `beatrice_reviewed` flag but
// generalises to four states so we can distinguish "Tom saw it" from
// "Tom did something about it" (the latter writes `action_taken`).
// ============================================================================

import {
  pgTable,
  text,
  serial,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ============================================
// EXTERNAL_WATCH_EVENTS
// ============================================
export const externalWatchEvents = pgTable(
  "external_watch_events",
  {
    id: serial("id").primaryKey(),
    source: text("source").notNull(), // see EXTERNAL_WATCH_SOURCES
    sourceUrl: text("source_url").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    severityKeywordMatch: jsonb("severity_keyword_match")
      .$type<string[]>()
      .notNull()
      .default([]),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ackStatus: text("ack_status").notNull().default("pending"), // see EXTERNAL_WATCH_ACK_STATUSES
    ackBy: text("ack_by"), // 'iris' | 'beatrice' | 'solene' | 'tom'
    ackAt: timestamp("ack_at", { withTimezone: true }),
    actionTaken: text("action_taken"),
  },
  (t) => [
    // Dedup at ingest time — the cron fetches the same upstream feed daily.
    uniqueIndex("external_watch_events_source_url_uk").on(
      t.source,
      t.sourceUrl,
    ),
    index("external_watch_events_source_fetched_idx").on(t.source, t.fetchedAt),
    index("external_watch_events_published_idx").on(t.publishedAt),
    index("external_watch_events_ack_status_idx").on(
      t.ackStatus,
      t.publishedAt,
    ),
  ],
);

export type ExternalWatchEvent = typeof externalWatchEvents.$inferSelect;
export type InsertExternalWatchEvent = typeof externalWatchEvents.$inferInsert;

/**
 * Sources external-watch scans. New sources land here + get their own
 * service under server/services/external-watch/. The Anthropic + npm
 * watchers ship in this dispatch; Fly, Stripe, and engineering-blog
 * watchers follow in later dispatches.
 */
export const EXTERNAL_WATCH_SOURCES = [
  "anthropic_api",
  "npm_vuln",
  "fly_platform",
  "stripe_api",
  "engineering_blog",
] as const;
export type ExternalWatchSource = (typeof EXTERNAL_WATCH_SOURCES)[number];

export const EXTERNAL_WATCH_ACK_STATUSES = [
  "pending",
  "acknowledged",
  "actioned",
  "dismissed",
] as const;
export type ExternalWatchAckStatus =
  (typeof EXTERNAL_WATCH_ACK_STATUSES)[number];

export const EXTERNAL_WATCH_ACK_BY = [
  "iris",
  "beatrice",
  "solene",
  "tom",
] as const;
export type ExternalWatchAckBy = (typeof EXTERNAL_WATCH_ACK_BY)[number];

/**
 * AcreOS-relevance keyword filter for the Anthropic API changelog. Matched
 * against title + summary (case-insensitive substring) — any single match
 * persists the row. Wider than Beatrice's filter because Anthropic items
 * are already pre-filtered upstream (the changelog only ships
 * model/pricing/API news), so noise risk is low and false negatives are
 * the catastrophic mode (a deprecation we missed).
 *
 * The keyword list intentionally mixes generic API terms ("pricing",
 * "rate limit") with product-specific terms ("claude opus", "extended
 * thinking") so we catch both broad changes and changes to features
 * AcreOS actively depends on.
 */
export const ANTHROPIC_RELEVANCE_KEYWORDS = [
  "model",
  "deprecat",
  "pricing",
  "rate limit",
  "tool use",
  "claude opus",
  "claude sonnet",
  "claude haiku",
  "context window",
  "vision",
  "extended thinking",
] as const;

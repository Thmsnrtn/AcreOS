// ============================================================================
// SHARED/SCHEMA/TRANSPARENCY-REPORTS.TS
// ----------------------------------------------------------------------------
// Quinn (Chief of Alignment) + Beatrice (CRO) — rolling transparency report
// substrate.
//
// Tahoe wave E9 — codifies the data shape for the public /transparency
// landing. The actual UI ships in a future wave; this table is the rolling
// 90-day aggregate the nightly job populates. Once a row is published
// (published_at set), it is referenced by the public landing.
//
// Why this exists:
//   - EU AI Act Article 50/86 + AcreOS's own posture of "alignment as
//     product" — customers (and the public) have a right to see refusal
//     rates, appeal outcomes, founder-bypass volume, demographic-bias
//     findings, and constitutional-drift findings.
//   - Decoupling the aggregation job from the public surface means the
//     job can land THIS wave without forcing a UI rev.
//
// Schema (intentionally global, NOT per-org — this is platform-wide
// transparency; per-org transparency is a separate future surface):
//   id                          serial PK
//   period_start, period_end    timestamptz NOT NULL — the rolling window
//                                 covered by this report row.
//   refusal_count               integer — total pax_refusal_payloads rows
//                                 in the window.
//   refusal_by_immutable        jsonb — { "customer:N": count, … }
//   appeal_count                integer — total pax_decision_appeals rows
//                                 in the window.
//   appeals_upheld_count        integer
//   appeals_reversed_count      integer
//   founder_bypass_count        integer — preCallConstitutionalChecker
//                                 founder bypasses observed in the window.
//   demographic_bias_findings   jsonb — { findings: [...], reviewedAt,
//                                 notMeasurableReason }. When we cannot
//                                 compute a fairness signal, the aggregator
//                                 sets notMeasurableReason (e.g.
//                                 "pre-customer: insufficient volume…") so
//                                 the report never ASSERTS a clean bias
//                                 audit it never ran. findings is filled by
//                                 future Andrei/Quinn fairness-detector work.
//   drift_findings              jsonb — { refusalRateDrift: ..., simRealDivergence: ... }
//   created_at                  timestamptz
//   published_at                timestamptz nullable — when the row was
//                                 published to /transparency. NULL = draft.
//
// No organization_id column — this is platform-aggregate, so the L3 lint
// doesn't apply. The unique index on (period_start, period_end) prevents
// duplicate aggregation passes.
//
// Mirror in scripts/migrate.mjs.
// ============================================================================

import {
  pgTable,
  serial,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const transparencyReports = pgTable(
  "transparency_reports",
  {
    id: serial("id").primaryKey(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    refusalCount: integer("refusal_count").notNull().default(0),
    refusalByImmutable: jsonb("refusal_by_immutable")
      .$type<Record<string, number>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    appealCount: integer("appeal_count").notNull().default(0),
    appealsUpheldCount: integer("appeals_upheld_count").notNull().default(0),
    appealsReversedCount: integer("appeals_reversed_count").notNull().default(0),
    founderBypassCount: integer("founder_bypass_count").notNull().default(0),
    // `notMeasurableReason` is load-bearing for honesty: when we cannot
    // compute a fairness signal (e.g. pre-customer, insufficient volume),
    // the report must SAY SO rather than ship a bare `findings: []` that
    // reads as "we audited and found nothing." An empty findings array with
    // a null reason is a fabricated clean-bill-of-health — exactly the
    // lying-by-omission the alignment surface exists to prevent.
    demographicBiasFindings: jsonb("demographic_bias_findings")
      .$type<{
        findings: unknown[];
        reviewedAt: string | null;
        notMeasurableReason: string | null;
      }>()
      .notNull()
      .default(
        sql`'{"findings": [], "reviewedAt": null, "notMeasurableReason": null}'::jsonb`,
      ),
    driftFindings: jsonb("drift_findings")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (t) => [
    // Idempotency: one report per (period_start, period_end) window. The
    // nightly job upserts on conflict — re-aggregating the same window
    // refreshes the counts in place rather than appending.
    uniqueIndex("transparency_reports_period_unique").on(
      t.periodStart,
      t.periodEnd,
    ),
    index("transparency_reports_published_idx").on(t.publishedAt),
  ],
);

export type TransparencyReport = typeof transparencyReports.$inferSelect;
export type InsertTransparencyReport =
  typeof transparencyReports.$inferInsert;

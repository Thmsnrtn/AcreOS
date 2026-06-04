// ============================================================================
// SHARED/SCHEMA/SOLENE-MORNING-PULSE.TS
// ----------------------------------------------------------------------------
// Phase 7 (continuous Solene) — morning-pulse snapshot ledger.
//
// Solene composes the morning pulse from live data every day at 12:00 UTC
// (7am ET) via the continuous-loop job. Each composed snapshot lands here
// so the founder Today page reads instantly without re-computing on every
// page load (which would multi-shot the underlying capital/dispatch/
// agent/funnel queries). The most-recent row is the canonical "morning
// pulse" the dashboard renders.
//
// One table:
//   solene_morning_pulse — append-only snapshot ledger. The `snapshot`
//                          jsonb column stores the entire
//                          MorningPulseSnapshot shape (see
//                          server/services/solene/continuousLoop.ts).
//
// Mirror in scripts/migrate.mjs.
// ============================================================================

import {
  pgTable,
  serial,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

// ============================================
// SOLENE_MORNING_PULSE
// ============================================
//
// generated_at  — when composeMorningPulse() produced the snapshot.
// snapshot      — the full MorningPulseSnapshot blob (one-line + sub-
//                 sections + per-agent activity). Schema is owned by
//                 server/services/solene/continuousLoop.ts; we keep the
//                 column untyped here so adding new sub-sections is a
//                 service-only change.
export const soleneMorningPulse = pgTable(
  "solene_morning_pulse",
  {
    id: serial("id").primaryKey(),
    generatedAt: timestamp("generated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    snapshot: jsonb("snapshot").notNull(),
  },
  (t) => [
    // Latest-snapshot lookup is the hot path (every Today page render).
    index("solene_morning_pulse_generated_idx").on(t.generatedAt),
  ],
);

export type SoleneMorningPulseRow = typeof soleneMorningPulse.$inferSelect;
export type InsertSoleneMorningPulseRow =
  typeof soleneMorningPulse.$inferInsert;

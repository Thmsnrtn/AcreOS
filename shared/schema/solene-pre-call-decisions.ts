// ============================================================================
// SHARED/SCHEMA/SOLENE-PRE-CALL-DECISIONS.TS
// ----------------------------------------------------------------------------
// Solene — upstream constitutional pre-call decisions ledger (L6.28).
//
// L6.29 (constitutionalGuard) screens at the tool-call level — DOWNSTREAM
// from the model. That catches violations the agent attempts to materialize
// as tool use, but it cannot block prompts whose violation intent never
// surfaces a matching tool pattern.
//
// L6.28 (preCallConstitutionalChecker) screens UPSTREAM, before the expensive
// Opus call ever runs. A lightweight Haiku model reads the dispatch prompt +
// agent role against the 12 immutables and returns { allowed, immutable_number,
// reasoning }. Blocked dispatches fail before paying for the main model AND
// land a row here for retro review.
//
// One row per pre-call check, regardless of outcome. When `allowed=false` and
// the checker also lands a row in `solene_constitutional_violations`, the
// violation_event_id is back-filled here so the two ledgers can be joined.
//
// Schema:
//   id                   serial PK
//   decided_at           timestamptz default now()
//   dispatch_id          int, nullable — FK-ish (no hard FK; queue rows can
//                          be hard-deleted in dev — but in prod this is the
//                          solene_dispatch_queue.id the check was for).
//   agent_role           text — copied from the dispatch (e.g. "iris", "soren")
//   prompt_summary       text — TRUNCATED to ≤500 chars before persist; the
//                          original prompt text never lands in the DB so any
//                          credential value the founder pasted into a Solene
//                          chat input cannot leak via this surface.
//   allowed              boolean
//   immutable_number     int, nullable (1-12) — set when allowed=false
//   immutable_text       text, nullable — denormalized snapshot of the
//                          immutable wording at the time of decision so the
//                          row survives constitutional rewording.
//   reasoning            text — the checker's 1-2 sentence reason. Defaults
//                          to "checker output unparseable; failing open" on
//                          parse failure.
//   model_used           text — checker model id (e.g. claude-haiku-4-5-20251001)
//   latency_ms           int — wall-clock for the checker round-trip
//   cost_usd             numeric(10,6) — derived from token counts × Haiku
//                          pricing env vars
//   violation_event_id   int, nullable — FK to solene_constitutional_violations.id
//                          when blocked + also written there.
//
// Indexes (driven by the read patterns the daily-pulse + retro UI will hit):
//   (allowed, decided_at desc) — "show me recent blocks"
//   (dispatch_id)              — "look up a specific dispatch's decision"
//   (immutable_number, decided_at desc) — "which immutables trip most often"
//
// Mirror in scripts/migrate.mjs.
// ============================================================================

import {
  pgTable,
  text,
  serial,
  integer,
  numeric,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const solenePreCallDecisions = pgTable(
  "solene_pre_call_decisions",
  {
    id: serial("id").primaryKey(),
    decidedAt: timestamp("decided_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    dispatchId: integer("dispatch_id"),
    agentRole: text("agent_role").notNull(),
    promptSummary: text("prompt_summary").notNull(),
    allowed: boolean("allowed").notNull(),
    immutableNumber: integer("immutable_number"),
    immutableText: text("immutable_text"),
    reasoning: text("reasoning").notNull(),
    modelUsed: text("model_used").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }).notNull(),
    violationEventId: integer("violation_event_id"),
  },
  (t) => [
    index("solene_pre_call_decisions_allowed_idx").on(t.allowed, t.decidedAt),
    index("solene_pre_call_decisions_dispatch_idx").on(t.dispatchId),
    index("solene_pre_call_decisions_imm_idx").on(
      t.immutableNumber,
      t.decidedAt,
    ),
  ],
);

export type SolenePreCallDecision = typeof solenePreCallDecisions.$inferSelect;
export type InsertSolenePreCallDecision =
  typeof solenePreCallDecisions.$inferInsert;

// Maximum chars of the dispatch prompt stored in the DB. Credential discipline:
// never store the full prompt — a 500-char window is enough for retro pattern
// review without inviting accidental secret-leakage via prompt-pasted text.
export const PRECALL_PROMPT_SUMMARY_MAX_CHARS = 500;

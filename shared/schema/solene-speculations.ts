// ============================================================================
// SHARED/SCHEMA/SOLENE-SPECULATIONS.TS
// ----------------------------------------------------------------------------
// Solene — speculative execution layer (Phase B L4.20).
//
// A "speculation" is a piece of work an agent did BEFORE being explicitly
// asked, based on a predicted future need. Examples:
//   - Iris sees `pgvector` extension flag flip to ready → speculatively builds
//     an embedding-refresh-script
//   - Beatrice sees a CFPB rule on the watch list → speculatively drafts the
//     policy change doc
//   - Soren sees /learn traffic spike → speculatively drafts follow-up content
//
// When the predicted ask actually arrives, Solene checks for matching
// speculations via findMatchingSpeculations() and consumes the best match
// (saving the duplicate-work cost).
//
// Lifecycle:
//   speculated → consumed     (matched + used)
//   speculated → superseded   (a better speculation replaces this one)
//   speculated → expired      (past expires_at; cron flips daily)
//   speculated → discarded    (agent ruled it out)
//
// Default expires_in_days = 30.
//
// Credential discipline: triggered_by_signal + evidence_refs are sanitized
// inline in the service (sk_live_/pk_/phc_/phx_/ghp_/AKIA/Bearer prefixes →
// [REDACTED]) BEFORE persistence — per feedback_credential_value_handling.md.
//
// Mirror in scripts/migrate.mjs.
// ============================================================================

import {
  pgTable,
  text,
  serial,
  integer,
  numeric,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ============================================
// SOLENE_SPECULATIONS
// ============================================
export const soleneSpeculations = pgTable(
  "solene_speculations",
  {
    id: serial("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdByAgentRole: text("created_by_agent_role").notNull(),
    triggeredBySignal: text("triggered_by_signal").notNull(),
    predictedNeed: text("predicted_need").notNull(),
    speculativeOutput: text("speculative_output").notNull(),
    outputKind: text("output_kind").notNull(),
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
    status: text("status").notNull().default("speculated"),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    consumedByDispatchId: integer("consumed_by_dispatch_id"),
    consumedByReason: text("consumed_by_reason"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    supersedesSpeculationId: integer("supersedes_speculation_id"),
    evidenceRefs: text("evidence_refs")
      .array()
      .default(sql`'{}'::text[]`),
  },
  (t) => [
    index("solene_speculations_status_created_idx").on(t.status, t.createdAt),
    index("solene_speculations_role_status_idx").on(
      t.createdByAgentRole,
      t.status,
    ),
    // Partial index — only rows with expires_at set, so the daily expireStale
    // sweep stays cheap as the table grows.
    index("solene_speculations_expires_idx")
      .on(t.expiresAt)
      .where(sql`expires_at IS NOT NULL`),
  ],
);

export type SpeculationRow = typeof soleneSpeculations.$inferSelect;
export type InsertSpeculationRow = typeof soleneSpeculations.$inferInsert;

// ============================================
// ENUMS
// ============================================

export const SPECULATION_STATUSES = [
  "speculated",
  "consumed",
  "superseded",
  "expired",
  "discarded",
] as const;
export type SpeculationStatus = (typeof SPECULATION_STATUSES)[number];

export const SPECULATION_OUTPUT_KINDS = [
  "code_change_proposal",
  "document_draft",
  "data_artifact",
  "analysis",
  "other",
] as const;
export type SpeculationOutputKind = (typeof SPECULATION_OUTPUT_KINDS)[number];

// Validation bounds.
export const SPECULATION_TRIGGER_MAX = 500;
export const SPECULATION_DEFAULT_EXPIRES_DAYS = 30;
export const SPECULATION_MATCH_SCORE_THRESHOLD = 0.3;

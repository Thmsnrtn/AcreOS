// ============================================================================
// SHARED/SCHEMA/SOLENE-MEMORY-RETRIEVAL.TS
// ----------------------------------------------------------------------------
// Solene — L3.14 embedding-based memory retrieval (cross-namespace RAG).
//
// Why this exists
// ───────────────
// L3.10 wired RAG over `feedback_memory` namespace (the `/memory/feedback_*.md`
// files). L3.14 generalizes the same retrieval pattern to DB-row sources so a
// dispatched agent can be briefed with relevant *past dispatches*, *past
// identity decisions*, *decision trace steps* and *audit findings* — not just
// the static feedback-memory corpus.
//
// Source domain → namespace mapping:
//
//   namespace              source table                             source_ref
//   ─────────────────────  ───────────────────────────────────────  ─────────────────
//   feedback_memory        memory/feedback_*.md (handled by L3.10)  feedback-<slug>
//   dispatch_summary       solene_dispatch_queue (status=completed) dispatch:<id>
//   agent_decision         solene_agent_identity_decisions          decision:<id>
//   decision_trace_step    solene_decision_traces                   trace:<dId>:<sId>
//   audit_finding          solene_audit_findings                    audit:<id>
//
// All five namespaces share the existing `solene_embedded_records` registry
// (declared in solene-embeddings.ts) — only the per-namespace ingestion
// high-water-mark needs new state, which is what this file declares.
//
// solene_memory_corpus_status
// ───────────────────────────
// One row per namespace. Tracks the last-ingested source_id so re-running the
// ingestion script picks up where the previous run left off rather than
// re-scanning the whole source table. Also surfaces per-namespace counts to
// the founder visibility surface.
//
// Mirror in scripts/migrate.mjs.
// ============================================================================

import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ============================================================================
// SOLENE_MEMORY_CORPUS_STATUS
// ============================================================================
export const soleneMemoryCorpusStatus = pgTable(
  "solene_memory_corpus_status",
  {
    id: serial("id").primaryKey(),
    // One of MEMORY_RETRIEVAL_NAMESPACES. Free-form text in the column for
    // forward-compat; the enum is the authoritative documentation.
    namespace: text("namespace").notNull(),
    // Most-recent wall-clock time this namespace was ingested. NULL until
    // the first ingest run completes.
    lastIngestedAt: timestamp("last_ingested_at", { withTimezone: true }),
    // High-water-mark for the source table's id column — the ingestion job
    // resumes from `id > lastIngestedSourceId` on the next pass. NULL before
    // the first successful run.
    lastIngestedSourceId: integer("last_ingested_source_id"),
    // Cumulative counters across all ingestion runs for this namespace.
    rowsIngested: integer("rows_ingested").notNull().default(0),
    // Skipped because content_hash matched the already-stored row.
    rowsSkippedUnchanged: integer("rows_skipped_unchanged").notNull().default(0),
    // Failed during the ingest pass (parse error, DB write error, etc.).
    rowsFailed: integer("rows_failed").notNull().default(0),
    // Human-scannable last-run summary for the founder visibility surface.
    lastRunSummary: text("last_run_summary"),
  },
  (t) => [
    // Natural key: one row per namespace.
    uniqueIndex("solene_memory_corpus_status_namespace_unique").on(t.namespace),
  ],
);

export type SoleneMemoryCorpusStatus =
  typeof soleneMemoryCorpusStatus.$inferSelect;
export type InsertSoleneMemoryCorpusStatus =
  typeof soleneMemoryCorpusStatus.$inferInsert;

// ============================================================================
// ENUMS / CONSTANTS
// ============================================================================

/**
 * Authoritative list of namespaces handled by the L3.14 cross-namespace RAG
 * retrieval path. `feedback_memory` is shared with the L3.10 surface; the
 * other four are L3.14-specific.
 */
export const MEMORY_RETRIEVAL_NAMESPACES = [
  "feedback_memory",
  "dispatch_summary",
  "agent_decision",
  "decision_trace_step",
  "audit_finding",
] as const;
export type MemoryRetrievalNamespace =
  (typeof MEMORY_RETRIEVAL_NAMESPACES)[number];

/**
 * Default top-K per namespace before the cross-namespace merge step.
 */
export const MEMORY_RETRIEVAL_TOP_K_PER_NAMESPACE_DEFAULT = 3;

/**
 * Default global top-K cap after merging all per-namespace results.
 */
export const MEMORY_RETRIEVAL_GLOBAL_TOP_K_DEFAULT = 10;

/**
 * Default minimum cosine similarity. Higher than L3.10's 0 default because
 * the L3.14 sources (dispatches, decision steps) can be noisy — a low-
 * similarity match across DB rows is more likely a false positive than a
 * low-similarity match against a curated feedback memory.
 */
export const MEMORY_RETRIEVAL_MIN_SIMILARITY_DEFAULT = 0.3;

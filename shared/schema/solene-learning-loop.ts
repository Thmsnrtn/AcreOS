// ============================================================================
// SHARED/SCHEMA/SOLENE-LEARNING-LOOP.TS
// ----------------------------------------------------------------------------
// Solene — L3.10 learning loop audit table.
//
// Why this exists
// ───────────────
// Every RAG query the learning-loop service issues against
// `solene_embedded_records` lands here as an audit row. We want to answer:
//   - "Is the RAG layer even firing for the dispatched agents?"
//   - "Which past corrections are actually being surfaced?"
//   - "What's the average top-similarity / how many queries return zero?"
//   - "Per-agent: who's pulling from memory and how often?"
//
// This is intentionally a write-only log from the service side; the founder
// surface + the daily pulse read from it for visibility.
//
// `query_text` is intentionally truncated to 2000 chars by the service before
// insert — we want a meaningful audit row, not a place to dump full prompts.
//
// `retrieved_source_refs` + `similarity_scores` are kept as parallel arrays
// (same length, same order) so we can reconstruct the ranked retrieval
// without joining back to the embeddings table (whose row could have been
// re-embedded/updated since the retrieval).
//
// Mirror in scripts/migrate.mjs.
// ============================================================================

import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  numeric,
  index,
} from "drizzle-orm/pg-core";

// ============================================================================
// SOLENE_RETRIEVAL_EVENTS
// ============================================================================
export const soleneRetrievalEvents = pgTable(
  "solene_retrieval_events",
  {
    id: serial("id").primaryKey(),
    queriedAt: timestamp("queried_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // One of DISPATCH_AGENT_ROLES, or 'system' for non-dispatch queries
    // (warm-start audits, founder ad-hoc searches, etc.).
    queryingAgentRole: text("querying_agent_role").notNull(),
    // Nullable: not every retrieval is bound to a live dispatch (e.g. the
    // founder running an ad-hoc search from the visibility surface).
    queryDispatchId: integer("query_dispatch_id"),
    // The task-context text that was searched. Service truncates to ≤2000
    // chars before insert (RETRIEVAL_QUERY_TEXT_MAX_CHARS).
    queryText: text("query_text").notNull(),
    // Which embedding namespace was searched — e.g. 'feedback_memory',
    // 'decision_trace'. Mirrors EMBEDDING_NAMESPACES in solene-embeddings.
    queryNamespace: text("query_namespace").notNull(),
    // The requested top-K (post-cap to RETRIEVAL_TOP_K_MAX).
    topK: integer("top_k").notNull(),
    // The actual number of rows returned (may be < topK when the corpus
    // is small or minSimilarity filtered some out).
    retrievedCount: integer("retrieved_count").notNull(),
    // Parallel arrays: position i has the source_ref of the i-th match and
    // its similarity score in [-1, 1] (we expect [0, 1] for normalized
    // embeddings + cosine but we don't clip).
    retrievedSourceRefs: text("retrieved_source_refs").array().notNull(),
    similarityScores: numeric("similarity_scores", { precision: 5, scale: 4 })
      .array()
      .notNull(),
    // Wall-clock latency from query-enter to query-return (includes the
    // embedding compute + the pgvector lookup + the persist of *this* row).
    latencyMs: integer("latency_ms").notNull(),
  },
  (t) => [
    // Hot path: "show me the last N retrievals for agent X".
    index("solene_retrieval_events_agent_recent_idx").on(
      t.queryingAgentRole,
      t.queriedAt,
    ),
    // Hot path: "show me the last N retrievals against namespace N".
    index("solene_retrieval_events_namespace_recent_idx").on(
      t.queryNamespace,
      t.queriedAt,
    ),
  ],
);

export type SoleneRetrievalEvent = typeof soleneRetrievalEvents.$inferSelect;
export type InsertSoleneRetrievalEvent =
  typeof soleneRetrievalEvents.$inferInsert;

// ============================================================================
// LIMITS / CONSTANTS
// ============================================================================

// Cap on the audited query_text length — we want a meaningful diagnostic
// row, not a place to land 40 KB prompts.
export const RETRIEVAL_QUERY_TEXT_MAX_CHARS = 2000;

// Truncation suffix when query_text > RETRIEVAL_QUERY_TEXT_MAX_CHARS.
export const RETRIEVAL_QUERY_TRUNCATION_SUFFIX = "… [truncated]";

// Cap on top-K. Even when callers pass higher we clamp here — the prompt
// block becomes noise past ~10 entries and the latency grows linearly.
export const RETRIEVAL_TOP_K_MAX = 20;

// Default top-K when caller doesn't specify.
export const RETRIEVAL_TOP_K_DEFAULT = 5;

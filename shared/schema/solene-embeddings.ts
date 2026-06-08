// ============================================================================
// SHARED/SCHEMA/SOLENE-EMBEDDINGS.TS
// ----------------------------------------------------------------------------
// Solene — pgvector embeddings registry (Phase B infra for L3.10 + L3.14).
//
// Why this exists
// ───────────────
// L3.10 (learning loop) and L3.14 (embedding-based memory) both need vector
// storage. Rather than each rolling its own pgvector table, this is a single
// generic registry shared across consumers:
//
//   namespace                  source_ref examples
//   ─────────────────────────  ──────────────────────────────────────────────
//   feedback_memory            "feedback-coo-authority"
//   decision_trace             "decision-traces:123"
//   failure_mode               "failure-mode-3-mass-staging"
//   audit_finding              "audit:2026-06-01:nav-doors"
//
// The (namespace, source_ref) pair is the natural key — unique, so re-
// embedding an item updates in place rather than appending. content_hash is
// the sha256 of the *full* original text (we only persist a snippet ≤4000
// chars in content_snippet) so downstream jobs can detect drift and decide
// whether to re-embed.
//
// Vector dimension
// ────────────────
// Runtime-configurable via EMBEDDING_DIM (default 1024 — matches voyage-3 /
// cohere-embed-v3; text-embedding-3-small lives at 1536). We store the
// declared dim per row in embedding_dim so consumers can validate
// compatibility before dispatching cosine queries.
//
// HNSW index
// ──────────
// HNSW over vector_cosine_ops (better recall than IVFFlat for the small-
// corpus regime + no training step). The index is declared in
// scripts/migrate.mjs; drizzle's pgvector index DSL is still nascent so we
// keep the index out of the schema file for clarity.
//
// Mirror in scripts/migrate.mjs.
// ============================================================================

import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  customType,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "../schema";

// ============================================================================
// pgvector custom column type
// ----------------------------------------------------------------------------
// Drizzle has no first-party pgvector type yet; we map `vector` to a JS
// number[] via customType. The wire format pgvector accepts is the textual
// "[0.1,0.2,...]" form — we serialize on the way in and parse on the way out.
//
// We don't constrain the dimension at the type-system level — that's
// enforced by the embedding_dim column at the row level + EMBEDDING_DIM env
// var at the application layer. Keeping the column dimensionally flexible
// lets us A/B different models without re-creating the table.
// ============================================================================
export const vectorColumn = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    if (!value) return [];
    // pgvector returns "[0.1,0.2,...]"; strip brackets, split, parse.
    const inner = value.replace(/^\[|\]$/g, "");
    if (inner.length === 0) return [];
    return inner.split(",").map((n) => parseFloat(n));
  },
});

// ============================================================================
// SOLENE_EMBEDDED_RECORDS
// ============================================================================
export const soleneEmbeddedRecords = pgTable(
  "solene_embedded_records",
  {
    id: serial("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // ------------------------------------------------------------------
    // Tahoe lock-in L2 — multi-tenancy column.
    //
    // NULL = team-internal embedding (feedback-memory corpus, internal
    // decision traces, audit findings against AcreOS itself). NULL rows
    // are visible to every retrieval. NON-NULL = tenant-owned embedding
    // (e.g. future Pax-output corpora, per-org decision summaries). When
    // a retrieval call passes an organizationId, the predicate becomes
    //   WHERE (organization_id = $org OR organization_id IS NULL)
    // so the caller sees their own corpus + the team-shared corpus, but
    // never another tenant's corpus.
    //
    // We add this BEFORE Pax-output volume arrives so the backfill is a
    // no-op rather than a multi-million-row PII-bearing migration. The
    // column is nullable on purpose: it would be hostile to insist every
    // legacy ingest path supply a tenant attribution it never had.
    // ------------------------------------------------------------------
    organizationId: integer("organization_id").references(
      () => organizations.id,
      { onDelete: "cascade" },
    ),
    // Consumer category — see EMBEDDING_NAMESPACES below.
    namespace: text("namespace").notNull(),
    // Stable reference into the source domain — slug, "<table>:<id>", URL, …
    sourceRef: text("source_ref").notNull(),
    // The text that was embedded (truncated to EMBEDDED_SNIPPET_MAX_CHARS).
    // Useful for debug surfaces + cheap nearest-neighbour display without
    // round-tripping back to the source row.
    contentSnippet: text("content_snippet").notNull(),
    // sha256 of the *full* original text (not the snippet) — used to detect
    // drift and decide whether to re-embed.
    contentHash: text("content_hash").notNull(),
    // e.g. 'voyage-3', 'text-embedding-3-small', 'cohere-embed-v3'.
    embeddingModel: text("embedding_model").notNull(),
    // Declared dim of the embedding row — consumers validate compatibility
    // before issuing cosine queries (mismatched dims = pgvector hard error).
    embeddingDim: integer("embedding_dim").notNull(),
    // The actual vector. Nullable so a row can be staged before the embed
    // call completes (rare path, but cheaper than two-table normalization).
    embedding: vectorColumn("embedding"),
    // Free-form per-row metadata — schema is consumer-defined.
    metadata: jsonb("metadata")
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (t) => [
    // Natural key: re-embedding the same source updates in place. Widened
    // to include organization_id so two tenants can independently embed
    // the same source_ref under the same namespace. Postgres treats NULL
    // as distinct in unique constraints, so legacy team-internal rows
    // (organization_id IS NULL) continue to be deduped by (namespace,
    // source_ref) — the original semantic is preserved.
    uniqueIndex("solene_embedded_records_org_namespace_source_unique").on(
      t.organizationId,
      t.namespace,
      t.sourceRef,
    ),
    // Tahoe L3 shard-readiness — every retrieval that's bound to a tenant
    // should hit this composite index first. Leading on organization_id
    // also lets us range-partition this table later without a re-index.
    index("solene_embedded_records_org_namespace_created_idx").on(
      t.organizationId,
      t.namespace,
      t.createdAt,
    ),
    // Hot path: scan a single namespace newest-first (drift detection,
    // batch re-embed catch-up, etc.) regardless of tenant. Kept for the
    // team-internal sweep job — DO NOT drop without checking
    // server/jobs/embeddingRefresh.ts and scripts/memory-gc.mjs.
    index("solene_embedded_records_namespace_created_idx").on(
      t.namespace,
      t.createdAt,
    ),
    // NOTE: HNSW index on `embedding` (vector_cosine_ops) is declared in
    // scripts/migrate.mjs — drizzle's pgvector index DSL is still nascent.
  ],
);

export type SoleneEmbeddedRecord = typeof soleneEmbeddedRecords.$inferSelect;
export type InsertSoleneEmbeddedRecord =
  typeof soleneEmbeddedRecords.$inferInsert;

// ============================================================================
// ENUMS / CONSTANTS
// ============================================================================

// Known namespaces. Free-form text in the column so new consumers don't
// need a migration; the enum is the authoritative documentation + the lint
// surface (consumers should import from here, not hard-code strings).
export const EMBEDDING_NAMESPACES = [
  "feedback_memory",
  "decision_trace",
  "failure_mode",
  "audit_finding",
  // Andrei E5 — Pax land-expertise corpus. Global (organization_id IS NULL)
  // hand-curated, cited land-knowledge cards. DISTINCT from parcel-fact
  // retrieval: these are general domain explanations, never per-parcel facts.
  // See server/services/pax/landKnowledge/.
  "land_knowledge",
] as const;
export type EmbeddingNamespace = (typeof EMBEDDING_NAMESPACES)[number];

// Snippet cap — keeps the table compact and the debug surface scannable.
// Re-embed jobs always pull the *full* text from the source domain when
// computing a new embedding; the snippet is purely display.
export const EMBEDDED_SNIPPET_MAX_CHARS = 4000;

// Truncation suffix appended when content > EMBEDDED_SNIPPET_MAX_CHARS.
export const EMBEDDED_SNIPPET_TRUNCATION_SUFFIX = "… [truncated]";

// Runtime-configurable embedding dimension. Defaults to 1024 (voyage-3 /
// cohere-embed-v3). Override via env var; consumers should read from here,
// not from process.env directly, so tests can stub a single surface.
export const EMBEDDING_DIM: number = (() => {
  const raw = process.env.EMBEDDING_DIM;
  if (!raw) return 1024;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1024;
  return parsed;
})();

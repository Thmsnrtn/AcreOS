/**
 * SOLENE — embedding-based memory retrieval (Layer 3 capability L3.14).
 *
 * Cross-namespace RAG over the L3.10-shipped solene_embedded_records table.
 * L3.10 surfaces *feedback-memory corrections* into a dispatched agent's
 * system prompt. L3.14 generalizes that to DB-row sources: past dispatches,
 * past identity decisions, past decision-trace steps, past audit findings.
 *
 * Pipeline:
 *
 *   retrieveCrossNamespaceMemories(query)
 *     For each requested namespace, embed the query text + run one pgvector
 *     cosine query → top-K per namespace. Merge the per-namespace results
 *     into a single list sorted by similarity, cap at globalTopK, persist
 *     ONE solene_retrieval_events audit row covering the merged result
 *     (query_namespace = "cross:<ns1>,<ns2>,…"). NEVER throws.
 *
 *   buildMultiNamespacePromptBlock(retrieved)
 *     Render a markdown block grouped by namespace, ready to inject into
 *     the dispatched agent's system prompt. Empty input → "".
 *
 *   getCorpusStatus()
 *     Per-namespace ingest counts + total embedding rows for the founder
 *     visibility surface.
 *
 *   mergeAndCap / dedupBySource
 *     Pure helpers exported for testability.
 *
 * ----------------------------------------------------------------------------
 * Embedding model — production Voyage with placeholder fail-open fallback
 * ----------------------------------------------------------------------------
 * Production path: Voyage AI (`voyage-3-large`, 1024-dim) via
 * `../embeddings/voyageClient.embedTexts`, called with `input_type='query'`.
 *
 * Fallback path: `placeholderEmbedding` (deterministic feature-hash → 1024-d)
 * is kept in this file as the fail-open default. On ANY Voyage failure
 * (missing key, HTTP error, timeout, malformed response, dim mismatch) we log
 * a warn + degrade to the placeholder so the cross-namespace retrieval surface
 * keeps working even during a Voyage outage. The placeholder MUST remain
 * here — DO NOT delete it.
 *
 * ----------------------------------------------------------------------------
 * Wire-in to dispatchRunner (DEFERRED)
 * ----------------------------------------------------------------------------
 * The dispatchRunner.buildSystemPrompt integration that calls
 * retrieveCrossNamespaceMemories({queryText: task, queryingAgentRole: role})
 * + appends buildMultiNamespacePromptBlock(out.retrieved) is deferred — the
 * runner is frozen for this wave. This service ships the foundation.
 * ----------------------------------------------------------------------------
 */

import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { logger } from "../../utils/logger";
import { embedTexts } from "../embeddings/voyageClient";
import {
  soleneRetrievalEvents,
  RETRIEVAL_QUERY_TEXT_MAX_CHARS,
  RETRIEVAL_QUERY_TRUNCATION_SUFFIX,
} from "@shared/schema/solene-learning-loop";
import { EMBEDDING_DIM } from "@shared/schema/solene-embeddings";
import {
  MEMORY_RETRIEVAL_NAMESPACES,
  MEMORY_RETRIEVAL_TOP_K_PER_NAMESPACE_DEFAULT,
  MEMORY_RETRIEVAL_GLOBAL_TOP_K_DEFAULT,
  MEMORY_RETRIEVAL_MIN_SIMILARITY_DEFAULT,
  type MemoryRetrievalNamespace,
} from "@shared/schema/solene-memory-retrieval";
import type { SoleneDispatchAgentRole } from "@shared/schema/solene-dispatch";

// ============================================================================
// Public types
// ============================================================================

export type MemoryNamespace = MemoryRetrievalNamespace;

export interface MultiNamespaceQuery {
  queryText: string;
  /** Defaults to every namespace in MEMORY_RETRIEVAL_NAMESPACES. */
  namespaces?: MemoryNamespace[];
  /** Defaults to MEMORY_RETRIEVAL_TOP_K_PER_NAMESPACE_DEFAULT (3). */
  topKPerNamespace?: number;
  /** Defaults to MEMORY_RETRIEVAL_GLOBAL_TOP_K_DEFAULT (10) — final cap after merge. */
  globalTopK?: number;
  /** Defaults to MEMORY_RETRIEVAL_MIN_SIMILARITY_DEFAULT (0.3). */
  minSimilarity?: number;
  queryingAgentRole?: SoleneDispatchAgentRole | "system";
  queryDispatchId?: number;
  /**
   * Tahoe L2 lock-in — tenant-scope filter.
   *
   * When set, every per-namespace cosine query becomes
   *   WHERE namespace = $ns
   *     AND (organization_id = $org OR organization_id IS NULL)
   * so the caller sees their own corpus + the team-shared (NULL) corpus
   * but never another tenant's corpus. Omit for system-level callers
   * (founder ad-hoc search, warm-start audits, team-internal sweeps).
   */
  organizationId?: number;
}

export interface RetrievedItem {
  namespace: MemoryNamespace;
  sourceRef: string;
  contentSnippet: string;
  similarityScore: number;
}

export interface MultiNamespaceResult {
  /** -1 when the audit row could not be persisted. */
  retrievalEventId: number;
  retrieved: RetrievedItem[];
  /** Per-namespace count of items contributing to the merged result. */
  byNamespace: Record<MemoryNamespace, number>;
  latencyMs: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_AGENT_ROLE = "system";

/** Hard cap on per-namespace topK regardless of caller request. */
const TOP_K_PER_NAMESPACE_MAX = 20;

/** Hard cap on globalTopK regardless of caller request. */
const GLOBAL_TOP_K_MAX = 50;

// ============================================================================
// Phase 0 placeholder embedding
// ----------------------------------------------------------------------------
// Identical to the algorithm in learningLoop.ts + ingest-feedback-memories.mjs
// + ingest-decision-memory.mjs. Production-embedding swap updates all four.
// ============================================================================
function placeholderEmbedding(text: string, dim: number = EMBEDDING_DIM): number[] {
  const vec = new Array(dim).fill(0);
  const tokens = text.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  for (const tok of tokens) {
    const h = crypto.createHash("md5").update(tok).digest();
    for (let i = 0; i < dim; i++) {
      vec[i] += h[i % h.length] / 255 - 0.5;
    }
  }
  const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0)) || 1;
  return vec.map((x) => x / norm);
}

/**
 * Resolve a query string to a vector. Production path: Voyage with
 * `input_type='query'`. Fail-open fallback: placeholderEmbedding.
 */
async function embedQueryText(text: string): Promise<number[]> {
  try {
    const result = await embedTexts({ texts: [text], inputType: "query" });
    return result.embeddings[0];
  } catch (err) {
    logger.warn("memoryRetrieval.cross.voyage_fallback", {
      err: err instanceof Error ? err.message : String(err),
    });
    return placeholderEmbedding(text, EMBEDDING_DIM);
  }
}

function vectorToPgLiteral(vec: number[]): string {
  return "[" + vec.join(",") + "]";
}

function truncateForAudit(text: string): string {
  if (text.length <= RETRIEVAL_QUERY_TEXT_MAX_CHARS) return text;
  return (
    text.slice(0, RETRIEVAL_QUERY_TEXT_MAX_CHARS) +
    RETRIEVAL_QUERY_TRUNCATION_SUFFIX
  );
}

// ============================================================================
// Pure helpers (exported for testability)
// ============================================================================

/**
 * Merge per-namespace results into a single list sorted descending by
 * similarity, cap at globalTopK.
 */
export function mergeAndCap(
  perNamespace: Map<MemoryNamespace, RetrievedItem[]>,
  globalTopK: number,
): RetrievedItem[] {
  const all: RetrievedItem[] = [];
  for (const items of perNamespace.values()) {
    for (const item of items) all.push(item);
  }
  all.sort((a, b) => b.similarityScore - a.similarityScore);
  const cap = Math.max(0, globalTopK);
  return all.slice(0, cap);
}

/**
 * Dedup near-duplicates by (namespace, sourceRef). When multiple copies of
 * the same source appear (e.g. from overlapping sub-queries), keep the one
 * with the highest similarity score.
 */
export function dedupBySource(items: RetrievedItem[]): RetrievedItem[] {
  const seen = new Map<string, RetrievedItem>();
  for (const item of items) {
    const key = `${item.namespace}::${item.sourceRef}`;
    const existing = seen.get(key);
    if (!existing || item.similarityScore > existing.similarityScore) {
      seen.set(key, item);
    }
  }
  // Re-sort by similarity descending — the merge call expects a sorted output.
  return Array.from(seen.values()).sort(
    (a, b) => b.similarityScore - a.similarityScore,
  );
}

// ============================================================================
// retrieveCrossNamespaceMemories
// ============================================================================

/**
 * Per-namespace ordering label used to render the prompt block sections in
 * a stable order regardless of caller input.
 */
const NAMESPACE_RENDER_ORDER: MemoryNamespace[] = [
  "founder_precedent",
  "feedback_memory",
  "dispatch_summary",
  "agent_decision",
  "decision_trace_step",
  "audit_finding",
];

const NAMESPACE_DISPLAY_NAMES: Record<MemoryNamespace, string> = {
  feedback_memory: "Past feedback memories",
  dispatch_summary: "Past dispatches",
  agent_decision: "Past decisions",
  decision_trace_step: "Past decision traces",
  audit_finding: "Past audit findings",
  founder_precedent: "Past founder rulings",
};

/**
 * Cross-namespace retrieval. Runs one pgvector query per requested namespace,
 * merges the results, sorts descending by similarity, caps at globalTopK.
 * NEVER throws. A per-namespace DB error degrades gracefully — the other
 * namespaces still return + a warn log fires + a single audit row covers
 * the partial result.
 */
export async function retrieveCrossNamespaceMemories(
  query: MultiNamespaceQuery,
): Promise<MultiNamespaceResult> {
  const t0 = Date.now();
  const namespaces =
    query.namespaces && query.namespaces.length > 0
      ? query.namespaces
      : ([...MEMORY_RETRIEVAL_NAMESPACES] as MemoryNamespace[]);
  const requestedPerNs =
    query.topKPerNamespace ?? MEMORY_RETRIEVAL_TOP_K_PER_NAMESPACE_DEFAULT;
  const topKPerNs = Math.max(
    1,
    Math.min(TOP_K_PER_NAMESPACE_MAX, requestedPerNs),
  );
  const requestedGlobal =
    query.globalTopK ?? MEMORY_RETRIEVAL_GLOBAL_TOP_K_DEFAULT;
  const globalTopK = Math.max(1, Math.min(GLOBAL_TOP_K_MAX, requestedGlobal));
  const minSim = query.minSimilarity ?? MEMORY_RETRIEVAL_MIN_SIMILARITY_DEFAULT;
  const agentRole = query.queryingAgentRole ?? DEFAULT_AGENT_ROLE;
  const truncatedQuery = truncateForAudit(query.queryText);

  // Build the query vector once — reused across namespaces.
  let pgLiteral: string;
  try {
    const queryVector = await embedQueryText(query.queryText);
    pgLiteral = vectorToPgLiteral(queryVector);
  } catch (err) {
    logger.warn("memoryRetrieval.cross.embed_error", {
      err: err instanceof Error ? err.message : String(err),
    });
    return {
      retrievalEventId: -1,
      retrieved: [],
      byNamespace: emptyByNamespace(),
      latencyMs: Date.now() - t0,
    };
  }

  const perNamespace = new Map<MemoryNamespace, RetrievedItem[]>();

  // Tahoe L2 — when the caller is tenant-scoped, every sub-query
  // restricts to their org + the team-shared (NULL) corpus.
  const orgScope = query.organizationId;

  // One sub-query per namespace. Failures in one don't sink the others.
  for (const ns of namespaces) {
    try {
      const result = await db.execute<{
        source_ref: string;
        content_snippet: string;
        similarity: string | number;
      }>(sql`
        SELECT source_ref, content_snippet,
               1 - (embedding <=> ${pgLiteral}::vector) AS similarity
        FROM solene_embedded_records
        WHERE ${orgScope == null
          ? sql`TRUE`
          : sql`(organization_id = ${orgScope} OR organization_id IS NULL)`}
          AND namespace = ${ns}
          AND embedding IS NOT NULL
        ORDER BY embedding <=> ${pgLiteral}::vector
        LIMIT ${topKPerNs}
      `);
      const list: any[] = Array.isArray(result)
        ? (result as any[])
        : ((result as any)?.rows ?? []);
      const items: RetrievedItem[] = list
        .map((r) => ({
          namespace: ns,
          sourceRef: r.source_ref,
          contentSnippet: r.content_snippet,
          similarityScore:
            typeof r.similarity === "string"
              ? parseFloat(r.similarity)
              : r.similarity,
        }))
        .filter((m) => Number.isFinite(m.similarityScore) && m.similarityScore >= minSim);
      perNamespace.set(ns, items);
    } catch (err) {
      logger.warn("memoryRetrieval.cross.namespace_db_error", {
        namespace: ns,
        err: err instanceof Error ? err.message : String(err),
      });
      perNamespace.set(ns, []);
    }
  }

  // Dedup within the union first, then merge + cap.
  const flat: RetrievedItem[] = [];
  for (const items of perNamespace.values()) {
    for (const item of items) flat.push(item);
  }
  const deduped = dedupBySource(flat);
  // Reassemble into a Map for mergeAndCap so the helper signature is honored.
  const dedupedByNs = new Map<MemoryNamespace, RetrievedItem[]>();
  for (const item of deduped) {
    const arr = dedupedByNs.get(item.namespace) ?? [];
    arr.push(item);
    dedupedByNs.set(item.namespace, arr);
  }
  const retrieved = mergeAndCap(dedupedByNs, globalTopK);

  const byNamespace = emptyByNamespace();
  for (const item of retrieved) {
    byNamespace[item.namespace] += 1;
  }

  const latencyMs = Date.now() - t0;

  // Persist a single audit row covering the merged result.
  let retrievalEventId = -1;
  try {
    const inserted = await db
      .insert(soleneRetrievalEvents)
      .values({
        queryingAgentRole: agentRole,
        queryDispatchId: query.queryDispatchId ?? null,
        queryText: truncatedQuery,
        queryNamespace: `cross:${namespaces.join(",")}`,
        topK: globalTopK,
        retrievedCount: retrieved.length,
        retrievedSourceRefs: retrieved.map(
          (m) => `${m.namespace}/${m.sourceRef}`,
        ),
        similarityScores: retrieved.map((m) =>
          m.similarityScore.toFixed(4),
        ) as unknown as string[],
        latencyMs,
      })
      .returning({ id: soleneRetrievalEvents.id });
    retrievalEventId = inserted[0]?.id ?? -1;
  } catch (err) {
    logger.warn("memoryRetrieval.cross.audit_persist_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  return { retrievalEventId, retrieved, byNamespace, latencyMs };
}

function emptyByNamespace(): Record<MemoryNamespace, number> {
  return {
    feedback_memory: 0,
    dispatch_summary: 0,
    agent_decision: 0,
    decision_trace_step: 0,
    audit_finding: 0,
    founder_precedent: 0,
  };
}

// ============================================================================
// buildMultiNamespacePromptBlock
// ============================================================================

const PROMPT_SNIPPET_MAX_CHARS = 200;

function truncateSnippet(s: string): string {
  if (s.length <= PROMPT_SNIPPET_MAX_CHARS) return s;
  return s.slice(0, PROMPT_SNIPPET_MAX_CHARS) + "…";
}

/**
 * Render the merged retrieval result as a grouped markdown block. Empty
 * input → "" so callers can concatenate unconditionally. Skips sections
 * where a namespace contributed zero items.
 */
export function buildMultiNamespacePromptBlock(
  items: RetrievedItem[],
): string {
  if (items.length === 0) return "";

  // Group by namespace, preserving the per-namespace sort by similarity desc.
  const grouped = new Map<MemoryNamespace, RetrievedItem[]>();
  for (const item of items) {
    const arr = grouped.get(item.namespace) ?? [];
    arr.push(item);
    grouped.set(item.namespace, arr);
  }
  for (const arr of grouped.values()) {
    arr.sort((a, b) => b.similarityScore - a.similarityScore);
  }

  const header = `# Relevant historical context (n=${items.length})\n`;

  const sections: string[] = [];
  for (const ns of NAMESPACE_RENDER_ORDER) {
    const arr = grouped.get(ns);
    if (!arr || arr.length === 0) continue;
    const title = NAMESPACE_DISPLAY_NAMES[ns];
    const lines: string[] = [`\n## ${title} (${arr.length})\n`];
    for (const item of arr) {
      const pct = (item.similarityScore * 100).toFixed(1);
      const snippet = truncateSnippet(item.contentSnippet);
      lines.push(`- **${item.sourceRef}** (sim: ${pct}%): ${snippet}`);
    }
    sections.push(lines.join("\n"));
  }

  return header + sections.join("\n") + "\n";
}

// ============================================================================
// getCorpusStatus — founder visibility surface
// ============================================================================

export interface CorpusStatus {
  perNamespace: Record<
    MemoryNamespace,
    {
      rowsIngested: number;
      lastIngestedAt: Date | null;
      rowsFailed: number;
    }
  >;
  totalEmbeddings: number;
}

/**
 * Per-namespace ingest stats + total embedding row count. Used by the
 * founder visibility surface. NEVER throws — returns zeroed defaults on
 * any DB error.
 */
export async function getCorpusStatus(): Promise<CorpusStatus> {
  const perNamespace: CorpusStatus["perNamespace"] = {
    feedback_memory: { rowsIngested: 0, lastIngestedAt: null, rowsFailed: 0 },
    dispatch_summary: { rowsIngested: 0, lastIngestedAt: null, rowsFailed: 0 },
    agent_decision: { rowsIngested: 0, lastIngestedAt: null, rowsFailed: 0 },
    decision_trace_step: {
      rowsIngested: 0,
      lastIngestedAt: null,
      rowsFailed: 0,
    },
    audit_finding: { rowsIngested: 0, lastIngestedAt: null, rowsFailed: 0 },
    founder_precedent: { rowsIngested: 0, lastIngestedAt: null, rowsFailed: 0 },
  };
  let totalEmbeddings = 0;

  try {
    const statusResult = await db.execute<{
      namespace: string;
      rows_ingested: number;
      last_ingested_at: Date | string | null;
      rows_failed: number;
    }>(sql`
      SELECT namespace, rows_ingested, last_ingested_at, rows_failed
      FROM solene_memory_corpus_status
    `);
    const statusList: any[] = Array.isArray(statusResult)
      ? (statusResult as any[])
      : ((statusResult as any)?.rows ?? []);
    for (const row of statusList) {
      const ns = row.namespace as MemoryNamespace;
      if (perNamespace[ns]) {
        perNamespace[ns] = {
          rowsIngested: row.rows_ingested ?? 0,
          lastIngestedAt:
            row.last_ingested_at == null
              ? null
              : row.last_ingested_at instanceof Date
                ? row.last_ingested_at
                : new Date(row.last_ingested_at),
          rowsFailed: row.rows_failed ?? 0,
        };
      }
    }
  } catch (err) {
    logger.warn("memoryRetrieval.corpusStatus.status_db_error", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const totalResult = await db.execute<{ count: number | string }>(sql`
      SELECT COUNT(*)::int AS count FROM solene_embedded_records
    `);
    const totalList: any[] = Array.isArray(totalResult)
      ? (totalResult as any[])
      : ((totalResult as any)?.rows ?? []);
    const raw = totalList[0]?.count;
    totalEmbeddings = typeof raw === "string" ? parseInt(raw, 10) : (raw ?? 0);
    if (!Number.isFinite(totalEmbeddings)) totalEmbeddings = 0;
  } catch (err) {
    logger.warn("memoryRetrieval.corpusStatus.total_db_error", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  return { perNamespace, totalEmbeddings };
}

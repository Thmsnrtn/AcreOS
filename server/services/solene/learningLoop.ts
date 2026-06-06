/**
 * SOLENE — learning loop (Layer 3 capability L3.10).
 *
 * RAG over the L3.14-shipped solene_embedded_records table: when an agent is
 * dispatched on a task, we surface the most-relevant *past corrections* from
 * the feedback-memory corpus so it can apply the lessons proactively rather
 * than re-learning them by being corrected.
 *
 * Three pieces wired together:
 *
 *   retrieveRelevantMemories(query)
 *     Embed the query text, run a cosine-similarity search via pgvector,
 *     persist a solene_retrieval_events audit row, return the top-K matches.
 *     Falls back gracefully (empty result + warn log + retrievalEventId=-1)
 *     when the embeddings table is empty OR when the DB throws. NEVER throws.
 *
 *   buildRetrievedMemoriesPromptBlock(retrieved)
 *     Render a markdown block to inject into a dispatched agent's system
 *     prompt: "Relevant past corrections (n=K): …". Skip when retrieved is
 *     empty (returns "").
 *
 *   cosineSimilarity(a, b)
 *     Pure helper exported for tests + downstream consumers.
 *
 *   listRecentRetrievals(opts)
 *     Founder visibility surface — "show me the last N retrievals, optionally
 *     filtered by agent role".
 *
 *   getRetrievalStats(windowHours)
 *     Aggregate stats for the daily pulse — totalQueries, averageLatencyMs,
 *     averageTopSimilarity, zeroResultQueries, byAgent.
 *
 * ----------------------------------------------------------------------------
 * Embedding model — production Voyage with placeholder fail-open fallback
 * ----------------------------------------------------------------------------
 * Production path: Voyage AI (`voyage-3-large`, 1024-dim) via
 * `../embeddings/voyageClient.embedTexts`. We call with `input_type='query'`
 * for retrieval — Voyage tunes recall asymmetrically between document and
 * query embeddings, and using the right side of that distinction is a
 * measurable recall win at zero cost.
 *
 * Fallback path: `placeholderEmbedding` (deterministic feature-hash → 1024-d).
 * This is the fail-open default — on ANY Voyage failure (missing key, HTTP
 * error, timeout, malformed response, dim mismatch) we log a warn + return
 * the placeholder vector so the retrieval surface is never bricked. Recall
 * degrades but the path keeps working. The placeholder MUST remain in this
 * file as a function — DO NOT delete it.
 *
 * The `solene_embedded_records.embedding_model` column tracks which model
 * produced each stored vector so we can detect and skip cross-model
 * comparisons.
 *
 * ----------------------------------------------------------------------------
 * Wire-in to dispatchRunner (DEFERRED)
 * ----------------------------------------------------------------------------
 * The dispatchRunner.buildSystemPrompt integration that calls
 * retrieveRelevantMemories(task) + appends buildRetrievedMemoriesPromptBlock(…)
 * is deferred to a follow-up wave — the runner is frozen for this dispatch.
 * This service ships the foundation; the integration is a 5-line follow-up.
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
  RETRIEVAL_TOP_K_MAX,
  RETRIEVAL_TOP_K_DEFAULT,
  type SoleneRetrievalEvent,
} from "@shared/schema/solene-learning-loop";
import { EMBEDDING_DIM } from "@shared/schema/solene-embeddings";
import type { SoleneDispatchAgentRole } from "@shared/schema/solene-dispatch";

// ============================================================================
// Public types
// ============================================================================

export interface RetrievalQuery {
  queryText: string;
  /** Defaults to 'feedback_memory'. */
  namespace?: string;
  /** Defaults to RETRIEVAL_TOP_K_DEFAULT (5); clamped to RETRIEVAL_TOP_K_MAX (20). */
  topK?: number;
  /** Defaults to 0.0 — no filtering. Range [-1, 1]. */
  minSimilarity?: number;
  /** Defaults to 'system' when the query isn't bound to a dispatched agent. */
  queryingAgentRole?: SoleneDispatchAgentRole | "system";
  /** Optional FK back into the dispatch queue. */
  queryDispatchId?: number;
  /**
   * Tahoe L2 lock-in — tenant-scope filter.
   *
   * When set, the cosine query becomes
   *   WHERE namespace = $ns
   *     AND (organization_id = $org OR organization_id IS NULL)
   * so the caller sees their own corpus + the team-shared (NULL) corpus
   * but never another tenant's corpus.
   *
   * When omitted (system-level callers — founder ad-hoc search, warm-
   * start audits, team-internal sweeps), no organization filter is
   * applied and ALL rows are visible. NEVER pass `undefined` from a
   * customer-facing surface — leave it explicit at the call site.
   */
  organizationId?: number;
}

export interface RetrievedMemory {
  sourceRef: string;
  contentSnippet: string;
  /** 0–1 for normalized embeddings + cosine (we don't clip). */
  similarityScore: number;
}

export interface RetrievalResult {
  /** -1 when the retrieval-event row could not be persisted. */
  retrievalEventId: number;
  retrieved: RetrievedMemory[];
  latencyMs: number;
}

export type RetrievalEventRow = SoleneRetrievalEvent;

// ============================================================================
// Constants
// ============================================================================

/**
 * The model name we persist alongside placeholder embeddings. When a real
 * embedding provider is wired in, this is replaced with that provider's
 * model identifier and the stored rows can be migrated in place.
 */
export const PLACEHOLDER_EMBEDDING_MODEL = "placeholder-feature-hash-v1";

// Default fall-back agent role when the caller didn't pass one. We can't
// constrain it to SoleneDispatchAgentRole because non-dispatch callers
// (founder ad-hoc search, warm-start audits) also retrieve.
const DEFAULT_AGENT_ROLE = "system";

const DEFAULT_NAMESPACE = "feedback_memory";

// ============================================================================
// Pure helpers
// ============================================================================

/**
 * Phase 0 placeholder embedding — deterministic feature-hash → fixed-dim
 * vector + L2 normalization. NOT production quality; ships the infra.
 *
 * Tokenization: lowercase + whitespace-split + drop tokens ≤2 chars. The
 * same algorithm is duplicated in scripts/ingest-feedback-memories.mjs so
 * the ingestion + query paths produce comparable vectors without sharing
 * a runtime.
 */
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
 * `input_type='query'`. Fail-open fallback: placeholderEmbedding (a warn
 * log fires so the founder visibility surface notices the degradation).
 */
async function embedQueryText(text: string): Promise<number[]> {
  try {
    const result = await embedTexts({ texts: [text], inputType: "query" });
    return result.embeddings[0];
  } catch (err) {
    logger.warn("learningLoop.retrieve.voyage_fallback", {
      err: err instanceof Error ? err.message : String(err),
    });
    return placeholderEmbedding(text, EMBEDDING_DIM);
  }
}

/**
 * Cosine similarity between two equal-length vectors.
 * Returns 0 when either input has zero norm (no NaN).
 *
 * Exported for tests + downstream consumers.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Truncate a query-text for the audit row.
 */
function truncateForAudit(text: string): string {
  if (text.length <= RETRIEVAL_QUERY_TEXT_MAX_CHARS) return text;
  return (
    text.slice(0, RETRIEVAL_QUERY_TEXT_MAX_CHARS) +
    RETRIEVAL_QUERY_TRUNCATION_SUFFIX
  );
}

/**
 * Serialize a JS number[] to pgvector's textual format "[0.1,0.2,...]".
 */
function vectorToPgLiteral(vec: number[]): string {
  return "[" + vec.join(",") + "]";
}

// ============================================================================
// retrieveRelevantMemories
// ============================================================================

/**
 * Embed the query text, run cosine similarity in pgvector, persist a
 * solene_retrieval_events audit row, return matches.
 *
 * NEVER throws. On any failure (empty corpus, DB error, embedding error)
 * returns a graceful empty result + warn log.
 */
export async function retrieveRelevantMemories(
  query: RetrievalQuery,
): Promise<RetrievalResult> {
  const t0 = Date.now();
  const namespace = query.namespace ?? DEFAULT_NAMESPACE;
  const minSim = query.minSimilarity ?? 0;
  const requestedK = query.topK ?? RETRIEVAL_TOP_K_DEFAULT;
  const topK = Math.max(1, Math.min(RETRIEVAL_TOP_K_MAX, requestedK));
  const agentRole = query.queryingAgentRole ?? DEFAULT_AGENT_ROLE;
  const truncatedQuery = truncateForAudit(query.queryText);

  let retrieved: RetrievedMemory[] = [];

  try {
    const queryVector = await embedQueryText(query.queryText);
    const pgLiteral = vectorToPgLiteral(queryVector);

    // Tahoe L2 — when the caller is tenant-scoped, restrict to their org
    // + the team-shared (NULL) corpus. Predicate is intentionally
    // placed BEFORE namespace so the
    // (organization_id, namespace, created_at) composite index can serve
    // both the cosine ORDER BY and the filter — pgvector's HNSW pass
    // happens after the b-tree probe narrows the candidate set.
    const orgScope = query.organizationId;
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
        AND namespace = ${namespace}
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${pgLiteral}::vector
      LIMIT ${topK}
    `);

    const list: any[] = Array.isArray(result)
      ? (result as any[])
      : ((result as any)?.rows ?? []);

    retrieved = list
      .map((r) => ({
        sourceRef: r.source_ref,
        contentSnippet: r.content_snippet,
        similarityScore:
          typeof r.similarity === "string"
            ? parseFloat(r.similarity)
            : r.similarity,
      }))
      .filter((m) => m.similarityScore >= minSim);

    if (retrieved.length === 0) {
      logger.warn("learningLoop.retrieve.zero_results", {
        namespace,
        topK,
        agentRole,
      });
    }
  } catch (err) {
    logger.warn("learningLoop.retrieve.db_error", {
      namespace,
      topK,
      agentRole,
      err: err instanceof Error ? err.message : String(err),
    });
    return {
      retrievalEventId: -1,
      retrieved: [],
      latencyMs: Date.now() - t0,
    };
  }

  const latencyMs = Date.now() - t0;

  // Persist the audit row. If this fails we still return the retrieved
  // matches — the consumer can use them.
  let retrievalEventId = -1;
  try {
    const inserted = await db
      .insert(soleneRetrievalEvents)
      .values({
        queryingAgentRole: agentRole,
        queryDispatchId: query.queryDispatchId ?? null,
        queryText: truncatedQuery,
        queryNamespace: namespace,
        topK,
        retrievedCount: retrieved.length,
        retrievedSourceRefs: retrieved.map((m) => m.sourceRef),
        // numeric(5,4)[] — drizzle accepts strings to preserve precision.
        similarityScores: retrieved.map((m) =>
          m.similarityScore.toFixed(4),
        ) as unknown as string[],
        latencyMs,
      })
      .returning({ id: soleneRetrievalEvents.id });
    retrievalEventId = inserted[0]?.id ?? -1;
  } catch (err) {
    logger.warn("learningLoop.retrieve.audit_persist_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  return { retrievalEventId, retrieved, latencyMs };
}

// ============================================================================
// buildRetrievedMemoriesPromptBlock
// ============================================================================

/**
 * Render the retrieved memories as a markdown block to inject into the
 * dispatched agent's system prompt. Empty input → empty string (caller can
 * concat unconditionally).
 *
 * Format:
 *
 *   ## Relevant past corrections (n=3)
 *
 *   These are lessons from prior work that the orchestration layer surfaced
 *   as relevant to your current task. Apply them proactively.
 *
 *   ### feedback-coo-authority — similarity 0.8421
 *
 *   <snippet>
 *
 *   ### feedback-comprehensive-testing — similarity 0.7611
 *
 *   …
 */
export function buildRetrievedMemoriesPromptBlock(
  retrieved: RetrievedMemory[],
): string {
  if (retrieved.length === 0) return "";
  const header =
    `## Relevant past corrections (n=${retrieved.length})\n\n` +
    `These are lessons from prior work that the orchestration layer surfaced ` +
    `as relevant to your current task. Apply them proactively.\n`;
  const body = retrieved
    .map((m) => {
      const sim = m.similarityScore.toFixed(4);
      return `\n### ${m.sourceRef} — similarity ${sim}\n\n${m.contentSnippet}\n`;
    })
    .join("");
  return header + body;
}

// ============================================================================
// listRecentRetrievals — founder visibility surface
// ============================================================================

export interface ListRecentRetrievalsOpts {
  agentRole?: SoleneDispatchAgentRole | "system";
  limit?: number;
}

export async function listRecentRetrievals(
  opts: ListRecentRetrievalsOpts = {},
): Promise<RetrievalEventRow[]> {
  const limit = Math.max(1, Math.min(200, opts.limit ?? 50));
  try {
    const result = await db.execute<RetrievalEventRow>(sql`
      SELECT id, queried_at, querying_agent_role, query_dispatch_id,
             query_text, query_namespace, top_k, retrieved_count,
             retrieved_source_refs, similarity_scores, latency_ms
      FROM solene_retrieval_events
      ${opts.agentRole ? sql`WHERE querying_agent_role = ${opts.agentRole}` : sql``}
      ORDER BY queried_at DESC
      LIMIT ${limit}
    `);
    const list: any[] = Array.isArray(result)
      ? (result as any[])
      : ((result as any)?.rows ?? []);
    return list.map((r) => ({
      id: r.id,
      queriedAt: r.queried_at,
      queryingAgentRole: r.querying_agent_role,
      queryDispatchId: r.query_dispatch_id,
      queryText: r.query_text,
      queryNamespace: r.query_namespace,
      topK: r.top_k,
      retrievedCount: r.retrieved_count,
      retrievedSourceRefs: r.retrieved_source_refs ?? [],
      similarityScores: r.similarity_scores ?? [],
      latencyMs: r.latency_ms,
    })) as RetrievalEventRow[];
  } catch (err) {
    logger.warn("learningLoop.listRecent.db_error", {
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

// ============================================================================
// getRetrievalStats — daily pulse aggregate
// ============================================================================

export interface RetrievalStats {
  totalQueries: number;
  averageLatencyMs: number;
  averageTopSimilarity: number;
  zeroResultQueries: number;
  byAgent: Record<string, number>;
}

/**
 * Aggregate retrieval activity over the last `windowHours` (capped at 30
 * days, defaults to 24h-equivalent via caller).
 *
 * `averageTopSimilarity` is the average of the *first* (highest) similarity
 * score on each retrieval that returned at least one match; zero-result
 * queries are excluded from this average but counted in `zeroResultQueries`.
 */
export async function getRetrievalStats(
  windowHours: number,
): Promise<RetrievalStats> {
  const cappedHours = Math.max(1, Math.min(24 * 30, windowHours));
  const empty: RetrievalStats = {
    totalQueries: 0,
    averageLatencyMs: 0,
    averageTopSimilarity: 0,
    zeroResultQueries: 0,
    byAgent: {},
  };

  try {
    const result = await db.execute<{
      querying_agent_role: string;
      retrieved_count: number;
      similarity_scores: string[] | number[] | null;
      latency_ms: number;
    }>(sql`
      SELECT querying_agent_role, retrieved_count, similarity_scores, latency_ms
      FROM solene_retrieval_events
      WHERE queried_at >= now() - (${cappedHours} || ' hours')::interval
    `);
    const list: any[] = Array.isArray(result)
      ? (result as any[])
      : ((result as any)?.rows ?? []);

    if (list.length === 0) return empty;

    let totalLatency = 0;
    let totalTopSim = 0;
    let topSimCount = 0;
    let zeroResults = 0;
    const byAgent: Record<string, number> = {};

    for (const r of list) {
      totalLatency += r.latency_ms ?? 0;
      const role = r.querying_agent_role ?? "system";
      byAgent[role] = (byAgent[role] ?? 0) + 1;
      const count = r.retrieved_count ?? 0;
      if (count === 0) {
        zeroResults += 1;
      } else {
        const scores = r.similarity_scores ?? [];
        if (scores.length > 0) {
          const first = scores[0];
          const top =
            typeof first === "string" ? parseFloat(first) : (first as number);
          if (Number.isFinite(top)) {
            totalTopSim += top;
            topSimCount += 1;
          }
        }
      }
    }

    return {
      totalQueries: list.length,
      averageLatencyMs: list.length === 0 ? 0 : totalLatency / list.length,
      averageTopSimilarity: topSimCount === 0 ? 0 : totalTopSim / topSimCount,
      zeroResultQueries: zeroResults,
      byAgent,
    };
  } catch (err) {
    logger.warn("learningLoop.getStats.db_error", {
      err: err instanceof Error ? err.message : String(err),
    });
    return empty;
  }
}

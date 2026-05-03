/**
 * Phase 3 Week 14 (Sayuri-Vatanen §1) — pgvector retrieval helpers.
 *
 * Why this exists
 * ───────────────
 * Before this module, deal-pattern similarity was computed client-side
 * by pulling every row from `deal_patterns` and running a cosine loop
 * in JS. That worked at <100 patterns; it falls over at 10k+.
 *
 * pgvector exposes a cosine-distance operator (`<=>`) and an IVFFlat
 * ANN index, so we can do top-K lookups in ~milliseconds against
 * millions of rows. Migration 0052 swaps the column type from `jsonb`
 * to `vector(1536)` and creates the IVFFlat index.
 *
 * Public surface
 * ──────────────
 *   findSimilar(orgId, embedding, k=10)  — top-K vector matches
 *   searchHybrid(orgId, query, k=10)     — combine vector + trigram
 *
 * `searchHybrid` runs both retrievers in parallel and merges with
 * Reciprocal Rank Fusion (RRF) so each contributes equally regardless
 * of score scale (cosine distance and ts_rank live on different
 * scales — RRF normalizes by rank).
 *
 * Embedding source
 * ────────────────
 * We reuse `dealPatternCloning.generateEmbedding` for queries so the
 * model stays consistent with what's stored on disk
 * (text-embedding-3-small, 1536 dims).
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { logger } from "../utils/logger";

export interface VectorMatch {
  patternId: number;
  organizationId: number;
  cosineDistance: number; // 0 = identical, 2 = opposite
  similarityScore: number; // 1 - distance/2, normalized to [0,1]
}

export interface HybridMatch {
  patternId: number;
  organizationId: number;
  fusedScore: number;
  vectorRank: number | null;
  keywordRank: number | null;
}

/**
 * Convert a JS number[] into pgvector's textual wire format.
 * Stored representation: "[0.1,0.2,...]". Whitespace is allowed but
 * we strip it so the SQL string stays compact.
 */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

/**
 * Top-K cosine similarity over `deal_patterns.embedding_vector`.
 *
 * We multiply by `vector_cosine_ops` semantics: distance = 1 - cosine.
 * So lower is closer. We expose `similarityScore = 1 - distance/2` in
 * [0,1] for consistent display alongside ts_rank.
 *
 * @param orgId       Restrict to this organization (multi-tenant safety).
 * @param embedding   Query embedding (must match stored dim, 1536).
 * @param k           Top-K. Default 10.
 */
export async function findSimilar(
  orgId: number,
  embedding: number[],
  k: number = 10,
): Promise<VectorMatch[]> {
  if (!embedding || embedding.length === 0) return [];

  const literal = toVectorLiteral(embedding);

  try {
    const result = await db.execute<{
      id: number;
      organization_id: number;
      cosine_distance: string;
    }>(sql`
      SELECT
        id,
        organization_id,
        embedding_vector <=> ${literal}::vector AS cosine_distance
      FROM deal_patterns
      WHERE organization_id = ${orgId}
        AND embedding_vector IS NOT NULL
      ORDER BY embedding_vector <=> ${literal}::vector
      LIMIT ${k}
    `);

    const rows = (result as any)?.rows ?? [];
    return rows.map((row: any): VectorMatch => {
      const distance = parseFloat(row.cosine_distance ?? "2");
      return {
        patternId: row.id,
        organizationId: row.organization_id,
        cosineDistance: distance,
        similarityScore: Math.max(0, Math.min(1, 1 - distance / 2)),
      };
    });
  } catch (err) {
    logger.error("[vectorSearch.findSimilar] query failed", err, {
      metadata: { orgId, k, dim: embedding.length },
    });
    return [];
  }
}

/**
 * Reciprocal Rank Fusion — combine two ranked lists into one.
 *
 * RRF score for a doc d at rank r: 1 / (k + r). The constant k=60 is
 * the empirical default from the original Cormack et al. paper; it
 * dampens the contribution of documents far down either list while
 * letting top-of-list items in either retriever dominate.
 *
 * Each retriever contributes equally (50/50 weight, per task spec) by
 * summing their RRF scores per document.
 */
export function reciprocalRankFusion<T extends { patternId: number }>(
  vectorMatches: T[],
  keywordMatches: T[],
  k: number = 60,
): HybridMatch[] {
  const scores = new Map<number, HybridMatch>();

  vectorMatches.forEach((match, idx) => {
    const rank = idx + 1;
    const rrf = 1 / (k + rank);
    scores.set(match.patternId, {
      patternId: match.patternId,
      organizationId: (match as any).organizationId ?? 0,
      fusedScore: rrf,
      vectorRank: rank,
      keywordRank: null,
    });
  });

  keywordMatches.forEach((match, idx) => {
    const rank = idx + 1;
    const rrf = 1 / (k + rank);
    const existing = scores.get(match.patternId);
    if (existing) {
      existing.fusedScore += rrf;
      existing.keywordRank = rank;
    } else {
      scores.set(match.patternId, {
        patternId: match.patternId,
        organizationId: (match as any).organizationId ?? 0,
        fusedScore: rrf,
        vectorRank: null,
        keywordRank: rank,
      });
    }
  });

  return Array.from(scores.values()).sort(
    (a, b) => b.fusedScore - a.fusedScore,
  );
}

/**
 * Hybrid retrieval — vector cosine + trigram keyword, fused by RRF.
 *
 * Generates an embedding for `query` (lazy import keeps cold starts
 * cheap when nothing else is calling the OpenAI client), then runs
 * both retrievers in parallel.
 *
 * Returns up to `k` patterns ordered by fused score.
 */
export async function searchHybrid(
  orgId: number,
  query: string,
  k: number = 10,
): Promise<HybridMatch[]> {
  if (!query || query.trim().length < 2) return [];

  // Vector arm — embed query, fetch top-K vector neighbours.
  const vectorArm = (async (): Promise<VectorMatch[]> => {
    try {
      const { generateQueryEmbedding } = await import("./embeddingClient");
      const embedding = await generateQueryEmbedding(query);
      if (!embedding) return [];
      return findSimilar(orgId, embedding, k);
    } catch (err) {
      logger.warn("[searchHybrid] vector arm failed", {
        metadata: { error: String(err) },
      });
      return [];
    }
  })();

  // Keyword arm — trigram fuzzy match on the patterns' fingerprint
  // jsonb (cast to text). Postgres %-similarity threshold is set to
  // its default 0.3, which tolerates typos like "soltary" → "solitary"
  // without polluting the result set.
  const keywordArm = (async (): Promise<VectorMatch[]> => {
    try {
      const result = await db.execute<{
        id: number;
        organization_id: number;
        sim: string;
      }>(sql`
        SELECT
          id,
          organization_id,
          similarity(fingerprint::text, ${query}) AS sim
        FROM deal_patterns
        WHERE organization_id = ${orgId}
          AND fingerprint::text % ${query}
        ORDER BY sim DESC
        LIMIT ${k}
      `);
      const rows = (result as any)?.rows ?? [];
      return rows.map(
        (row: any): VectorMatch => ({
          patternId: row.id,
          organizationId: row.organization_id,
          cosineDistance: 1 - parseFloat(row.sim ?? "0"),
          similarityScore: parseFloat(row.sim ?? "0"),
        }),
      );
    } catch (err) {
      logger.warn("[searchHybrid] keyword arm failed", {
        metadata: { error: String(err) },
      });
      return [];
    }
  })();

  const [vectorMatches, keywordMatches] = await Promise.all([
    vectorArm,
    keywordArm,
  ]);

  return reciprocalRankFusion(vectorMatches, keywordMatches).slice(0, k);
}

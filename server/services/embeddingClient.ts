/**
 * Phase 3 Week 14 (Sayuri-Vatanen §1) — embedding client.
 *
 * Single source of truth for OpenAI text embedding generation. The
 * existing `dealPatternCloning.generateEmbedding` is stamp-coupled to
 * a deal-specific `PatternFingerprint` shape, so we extract the
 * generic "string → 1536-dim vector" path here for the search service
 * (and for any future caller that wants to embed plain text).
 *
 * Model: `text-embedding-3-small` — 1536 dims, $0.02 / 1M tokens.
 * If we ever upgrade to `text-embedding-3-large` (3072 dims) we'll
 * need to re-run migration 0052 with the new dim and bulk-regenerate.
 */

import { getOpenAIClient } from "../utils/openaiClient";
import { logger } from "../utils/logger";

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

/**
 * Generate a 1536-dim embedding for a free-text query.
 *
 * Returns null when:
 *   • the OpenAI client isn't configured (e.g. local dev without keys)
 *   • the API call fails (rate limit, network, etc.)
 *
 * Callers should treat null as "vector arm unavailable" and fall back
 * to keyword-only retrieval.
 */
export async function generateQueryEmbedding(
  text: string,
): Promise<number[] | null> {
  if (!text || !text.trim()) return null;

  const openai = getOpenAIClient();
  if (!openai) {
    logger.debug("[embeddingClient] OpenAI client not configured");
    return null;
  }

  try {
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text,
    });

    const embedding = response.data[0]?.embedding;
    if (!embedding || embedding.length !== EMBEDDING_DIMENSIONS) {
      logger.warn("[embeddingClient] unexpected embedding shape", {
        metadata: {
          received: embedding?.length ?? 0,
          expected: EMBEDDING_DIMENSIONS,
        },
      });
      return null;
    }

    return embedding;
  } catch (err) {
    logger.error("[embeddingClient] embedding API call failed", err);
    return null;
  }
}

/**
 * Pillar 9.4 — batched embedding generation.
 *
 * OpenAI's text-embedding-3-small accepts an array of strings in a
 * single API call. Submitting K=100 rows per call instead of K calls
 * collapses ~100× network overhead. The price is the same per-token
 * either way ($0.02/M); the saving is in latency, request count, and
 * rate-limit headroom.
 *
 * Returns an array of (embedding | null) aligned by input index.  Any
 * row that came back with the wrong dim is returned as null so the
 * caller can skip the UPDATE for that row.  Returns null (not an array)
 * when the API call itself fails — same semantic as the per-row helper.
 */
export async function generateQueryEmbeddingsBatch(
  texts: string[],
): Promise<Array<number[] | null> | null> {
  if (!Array.isArray(texts) || texts.length === 0) return [];

  const openai = getOpenAIClient();
  if (!openai) {
    logger.debug("[embeddingClient] OpenAI client not configured (batch)");
    return null;
  }

  // Drop empties before the API call — OpenAI rejects empty strings.
  // We preserve original positions so callers can rebuild the result
  // aligned with their input array.
  const nonEmptyIdx: number[] = [];
  const nonEmptyTexts: string[] = [];
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i];
    if (t && t.trim()) {
      nonEmptyIdx.push(i);
      nonEmptyTexts.push(t);
    }
  }

  const out: Array<number[] | null> = new Array(texts.length).fill(null);
  if (nonEmptyTexts.length === 0) return out;

  try {
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: nonEmptyTexts,
    });
    for (let i = 0; i < nonEmptyTexts.length; i++) {
      const embedding = response.data[i]?.embedding;
      if (embedding && embedding.length === EMBEDDING_DIMENSIONS) {
        out[nonEmptyIdx[i]] = embedding;
      }
    }
    return out;
  } catch (err) {
    logger.error("[embeddingClient] batched embedding API call failed", err);
    return null;
  }
}

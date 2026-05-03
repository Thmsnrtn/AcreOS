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

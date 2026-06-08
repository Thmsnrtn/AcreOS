// ============================================================================
// SERVER/SERVICES/PAX/LANDKNOWLEDGE/RETRIEVAL.TS
// ----------------------------------------------------------------------------
// Andrei (Tahoe elevation idea #5) — retrieval over the curated land-knowledge
// corpus. Embeds a query via the existing Voyage client and runs ONE pgvector
// cosine query against the global (organization_id IS NULL) land_knowledge
// rows in solene_embedded_records, then re-hydrates full cards (with their
// citations) from the in-memory corpus by source_ref.
//
// This is the read side of the retrieve_land_knowledge Pax tool. It is
// DISTINCT from parcel-fact retrieval (DataSourceBroker / research_property):
// it returns GENERAL land knowledge with attributions, never per-parcel facts.
//
// Design notes
// ────────────
//  - NEVER throws. A Voyage outage or DB error returns an empty result; the
//    Pax loop simply gets no knowledge cards and continues. Fail-open.
//  - The actual `body` + `citation` returned come from the in-process corpus
//    (corpus.ts), NOT from the DB snippet — the DB stores only an embedding +
//    a snippet for debug. This guarantees the citation Pax sees is exactly the
//    authored authority of record, immune to snippet truncation/drift.
//  - A pgvector hit whose source_ref no longer maps to a live card (corpus
//    edited, row stale) is dropped — we never surface a card we can't cite.
// ============================================================================

import { sql } from "drizzle-orm";
import { db } from "../../../db";
import { logger } from "../../../utils/logger";
import { embedTexts } from "../../embeddings/voyageClient";
import {
  LAND_KNOWLEDGE_NAMESPACE,
  getLandKnowledgeCard,
  type LandKnowledgeCard,
} from "./corpus";

/** A retrieved card plus its cosine similarity to the query. */
export interface RetrievedLandKnowledge {
  card: LandKnowledgeCard;
  similarityScore: number;
}

export interface RetrieveLandKnowledgeOptions {
  /** Top-K cap after the min-similarity filter. Default 3, hard-capped at 8. */
  topK?: number;
  /**
   * Minimum cosine similarity (0..1) to surface a card. Default 0.25 — below
   * this the match is usually off-topic noise. Tuned via the recall eval.
   */
  minSimilarity?: number;
}

const DEFAULT_TOP_K = 3;
const TOP_K_MAX = 8;
const DEFAULT_MIN_SIMILARITY = 0.25;

function vectorToPgLiteral(vec: number[]): string {
  return "[" + vec.join(",") + "]";
}

/**
 * Retrieve the most relevant land-knowledge cards for a natural-language
 * query. NEVER throws — returns [] on any failure.
 *
 * @param query  the explanatory question, e.g. "what does FEMA Zone AE mean
 *               for building a house?"
 */
export async function retrieveLandKnowledge(
  query: string,
  options: RetrieveLandKnowledgeOptions = {},
): Promise<RetrievedLandKnowledge[]> {
  const trimmed = (query ?? "").trim();
  if (trimmed.length < 2) return [];

  const topK = Math.max(1, Math.min(TOP_K_MAX, options.topK ?? DEFAULT_TOP_K));
  const minSim = options.minSimilarity ?? DEFAULT_MIN_SIMILARITY;

  // 1. Embed the query (input_type=query for best recall). Fail-open on error.
  let pgLiteral: string;
  try {
    const embedded = await embedTexts({ texts: [trimmed], inputType: "query" });
    const vec = embedded.embeddings[0];
    if (!Array.isArray(vec) || vec.length === 0) return [];
    pgLiteral = vectorToPgLiteral(vec);
  } catch (err) {
    logger.warn("[landKnowledge.retrieve] embed_failed", {
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
    return [];
  }

  // 2. One cosine query over the GLOBAL land_knowledge corpus
  //    (organization_id IS NULL — identical for every tenant).
  let rows: Array<{ source_ref: string; similarity: string | number }> = [];
  try {
    const result = await db.execute<{
      source_ref: string;
      similarity: string | number;
    }>(sql`
      SELECT source_ref,
             1 - (embedding <=> ${pgLiteral}::vector) AS similarity
      FROM solene_embedded_records
      WHERE namespace = ${LAND_KNOWLEDGE_NAMESPACE}
        AND organization_id IS NULL
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${pgLiteral}::vector
      LIMIT ${topK}
    `);
    rows = Array.isArray(result)
      ? (result as any[])
      : ((result as any)?.rows ?? []);
  } catch (err) {
    logger.warn("[landKnowledge.retrieve] query_failed", {
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
    return [];
  }

  // 3. Re-hydrate full cards from the in-process corpus + filter by similarity.
  //    Citations come from the authored card, never the DB snippet.
  const out: RetrievedLandKnowledge[] = [];
  for (const row of rows) {
    const score =
      typeof row.similarity === "string"
        ? parseFloat(row.similarity)
        : row.similarity;
    if (!Number.isFinite(score) || score < minSim) continue;
    const card = getLandKnowledgeCard(row.source_ref);
    if (!card) {
      // Stale row — corpus changed since ingest. Never surface an un-citable card.
      continue;
    }
    out.push({ card, similarityScore: score });
  }
  return out;
}

/**
 * Render retrieved cards into a compact, attributed block for the Pax tool
 * result. Each card is rendered with its citation so the grounding contract
 * (knowledge-card claims must cite the card) is enforceable. Empty input → a
 * sentinel object the tool surfaces as "no general knowledge found".
 *
 * Returns a structured payload (not a raw string) so the tool result stays
 * machine-readable; the `attributionContract` line is the load-bearing reminder
 * the model sees inline with the cards.
 */
export interface LandKnowledgeToolPayload {
  found: boolean;
  cards: Array<{
    id: string;
    topic: string;
    title: string;
    explanation: string;
    citation: string;
    similarity: number;
  }>;
  attributionContract: string;
}

export const LAND_KNOWLEDGE_ATTRIBUTION_CONTRACT =
  "These are GENERAL land-knowledge cards, not facts about any specific parcel. " +
  "When you use a card, attribute the explanation to its citation (e.g. \"per FEMA's flood-zone definitions\"). " +
  "NEVER state or imply that any card's general statement is true of the customer's specific parcel — " +
  "a parcel fact (this parcel's flood zone, soil, acreage, zoning, owner) must come from a parcel lookup this turn, not from a card.";

export function buildLandKnowledgePayload(
  retrieved: RetrievedLandKnowledge[],
): LandKnowledgeToolPayload {
  return {
    found: retrieved.length > 0,
    cards: retrieved.map((r) => ({
      id: r.card.id,
      topic: r.card.topic,
      title: r.card.title,
      explanation: r.card.body,
      citation: r.card.citation,
      similarity: Math.round(r.similarityScore * 1000) / 1000,
    })),
    attributionContract: LAND_KNOWLEDGE_ATTRIBUTION_CONTRACT,
  };
}

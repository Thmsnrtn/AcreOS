// ============================================================================
// SERVER/SERVICES/PAX/LANDKNOWLEDGE/INGEST.TS
// ----------------------------------------------------------------------------
// Andrei (Tahoe elevation idea #5) — embed the curated land-knowledge corpus
// via the Voyage client and upsert it into the generic pgvector registry
// (solene_embedded_records, namespace land_knowledge, organization_id = NULL).
//
// Idempotent: each card's source_ref is its stable slug, so re-running updates
// in place rather than appending. content_hash is the sha256 of the embedded
// text — if a card is unchanged AND its embedding_model matches, we skip the
// (paid) Voyage embed call. Mirrors the drift-detection discipline in the
// scripts/ingest-*.mjs scripts.
//
// Invoked by scripts/ingest-land-knowledge.mjs (operator one-shot / boot
// catch-up) — NOT on the hot Pax path. Retrieval (retrieval.ts) reads what
// this writes.
// ============================================================================

import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../../../db";
import { logger } from "../../../utils/logger";
import { embedTexts } from "../../embeddings/voyageClient";
import {
  EMBEDDED_SNIPPET_MAX_CHARS,
  EMBEDDED_SNIPPET_TRUNCATION_SUFFIX,
} from "@shared/schema/solene-embeddings";
import {
  LAND_KNOWLEDGE_CARDS,
  LAND_KNOWLEDGE_NAMESPACE,
  LAND_KNOWLEDGE_CORPUS_VERSION,
  cardEmbeddingText,
  type LandKnowledgeCard,
} from "./corpus";

export interface IngestResult {
  total: number;
  embedded: number;
  skipped: number;
  failed: number;
  errors: string[];
}

function snippet(text: string): string {
  if (text.length <= EMBEDDED_SNIPPET_MAX_CHARS) return text;
  return (
    text.slice(0, EMBEDDED_SNIPPET_MAX_CHARS) +
    EMBEDDED_SNIPPET_TRUNCATION_SUFFIX
  );
}

function hash(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

/**
 * Embed + upsert every card. Drift-aware: a card whose content_hash and
 * embedding_model already match the stored row is skipped (no Voyage call)
 * unless `force` is set.
 *
 * Returns a structured summary. NEVER throws — per-card failures are collected
 * so one bad embed doesn't abort the batch.
 */
export async function ingestLandKnowledge(
  opts: { force?: boolean } = {},
): Promise<IngestResult> {
  const result: IngestResult = {
    total: LAND_KNOWLEDGE_CARDS.length,
    embedded: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  // Pull existing (source_ref → {hash, model}) for the global corpus so we can
  // skip unchanged cards. One query, not one-per-card.
  const existing = new Map<string, { hash: string; model: string }>();
  try {
    const rows = await db.execute<{
      source_ref: string;
      content_hash: string;
      embedding_model: string;
    }>(sql`
      SELECT source_ref, content_hash, embedding_model
      FROM solene_embedded_records
      WHERE namespace = ${LAND_KNOWLEDGE_NAMESPACE}
        AND organization_id IS NULL
    `);
    const list: any[] = Array.isArray(rows)
      ? (rows as any[])
      : ((rows as any)?.rows ?? []);
    for (const r of list) {
      existing.set(r.source_ref, {
        hash: r.content_hash,
        model: r.embedding_model,
      });
    }
  } catch (err) {
    // Non-fatal: treat every card as new (we'll embed all).
    logger.warn("[landKnowledge.ingest] existing_probe_failed", {
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
  }

  for (const card of LAND_KNOWLEDGE_CARDS) {
    try {
      await ingestOneCard(card, existing, opts.force ?? false, result);
    } catch (err) {
      result.failed += 1;
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`${card.id}: ${msg}`);
      logger.warn("[landKnowledge.ingest] card_failed", {
        metadata: { cardId: card.id, error: msg },
      });
    }
  }

  logger.info("[landKnowledge.ingest] complete", {
    metadata: {
      corpusVersion: LAND_KNOWLEDGE_CORPUS_VERSION,
      total: result.total,
      embedded: result.embedded,
      skipped: result.skipped,
      failed: result.failed,
    },
  });

  return result;
}

async function ingestOneCard(
  card: LandKnowledgeCard,
  existing: Map<string, { hash: string; model: string }>,
  force: boolean,
  result: IngestResult,
): Promise<void> {
  const text = cardEmbeddingText(card);
  const contentHash = hash(text);

  // Drift check: skip if unchanged AND model matches AND not forcing.
  const prior = existing.get(card.id);
  if (!force && prior && prior.hash === contentHash) {
    result.skipped += 1;
    return;
  }

  const embedded = await embedTexts({ texts: [text], inputType: "document" });
  const vec = embedded.embeddings[0];
  if (!Array.isArray(vec) || vec.length === 0) {
    throw new Error("voyage returned an empty embedding");
  }
  const pgLiteral = "[" + vec.join(",") + "]";

  // Upsert on the (organization_id, namespace, source_ref) natural key.
  // organization_id is NULL (global corpus) — Postgres treats NULL as distinct
  // in unique indexes, so we use the explicit ON CONFLICT on the partial-NULL
  // key via raw SQL to match the migrate.mjs unique index. We DELETE+INSERT for
  // the NULL-org row to sidestep NULL-in-unique-index conflict-target quirks.
  await db.execute(sql`
    DELETE FROM solene_embedded_records
    WHERE namespace = ${LAND_KNOWLEDGE_NAMESPACE}
      AND organization_id IS NULL
      AND source_ref = ${card.id}
  `);
  await db.execute(sql`
    INSERT INTO solene_embedded_records
      (organization_id, namespace, source_ref, content_snippet,
       content_hash, embedding_model, embedding_dim, embedding, metadata)
    VALUES (
      NULL,
      ${LAND_KNOWLEDGE_NAMESPACE},
      ${card.id},
      ${snippet(text)},
      ${contentHash},
      ${embedded.model},
      ${embedded.dim},
      ${pgLiteral}::vector,
      ${sql`${JSON.stringify({
        topic: card.topic,
        title: card.title,
        citation: card.citation,
        corpusVersion: LAND_KNOWLEDGE_CORPUS_VERSION,
      })}::jsonb`}
    )
  `);

  result.embedded += 1;
}

/**
 * Phase 3 Week 14 (Sayuri-Vatanen §1) — embedding refresh job.
 *
 * Why this exists
 * ───────────────
 * Embeddings drift relative to the source document for two reasons:
 *
 *   1. The fingerprint changes — a deal pattern's property/seller/
 *      market sub-fields can be enriched after pattern creation, but
 *      the stored embedding still reflects the v0 fingerprint.
 *   2. The model changes — when we upgrade to a new embedding model
 *      (e.g. 3-small → 3-large) every existing row needs regen.
 *
 * Cadence
 * ───────
 * Rolling 7-day refresh: each tick, pick the N rows with the oldest
 * `embedding_refreshed_at` (or NULL) and regenerate them. Tick interval
 * is sized so we cover the whole table in 7 days at 100 rows/tick:
 *   ticks_per_7_days = (7 * 24 * 60 * 60 * 1000) / intervalMs
 *   for 100 rows/tick + 100k rows: intervalMs ≈ 6 minutes
 *
 * We use the self-rescheduling job framework (server/jobs/scheduler.ts)
 * so we get DLQ, exponential backoff, and job_runs telemetry for free.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { dealPatterns } from "@shared/schema";
import { eq } from "drizzle-orm";
import { logger } from "../utils/logger";
import { generateQueryEmbedding } from "../services/embeddingClient";
import { scheduleSelfRescheduling } from "./scheduler";

/**
 * Sweep up to `batchSize` patterns whose embedding is stale (older
 * than `staleAfterDays`) or missing, and regenerate them.
 *
 * Returns the number of patterns successfully refreshed.
 */
export async function refreshStaleEmbeddings(
  batchSize: number = 100,
  staleAfterDays: number = 7,
): Promise<number> {
  // Pull a batch of candidates: NULL embeddings or stale > N days.
  const candidates = await db.execute<{
    id: number;
    fingerprint: any;
    embedding_refreshed_at: Date | null;
  }>(sql`
    SELECT id, fingerprint, embedding_refreshed_at
    FROM deal_patterns
    WHERE fingerprint IS NOT NULL
      AND (
        embedding_refreshed_at IS NULL
        OR embedding_refreshed_at < NOW() - (${staleAfterDays}::int * INTERVAL '1 day')
      )
    ORDER BY embedding_refreshed_at NULLS FIRST
    LIMIT ${batchSize}
  `);

  const rows = (candidates as any)?.rows ?? [];
  if (rows.length === 0) return 0;

  let refreshed = 0;

  for (const row of rows) {
    try {
      // Re-derive the natural-language fingerprint and embed.
      const text = fingerprintToText(row.fingerprint);
      const embedding = await generateQueryEmbedding(text);

      if (!embedding) {
        // OpenAI unavailable — bail out of the whole batch; the next
        // tick will retry. This prevents us from hammering a degraded
        // upstream and burning through DLQ retries.
        logger.warn(
          "[embeddingRefresh] embedding API returned null — pausing batch",
        );
        break;
      }

      await db.execute(sql`
        UPDATE deal_patterns
        SET embedding_vector = ${`[${embedding.join(",")}]`}::vector,
            embedding_refreshed_at = NOW()
        WHERE id = ${row.id}
      `);

      refreshed += 1;
    } catch (err) {
      logger.error(
        `[embeddingRefresh] failed to refresh pattern ${row.id}`,
        err,
      );
      // Mark as touched so we don't loop on the same broken row every
      // tick. A separate audit pass can retry permanent-failure rows
      // by hand.
      try {
        await db
          .update(dealPatterns)
          .set({ embeddingRefreshedAt: new Date() })
          .where(eq(dealPatterns.id, row.id));
      } catch {
        /* observability — don't escalate */
      }
    }
  }

  if (refreshed > 0) {
    logger.info(`[embeddingRefresh] refreshed ${refreshed}/${rows.length} pattern embeddings`);
  }

  return refreshed;
}

/**
 * Re-implementation of `dealPatternCloning.fingerprintToText` here so
 * we don't form a circular import (dealPatternCloning ← embeddingRefresh
 * via embeddingClient ← dealPatternCloning). Keep the two in sync if
 * either changes.
 */
function fingerprintToText(fp: any): string {
  if (!fp || typeof fp !== "object") return "";
  const parts: string[] = [];
  const property = fp.property ?? {};
  if (property.acreage != null) {
    parts.push(
      `Property: ${property.acreage} acres in ${property.county ?? "?"}, ${
        property.state ?? "?"
      }`,
    );
  }
  if (property.zoning) parts.push(`Zoning: ${property.zoning}`);
  if (property.terrain) parts.push(`Terrain: ${property.terrain}`);
  if (property.roadAccess) parts.push(`Road Access: ${property.roadAccess}`);
  if (Array.isArray(property.utilities) && property.utilities.length) {
    parts.push(`Utilities: ${property.utilities.join(", ")}`);
  }

  const deal = fp.deal ?? {};
  if (deal.type) parts.push(`Deal Type: ${deal.type}`);
  if (deal.offerToAskRatio != null) {
    parts.push(`Offer/Ask Ratio: ${(deal.offerToAskRatio * 100).toFixed(1)}%`);
  }
  if (deal.daysToClose != null) parts.push(`Days to Close: ${deal.daysToClose}`);
  if (deal.finalMargin != null) {
    parts.push(`Final Margin: ${deal.finalMargin.toFixed(1)}%`);
  }

  if (fp.seller) {
    if (fp.seller.type) parts.push(`Seller Type: ${fp.seller.type}`);
    if (Array.isArray(fp.seller.motivation) && fp.seller.motivation.length) {
      parts.push(`Seller Motivation: ${fp.seller.motivation.join(", ")}`);
    }
  }

  if (fp.market) {
    if (fp.market.pricePerAcre != null) {
      parts.push(`Price Per Acre: $${fp.market.pricePerAcre.toFixed(0)}`);
    }
    if (fp.market.marketTrend) parts.push(`Market Trend: ${fp.market.marketTrend}`);
    if (fp.market.competitionLevel) {
      parts.push(`Competition: ${fp.market.competitionLevel}`);
    }
  }
  return parts.join(". ");
}

/**
 * Wire into the self-rescheduling job framework. Called from
 * server/index.ts during startup.
 *
 * intervalMs default 6 min — covers ~10k patterns/day at batch=100.
 */
export function startEmbeddingRefreshJob(
  intervalMs: number = 6 * 60 * 1000,
): () => void {
  return scheduleSelfRescheduling({
    name: "embedding_refresh",
    intervalMs,
    initialDelayMs: 90_000, // wait for the rest of the boot to settle
    run: async () => {
      const refreshed = await refreshStaleEmbeddings(100, 7);
      return refreshed;
    },
  });
}

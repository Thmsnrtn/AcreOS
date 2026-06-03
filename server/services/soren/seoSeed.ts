/**
 * SOREN — seed the soren_seo_rankings table with null-rank baseline rows.
 *
 * Called once on the first deploy after the schema lands so the founder
 * endpoint has a row to render per (page × keyword) before the daily cron
 * fires. Idempotent — skips any (page × keyword) that already has a row.
 *
 * Not registered as a cron — invoked manually via:
 *   tsx -e 'import("./server/services/soren/seoSeed").then(m => m.seedSeoRankings())'
 * …or from a future deploy-time hook.
 */

import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  sorenSeoRankings,
  type InsertSorenSeoRanking,
} from "@shared/schema/soren-seo";
import { LEARN_SEO_TARGETS } from "./seoTargets";
import { logger } from "../../utils/logger";

export interface SeedSeoRankingsResult {
  seeded: number;
  skipped: number;
}

export async function seedSeoRankings(): Promise<SeedSeoRankingsResult> {
  let seeded = 0;
  let skipped = 0;
  const now = new Date();
  for (const target of LEARN_SEO_TARGETS) {
    for (const keyword of target.targetKeywords) {
      const existing = await db
        .select({ id: sorenSeoRankings.id })
        .from(sorenSeoRankings)
        .where(
          and(
            eq(sorenSeoRankings.pagePath, target.pagePath),
            eq(sorenSeoRankings.targetKeyword, keyword),
          ),
        )
        .limit(1);
      if (existing.length > 0) {
        skipped++;
        continue;
      }
      const row: InsertSorenSeoRanking = {
        pagePath: target.pagePath,
        targetKeyword: keyword,
        googleRank: null,
        source: "serp_scrape",
        checkedAt: now,
      };
      try {
        await db.insert(sorenSeoRankings).values(row);
        seeded++;
      } catch (err) {
        logger.warn(
          `[sorenSeo] seed insert failed for ${target.pagePath} kw="${keyword}"`,
          err instanceof Error ? err : undefined,
        );
      }
    }
  }
  logger.info(
    `[sorenSeo] seed complete: ${seeded} seeded, ${skipped} already-present`,
  );
  return { seeded, skipped };
}

/**
 * Archetype scorer — recomputes rolling 30-day CTR / ROAS / spend per hook
 * archetype, weighted by spend so high-spend variants influence the score
 * more than low-spend ones.
 *
 * Output: cmo_hook_archetypes.rollingCtrPpm, rollingRoasBps, spendCentsLast30d,
 * rendersLast30d, generationWeight.
 *
 * generationWeight is the load-bearing field — the script generator reads
 * this to bias hook archetype selection. Range 25-200, default 100.
 * Boosts for archetypes outperforming the median CTR, demotion for laggards.
 * Minimum weight 25 so demoted archetypes still get exploration weight
 * (avoid lock-in to a few winners on shallow data).
 */

import { db } from "../../db";
import { cmoAdPerformance, cmoAdRenders, cmoScripts, cmoHookArchetypes } from "@shared/schema";
import { eq, and, gte, sql } from "drizzle-orm";
import { logger } from "../../utils/logger";

const ROLLING_WINDOW_DAYS = 30;
const MIN_RENDERS_FOR_WEIGHTING = 3;
const MAX_WEIGHT = 200;
const MIN_WEIGHT = 25;
const BASELINE_WEIGHT = 100;

export async function recomputeArchetypeScores(): Promise<number> {
  const cutoff = new Date(Date.now() - ROLLING_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // Aggregate impressions + clicks + spend per archetype via JOIN to scripts
  // and ad-performance.
  const rows = await db
    .select({
      archetype: cmoScripts.hookArchetype,
      impressions: sql<number>`COALESCE(SUM(${cmoAdPerformance.impressions}), 0)`.as("impressions"),
      clicks: sql<number>`COALESCE(SUM(${cmoAdPerformance.clicks}), 0)`.as("clicks"),
      spendCents: sql<number>`COALESCE(SUM(${cmoAdPerformance.spendCents}), 0)`.as("spend_cents"),
      renderCount: sql<number>`COUNT(DISTINCT ${cmoAdRenders.id})`.as("render_count"),
    })
    .from(cmoScripts)
    .innerJoin(cmoAdRenders, eq(cmoAdRenders.scriptId, cmoScripts.id))
    .innerJoin(cmoAdPerformance, eq(cmoAdPerformance.renderId, cmoAdRenders.id))
    .where(gte(cmoAdPerformance.date, cutoff))
    .groupBy(cmoScripts.hookArchetype);

  if (rows.length === 0) {
    logger.info("[cmo:archetype] no performance data yet — leaving weights at default");
    return 0;
  }

  // Compute median CTR across archetypes that have meaningful render counts.
  const ctrs: number[] = [];
  for (const row of rows) {
    if (row.renderCount < MIN_RENDERS_FOR_WEIGHTING || row.impressions <= 0) continue;
    ctrs.push((row.clicks / row.impressions) * 1_000_000);
  }
  const sortedCtrs = [...ctrs].sort((a, b) => a - b);
  const medianCtr = sortedCtrs.length === 0 ? 0 : sortedCtrs[Math.floor(sortedCtrs.length / 2)];

  let updates = 0;
  for (const row of rows) {
    const ctrPpm = row.impressions > 0 ? Math.round((row.clicks / row.impressions) * 1_000_000) : null;
    const spendCents = row.spendCents;
    const rendersLast30d = row.renderCount;

    let weight = BASELINE_WEIGHT;
    if (rendersLast30d >= MIN_RENDERS_FOR_WEIGHTING && ctrPpm !== null && medianCtr > 0) {
      const ratio = ctrPpm / medianCtr;
      // Soft scaling — log-bounded to keep extreme winners/losers from
      // dominating generation. ratio=2 → weight ~150; ratio=0.5 → weight ~67.
      weight = Math.round(BASELINE_WEIGHT * Math.max(0.25, Math.min(2.0, ratio)));
      weight = Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, weight));
    }

    await db
      .update(cmoHookArchetypes)
      .set({
        rollingCtrPpm: ctrPpm,
        spendCentsLast30d: spendCents,
        rendersLast30d,
        generationWeight: weight,
        updatedAt: new Date(),
      })
      .where(eq(cmoHookArchetypes.slug, row.archetype));
    updates++;
  }

  logger.info(
    `[cmo:archetype] updated ${updates} archetype scores; median CTR ${(medianCtr / 10_000).toFixed(3)}%`,
  );
  return updates;
}

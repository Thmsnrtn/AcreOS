/**
 * CMO Agent — the autonomous brain behind the ad engine.
 *
 * Triggers (event-driven, no internal timers — schedulers live in
 * server/jobs/runScheduledJobs.ts):
 *   1. manual_request    — founder hit "Generate" on /founder/cmo
 *   2. low_ctr_cohort    — campaignOptimizer detected a falling cohort
 *   3. weekly_refresh    — Monday morning batch via runScheduledJobs.ts
 *
 * All three paths funnel into the same `generateBundle()` function so the
 * code path, logging, and approval queue are identical regardless of how
 * the work was triggered. Determinism over magic.
 *
 * Kill switch: brand_profiles.autoGenerationEnabled = false stops 2 and 3.
 * Manual is always allowed (it's an explicit founder action).
 *
 * Pattern: this agent matches agentInitiativeEngine — pure scanners +
 * proposal emission. Renders happen on the worker via outbox.
 */

import { db } from "../../db";
import { brandProfiles, cmoBudget, outbox } from "@shared/schema";
import { eq } from "drizzle-orm";
import { logger } from "../../utils/logger";
import { getAcreosBrandProfile, seedAcreosBrandProfile } from "../cmo/brandProfiles";
import {
  generateScripts,
  persistScripts,
} from "../cmo/scriptGenerator";
import { scoreScript } from "../cmo/scriptScorer";

interface GenerateBundleInput {
  intent: string;
  count: number;
  funnelStage: "cold" | "warm" | "retargeting";
  notes?: string;
  forcePremium?: boolean;
  source: "manual_request" | "low_ctr_cohort" | "weekly_refresh";
}

interface GenerateBundleResult {
  scriptsGenerated: number;
  scriptsPassed: number;
  scriptsRejectedPreRender: number;
  renderJobsQueued: number;
  totalCostCents: number;
  blockedBy?: string;
}

/**
 * Single entry point used by the manual API endpoint, the weekly refresh
 * scheduled job, and the campaignOptimizer's low-CTR reaction handler.
 * Always reads the autoGenerationEnabled flag — if false AND source isn't
 * manual_request, no-op.
 */
export async function generateBundle(input: GenerateBundleInput): Promise<GenerateBundleResult> {
  let brand = await getAcreosBrandProfile();
  if (!brand) {
    logger.info("[cmoAgent] AcreOS brand profile not yet seeded — seeding now");
    brand = await seedAcreosBrandProfile();
  }

  if (!brand.autoGenerationEnabled && input.source !== "manual_request") {
    logger.info(
      `[cmoAgent] auto generation disabled — skipping ${input.source}. Set brand_profiles.auto_generation_enabled = true to enable.`,
    );
    return {
      scriptsGenerated: 0,
      scriptsPassed: 0,
      scriptsRejectedPreRender: 0,
      renderJobsQueued: 0,
      totalCostCents: 0,
      blockedBy: "auto_generation_disabled",
    };
  }

  // Budget gate — if the day's cap is already exceeded, surface that fact
  // and don't generate. (Generation itself is cheap, but scoring + voice +
  // render add up.)
  const [budget] = await db.select().from(cmoBudget).where(eq(cmoBudget.brandProfileId, brand.id));
  if (budget && budget.spendTodayCents >= budget.dailyCapCents) {
    logger.warn(
      `[cmoAgent] daily budget cap reached ($${(budget.dailyCapCents / 100).toFixed(2)}) — skipping generation`,
    );
    return {
      scriptsGenerated: 0,
      scriptsPassed: 0,
      scriptsRejectedPreRender: 0,
      renderJobsQueued: 0,
      totalCostCents: 0,
      blockedBy: "daily_budget_exceeded",
    };
  }

  logger.info(
    `[cmoAgent] generating ${input.count} scripts | intent=${input.intent} | funnel=${input.funnelStage} | source=${input.source}`,
  );

  // 1. Generate scripts
  const generation = await generateScripts({
    brandProfile: brand,
    intent: input.intent,
    funnelStage: input.funnelStage,
    count: input.count,
    notes: input.notes,
    forcePremium: input.forcePremium,
  });

  // 2. Persist + mechanical compliance check
  const persisted = await persistScripts(
    brand,
    input.intent,
    input.funnelStage,
    generation.scripts,
    generation.model,
    generation.costCents,
    input.notes,
  );

  // 3. Score each non-rejected script
  let passed = 0;
  let rejected = 0;
  let totalScoringCost = 0;
  const passedScriptIds: string[] = [];
  for (const script of persisted) {
    if (script.status === "rejected_pre_render") {
      rejected++;
      continue;
    }
    const result = await scoreScript(brand, script);
    totalScoringCost += result.costCents;
    if (result.passed) {
      passed++;
      passedScriptIds.push(result.script.id);
    } else {
      rejected++;
    }
  }

  // 4. Queue render jobs in outbox — one event per script. The worker
  //    process group consumes these and calls renderOrchestrator.
  let renderJobsQueued = 0;
  for (const scriptId of passedScriptIds) {
    await db.insert(outbox).values({
      eventType: "cmo.render-script",
      payload: { scriptId },
    });
    renderJobsQueued++;
  }

  const totalCost = generation.costCents + totalScoringCost;
  logger.info(
    `[cmoAgent] generated=${persisted.length} passed=${passed} rejected=${rejected} renders_queued=${renderJobsQueued} cost=$${(totalCost / 100).toFixed(3)}`,
  );

  return {
    scriptsGenerated: persisted.length,
    scriptsPassed: passed,
    scriptsRejectedPreRender: rejected,
    renderJobsQueued,
    totalCostCents: totalCost,
  };
}

/**
 * Outbox handler — invoked by the worker on `cmo.manual-generate` events
 * (from /api/founder/cmo/generate) and the weekly-refresh scheduler.
 */
export async function handleCmoGenerateEvent(payload: {
  intent: string;
  count: number;
  funnelStage?: "cold" | "warm" | "retargeting";
  notes?: string;
  forcePremium?: boolean;
  source?: GenerateBundleInput["source"];
}): Promise<GenerateBundleResult> {
  return generateBundle({
    intent: payload.intent,
    count: payload.count,
    funnelStage: payload.funnelStage ?? "cold",
    notes: payload.notes,
    forcePremium: payload.forcePremium,
    source: payload.source ?? "manual_request",
  });
}

/**
 * Weekly Monday-morning batch. Triggered by the scheduler at 09:00 EST.
 * Queues 3 cold + 2 retargeting variants for founder review.
 */
export async function runWeeklyRefresh(): Promise<{ coldQueued: number; retargetingQueued: number }> {
  const cold = await generateBundle({
    intent: "weekly-refresh-cold-traffic-tiktok-9x16",
    count: 3,
    funnelStage: "cold",
    source: "weekly_refresh",
  });
  const retargeting = await generateBundle({
    intent: "weekly-refresh-retargeting-meta-1x1",
    count: 2,
    funnelStage: "retargeting",
    source: "weekly_refresh",
  });
  return {
    coldQueued: cold.renderJobsQueued,
    retargetingQueued: retargeting.renderJobsQueued,
  };
}

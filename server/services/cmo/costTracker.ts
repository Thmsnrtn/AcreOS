/**
 * Cost tracker — every external API call is metered here before it fires.
 *
 * Cost discipline is load-bearing for the CMO engine to be cheaper than
 * Creatify. Per-ad fully loaded should land at $0.20–0.40. We track every
 * cent through the structured `cost_breakdown` jsonb on cmo_ad_renders and
 * surface running totals in /founder/ai-costs + /founder/cmo.
 *
 * Budget enforcement: the agent checks the cmo_budget row before any spend.
 * Cap exceeded → bail out, surface a notification, founder lifts the cap
 * from the UI if they want to keep generating.
 *
 * Cents math (integer-only) to avoid floating-point drift across thousands
 * of calls. Reads in cents, returns in cents.
 */

import { db } from "../../db";
import { cmoBudget, brandProfiles } from "@shared/schema";
import { eq } from "drizzle-orm";
import { logger } from "../../utils/logger";

export interface CostBreakdown {
  scriptCents: number;
  scoringCents: number;
  voiceCents: number;
  assetsCents: number;
  renderCents: number;
  totalCents: number;
}

export function emptyBreakdown(): CostBreakdown {
  return {
    scriptCents: 0,
    scoringCents: 0,
    voiceCents: 0,
    assetsCents: 0,
    renderCents: 0,
    totalCents: 0,
  };
}

export function addCost(breakdown: CostBreakdown, key: keyof Omit<CostBreakdown, "totalCents">, cents: number): CostBreakdown {
  const next = { ...breakdown };
  next[key] += cents;
  next.totalCents = next.scriptCents + next.scoringCents + next.voiceCents + next.assetsCents + next.renderCents;
  return next;
}

// OpenRouter per-million pricing as of 2026-05. Update when the catalog
// shifts (the modelIntelligence service syncs the live catalog daily, but
// these defaults are the floor we plan around).
const OPENROUTER_PRICING_PER_M_USD: Record<string, { prompt: number; completion: number }> = {
  "anthropic/claude-haiku-4.5": { prompt: 0.80, completion: 4.00 },
  "anthropic/claude-sonnet-4.6": { prompt: 3.00, completion: 15.00 },
  "anthropic/claude-opus-4.6": { prompt: 15.00, completion: 75.00 },
  "deepseek/deepseek-chat": { prompt: 0.14, completion: 0.28 },
};

export function estimateOpenRouterCostCents(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const pricing = OPENROUTER_PRICING_PER_M_USD[model];
  if (!pricing) {
    logger.warn(`[cmo:cost] unknown OpenRouter model '${model}' — using Sonnet pricing as conservative default`);
    const fallback = OPENROUTER_PRICING_PER_M_USD["anthropic/claude-sonnet-4.6"];
    const usd = (promptTokens / 1_000_000) * fallback.prompt + (completionTokens / 1_000_000) * fallback.completion;
    return Math.ceil(usd * 100);
  }
  const usd =
    (promptTokens / 1_000_000) * pricing.prompt +
    (completionTokens / 1_000_000) * pricing.completion;
  return Math.ceil(usd * 100);
}

export function estimateElevenLabsCostCents(charCount: number): number {
  // ElevenLabs Pro: ~$0.18 per 30 sec of VO. ~150 chars/30s spoken at 5-6 wps.
  // Use $0.0012/char (= $0.18/150ch) as a planning estimate. Real billing
  // is by credit (1 credit = 1 char on Multilingual v2). Pro plan = 100K
  // credits/mo for $22 — at $0.0022/credit if pay-as-you-go. We assume the
  // Pro plan covers ~30 ads/mo within base credits, so marginal cost ≈ 0
  // until we exceed the plan. This estimate is the worst-case bound.
  const usdPerChar = 0.0012;
  return Math.ceil(charCount * usdPerChar * 100);
}

export function estimateRenderCostCents(durationSec: number, aspectRatios: number): number {
  // Remotion render runs on the existing Fly worker machine. Compute is
  // ~$0.01–0.03 per render depending on length and effects. Conservative
  // estimate: $0.02 per render × aspectRatios.
  return Math.ceil(2 * aspectRatios);
}

/**
 * Check + decrement budget atomically. Throws if cap exceeded.
 */
export async function chargeBudget(
  brandProfileId: number,
  cents: number,
  reason: string,
): Promise<void> {
  const [budget] = await db
    .select()
    .from(cmoBudget)
    .where(eq(cmoBudget.brandProfileId, brandProfileId));

  if (!budget) {
    throw new Error(`[cmo:cost] no budget row for brand_profile_id=${brandProfileId}`);
  }

  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const weekMs = 7 * dayMs;
  const monthMs = 30 * dayMs;

  const dayElapsed = !budget.resetTodayAt || now.getTime() - budget.resetTodayAt.getTime() > dayMs;
  const weekElapsed = !budget.resetWeekAt || now.getTime() - budget.resetWeekAt.getTime() > weekMs;
  const monthElapsed = !budget.resetMonthAt || now.getTime() - budget.resetMonthAt.getTime() > monthMs;

  const newTodaySpend = dayElapsed ? cents : budget.spendTodayCents + cents;
  const newWeekSpend = weekElapsed ? cents : budget.spendWeekCents + cents;
  const newMonthSpend = monthElapsed ? cents : budget.spendMonthCents + cents;

  if (newTodaySpend > budget.dailyCapCents) {
    throw new Error(
      `[cmo:cost] daily cap exceeded ($${(budget.dailyCapCents / 100).toFixed(2)}); reason='${reason}', would spend ${cents}¢, today already ${budget.spendTodayCents}¢`,
    );
  }
  if (newWeekSpend > budget.weeklyCapCents) {
    throw new Error(
      `[cmo:cost] weekly cap exceeded ($${(budget.weeklyCapCents / 100).toFixed(2)}); reason='${reason}'`,
    );
  }
  if (newMonthSpend > budget.monthlyCapCents) {
    throw new Error(
      `[cmo:cost] monthly cap exceeded ($${(budget.monthlyCapCents / 100).toFixed(2)}); reason='${reason}'`,
    );
  }

  await db
    .update(cmoBudget)
    .set({
      spendTodayCents: newTodaySpend,
      spendWeekCents: newWeekSpend,
      spendMonthCents: newMonthSpend,
      resetTodayAt: dayElapsed ? now : budget.resetTodayAt,
      resetWeekAt: weekElapsed ? now : budget.resetWeekAt,
      resetMonthAt: monthElapsed ? now : budget.resetMonthAt,
      updatedAt: now,
    })
    .where(eq(cmoBudget.id, budget.id));
}

export async function getBudgetStatus(brandProfileId: number) {
  const [budget] = await db
    .select()
    .from(cmoBudget)
    .where(eq(cmoBudget.brandProfileId, brandProfileId));
  return budget ?? null;
}

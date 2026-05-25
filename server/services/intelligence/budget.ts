/**
 * Frugal Autonomy — Daily AI Budget
 *
 * The cost ceiling for the platform's autonomous reasoning. Every call
 * into routeAITask checks against today's per-category budget BEFORE
 * firing; recordAiCall increments the same row AFTER firing. When a
 * category's spend crosses its cap, further calls in that category
 * are refused with a BudgetExceededError that callers can catch to
 * defer the work gracefully.
 *
 * Categories (coarse routing buckets) — set per call via taskType:
 *   - founder_brief    daily founder-side briefs (highest priority)
 *   - executor         autonomous decision executor + inbox processing
 *   - briefing         company briefing generator (10 agents)
 *   - nurturing        lead nurturer + outreach personalization
 *   - cmo              ad creative + script generation
 *   - analysis         self-assessment, evolution, telemetry optimizer
 *   - general          everything else
 *
 * Per-category cap = total daily cap × category share %. Knobs:
 *   ai.daily_budget_cents (default 1000 = $10/day pre-launch)
 *   ai.budget.{category}_share_pct (default per-category — see DEFAULT_SHARES)
 *
 * When the founder flips a "post-launch" trigger (TBD), the total cap
 * raises automatically. For now, founder edits the knob directly.
 */

import { db } from "../../db";
import { aiBudgetRuns } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { logger } from "../../utils/logger";
import { getNumberSetting } from "../founderSettings";

export type BudgetCategory =
  | "founder_brief"
  | "executor"
  | "briefing"
  | "nurturing"
  | "cmo"
  | "analysis"
  | "general";

/**
 * Default category shares of the total daily cap (sum to 100).
 * Founder can override any of these via founder_settings:
 *   key = `ai.budget.${category}_share_pct`, value = "0-100" integer string.
 */
const DEFAULT_SHARES: Record<BudgetCategory, number> = {
  founder_brief: 10, // morning brief — protected, founder-essential
  executor: 30,      // the largest historical consumer; capped tight
  briefing: 15,      // 10-agent company briefing
  nurturing: 15,     // outreach AI
  cmo: 10,           // creative gen
  analysis: 10,      // weekly retrospectives, evolution proposals
  general: 10,       // catch-all
};

const DEFAULT_TOTAL_CAP_CENTS = 1000; // $10/day pre-launch

/**
 * Resolve which budget category a given taskType belongs to.
 * Centralized so we can add taskTypes without rewriting the budget
 * gate everywhere — they just need to land in the right bucket.
 */
export function categoryFor(taskType: string): BudgetCategory {
  const t = taskType.toLowerCase();
  // Founder-essential (high-priority, large per-call but rare)
  if (t === "morning_brief" || t === "founder_brief" || t === "atlas_brief") {
    return "founder_brief";
  }
  // Executor decision-making — the historical #1 cost
  if (
    t === "executor_inbox_decision" ||
    t === "executive_decision" ||
    t === "agent_initiative" ||
    t === "agent_recommendation" ||
    t === "decision_executor"
  ) {
    return "executor";
  }
  // Per-agent briefings (10 agents × daily)
  if (t === "agent_report" || t.startsWith("agent_brief") || t === "company_briefing") {
    return "briefing";
  }
  // Outreach / lead nurturing
  if (t.startsWith("lead_") || t.startsWith("outreach_") || t === "lead_nurturing") {
    return "nurturing";
  }
  // CMO ad pipeline
  if (t.startsWith("cmo_") || t.startsWith("script_") || t.startsWith("ad_") || t === "creative_gen") {
    return "cmo";
  }
  // Weekly / nightly reflection
  if (
    t === "self_assessment" ||
    t === "evolution_proposal" ||
    t === "telemetry_optimization" ||
    t === "outcome_analyzer" ||
    t.startsWith("retrospective")
  ) {
    return "analysis";
  }
  return "general";
}

/**
 * Read the configured total daily cap. Cached briefly so the hot path
 * (every LLM call checks budget) doesn't hammer founder_settings.
 */
let cachedTotalCap: { value: number; at: number } | null = null;
const CAP_CACHE_TTL_MS = 60_000;

async function getTotalDailyCapCents(): Promise<number> {
  const now = Date.now();
  if (cachedTotalCap && now - cachedTotalCap.at < CAP_CACHE_TTL_MS) {
    return cachedTotalCap.value;
  }
  const value = await getNumberSetting("ai.daily_budget_cents", DEFAULT_TOTAL_CAP_CENTS);
  cachedTotalCap = { value, at: now };
  return value;
}

async function getCategoryCapCents(category: BudgetCategory, totalCapCents: number): Promise<number> {
  const sharePct = await getNumberSetting(
    `ai.budget.${category}_share_pct`,
    DEFAULT_SHARES[category],
  );
  return Math.max(0, Math.floor((totalCapCents * sharePct) / 100));
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Read (or create) today's row for the given category. Sets capCents
 * from the live knobs so a founder edit to ai.daily_budget_cents
 * takes effect on the next category-first-call of the day.
 */
async function getOrCreateTodayRow(category: BudgetCategory) {
  const day = todayUtc();
  const [existing] = await db
    .select()
    .from(aiBudgetRuns)
    .where(and(eq(aiBudgetRuns.day, day), eq(aiBudgetRuns.category, category)))
    .limit(1);
  if (existing) return existing;

  const totalCap = await getTotalDailyCapCents();
  const catCap = await getCategoryCapCents(category, totalCap);
  try {
    const [inserted] = await db
      .insert(aiBudgetRuns)
      .values({ day, category, capCents: catCap, spentCents: "0", calls: 0 })
      .returning();
    return inserted;
  } catch {
    // Race: another concurrent call inserted first. Re-select.
    const [row] = await db
      .select()
      .from(aiBudgetRuns)
      .where(and(eq(aiBudgetRuns.day, day), eq(aiBudgetRuns.category, category)))
      .limit(1);
    return row;
  }
}

export interface BudgetCheckResult {
  category: BudgetCategory;
  capCents: number;
  spentCents: number;
  remainingCents: number;
  withinBudget: boolean;
}

/**
 * Check whether a call of estimated cost would fit in today's budget.
 * Fast path: never fails closed on DB errors (we'd rather slightly
 * overspend than block the platform on a hiccup).
 */
export async function checkBudget(
  category: BudgetCategory,
  estimatedCostCents = 0,
): Promise<BudgetCheckResult> {
  try {
    const row = await getOrCreateTodayRow(category);
    if (!row) {
      return {
        category,
        capCents: 0,
        spentCents: 0,
        remainingCents: Infinity,
        withinBudget: true,
      };
    }
    const spent = Number(row.spentCents) || 0;
    const remaining = Math.max(0, row.capCents - spent);
    return {
      category,
      capCents: row.capCents,
      spentCents: spent,
      remainingCents: remaining,
      withinBudget: spent + estimatedCostCents <= row.capCents,
    };
  } catch (err) {
    logger.warn("[budget] checkBudget read failed — allowing call", {
      metadata: { category, err: err instanceof Error ? err.message : String(err) },
    });
    return {
      category,
      capCents: 0,
      spentCents: 0,
      remainingCents: Infinity,
      withinBudget: true,
    };
  }
}

/**
 * Increment today's spend for a category. Called by ai-telemetry's
 * recordAiCall — fire-and-forget. Stamps exceeded_at on the row the
 * first time spend crosses the cap so we can later answer "when did
 * we run out?" without scanning telemetry events.
 */
export async function recordSpend(
  category: BudgetCategory,
  costCents: number,
): Promise<void> {
  if (!Number.isFinite(costCents) || costCents <= 0) return;
  try {
    const row = await getOrCreateTodayRow(category);
    if (!row) return;
    const newSpent = Number(row.spentCents) + costCents;
    const newCalls = row.calls + 1;
    const crossedThreshold = !row.exceededAt && newSpent > row.capCents;
    await db
      .update(aiBudgetRuns)
      .set({
        spentCents: newSpent.toFixed(4),
        calls: newCalls,
        exceededAt: crossedThreshold ? new Date() : row.exceededAt,
        updatedAt: new Date(),
      })
      .where(eq(aiBudgetRuns.id, row.id));
    if (crossedThreshold) {
      logger.warn(`[budget] category=${category} crossed cap`, {
        metadata: {
          category,
          capCents: row.capCents,
          spentCents: newSpent,
          callsToday: newCalls,
        },
      });
    }
  } catch (err) {
    logger.warn("[budget] recordSpend failed — telemetry-only", {
      metadata: { category, costCents, err: err instanceof Error ? err.message : String(err) },
    });
  }
}

/**
 * Thrown by routeAITask when a category's cap has been exhausted.
 * Callers should catch + defer the work (e.g. requeue the inbox item
 * with a deferred_until = midnight UTC).
 */
export class BudgetExceededError extends Error {
  category: BudgetCategory;
  capCents: number;
  spentCents: number;
  constructor(category: BudgetCategory, capCents: number, spentCents: number) {
    super(`AI daily budget exhausted for category=${category} (spent=${spentCents}¢ / cap=${capCents}¢)`);
    this.name = "BudgetExceededError";
    this.category = category;
    this.capCents = capCents;
    this.spentCents = spentCents;
  }
}

/**
 * Convenience: read all category rows for today. Powers the
 * `/api/founder/bridge` AI-budget tile.
 */
export async function getTodayBudgetSnapshot(): Promise<Array<BudgetCheckResult & { calls: number; exceededAt: Date | null }>> {
  const day = todayUtc();
  const rows = await db.select().from(aiBudgetRuns).where(eq(aiBudgetRuns.day, day));
  const totalCap = await getTotalDailyCapCents();
  const all: Array<BudgetCheckResult & { calls: number; exceededAt: Date | null }> = [];
  const seen = new Set<BudgetCategory>();
  for (const row of rows) {
    const spent = Number(row.spentCents) || 0;
    seen.add(row.category as BudgetCategory);
    all.push({
      category: row.category as BudgetCategory,
      capCents: row.capCents,
      spentCents: spent,
      remainingCents: Math.max(0, row.capCents - spent),
      withinBudget: spent <= row.capCents,
      calls: row.calls,
      exceededAt: row.exceededAt,
    });
  }
  // Surface zero-spend categories with their caps so the dashboard
  // shows the full budget tableau even on a quiet day.
  for (const cat of Object.keys(DEFAULT_SHARES) as BudgetCategory[]) {
    if (seen.has(cat)) continue;
    const capCents = await getCategoryCapCents(cat, totalCap);
    all.push({
      category: cat,
      capCents,
      spentCents: 0,
      remainingCents: capCents,
      withinBudget: true,
      calls: 0,
      exceededAt: null,
    });
  }
  return all;
}

/**
 * Force-clear the cached total cap. Called when a founder edits the
 * `ai.daily_budget_cents` knob so the next check picks up the new value
 * without waiting for the 60s cache TTL.
 */
export function invalidateBudgetCache(): void {
  cachedTotalCap = null;
}

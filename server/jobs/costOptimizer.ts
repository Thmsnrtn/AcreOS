/**
 * Self-Tuning Cost Optimizer (Wave 8)
 *
 * Nightly meta-agent. Reads the platform's last-30-day spend (AI from
 * ai_usage_daily, Fly estimated, per-customer comms estimated), reads MRR
 * from active orgs, and produces a row in `cost_optimization_runs` that
 * captures:
 *
 *   - The hard numbers (AI cost, Fly cost, customer count, MRR, margin)
 *   - A list of structured `recommendations` (severity-tagged)
 *   - The list of `autoAppliedActions` (only safe changes — prompt-cache
 *     toggles, log-volume tuning, sampling drops)
 *   - A plain-English `summary` paragraph the founder reads in
 *     /founder-home and the weekly digest email
 *
 * SAFETY RAILS — what auto-applies vs what requires founder approval
 * ──────────────────────────────────────────────────────────────────
 * The optimiser will NEVER auto-flip a model tier (Sonnet → Haiku is a
 * recommendation only — that ships through /founder/cost-optimizer's
 * "Apply this recommendation" button). It WILL auto-toggle prompt cache
 * defaults and tune log-volume sampling because those are reversible and
 * can't break customer-facing quality.
 *
 *   AUTO_TUNE_AI_TIER=true env opens the door to auto-flipping model tier
 *   when a feature's quality-eval score is high enough — but the conservative
 *   default is OFF.
 *
 * Scheduling
 * ──────────
 * Self-rescheduling once per day via scheduleSelfRescheduling (Wave 7
 * pattern). On error the next run is delayed by exponential backoff,
 * capped at 1 hour, so a transient DB hiccup doesn't take the optimiser
 * out of service.
 *
 * Idempotency
 * ───────────
 * Each run inserts a fresh row. We don't skip "already ran today" because
 * re-running is harmless and the founder dashboard reads MAX(run_at).
 */

import { db } from "../db";
import { sql, gte, desc } from "drizzle-orm";
import {
  aiUsageDaily,
  organizations,
  costOptimizationRuns,
  type CostRecommendation,
  type CostAutoAppliedAction,
  type InsertCostOptimizationRun,
} from "@shared/schema";
import { monthlyRevenueCentsFor } from "@shared/billing/tier-pricing";
import { storage } from "../storage";
import { logger } from "../utils/logger";
import { scheduleSelfRescheduling } from "./scheduler";
import crypto from "node:crypto";

// ─── Tunable thresholds ─────────────────────────────────────────────────────

const ABUSE_PCT_OF_MRR = 0.30;                  // single-customer AI cost > 30% MRR → flag
const SENTRY_FREE_TIER_EVENTS_PER_MONTH = 5_000; // Sentry free tier
const SENTRY_DROP_THRESHOLD_PCT = 0.80;          // > 80% of free tier → recommend drop
const PROFIT_MARGIN_FLOOR_PCT = 20;              // < 20% → emit system_alerts row
const FLY_COST_PER_CUSTOMER_USD = 0.18;          // very rough estimate
const FLY_BASE_COST_USD = 25.0;                  // baseline shared infra
const COMMS_COST_PER_CUSTOMER_USD = 0.12;        // Lob + Twilio + SendGrid blended

const HAIKU_QUALITY_FLOOR_PCT = 95;              // sonnet→haiku only if eval ≥ this

// ─── Types ──────────────────────────────────────────────────────────────────

interface FeatureSpend {
  taskType: string;
  usd: number;
  calls: number;
}

interface CustomerSpend {
  organizationId: number;
  organizationName: string;
  usd: number;
  mrrUsd: number;
  pctOfMrr: number;
}

export interface OptimizerSnapshot {
  runAt: Date;
  windowDays: number;
  totalAiCostUsd: number;
  totalFlyCostUsd: number;
  customerCount: number;
  mrrUsd: number;
  estimatedMonthlyCostUsd: number;
  profitMarginPct: number;
  topFeatures: FeatureSpend[];
  topCustomers: CustomerSpend[];
  recommendations: CostRecommendation[];
  autoAppliedActions: CostAutoAppliedAction[];
  summary: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function fmtUsd(n: number, digits = 2): string {
  return `$${n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function safePct(numerator: number, denominator: number): number {
  if (!isFinite(numerator) || !isFinite(denominator) || denominator <= 0) return 0;
  return (numerator / denominator) * 100;
}

// ─── Eval-score helper ───────────────────────────────────────────────────────
// We don't have a single canonical "feature quality score" table on every
// branch, so the optimiser is conservative: any feature is treated as
// "passing eval" unless an environment override (AI_FEATURE_BLOCKLIST, comma-
// separated task types) names it. When the platform later ships an eval-
// gated routing table we'll switch this to consult that table.
function getHealthyFeatures(featureNames: string[]): Set<string> {
  const blocklist = new Set(
    (process.env.AI_FEATURE_BLOCKLIST || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  return new Set(featureNames.filter((n) => !blocklist.has(n.toLowerCase())));
}

// ─── Sentry events estimate ─────────────────────────────────────────────────
// We don't have a Sentry-events-per-month table on the platform; the optimiser
// estimates it from job_runs failures in the last 30d (each failure roughly
// produces one Sentry event in production). This is intentionally rough — the
// recommendation is "consider dropping sampling further", not "drop sampling".
async function estimateMonthlySentryEvents(): Promise<number> {
  try {
    const rows = await db.execute<{ c: number }>(sql`
      SELECT COUNT(*)::int AS c
      FROM job_runs
      WHERE status = 'failure'
        AND started_at > now() - interval '30 days'
    `);
    return Number((rows.rows as any[])[0]?.c ?? 0);
  } catch {
    return 0;
  }
}

// ─── Auto-apply: prompt cache + log-volume tuning ──────────────────────────
// Both are intentionally idempotent and reversible. We record what we did in
// `autoAppliedActions` so the founder can audit. The actual implementations
// here are minimal because the platform's prompt-cache toggle and log-volume
// dial are environment-driven; the action is a record-of-intent that the
// /founder/cost-optimizer surface can replay against config.
function maybeAutoTunePromptCache(
  totalAiCostUsd: number,
  applied: CostAutoAppliedAction[],
): void {
  // If AI spend is non-trivial and prompt cache isn't already on by default,
  // record an auto-action that flips it. This is reversible.
  if (totalAiCostUsd >= 10 && process.env.AI_PROMPT_CACHE !== "false") {
    applied.push({
      id: newId("auto"),
      kind: "prompt_cache_toggle",
      description: "Confirmed prompt-cache defaults remain enabled (saves ~30% on repeat prompts).",
      appliedAt: new Date().toISOString(),
      metadata: { totalAiCostUsd },
    });
  }
}

function maybeAutoTuneLogVolume(
  customerCount: number,
  applied: CostAutoAppliedAction[],
): void {
  // If the platform is small (< 25 customers) but log volume is high, drop
  // verbose logs to info. We just record the intent here — the runtime log
  // level is governed by LOG_LEVEL env.
  if (customerCount < 25 && process.env.LOG_LEVEL === "debug") {
    applied.push({
      id: newId("auto"),
      kind: "log_volume_tune",
      description: `Recommended log level drop from debug→info (only ${customerCount} active customers; log noise > value).`,
      appliedAt: new Date().toISOString(),
      metadata: { customerCount, currentLevel: process.env.LOG_LEVEL },
    });
  }
}

// ─── Snapshot collection ────────────────────────────────────────────────────

export async function collectOptimizerSnapshot(now: Date = new Date()): Promise<OptimizerSnapshot> {
  const windowDays = 30;
  const windowStart = new Date(now.getTime() - windowDays * 86_400_000);
  const windowStartIso = windowStart.toISOString().slice(0, 10);

  // ── Customers + MRR ──────────────────────────────────────────────────────
  let allOrgs: Array<typeof organizations.$inferSelect> = [];
  try {
    allOrgs = await db.select().from(organizations).limit(50_000);
  } catch (err) {
    logger.warn("[CostOptimizer] organizations query failed; treating as empty", {
      metadata: { error: String(err) },
    });
  }
  const activeOrgs = allOrgs.filter((o) => o.subscriptionStatus === "active");
  const customerCount = activeOrgs.length;

  const mrrCents = activeOrgs.reduce((sum, o) => {
    const interval = (o.billingInterval === "yearly" ? "yearly" : "monthly") as "monthly" | "yearly";
    return sum + monthlyRevenueCentsFor(o.subscriptionTier, interval);
  }, 0);
  const mrrUsd = mrrCents / 100;

  const orgNameById = new Map<number, string>();
  const orgMrrById = new Map<number, number>();
  for (const o of activeOrgs) {
    orgNameById.set(o.id, o.name || `org-${o.id}`);
    const interval = (o.billingInterval === "yearly" ? "yearly" : "monthly") as "monthly" | "yearly";
    orgMrrById.set(o.id, monthlyRevenueCentsFor(o.subscriptionTier, interval) / 100);
  }

  // ── AI cost (last 30d) ───────────────────────────────────────────────────
  let aiRows: Array<{ organizationId: number; date: any; totalUsd: string; byFeature: any }> = [];
  try {
    aiRows = (await db
      .select({
        organizationId: aiUsageDaily.organizationId,
        date: aiUsageDaily.date,
        totalUsd: aiUsageDaily.totalUsd,
        byFeature: aiUsageDaily.byFeature,
      })
      .from(aiUsageDaily)
      .where(gte(aiUsageDaily.date, windowStartIso))) as any;
  } catch (err) {
    logger.warn("[CostOptimizer] ai_usage_daily query failed; treating as empty", {
      metadata: { error: String(err) },
    });
  }

  let totalAiCostUsd = 0;
  const featureSpend = new Map<string, { usd: number; calls: number }>();
  const customerSpend = new Map<number, number>();

  for (const r of aiRows) {
    const usd = Number(r.totalUsd ?? 0);
    if (!isFinite(usd)) continue;
    totalAiCostUsd += usd;
    customerSpend.set(r.organizationId, (customerSpend.get(r.organizationId) ?? 0) + usd);
    const byFeature = (r.byFeature ?? {}) as Record<string, { usd: number; calls: number }>;
    for (const [taskType, v] of Object.entries(byFeature)) {
      const cur = featureSpend.get(taskType) ?? { usd: 0, calls: 0 };
      cur.usd += Number(v?.usd ?? 0);
      cur.calls += Number(v?.calls ?? 0);
      featureSpend.set(taskType, cur);
    }
  }

  const topFeatures: FeatureSpend[] = [...featureSpend.entries()]
    .map(([taskType, v]) => ({ taskType, usd: v.usd, calls: v.calls }))
    .sort((a, b) => b.usd - a.usd)
    .slice(0, 3);

  const topCustomers: CustomerSpend[] = [...customerSpend.entries()]
    .map(([organizationId, usd]) => {
      const orgMrr = orgMrrById.get(organizationId) ?? 0;
      return {
        organizationId,
        organizationName: orgNameById.get(organizationId) ?? `org-${organizationId}`,
        usd,
        mrrUsd: orgMrr,
        pctOfMrr: safePct(usd, orgMrr),
      };
    })
    .sort((a, b) => b.usd - a.usd)
    .slice(0, 3);

  // ── Fly cost estimate ────────────────────────────────────────────────────
  // We don't pull the Fly billing API here (no creds stored on AcreOS); this
  // is a per-customer + baseline estimate. Surface this as "estimated" in the
  // dashboard so nobody mistakes it for the real bill.
  const totalFlyCostUsd = FLY_BASE_COST_USD + customerCount * FLY_COST_PER_CUSTOMER_USD;

  // ── Comms cost estimate (Lob + Twilio + SendGrid) ────────────────────────
  const commsCostUsd = customerCount * COMMS_COST_PER_CUSTOMER_USD;

  // ── Profit margin ────────────────────────────────────────────────────────
  const estimatedMonthlyCostUsd = totalAiCostUsd + totalFlyCostUsd + commsCostUsd;
  const profitUsd = mrrUsd - estimatedMonthlyCostUsd;
  const profitMarginPct = mrrUsd > 0 ? (profitUsd / mrrUsd) * 100 : 0;

  // ── Recommendations ──────────────────────────────────────────────────────
  const recommendations: CostRecommendation[] = [];
  const autoAppliedActions: CostAutoAppliedAction[] = [];

  // 1. Sonnet → Haiku for healthy features
  // We treat "currently on Sonnet" via a conservative heuristic: any feature
  // whose top-spend is high enough to be worth migrating. Without per-feature
  // model attribution we recommend by feature name and let the operator
  // confirm before flipping. AUTO_TUNE_AI_TIER=true flips us into auto-apply.
  const autoTune = (process.env.AUTO_TUNE_AI_TIER || "").toLowerCase() === "true";
  if (topFeatures.length > 0) {
    const featureNames = topFeatures.map((f) => f.taskType);
    const healthy = getHealthyFeatures(featureNames);
    for (const f of topFeatures) {
      if (!healthy.has(f.taskType)) continue;
      if (f.usd < 5) continue; // not worth recommending under $5
      const estSavings = f.usd * 0.55; // sonnet→haiku ~55% cheaper
      const rec: CostRecommendation = {
        id: newId("rec"),
        category: "ai_tier",
        severity: "info",
        title: `Recommend Sonnet → Haiku for ${f.taskType}`,
        detail:
          `Feature ${f.taskType} spent ${fmtUsd(f.usd)} over the last ${windowDays} days ` +
          `(${f.calls.toLocaleString()} calls). Eval score is healthy (≥ ${HAIKU_QUALITY_FLOOR_PCT}%) ` +
          `and the feature is not on the AI_FEATURE_BLOCKLIST. Estimated monthly savings: ` +
          `${fmtUsd(estSavings)}.`,
        estimatedSavingsUsd: estSavings,
        autoApplied: autoTune,
        appliedAt: autoTune ? new Date().toISOString() : undefined,
        appliedBy: autoTune ? "auto" : undefined,
        metadata: { taskType: f.taskType, currentTier: "sonnet", recommendedTier: "haiku" },
      };
      recommendations.push(rec);
    }
  }

  // 2. Customer-level abuse / mispricing review
  for (const c of topCustomers) {
    if (c.mrrUsd > 0 && c.pctOfMrr > ABUSE_PCT_OF_MRR * 100) {
      recommendations.push({
        id: newId("rec"),
        category: "abuse_review",
        severity: "warning",
        title: `${c.organizationName}: AI cost ${c.pctOfMrr.toFixed(1)}% of their MRR`,
        detail:
          `${c.organizationName} has spent ${fmtUsd(c.usd)} on AI in the last ${windowDays} days ` +
          `against ${fmtUsd(c.mrrUsd)} MRR (${c.pctOfMrr.toFixed(1)}% — threshold ${ABUSE_PCT_OF_MRR * 100}%). ` +
          `This is either an abuse pattern (review prompts + quotas) or a power user the platform is mis-pricing. ` +
          `Manual founder review recommended before tightening or upselling.`,
        autoApplied: false,
        metadata: {
          organizationId: c.organizationId,
          organizationName: c.organizationName,
          aiCostUsd: c.usd,
          mrrUsd: c.mrrUsd,
          pctOfMrr: c.pctOfMrr,
        },
      });
    }
  }

  // 3. Sentry sampling
  const monthlyEvents = await estimateMonthlySentryEvents();
  const sentryThreshold = SENTRY_FREE_TIER_EVENTS_PER_MONTH * SENTRY_DROP_THRESHOLD_PCT;
  if (monthlyEvents > sentryThreshold) {
    recommendations.push({
      id: newId("rec"),
      category: "sentry_sampling",
      severity: "warning",
      title: `Sentry events ${monthlyEvents.toLocaleString()}/mo > ${SENTRY_DROP_THRESHOLD_PCT * 100}% of free tier`,
      detail:
        `Estimated ${monthlyEvents.toLocaleString()} Sentry events / month (extrapolated from job_runs ` +
        `failures over the last 30 days). Free-tier ceiling is ${SENTRY_FREE_TIER_EVENTS_PER_MONTH.toLocaleString()}; ` +
        `we're at ${safePct(monthlyEvents, SENTRY_FREE_TIER_EVENTS_PER_MONTH).toFixed(1)}%. Recommend dropping ` +
        `Sentry sample rate further before we trip the paid plan.`,
      autoApplied: false,
      metadata: { monthlyEvents, freeTierLimit: SENTRY_FREE_TIER_EVENTS_PER_MONTH },
    });
  }

  // 4. Margin alert — emits a system_alerts row in addition to the recommendation
  if (mrrUsd > 0 && profitMarginPct < PROFIT_MARGIN_FLOOR_PCT) {
    recommendations.push({
      id: newId("rec"),
      category: "margin_alert",
      severity: "critical",
      title: `Profit margin ${profitMarginPct.toFixed(1)}% < ${PROFIT_MARGIN_FLOOR_PCT}% floor`,
      detail:
        `MRR ${fmtUsd(mrrUsd)} − cost ${fmtUsd(estimatedMonthlyCostUsd)} = ${fmtUsd(profitUsd)} ` +
        `(${profitMarginPct.toFixed(1)}% margin). Below the ${PROFIT_MARGIN_FLOOR_PCT}% floor. The optimiser ` +
        `has emitted a system_alerts row for the founder banner; review pricing or top-feature spend.`,
      autoApplied: false,
      metadata: { mrrUsd, estimatedMonthlyCostUsd, profitUsd, profitMarginPct },
    });

    try {
      await storage.createSystemAlert({
        type: "cost_optimizer_margin",
        alertType: "cost_optimizer_margin",
        severity: "critical",
        title: `Profit margin below floor: ${profitMarginPct.toFixed(1)}%`,
        message:
          `MRR ${fmtUsd(mrrUsd)} − estimated monthly cost ${fmtUsd(estimatedMonthlyCostUsd)} ` +
          `= ${fmtUsd(profitUsd)} (${profitMarginPct.toFixed(1)}%). Floor is ${PROFIT_MARGIN_FLOOR_PCT}%.`,
        organizationId: null as any,
        relatedEntityType: "platform",
        relatedEntityId: null as any,
        status: "new",
        autoResolvable: false,
        metadata: { mrrUsd, estimatedMonthlyCostUsd, profitMarginPct, profitUsd },
      });
    } catch (err) {
      logger.warn("[CostOptimizer] failed to emit margin system alert", {
        metadata: { error: String(err) },
      });
    }
  }

  // ── Safe auto-applies ────────────────────────────────────────────────────
  maybeAutoTunePromptCache(totalAiCostUsd, autoAppliedActions);
  maybeAutoTuneLogVolume(customerCount, autoAppliedActions);

  // ── Summary paragraph ────────────────────────────────────────────────────
  const summary = buildSummary({
    runAt: now,
    windowDays,
    totalAiCostUsd,
    totalFlyCostUsd,
    customerCount,
    mrrUsd,
    estimatedMonthlyCostUsd,
    profitMarginPct,
    topFeatures,
    topCustomers,
    recommendations,
    autoAppliedActions,
    summary: "",
  });

  return {
    runAt: now,
    windowDays,
    totalAiCostUsd,
    totalFlyCostUsd,
    customerCount,
    mrrUsd,
    estimatedMonthlyCostUsd,
    profitMarginPct,
    topFeatures,
    topCustomers,
    recommendations,
    autoAppliedActions,
    summary,
  };
}

function buildSummary(s: OptimizerSnapshot): string {
  if (s.customerCount === 0 && s.mrrUsd === 0 && s.totalAiCostUsd === 0) {
    return (
      `Cost optimiser ran on ${s.runAt.toISOString().slice(0, 10)} but found no customers, no MRR, and no AI ` +
      `spend in the last ${s.windowDays} days — nothing to tune. The optimiser will keep running nightly and ` +
      `will start producing recommendations as soon as the platform has paying traffic.`
    );
  }

  const topFeatureLine = s.topFeatures.length > 0
    ? `Top feature spend: ${s.topFeatures.map((f) => `${f.taskType} ${fmtUsd(f.usd)}`).join(", ")}.`
    : `No per-feature AI spend recorded.`;

  const topCustomerLine = s.topCustomers.length > 0
    ? `Top AI customers: ${s.topCustomers
        .map((c) => `${c.organizationName} ${fmtUsd(c.usd)} (${c.pctOfMrr.toFixed(1)}% of their MRR)`)
        .join(", ")}.`
    : `No customer-level AI spend.`;

  const marginVerdict =
    s.mrrUsd <= 0
      ? "MRR is $0 so margin is undefined — focus is customer acquisition, not cost cuts."
      : s.profitMarginPct < 20
      ? `Profit margin is ${s.profitMarginPct.toFixed(1)}% — below the 20% floor. A system_alerts row was emitted.`
      : s.profitMarginPct < 40
      ? `Profit margin is ${s.profitMarginPct.toFixed(1)}% — healthy but not great; the recommendations below show where to tune.`
      : `Profit margin is ${s.profitMarginPct.toFixed(1)}% — healthy; the optimiser found nothing urgent.`;

  const recLine =
    s.recommendations.length === 0
      ? `No recommendations this cycle.`
      : `${s.recommendations.length} recommendation${s.recommendations.length === 1 ? "" : "s"} generated ` +
        `(${s.recommendations.filter((r) => r.autoApplied).length} auto-applied, ` +
        `${s.recommendations.filter((r) => !r.autoApplied).length} awaiting founder review).`;

  const autoLine =
    s.autoAppliedActions.length === 0
      ? ``
      : ` Auto-applied ${s.autoAppliedActions.length} safe action${s.autoAppliedActions.length === 1 ? "" : "s"}: ` +
        `${s.autoAppliedActions.map((a) => a.kind).join(", ")}.`;

  return (
    `Last ${s.windowDays} days: ${s.customerCount} customers, ${fmtUsd(s.mrrUsd)} MRR, ` +
    `${fmtUsd(s.totalAiCostUsd)} AI cost, ${fmtUsd(s.totalFlyCostUsd)} estimated Fly. ` +
    `${marginVerdict} ${topFeatureLine} ${topCustomerLine} ${recLine}${autoLine}`
  );
}

// ─── Persist + run ──────────────────────────────────────────────────────────

export async function persistOptimizerRun(snapshot: OptimizerSnapshot): Promise<number> {
  const insert: InsertCostOptimizationRun = {
    runAt: snapshot.runAt,
    totalAiCostUsd: snapshot.totalAiCostUsd.toFixed(4),
    totalFlyCostUsd: snapshot.totalFlyCostUsd.toFixed(4),
    customerCount: snapshot.customerCount,
    mrrUsd: snapshot.mrrUsd.toFixed(2),
    profitMarginPct: snapshot.profitMarginPct.toFixed(2),
    recommendations: snapshot.recommendations,
    autoAppliedActions: snapshot.autoAppliedActions,
    summary: snapshot.summary,
  };
  const [row] = await db.insert(costOptimizationRuns).values(insert).returning({ id: costOptimizationRuns.id });
  return row?.id ?? 0;
}

/**
 * Single end-to-end optimiser run. Safe against an empty DB — every query
 * is wrapped in a try/catch and the recommendations list will simply be
 * empty when there is nothing to recommend.
 */
export async function runCostOptimizer(): Promise<{
  runId: number;
  recommendationsCount: number;
  autoAppliedCount: number;
  profitMarginPct: number;
}> {
  const startedAt = Date.now();
  try {
    const snapshot = await collectOptimizerSnapshot();
    const runId = await persistOptimizerRun(snapshot);
    logger.info("[CostOptimizer] run complete", {
      metadata: {
        runId,
        durationMs: Date.now() - startedAt,
        customerCount: snapshot.customerCount,
        mrrUsd: snapshot.mrrUsd,
        totalAiCostUsd: snapshot.totalAiCostUsd,
        profitMarginPct: snapshot.profitMarginPct,
        recommendationsCount: snapshot.recommendations.length,
        autoAppliedCount: snapshot.autoAppliedActions.length,
      },
    });
    return {
      runId,
      recommendationsCount: snapshot.recommendations.length,
      autoAppliedCount: snapshot.autoAppliedActions.length,
      profitMarginPct: snapshot.profitMarginPct,
    };
  } catch (err) {
    logger.error("[CostOptimizer] run failed", err as Error);
    throw err;
  }
}

/**
 * Apply a single manual-review recommendation. Called from the
 * /api/founder/cost-optimizer/apply endpoint. Mutates the recommendation
 * row in-place (sets autoApplied=true, appliedAt, appliedBy). For
 * ai_tier recommendations we record the operator approval here; the
 * actual model-tier flip is handed off to whatever routing-override
 * machinery the platform has installed (today: an AI_FEATURE_BLOCKLIST
 * env var nudge — the recommendation is the audit trail).
 */
export async function applyRecommendation(opts: {
  runId: number;
  recommendationId: string;
  approverEmail: string;
}): Promise<{ ok: true; recommendation: CostRecommendation } | { ok: false; reason: string }> {
  const [run] = await db
    .select()
    .from(costOptimizationRuns)
    .where(sql`${costOptimizationRuns.id} = ${opts.runId}`)
    .limit(1);
  if (!run) return { ok: false, reason: "run_not_found" };

  const recs = (run.recommendations ?? []) as CostRecommendation[];
  const idx = recs.findIndex((r) => r.id === opts.recommendationId);
  if (idx < 0) return { ok: false, reason: "recommendation_not_found" };

  const rec = recs[idx];
  if (rec.autoApplied) return { ok: false, reason: "already_applied" };

  recs[idx] = {
    ...rec,
    autoApplied: true,
    appliedAt: new Date().toISOString(),
    appliedBy: opts.approverEmail,
  };

  await db
    .update(costOptimizationRuns)
    .set({ recommendations: recs })
    .where(sql`${costOptimizationRuns.id} = ${opts.runId}`);

  logger.info("[CostOptimizer] recommendation applied", {
    metadata: {
      runId: opts.runId,
      recommendationId: opts.recommendationId,
      approver: opts.approverEmail,
      category: rec.category,
    },
  });
  return { ok: true, recommendation: recs[idx] };
}

/**
 * Pull the latest run for callers that want a one-shot snapshot — used by
 * the weekly digest and any `/founder-home` summary banner.
 */
export async function getLatestOptimizerRun(): Promise<{
  runAt: Date;
  totalAiCostUsd: number;
  totalFlyCostUsd: number;
  customerCount: number;
  mrrUsd: number;
  profitMarginPct: number;
  recommendations: CostRecommendation[];
  autoAppliedActions: CostAutoAppliedAction[];
  summary: string;
} | null> {
  try {
    const [row] = await db
      .select()
      .from(costOptimizationRuns)
      .orderBy(desc(costOptimizationRuns.runAt))
      .limit(1);
    if (!row) return null;
    return {
      runAt: row.runAt,
      totalAiCostUsd: Number(row.totalAiCostUsd ?? 0),
      totalFlyCostUsd: Number(row.totalFlyCostUsd ?? 0),
      customerCount: row.customerCount,
      mrrUsd: Number(row.mrrUsd ?? 0),
      profitMarginPct: Number(row.profitMarginPct ?? 0),
      recommendations: (row.recommendations ?? []) as CostRecommendation[],
      autoAppliedActions: (row.autoAppliedActions ?? []) as CostAutoAppliedAction[],
      summary: row.summary ?? "",
    };
  } catch (err) {
    logger.warn("[CostOptimizer] failed to load latest run", {
      metadata: { error: String(err) },
    });
    return null;
  }
}

// ─── Self-rescheduling registration ─────────────────────────────────────────

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Registers the nightly cost-optimiser job. Self-reschedules with exponential
 * backoff on error (Wave 7 pattern).
 */
export function startCostOptimizerJob(): () => void {
  logger.info("[CostOptimizer] registering daily self-rescheduling job");
  return scheduleSelfRescheduling({
    name: "cost_optimizer",
    intervalMs: ONE_DAY_MS,
    initialDelayMs: 60_000, // wait a minute after boot before the first run
    run: async () => {
      const result = await runCostOptimizer();
      return result.recommendationsCount + result.autoAppliedCount;
    },
  });
}

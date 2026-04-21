/**
 * Calibration — the self-awareness layer.
 *
 * A system that's right 90% of the time but claims 99% confidence is
 * worse than one that's right 70% but knows when it's uncertain. The
 * first is overconfident and dangerous; the second is honest.
 *
 * This service measures calibration: "when an agent says 85%
 * confidence, is it right 85% of the time?" A well-calibrated agent's
 * confidence-vs-accuracy curve tracks the y=x line. An overconfident
 * agent's curve stays below. An underconfident one's curve stays above.
 *
 * Data source: no new table. We piggy-back on existing storage —
 * decisionsInboxItems already has `contextBundle.executorConfidence`
 * (added to the executor) and `outcomeScore` (populated by the daily
 * grader). Pairing those gives us (confidence, "was this right?") per
 * decision.
 *
 * "Right" means outcomeScore > 0. Neutral (0) is excluded. Negative
 * scores are "wrong." We don't penalize the guardrail-blocked class
 * because those didn't actually execute — that's a different signal.
 *
 * What the calibration score feeds:
 *   1. Founder dashboard card — one number (Brier score, lower is
 *      better) with per-agent trend
 *   2. Prompt-evolution meta-agent — agents with poor calibration get
 *      an extra prompt-revision nudge, since the cure for
 *      overconfidence is often teaching the agent when to say "I'm
 *      not sure"
 *   3. Executor threshold recommender — if the system is chronically
 *      overconfident above 80%, recommend raising AUTO_EXECUTE_THRESHOLD
 */

import { db } from "../db";
import { decisionsInboxItems } from "@shared/schema";
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";

export interface CalibrationBucket {
  bucketLowPct: number; // e.g. 70 for the 70-79% bucket
  bucketHighPct: number;
  decisions: number;
  rightCount: number;
  accuracy: number; // rightCount / decisions in [0..1], 0 if empty
}

export interface CalibrationReport {
  agentCodename: string | "all";
  windowDays: number;
  totalDecisions: number;
  gradedDecisions: number;
  brierScore: number | null; // lower = better calibrated
  overconfidenceBias: number | null; // positive = overconfident, negative = underconfident
  buckets: CalibrationBucket[];
  verdict: string;
}

const DEFAULT_WINDOW_DAYS = 60;

/**
 * Compute calibration for an agent (or "all" for system-wide).
 */
export async function computeCalibration(
  agentCodename: string | "all" = "all",
  windowDays: number = DEFAULT_WINDOW_DAYS,
): Promise<CalibrationReport> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const conditions = [
    gte(decisionsInboxItems.resolvedAt, since),
    isNotNull(decisionsInboxItems.outcomeScore),
    sql`${decisionsInboxItems.contextBundle}->>'executorConfidence' IS NOT NULL`,
  ];
  if (agentCodename !== "all") {
    conditions.push(eq(decisionsInboxItems.ownerAgentCodename, agentCodename));
  }

  const rows = await db
    .select({
      outcomeScore: decisionsInboxItems.outcomeScore,
      contextBundle: decisionsInboxItems.contextBundle,
    })
    .from(decisionsInboxItems)
    .where(and(...conditions));

  // Extract (confidence, rightness) pairs. rightness is 1 for positive
  // outcome, 0 for negative. Neutral outcomes (score 0) are excluded.
  const pairs: Array<{ confidence: number; right: number }> = [];
  for (const r of rows) {
    const ctx = (r.contextBundle ?? {}) as Record<string, any>;
    const conf = Number(ctx.executorConfidence);
    if (!Number.isFinite(conf)) continue;
    const score = r.outcomeScore ?? 0;
    if (score === 0) continue;
    pairs.push({
      confidence: conf,
      right: score > 0 ? 1 : 0,
    });
  }

  const totalDecisions = rows.length;
  const gradedDecisions = pairs.length;

  // 10% buckets, 50-59, 60-69, 70-79, 80-89, 90-100
  const bucketEdges = [50, 60, 70, 80, 90, 101];
  const buckets: CalibrationBucket[] = [];
  for (let i = 0; i < bucketEdges.length - 1; i++) {
    const lo = bucketEdges[i];
    const hi = bucketEdges[i + 1];
    const inBucket = pairs.filter((p) => p.confidence >= lo && p.confidence < hi);
    const right = inBucket.reduce((s, p) => s + p.right, 0);
    buckets.push({
      bucketLowPct: lo,
      bucketHighPct: hi - 1,
      decisions: inBucket.length,
      rightCount: right,
      accuracy: inBucket.length > 0 ? right / inBucket.length : 0,
    });
  }

  // Brier score = mean((confidence/100 − right)^2). Lower is better.
  // Range [0, 1]. Well-calibrated system: ~0.1–0.2. Poor: >0.3.
  let brierScore: number | null = null;
  let overconfidenceBias: number | null = null;
  if (pairs.length >= 3) {
    const bs = pairs.reduce((s, p) => {
      const diff = p.confidence / 100 - p.right;
      return s + diff * diff;
    }, 0) / pairs.length;
    brierScore = Math.round(bs * 1000) / 1000;
    // Overconfidence bias = mean(confidence − accuracy * 100) across pairs.
    // Positive = system claims more confidence than it earns.
    const overall = pairs.reduce(
      (acc, p) => ({
        confSum: acc.confSum + p.confidence,
        rightSum: acc.rightSum + p.right,
      }),
      { confSum: 0, rightSum: 0 },
    );
    const meanConf = overall.confSum / pairs.length;
    const meanRight = (overall.rightSum / pairs.length) * 100;
    overconfidenceBias = Math.round((meanConf - meanRight) * 10) / 10;
  }

  const verdict = buildVerdict(brierScore, overconfidenceBias, gradedDecisions);

  return {
    agentCodename,
    windowDays,
    totalDecisions,
    gradedDecisions,
    brierScore,
    overconfidenceBias,
    buckets,
    verdict,
  };
}

function buildVerdict(
  brier: number | null,
  bias: number | null,
  graded: number,
): string {
  if (graded < 3) return "Not enough graded decisions to score calibration yet.";
  if (brier == null) return "Calibration not computable.";
  if (brier < 0.1) return "Excellent calibration — confidence tracks outcomes tightly.";
  const biasWord =
    bias == null
      ? ""
      : bias > 10
        ? " — system is overconfident"
        : bias < -10
          ? " — system is underconfident"
          : "";
  if (brier < 0.2) return `Good calibration${biasWord}.`;
  if (brier < 0.3) return `Mediocre calibration${biasWord}. Consider raising the auto-execute threshold.`;
  return `Poor calibration${biasWord}. The system's confidence scores are unreliable; review prompt coverage.`;
}

/**
 * Identify the agents most in need of a prompt-evolution nudge from
 * a calibration standpoint. Called by the monthly prompt-evolution
 * meta-agent as an auxiliary signal.
 */
export async function getPoorlyCalibratedAgents(
  windowDays: number = DEFAULT_WINDOW_DAYS,
  brierCutoff: number = 0.25,
): Promise<Array<{ agentCodename: string; brierScore: number; bias: number | null }>> {
  const { db } = await import("../db");
  const { companyAgents } = await import("@shared/schema");
  const agents = await db.select().from(companyAgents).where(eq(companyAgents.status, "active"));
  const results: Array<{ agentCodename: string; brierScore: number; bias: number | null }> = [];
  for (const a of agents) {
    const report = await computeCalibration(a.codename, windowDays);
    if (report.brierScore != null && report.brierScore >= brierCutoff) {
      results.push({
        agentCodename: a.codename,
        brierScore: report.brierScore,
        bias: report.overconfidenceBias,
      });
    }
  }
  return results.sort((a, b) => b.brierScore - a.brierScore);
}

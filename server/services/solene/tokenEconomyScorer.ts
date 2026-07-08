/**
 * SOLENE — token-economy scorer (L5.27).
 *
 * Every prospective dispatch gets a marginalCost-vs-marginalValue score
 * that integrates capitalTracker's envelope awareness. Solene reasons
 * against the number, not vibes.
 *
 * Three entrypoints:
 *
 *   scoreDispatchProposal(input)
 *     Compute cost + value + historical-success-rate + envelope weight
 *     → score → recommendation + rationale. Persists fire-and-forget;
 *     never throws on write failure.
 *
 *   listRecentScores(limit?)
 *     Most-recent N scoring rows (desc by scoredAt). Default limit 50.
 *
 *   getDailyScoringSummary()
 *     Today's totals + per-recommendation counts + average score + the
 *     top-3 high-value/low-cost rationales. Powers the daily-pulse
 *     Decision Scoring sub-section.
 *
 * Scoring math is documented inline with the constants. All thresholds
 * + weights + per-role defaults live in shared/schema/solene-token-economy.ts
 * so downstream surfaces can reason about them without re-importing this
 * service module.
 *
 * NOTE — daily-pulse wire-in is INTENTIONALLY deferred (TODO below).
 * The L5.27 dispatch directive explicitly says "if the daily pulse
 * generator is in a file you cannot identify as safe, DEFER the wire-in
 * and leave a TODO" — at dispatch time the obvious envelope-surface
 * consumers were routes-solene-audit.ts (HTTP endpoint, not a generator),
 * autoDispatch.ts (consumer, not generator), and selfAudit.ts (drift
 * detector, not pulse). Solene will wire this into the actual pulse
 * generator in a follow-up commit.
 *
 * TODO(solene): wire getDailyScoringSummary() into the daily-pulse
 *   generator. Sub-section title: "Decision Scoring". Surface: total
 *   scored, proceeded/deferred/rejected counts, average score, top-3
 *   high-value/low-cost rationales. Reference: L5.27 dispatch.
 */

import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  soleneDecisionScoreEvents,
  type SoleneDecisionScoreRecommendation,
  DECISION_SCORE_THRESHOLDS,
  ENVELOPE_WEIGHTS,
  PER_ROLE_DEFAULT_VALUE_USD,
  DEFAULT_HISTORICAL_SUCCESS_RATE,
} from "@shared/schema/solene-token-economy";
import {
  soleneDispatchQueue,
  soleneDispatchResults,
  type SoleneDispatchAgentRole,
} from "@shared/schema/solene-dispatch";
import { getMonthlyEnvelopeStatus } from "./capitalTracker";
import { logger } from "../../utils/logger";

// ----------------------------------------------------------------------------
// Pricing — per-1M-token cost of the dispatch default model (Sonnet, $3/$15;
// see dispatchRunner). Reads from env so Beatrice's regwatch can update
// without a redeploy. The old defaults claimed "Opus 4.7" at $15/$75 — that
// was the pre-4.6 Opus price AND not even the dispatch default model; every
// economy score was computed against a 5× inflated cost (2026-07-08).
// ----------------------------------------------------------------------------

const PRICE_INPUT_PER_M = Number(
  process.env.SOLENE_DISPATCH_PRICE_INPUT_PER_M ?? "3",
);
const PRICE_OUTPUT_PER_M = Number(
  process.env.SOLENE_DISPATCH_PRICE_OUTPUT_PER_M ?? "15",
);

const PROMPT_SUMMARY_MAX = 500;
const HISTORICAL_WINDOW_DAYS = 30;
const DEFAULT_RECENT_LIMIT = 50;

// ============================================================================
// PUBLIC TYPES
// ============================================================================

export interface ScoringInput {
  agentRole: SoleneDispatchAgentRole;
  promptText: string;
  estimatedTokens: { input: number; output: number };
  expectedValueUsd?: number;
  dispatchId?: number;
}

export interface ScoringResult {
  estimatedCostUsd: number;
  estimatedValueUsd: number;
  historicalSuccessRate: number; // 0-1
  envelopeStatus: "green" | "amber" | "red";
  score: number; // 0-1 (higher = more worth dispatching)
  recommendation: SoleneDecisionScoreRecommendation;
  rationale: string;
}

export interface RecentScoreRow {
  id: number;
  scoredAt: Date;
  dispatchId: number | null;
  agentRole: string;
  promptSummary: string;
  estimatedCostUsd: number;
  estimatedValueUsd: number | null;
  historicalSuccessRate: number;
  envelopeStatusAtDecision: string;
  score: number;
  recommendation: string;
  rationale: string;
}

export interface DailyScoringSummary {
  totalScored: number;
  proceededCount: number;
  deferredCount: number;
  rejectedCount: number;
  averageScore: number;
  top3HighValueLowCost: Array<{
    scoredAt: Date;
    agentRole: string;
    score: number;
    rationale: string;
  }>;
}

// ============================================================================
// scoreDispatchProposal — the main entrypoint.
// ============================================================================

export async function scoreDispatchProposal(
  input: ScoringInput,
): Promise<ScoringResult> {
  // 1. Estimated cost = (input/1M * priceIn) + (output/1M * priceOut)
  const estimatedCostUsd = estimateCostUsd(
    input.estimatedTokens.input,
    input.estimatedTokens.output,
  );

  // 2. Historical success rate over the last 30d for this agentRole.
  //    Defaults to DEFAULT_HISTORICAL_SUCCESS_RATE when no history exists
  //    so a brand-new role isn't penalized into the floor.
  const historicalSuccessRate = await fetchHistoricalSuccessRate(
    input.agentRole,
  );

  // 3. Estimated value — caller override or per-role default. The defaults
  //    are educated guesses; see PER_ROLE_DEFAULT_VALUE_USD inline doc.
  const estimatedValueUsd =
    input.expectedValueUsd ?? defaultValueForRole(input.agentRole);

  // 4. Envelope weight from capitalTracker. green=1.0 / amber=0.7 / red=0.4.
  const envelope = await safeEnvelopeStatus();
  const envelopeWeight = ENVELOPE_WEIGHTS[envelope];

  // 5. Final score — clamp [0, 1]. The denominator floors at $0.01 so a
  //    near-zero-cost dispatch doesn't blow the score up to infinity.
  const rawScore =
    (estimatedValueUsd * historicalSuccessRate * envelopeWeight) /
    Math.max(estimatedCostUsd, 0.01);
  const score = clamp01(rawScore);

  // 6. Recommendation based on threshold bands.
  const recommendation = recommendationFor(score);

  // 7. One-sentence rationale citing the dominant factor.
  const rationale = buildRationale({
    recommendation,
    score,
    estimatedCostUsd,
    estimatedValueUsd,
    historicalSuccessRate,
    envelopeStatus: envelope,
  });

  // Persist fire-and-forget — never block the decision path.
  void persistScoringEvent({
    dispatchId: input.dispatchId ?? null,
    agentRole: input.agentRole,
    promptSummary: truncate(input.promptText, PROMPT_SUMMARY_MAX),
    estimatedCostUsd,
    estimatedValueUsd,
    historicalSuccessRate,
    envelopeStatusAtDecision: envelope,
    score,
    recommendation,
    rationale,
  });

  return {
    estimatedCostUsd,
    estimatedValueUsd,
    historicalSuccessRate,
    envelopeStatus: envelope,
    score,
    recommendation,
    rationale,
  };
}

// ============================================================================
// listRecentScores
// ============================================================================

export async function listRecentScores(
  limit: number = DEFAULT_RECENT_LIMIT,
): Promise<RecentScoreRow[]> {
  try {
    const rows = await db
      .select()
      .from(soleneDecisionScoreEvents)
      .orderBy(desc(soleneDecisionScoreEvents.scoredAt))
      .limit(limit);
    return rows.map(rowToRecent);
  } catch (err) {
    logger.warn(
      "[tokenEconomyScorer] listRecentScores failed; returning empty",
      err instanceof Error ? err : undefined,
    );
    return [];
  }
}

// ============================================================================
// getDailyScoringSummary
// ============================================================================

export async function getDailyScoringSummary(): Promise<DailyScoringSummary> {
  const dayStart = startOfTodayUtc();
  try {
    const rows = await db
      .select()
      .from(soleneDecisionScoreEvents)
      .where(gte(soleneDecisionScoreEvents.scoredAt, dayStart));

    let proceededCount = 0;
    let deferredCount = 0;
    let rejectedCount = 0;
    let scoreSum = 0;

    for (const r of rows) {
      const s = Number(r.score);
      scoreSum += s;
      if (r.recommendation === "proceed") proceededCount += 1;
      else if (r.recommendation === "defer") deferredCount += 1;
      else if (r.recommendation === "reject") rejectedCount += 1;
    }

    const totalScored = rows.length;
    const averageScore =
      totalScored > 0 ? round4(scoreSum / totalScored) : 0;

    // top-3 = highest value/cost ratio among rows. This is a more useful
    // surface than top-3-by-score because the score is already clamp(1.0)
    // for any dispatch where value*success >> cost — many rows tie at 1.0.
    // Sort by value/cost ratio so the "obviously high-leverage" ones rise.
    const ranked = rows
      .map((r) => {
        const cost = Math.max(Number(r.estimatedCostUsd), 0.01);
        const value = Number(r.estimatedValueUsd ?? 0);
        return { row: r, ratio: value / cost };
      })
      .sort((a, b) => b.ratio - a.ratio)
      .slice(0, 3);

    const top3HighValueLowCost = ranked.map(({ row }) => ({
      scoredAt: row.scoredAt,
      agentRole: row.agentRole,
      score: Number(row.score),
      rationale: row.rationale,
    }));

    return {
      totalScored,
      proceededCount,
      deferredCount,
      rejectedCount,
      averageScore,
      top3HighValueLowCost,
    };
  } catch (err) {
    logger.warn(
      "[tokenEconomyScorer] getDailyScoringSummary failed; returning zero",
      err instanceof Error ? err : undefined,
    );
    return {
      totalScored: 0,
      proceededCount: 0,
      deferredCount: 0,
      rejectedCount: 0,
      averageScore: 0,
      top3HighValueLowCost: [],
    };
  }
}

// ============================================================================
// INTERNAL — scoring components
// ============================================================================

function estimateCostUsd(tokensIn: number, tokensOut: number): number {
  const safeIn = Number.isFinite(tokensIn) && tokensIn > 0 ? tokensIn : 0;
  const safeOut = Number.isFinite(tokensOut) && tokensOut > 0 ? tokensOut : 0;
  return (
    (safeIn / 1_000_000) * PRICE_INPUT_PER_M +
    (safeOut / 1_000_000) * PRICE_OUTPUT_PER_M
  );
}

async function fetchHistoricalSuccessRate(
  agentRole: SoleneDispatchAgentRole,
): Promise<number> {
  const cutoff = new Date(
    Date.now() - HISTORICAL_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
  try {
    const [row] = await db
      .select({
        total: sql<number>`COUNT(*)::int`,
        passed: sql<number>`COUNT(*) FILTER (WHERE ${soleneDispatchResults.success} = true)::int`,
      })
      .from(soleneDispatchResults)
      .innerJoin(
        soleneDispatchQueue,
        eq(soleneDispatchResults.dispatchId, soleneDispatchQueue.id),
      )
      .where(
        and(
          gte(soleneDispatchResults.recordedAt, cutoff),
          eq(soleneDispatchQueue.agentRole, agentRole),
        ),
      );
    const total = Number(row?.total ?? 0);
    const passed = Number(row?.passed ?? 0);
    if (total <= 0) return DEFAULT_HISTORICAL_SUCCESS_RATE;
    return clamp01(passed / total);
  } catch (err) {
    logger.warn(
      "[tokenEconomyScorer] fetchHistoricalSuccessRate failed; using default",
      err instanceof Error ? err : undefined,
    );
    return DEFAULT_HISTORICAL_SUCCESS_RATE;
  }
}

function defaultValueForRole(role: SoleneDispatchAgentRole): number {
  return PER_ROLE_DEFAULT_VALUE_USD[role] ?? 20;
}

async function safeEnvelopeStatus(): Promise<"green" | "amber" | "red"> {
  try {
    const status = await getMonthlyEnvelopeStatus();
    return status.status;
  } catch (err) {
    logger.warn(
      "[tokenEconomyScorer] envelope status fetch failed; assuming green",
      err instanceof Error ? err : undefined,
    );
    return "green";
  }
}

function recommendationFor(score: number): SoleneDecisionScoreRecommendation {
  if (score >= DECISION_SCORE_THRESHOLDS.proceedAtOrAbove) return "proceed";
  if (score < DECISION_SCORE_THRESHOLDS.rejectBelow) return "reject";
  return "defer";
}

function buildRationale(args: {
  recommendation: SoleneDecisionScoreRecommendation;
  score: number;
  estimatedCostUsd: number;
  estimatedValueUsd: number;
  historicalSuccessRate: number;
  envelopeStatus: "green" | "amber" | "red";
}): string {
  const {
    recommendation,
    score,
    estimatedCostUsd,
    estimatedValueUsd,
    historicalSuccessRate,
    envelopeStatus,
  } = args;

  if (recommendation === "defer") {
    return `Marginal score ${score.toFixed(3)} — re-evaluate when envelope improves or value is clarified (envelope=${envelopeStatus}, value $${estimatedValueUsd.toFixed(2)} vs cost $${estimatedCostUsd.toFixed(4)}).`;
  }

  if (recommendation === "reject") {
    if (envelopeStatus === "red") {
      return `Reject: envelope red and score ${score.toFixed(3)} below threshold; cost $${estimatedCostUsd.toFixed(4)} not justified at current monthly burn.`;
    }
    if (estimatedCostUsd >= estimatedValueUsd) {
      return `Reject: estimated cost $${estimatedCostUsd.toFixed(4)} exceeds expected value $${estimatedValueUsd.toFixed(2)}; score ${score.toFixed(3)}.`;
    }
    if (historicalSuccessRate < 0.5) {
      return `Reject: historical success rate ${(historicalSuccessRate * 100).toFixed(1)}% too low to justify cost $${estimatedCostUsd.toFixed(4)}; score ${score.toFixed(3)}.`;
    }
    return `Reject: score ${score.toFixed(3)} below ${DECISION_SCORE_THRESHOLDS.rejectBelow} threshold.`;
  }

  // proceed
  if (envelopeStatus === "green" && historicalSuccessRate >= 0.8) {
    return `Proceed: high-leverage — value $${estimatedValueUsd.toFixed(2)} vs cost $${estimatedCostUsd.toFixed(4)}, ${(historicalSuccessRate * 100).toFixed(1)}% historical success, envelope green.`;
  }
  return `Proceed: score ${score.toFixed(3)} above ${DECISION_SCORE_THRESHOLDS.proceedAtOrAbove} threshold (envelope=${envelopeStatus}, value $${estimatedValueUsd.toFixed(2)} vs cost $${estimatedCostUsd.toFixed(4)}).`;
}

// ============================================================================
// INTERNAL — persistence + helpers
// ============================================================================

interface PersistArgs {
  dispatchId: number | null;
  agentRole: string;
  promptSummary: string;
  estimatedCostUsd: number;
  estimatedValueUsd: number | null;
  historicalSuccessRate: number;
  envelopeStatusAtDecision: "green" | "amber" | "red";
  score: number;
  recommendation: SoleneDecisionScoreRecommendation;
  rationale: string;
}

async function persistScoringEvent(args: PersistArgs): Promise<void> {
  try {
    await db.insert(soleneDecisionScoreEvents).values({
      dispatchId: args.dispatchId,
      agentRole: args.agentRole,
      promptSummary: args.promptSummary,
      estimatedCostUsd: args.estimatedCostUsd.toFixed(4),
      estimatedValueUsd:
        args.estimatedValueUsd === null
          ? null
          : args.estimatedValueUsd.toFixed(4),
      historicalSuccessRate: clamp01(args.historicalSuccessRate).toFixed(4),
      envelopeStatusAtDecision: args.envelopeStatusAtDecision,
      score: clamp01(args.score).toFixed(4),
      recommendation: args.recommendation,
      rationale: args.rationale,
    });
  } catch (err) {
    logger.warn(
      "[tokenEconomyScorer] persistScoringEvent swallow",
      err instanceof Error ? err : undefined,
    );
  }
}

function rowToRecent(
  row: typeof soleneDecisionScoreEvents.$inferSelect,
): RecentScoreRow {
  return {
    id: row.id,
    scoredAt: row.scoredAt,
    dispatchId: row.dispatchId,
    agentRole: row.agentRole,
    promptSummary: row.promptSummary,
    estimatedCostUsd: Number(row.estimatedCostUsd),
    estimatedValueUsd:
      row.estimatedValueUsd === null ? null : Number(row.estimatedValueUsd),
    historicalSuccessRate: Number(row.historicalSuccessRate),
    envelopeStatusAtDecision: row.envelopeStatusAtDecision,
    score: Number(row.score),
    recommendation: row.recommendation,
    rationale: row.rationale,
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max);
}

function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
  );
}

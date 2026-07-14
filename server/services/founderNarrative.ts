/**
 * Founder Narrative — the monthly letter.
 *
 * This is the primary surface for the "1 hour per month" founder
 * operation. Instead of asking the founder to scan five dashboards,
 * read 14 individual decisions, and reconcile conflicting signals,
 * they read one letter on the first of each month.
 *
 * The letter follows a tight structure:
 *   1. A one-sentence verdict on the month.
 *   2. What the system did autonomously and why (3-5 highlights).
 *   3. Where it went wrong — founder overrides, negative outcomes,
 *      safety-rail trips. Unflinching about what didn't work.
 *   4. What's planned for next month.
 *   5. The one decision the founder has to make this month.
 *
 * The letter is written in the voice of the company, not a single
 * agent. Opus is asked to synthesize across all 12 agents' activity
 * so the result reads like a single chief of staff, not a committee.
 *
 * Generation is idempotent per month — the monthKey is a UNIQUE
 * column. `generateMonthlyLetter()` upserts. On-demand regeneration
 * is allowed until the founder marks the letter delivered.
 */

import { db } from "../db";
import {
  founderLetters,
  decisionsInboxItems,
  companyAgents,
  agentPromptEvolutions,
  organizations,
  payments,
} from "@shared/schema";
import { and, desc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import { FOUNDER_MINUTES_BUDGET } from "@sovereign/immutables";
import { logger } from "../utils/logger";
import { routeCriticalTask } from "./aiRouter";

export interface MonthlySummary {
  monthKey: string;
  monthLabel: string;
  windowStart: Date;
  windowEnd: Date;
  decisions: {
    total: number;
    autoResolved: number;
    escalated: number;
    founderReversed: number;
    guardrailBlocked: number;
  };
  outcomes: {
    graded: number;
    avgScore: number | null;
    netPositive: number;
    netNegative: number;
  };
  /**
   * Horizon A1 — one honest paragraph on prediction calibration (outcome-
   * ledger counts + Brier from computeCalibration). Reads "unmeasured" on a
   * failed read and refuses to quote percentages under 10 scored outcomes —
   * never a fabricated number.
   */
  calibrationParagraph: string;
  /**
   * Horizon A4 — one honest paragraph on cognition ROI: real dispatch spend
   * vs. value with a REAL join back to a dispatch (computeCognitionRoi).
   * Always shows both numbers; unattributed spend is named as unattributed
   * (a measurement gap), never implied to be measured value. Reads
   * "unmeasured" on a failed read.
   */
  cognitionParagraph: string;
  agents: Array<{
    codename: string;
    decisionsOwned: number;
    trustScore: number;
    recentTrend: "up" | "down" | "flat";
  }>;
  pendingProposals: number;
  openDecisionsNeedingFounder: number;
  autonomyHealth: {
    band: "green" | "yellow" | "red";
    verdict: string;
  };
  topHighlights: string[];
  topLowlights: string[];
  candidateFounderDecision: string | null;
  synthesizedStrategicMoves: Array<{
    title: string;
    rationale: string;
    category: string;
    estimatedImpactCents: number | null;
    confidence: number;
    proposedBy: string;
  }>;
}

/**
 * Main entry point. If monthKey is omitted, generates the previous
 * calendar month (the "letter in review" for first-of-month delivery).
 */
export async function generateMonthlyLetter(monthKey?: string): Promise<{
  monthKey: string;
  letterMarkdown: string;
  summary: MonthlySummary;
  pendingFounderDecision: string | null;
}> {
  const { key, start, end, label } = resolveMonth(monthKey);
  const summary = await buildSummary(key, label, start, end);
  const prose = await writeNarrative(summary);

  // Kernel-restructure step 5 (founder directive 2026-07-13): The Letter
  // OPENS with the two numbers — outcomes shipped and founder decisions
  // consumed vs. the constitutional budget — plus verification coverage
  // "Verified: N/M" (Jarvis Phase 1 CP4). Injected deterministically
  // after the title so neither the model nor the fallback can drop it.
  // A failed metric read says "unmeasured" — never a fabricated zero.
  let tickMetricLine: string;
  try {
    const { getTickMetric, renderTickMetricLine } = await import("./solene/tickMetric");
    tickMetricLine = renderTickMetricLine(await getTickMetric());
  } catch (err) {
    logger.warn("[founderNarrative] tick-metric read failed; letter opens with an honest 'unmeasured'", {
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
    tickMetricLine =
      "Shipped for customers this week: unmeasured (metric read failed this cycle). " +
      `Founder decisions consumed: unmeasured of ${FOUNDER_MINUTES_BUDGET.classABDecisionsPerWeek} budget. ` +
      "Verified: unmeasured. Outcome ledger (90d): unmeasured. Cognition (30d): unmeasured.";
  }
  const letterMarkdown = openWithTickMetric(prose.markdown, tickMetricLine);

  await db
    .insert(founderLetters)
    .values({
      monthKey: key,
      letterMarkdown,
      summaryJson: summary,
      pendingFounderDecision: prose.pendingFounderDecision,
      status: "draft",
    })
    .onConflictDoUpdate({
      target: founderLetters.monthKey,
      set: {
        letterMarkdown,
        summaryJson: summary,
        pendingFounderDecision: prose.pendingFounderDecision,
        generatedAt: new Date(),
      },
    });

  logger.info(`[founderNarrative] letter generated for ${key}`);
  return {
    monthKey: key,
    letterMarkdown,
    summary,
    pendingFounderDecision: prose.pendingFounderDecision,
  };
}

/**
 * Place the tick-metric line as the FIRST content line of the letter —
 * immediately after the "# Founder letter — ..." title (and before the
 * one-line verdict). If the markdown has no title (a degenerate model
 * response), the line is prepended so it still opens the letter.
 * Exported for unit tests.
 */
export function openWithTickMetric(markdown: string, metricLine: string): string {
  const lines = markdown.split("\n");
  const titleIdx = lines.findIndex((l) => l.trim().startsWith("#"));
  if (titleIdx === -1) return `${metricLine}\n\n${markdown}`;
  return [
    ...lines.slice(0, titleIdx + 1),
    "",
    metricLine,
    ...lines.slice(titleIdx + 1),
  ].join("\n");
}

/**
 * Fetch the most recent letter in draft or delivered state.
 */
export async function getCurrentLetter() {
  const [row] = await db
    .select()
    .from(founderLetters)
    .orderBy(desc(founderLetters.generatedAt))
    .limit(1);
  return row ?? null;
}

export async function getLetterByMonth(monthKey: string) {
  const [row] = await db
    .select()
    .from(founderLetters)
    .where(eq(founderLetters.monthKey, monthKey))
    .limit(1);
  return row ?? null;
}

export async function listLetterArchive(limit = 24) {
  return db
    .select({
      monthKey: founderLetters.monthKey,
      generatedAt: founderLetters.generatedAt,
      deliveredAt: founderLetters.deliveredAt,
      status: founderLetters.status,
      pendingFounderDecision: founderLetters.pendingFounderDecision,
    })
    .from(founderLetters)
    .orderBy(desc(founderLetters.monthKey))
    .limit(limit);
}

export async function markLetterDelivered(monthKey: string) {
  await db
    .update(founderLetters)
    .set({ status: "delivered", deliveredAt: new Date() })
    .where(eq(founderLetters.monthKey, monthKey));
}

/**
 * Resolve the month window. Defaults to the previous calendar month
 * in UTC so the 1st-of-month cron generates a letter about the month
 * that just ended, not the one that just started.
 */
function resolveMonth(
  monthKey?: string,
): { key: string; start: Date; end: Date; label: string } {
  const now = new Date();
  let year: number, month: number; // month 0-indexed
  if (monthKey) {
    const [y, m] = monthKey.split("-").map((n) => parseInt(n, 10));
    year = y;
    month = m - 1;
  } else {
    // default: last complete month
    year = now.getUTCFullYear();
    month = now.getUTCMonth() - 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
  }
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 1));
  const label = start.toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const key = `${year}-${String(month + 1).padStart(2, "0")}`;
  return { key, start, end, label };
}

async function buildSummary(
  key: string,
  label: string,
  start: Date,
  end: Date,
): Promise<MonthlySummary> {
  const [decisionRows, agentRows, proposalRows, openDecisionsRow] =
    await Promise.all([
      db
        .select({
          id: decisionsInboxItems.id,
          status: decisionsInboxItems.status,
          resolvedBy: decisionsInboxItems.resolvedBy,
          founderOverrideAction: decisionsInboxItems.founderOverrideAction,
          outcomeScore: decisionsInboxItems.outcomeScore,
          actualOutcome: decisionsInboxItems.actualOutcome,
          recommendedActionLabel: decisionsInboxItems.recommendedActionLabel,
          ownerAgentCodename: decisionsInboxItems.ownerAgentCodename,
          itemType: decisionsInboxItems.itemType,
          riskLevel: decisionsInboxItems.riskLevel,
          urgencyScore: decisionsInboxItems.urgencyScore,
          estimatedImpactCents: decisionsInboxItems.estimatedImpactCents,
        })
        .from(decisionsInboxItems)
        .where(
          and(
            gte(decisionsInboxItems.createdAt, start),
            lt(decisionsInboxItems.createdAt, end),
          ),
        ),
      db.select().from(companyAgents).where(eq(companyAgents.status, "active")),
      db
        .select({ id: agentPromptEvolutions.id })
        .from(agentPromptEvolutions)
        .where(eq(agentPromptEvolutions.status, "proposed")),
      db
        .select({ c: sql<number>`count(*)::int` })
        .from(decisionsInboxItems)
        .where(eq(decisionsInboxItems.status, "pending")),
    ]);

  const total = decisionRows.length;
  const autoResolved = decisionRows.filter(
    (r) => r.status === "auto_resolved" || r.resolvedBy === "autonomous_executor",
  ).length;
  const escalated = decisionRows.filter(
    (r) => r.status === "deferred" || r.status === "pending",
  ).length;
  const founderReversed = decisionRows.filter(
    (r) => r.founderOverrideAction != null,
  ).length;
  const guardrailBlocked = decisionRows.filter(
    (r) => r.resolvedBy === "hard_guardrail",
  ).length;

  const graded = decisionRows.filter((r) => r.outcomeScore != null);
  const avg = graded.length
    ? graded.reduce((s, r) => s + (r.outcomeScore ?? 0), 0) / graded.length
    : null;

  const netPositive = graded.filter((r) => (r.outcomeScore ?? 0) > 0).length;
  const netNegative = graded.filter((r) => (r.outcomeScore ?? 0) < 0).length;

  const agents = agentRows.map((a) => {
    const owned = decisionRows.filter((r) => r.ownerAgentCodename === a.codename).length;
    const agentGraded = graded.filter((r) => r.ownerAgentCodename === a.codename);
    const trend: "up" | "down" | "flat" =
      agentGraded.length === 0
        ? "flat"
        : agentGraded.reduce((s, r) => s + (r.outcomeScore ?? 0), 0) / agentGraded.length > 0.5
          ? "up"
          : agentGraded.reduce((s, r) => s + (r.outcomeScore ?? 0), 0) / agentGraded.length < 0
            ? "down"
            : "flat";
    return {
      codename: a.codename,
      decisionsOwned: owned,
      trustScore: a.trustScore,
      recentTrend: trend,
    };
  });

  const topHighlights = decisionRows
    .filter((r) => (r.outcomeScore ?? 0) >= 1)
    .sort((a, b) => Math.abs(b.estimatedImpactCents ?? 0) - Math.abs(a.estimatedImpactCents ?? 0))
    .slice(0, 5)
    .map(
      (r) =>
        `[${r.ownerAgentCodename ?? "agent"}] "${r.recommendedActionLabel}" — ${r.actualOutcome ?? "handled cleanly"}`,
    );

  const topLowlights = decisionRows
    .filter((r) => (r.outcomeScore ?? 0) <= -1 || r.founderOverrideAction != null)
    .slice(0, 5)
    .map(
      (r) =>
        `[${r.ownerAgentCodename ?? "agent"}] "${r.recommendedActionLabel}" — ${r.founderOverrideAction ? `founder ${r.founderOverrideAction}` : "negative outcome"}${r.actualOutcome ? ` (${r.actualOutcome})` : ""}`,
    );

  // Candidate "one decision for the founder" — highest-urgency pending
  // or critical deferred item with no resolution.
  const candidates = decisionRows
    .filter((r) => r.status === "pending" || r.status === "deferred")
    .sort((a, b) => (b.urgencyScore ?? 0) - (a.urgencyScore ?? 0));
  const candidateFounderDecision = candidates[0]
    ? `[${candidates[0].ownerAgentCodename ?? "agent"}] ${candidates[0].recommendedActionLabel}`
    : null;

  let autonomyHealth: MonthlySummary["autonomyHealth"] = {
    band: "green",
    verdict: "System operating within tolerances.",
  };
  try {
    const { getAutonomyHealth } = await import("./autonomyHealth");
    const report = await getAutonomyHealth();
    autonomyHealth = { band: report.band, verdict: report.verdict };
  } catch {
    // leave defaults
  }

  // Horizon A1 — the calibration paragraph for the decision-grades section.
  // Built from the outcome ledger's counts + computeCalibration (Brier).
  // A failed read says "unmeasured" — never a fabricated number.
  let calibrationParagraph: string;
  try {
    const { getOutcomeLedgerCounts } = await import("./outcomeLedger");
    const ledger = await getOutcomeLedgerCounts();
    let report = null;
    if (ledger.scored >= CALIBRATION_MIN_SAMPLE) {
      const { computeCalibration } = await import("./calibration");
      report = await computeCalibration("all", 90);
    }
    calibrationParagraph = buildCalibrationParagraph(ledger, report);
  } catch (err: any) {
    logger.warn("[founderNarrative] calibration read failed — reporting unmeasured", {
      metadata: { error: err?.message },
    });
    calibrationParagraph =
      "Calibration: unmeasured this month (outcome-ledger read failed) — no number is quoted rather than a guessed one.";
  }

  // Horizon A4 — the cognition-ROI paragraph: what cognition cost and what
  // it verifiably earned. Same posture as calibration: a failed read says
  // "unmeasured" — never a fabricated number.
  let cognitionParagraph: string;
  try {
    const { computeCognitionRoi } = await import("./solene/cognitionRoi");
    cognitionParagraph = buildCognitionParagraph(await computeCognitionRoi(30));
  } catch (err: any) {
    logger.warn("[founderNarrative] cognition-ROI read failed — reporting unmeasured", {
      metadata: { error: err?.message },
    });
    cognitionParagraph =
      "Cognition: unmeasured this month (spend/value read failed) — no number is quoted rather than a guessed one.";
  }

  // Pull synthesized strategic moves for next month, if any.
  // The letter is written FOR month N but looks AHEAD to month N+1,
  // so we peek at synthesized proposals targeted at the upcoming month.
  let synthesizedStrategicMoves: MonthlySummary["synthesizedStrategicMoves"] = [];
  try {
    const { listSynthesizedForMonth } = await import("./strategicProposals");
    // Next month relative to the month being written about.
    const nextMonthDate = new Date(end.getTime());
    const nextMonthKey = `${nextMonthDate.getUTCFullYear()}-${String(nextMonthDate.getUTCMonth() + 1).padStart(2, "0")}`;
    const rows = await listSynthesizedForMonth(nextMonthKey);
    synthesizedStrategicMoves = rows.map((r) => ({
      title: r.title,
      rationale: r.rationale,
      category: r.category,
      estimatedImpactCents: r.estimatedImpactCents,
      confidence: r.confidence,
      proposedBy: r.proposedBy,
    }));
  } catch (err: any) {
    logger.warn("[founderNarrative] strategic moves fetch failed", {
      metadata: { error: err?.message },
    });
  }

  return {
    monthKey: key,
    monthLabel: label,
    windowStart: start,
    windowEnd: end,
    decisions: {
      total,
      autoResolved,
      escalated,
      founderReversed,
      guardrailBlocked,
    },
    outcomes: {
      graded: graded.length,
      avgScore: avg,
      netPositive,
      netNegative,
    },
    calibrationParagraph,
    cognitionParagraph,
    agents,
    pendingProposals: proposalRows.length,
    openDecisionsNeedingFounder: Number(openDecisionsRow[0]?.c ?? 0),
    autonomyHealth,
    topHighlights,
    topLowlights,
    candidateFounderDecision,
    synthesizedStrategicMoves,
  };
}

/**
 * Horizon A1 — below this many ledger-scored outcomes, calibration
 * percentages are noise; the paragraph says so instead of quoting them.
 */
const CALIBRATION_MIN_SAMPLE = 10;

/**
 * One honest paragraph on prediction calibration for the decision-grades
 * section. `report` is null when the sample is too small to bother
 * computing (or confidence pairs are unavailable). Exported for unit tests.
 */
export function buildCalibrationParagraph(
  ledger: { scored: number; positive: number; pending: number; overdue: number },
  report: {
    brierScore: number | null;
    overconfidenceBias: number | null;
    verdict: string;
  } | null,
): string {
  const total = ledger.scored + ledger.pending + ledger.overdue;
  if (total === 0) {
    return "Calibration: no decisions carry predictions yet — the outcome ledger starts scoring at the 30/90-day check-ins.";
  }
  const counts = `${ledger.scored} prediction${ledger.scored === 1 ? "" : "s"} scored (${ledger.positive} positive), ${ledger.pending} pending, ${ledger.overdue} overdue in the trailing 90 days`;
  if (ledger.scored < CALIBRATION_MIN_SAMPLE) {
    return `Calibration: ${counts}. Fewer than ${CALIBRATION_MIN_SAMPLE} scored outcomes — too small a sample to quote calibration percentages, so none are quoted.`;
  }
  if (report == null || report.brierScore == null) {
    return `Calibration: ${counts}. Confidence-vs-outcome pairs are not available for these decisions, so the Brier score is not computable — reported as such rather than estimated.`;
  }
  const bias =
    report.overconfidenceBias == null
      ? ""
      : ` Overconfidence bias ${report.overconfidenceBias > 0 ? "+" : ""}${report.overconfidenceBias} points.`;
  return `Calibration: ${counts}. Brier score ${report.brierScore} (lower is better). ${report.verdict}${bias}`;
}

/**
 * Horizon A4 — below this attributed share, the paragraph says plainly that
 * most cognition spend is not yet attributable to a measured outcome.
 */
const COGNITION_LOW_ATTRIBUTION_SHARE = 0.5;

/**
 * One honest paragraph on cognition ROI for The Letter: spend, attributed
 * value, the best and worst sourceType by attributed value, and — whenever
 * attribution coverage is thin — the plain sentence that most spend is not
 * yet attributable. Value here is ONLY what joined back to a real dispatch
 * (recovered cents); nothing is imputed. Exported for unit tests. Pure.
 */
export function buildCognitionParagraph(roi: {
  spentUsd: number;
  attributedValueUsd: number;
  attributedDispatches: number;
  totalDispatches: number;
  bySourceType: Array<{ sourceType: string; spentUsd: number; attributedValueUsd: number }>;
}): string {
  if (roi.totalDispatches === 0 && roi.attributedDispatches === 0) {
    return "Cognition: no agent-dispatch spend recorded in the trailing 30 days, so there is nothing to attribute yet.";
  }

  const head =
    `Cognition: $${roi.spentUsd.toFixed(2)} spent on agent dispatches in the trailing 30 days → ` +
    `$${roi.attributedValueUsd.toFixed(2)} in attributed value ` +
    `(${roi.attributedDispatches} of ${roi.totalDispatches} dispatches have a real dollar outcome joined back).`;

  const ranked = roi.bySourceType
    .filter((s) => s.attributedValueUsd > 0)
    .sort((a, b) => b.attributedValueUsd - a.attributedValueUsd);
  let sources: string;
  if (ranked.length === 0) {
    sources = " No source of work has attributed value yet.";
  } else if (ranked.length === 1) {
    sources = ` All attributed value came through ${ranked[0].sourceType} ($${ranked[0].attributedValueUsd.toFixed(2)}).`;
  } else {
    const top = ranked[0];
    const bottom = ranked[ranked.length - 1];
    sources =
      ` Most attributed value: ${top.sourceType} ($${top.attributedValueUsd.toFixed(2)}); ` +
      `least: ${bottom.sourceType} ($${bottom.attributedValueUsd.toFixed(2)}).`;
  }

  const share =
    roi.totalDispatches > 0 ? roi.attributedDispatches / roi.totalDispatches : 0;
  const honesty =
    roi.attributedDispatches === 0 || share < COGNITION_LOW_ATTRIBUTION_SHARE
      ? " Most of this spend is not yet attributable to a measured dollar outcome — that is a measurement gap, reported as such: it is not evidence the work was worthless, and not license to assume it was valuable."
      : "";

  return head + sources + honesty;
}

/**
 * Call Opus to turn the structured summary into the one-page letter.
 * The system prompt fixes the voice and structure so the result is
 * consistent month to month.
 */
async function writeNarrative(summary: MonthlySummary): Promise<{
  markdown: string;
  pendingFounderDecision: string | null;
}> {
  const context = buildNarrativeContext(summary);
  try {
    const response = await routeCriticalTask(
      "founder_monthly_letter",
      NARRATIVE_SYSTEM_PROMPT,
      context,
    );
    const parsed = parseNarrative(response.content);
    return parsed;
  } catch (err: any) {
    logger.warn("[founderNarrative] narrative generation failed, using structured fallback", {
      metadata: { error: err?.message },
    });
    return {
      markdown: buildFallbackLetter(summary),
      pendingFounderDecision: summary.candidateFounderDecision,
    };
  }
}

function buildNarrativeContext(s: MonthlySummary): string {
  const lines: string[] = [];
  lines.push(`MONTH: ${s.monthLabel}`);
  lines.push(`AUTONOMY HEALTH: ${s.autonomyHealth.band.toUpperCase()} — ${s.autonomyHealth.verdict}`);
  lines.push("");
  lines.push(`DECISION ACTIVITY THIS MONTH:`);
  lines.push(`- Total: ${s.decisions.total}`);
  lines.push(`- Auto-resolved without your input: ${s.decisions.autoResolved}`);
  lines.push(`- Escalated or still pending: ${s.decisions.escalated}`);
  lines.push(`- You reversed: ${s.decisions.founderReversed}`);
  lines.push(`- Safety rail stopped: ${s.decisions.guardrailBlocked}`);
  lines.push("");
  lines.push(`OUTCOMES (of decisions old enough to grade):`);
  lines.push(`- Graded: ${s.outcomes.graded}`);
  if (s.outcomes.avgScore != null) lines.push(`- Avg score (−2..+2): ${s.outcomes.avgScore.toFixed(2)}`);
  lines.push(`- Net positive: ${s.outcomes.netPositive} · net negative: ${s.outcomes.netNegative}`);
  lines.push(`- ${s.calibrationParagraph}`);
  lines.push(`- ${s.cognitionParagraph}`);
  lines.push("");
  lines.push(`TOP HIGHLIGHTS (what worked):`);
  for (const h of s.topHighlights) lines.push(`- ${h}`);
  if (s.topHighlights.length === 0) lines.push(`- (no positively-graded decisions yet)`);
  lines.push("");
  lines.push(`TOP LOWLIGHTS (what didn't):`);
  for (const l of s.topLowlights) lines.push(`- ${l}`);
  if (s.topLowlights.length === 0) lines.push(`- (none)`);
  lines.push("");
  lines.push(`TEAM TRENDS:`);
  for (const a of s.agents) {
    lines.push(
      `- ${a.codename}: ${a.decisionsOwned} decisions, trust ${a.trustScore}, trend ${a.recentTrend}`,
    );
  }
  lines.push("");
  lines.push(`PENDING FOUNDER ACTION QUEUE:`);
  lines.push(`- Open decisions needing you: ${s.openDecisionsNeedingFounder}`);
  lines.push(`- Prompt-evolution proposals waiting approval: ${s.pendingProposals}`);
  if (s.candidateFounderDecision)
    lines.push(`- Top candidate for "the one decision": ${s.candidateFounderDecision}`);
  lines.push("");
  if (s.synthesizedStrategicMoves.length > 0) {
    lines.push(`SYNTHESIZED STRATEGIC MOVES FOR NEXT MONTH (use these as the backbone of "Next month's focus"):`);
    for (const m of s.synthesizedStrategicMoves) {
      lines.push(
        `- [${m.proposedBy}] ${m.category}/${m.confidence}%: "${m.title}" — ${m.rationale.slice(0, 200)}${m.estimatedImpactCents ? ` ($${(m.estimatedImpactCents / 100).toFixed(0)})` : ""}`,
      );
    }
    lines.push("");
  }
  lines.push(
    `Write the monthly letter per the system prompt. Return JSON with keys markdown and pendingFounderDecision.`,
  );
  return lines.join("\n");
}

function parseNarrative(raw: string): { markdown: string; pendingFounderDecision: string | null } {
  const cleaned = raw.replace(/```json\n?|```/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed.markdown === "string") {
      return {
        markdown: parsed.markdown,
        pendingFounderDecision: parsed.pendingFounderDecision ?? null,
      };
    }
  } catch {
    // fall through
  }
  return { markdown: raw.trim(), pendingFounderDecision: null };
}

function buildFallbackLetter(s: MonthlySummary): string {
  const lines = [
    `# Founder letter — ${s.monthLabel}`,
    "",
    `**Status:** ${s.autonomyHealth.band.toUpperCase()} — ${s.autonomyHealth.verdict}`,
    "",
    `## What happened`,
    "",
    `The system handled ${s.decisions.total} decisions this month. ${s.decisions.autoResolved} were resolved autonomously, ${s.decisions.escalated} were escalated or are still in the queue, ${s.decisions.founderReversed} you reversed, and ${s.decisions.guardrailBlocked} were stopped by safety rails.`,
    "",
    s.calibrationParagraph,
    "",
    s.cognitionParagraph,
    "",
    `## What worked`,
    "",
    s.topHighlights.length > 0
      ? s.topHighlights.map((h) => `- ${h}`).join("\n")
      : "_No positively-graded decisions yet._",
    "",
    `## What didn't`,
    "",
    s.topLowlights.length > 0
      ? s.topLowlights.map((l) => `- ${l}`).join("\n")
      : "_No negative outcomes or founder reversals._",
    "",
    `## The one thing I need from you this month`,
    "",
    s.candidateFounderDecision
      ? `**${s.candidateFounderDecision}** — open the decision inbox when you have 15 minutes.`
      : s.pendingProposals > 0
        ? `Review the ${s.pendingProposals} prompt-evolution proposals. Approving the good ones compounds across every future decision.`
        : `Nothing specific. Enjoy the month.`,
  ];
  return lines.join("\n");
}

const NARRATIVE_SYSTEM_PROMPT = `You are the AcreOS Chief of Staff writing the monthly operations letter to the founder, Thomas.

Voice and rules:
- Single narrator, never "the team decided" — write as one voice synthesizing across all 12 agents.
- Plain English. No jargon, no acronyms the founder doesn't already know.
- Unflinching about what didn't work. The founder reads this to catch problems early, not to feel good.
- Never mention competitors (Land Geek, GeekPay, etc.) or other products.
- Refer to customers as "Land Investors," not "real estate professionals" or generic "users."
- No emojis. No corporate-speak.
- Never invent facts. Only use what's in the structured summary.

Structure (use these exact markdown headings):

# Founder letter — <MONTH LABEL>

**One-line verdict on the month.** (single sentence — green/yellow/red summary)

## What I did this month
3-5 bullet points of highlighted auto-resolved decisions with why they mattered.

## Where I struggled
2-4 bullet points of lowlights. Name specifically what went wrong and what I'm adjusting.

## Next month's focus
2-3 sentences on the planned direction, informed by trends in the data.

## The one thing I need from you
A single bolded decision the founder has to weigh in on. If there's no such decision, say so honestly and suggest something else (review prompt proposals, check the autonomy-health card, etc.).

Output format (JSON — no code fences):
{
  "markdown": "<the full letter in markdown>",
  "pendingFounderDecision": "<one-line description of the single decision needing founder input, or null if none>"
}`;

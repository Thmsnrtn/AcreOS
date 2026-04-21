/**
 * System Trends — the meta-dashboard the founder reads when they
 * want to know "is this system getting better, or is it getting worse?"
 *
 * The autonomy-health meter answers "do I need to act today?" The
 * founder letter answers "what happened this month?" This service
 * answers the longer question: "over the last 90 days, has the system
 * gained or lost trustworthiness?"
 *
 * All series derive from data already in the decisions inbox — no new
 * table. Sampled daily (outcome avg) or weekly (Brier, override rate).
 * Returns a structure ready to drop into Recharts.
 *
 * The founder should be able to look at these charts and feel
 * confident delegating further — OR catch an inflection point early
 * when the system starts regressing. Either way it's a trust layer.
 */

import { db } from "../db";
import {
  decisionsInboxItems,
  companyAgents,
  trustEvolutionLog,
} from "@shared/schema";
import { and, asc, desc, eq, gte, isNotNull, sql } from "drizzle-orm";

export interface TrendPoint {
  date: string; // ISO date (YYYY-MM-DD) for daily, YYYY-WW for weekly
  value: number | null;
}

export interface TrendSeries {
  key: string;
  label: string;
  unit: string;
  series: TrendPoint[];
  latest: number | null;
  direction: "up" | "down" | "flat" | "unknown";
}

export interface AgentTrustPoint {
  date: string;
  codename: string;
  trustScore: number;
}

export interface SystemTrendsReport {
  windowDays: number;
  generatedAt: string;
  series: {
    avgOutcomeScore: TrendSeries;
    founderOverrideRate: TrendSeries;
    autoResolvedRatio: TrendSeries;
    calibrationBrier: TrendSeries;
    safetyRailTrips: TrendSeries;
    decisionVolume: TrendSeries;
  };
  agentTrustTrajectories: AgentTrustPoint[];
  verdict: string;
}

/**
 * Compute full system trends report.
 */
export async function computeSystemTrends(
  windowDays: number = 90,
): Promise<SystemTrendsReport> {
  const [
    avgOutcomeScore,
    founderOverrideRate,
    autoResolvedRatio,
    calibrationBrier,
    safetyRailTrips,
    decisionVolume,
    agentTrustTrajectories,
  ] = await Promise.all([
    dailyOutcomeAvg(windowDays),
    weeklyOverrideRate(windowDays),
    weeklyAutoResolvedRatio(windowDays),
    weeklyBrier(windowDays),
    weeklySafetyRails(windowDays),
    dailyDecisionVolume(windowDays),
    agentTrustSeries(windowDays),
  ]);

  const verdict = buildVerdict({
    avgOutcomeScore,
    founderOverrideRate,
    autoResolvedRatio,
    calibrationBrier,
  });

  return {
    windowDays,
    generatedAt: new Date().toISOString(),
    series: {
      avgOutcomeScore,
      founderOverrideRate,
      autoResolvedRatio,
      calibrationBrier,
      safetyRailTrips,
      decisionVolume,
    },
    agentTrustTrajectories,
    verdict,
  };
}

// ── Individual series ───────────────────────────────────────────────

async function dailyOutcomeAvg(windowDays: number): Promise<TrendSeries> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const rows = await db.execute(sql`
    SELECT
      date_trunc('day', outcome_recorded_at)::date AS day,
      avg(outcome_score)::float AS avg_score
    FROM decisions_inbox_items
    WHERE outcome_recorded_at >= ${since}
      AND outcome_score IS NOT NULL
    GROUP BY day
    ORDER BY day ASC
  `);
  const series = (rows.rows as any[]).map((r) => ({
    date: new Date(r.day).toISOString().slice(0, 10),
    value: r.avg_score != null ? Math.round(Number(r.avg_score) * 100) / 100 : null,
  }));
  return wrapSeries("avgOutcomeScore", "Avg outcome score", "−2..+2", series);
}

async function weeklyOverrideRate(windowDays: number): Promise<TrendSeries> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const rows = await db.execute(sql`
    SELECT
      date_trunc('week', resolved_at)::date AS week,
      count(*)::int AS total,
      sum(CASE WHEN founder_override_action IS NOT NULL THEN 1 ELSE 0 END)::int AS overridden
    FROM decisions_inbox_items
    WHERE resolved_at >= ${since}
    GROUP BY week
    ORDER BY week ASC
  `);
  const series = (rows.rows as any[]).map((r) => ({
    date: new Date(r.week).toISOString().slice(0, 10),
    value: r.total > 0 ? Math.round((r.overridden / r.total) * 1000) / 10 : null,
  }));
  return wrapSeries("founderOverrideRate", "Founder override rate", "%", series);
}

async function weeklyAutoResolvedRatio(windowDays: number): Promise<TrendSeries> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const rows = await db.execute(sql`
    SELECT
      date_trunc('week', created_at)::date AS week,
      count(*)::int AS total,
      sum(CASE WHEN status = 'auto_resolved' OR resolved_by = 'autonomous_executor' THEN 1 ELSE 0 END)::int AS auto
    FROM decisions_inbox_items
    WHERE created_at >= ${since}
    GROUP BY week
    ORDER BY week ASC
  `);
  const series = (rows.rows as any[]).map((r) => ({
    date: new Date(r.week).toISOString().slice(0, 10),
    value: r.total > 0 ? Math.round((r.auto / r.total) * 1000) / 10 : null,
  }));
  return wrapSeries("autoResolvedRatio", "Auto-resolved ratio", "%", series);
}

async function weeklyBrier(windowDays: number): Promise<TrendSeries> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  // Brier requires (confidence, right). Group by ISO week. Confidence is
  // in contextBundle->>'executorConfidence'; rightness is outcomeScore > 0.
  const rows = await db.execute(sql`
    WITH pairs AS (
      SELECT
        date_trunc('week', outcome_recorded_at)::date AS week,
        (context_bundle->>'executorConfidence')::float / 100.0 AS conf,
        CASE WHEN outcome_score > 0 THEN 1 WHEN outcome_score < 0 THEN 0 ELSE NULL END AS right_
      FROM decisions_inbox_items
      WHERE outcome_recorded_at >= ${since}
        AND outcome_score IS NOT NULL AND outcome_score != 0
        AND context_bundle->>'executorConfidence' IS NOT NULL
    )
    SELECT
      week,
      avg(power(conf - right_, 2))::float AS brier
    FROM pairs
    WHERE right_ IS NOT NULL
    GROUP BY week
    ORDER BY week ASC
  `);
  const series = (rows.rows as any[]).map((r) => ({
    date: new Date(r.week).toISOString().slice(0, 10),
    value: r.brier != null ? Math.round(Number(r.brier) * 1000) / 1000 : null,
  }));
  return wrapSeries("calibrationBrier", "Calibration Brier (↓ is better)", "score", series);
}

async function weeklySafetyRails(windowDays: number): Promise<TrendSeries> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const rows = await db.execute(sql`
    SELECT
      date_trunc('week', resolved_at)::date AS week,
      count(*)::int AS trips
    FROM decisions_inbox_items
    WHERE resolved_at >= ${since}
      AND resolved_by = 'hard_guardrail'
    GROUP BY week
    ORDER BY week ASC
  `);
  const series = (rows.rows as any[]).map((r) => ({
    date: new Date(r.week).toISOString().slice(0, 10),
    value: Number(r.trips),
  }));
  return wrapSeries("safetyRailTrips", "Safety-rail trips per week", "count", series);
}

async function dailyDecisionVolume(windowDays: number): Promise<TrendSeries> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const rows = await db.execute(sql`
    SELECT
      date_trunc('day', created_at)::date AS day,
      count(*)::int AS n
    FROM decisions_inbox_items
    WHERE created_at >= ${since}
    GROUP BY day
    ORDER BY day ASC
  `);
  const series = (rows.rows as any[]).map((r) => ({
    date: new Date(r.day).toISOString().slice(0, 10),
    value: Number(r.n),
  }));
  return wrapSeries("decisionVolume", "Decisions per day", "count", series);
}

async function agentTrustSeries(windowDays: number): Promise<AgentTrustPoint[]> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      codename: trustEvolutionLog.agentCodename,
      date: trustEvolutionLog.createdAt,
      score: trustEvolutionLog.newScore,
    })
    .from(trustEvolutionLog)
    .where(gte(trustEvolutionLog.createdAt, since))
    .orderBy(asc(trustEvolutionLog.createdAt));

  return rows.map((r) => ({
    date: r.date ? new Date(r.date).toISOString().slice(0, 10) : "",
    codename: r.codename,
    trustScore: r.score,
  }));
}

// ── Helpers ─────────────────────────────────────────────────────────

function wrapSeries(
  key: string,
  label: string,
  unit: string,
  series: TrendPoint[],
): TrendSeries {
  const latest = series.length > 0 ? series[series.length - 1].value : null;
  const direction = computeDirection(series);
  return { key, label, unit, series, latest, direction };
}

/**
 * Simple direction classifier: compare mean of first half vs second
 * half of the series. 10%+ improvement = up; 10%+ degradation = down.
 * Returns "flat" for near-stable or too-little-data.
 */
function computeDirection(series: TrendPoint[]): TrendSeries["direction"] {
  const values = series.map((p) => p.value).filter((v): v is number => v != null);
  if (values.length < 4) return "unknown";
  const mid = Math.floor(values.length / 2);
  const firstHalf = values.slice(0, mid);
  const secondHalf = values.slice(mid);
  const firstAvg = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;
  if (firstAvg === 0) return "flat";
  const ratio = secondAvg / firstAvg;
  if (ratio > 1.1) return "up";
  if (ratio < 0.9) return "down";
  return "flat";
}

function buildVerdict(series: {
  avgOutcomeScore: TrendSeries;
  founderOverrideRate: TrendSeries;
  autoResolvedRatio: TrendSeries;
  calibrationBrier: TrendSeries;
}): string {
  const signals: string[] = [];
  if (series.avgOutcomeScore.direction === "up")
    signals.push("outcomes trending up");
  if (series.avgOutcomeScore.direction === "down")
    signals.push("outcomes trending down");
  if (series.founderOverrideRate.direction === "down")
    signals.push("override rate falling");
  if (series.founderOverrideRate.direction === "up")
    signals.push("override rate climbing");
  if (series.autoResolvedRatio.direction === "up")
    signals.push("auto-resolution ratio rising");
  // Brier: lower is better, so "down" is good
  if (series.calibrationBrier.direction === "down")
    signals.push("calibration improving");
  if (series.calibrationBrier.direction === "up")
    signals.push("calibration degrading");

  if (signals.length === 0)
    return "System is steady. Not enough signal in the window to declare improvement or regression.";
  return `Over the window: ${signals.join(", ")}.`;
}

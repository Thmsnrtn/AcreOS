/**
 * Pillar F / F3 — Personality drift weekly sampler.
 *
 * Each week, samples N recent Pax replies and scores them on three
 * persona axes (brand voice, conciseness, helpfulness). Computes a
 * rolling baseline + alerts the founder feed if the mean score on
 * any axis drops more than 10% week-over-week.
 *
 * The scoring is deterministic v0 (regex / length / keyword), not
 * LLM-as-judge — keeps cost flat and ensures the alert never lies
 * because the judge model drifted. A future iteration can layer
 * Claude-as-judge on top once the deterministic baseline is stable.
 */

import { db } from "../db";
import { aiMessages, agentLlmTraces } from "@shared/schema";
import { and, eq, gte, desc, sql } from "drizzle-orm";
import { logger } from "../utils/logger";

const SAMPLE_SIZE = 50;
const ALERT_DELTA_PCT = 0.10; // 10% mean drop triggers an alert

// ─── Deterministic scorers ───────────────────────────────────────────────
//
// Each scorer returns 0..1. Calibrated against the PAX_SYSTEM_PROMPT
// constraints (concise, action-oriented, no hedging-stuffed sentences).

function scoreConciseness(text: string): number {
  // Pax target: under 600 chars for a typical reply. Penalize past that.
  const len = text.length;
  if (len === 0) return 0;
  if (len <= 600) return 1;
  if (len <= 1200) return 0.7;
  if (len <= 2400) return 0.4;
  return 0.2;
}

const HEDGE_TOKENS = [
  "i think",
  "i believe",
  "perhaps",
  "maybe",
  "it seems",
  "kind of",
  "sort of",
  "i'm not sure",
];

function scoreBrandVoice(text: string): number {
  // Penalize hedging tokens; Pax should commit to actions.
  const lower = text.toLowerCase();
  let hedges = 0;
  for (const t of HEDGE_TOKENS) {
    if (lower.includes(t)) hedges++;
  }
  if (hedges === 0) return 1;
  if (hedges <= 2) return 0.7;
  if (hedges <= 4) return 0.4;
  return 0.1;
}

function scoreHelpfulness(text: string): number {
  // Reward replies that propose a next step. Look for action verbs at
  // the start of a sentence.
  const ACTION_VERBS = /(^|[.!?]\s+)(Add|Send|Try|Open|Check|Review|Set|Schedule|Pull|Create|Update|Delete)/g;
  const matches = text.match(ACTION_VERBS) ?? [];
  if (matches.length >= 2) return 1;
  if (matches.length === 1) return 0.7;
  // No action — only meaningful when reply is substantive.
  if (text.length > 200) return 0.4;
  return 0.6;
}

interface SampleScore {
  conciseness: number;
  brandVoice: number;
  helpfulness: number;
  composite: number;
}

function scoreMessage(text: string): SampleScore {
  const conciseness = scoreConciseness(text);
  const brandVoice = scoreBrandVoice(text);
  const helpfulness = scoreHelpfulness(text);
  const composite = (conciseness + brandVoice + helpfulness) / 3;
  return { conciseness, brandVoice, helpfulness, composite };
}

export interface DriftReport {
  weekStartIso: string;
  sampleSize: number;
  current: { conciseness: number; brandVoice: number; helpfulness: number; composite: number };
  prior: { conciseness: number; brandVoice: number; helpfulness: number; composite: number } | null;
  driftPct: { conciseness: number; brandVoice: number; helpfulness: number; composite: number } | null;
  alertFired: boolean;
}

async function sampleAssistantMessages(start: Date, end: Date): Promise<string[]> {
  const rows = await db
    .select({ content: aiMessages.content })
    .from(aiMessages)
    .where(
      and(
        eq(aiMessages.role, "assistant"),
        gte(aiMessages.createdAt, start),
        sql`${aiMessages.createdAt} < ${end}`,
      ),
    )
    .orderBy(desc(aiMessages.createdAt))
    .limit(SAMPLE_SIZE);
  return rows.map((r) => r.content ?? "").filter((s) => s.length > 0);
}

function meanScores(scores: SampleScore[]): SampleScore {
  if (scores.length === 0) {
    return { conciseness: 0, brandVoice: 0, helpfulness: 0, composite: 0 };
  }
  const sum = scores.reduce(
    (acc, s) => ({
      conciseness: acc.conciseness + s.conciseness,
      brandVoice: acc.brandVoice + s.brandVoice,
      helpfulness: acc.helpfulness + s.helpfulness,
      composite: acc.composite + s.composite,
    }),
    { conciseness: 0, brandVoice: 0, helpfulness: 0, composite: 0 },
  );
  const n = scores.length;
  return {
    conciseness: sum.conciseness / n,
    brandVoice: sum.brandVoice / n,
    helpfulness: sum.helpfulness / n,
    composite: sum.composite / n,
  };
}

export async function runPersonalityDriftSampler(): Promise<DriftReport> {
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const [currentTexts, priorTexts] = await Promise.all([
    sampleAssistantMessages(oneWeekAgo, now),
    sampleAssistantMessages(twoWeeksAgo, oneWeekAgo),
  ]);
  const currentScores = currentTexts.map(scoreMessage);
  const priorScores = priorTexts.map(scoreMessage);

  const current = meanScores(currentScores);
  const prior = priorScores.length > 0 ? meanScores(priorScores) : null;

  let driftPct: DriftReport["driftPct"] = null;
  let alertFired = false;
  if (prior) {
    const pct = (curr: number, p: number) => (p > 0 ? (curr - p) / p : 0);
    driftPct = {
      conciseness: pct(current.conciseness, prior.conciseness),
      brandVoice: pct(current.brandVoice, prior.brandVoice),
      helpfulness: pct(current.helpfulness, prior.helpfulness),
      composite: pct(current.composite, prior.composite),
    };
    if (
      driftPct.conciseness < -ALERT_DELTA_PCT ||
      driftPct.brandVoice < -ALERT_DELTA_PCT ||
      driftPct.helpfulness < -ALERT_DELTA_PCT ||
      driftPct.composite < -ALERT_DELTA_PCT
    ) {
      alertFired = true;
    }
  }

  const report: DriftReport = {
    weekStartIso: oneWeekAgo.toISOString(),
    sampleSize: currentScores.length,
    current,
    prior,
    driftPct,
    alertFired,
  };

  if (alertFired) {
    try {
      const { notifyFounder } = await import("./rosyRiver");
      await notifyFounder({
        source: "telemetry_drift",
        pillar: "C_agentic",
        agentCodename: "personality_drift_sampler",
        severity: "warning",
        title: `Pax personality drift detected — composite ${(report.current.composite * 100).toFixed(0)} (Δ ${((driftPct?.composite ?? 0) * 100).toFixed(0)}%)`,
        body:
          `Week-over-week persona scoring shows mean composite drop > ${ALERT_DELTA_PCT * 100}%.\n` +
          `Current week (n=${currentScores.length}): conciseness=${current.conciseness.toFixed(2)} brandVoice=${current.brandVoice.toFixed(2)} helpfulness=${current.helpfulness.toFixed(2)}\n` +
          `Prior week (n=${priorScores.length}):  conciseness=${(prior?.conciseness ?? 0).toFixed(2)} brandVoice=${(prior?.brandVoice ?? 0).toFixed(2)} helpfulness=${(prior?.helpfulness ?? 0).toFixed(2)}`,
        metadata: { report: report as unknown as Record<string, unknown> },
      });
    } catch (err) {
      logger.warn("[drift-sampler] notifyFounder failed", err as Error);
    }
  }

  logger.info("[drift-sampler] complete", {
    source: "drift-sampler",
    metadata: {
      sampleSize: currentScores.length,
      compositeCurrent: Number(current.composite.toFixed(3)),
      compositePrior: prior ? Number(prior.composite.toFixed(3)) : null,
      alertFired,
    },
  });

  // Acknowledge unused import (kept for cost-context lookup in a future
  // iteration that joins drift to spend).
  void agentLlmTraces;

  return report;
}

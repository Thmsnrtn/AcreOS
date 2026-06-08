// ============================================================================
// server/services/andrei/aiQualityAudit.ts
// ----------------------------------------------------------------------------
// ANDREI (2026-06-08) — Pax quality-drift detectors → domain_audit_findings.
//
// Andrei's charter (docs/internal/roadmap/_elevation/andrei.md #3) calls for a
// continuous quality-drift audit so a detector fires to Solene BEFORE a
// customer notices Pax getting worse. This file implements that as
// `DomainDetector`s (domain "ai") on the SHARED audit substrate
// (server/services/audit/domainAudit.ts) — they write to the existing
// `domain_audit_findings` table via the runner's recordFinding, exactly like
// Lena's taxReserveDetector and Iyari's observationRateDetector. No new table.
//
// Detectors implemented (priority order from the charter):
//
//   #2 hallucination-flag-rate spike (FIRST — the load-bearing one)
//      Reads the `__hallucinationWarnings` the live Pax loop persists on
//      assistant messages (executive.ts: aiMessages.toolCalls carries a
//      `{ __hallucinationWarnings: [...] }` sentinel when the guard fired).
//      Computes the flagged-rate over a recent window vs. a 7-day rolling
//      baseline; fires when the recent rate deviates upward by >50%.
//
//   #1 eval-pass-rate regression
//      Reads `ai_test_runs` (written by aiEvalHarness). Compares the recent
//      pass-rate to the prior baseline window for the same modelKey; fires on
//      a >2pp drop (the charter threshold).
//
//   #cost cost-per-interaction creep
//      Reads `ai_test_runs.cost_cents`. Compares recent mean cost-per-run to
//      the baseline window; fires on a >10% increase.
//
// All detectors are READ-ONLY (the runner does the writing) and ISOLATED — one
// throwing never breaks the others (runDomainAudits guarantees this). Each
// emits ONE finding with a fixed dedupe_key so re-runs update rather than
// duplicate, and the finding ages out to 'stale' once the condition clears.
//
// FAIL-QUIET ON NO DATA: a fresh / pre-first-customer cluster with no Pax
// traffic and no eval runs is honestly green, not broken — every detector
// returns [] when there's insufficient history to compare against.
// ============================================================================

import { and, gte, lt, sql, eq, isNotNull } from "drizzle-orm";

import { db } from "../../db";
import { aiMessages, aiTestRuns } from "@shared/schema";
import type { DomainDetector, FindingInput } from "../audit/domainAudit";

const DAY_MS = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Detector #2 — hallucination-flag-rate spike (the load-bearing detector)
// -----------------------------------------------------------------------------
// The live Pax loop persists hallucination-guard warnings onto the assistant
// message's `tool_calls` jsonb as a sentinel array element:
//   [{ "__hallucinationWarnings": [ { kind, severity, detail }, ... ] }]
// (see server/ai/executive.ts createMessage call). When the guard stays quiet
// AND there were no tool calls, tool_calls is null; when the guard fired, the
// sentinel is present. We therefore measure:
//   flaggedRate = (# assistant msgs whose tool_calls contains the sentinel)
//                 / (# assistant msgs in the window)
// over a RECENT window and a longer ROLLING BASELINE, and fire when the recent
// rate exceeds the baseline by >RATE_SPIKE_PCT.

/** Recent window for the "is it spiking now" measurement. */
const HALLUC_RECENT_WINDOW_MS = DAY_MS; // last 24h
/** Rolling baseline the recent window is compared against. */
const HALLUC_BASELINE_WINDOW_DAYS = 7;
/** Fire when recent rate exceeds baseline by more than this fraction. */
const HALLUC_RATE_SPIKE_PCT = 0.5; // >50% deviation
/** Don't fire on tiny samples — noise. Need at least this many recent msgs. */
const HALLUC_MIN_RECENT_SAMPLE = 20;
/** Baseline must have at least this many msgs to be a meaningful comparator. */
const HALLUC_MIN_BASELINE_SAMPLE = 50;
/** Critical when the recent rate alone is this high regardless of baseline. */
const HALLUC_CRITICAL_ABS_RATE = 0.15; // 15% of replies flagged is a loud signal

/**
 * The jsonb predicate matching an assistant message whose persisted
 * `tool_calls` array carries the `__hallucinationWarnings` sentinel. Postgres
 * `@>` containment with `[{}]` checks "array contains an object with this key".
 * We can't match an arbitrary value, so we use the path-exists operator on the
 * array's elements via `jsonb_path_exists`.
 */
const HALLUC_SENTINEL_PREDICATE = sql`jsonb_path_exists(${aiMessages.toolCalls}, '$[*].__hallucinationWarnings')`;

interface RateWindow {
  total: number;
  flagged: number;
}

async function measureHallucinationWindow(since: Date, before?: Date): Promise<RateWindow> {
  const conditions = [eq(aiMessages.role, "assistant"), gte(aiMessages.createdAt, since)];
  if (before) conditions.push(lt(aiMessages.createdAt, before));
  const [row] = await db
    .select({
      total: sql<number>`COUNT(*)`.mapWith(Number),
      flagged: sql<number>`COUNT(*) FILTER (WHERE ${HALLUC_SENTINEL_PREDICATE})`.mapWith(Number),
    })
    .from(aiMessages)
    .where(and(...conditions));
  return { total: row?.total ?? 0, flagged: row?.flagged ?? 0 };
}

export const hallucinationSpikeDetector: DomainDetector = {
  id: "pax_hallucination_rate",
  domain: "ai",
  async run(): Promise<FindingInput[]> {
    const now = Date.now();
    const recentStart = new Date(now - HALLUC_RECENT_WINDOW_MS);
    const baselineStart = new Date(now - (HALLUC_BASELINE_WINDOW_DAYS + 1) * DAY_MS);

    const [recent, baseline] = await Promise.all([
      measureHallucinationWindow(recentStart),
      // Baseline = the 7 days ENDING where the recent window begins (no overlap).
      measureHallucinationWindow(baselineStart, recentStart),
    ]);

    // Not enough traffic to judge → green (a quiet cluster isn't a broken one).
    if (recent.total < HALLUC_MIN_RECENT_SAMPLE) return [];
    if (baseline.total < HALLUC_MIN_BASELINE_SAMPLE) return [];

    const recentRate = recent.flagged / recent.total;
    const baselineRate = baseline.flagged / baseline.total;

    // Spike = recent materially above baseline. Guard the divide-by-zero: if
    // baseline was a clean 0% and recent is now non-trivially above the
    // critical absolute floor, that's itself a spike worth surfacing.
    const deviation =
      baselineRate > 0 ? (recentRate - baselineRate) / baselineRate : recentRate > 0 ? Infinity : 0;
    const spiking = deviation > HALLUC_RATE_SPIKE_PCT && recentRate > baselineRate;
    const absHigh = recentRate >= HALLUC_CRITICAL_ABS_RATE;

    if (!spiking && !absHigh) return [];

    // Critical when the absolute rate is loud, OR a finite deviation ≥100%
    // (a doubling). An INFINITE deviation (clean 0% baseline) is NOT auto-
    // critical — a 0→3% drift is real but not yet alarming; only the absolute
    // floor escalates it. This keeps "critical" reserved for genuinely loud
    // signals rather than any first flag after a quiet week.
    const isCritical = absHigh || (Number.isFinite(deviation) && deviation >= 1.0);
    const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
    const devText = Number.isFinite(deviation) ? `${(deviation * 100).toFixed(0)}%` : "from a 0% baseline";

    return [
      {
        domain: "ai",
        detector: "pax_hallucination_rate",
        severity: isCritical ? "critical" : "warn",
        title: `Pax hallucination-flag rate spiked to ${pct(recentRate)}`,
        detail:
          `${recent.flagged}/${recent.total} assistant replies in the last 24h tripped the ` +
          `hallucination guard (${pct(recentRate)}), vs a 7-day baseline of ${pct(baselineRate)} ` +
          `(${baseline.flagged}/${baseline.total}). That's a ${devText} deviation. A rising ` +
          `flag-rate means more replies are stating numbers/parcel facts the guard can't ground — ` +
          `the leading indicator of Pax drifting toward confident-wrong answers before a customer notices.`,
        citedReason:
          "Andrei charter detector #2 — the hallucination guard's per-turn warnings " +
          "(__hallucinationWarnings persisted on assistant messages) are the only live " +
          "signal of Pax's real grounding failure rate; a >50% spike over the rolling " +
          "baseline must surface for review.",
        dedupeKey: "pax_hallucination_rate:spike",
        metadata: {
          recentTotal: recent.total,
          recentFlagged: recent.flagged,
          recentRate,
          baselineTotal: baseline.total,
          baselineFlagged: baseline.flagged,
          baselineRate,
          deviation: Number.isFinite(deviation) ? deviation : null,
          spikeThreshold: HALLUC_RATE_SPIKE_PCT,
          criticalAbsRate: HALLUC_CRITICAL_ABS_RATE,
        },
      },
    ];
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Detector #1 — eval-pass-rate regression
// -----------------------------------------------------------------------------
// ai_test_runs is the pass/fail ledger the eval harness writes. A drop in the
// pass-rate for the current default model — week over week — means a prompt
// edit, a model swap, or upstream drift made Pax fail cases it used to pass.
// We compare the most-recent eval window to a prior baseline window for the
// SAME modelKey (comparing different models would be apples-to-oranges) and
// fire on a >EVAL_REGRESSION_PP drop.

const EVAL_RECENT_WINDOW_DAYS = 2;
const EVAL_BASELINE_WINDOW_DAYS = 7;
const EVAL_REGRESSION_PP = 0.02; // 2 percentage points (charter threshold)
const EVAL_MIN_RUNS = 10; // need a meaningful sample on both sides

interface PassWindow {
  total: number;
  passed: number;
}

async function measureEvalWindow(modelKey: string, since: Date, before?: Date): Promise<PassWindow> {
  const conditions = [eq(aiTestRuns.modelKey, modelKey), gte(aiTestRuns.runAt, since)];
  if (before) conditions.push(lt(aiTestRuns.runAt, before));
  const [row] = await db
    .select({
      total: sql<number>`COUNT(*)`.mapWith(Number),
      passed: sql<number>`COUNT(*) FILTER (WHERE ${aiTestRuns.passed})`.mapWith(Number),
    })
    .from(aiTestRuns)
    .where(and(...conditions));
  return { total: row?.total ?? 0, passed: row?.passed ?? 0 };
}

export const evalPassRateRegressionDetector: DomainDetector = {
  id: "pax_eval_pass_rate",
  domain: "ai",
  async run(): Promise<FindingInput[]> {
    const now = Date.now();
    const recentStart = new Date(now - EVAL_RECENT_WINDOW_DAYS * DAY_MS);
    const baselineStart = new Date(now - (EVAL_BASELINE_WINDOW_DAYS + EVAL_RECENT_WINDOW_DAYS) * DAY_MS);

    // The model with the most runs in the recent window is the one in service.
    const recentModels = await db
      .select({
        modelKey: aiTestRuns.modelKey,
        n: sql<number>`COUNT(*)`.mapWith(Number),
      })
      .from(aiTestRuns)
      .where(gte(aiTestRuns.runAt, recentStart))
      .groupBy(aiTestRuns.modelKey)
      .orderBy(sql`COUNT(*) DESC`)
      .limit(1);

    const modelKey = recentModels[0]?.modelKey;
    if (!modelKey) return []; // no recent eval activity → nothing to judge

    const [recent, baseline] = await Promise.all([
      measureEvalWindow(modelKey, recentStart),
      measureEvalWindow(modelKey, baselineStart, recentStart),
    ]);

    if (recent.total < EVAL_MIN_RUNS || baseline.total < EVAL_MIN_RUNS) return [];

    const recentRate = recent.passed / recent.total;
    const baselineRate = baseline.passed / baseline.total;
    const drop = baselineRate - recentRate;

    if (drop <= EVAL_REGRESSION_PP) return [];

    // ≥10pp drop, or recent pass-rate fell below 90%, is critical.
    const isCritical = drop >= 0.1 || recentRate < 0.9;
    const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

    return [
      {
        domain: "ai",
        detector: "pax_eval_pass_rate",
        severity: isCritical ? "critical" : "warn",
        title: `Pax eval pass-rate regressed ${(drop * 100).toFixed(1)}pp on ${modelKey}`,
        detail:
          `Eval pass-rate for ${modelKey} fell from ${pct(baselineRate)} ` +
          `(${baseline.passed}/${baseline.total}) over the prior week to ${pct(recentRate)} ` +
          `(${recent.passed}/${recent.total}) in the last ${EVAL_RECENT_WINDOW_DAYS} days — a ` +
          `${(drop * 100).toFixed(1)}pp regression. Something (a prompt edit, a model change, or ` +
          `upstream drift) made Pax fail cases it used to pass.`,
        citedReason:
          "Andrei charter detector #1 — eval pass-rate is the regression net; a >2pp " +
          "week-over-week drop on the in-service model must surface before it reaches a customer.",
        dedupeKey: `pax_eval_pass_rate:regression:${modelKey}`,
        subjectRef: modelKey,
        metadata: {
          modelKey,
          recentTotal: recent.total,
          recentPassed: recent.passed,
          recentRate,
          baselineTotal: baseline.total,
          baselinePassed: baseline.passed,
          baselineRate,
          dropPp: drop,
          regressionThresholdPp: EVAL_REGRESSION_PP,
        },
      },
    ];
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Detector — cost-per-interaction creep
// -----------------------------------------------------------------------------
// ai_test_runs.cost_cents lets us track the mean cost per eval interaction.
// A creeping mean (a more expensive model silently in the rotation, or longer
// outputs) is a cost-of-goods regression worth a heads-up. Fire on a >10%
// increase recent-vs-baseline for the in-service model.

const COST_RECENT_WINDOW_DAYS = 7;
const COST_BASELINE_WINDOW_DAYS = 30;
const COST_CREEP_PCT = 0.1; // >10% month-over-month
const COST_MIN_RUNS = 20;

interface CostWindow {
  n: number;
  meanCents: number;
}

async function measureCostWindow(modelKey: string, since: Date, before?: Date): Promise<CostWindow> {
  const conditions = [
    eq(aiTestRuns.modelKey, modelKey),
    gte(aiTestRuns.runAt, since),
    isNotNull(aiTestRuns.costCents),
  ];
  if (before) conditions.push(lt(aiTestRuns.runAt, before));
  const [row] = await db
    .select({
      n: sql<number>`COUNT(*)`.mapWith(Number),
      meanCents: sql<number>`COALESCE(AVG(${aiTestRuns.costCents}), 0)`.mapWith(Number),
    })
    .from(aiTestRuns)
    .where(and(...conditions));
  return { n: row?.n ?? 0, meanCents: row?.meanCents ?? 0 };
}

export const costPerInteractionCreepDetector: DomainDetector = {
  id: "pax_cost_per_interaction",
  domain: "ai",
  async run(): Promise<FindingInput[]> {
    const now = Date.now();
    const recentStart = new Date(now - COST_RECENT_WINDOW_DAYS * DAY_MS);
    const baselineStart = new Date(now - (COST_BASELINE_WINDOW_DAYS + COST_RECENT_WINDOW_DAYS) * DAY_MS);

    const recentModels = await db
      .select({
        modelKey: aiTestRuns.modelKey,
        n: sql<number>`COUNT(*)`.mapWith(Number),
      })
      .from(aiTestRuns)
      .where(and(gte(aiTestRuns.runAt, recentStart), isNotNull(aiTestRuns.costCents)))
      .groupBy(aiTestRuns.modelKey)
      .orderBy(sql`COUNT(*) DESC`)
      .limit(1);

    const modelKey = recentModels[0]?.modelKey;
    if (!modelKey) return [];

    const [recent, baseline] = await Promise.all([
      measureCostWindow(modelKey, recentStart),
      measureCostWindow(modelKey, baselineStart, recentStart),
    ]);

    if (recent.n < COST_MIN_RUNS || baseline.n < COST_MIN_RUNS) return [];
    if (baseline.meanCents <= 0) return []; // no baseline cost to compare against

    const increase = (recent.meanCents - baseline.meanCents) / baseline.meanCents;
    if (increase <= COST_CREEP_PCT) return [];

    const isCritical = increase >= 0.5; // ≥50% jump in unit cost is loud
    const fmt = (c: number) => `${c.toFixed(3)}¢`;

    return [
      {
        domain: "ai",
        detector: "pax_cost_per_interaction",
        severity: isCritical ? "critical" : "warn",
        title: `Pax cost-per-interaction crept up ${(increase * 100).toFixed(0)}% on ${modelKey}`,
        detail:
          `Mean cost per eval interaction for ${modelKey} rose from ${fmt(baseline.meanCents)} ` +
          `(${baseline.n} runs) to ${fmt(recent.meanCents)} (${recent.n} runs) — a ` +
          `${(increase * 100).toFixed(0)}% increase. A creeping unit cost means a more expensive ` +
          `model in the rotation or longer outputs eroding margin.`,
        citedReason:
          "Andrei charter — cost-per-interaction creep >10% m/m is a cost-of-goods regression " +
          "that should surface before it shows up in the monthly bill.",
        dedupeKey: `pax_cost_per_interaction:creep:${modelKey}`,
        subjectRef: modelKey,
        metadata: {
          modelKey,
          recentRuns: recent.n,
          recentMeanCents: recent.meanCents,
          baselineRuns: baseline.n,
          baselineMeanCents: baseline.meanCents,
          increasePct: increase,
          creepThresholdPct: COST_CREEP_PCT,
        },
      },
    ];
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// The detector roster — registered by the daily audit job in runScheduledJobs.
// Ordered with the load-bearing hallucination-rate detector first.
// ─────────────────────────────────────────────────────────────────────────────
export const aiQualityDetectors: DomainDetector[] = [
  hallucinationSpikeDetector,
  evalPassRateRegressionDetector,
  costPerInteractionCreepDetector,
];

/**
 * SLO computation — the shared math behind both the pull-only error-budget
 * endpoint (`routes-error-budget.ts`) and the push-based burn-rate alerting
 * worker job (`runScheduledJobs.ts` → `burnRateMonitor`).
 *
 * ## Why this file exists
 *
 * The three `*Slo()` functions used to live inline in `routes-error-budget.ts`,
 * which is *pull-only*: it computes month-to-date consumption only when the
 * founder opens the page. SRE practice is *multi-window burn-rate alerting* —
 * a fast-burn (2% of the monthly budget in 1h) pages immediately; a slow-burn
 * (10% in 6h) warns. To do that, the same SLO math has to run against a rolling
 * window on a schedule, not just month-to-date on request.
 *
 * Extracting the math here gives ONE definition of "what is an SLO breach" that
 * both surfaces share, plus a `*BurnRate()` variant that accepts an arbitrary
 * rolling window so the burn-rate job can ask "how much budget did we burn in
 * the last hour / last six hours."
 *
 * ## SLO targets (from docs/slo-monitoring.md)
 *   - AI request success rate ≥ 99.9% (error budget = 0.1% / month)
 *   - Background job success rate ≥ 99% (error budget = 1.0% / month)
 *   - Zero SEV-1 incidents per month (any SEV-1 = budget exhausted)
 *
 * ## Burn-rate model
 *
 * For a request-based SLO, the "allowed failure fraction" is `1 - target`
 * (e.g. 0.001 for the AI SLO). Over a window, the observed failure fraction is
 * `failed / total`. The classic *burn rate* is
 * `observedFailureFraction / allowedFraction` — a burn rate of 1.0 means
 * "burning budget at exactly the rate that would exhaust the monthly budget
 * over a month."
 *
 * We express the alert thresholds the way the elevation brief framed them — as
 * "% of the monthly budget consumed within a window." We project the window's
 * traffic rate onto a 30-day month to get the monthly allowance, then express
 * the window's ACTUAL failures as a percentage of that monthly allowance:
 *   - fast:  ≥ 2% of the monthly error budget burned in 1h   → page (P0/P1)
 *   - slow:  ≥ 10% of the monthly error budget burned in 6h  → warn (finding)
 *
 * ## Honest-data note (Tess lens #6)
 *
 * Every count here is read from the DURABLE Postgres tables — `aiTelemetryEvents`,
 * `jobHealthLogs`, `incidents` — NOT from the in-memory prom-client counters in
 * `server/metrics.ts`. Those prom counters reset to zero on every Fly
 * suspend/resume (the `min_machines_running=0` topology), so a burn-rate alert
 * built on them would be amnesiac across exactly the idle windows we designed
 * for. Anything a human is paged on must come from a survives-a-restart source;
 * that is why these queries hit the DB, not the registry. If you ever surface a
 * raw prom counter to a founder, label it "since process start (resets on idle)".
 */

import { db } from "../../db";
import { aiTelemetryEvents } from "@shared/schema";
import { jobHealthLogs, incidents } from "@shared/schema";
import { and, gte, sql } from "drizzle-orm";

// 30-day month, in milliseconds — the denominator the monthly error budget is
// projected against. Kept explicit (not "this calendar month") so window math
// is stable regardless of which day of the month the job runs.
export const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

export interface SloResult {
  sloId: string;
  target: number; // 0..1 (e.g. 0.999)
  current: number; // 0..1
  totalEvents: number;
  failedEvents: number;
  budgetConsumedPct: number; // 0..100; >100 means SLO broken
  remainingBudgetEvents: number;
  status: "ok" | "warning" | "critical";
}

/**
 * A burn-rate reading over a rolling window. `monthlyBudgetBurnedPct` is the
 * headline number the multi-window alert thresholds compare against: "what
 * fraction of the WHOLE monthly error budget did this window's failures consume,
 * if this window's traffic rate held for the whole month."
 */
export interface BurnRateWindow {
  sloId: string;
  windowMs: number;
  windowLabel: string; // "1h" | "6h" — human label for logs/alerts
  target: number;
  totalEvents: number;
  failedEvents: number;
  /** Observed failure fraction in the window (failed/total), 0..1. */
  observedFailureFraction: number;
  /** Allowed failure fraction for this SLO (1 - target), 0..1. */
  allowedFailureFraction: number;
  /**
   * Classic burn rate: observed / allowed. 1.0 = exhaust-monthly-budget-in-a-
   * month pace; >1 burns faster. Null when there is no traffic in the window.
   */
  burnRate: number | null;
  /**
   * % of the *monthly* error budget this window consumed, projecting this
   * window's traffic rate onto a 30-day month. This is what fast/slow
   * thresholds compare against. 0..(unbounded; Infinity if failures with a
   * zero-allowance projection).
   */
  monthlyBudgetBurnedPct: number;
}

export function classify(consumedPct: number): SloResult["status"] {
  if (consumedPct >= 100) return "critical";
  if (consumedPct >= 80) return "warning";
  return "ok";
}

export function monthStart(): Date {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// ── Month-to-date SLOs (powering the error-budget endpoint) ──────────────────

export async function aiSuccessSlo(since: Date = monthStart()): Promise<SloResult> {
  const target = 0.999;
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      failed: sql<number>`sum(case when ${aiTelemetryEvents.success} = false then 1 else 0 end)::int`,
    })
    .from(aiTelemetryEvents)
    .where(gte(aiTelemetryEvents.createdAt, since));

  const total = Number(row?.total ?? 0);
  const failed = Number(row?.failed ?? 0);
  return buildRequestSlo("ai_request_success", target, total, failed);
}

export async function jobSuccessSlo(since: Date = monthStart()): Promise<SloResult> {
  const target = 0.99;
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      failed: sql<number>`sum(case when ${jobHealthLogs.status} = 'failed' then 1 else 0 end)::int`,
    })
    .from(jobHealthLogs)
    .where(gte(jobHealthLogs.runStartedAt, since));

  const total = Number(row?.total ?? 0);
  const failed = Number(row?.failed ?? 0);
  return buildRequestSlo("background_job_success", target, total, failed);
}

export async function sev1IncidentSlo(since: Date = monthStart()): Promise<SloResult> {
  const target = 1.0; // zero SEV-1 incidents allowed
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(incidents)
    .where(
      and(
        gte(incidents.startedAt, since),
        sql`${incidents.severity} = 'SEV-1'`,
      ),
    );

  const sev1Count = Number(row?.count ?? 0);
  const budgetConsumedPct = sev1Count > 0 ? 100 : 0; // single SEV-1 = exhausted

  return {
    sloId: "zero_sev1_per_month",
    target,
    current: sev1Count === 0 ? 1 : 0,
    totalEvents: sev1Count,
    failedEvents: sev1Count,
    budgetConsumedPct,
    remainingBudgetEvents: sev1Count === 0 ? 1 : 0,
    status: sev1Count > 0 ? "critical" : "ok",
  };
}

/** Shared shape-builder for the two request-based SLOs. Pure (testable). */
export function buildRequestSlo(
  sloId: string,
  target: number,
  total: number,
  failed: number,
): SloResult {
  const current = total > 0 ? 1 - failed / total : 1;
  const budgetEvents = Math.floor(total * (1 - target)); // events we may fail this month
  const consumedPct =
    budgetEvents > 0 ? (failed / budgetEvents) * 100 : failed > 0 ? 100 : 0;
  const remainingBudgetEvents = Math.max(0, budgetEvents - failed);

  return {
    sloId,
    target,
    current,
    totalEvents: total,
    failedEvents: failed,
    budgetConsumedPct: Math.round(consumedPct * 10) / 10,
    remainingBudgetEvents,
    status: classify(consumedPct),
  };
}

// ── Rolling-window burn rate (powering the alerting job) ─────────────────────

/**
 * Pure burn-rate math for a request-based SLO over a window. Exported separately
 * from the DB queries so the window arithmetic is unit-testable without a
 * database (see sloCompute.burnRate.test.ts).
 */
export function computeBurnRateWindow(args: {
  sloId: string;
  target: number;
  windowMs: number;
  windowLabel: string;
  total: number;
  failed: number;
}): BurnRateWindow {
  const { sloId, target, windowMs, windowLabel, total, failed } = args;
  const allowedFailureFraction = 1 - target;
  const observedFailureFraction = total > 0 ? failed / total : 0;
  const burnRate =
    total > 0 && allowedFailureFraction > 0
      ? observedFailureFraction / allowedFailureFraction
      : null;

  // % of the MONTHLY budget burned by THIS window's actual failures. We project
  // the window's traffic rate onto a 30-day month to size the monthly allowance,
  // then compare the window's actual failures to it:
  //   monthlyEquivalentTotal = total × (MONTH_MS / windowMs)
  //   monthlyAllowedFailures = monthlyEquivalentTotal × allowedFraction
  //   burnedPct = failed / monthlyAllowedFailures × 100
  const scale = windowMs > 0 ? MONTH_MS / windowMs : 0;
  const monthlyEquivalentTotal = total * scale;
  const monthlyAllowedFailures = monthlyEquivalentTotal * allowedFailureFraction;
  const monthlyBudgetBurnedPctRaw =
    monthlyAllowedFailures > 0
      ? (failed / monthlyAllowedFailures) * 100
      : failed > 0
        ? Infinity
        : 0;

  return {
    sloId,
    windowMs,
    windowLabel,
    target,
    totalEvents: total,
    failedEvents: failed,
    observedFailureFraction,
    allowedFailureFraction,
    burnRate,
    monthlyBudgetBurnedPct:
      monthlyBudgetBurnedPctRaw === Infinity
        ? Infinity
        : Math.round(monthlyBudgetBurnedPctRaw * 10) / 10,
  };
}

/** AI-success burn rate over a rolling window ending now. */
export async function aiSuccessBurnRate(
  windowMs: number,
  windowLabel: string,
): Promise<BurnRateWindow> {
  const since = new Date(Date.now() - windowMs);
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      failed: sql<number>`sum(case when ${aiTelemetryEvents.success} = false then 1 else 0 end)::int`,
    })
    .from(aiTelemetryEvents)
    .where(gte(aiTelemetryEvents.createdAt, since));

  return computeBurnRateWindow({
    sloId: "ai_request_success",
    target: 0.999,
    windowMs,
    windowLabel,
    total: Number(row?.total ?? 0),
    failed: Number(row?.failed ?? 0),
  });
}

/** Background-job-success burn rate over a rolling window ending now. */
export async function jobSuccessBurnRate(
  windowMs: number,
  windowLabel: string,
): Promise<BurnRateWindow> {
  const since = new Date(Date.now() - windowMs);
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      failed: sql<number>`sum(case when ${jobHealthLogs.status} = 'failed' then 1 else 0 end)::int`,
    })
    .from(jobHealthLogs)
    .where(gte(jobHealthLogs.runStartedAt, since));

  return computeBurnRateWindow({
    sloId: "background_job_success",
    target: 0.99,
    windowMs,
    windowLabel,
    total: Number(row?.total ?? 0),
    failed: Number(row?.failed ?? 0),
  });
}

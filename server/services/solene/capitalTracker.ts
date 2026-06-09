/**
 * SOLENE — capital tracker.
 *
 * Per-session + per-day token consumption + agent dispatch cost +
 * cumulative Anthropic spend. Surfaces in the daily pulse so the
 * bootstrap envelope ($50/mo per charter, override via
 * SOLENE_MONTHLY_ENVELOPE_USD) is a number Solene reasons against, not
 * a vibe.
 *
 * Three entrypoints:
 *
 *   recordCapitalEvent(type, costUsd, contextSummary, sessionToken?)
 *     Fire-and-forget INSERT. Never throws. Always returns void; callers
 *     do not block on this.
 *
 *   getSpendSummary(windowHours)
 *     Returns { totalUsd, byType, eventCount } for the rolling window.
 *
 *   getMonthlyEnvelopeStatus()
 *     Returns envelope + month-to-date + projection + status (green |
 *     amber | red). Amber at 70%, red at 90%.
 */

import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  soleneCapitalEvents,
  DEFAULT_MONTHLY_ENVELOPE_USD,
  ENVELOPE_THRESHOLDS,
  type SoleneCapitalEventType,
  type EnvelopeStatus,
} from "@shared/schema/solene-capital";
import { logger } from "../../utils/logger";

const CONTEXT_SUMMARY_MAX = 500;

// ============================================================================
// recordCapitalEvent — fire-and-forget.
// ============================================================================

export async function recordCapitalEvent(
  type: SoleneCapitalEventType,
  costUsd: number,
  contextSummary: string,
  sessionToken?: string,
): Promise<void> {
  try {
    if (!Number.isFinite(costUsd) || costUsd < 0) {
      logger.warn(
        `[capitalTracker] invalid costUsd=${costUsd} for type=${type}; skipping`,
      );
      return;
    }
    await db.insert(soleneCapitalEvents).values({
      eventType: type,
      costUsd: costUsd.toFixed(4),
      contextSummary: truncate(contextSummary, CONTEXT_SUMMARY_MAX),
      sessionToken: sessionToken ?? null,
    });
  } catch (err) {
    logger.warn(
      "[capitalTracker] recordCapitalEvent swallow",
      err instanceof Error ? err : undefined,
    );
  }
}

// ============================================================================
// getSpendSummary
// ============================================================================

export interface SpendSummary {
  totalUsd: number;
  byType: Partial<Record<SoleneCapitalEventType, number>>;
  eventCount: number;
}

export async function getSpendSummary(
  windowHours: number,
): Promise<SpendSummary> {
  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  try {
    const rows = await db
      .select({
        eventType: soleneCapitalEvents.eventType,
        sum: sql<string>`COALESCE(SUM(${soleneCapitalEvents.costUsd}), 0)`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(soleneCapitalEvents)
      .where(gte(soleneCapitalEvents.occurredAt, cutoff))
      .groupBy(soleneCapitalEvents.eventType);

    const byType: Partial<Record<SoleneCapitalEventType, number>> = {};
    let totalUsd = 0;
    let eventCount = 0;
    for (const row of rows) {
      const v = Number(row.sum);
      byType[row.eventType as SoleneCapitalEventType] = v;
      totalUsd += v;
      eventCount += Number(row.count);
    }
    return { totalUsd, byType, eventCount };
  } catch (err) {
    logger.warn(
      "[capitalTracker] getSpendSummary failed; returning zero",
      err instanceof Error ? err : undefined,
    );
    return { totalUsd: 0, byType: {}, eventCount: 0 };
  }
}

// ============================================================================
// getMonthlyEnvelopeStatus
// ============================================================================

export interface MonthlyEnvelopeStatus {
  envelopeUsd: number;
  monthToDateUsd: number;
  percentUsed: number; // 0-100
  daysIntoMonth: number;
  projectedMonthlyUsd: number;
  status: EnvelopeStatus;
}

export async function getMonthlyEnvelopeStatus(): Promise<MonthlyEnvelopeStatus> {
  const envelopeUsd = parseEnvelopeEnv();
  const now = new Date();
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
  );
  const daysIntoMonth = Math.max(
    1,
    Math.floor((now.getTime() - monthStart.getTime()) / (24 * 60 * 60 * 1000)) + 1,
  );
  const daysInMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
  ).getUTCDate();

  let monthToDateUsd = 0;
  try {
    const [row] = await db
      .select({
        sum: sql<string>`COALESCE(SUM(${soleneCapitalEvents.costUsd}), 0)`,
      })
      .from(soleneCapitalEvents)
      .where(and(gte(soleneCapitalEvents.occurredAt, monthStart)));
    monthToDateUsd = Number(row?.sum ?? 0);
  } catch (err) {
    logger.warn(
      "[capitalTracker] getMonthlyEnvelopeStatus query failed; reporting zero MTD",
      err instanceof Error ? err : undefined,
    );
  }

  const percentUsed = envelopeUsd > 0 ? (monthToDateUsd / envelopeUsd) * 100 : 0;
  const projectedMonthlyUsd =
    daysIntoMonth > 0 ? (monthToDateUsd / daysIntoMonth) * daysInMonth : 0;

  const status: EnvelopeStatus = statusForPercent(percentUsed);

  return {
    envelopeUsd,
    monthToDateUsd: round2(monthToDateUsd),
    percentUsed: round2(percentUsed),
    daysIntoMonth,
    projectedMonthlyUsd: round2(projectedMonthlyUsd),
    status,
  };
}

export function statusForPercent(percentUsed: number): EnvelopeStatus {
  if (percentUsed >= ENVELOPE_THRESHOLDS.redPercent) return "red";
  if (percentUsed >= ENVELOPE_THRESHOLDS.amberPercent) return "amber";
  return "green";
}

function parseEnvelopeEnv(): number {
  const raw = process.env.SOLENE_MONTHLY_ENVELOPE_USD;
  if (!raw) return DEFAULT_MONTHLY_ENVELOPE_USD;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MONTHLY_ENVELOPE_USD;
  return parsed;
}

// ============================================================================
// Pre-dispatch ensemble cap — the ONLY PRE-call bound on agent-dispatch spend.
// ----------------------------------------------------------------------------
// recordCapitalEvent persists agent_dispatch cost AFTER a run; the monthly
// envelope status is observational. This adds the missing enforcement: a hard
// pre-call gate that reads month-to-date `agent_dispatch` spend and THROWS once
// it crosses the RED threshold (default 90% of the envelope). Mirrors how the
// autonomous executor defers inbox items on BudgetExceededError.
//
// Cap source (first wins):
//   ENSEMBLE_MONTHLY_CAP_USD   — explicit ensemble cap
//   SOLENE_MONTHLY_ENVELOPE_USD — the existing $50 charter envelope
//   DEFAULT_MONTHLY_ENVELOPE_USD ($50)
//
// The RED threshold (ENVELOPE_THRESHOLDS.redPercent, default 90%) is the
// binding line so the cap trips with headroom before the envelope is fully
// drained. Founder can bypass a single dispatch via the `founderOverride`
// option threaded from enqueueDispatch.
// ============================================================================

export class EnsembleCapExceededError extends Error {
  readonly code = "ENSEMBLE_MONTHLY_CAP_EXCEEDED" as const;
  constructor(
    public readonly monthToDateUsd: number,
    public readonly redThresholdUsd: number,
    public readonly capUsd: number,
  ) {
    super(
      `Ensemble monthly cap reached: agent_dispatch MTD ` +
        `$${monthToDateUsd.toFixed(2)} ≥ red threshold ` +
        `$${redThresholdUsd.toFixed(2)} (cap $${capUsd.toFixed(2)})`,
    );
    this.name = "EnsembleCapExceededError";
  }
}

/** Resolve the ensemble monthly cap in USD (env-overridable). */
export function getEnsembleMonthlyCapUsd(): number {
  const raw = process.env.ENSEMBLE_MONTHLY_CAP_USD;
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  // Fall back to the existing Solene envelope ($50 charter default).
  return parseEnvelopeEnv();
}

/** Month-to-date spend (UTC month) for a single capital-event type. */
export async function getMonthToDateSpendForType(
  type: SoleneCapitalEventType,
): Promise<number> {
  const now = new Date();
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
  );
  const [row] = await db
    .select({
      sum: sql<string>`COALESCE(SUM(${soleneCapitalEvents.costUsd}), 0)`,
    })
    .from(soleneCapitalEvents)
    .where(
      and(
        eq(soleneCapitalEvents.eventType, type),
        gte(soleneCapitalEvents.occurredAt, monthStart),
      ),
    );
  return Number(row?.sum ?? 0);
}

export interface EnsembleCapStatus {
  monthToDateUsd: number;
  capUsd: number;
  redThresholdUsd: number;
  exceeded: boolean;
}

/**
 * Read the current ensemble (agent_dispatch) cap status.
 *
 * ENFORCE-when-known: the cap THROWS only when we can actually read MTD spend
 * AND it's a finite value at/over the red threshold. When the spend lookup
 * ERRORS (or returns a non-finite value), we LOG LOUDLY and fail OPEN — because
 * halting the *entire* autonomous ensemble on a transient DB read error is a
 * worse failure than a bounded overspend until the next successful read (the
 * enforcement resumes the instant the read recovers, and dispatch results write
 * to the same DB, so a sustained outage degrades the ensemble through other
 * paths anyway). This matches the customer-facing AI gates' fail-open posture.
 */
export async function getEnsembleCapStatus(): Promise<EnsembleCapStatus> {
  const capUsd = getEnsembleMonthlyCapUsd();
  const redThresholdUsd = capUsd * (ENVELOPE_THRESHOLDS.redPercent / 100);
  let monthToDateUsd: number;
  try {
    monthToDateUsd = await getMonthToDateSpendForType("agent_dispatch");
  } catch (err) {
    logger.error(
      "[capitalTracker] ensemble cap MTD lookup failed; failing OPEN (allowing dispatch) — enforcement resumes on read recovery",
      err instanceof Error ? err : undefined,
    );
    return { monthToDateUsd: 0, capUsd, redThresholdUsd, exceeded: false };
  }
  // Guard against a non-finite read (e.g. a malformed SUM) — never let NaN/∞
  // gate dispatches; treat it as "can't tell" → fail open with a loud log.
  if (!Number.isFinite(monthToDateUsd)) {
    logger.error(
      `[capitalTracker] ensemble cap MTD spend was non-finite (${monthToDateUsd}); failing OPEN`,
    );
    return { monthToDateUsd: 0, capUsd, redThresholdUsd, exceeded: false };
  }
  return {
    monthToDateUsd,
    capUsd,
    redThresholdUsd,
    exceeded: monthToDateUsd >= redThresholdUsd,
  };
}

/**
 * Hard pre-dispatch gate. Throws EnsembleCapExceededError when month-to-date
 * agent_dispatch spend has crossed the RED threshold. Call BEFORE enqueuing
 * or running any new agent dispatch.
 *
 * @param opts.founderOverride — explicit per-dispatch bypass (default false).
 *        The DEFAULT (unbounded) path is now bounded.
 */
export async function assertWithinEnsembleCap(opts?: {
  founderOverride?: boolean;
}): Promise<void> {
  if (opts?.founderOverride) {
    logger.info(
      "[capitalTracker] ensemble cap bypassed via founderOverride",
    );
    return;
  }
  const status = await getEnsembleCapStatus();
  if (status.exceeded) {
    throw new EnsembleCapExceededError(
      status.monthToDateUsd,
      status.redThresholdUsd,
      status.capUsd,
    );
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max);
}

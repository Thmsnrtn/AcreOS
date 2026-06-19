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

/**
 * Thrown by the GATE (not the display) when month-to-date spend can't be read.
 * The ensemble dispatch is the single largest cash lever, so its gate fails
 * CLOSED: if we can't prove we're under the cap, we refuse the (fully
 * recoverable, re-queueable) dispatch rather than risk an unbounded overspend.
 * Distinct code so the runner can refuse gracefully + the message is honest
 * (a read failure, not an actual cap breach). (re-audit iteration 2)
 */
export class EnsembleCapReadFailedError extends Error {
  readonly code = "ENSEMBLE_CAP_READ_FAILED" as const;
  constructor(detail: string) {
    super(
      `Ensemble cap could not be verified (MTD spend unreadable: ${detail}); ` +
        `failing CLOSED — refusing dispatch until the read recovers.`,
    );
    this.name = "EnsembleCapReadFailedError";
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
  /**
   * True when MTD spend could not be read (DB error / non-finite). The DISPLAY
   * treats this as "unknown" (shows $0, doesn't break the dashboard); the GATE
   * (assertWithinEnsembleCap) treats it as a hard refusal — fail CLOSED.
   * (re-audit iteration 2)
   */
  readFailed: boolean;
}

/**
 * Read the current ensemble (agent_dispatch) cap status for DISPLAY.
 *
 * Display posture is fail-soft: on a read error it returns `readFailed:true`
 * with a $0 placeholder so the dashboard never crashes. The ENFORCEMENT
 * posture is separate and stricter — `assertWithinEnsembleCap` fails CLOSED on
 * `readFailed`, because the ensemble dispatch is the largest cash lever and a
 * refused dispatch is fully recoverable while an overspend is not. (Previously
 * BOTH the display and the gate failed open, which contradicted the runner's
 * "fails closed on DB error" comment — re-audit iteration 2 fixed that.)
 */
export async function getEnsembleCapStatus(): Promise<EnsembleCapStatus> {
  const capUsd = getEnsembleMonthlyCapUsd();
  const redThresholdUsd = capUsd * (ENVELOPE_THRESHOLDS.redPercent / 100);
  let monthToDateUsd: number;
  try {
    monthToDateUsd = await getMonthToDateSpendForType("agent_dispatch");
  } catch (err) {
    logger.error(
      "[capitalTracker] ensemble cap MTD lookup failed; DISPLAY shows unknown, GATE fails CLOSED",
      err instanceof Error ? err : undefined,
    );
    return { monthToDateUsd: 0, capUsd, redThresholdUsd, exceeded: false, readFailed: true };
  }
  // Guard against a non-finite read (e.g. a malformed SUM) — treat as "can't
  // tell" → readFailed (display soft, gate closed).
  if (!Number.isFinite(monthToDateUsd)) {
    logger.error(
      `[capitalTracker] ensemble cap MTD spend was non-finite (${monthToDateUsd}); DISPLAY unknown, GATE fails CLOSED`,
    );
    return { monthToDateUsd: 0, capUsd, redThresholdUsd, exceeded: false, readFailed: true };
  }
  return {
    monthToDateUsd,
    capUsd,
    redThresholdUsd,
    exceeded: monthToDateUsd >= redThresholdUsd,
    readFailed: false,
  };
}

/**
 * Hard pre-dispatch gate. Throws EnsembleCapExceededError when month-to-date
 * agent_dispatch spend has crossed the RED threshold, OR
 * EnsembleCapReadFailedError when spend can't be read (fail CLOSED). Call
 * BEFORE enqueuing or running any new agent dispatch.
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
  if (status.readFailed) {
    // Largest cash lever + recoverable refusal ⇒ fail CLOSED. The founder can
    // still force a dispatch via founderOverride if the DB is degraded.
    throw new EnsembleCapReadFailedError("MTD spend lookup unavailable");
  }
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

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

import { and, gte, sql } from "drizzle-orm";
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max);
}

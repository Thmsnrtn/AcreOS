/**
 * SOLENE — cognition ROI (Horizon A4: economic self-awareness).
 *
 * The realized-value side of the EV loop: what did the ensemble's cognition
 * COST (real solene_dispatch_results.costUsd), and how much of that spend has
 * a REAL dollar outcome joined back against it (recovered cents credited onto
 * an autopilot_experiences row that carries a dispatch_id)?
 *
 * HONESTY CONTRACT — attribution only through real joins:
 *
 *   COUNTED as value: recovered cents recorded by a consequence webhook
 *     (Stripe amount_paid on a dunning recovery) onto an experience row that
 *     joins to a concrete dispatch via dispatch_id. Nothing else. There is
 *     NO imputation, no per-role "estimated value" in this number — those
 *     estimates live in the scorer and are labeled estimates there.
 *
 *   NOT COUNTED: all spend without such a join. That spend is reported as
 *     UNATTRIBUTED — which means "not yet measurable", never "worthless" and
 *     never "assumed valuable". The Letter line must always show both
 *     numbers side by side.
 *
 * Windows: spend counts by the result row's recorded_at; value counts by the
 * experience row's resolved_at (when the consequence landed). Both use the
 * same trailing window, so a recovery landing after its dispatch's window
 * closes is counted in the LATER window — attributedDispatches can therefore
 * (rarely) exceed totalDispatches; the numbers stay real rather than being
 * massaged into a tidy subset.
 *
 * computeCognitionRoi THROWS on a genuine read failure so callers degrade to
 * an explicit "unmeasured" — never a fabricated zero. rollupCognitionRoi is
 * pure so the arithmetic is pinned by unit tests independent of SQL.
 */

import { and, eq, gte, isNotNull } from "drizzle-orm";
import { db } from "../../db";
import {
  soleneDispatchQueue,
  soleneDispatchResults,
} from "@shared/schema/solene-dispatch";
import { autopilotExperiences } from "@shared/schema";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CognitionRoiSource {
  sourceType: string;
  spentUsd: number;
  attributedValueUsd: number;
}

export interface CognitionRoi {
  windowDays: number;
  /** Real dispatch cost in the window (sum of per-attempt result rows). */
  spentUsd: number;
  /** Recovered cents ÷ 100, only where a real join to a dispatch exists. */
  attributedValueUsd: number;
  /** Distinct dispatches with attributed value in the window. */
  attributedDispatches: number;
  /** Distinct dispatches that recorded cost in the window. */
  totalDispatches: number;
  /** Per-sourceType spend + attributed value, spend-descending. */
  bySourceType: CognitionRoiSource[];
}

/** Row shape for the cost side (dispatch results joined to the queue). */
export interface CognitionCostRow {
  dispatchId: number;
  costUsd: number | string;
  recordedAt: Date | null;
  sourceType: string | null;
}

/** Row shape for the value side (experiences joined to the queue). */
export interface CognitionValueRow {
  dispatchId: number;
  recoveredCents: number;
  resolvedAt: Date | null;
  sourceType: string | null;
}

/**
 * Pure: pull the recovered cents out of an experience row's reasoningTrace
 * jsonb (written by recordConsequenceByTarget). Returns null unless a real,
 * positive, finite cents figure is present — never coerced from garbage.
 */
export function extractRecoveredCents(trace: unknown): number | null {
  if (!trace || typeof trace !== "object" || Array.isArray(trace)) return null;
  const v = Number((trace as Record<string, unknown>).recoveredCents);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Pure rollup — window filtering, cents→USD conversion, per-source split.
 * Exported for unit tests; computeCognitionRoi feeds it the real rows.
 */
export function rollupCognitionRoi(
  costRows: CognitionCostRow[],
  valueRows: CognitionValueRow[],
  windowStart: Date,
  now: Date,
  windowDays: number,
): CognitionRoi {
  const inWindow = (d: Date | null): boolean =>
    d != null &&
    d.getTime() > windowStart.getTime() &&
    d.getTime() <= now.getTime();

  const spendBySource = new Map<string, number>();
  const dispatchesWithCost = new Set<number>();
  let spentUsd = 0;
  for (const r of costRows) {
    if (!inWindow(r.recordedAt)) continue;
    const cost = Number(r.costUsd);
    if (!Number.isFinite(cost) || cost < 0) continue;
    spentUsd += cost;
    dispatchesWithCost.add(r.dispatchId);
    const st = r.sourceType ?? "unknown";
    spendBySource.set(st, (spendBySource.get(st) ?? 0) + cost);
  }

  const valueBySource = new Map<string, number>();
  const dispatchesWithValue = new Set<number>();
  let attributedValueUsd = 0;
  for (const r of valueRows) {
    if (!inWindow(r.resolvedAt)) continue;
    const cents = Number(r.recoveredCents);
    if (!Number.isFinite(cents) || cents <= 0) continue;
    const usd = cents / 100;
    attributedValueUsd += usd;
    dispatchesWithValue.add(r.dispatchId);
    const st = r.sourceType ?? "unknown";
    valueBySource.set(st, (valueBySource.get(st) ?? 0) + usd);
  }

  const sourceTypes = new Set<string>([
    ...spendBySource.keys(),
    ...valueBySource.keys(),
  ]);
  const bySourceType: CognitionRoiSource[] = [...sourceTypes]
    .map((sourceType) => ({
      sourceType,
      spentUsd: round2(spendBySource.get(sourceType) ?? 0),
      attributedValueUsd: round2(valueBySource.get(sourceType) ?? 0),
    }))
    .sort(
      (a, b) =>
        b.spentUsd - a.spentUsd || a.sourceType.localeCompare(b.sourceType),
    );

  return {
    windowDays,
    spentUsd: round2(spentUsd),
    attributedValueUsd: round2(attributedValueUsd),
    attributedDispatches: dispatchesWithValue.size,
    totalDispatches: dispatchesWithCost.size,
    bySourceType,
  };
}

/**
 * The trailing-window cognition ROI: real spend vs. real attributed value.
 * Throws on a genuine read failure (callers render "unmeasured").
 */
export async function computeCognitionRoi(
  days = 30,
  now: Date = new Date(),
): Promise<CognitionRoi> {
  const windowStart = new Date(now.getTime() - days * DAY_MS);

  // Cost side — every per-attempt result row in the window, joined to the
  // queue for the sourceType split. LEFT join: a result whose queue row is
  // somehow gone still counts its spend (as sourceType "unknown") — real
  // dollars never disappear from the ledger.
  const costRows = await db
    .select({
      dispatchId: soleneDispatchResults.dispatchId,
      costUsd: soleneDispatchResults.costUsd,
      recordedAt: soleneDispatchResults.recordedAt,
      sourceType: soleneDispatchQueue.sourceType,
    })
    .from(soleneDispatchResults)
    .leftJoin(
      soleneDispatchQueue,
      eq(soleneDispatchResults.dispatchId, soleneDispatchQueue.id),
    )
    .where(gte(soleneDispatchResults.recordedAt, windowStart));

  // Value side — experience rows that (a) carry a dispatch_id (the REAL join;
  // rows without one are honestly invisible here) and (b) resolved in the
  // window. INNER join to the queue: attribution requires the dispatch to
  // actually exist. Recovered cents are extracted from the trace in process.
  const experienceRows = await db
    .select({
      dispatchId: autopilotExperiences.dispatchId,
      reasoningTrace: autopilotExperiences.reasoningTrace,
      resolvedAt: autopilotExperiences.resolvedAt,
      sourceType: soleneDispatchQueue.sourceType,
    })
    .from(autopilotExperiences)
    .innerJoin(
      soleneDispatchQueue,
      eq(autopilotExperiences.dispatchId, soleneDispatchQueue.id),
    )
    .where(
      and(
        isNotNull(autopilotExperiences.dispatchId),
        gte(autopilotExperiences.resolvedAt, windowStart),
      ),
    );

  const valueRows: CognitionValueRow[] = [];
  for (const r of experienceRows) {
    if (r.dispatchId == null) continue;
    const cents = extractRecoveredCents(r.reasoningTrace);
    if (cents == null) continue;
    valueRows.push({
      dispatchId: r.dispatchId,
      recoveredCents: cents,
      resolvedAt: r.resolvedAt,
      sourceType: r.sourceType,
    });
  }

  return rollupCognitionRoi(
    costRows.map((r) => ({
      dispatchId: r.dispatchId,
      costUsd: r.costUsd,
      recordedAt: r.recordedAt,
      sourceType: r.sourceType,
    })),
    valueRows,
    windowStart,
    now,
    days,
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

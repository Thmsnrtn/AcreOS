// ============================================================================
// server/services/andrei/resolverThresholdAdjustment.ts
// ----------------------------------------------------------------------------
// Tier 2D (elevation blueprint) — close the calibration self-improvement loop.
//
// THE GAP this closes: the daily calibration grader
// (supportResolverCalibration.ts) measured drift on the autonomous support-
// resolve path and raised an alert — but nothing ever CHANGED. Pax kept
// auto-resolving at the same threshold while its own grader said the
// confidence numbers were unreliable.
//
// This module makes the loop self-correcting, with hard bounds:
//
//   computeNextOffset(currentOffset, report)
//     Pure decision function. Drift (Brier >= 0.30 with enough labeled
//     decisions) → raise the threshold offset by one step. Recovery
//     (Brier < 0.20) → step back down toward zero. Every result is clamped
//     to [THRESHOLD_OFFSET_MIN, THRESHOLD_OFFSET_MAX].
//
//   applyCalibrationThresholdAdjustment(report)
//     Called by the daily grader. On drift it records a domain-audit finding
//     (recordFinding — visible on the founder "is it green?" surface) AND, if
//     the offset changes, appends an audit row to
//     support_resolver_threshold_adjustments. Never throws.
//
//   getActiveResolveThresholdOffset()
//     Read path for paxSupportResolver — latest persisted offset, re-clamped
//     on read (defense in depth), 5-min in-process cache, fail-safe to 0.
//
// SAFETY MODEL — the offset can only make Pax MORE conservative:
//   - THRESHOLD_OFFSET_MIN = 0  → the system can never lower the bar below
//     the founder-configured base (SOPHIE_CONFIDENCE_MODE ladder).
//   - THRESHOLD_OFFSET_MAX = 15 → bounded blast radius; a runaway grader
//     can't silently disable auto-resolve via threshold=101.
//   - EFFECTIVE_THRESHOLD_CEILING = 95 → base + offset is additionally capped
//     so the conservative/billing bar (90) plus a full offset stays a real,
//     reachable threshold rather than a silent off-switch.
//
// The audit trail is support_resolver_threshold_adjustments — deliberately
// DISTINCT from any Tier 2A `model_calibration_log` (LCS calibrator weights);
// the two loops coexist without sharing a table.
// ============================================================================

import { desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { logger } from "../../utils/logger";
import {
  supportResolverThresholdAdjustments,
  THRESHOLD_ADJUSTMENT_SURFACE_SUPPORT_RESOLVE,
  type ThresholdAdjustmentDirection,
} from "@shared/schema";
import type { SupportResolverCalibrationReport } from "./supportResolverCalibration";

// ── Hard bounds (the "bounded" in bounded-adjustment) ───────────────────────

/** One grader run moves the offset by at most this many confidence points. */
export const THRESHOLD_ADJUSTMENT_STEP = 5;
/** The offset can never go below 0 — never below the founder-configured base. */
export const THRESHOLD_OFFSET_MIN = 0;
/** The offset can never exceed +15 points above the base. */
export const THRESHOLD_OFFSET_MAX = 15;
/** base + offset is additionally capped here (see paxSupportResolver). */
export const EFFECTIVE_THRESHOLD_CEILING = 95;

/** Brier at/above this = calibration drift (matches the grader's alert bar). */
export const DRIFT_BRIER_THRESHOLD = 0.3;
/** Brier below this = calibration recovered; step the offset back down. */
export const RECOVERY_BRIER_THRESHOLD = 0.2;
/**
 * Minimum labeled decisions before the system is allowed to MOVE the
 * threshold (stricter than the grader's 3-decision alert bar — alerting on
 * thin data is fine; acting on it is not).
 */
export const MIN_GRADED_FOR_ADJUSTMENT = 10;

const OFFSET_CACHE_TTL_MS = 5 * 60 * 1000;

// ── Pure decision function ───────────────────────────────────────────────────

export interface OffsetDecision {
  action: "raise" | "lower" | "hold";
  nextOffset: number;
  /** True when the requested step saturated against a hard clamp. */
  clamped: boolean;
  reason: string;
}

function clampOffset(raw: number): number {
  return Math.max(THRESHOLD_OFFSET_MIN, Math.min(THRESHOLD_OFFSET_MAX, raw));
}

/**
 * Decide the next threshold offset from the current offset + the grader's
 * calibration report. Pure — no I/O. Every path is clamped to
 * [THRESHOLD_OFFSET_MIN, THRESHOLD_OFFSET_MAX].
 */
export function computeNextOffset(
  currentOffset: number,
  report: Pick<
    SupportResolverCalibrationReport,
    "brierScore" | "gradedDecisions" | "overconfidenceBias"
  >,
): OffsetDecision {
  const current = clampOffset(currentOffset);

  if (report.brierScore == null || report.gradedDecisions < MIN_GRADED_FOR_ADJUSTMENT) {
    return {
      action: "hold",
      nextOffset: current,
      clamped: false,
      reason: `insufficient labeled decisions (${report.gradedDecisions} < ${MIN_GRADED_FOR_ADJUSTMENT}) — threshold unchanged`,
    };
  }

  if (report.brierScore >= DRIFT_BRIER_THRESHOLD) {
    const raw = current + THRESHOLD_ADJUSTMENT_STEP;
    const next = clampOffset(raw);
    if (next === current) {
      return {
        action: "hold",
        nextOffset: current,
        clamped: true,
        reason: `drift detected (Brier ${report.brierScore} >= ${DRIFT_BRIER_THRESHOLD}) but offset already at max (+${THRESHOLD_OFFSET_MAX})`,
      };
    }
    return {
      action: "raise",
      nextOffset: next,
      clamped: raw !== next,
      reason: `calibration drift: Brier ${report.brierScore} >= ${DRIFT_BRIER_THRESHOLD} over ${report.gradedDecisions} graded decisions (bias ${report.overconfidenceBias ?? "n/a"}) — raising auto-resolve threshold offset ${current} → ${next}`,
    };
  }

  if (report.brierScore < RECOVERY_BRIER_THRESHOLD && current > THRESHOLD_OFFSET_MIN) {
    const raw = current - THRESHOLD_ADJUSTMENT_STEP;
    const next = clampOffset(raw);
    return {
      action: "lower",
      nextOffset: next,
      clamped: raw !== next,
      reason: `calibration recovered: Brier ${report.brierScore} < ${RECOVERY_BRIER_THRESHOLD} over ${report.gradedDecisions} graded decisions — lowering auto-resolve threshold offset ${current} → ${next}`,
    };
  }

  return {
    action: "hold",
    nextOffset: current,
    clamped: false,
    reason: `calibration in dead band (Brier ${report.brierScore}) — threshold unchanged`,
  };
}

// ── Persistence + read path ──────────────────────────────────────────────────

let offsetCache: { value: number; loadedAt: number } | null = null;

/** Test-only — clear the in-process offset cache. */
export function _resetOffsetCache(): void {
  offsetCache = null;
}

async function readLatestOffset(): Promise<number> {
  const [row] = await db
    .select({ newOffset: supportResolverThresholdAdjustments.newOffset })
    .from(supportResolverThresholdAdjustments)
    .where(
      eq(
        supportResolverThresholdAdjustments.surface,
        THRESHOLD_ADJUSTMENT_SURFACE_SUPPORT_RESOLVE,
      ),
    )
    .orderBy(desc(supportResolverThresholdAdjustments.id))
    .limit(1);
  return clampOffset(row?.newOffset ?? 0);
}

/**
 * The active threshold offset for the support-resolve gate. Cached 5 min,
 * re-clamped on read, fail-safe to 0 (base behaviour) on any DB error —
 * calibration plumbing must NEVER break a customer support turn.
 */
export async function getActiveResolveThresholdOffset(): Promise<number> {
  const now = Date.now();
  if (offsetCache && now - offsetCache.loadedAt < OFFSET_CACHE_TTL_MS) {
    return offsetCache.value;
  }
  try {
    const value = await readLatestOffset();
    offsetCache = { value, loadedAt: now };
    return value;
  } catch (err) {
    logger.warn("[resolverThresholdAdjustment] offset read failed — using 0", {
      metadata: { detail: err instanceof Error ? err.message : String(err) },
    });
    return 0;
  }
}

// ── Grader entrypoint ────────────────────────────────────────────────────────

export interface AdjustmentOutcome {
  driftDetected: boolean;
  decision: OffsetDecision;
  /** True when an audit row was written (i.e. the offset actually moved). */
  adjusted: boolean;
}

/**
 * Close the loop: called by the daily calibration grader with its report.
 *
 *   1. Drift detected → record a domain-audit finding (recordFinding) so the
 *      drift is on the founder's findings surface independent of the page.
 *   2. Offset changes → append the audit row to
 *      support_resolver_threshold_adjustments (the bounded-adjustment trail).
 *
 * Never throws — failures degrade to a warn log, the grader keeps running.
 */
export async function applyCalibrationThresholdAdjustment(
  report: SupportResolverCalibrationReport,
): Promise<AdjustmentOutcome> {
  const driftDetected =
    report.brierScore != null && report.brierScore >= DRIFT_BRIER_THRESHOLD;

  let currentOffset = 0;
  try {
    currentOffset = await readLatestOffset();
  } catch (err) {
    logger.warn(
      "[resolverThresholdAdjustment] could not read current offset — skipping adjustment this run",
      { metadata: { detail: err instanceof Error ? err.message : String(err) } },
    );
    return {
      driftDetected,
      decision: {
        action: "hold",
        nextOffset: 0,
        clamped: false,
        reason: "offset read failed",
      },
      adjusted: false,
    };
  }

  const decision = computeNextOffset(currentOffset, report);

  // 1. Drift → domain-audit finding. Recorded regardless of whether the
  //    offset can still move (saturated-at-max drift is MORE alarming, not
  //    less). recordFinding dedupes on (detector, dedupeKey) so a persisting
  //    drift bumps last_seen_at instead of spamming rows.
  if (driftDetected) {
    try {
      const { recordFinding } = await import("../audit/domainAudit");
      await recordFinding({
        domain: "ai",
        detector: "support_resolver_calibration_grader",
        severity: "warn",
        title: "Pax support auto-resolve calibration drift",
        detail:
          `Brier=${report.brierScore} (>= ${DRIFT_BRIER_THRESHOLD}) over ${report.gradedDecisions} graded ` +
          `auto-resolves in the last ${report.windowDays}d (overconfidence bias ${report.overconfidenceBias ?? "n/a"}). ` +
          `Bounded response: ${decision.reason}.`,
        citedReason:
          "The autonomous support-resolve path must stay calibrated; unreliable confidence means Pax acts on customers it shouldn't.",
        dedupeKey: "support_resolve:calibration_drift",
        metadata: {
          brierScore: report.brierScore,
          overconfidenceBias: report.overconfidenceBias,
          gradedDecisions: report.gradedDecisions,
          windowDays: report.windowDays,
          currentOffset,
          nextOffset: decision.nextOffset,
          action: decision.action,
          clamped: decision.clamped,
        },
      });
    } catch (err) {
      logger.warn("[resolverThresholdAdjustment] recordFinding failed (non-fatal)", {
        metadata: { detail: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  // 2. Offset moved → append the audit row.
  if (decision.action === "hold") {
    return { driftDetected, decision, adjusted: false };
  }

  try {
    await db.insert(supportResolverThresholdAdjustments).values({
      surface: THRESHOLD_ADJUSTMENT_SURFACE_SUPPORT_RESOLVE,
      previousOffset: currentOffset,
      newOffset: decision.nextOffset,
      direction: decision.action as ThresholdAdjustmentDirection,
      reason: decision.reason,
      brierScore: report.brierScore != null ? report.brierScore.toFixed(4) : null,
      overconfidenceBias:
        report.overconfidenceBias != null
          ? report.overconfidenceBias.toFixed(2)
          : null,
      gradedDecisions: report.gradedDecisions,
      clamped: decision.clamped,
    });
    offsetCache = null; // next gate read sees the new offset immediately
    logger.info(
      `[resolverThresholdAdjustment] threshold offset ${decision.action}d ${currentOffset} → ${decision.nextOffset} (clamped=${decision.clamped})`,
      { metadata: { reason: decision.reason } },
    );
    return { driftDetected, decision, adjusted: true };
  } catch (err) {
    logger.warn("[resolverThresholdAdjustment] audit-row insert failed (non-fatal)", {
      metadata: { detail: err instanceof Error ? err.message : String(err) },
    });
    return { driftDetected, decision, adjusted: false };
  }
}

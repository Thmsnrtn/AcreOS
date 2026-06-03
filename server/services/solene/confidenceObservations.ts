/**
 * SOLENE — confidence observations service (L3.11).
 *
 * Persists parsed confidence signals from dispatched agents' final text,
 * then correlates them against the eventual code-review verdict to
 * compute per-observation calibration scores. The per-agentRole
 * distribution feeds the implicit-trust dimension Solene already
 * self-monitors.
 *
 * Three entrypoints:
 *
 *   recordObservation({ dispatchId, agentRole, finalText })
 *     Fire-and-forget. Parses the text via parseConfidence(); if the
 *     parse yields 'no_signal' returns null (no row written — there's no
 *     signal worth persisting). Otherwise inserts a row and returns
 *     { observationId }. Never throws — logs warn on DB failure.
 *
 *   correlateWithReviewOutcome(dispatchId, reviewStatus)
 *     Called when the code-review queue records a review verdict for
 *     a dispatch. Updates every observation row for that dispatch with
 *     correlated_review_status + a computed calibration_score per the
 *     scoring table below. 'skipped' produces null calibration (no
 *     signal). Idempotent — safe to call repeatedly with the same
 *     outcome.
 *
 *   getCalibrationSummary(agentRole, windowDays)
 *     Aggregates the rolling window into observationCount /
 *     averageStatedConfidence / averageCalibrationScore + counts in
 *     three buckets: overconfident (calibration < 0.3), well-calibrated
 *     (>= 0.7), underconfident (in [0.3, 0.7) AND review actually passed).
 *
 * Scoring table (statedConfidence × reviewStatus -> calibration_score):
 *
 *   high (>0.7)   + passed   -> 1.0   (confident & correct)
 *   high (>0.7)   + flagged  -> 0.0   (overconfident — got it wrong)
 *   low  (<0.4)   + passed   -> 0.5   (underconfident — useful but not wrong)
 *   low  (<0.4)   + flagged  -> 0.8   (correctly hedged — predicted problems)
 *   mid  [0.4,0.7]+ any      -> 0.6   (neutral)
 *   any           + skipped  -> null  (no review signal)
 */

import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  soleneConfidenceObservations,
  CONFIDENCE_PHRASE_MAX_LEN,
  CALIBRATION_OVERCONFIDENT_MAX,
  CALIBRATION_WELL_CALIBRATED_MIN,
  type SoleneConfidenceReviewStatus,
} from "@shared/schema/solene-confidence-observations";
import { type SoleneDispatchAgentRole } from "@shared/schema/solene-dispatch";
import { parseConfidence } from "./confidenceParser";
import { logger } from "../../utils/logger";

// ============================================================================
// recordObservation — fire-and-forget.
// ============================================================================

export interface RecordObservationInput {
  dispatchId: number;
  agentRole: SoleneDispatchAgentRole;
  finalText: string;
}

export interface RecordObservationResult {
  observationId: number;
}

export async function recordObservation(
  input: RecordObservationInput,
): Promise<RecordObservationResult | null> {
  try {
    const parsed = parseConfidence(input.finalText);
    if (parsed.kind === "no_signal") {
      // No signal worth recording — don't write a row.
      return null;
    }

    const statedConfidenceStr =
      parsed.statedConfidence === null
        ? null
        : clamp01(parsed.statedConfidence).toFixed(4);

    const phrase =
      parsed.phrase === null
        ? null
        : parsed.phrase.slice(0, CONFIDENCE_PHRASE_MAX_LEN);

    const [inserted] = await db
      .insert(soleneConfidenceObservations)
      .values({
        dispatchId: input.dispatchId,
        agentRole: input.agentRole,
        statedConfidence: statedConfidenceStr,
        confidencePhrase: phrase,
        confidenceKind: parsed.kind,
      })
      .returning({ id: soleneConfidenceObservations.id });

    if (!inserted) {
      logger.warn(
        `[confidenceObservations] insert returned no id for dispatch=${input.dispatchId}`,
      );
      return null;
    }

    logger.info(
      `[confidenceObservations] recorded id=${inserted.id} dispatch=${input.dispatchId} role=${input.agentRole} kind=${parsed.kind} stated=${parsed.statedConfidence ?? "null"}`,
    );

    return { observationId: inserted.id };
  } catch (err) {
    logger.warn(
      "[confidenceObservations] recordObservation swallow",
      err instanceof Error ? err : undefined,
    );
    return null;
  }
}

// ============================================================================
// correlateWithReviewOutcome
// ============================================================================

/**
 * For each observation row tied to `dispatchId`, set
 *   correlated_review_status = reviewStatus
 *   calibration_score        = computeCalibrationScore(stated, reviewStatus)
 *
 * 'skipped' produces null calibration (the dispatch produced no commits
 * so there's no review signal to calibrate against). Never throws.
 */
export async function correlateWithReviewOutcome(
  dispatchId: number,
  reviewStatus: SoleneConfidenceReviewStatus,
): Promise<void> {
  try {
    const rows = await db
      .select({
        id: soleneConfidenceObservations.id,
        statedConfidence: soleneConfidenceObservations.statedConfidence,
      })
      .from(soleneConfidenceObservations)
      .where(eq(soleneConfidenceObservations.dispatchId, dispatchId));

    if (rows.length === 0) {
      // No observations recorded for this dispatch — nothing to correlate.
      return;
    }

    for (const row of rows) {
      const stated =
        row.statedConfidence === null ? null : Number(row.statedConfidence);
      const calibration = computeCalibrationScore(stated, reviewStatus);
      const calibrationStr =
        calibration === null ? null : calibration.toFixed(4);

      await db
        .update(soleneConfidenceObservations)
        .set({
          correlatedReviewStatus: reviewStatus,
          calibrationScore: calibrationStr,
        })
        .where(eq(soleneConfidenceObservations.id, row.id));
    }

    logger.info(
      `[confidenceObservations] correlated dispatch=${dispatchId} review=${reviewStatus} rows=${rows.length}`,
    );
  } catch (err) {
    logger.warn(
      "[confidenceObservations] correlateWithReviewOutcome swallow",
      err instanceof Error ? err : undefined,
    );
  }
}

/**
 * Pure scoring function — exposed for tests. See module-doc scoring table.
 */
export function computeCalibrationScore(
  stated: number | null,
  reviewStatus: SoleneConfidenceReviewStatus,
): number | null {
  if (reviewStatus === "skipped") return null;
  if (stated === null || !Number.isFinite(stated)) {
    // No numeric confidence — assign neutral.
    return 0.6;
  }
  const isHigh = stated > 0.7;
  const isLow = stated < 0.4;
  if (isHigh) return reviewStatus === "passed" ? 1.0 : 0.0;
  if (isLow) return reviewStatus === "passed" ? 0.5 : 0.8;
  return 0.6; // mid-band, either outcome
}

// ============================================================================
// getCalibrationSummary
// ============================================================================

export interface CalibrationSummary {
  observationCount: number;
  averageStatedConfidence: number;
  averageCalibrationScore: number;
  overconfidenceCount: number;
  underconfidenceCount: number;
  wellCalibratedCount: number;
}

export async function getCalibrationSummary(
  agentRole: SoleneDispatchAgentRole,
  windowDays: number,
): Promise<CalibrationSummary> {
  const empty: CalibrationSummary = {
    observationCount: 0,
    averageStatedConfidence: 0,
    averageCalibrationScore: 0,
    overconfidenceCount: 0,
    underconfidenceCount: 0,
    wellCalibratedCount: 0,
  };
  try {
    if (!Number.isFinite(windowDays) || windowDays <= 0) {
      return empty;
    }
    const cutoff = new Date(
      Date.now() - windowDays * 24 * 60 * 60 * 1000,
    );

    const rows = await db
      .select({
        statedConfidence: soleneConfidenceObservations.statedConfidence,
        calibrationScore: soleneConfidenceObservations.calibrationScore,
        correlatedReviewStatus:
          soleneConfidenceObservations.correlatedReviewStatus,
      })
      .from(soleneConfidenceObservations)
      .where(
        and(
          eq(soleneConfidenceObservations.agentRole, agentRole),
          gte(soleneConfidenceObservations.observedAt, cutoff),
        ),
      );

    if (rows.length === 0) return empty;

    let observationCount = 0;
    let statedSum = 0;
    let statedCount = 0;
    let calibrationSum = 0;
    let calibrationCount = 0;
    let overconfidenceCount = 0;
    let underconfidenceCount = 0;
    let wellCalibratedCount = 0;

    for (const r of rows) {
      observationCount += 1;
      if (r.statedConfidence !== null) {
        const s = Number(r.statedConfidence);
        if (Number.isFinite(s)) {
          statedSum += s;
          statedCount += 1;
        }
      }
      if (r.calibrationScore !== null) {
        const c = Number(r.calibrationScore);
        if (Number.isFinite(c)) {
          calibrationSum += c;
          calibrationCount += 1;
          if (c < CALIBRATION_OVERCONFIDENT_MAX) {
            overconfidenceCount += 1;
          } else if (c >= CALIBRATION_WELL_CALIBRATED_MIN) {
            wellCalibratedCount += 1;
          } else if (r.correlatedReviewStatus === "passed") {
            // mid-band [0.3, 0.7) AND the work actually passed → the
            // agent was underconfident.
            underconfidenceCount += 1;
          }
        }
      }
    }

    return {
      observationCount,
      averageStatedConfidence:
        statedCount > 0 ? round4(statedSum / statedCount) : 0,
      averageCalibrationScore:
        calibrationCount > 0 ? round4(calibrationSum / calibrationCount) : 0,
      overconfidenceCount,
      underconfidenceCount,
      wellCalibratedCount,
    };
  } catch (err) {
    logger.warn(
      "[confidenceObservations] getCalibrationSummary failed; returning zero",
      err instanceof Error ? err : undefined,
    );
    return empty;
  }
}

// ============================================================================
// Helpers
// ============================================================================

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// Quiet unused-import warning for sql kept for forward use.
void sql;

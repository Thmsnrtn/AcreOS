/**
 * /api/founder/pax-calibration — Pax confidence calibration (Workstream A).
 *
 * Bucketed predicted-vs-realized accept-rate over `pax_observations`. The
 * X-axis is the confidence Pax stated; the Y-axis is the realized accept-rate
 * (fraction of observations the user actually acknowledged or that Pax
 * auto-resolved). The plot is the honest evaluation surface for Pax confidence.
 *
 * 2026-06 (andrei/pax-real-confidence): the primary confidence signal is now
 * REAL. The aiRouter exposes a model self-reported `confidence` (0..1) on every
 * response whose caller sets `requestConfidence`, and model-backed Pax surfaces
 * stamp that into pax_observations.confidenceScore. The remaining
 * pax_observations rows come from DETERMINISTIC rule-based detectors (stale
 * leads, expiring offers, pipeline velocity, quota) whose confidence is now
 * derived from real evidence (sample size + signal magnitude), not a constant —
 * see paxObserver.detectorConfidence(). The calibration line is therefore a mix
 * of model-derived and detector-derived confidence; both are real signals.
 *
 * Disposition signal: we read directly off `pax_observations.status`. The
 * observer writes 'acknowledged' when the user takes the suggested action
 * (the "accept" signal we want) and 'auto_resolved' when Pax executed the
 * suggested action itself; both count as accepts. 'dismissed' counts as a
 * reject. 'detected' / 'escalated' are still pending and excluded from the
 * realized-rate denominator. We chose this over the `decisions_inbox_items`
 * join because not every Pax observation produces an inbox row, but every
 * observation has a terminal status.
 */

import type { Express, Response } from "express";
import { db } from "./db";
import { paxObservations } from "@shared/schema";
import { and, gte, sql } from "drizzle-orm";
import { isAuthenticated, requireFounder } from "./auth/clerkAuth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 365;

// Bucket edges in stated-confidence space (0..100). Confidence now spans the
// full range: model self-reported confidence (0..1 → 0..100) can land in any
// bucket, and the evidence-derived detector confidences vary with sample size
// and signal magnitude rather than sitting on a few constants. The lower
// buckets (50-60, 60-70, 70-80) are populated as those lower-confidence
// outputs land.
const BUCKETS: Array<{ label: string; min: number; max: number; midpoint: number }> = [
  { label: "50-60%", min: 50, max: 60, midpoint: 0.55 },
  { label: "60-70%", min: 60, max: 70, midpoint: 0.65 },
  { label: "70-80%", min: 70, max: 80, midpoint: 0.75 },
  { label: "80-90%", min: 80, max: 90, midpoint: 0.85 },
  { label: "90-100%", min: 90, max: 101, midpoint: 0.95 }, // 100 inclusive
];

const HONEST_NOTE =
  "Pax confidence is now backed by real signals: (1) model self-reported " +
  "confidence from the AI router (aiRouter requestConfidence → AIResponse.confidence) " +
  "for model-backed surfaces, and (2) evidence-derived detector confidence " +
  "(sample size + signal magnitude) for the deterministic rule-based monitors " +
  "(stale leads, expiring offers, pipeline velocity, quota). No confidence value " +
  "is a hand-coded constant anymore. Where a path has NO measurable signal, the " +
  "underlying API returns null ('not measured') rather than a fabricated number; " +
  "such rows are simply absent from this plot (confidenceScore is notNull on " +
  "pax_observations, so only measured detector/model confidences are written).";

export function registerPaxCalibrationRoutes(app: Express) {
  app.get(
    "/api/founder/pax-calibration",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const windowRaw = parseInt(String(req.query.windowDays ?? DEFAULT_WINDOW_DAYS), 10);
        const windowDays = Number.isFinite(windowRaw)
          ? Math.min(Math.max(1, windowRaw), MAX_WINDOW_DAYS)
          : DEFAULT_WINDOW_DAYS;

        const sinceMs = Date.now() - windowDays * 24 * 60 * 60 * 1000;
        const since = new Date(sinceMs);

        // Pull a tight per-row projection: just the confidence + status, and
        // only inside the window. Bucketing happens in JS — at the scale of
        // pax_observations (single-digit thousands at most) the round-trip is
        // a non-issue and the buckets stay readable.
        const rows = await db
          .select({
            confidenceScore: paxObservations.confidenceScore,
            status: paxObservations.status,
          })
          .from(paxObservations)
          .where(
            and(
              gte(paxObservations.createdAt, since),
              // Defensive: confidenceScore is notNull in schema, but if any
              // row sneaks through with NULL we want to skip it cleanly.
              sql`${paxObservations.confidenceScore} is not null`,
            ),
          );

        const sampleCount = rows.length;

        // Per-bucket accept / total counters. Terminal statuses only — pending
        // rows ('detected' / 'escalated') don't contribute to the realized
        // rate denominator because we don't know yet whether they'll be
        // accepted or rejected.
        const counters = BUCKETS.map(() => ({ accepts: 0, total: 0 }));

        let overallAccepts = 0;
        let overallTotal = 0;

        for (const row of rows) {
          const score = row.confidenceScore;
          if (score === null || score === undefined) continue;

          const status = row.status;
          const isAccept = status === "acknowledged" || status === "auto_resolved";
          const isReject = status === "dismissed";
          const isTerminal = isAccept || isReject;

          if (!isTerminal) continue;

          // Find the bucket — half-open [min, max) except the last bucket
          // which is inclusive on the right so 100 lands in 90-100%.
          const bucketIdx = BUCKETS.findIndex((b) => score >= b.min && score < b.max);
          if (bucketIdx === -1) continue;

          counters[bucketIdx].total += 1;
          if (isAccept) counters[bucketIdx].accepts += 1;

          overallTotal += 1;
          if (isAccept) overallAccepts += 1;
        }

        const buckets = BUCKETS.map((b, i) => {
          const c = counters[i];
          const observed = c.total > 0 ? c.accepts / c.total : null;
          return {
            label: b.label,
            predicted: b.midpoint,
            observed,
            n: c.total,
          };
        });

        const overallObservedRate = overallTotal > 0 ? overallAccepts / overallTotal : 0;

        res.json({
          asOf: new Date().toISOString(),
          windowDays,
          sampleCount,
          buckets,
          overallObservedRate,
          note: HONEST_NOTE,
        });
      } catch (error) {
        logger.error("[pax-calibration] Failed to compute calibration", {
          error: error instanceof Error ? error.message : String(error),
        });
        Errors.internal(res, error);
      }
    },
  );
}

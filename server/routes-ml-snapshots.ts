/**
 * Phase 3 Week 12 — Founder ML training-snapshot dashboard API (Magnus §1).
 *
 * Reads ml_training_snapshots to surface:
 *   • counts by snapshot type (with training-ready threshold progress)
 *   • recent additions across all types
 *   • per-type wiring info (where snapshots are written from)
 *
 * All endpoints are founder-gated.
 *
 *   GET /api/founder/ml-snapshots/summary  — counts by type
 *   GET /api/founder/ml-snapshots/recent   — last N rows
 */

import type { Express } from "express";
import { desc } from "drizzle-orm";

import { db } from "./db";
import { mlTrainingSnapshots } from "@shared/schema";
import { isAuthenticated } from "./auth";
import { isFounderIdentity } from "./services/founder";
import { getSnapshotCountsByType, TRAINING_READY_THRESHOLDS } from "./services/mlSnapshots";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import type { AuthenticatedRequest } from "./types/request";

function requireFounder(req: AuthenticatedRequest, res: any): boolean {
  const user = req.user as any;
  const userId = (req as any).auth?.userId ?? user?.clerkUserId ?? null;
  const email = user?.email ?? null;
  if (!isFounderIdentity({ email, userId })) {
    Errors.forbidden(res, "Founder access required");
    return false;
  }
  return true;
}

export function registerMlSnapshotsRoutes(app: Express): void {
  app.get("/api/founder/ml-snapshots/summary", isAuthenticated, async (req, res) => {
    const areq = req as AuthenticatedRequest;
    if (!requireFounder(areq, res)) return;

    try {
      const counts = await getSnapshotCountsByType();
      return res.json({
        counts,
        thresholds: TRAINING_READY_THRESHOLDS,
        // Retention: snapshots are kept indefinitely. They're cheap (jsonb
        // rows, no PII beyond what already lives on the source rows) and
        // we want the longest possible training history.
        retentionPolicy: "indefinite",
      });
    } catch (err) {
      logger.error("[ml-snapshots] summary query failed", err as Error);
      return Errors.internal(res, err);
    }
  });

  app.get("/api/founder/ml-snapshots/recent", isAuthenticated, async (req, res) => {
    const areq = req as AuthenticatedRequest;
    if (!requireFounder(areq, res)) return;

    const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 200);

    try {
      const rows = await db
        .select()
        .from(mlTrainingSnapshots)
        .orderBy(desc(mlTrainingSnapshots.createdAt))
        .limit(limit);
      return res.json({ snapshots: rows });
    } catch (err) {
      logger.error("[ml-snapshots] recent query failed", err as Error);
      return Errors.internal(res, err);
    }
  });
}

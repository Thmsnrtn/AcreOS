/**
 * Phase 3 Week 12 — ML training-data instrumentation (Magnus §1).
 *
 * Captures labels + feature snapshots so models can be trained later when
 * data accumulates. Model training is deferred to month 18+; this module is
 * the *measurement infrastructure* that makes future training possible.
 *
 * Five outcome types are supported, all flowing through the same table
 * (`ml_training_snapshots`) and the same helper:
 *
 *   • avm_vs_actual      — AVM input + estimate, paired later with sale price
 *   • deal_outcome       — deal features, paired with closed-won / closed-lost
 *   • lead_conversion    — lead features, paired with converted / dismissed
 *   • churn_outcome      — org's last-30-day usage, paired with churn reason
 *   • offer_acceptance   — offer features, paired with accepted / declined / expired
 *
 * Idempotency contract: re-firing recordSnapshot() with the same
 * (snapshotType, subjectType, subjectId, decisionAt) is a no-op at the DB
 * layer via ON CONFLICT DO NOTHING. Callers can safely fire-and-forget.
 *
 * Threading model: every entry point is fire-and-forget (recordSnapshotAsync,
 * pairOutcomeAsync). The primary flow (AVM run, deal close, lead conversion,
 * subscription cancel, offer status change) MUST NOT block on snapshot
 * writes — if the snapshot helper fails, the user-visible action still wins.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  mlTrainingSnapshots,
  type MlSnapshotType,
  type MlSubjectType,
} from "@shared/schema";
import { logger } from "../utils/logger";

export interface RecordSnapshotArgs {
  snapshotType: MlSnapshotType;
  subjectType: MlSubjectType;
  subjectId: string | number;
  orgId?: number | null;
  labels?: Record<string, unknown>;
  features?: Record<string, unknown>;
  decisionAt: Date;
  outcomeAt?: Date | null;
  metadata?: Record<string, unknown>;
}

/**
 * Record a training snapshot. Idempotent on
 * (snapshotType, subjectType, subjectId, decisionAt) — duplicate calls
 * for the same decision moment are silently dropped at the DB layer.
 *
 * Returns true if a row was inserted, false if it was a duplicate (or
 * a non-fatal error swallowed; see logger output).
 */
export async function recordSnapshot(args: RecordSnapshotArgs): Promise<boolean> {
  const {
    snapshotType,
    subjectType,
    subjectId,
    orgId,
    labels,
    features,
    decisionAt,
    outcomeAt,
    metadata,
  } = args;

  if (!snapshotType || !subjectType || subjectId === undefined || subjectId === null) {
    logger.warn("[mlSnapshots] recordSnapshot called with missing required args", {
      metadata: { snapshotType, subjectType, hasSubjectId: subjectId !== undefined },
    });
    return false;
  }

  try {
    const result = await db
      .insert(mlTrainingSnapshots)
      .values({
        snapshotType,
        subjectType,
        subjectId: String(subjectId),
        organizationId: orgId ?? null,
        labels: (labels ?? {}) as Record<string, any>,
        features: (features ?? {}) as Record<string, any>,
        decisionAt,
        outcomeAt: outcomeAt ?? null,
        metadata: (metadata ?? {}) as Record<string, any>,
      })
      .onConflictDoNothing({
        target: [
          mlTrainingSnapshots.snapshotType,
          mlTrainingSnapshots.subjectType,
          mlTrainingSnapshots.subjectId,
          mlTrainingSnapshots.decisionAt,
        ],
      })
      .returning({ id: mlTrainingSnapshots.id });

    return result.length > 0;
  } catch (err) {
    logger.warn("[mlSnapshots] recordSnapshot failed", {
      metadata: {
        snapshotType,
        subjectType,
        subjectId: String(subjectId),
        error: (err as Error).message,
      },
    });
    return false;
  }
}

/**
 * Fire-and-forget wrapper for hot paths. Never throws into the caller.
 */
export function recordSnapshotAsync(args: RecordSnapshotArgs): void {
  recordSnapshot(args).catch((err) => {
    logger.warn("[mlSnapshots] async record failed", {
      metadata: {
        snapshotType: args.snapshotType,
        error: (err as Error).message,
      },
    });
  });
}

/**
 * Pair an outcome onto the most recent open snapshot for a subject.
 *
 * Used for the two-phase patterns:
 *   • avm_vs_actual    — AVM run writes phase 1, deal close pairs phase 2
 *   • lead_conversion  — lead create writes phase 1, deal create pairs phase 2
 *   • offer_acceptance — offer-sent writes phase 1, accept/decline pairs phase 2
 *
 * "Most recent open" means the latest snapshot of (snapshotType, subjectType,
 * subjectId) that doesn't yet have outcome_at set. We update that row in
 * place rather than writing a second row, so the trained model gets a single
 * (features, labels) pair per decision.
 */
export interface PairOutcomeArgs {
  snapshotType: MlSnapshotType;
  subjectType: MlSubjectType;
  subjectId: string | number;
  outcomeLabels: Record<string, unknown>;
  outcomeAt?: Date;
  metadata?: Record<string, unknown>;
}

export async function pairOutcome(args: PairOutcomeArgs): Promise<boolean> {
  const {
    snapshotType,
    subjectType,
    subjectId,
    outcomeLabels,
    outcomeAt,
    metadata,
  } = args;

  try {
    // Find the most recent open snapshot. We can't update by primary key
    // alone because callers don't track snapshot IDs — they track domain
    // IDs (deal #, lead #, property #).
    const [open] = await db
      .select()
      .from(mlTrainingSnapshots)
      .where(
        and(
          eq(mlTrainingSnapshots.snapshotType, snapshotType),
          eq(mlTrainingSnapshots.subjectType, subjectType),
          eq(mlTrainingSnapshots.subjectId, String(subjectId)),
          sql`${mlTrainingSnapshots.outcomeAt} IS NULL`,
        ),
      )
      .orderBy(desc(mlTrainingSnapshots.decisionAt))
      .limit(1);

    if (!open) {
      // No matching open snapshot — record a new outcome-only row so the
      // outcome isn't lost. This handles the case where the decision-time
      // snapshot was never written (e.g. backfill after the helper shipped).
      return await recordSnapshot({
        snapshotType,
        subjectType,
        subjectId,
        labels: outcomeLabels,
        features: {},
        decisionAt: outcomeAt ?? new Date(),
        outcomeAt: outcomeAt ?? new Date(),
        metadata: { ...(metadata ?? {}), pairing: "outcome_only_no_decision" },
      });
    }

    // Merge outcome onto existing labels (preserving any decision-time labels
    // like the AVM estimate, deal offer amount, etc.).
    const mergedLabels = {
      ...(open.labels ?? {}),
      ...outcomeLabels,
    };
    const mergedMetadata = {
      ...(open.metadata ?? {}),
      ...(metadata ?? {}),
      paired_at: new Date().toISOString(),
    };

    await db
      .update(mlTrainingSnapshots)
      .set({
        labels: mergedLabels,
        metadata: mergedMetadata,
        outcomeAt: outcomeAt ?? new Date(),
      })
      .where(eq(mlTrainingSnapshots.id, open.id));

    return true;
  } catch (err) {
    logger.warn("[mlSnapshots] pairOutcome failed", {
      metadata: {
        snapshotType,
        subjectType,
        subjectId: String(subjectId),
        error: (err as Error).message,
      },
    });
    return false;
  }
}

export function pairOutcomeAsync(args: PairOutcomeArgs): void {
  pairOutcome(args).catch((err) => {
    logger.warn("[mlSnapshots] async pair failed", {
      metadata: {
        snapshotType: args.snapshotType,
        error: (err as Error).message,
      },
    });
  });
}

// ─── Founder dashboard helpers ────────────────────────────────────────────

/**
 * Minimum sample sizes before each model is "training-ready". These are
 * heuristic, not load-bearing — the founder UI just renders progress bars
 * against them so we know when we have enough data to start training.
 *
 * Numbers chosen as conservative-but-not-extreme floors for tabular models;
 * tighten/loosen once we have a real ML team scoping the actual targets.
 */
export const TRAINING_READY_THRESHOLDS: Record<MlSnapshotType, number> = {
  avm_vs_actual: 500,
  deal_outcome: 500,
  lead_conversion: 1000,
  churn_outcome: 100,
  offer_acceptance: 500,
};

export interface SnapshotCountByType {
  snapshotType: MlSnapshotType;
  total: number;
  withOutcome: number;
  trainingReadyAt: number;
  trainingReady: boolean;
}

export async function getSnapshotCountsByType(): Promise<SnapshotCountByType[]> {
  const result = await db.execute(sql`
    SELECT
      snapshot_type AS "snapshotType",
      COUNT(*)::int AS "total",
      COUNT(*) FILTER (WHERE outcome_at IS NOT NULL)::int AS "withOutcome"
    FROM ml_training_snapshots
    GROUP BY snapshot_type
  `);

  const rows = ((result as any).rows ?? (result as any) ?? []) as Array<{
    snapshotType: string;
    total: number;
    withOutcome: number;
  }>;

  const byType = new Map(rows.map((r) => [r.snapshotType, r]));

  return (Object.keys(TRAINING_READY_THRESHOLDS) as MlSnapshotType[]).map((t) => {
    const row = byType.get(t);
    const withOutcome = Number(row?.withOutcome ?? 0);
    const total = Number(row?.total ?? 0);
    const threshold = TRAINING_READY_THRESHOLDS[t];
    return {
      snapshotType: t,
      total,
      withOutcome,
      trainingReadyAt: threshold,
      trainingReady: withOutcome >= threshold,
    };
  });
}

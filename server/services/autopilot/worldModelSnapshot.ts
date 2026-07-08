/**
 * World-model snapshot persistence (kernel-elevation T1.3 / #10).
 *
 * The causal world-model is refined-and-discarded every tick — so its edge-
 * confidence TRAJECTORY (the literal heart of THE BET: "the model gets
 * permanently sharper from real consequence") was invisible, an assertion rather
 * than an observable. This persists a per-cycle snapshot so the trajectory can
 * be charted, each edge badged measured (refined from real consequence) vs a
 * still-unmeasured prior — and so the cross-tenant meta-learning Foundry will
 * sell has a substrate to read.
 *
 * Composition layer (touches the DB + the land pack) — NOT kernel. The edge-
 * extraction (snapshotEdges) is pure + tested; the persistence is best-effort.
 */

import { desc } from "drizzle-orm";
import { db } from "../../db";
import { autopilotWorldmodelSnapshots } from "@shared/schema";
import { logger } from "../../utils/logger";
import type { CausalModel } from "./worldModel";

export interface SnapshotEdge {
  from: string;
  to: string;
  confidence: number;
  /** True iff this edge has been refined from real consequence (not a prior). */
  measured: boolean;
}

export interface WorldModelSnapshot {
  modelVersion: number;
  edges: SnapshotEdge[];
  measuredEdgeCount: number;
  edgeCount: number;
}

/** Pure: extract the snapshot shape from a (possibly refined) causal model. An
 *  edge is "measured" iff refineModel stamped its evidence "refined from …". */
export function snapshotEdges(model: CausalModel): WorldModelSnapshot {
  const edges: SnapshotEdge[] = model.edges.map((e) => ({
    from: e.from,
    to: e.to,
    confidence: e.confidence,
    measured: /refined from/i.test(e.evidence ?? ""),
  }));
  return {
    modelVersion: model.version,
    edges,
    measuredEdgeCount: edges.filter((e) => e.measured).length,
    edgeCount: edges.length,
  };
}

/**
 * Refine the land model from the org's consequence history and persist one
 * snapshot of its edge confidences. Best-effort; never throws (an observability
 * write must never disturb the loop).
 */
export async function persistWorldModelSnapshot(): Promise<WorldModelSnapshot | null> {
  try {
    const { refineModel, evidenceByLever } = await import("./worldModel");
    const { resolveActivePack } = await import("./activePack");
    const { getPastEpisodes } = await import("./experienceLog");
    const activePack = resolveActivePack();
    const episodes = await getPastEpisodes(200);
    const model = refineModel(activePack.causalModel, evidenceByLever(episodes, activePack.moveToLever));
    const snap = snapshotEdges(model);
    await db.insert(autopilotWorldmodelSnapshots).values({
      modelVersion: snap.modelVersion,
      edges: snap.edges,
      measuredEdgeCount: snap.measuredEdgeCount,
      edgeCount: snap.edgeCount,
    });
    return snap;
  } catch (err) {
    logger.warn("[autopilot/worldModelSnapshot] persist failed (swallowed)", err instanceof Error ? err : undefined);
    return null;
  }
}

/** Recent snapshots (newest first) — the confidence trajectory for the founder
 *  story / Foundry's legible moat. Best-effort; [] on any failure. */
export async function getWorldModelTrajectory(limit = 60): Promise<
  Array<{ capturedAt: Date | null; measuredEdgeCount: number; edgeCount: number; edges: unknown }>
> {
  try {
    const rows = await db
      .select({
        capturedAt: autopilotWorldmodelSnapshots.capturedAt,
        measuredEdgeCount: autopilotWorldmodelSnapshots.measuredEdgeCount,
        edgeCount: autopilotWorldmodelSnapshots.edgeCount,
        edges: autopilotWorldmodelSnapshots.edges,
      })
      .from(autopilotWorldmodelSnapshots)
      .orderBy(desc(autopilotWorldmodelSnapshots.capturedAt))
      .limit(limit);
    return rows;
  } catch (err) {
    logger.warn("[autopilot/worldModelSnapshot] trajectory read failed", err instanceof Error ? err : undefined);
    return [];
  }
}

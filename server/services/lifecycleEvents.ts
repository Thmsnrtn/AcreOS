/**
 * Pillar E / E5 — Lifecycle events firehose helpers.
 *
 *   recordLifecycleEvent(input)
 *     Single canonical writer. Fire-and-forget: never throws (writes go
 *     to a logger.warn on failure).
 *
 *   getOrgJourney(orgId)
 *     Pull every lifecycle event for an org in chronological order. Used
 *     by /api/founder/lifecycle/journey and future cohort tooling.
 *
 * Convention: eventType is a dotted path so prefix-grouping works
 *   ("trial.*", "onboarding.*", "engagement.*"). Stages are coarse;
 *   eventTypes are fine.
 */

import { db } from "../db";
import {
  lifecycleEvents,
  type InsertLifecycleEvent,
  type LifecycleStage,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { logger } from "../utils/logger";

export interface LifecycleEventInput {
  organizationId?: number | null;
  userId?: string | null;
  eventType: string;
  stage?: LifecycleStage;
  metadata?: Record<string, unknown>;
  sourceTable?: string;
  sourceId?: string;
}

export async function recordLifecycleEvent(input: LifecycleEventInput): Promise<void> {
  try {
    const row: InsertLifecycleEvent = {
      organizationId: input.organizationId ?? null,
      userId: input.userId ?? null,
      eventType: input.eventType,
      stage: input.stage ?? null,
      metadata: input.metadata ?? {},
      sourceTable: input.sourceTable ?? null,
      sourceId: input.sourceId ?? null,
    };
    await db.insert(lifecycleEvents).values(row);
  } catch (err) {
    // Lifecycle writes are best-effort; never block the calling path.
    logger.warn("[lifecycle-events] write failed", {
      source: "lifecycle-events",
      metadata: {
        eventType: input.eventType,
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }
}

export async function getOrgJourney(orgId: number, limit = 200) {
  return db
    .select()
    .from(lifecycleEvents)
    .where(eq(lifecycleEvents.organizationId, orgId))
    .orderBy(lifecycleEvents.occurredAt)
    .limit(limit);
}

// countByStageWindow, dailyCount deleted 2026-08-29 — zero callers, adversarially verified (rule-1 register close-out).

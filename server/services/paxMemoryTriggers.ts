/**
 * Pax Memory Triggers — auto-store memories on key events.
 *
 * These functions are called from event handlers (deal closed, user correction,
 * goal set, constraint mentioned) to persist Pax memories for future context.
 */

import { db } from "../db";
import { paxMemory } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "../utils/logger";

/**
 * Store a memory when a deal is closed — captures deal preference patterns.
 */
export async function onDealClosed(
  orgId: number,
  dealData: {
    county?: string | null;
    acreageRange?: string | null;
    priceRange?: string | null;
    strategy?: string | null;
  }
): Promise<void> {
  if (!orgId || !dealData) return;

  try {
    const value = {
      summary: "Deal preference pattern",
      details: {
        county: dealData.county ?? null,
        acreageRange: dealData.acreageRange ?? null,
        priceRange: dealData.priceRange ?? null,
        strategy: dealData.strategy ?? null,
      },
      timestamp: new Date().toISOString(),
    };

    // Upsert: update if key exists for this org, insert otherwise
    const existing = await db
      .select({ id: paxMemory.id })
      .from(paxMemory)
      .where(
        and(
          eq(paxMemory.organizationId, orgId),
          eq(paxMemory.key, "deal_preference")
        )
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(paxMemory)
        .set({ value, updatedAt: new Date() })
        .where(eq(paxMemory.id, existing[0].id));
    } else {
      await db.insert(paxMemory).values({
        organizationId: orgId,
        userId: "system",
        memoryType: "pattern",
        key: "deal_preference",
        value,
        importance: 7,
      });
    }

    logger.info("Pax memory stored: deal_preference", { orgId });
  } catch (err) {
    logger.warn("Failed to store deal preference memory", { orgId, error: err });
  }
}

/**
 * Store a memory when the user corrects Pax — captures preferences/corrections.
 */
export async function onUserCorrection(
  orgId: number,
  topic: string,
  correction: string
): Promise<void> {
  if (!orgId || !topic || !correction) return;

  try {
    const value = {
      summary: `User correction on ${topic}`,
      details: {
        topic,
        correction,
      },
      timestamp: new Date().toISOString(),
    };

    const correctionKey = `correction_${topic.replace(/\s+/g, "_").toLowerCase()}`;

    const existing = await db
      .select({ id: paxMemory.id })
      .from(paxMemory)
      .where(
        and(
          eq(paxMemory.organizationId, orgId),
          eq(paxMemory.key, correctionKey)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(paxMemory)
        .set({ value, updatedAt: new Date() })
        .where(eq(paxMemory.id, existing[0].id));
    } else {
      await db.insert(paxMemory).values({
        organizationId: orgId,
        userId: "system",
        memoryType: "preference",
        key: correctionKey,
        value,
        importance: 8,
      });
    }

    logger.info("Pax memory stored: user correction", { orgId, topic });
  } catch (err) {
    logger.warn("Failed to store user correction memory", { orgId, error: err });
  }
}

/**
 * Store a memory when a goal is set — tracks user goals and deadlines.
 */
export async function onGoalSet(
  orgId: number,
  goalType: string,
  target: string | number,
  deadline?: string | null
): Promise<void> {
  if (!orgId || !goalType) return;

  try {
    const value = {
      summary: `Goal: ${goalType}`,
      details: {
        target: target ?? null,
        deadline: deadline ?? null,
      },
      timestamp: new Date().toISOString(),
    };

    const goalKey = `goal_${goalType.replace(/\s+/g, "_").toLowerCase()}`;

    const existing = await db
      .select({ id: paxMemory.id })
      .from(paxMemory)
      .where(
        and(
          eq(paxMemory.organizationId, orgId),
          eq(paxMemory.key, goalKey)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(paxMemory)
        .set({ value, updatedAt: new Date() })
        .where(eq(paxMemory.id, existing[0].id));
    } else {
      await db.insert(paxMemory).values({
        organizationId: orgId,
        userId: "system",
        memoryType: "goal",
        key: goalKey,
        value,
        importance: 8,
      });
    }

    logger.info("Pax memory stored: goal set", { orgId, goalType });
  } catch (err) {
    logger.warn("Failed to store goal memory", { orgId, error: err });
  }
}

/**
 * Store a memory when a constraint is mentioned — tracks warnings/limits.
 */
export async function onConstraintMentioned(
  orgId: number,
  detail: string
): Promise<void> {
  if (!orgId || !detail) return;

  try {
    const value = {
      summary: "User constraint or limitation",
      details: {
        detail,
      },
      timestamp: new Date().toISOString(),
    };

    const existing = await db
      .select({ id: paxMemory.id })
      .from(paxMemory)
      .where(
        and(
          eq(paxMemory.organizationId, orgId),
          eq(paxMemory.key, "constraint")
        )
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(paxMemory)
        .set({ value, updatedAt: new Date() })
        .where(eq(paxMemory.id, existing[0].id));
    } else {
      await db.insert(paxMemory).values({
        organizationId: orgId,
        userId: "system",
        memoryType: "warning",
        key: "constraint",
        value,
        importance: 9,
      });
    }

    logger.info("Pax memory stored: constraint", { orgId });
  } catch (err) {
    logger.warn("Failed to store constraint memory", { orgId, error: err });
  }
}

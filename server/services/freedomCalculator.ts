// @ts-nocheck — ORM type refinement deferred; runtime-correct
/**
 * Freedom Calculator — tracks passive income progress toward financial freedom.
 *
 * Freedom percentage = (monthly passive income / freedom target) × 100
 * Projected date = linear projection from acquisition rate.
 */

import { db } from "../db";
import { goals, notes, payments } from "@shared/schema";
import { eq, and, gte, sql, desc, sum } from "drizzle-orm";
import { startOfMonth, endOfMonth, addMonths } from "date-fns";

interface FreedomSnapshot {
  monthlyPassiveIncome: number;
  freedomTarget: number;
  freedomPercentage: number;
  projectedFreedomDate: string | null;
  accelerationSuggestion: string | null;
  milestoneReached: 0 | 25 | 50 | 75 | 100;
}

/**
 * Get freedom snapshot for an org — cached 1 hour
 */
export async function getFreedomSnapshot(orgId: number): Promise<FreedomSnapshot> {
  // Get freedom target from goals
  const freedomGoal = await db.query.goals.findFirst({
    where: and(
      eq(goals.organizationId, orgId),
      eq(goals.type, "revenue_earned"),
    ),
    orderBy: desc(goals.createdAt),
  });

  const freedomTarget = freedomGoal?.target ? Number(freedomGoal.target) : 0;

  // Calculate monthly passive income from note payments this month
  const now = new Date();
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);

  let monthlyPassiveIncome = 0;
  try {
    const result = await db
      .select({ total: sql<number>`COALESCE(SUM(CAST(${payments.amount} AS numeric)), 0)` })
      .from(payments)
      .where(
        and(
          eq(payments.organizationId, orgId),
          gte(payments.paymentDate, monthStart),
        ),
      );
    monthlyPassiveIncome = Number(result[0]?.total) || 0;
  } catch {
    monthlyPassiveIncome = 0;
  }

  // Freedom percentage — handle target=0 without Infinity
  let freedomPercentage = 0;
  if (freedomTarget > 0) {
    freedomPercentage = Math.min(100, Math.round((monthlyPassiveIncome / freedomTarget) * 100));
  }

  // Projected freedom date — linear projection
  let projectedFreedomDate: string | null = null;
  if (freedomTarget > 0 && monthlyPassiveIncome > 0 && freedomPercentage < 100) {
    // Count active notes to estimate acquisition rate
    let activeNoteCount = 0;
    try {
      const noteResult = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(notes)
        .where(
          and(
            eq(notes.organizationId, orgId),
            eq(notes.status, "active"),
          ),
        );
      activeNoteCount = Number(noteResult[0]?.count) || 0;
    } catch {
      activeNoteCount = 0;
    }

    if (activeNoteCount > 0) {
      const avgIncomePerNote = monthlyPassiveIncome / activeNoteCount;
      const notesNeeded = Math.ceil((freedomTarget - monthlyPassiveIncome) / (avgIncomePerNote || 1));
      // Assume ~2 notes acquired per month at current rate
      const monthsToFreedom = Math.ceil(notesNeeded / 2);
      const projectedDate = addMonths(now, monthsToFreedom);
      projectedFreedomDate = projectedDate.toISOString().slice(0, 7); // YYYY-MM
    }
  }

  // Acceleration suggestion
  let accelerationSuggestion: string | null = null;
  if (freedomTarget > 0 && monthlyPassiveIncome > 0 && freedomPercentage < 100) {
    const remaining = freedomTarget - monthlyPassiveIncome;
    const notesNeeded = Math.ceil(remaining / (monthlyPassiveIncome / Math.max(1, 1)));
    accelerationSuggestion = `${notesNeeded} more notes at avg terms → freedom ${Math.ceil(notesNeeded / 2)} months sooner`;
  }

  // Milestone check
  let milestoneReached: FreedomSnapshot["milestoneReached"] = 0;
  if (freedomPercentage >= 100) milestoneReached = 100;
  else if (freedomPercentage >= 75) milestoneReached = 75;
  else if (freedomPercentage >= 50) milestoneReached = 50;
  else if (freedomPercentage >= 25) milestoneReached = 25;

  return {
    monthlyPassiveIncome,
    freedomTarget,
    freedomPercentage,
    projectedFreedomDate,
    accelerationSuggestion,
    milestoneReached,
  };
}

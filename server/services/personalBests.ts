/**
 * Personal best tracker — celebrates milestones.
 */

import { db } from "../db";
import { deals, notes } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { logger } from "../utils/logger";

export interface PersonalBest {
  metric: string;
  value: number;
  previousValue: number | null;
  achievedAt: Date;
  dealId?: number;
  label: string;
  formattedValue: string;
}

function fmt$(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

export async function checkPersonalBests(
  orgId: number,
  dealId: number,
  profit: number,
  daysToClose: number
): Promise<PersonalBest[]> {
  const broken: PersonalBest[] = [];

  try {
    // Get all closed deals for this org
    const closedDeals = await db.select().from(deals)
      .where(and(eq(deals.organizationId, orgId), eq(deals.status, "closed")))
      .orderBy(desc(deals.updatedAt));

    // Highest single-deal profit
    const profits = closedDeals
      .map(d => {
        const accepted = parseFloat(d.acceptedAmount || "0");
        const purchase = parseFloat(d.offerAmount || "0");
        return accepted > 0 && purchase > 0 ? accepted - purchase : 0;
      })
      .filter(p => p > 0);

    if (profits.length > 0) {
      const maxProfit = Math.max(...profits);
      if (profit >= maxProfit && profit > 0) {
        const prev = profits.length > 1 ? profits.sort((a, b) => b - a)[1] : null;
        broken.push({
          metric: "highest_profit",
          value: profit,
          previousValue: prev ?? null,
          achievedAt: new Date(),
          dealId,
          label: "Highest Single-Deal Profit",
          formattedValue: fmt$(profit),
        });
      }
    }

    // Fastest deal close
    if (daysToClose > 0) {
      const existingFastest = closedDeals.reduce((min, d) => {
        if (!d.offerDate || !d.closingDate) return min;
        const days = Math.ceil(
          (new Date(d.closingDate).getTime() - new Date(d.offerDate).getTime()) / 86400000
        );
        return days > 0 && days < min ? days : min;
      }, Infinity);

      if (daysToClose <= existingFastest || existingFastest === Infinity) {
        broken.push({
          metric: "fastest_close",
          value: daysToClose,
          previousValue: existingFastest === Infinity ? null : existingFastest,
          achievedAt: new Date(),
          dealId,
          label: "Fastest Deal Close",
          formattedValue: `${daysToClose} days`,
        });
      }
    }

    // Longest profitable streak
    const streakProfits = closedDeals.map(d => {
      const a = parseFloat(d.acceptedAmount || "0");
      const o = parseFloat(d.offerAmount || "0");
      return a > 0 && o > 0 ? a - o : 0;
    });
    let currentStreak = 0;
    for (const p of streakProfits) {
      if (p > 0) currentStreak++;
      else break;
    }
    if (currentStreak >= 3) {
      broken.push({
        metric: "profit_streak",
        value: currentStreak,
        previousValue: null,
        achievedAt: new Date(),
        dealId,
        label: "Profitable Deal Streak",
        formattedValue: `${currentStreak} deals`,
      });
    }
  } catch (err) {
    logger.error("Personal bests check failed", err instanceof Error ? err : undefined);
  }

  return broken;
}

/**
 * Trend Analyzer — Sovereign Company Protocol v4
 *
 * Computes week-over-week and month-over-month comparisons for key metrics.
 * Surfaces "this week vs last week" insights that a layperson CEO cares about.
 *
 * Used in: morning briefing, trend cards UI, and Oracle's analytics updates.
 */

import { db } from "../db";
import {
  organizations, leads, deals, supportTickets,
  agentActionLog, churnRiskScores,
} from "@shared/schema";
import { sql, gte, and, lte, count } from "drizzle-orm";

export interface TrendResult {
  metric: string;
  label: string;
  current: number;
  previous: number;
  delta: number;
  deltaPercent: number;
  direction: "up" | "down" | "flat";
  interpretation: string;
}

/**
 * Calculate week-over-week trends for key business metrics.
 */
export async function getWeeklyTrends(): Promise<TrendResult[]> {
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const trends: TrendResult[] = [];

  // 1. New signups trend
  const [currentSignups] = await db.select({ c: count() })
    .from(organizations)
    .where(gte(organizations.createdAt, oneWeekAgo));
  const [previousSignups] = await db.select({ c: count() })
    .from(organizations)
    .where(and(gte(organizations.createdAt, twoWeeksAgo), lte(organizations.createdAt, oneWeekAgo)));

  trends.push(buildTrend("signups", "New Signups", Number(currentSignups.c), Number(previousSignups.c)));

  // 2. New leads trend
  const [currentLeads] = await db.select({ c: count() })
    .from(leads)
    .where(gte(leads.createdAt, oneWeekAgo));
  const [previousLeads] = await db.select({ c: count() })
    .from(leads)
    .where(and(gte(leads.createdAt, twoWeeksAgo), lte(leads.createdAt, oneWeekAgo)));

  trends.push(buildTrend("leads", "New Leads", Number(currentLeads.c), Number(previousLeads.c)));

  // 3. Support ticket volume
  const [currentTickets] = await db.select({ c: count() })
    .from(supportTickets)
    .where(gte(supportTickets.createdAt, oneWeekAgo));
  const [previousTickets] = await db.select({ c: count() })
    .from(supportTickets)
    .where(and(gte(supportTickets.createdAt, twoWeeksAgo), lte(supportTickets.createdAt, oneWeekAgo)));

  trends.push(buildTrend("support_volume", "Support Tickets", Number(currentTickets.c), Number(previousTickets.c), true));

  // 4. Agent actions volume
  const [currentActions] = await db.select({ c: count() })
    .from(agentActionLog)
    .where(gte(agentActionLog.createdAt, oneWeekAgo));
  const [previousActions] = await db.select({ c: count() })
    .from(agentActionLog)
    .where(and(gte(agentActionLog.createdAt, twoWeeksAgo), lte(agentActionLog.createdAt, oneWeekAgo)));

  trends.push(buildTrend("agent_actions", "Agent Actions", Number(currentActions.c), Number(previousActions.c)));

  // 5. Deals created
  const [currentDeals] = await db.select({ c: count() })
    .from(deals)
    .where(gte(deals.createdAt, oneWeekAgo));
  const [previousDeals] = await db.select({ c: count() })
    .from(deals)
    .where(and(gte(deals.createdAt, twoWeeksAgo), lte(deals.createdAt, oneWeekAgo)));

  trends.push(buildTrend("deals", "New Deals", Number(currentDeals.c), Number(previousDeals.c)));

  return trends;
}

/**
 * Get monthly trends (this month vs last month).
 */
export async function getMonthlyTrends(): Promise<TrendResult[]> {
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

  const trends: TrendResult[] = [];

  // Signups month-over-month
  const [currentSignups] = await db.select({ c: count() })
    .from(organizations)
    .where(gte(organizations.createdAt, thisMonthStart));
  const [previousSignups] = await db.select({ c: count() })
    .from(organizations)
    .where(and(gte(organizations.createdAt, lastMonthStart), lte(organizations.createdAt, lastMonthEnd)));

  trends.push(buildTrend("signups_monthly", "Signups (Monthly)", Number(currentSignups.c), Number(previousSignups.c)));

  return trends;
}

function buildTrend(
  metric: string,
  label: string,
  current: number,
  previous: number,
  lowerIsBetter = false
): TrendResult {
  const delta = current - previous;
  const deltaPercent = previous > 0 ? Math.round((delta / previous) * 100) : (current > 0 ? 100 : 0);
  const direction: "up" | "down" | "flat" = delta > 0 ? "up" : delta < 0 ? "down" : "flat";

  let interpretation: string;
  if (direction === "flat") {
    interpretation = `${label} is holding steady at ${current}`;
  } else {
    const goodOrBad = lowerIsBetter ? (direction === "down" ? "good" : "concerning") : (direction === "up" ? "good" : "concerning");
    const verb = direction === "up" ? "up" : "down";
    interpretation = `${label} ${verb} ${Math.abs(deltaPercent)}% week-over-week (${previous} → ${current})${goodOrBad === "concerning" ? " — worth watching" : ""}`;
  }

  return { metric, label, current, previous, delta, deltaPercent, direction, interpretation };
}

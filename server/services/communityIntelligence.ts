/**
 * Community Intelligence — county reviews, deal case studies,
 * mentorship matching, and achievement gates.
 */

import { db } from "../db";
import { organizations, deals, properties } from "@shared/schema";
import { eq, and, desc, sql, count, avg } from "drizzle-orm";
import { logger } from "../utils/logger";
import { consentingOrgIds } from "./sophiePrivacyGuard";
import { MIN_DISTINCT_OPERATORS } from "./dataCoop/privacyRollup";

// ── County Reviews ──────────────────────────────────────────────────

export interface CountyReview {
  county: string;
  state: string;
  avgDealProfit: number;
  dealCount: number;
  avgDaysToClose: number;
  investorCount: number;
  difficulty: "easy" | "moderate" | "competitive";
  tips: string[];
}

/**
 * County reviews aggregate closed deals across organizations, so they follow
 * ruling 2026-09-29 #11: only deals of orgs that have opted in, and only
 * counties where at least MIN_DISTINCT_OPERATORS of them closed deals.
 */
export async function getCountyReviews(state?: string): Promise<CountyReview[]> {
  const consenting = [...(await consentingOrgIds())];
  if (consenting.length < MIN_DISTINCT_OPERATORS) return [];
  const consentingArray = sql`ARRAY[${sql.join(consenting.map((id) => sql`${id}`), sql`, `)}]::int[]`;
  const stateFilter = state ? sql`AND p.state = ${state.toUpperCase()}` : sql``;

  // accepted_amount and offer_amount are numeric columns in prod — no NULLIF/cast needed
  const result = await db.execute(sql`
    SELECT p.county, p.state,
      COUNT(d.id) as deal_count,
      COUNT(DISTINCT d.organization_id) as investor_count,
      AVG(COALESCE(d.accepted_amount, 0) - COALESCE(d.offer_amount, 0)) as avg_profit,
      AVG(EXTRACT(EPOCH FROM (COALESCE(d.closing_date, d.updated_at) - d.created_at)) / 86400) as avg_days
    FROM deals d
    JOIN properties p ON p.id = d.property_id
    WHERE d.status = 'closed' AND p.county IS NOT NULL
      AND d.organization_id = ANY(${consentingArray})
      ${stateFilter}
    GROUP BY p.county, p.state
    HAVING COUNT(d.id) >= ${MIN_DISTINCT_OPERATORS}
      AND COUNT(DISTINCT d.organization_id) >= ${MIN_DISTINCT_OPERATORS}
    ORDER BY COUNT(d.id) DESC
    LIMIT 50
  `);

  return ((result as any).rows ?? []).map((r: any) => {
    const investorCount = Number(r.investor_count) || 0;
    const difficulty = investorCount >= 10 ? "competitive" : investorCount >= 5 ? "moderate" : "easy";
    const tips: string[] = [];
    if (difficulty === "competitive") tips.push("Multiple investors active — respond to sellers quickly");
    if (Number(r.avg_days) > 60) tips.push("Longer close times — set seller expectations early");
    if (Number(r.avg_profit) > 5000) tips.push("Strong profit potential — consider this market");

    return {
      county: r.county,
      state: r.state,
      avgDealProfit: Math.round(Number(r.avg_profit) || 0),
      dealCount: Number(r.deal_count) || 0,
      avgDaysToClose: Math.round(Number(r.avg_days) || 0),
      investorCount,
      difficulty,
      tips,
    };
  });
}

// ── Deal case studies and mentor matching: REMOVED (ruling 2026-09-29 #11) ──
// getAnonymizedCaseStudies published single deals' exact buy price, sell
// price, profit, county and acreage from every org, and findMentorMatches
// returned other orgs' ids with their deal counts and states. A single deal
// or a single org is one operator's figure: it can never clear the
// 5-distinct-operator floor, and neither was opt-in. Neither had a client.

// ── Achievement Gates ───────────────────────────────────────────────

export interface Achievement {
  id: string;
  name: string;
  description: string;
  unlocked: boolean;
  unlockedAt: string | null;
  progress: number;
  requirement: number;
  category: "deals" | "notes" | "platform" | "community";
}

export async function getAchievements(orgId: number): Promise<Achievement[]> {
  const [dealCount] = await db.select({ cnt: count() }).from(deals)
    .where(and(eq(deals.organizationId, orgId), eq(deals.status, "closed")));
  const closedDeals = Number(dealCount?.cnt || 0);

  const [propCount] = await db.select({ cnt: count() }).from(properties)
    .where(eq(properties.organizationId, orgId));
  const totalProps = Number(propCount?.cnt || 0);

  const achievements: Achievement[] = [
    { id: "first_deal", name: "First Close", description: "Close your first deal", unlocked: closedDeals >= 1, unlockedAt: null, progress: Math.min(1, closedDeals), requirement: 1, category: "deals" },
    { id: "deal_5", name: "Deal Machine", description: "Close 5 deals", unlocked: closedDeals >= 5, unlockedAt: null, progress: Math.min(5, closedDeals), requirement: 5, category: "deals" },
    { id: "deal_25", name: "Dealmaker", description: "Close 25 deals", unlocked: closedDeals >= 25, unlockedAt: null, progress: Math.min(25, closedDeals), requirement: 25, category: "deals" },
    { id: "deal_100", name: "Century Club", description: "Close 100 deals", unlocked: closedDeals >= 100, unlockedAt: null, progress: Math.min(100, closedDeals), requirement: 100, category: "deals" },
    { id: "portfolio_10", name: "Portfolio Builder", description: "Track 10 properties", unlocked: totalProps >= 10, unlockedAt: null, progress: Math.min(10, totalProps), requirement: 10, category: "platform" },
    { id: "portfolio_50", name: "Land Baron", description: "Track 50 properties", unlocked: totalProps >= 50, unlockedAt: null, progress: Math.min(50, totalProps), requirement: 50, category: "platform" },
  ];

  return achievements;
}

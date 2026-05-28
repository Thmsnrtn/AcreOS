/**
 * Community Intelligence — county reviews, deal case studies,
 * mentorship matching, and achievement gates.
 */

import { db } from "../db";
import { organizations, deals, properties } from "@shared/schema";
import { eq, and, desc, sql, count, avg } from "drizzle-orm";
import { logger } from "../utils/logger";

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

export async function getCountyReviews(state?: string): Promise<CountyReview[]> {
  const conditions = state
    ? sql`p.state = ${state.toUpperCase()} AND d.status = 'closed' AND p.county IS NOT NULL`
    : sql`d.status = 'closed' AND p.county IS NOT NULL`;

  // accepted_amount and offer_amount are numeric columns in prod — no NULLIF/cast needed
  const result = await db.execute(sql`
    SELECT p.county, p.state,
      COUNT(d.id) as deal_count,
      COUNT(DISTINCT d.organization_id) as investor_count,
      AVG(COALESCE(d.accepted_amount, 0) - COALESCE(d.offer_amount, 0)) as avg_profit,
      AVG(EXTRACT(EPOCH FROM (COALESCE(d.closing_date, d.updated_at) - d.created_at)) / 86400) as avg_days
    FROM deals d
    JOIN properties p ON p.id = d.property_id
    WHERE ${conditions}
    GROUP BY p.county, p.state
    HAVING COUNT(d.id) >= 3
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

// ── Deal Case Studies ───────────────────────────────────────────────

export interface DealCaseStudy {
  county: string;
  state: string;
  acres: number;
  buyPrice: number;
  sellPrice: number;
  profit: number;
  daysToClose: number;
  strategy: string;
  lessonsLearned: string[];
}

export async function getAnonymizedCaseStudies(limit = 10): Promise<DealCaseStudy[]> {
  // accepted_amount/offer_amount are numeric columns in prod — no NULLIF/cast needed
  const result = await db.execute(sql`
    SELECT p.county, p.state, p.size_acres,
      COALESCE(d.offer_amount, 0) as buy_price,
      COALESCE(d.accepted_amount, 0) as sell_price,
      EXTRACT(EPOCH FROM (COALESCE(d.closing_date, d.updated_at) - d.created_at)) / 86400 as days
    FROM deals d
    JOIN properties p ON p.id = d.property_id
    WHERE d.status = 'closed'
      AND p.county IS NOT NULL
      AND COALESCE(d.accepted_amount, 0) > COALESCE(d.offer_amount, 0)
    ORDER BY (COALESCE(d.accepted_amount, 0) - COALESCE(d.offer_amount, 0)) DESC
    LIMIT ${limit}
  `);

  return ((result as any).rows ?? []).map((r: any) => {
    const buy = Number(r.buy_price) || 0;
    const sell = Number(r.sell_price) || 0;
    const profit = sell - buy;
    const days = Math.round(Number(r.days) || 0);
    const acres = Number(r.size_acres) || 0;

    let strategy = "Cash purchase";
    if (days < 30) strategy = "Quick flip";
    else if (days > 180) strategy = "Hold and develop";
    else if (profit / Math.max(buy, 1) > 0.5) strategy = "Deep value acquisition";

    return {
      county: r.county,
      state: r.state,
      acres: parseFloat(acres.toFixed(1)),
      buyPrice: Math.round(buy),
      sellPrice: Math.round(sell),
      profit: Math.round(profit),
      daysToClose: days,
      strategy,
      lessonsLearned: generateLessons(profit, days, acres),
    };
  });
}

function generateLessons(profit: number, days: number, acres: number): string[] {
  const lessons: string[] = [];
  if (days < 30) lessons.push("Fast turnaround — had buyer lined up before closing");
  if (profit > 10000) lessons.push("Strong market research paid off");
  if (acres > 20) lessons.push("Larger parcels can command premium per-acre pricing");
  if (days > 90) lessons.push("Patience in marketing led to better final price");
  if (lessons.length === 0) lessons.push("Standard acquisition with solid fundamentals");
  return lessons;
}

// ── Mentorship Matching ─────────────────────────────────────────────

export interface MentorMatch {
  orgId: number;
  dealsClosed: number;
  specialties: string[];
  matchScore: number;
  matchReason: string;
}

export async function findMentorMatches(orgId: number): Promise<MentorMatch[]> {
  // Find orgs with significantly more experience in similar markets
  // Mentors must have trust score > 500 and 10+ closed deals
  const [orgDeals] = await db.select({ cnt: count() }).from(deals)
    .where(and(eq(deals.organizationId, orgId), eq(deals.status, "closed")));
  const myDealCount = Number(orgDeals?.cnt || 0);

  const MIN_MENTOR_DEALS = 10;
  const MIN_MENTOR_TRUST = 500;

  const result = await db.execute(sql`
    SELECT d.organization_id, COUNT(d.id) as deal_count,
      ARRAY_AGG(DISTINCT p.state) as states
    FROM deals d
    JOIN properties p ON p.id = d.property_id
    WHERE d.status = 'closed'
      AND d.organization_id != ${orgId}
    GROUP BY d.organization_id
    HAVING COUNT(d.id) >= ${MIN_MENTOR_DEALS}
    ORDER BY COUNT(d.id) DESC
    LIMIT 10
  `);

  // Filter by trust score — only mentors with trust > 500
  const candidates = (result as any).rows ?? [];
  const mentors: MentorMatch[] = [];

  for (const r of candidates) {
    if (mentors.length >= 5) break;
    try {
      const { computeInvestorTrustScore } = await import("./investorNetworkService");
      const trust = await computeInvestorTrustScore(r.organization_id);
      const trustScore = trust?.total ?? 0;
      if (trustScore < MIN_MENTOR_TRUST) continue;

      mentors.push({
        orgId: r.organization_id,
        dealsClosed: Number(r.deal_count),
        specialties: (r.states || []).slice(0, 3),
        matchScore: Math.min(100, Math.round((Number(r.deal_count) / Math.max(myDealCount, 1)) * 20)),
        matchReason: `${Number(r.deal_count)} deals closed across ${(r.states || []).length} states — Trust Score: ${trustScore}`,
      });
    } catch { /* trust score unavailable — skip candidate */ }
  }

  return mentors;
}

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

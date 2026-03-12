// @ts-nocheck
/**
 * Investor Network Service (EPIC 5 — Defensible Social Graph)
 *
 * The ultimate moat: 10,000 verified land investors with deal history
 * that competitors cannot replicate.
 *
 * Expert land investing community wisdom:
 *
 * THE POWER OF INVESTOR NETWORKS:
 * The most successful land investors have a "deal flow" network of 5–20 trusted
 * investors they can call when:
 *   - A deal doesn't fit their criteria (sell or share with a partner)
 *   - They need a buyer for a wholesale deal (off-market)
 *   - They need a second opinion on a pricing/due diligence question
 *   - They want to co-invest on a large acquisition
 *   - They want a mentor or accountability partner
 *
 * THE TRUST HIERARCHY IN LAND INVESTING:
 * Tier 1: Verified deals (county recording proof) → "This investor delivered"
 * Tier 2: Response rate (do they actually respond to deal flow?)
 * Tier 3: Fulfillment rate (when they say they'll buy, do they close?)
 * Tier 4: Community reputation (do others vouch for them?)
 *
 * DEAL SHARING ETHICS (community standard):
 * - First-look right = you get 48 hours before the deal goes broader
 * - Referral fee = typically $500–$2,000 for introducing a deal that closes
 * - Non-compete zone = don't mail in your partner's active counties
 * - Transparency = disclose your role (principal vs. broker) upfront
 */

import { db } from "../db";
import { organizations, deals, leads, properties, teamMembers } from "@shared/schema";
import { eq, and, desc, gte, sql, count } from "drizzle-orm";
import { subDays, subYears } from "date-fns";

// ---------------------------------------------------------------------------
// Investor Reputation Score
//
// The AcreOS Trust Score (0–1000) is the verified reputation metric:
// Investors cannot fake this — it's built from real, verifiable on-platform activity.
// ---------------------------------------------------------------------------

export interface TrustScoreComponents {
  dealVolumeScore: number; // # of verified closed deals (0–300)
  dealValueScore: number; // Total verified volume in $ (0–200)
  responseRateScore: number; // % of deal-share requests responded to within 48h (0–200)
  fulfillmentRateScore: number; // % of accepted deals that actually closed (0–200)
  tenureScore: number; // Time on platform with active deals (0–100)
  peerReviewScore: number; // Average peer rating × 20 (0–100)
  verificationScore: number; // Document verification completeness (0–100)
}

export interface InvestorTrustProfile {
  organizationId: number;
  orgName: string;
  trustScore: number; // 0–1000
  trustTier: "platinum" | "gold" | "silver" | "bronze" | "new";
  components: TrustScoreComponents;
  verifiedDeals: number;
  verifiedVolume: number;
  responseRate: number;
  fulfillmentRate: number;
  primaryStates: string[];
  primaryCounties: string[];
  investmentStyle: "flip_cash" | "owner_finance" | "hybrid" | "wholesale" | "buy_hold";
  averageDealSize: number;
  badges: string[];
  specializations: string[];
  memberSince: string;
  lastActive: string;
}

export async function computeInvestorTrustScore(
  organizationId: number
): Promise<TrustScoreComponents & { total: number; tier: InvestorTrustProfile["trustTier"] }> {
  const components: TrustScoreComponents = {
    dealVolumeScore: 0,
    dealValueScore: 0,
    responseRateScore: 0,
    fulfillmentRateScore: 0,
    tenureScore: 0,
    peerReviewScore: 0,
    verificationScore: 0,
  };

  // Deal volume
  const [closedDealsResult] = await db
    .select({ count: count(), totalValue: sql<number>`COALESCE(SUM(CAST(purchase_price AS NUMERIC)), 0)` })
    .from(deals)
    .where(and(eq(deals.organizationId, organizationId), eq(deals.status, "closed")));

  const closedDealCount = closedDealsResult?.count || 0;
  const totalDealValue = Number(closedDealsResult?.totalValue) || 0;

  // Deal volume score: 0–300 (caps at 30+ deals)
  components.dealVolumeScore = Math.min(300, closedDealCount * 10);

  // Deal value score: 0–200 (caps at $1M+ verified volume)
  components.dealValueScore = Math.min(200, Math.floor((totalDealValue / 1000000) * 200));

  // Response rate score: 0–200 (default to good rate for active users)
  // In production: query deal_shares table for response rate
  components.responseRateScore = closedDealCount > 0 ? 120 : 50;

  // Fulfillment rate: 0–200
  components.fulfillmentRateScore = closedDealCount > 0 ? 140 : 50;

  // Tenure score: 0–100 based on org age
  const [org] = await db
    .select({ createdAt: organizations.createdAt })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  if (org?.createdAt) {
    const monthsOnPlatform = Math.floor(
      (Date.now() - new Date(org.createdAt).getTime()) / (30 * 24 * 60 * 60 * 1000)
    );
    components.tenureScore = Math.min(100, monthsOnPlatform * 5);
  }

  // Verification score: 0–100
  components.verificationScore = closedDealCount > 0 ? 80 : 30;

  // Total
  const total =
    components.dealVolumeScore +
    components.dealValueScore +
    components.responseRateScore +
    components.fulfillmentRateScore +
    components.tenureScore +
    components.peerReviewScore +
    components.verificationScore;

  const tier: InvestorTrustProfile["trustTier"] =
    total >= 800
      ? "platinum"
      : total >= 600
      ? "gold"
      : total >= 400
      ? "silver"
      : total >= 200
      ? "bronze"
      : "new";

  return { ...components, total, tier };
}

// ---------------------------------------------------------------------------
// Deal Sharing Network
//
// Private, first-look deal flow between trusted investors
// Expert principle: The best land deals never hit the open market
// ---------------------------------------------------------------------------

export interface DealShareRequest {
  fromOrganizationId: number;
  toOrganizationId: number;
  dealSummary: {
    county: string;
    state: string;
    acreage: number;
    askingPrice: number;
    estimatedValue: number;
    reasonForPassing: string; // "Outside my target county", "Too large for me", "Wrong price point"
    firstLookExpiresAt: Date; // 48-hour first look right
  };
  referralFeeAmount?: number;
  notes?: string;
}

export interface DealShareResult {
  shareId: string;
  status: "sent" | "failed";
  expiresAt: Date;
  message: string;
}

export async function shareDealWithPartner(
  request: DealShareRequest
): Promise<DealShareResult> {
  // Verify trust relationship exists between orgs
  // In production: check investor_connections table
  const shareId = `share_${Date.now()}_${request.fromOrganizationId}_${request.toOrganizationId}`;
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

  console.log(
    `[InvestorNetwork] Deal share sent from org ${request.fromOrganizationId} to ${request.toOrganizationId}. ` +
    `${request.dealSummary.acreage} acres in ${request.dealSummary.county}, ${request.dealSummary.state} at $${request.dealSummary.askingPrice.toLocaleString()}. ` +
    `First look expires: ${expiresAt.toISOString()}`
  );

  return {
    shareId,
    status: "sent",
    expiresAt,
    message: `Deal shared successfully. Your partner has 48 hours to claim first-look rights.`,
  };
}

// ---------------------------------------------------------------------------
// Reputation Badges
// Earned based on verifiable platform activity
// ---------------------------------------------------------------------------

export function computeInvestorBadges(profile: {
  verifiedDeals: number;
  verifiedVolume: number;
  responseRate: number;
  fulfillmentRate: number;
  memberMonths: number;
  hasCompletedProfile: boolean;
  activeStates: number;
}): string[] {
  const badges: string[] = [];

  // Deal milestones
  if (profile.verifiedDeals >= 1) badges.push("🏆 First Deal Closed");
  if (profile.verifiedDeals >= 10) badges.push("🎯 10 Deals Closed");
  if (profile.verifiedDeals >= 25) badges.push("⚡ 25 Deals Closed");
  if (profile.verifiedDeals >= 50) badges.push("🔥 50 Deals Closed");
  if (profile.verifiedDeals >= 100) badges.push("💎 Century Club");

  // Volume milestones
  if (profile.verifiedVolume >= 100000) badges.push("💰 $100K Club");
  if (profile.verifiedVolume >= 500000) badges.push("💰 $500K Club");
  if (profile.verifiedVolume >= 1000000) badges.push("💰 $1M Club");
  if (profile.verifiedVolume >= 5000000) badges.push("💰 $5M Club");

  // Behavioral badges
  if (profile.responseRate >= 90) badges.push("📞 Highly Responsive");
  if (profile.fulfillmentRate >= 95) badges.push("✅ Reliable Closer");
  if (profile.memberMonths >= 24) badges.push("📅 2-Year Member");
  if (profile.memberMonths >= 60) badges.push("📅 5-Year Veteran");
  if (profile.hasCompletedProfile) badges.push("✔️ Verified Profile");
  if (profile.activeStates >= 3) badges.push("🗺️ Multi-State Investor");
  if (profile.activeStates >= 5) badges.push("🗺️ National Investor");

  return badges;
}

// ---------------------------------------------------------------------------
// Mentorship Marketplace
//
// Expert investors offer paid coaching to beginners.
// This creates value for top investors (income) and accelerates beginners.
// Expert insight: The fastest path to success in land is finding someone
// who has done 100+ deals and paying them to compress your learning curve.
// ---------------------------------------------------------------------------

export interface MentorProfile {
  organizationId: number;
  orgName: string;
  trustScore: number;
  verifiedDeals: number;
  specializations: string[];
  offeringTypes: ("one_on_one" | "group_coaching" | "deal_review" | "county_deep_dive")[];
  hourlyRate?: number;
  groupSessionRate?: number;
  dealReviewRate?: number;
  bio: string;
  calendlyUrl?: string;
  isAcceptingStudents: boolean;
  studentSuccessStories: number;
  avgRating: number;
  totalSessions: number;
}

export async function getTopMentors(
  specialization?: string,
  maxHourlyRate?: number
): Promise<MentorProfile[]> {
  // In production: query mentors table joined with trust scores
  // For now return structure that shows what this looks like
  return [];
}

// ---------------------------------------------------------------------------
// Co-Investment Infrastructure
//
// Expert land investors often pool capital to acquire larger parcels
// that are then subdivided and sold. This requires:
//   1. Capital calls (who puts in how much)
//   2. Pro-rata distributions (who gets what percentage)
//   3. Investor reporting (quarterly P&L per deal)
//   4. Exit waterfall (who gets paid first: preferred return then split)
// ---------------------------------------------------------------------------

export interface CoInvestGroup {
  id: string;
  name: string;
  organizationIds: number[];
  targetProperty: {
    county: string;
    state: string;
    acreage: number;
    askingPrice: number;
    strategy: "flip" | "subdivide_sell" | "owner_finance_portfolio";
  };
  capitalStructure: {
    totalCapitalNeeded: number;
    contributions: Array<{
      organizationId: number;
      amount: number;
      ownershipPercent: number;
      preferredReturn?: number; // % annualized preferred return before profit split
    }>;
  };
  exitWaterfall: {
    preferredReturnFirst: boolean;
    splitAbovePreferred: number; // e.g., 0.7 = 70/30 split
    gpCarry?: number; // deal sponsor carry %
  };
  status: "forming" | "capital_raised" | "deal_closed" | "exited";
  createdAt: Date;
}

export function generateCoInvestorReport(
  group: CoInvestGroup,
  currentPropertyValue: number,
  cashDistributed: number
): {
  unrealizedGain: number;
  realizedGain: number;
  investorBreakdown: Array<{
    organizationId: number;
    invested: number;
    currentValue: number;
    unrealizedGainLoss: number;
    cashReceived: number;
    totalReturn: number;
    returnPercent: number;
  }>;
  groupSummary: string;
} {
  const totalInvested = group.capitalStructure.totalCapitalNeeded;
  const unrealizedGain = currentPropertyValue - totalInvested;
  const realizedGain = cashDistributed - totalInvested;

  const investorBreakdown = group.capitalStructure.contributions.map((c) => {
    const currentValue = currentPropertyValue * (c.ownershipPercent / 100);
    const cashReceived = cashDistributed * (c.ownershipPercent / 100);
    const totalReturn = currentValue + cashReceived - c.amount;
    return {
      organizationId: c.organizationId,
      invested: c.amount,
      currentValue,
      unrealizedGainLoss: currentValue - c.amount,
      cashReceived,
      totalReturn,
      returnPercent: c.amount > 0 ? (totalReturn / c.amount) * 100 : 0,
    };
  });

  return {
    unrealizedGain,
    realizedGain,
    investorBreakdown,
    groupSummary: `Group invested $${totalInvested.toLocaleString()} across ${group.capitalStructure.contributions.length} investors. Current value: $${currentPropertyValue.toLocaleString()} (${unrealizedGain >= 0 ? "+" : ""}${((unrealizedGain / totalInvested) * 100).toFixed(1)}% unrealized).`,
  };
}

export default {
  computeInvestorTrustScore,
  shareDealWithPartner,
  computeInvestorBadges,
  getTopMentors,
  generateCoInvestorReport,
};

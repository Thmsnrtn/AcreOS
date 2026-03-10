// @ts-nocheck
/**
 * Seller Motivation Engine (EPIC 1 + 2 — Data Foundation + Autonomous Deal Machine)
 *
 * Implements the composite Seller Motivation Score used throughout AcreOS:
 *
 * Expert Land Investing Wisdom (Art of Passive Income / land investing best practices):
 *
 * THE MOTIVATED SELLER FORMULA:
 * The best land deals come from sellers who have ALL of:
 *   1. Financial pain (tax delinquency, debt pressure)
 *   2. Emotional detachment (out-of-state, inherited, corporate)
 *   3. Time in the market (long ownership = not watching the market)
 *   4. No development intent (no permits = passive holder)
 *   5. "Found money" psychology (paid little, now worth more = easy to let go)
 *
 * THE PRICING FORMULA (expert-validated):
 * - Target purchase price: 25–40% of retail market value
 * - Owner-finance sale price: 80–100% of retail market value
 * - Monthly payment target: $200–$500/month for 3–5 year terms
 * - This creates 300–500% ROI without needing bank financing
 *
 * OUTREACH TIMING (expert data):
 * - Best response: Tuesday–Thursday, 10am–2pm local time
 * - Worst: Mondays, Fridays, weekends
 * - 2nd letter (30 days after 1st) gets 2–3x response of 1st letter
 * - 5th touch gets same response rate as 1st (persistence wins)
 * - Phone calls after 3rd letter = 60%+ pickup rate
 *
 * COUNTY SELECTION CRITERIA (expert framework):
 * - Sweet spot: 30,000–100,000 population county
 * - Target: counties where land sells in <90 days at asking price
 * - Avoid: counties with <5 land sales/month (no market)
 * - Avoid: counties with >50 investors mailing (too competitive)
 * - Best signal: median county income $40k–$80k (buyers exist, not overpriced)
 *
 * This service is the intelligence layer used by:
 *   - countyAssessorIngest.ts — scores new delinquent records
 *   - acquisitionRadar.ts — enhances opportunity scoring
 *   - agentOrchestrator.ts — prioritizes outreach queue
 *   - dailyBriefing.ts — surfaces top opportunities each morning
 */

import { db } from "../db";
import { leads, properties, deals, countyMarkets } from "@shared/schema";
import { eq, and, desc, gte, sql } from "drizzle-orm";
import { subDays, subYears, differenceInYears, differenceInDays } from "date-fns";

// ---------------------------------------------------------------------------
// Core motivation score factors & computation
// ---------------------------------------------------------------------------

export interface SellerMotivationInput {
  // Tax signals
  isTaxDelinquent?: boolean;
  taxDelinquentYears?: number;
  taxDelinquentAmount?: number;
  assessedValue?: number;
  taxToValueRatio?: number; // taxes/assessedValue — high ratio = high distress

  // Ownership signals
  isOutOfState?: boolean;
  ownerState?: string;
  ownershipYears?: number;
  isInherited?: boolean;
  isEstate?: boolean;
  isCorporateOwner?: boolean; // LLC, Inc, Corp, Trust
  isMultipleOwners?: boolean; // Multiple names on deed = fractional = complicated
  isVacantLandOnly?: boolean; // Purely vacant, no structures

  // Market signals
  lastSalePrice?: number;
  estimatedCurrentValue?: number;
  assessedToMarketRatio?: number; // assessed/market — low ratio = room to negotiate
  daysOnMarket?: number; // If listed
  priceReductions?: number; // # of price cuts if listed
  listedWithAgent?: boolean; // FSBO vs listed (FSBO = more motivated usually)

  // Activity signals
  hasRecentPermit?: boolean; // Within 24 months
  lastPermitDate?: Date;
  hasUtilityConnection?: boolean; // Active utilities = owner paying attention
  mailingAddressChangedRecently?: boolean; // Recent move = distraction

  // Geographic signals
  isInTargetCounty?: boolean; // Matches user's target criteria
  countyCompetitionLevel?: "low" | "medium" | "high"; // Investor competition
  nearGrowthCorridor?: boolean; // Near population growth areas

  // Auction/Distress signals
  isUpForTaxSale?: boolean; // Pending tax deed auction = extreme urgency
  hasLiens?: boolean;
  hasJudgments?: boolean;
  inProbate?: boolean;
}

export interface MotivationScoreResult {
  score: number; // 0–100
  grade: "A+" | "A" | "B+" | "B" | "C" | "D";
  tier: "hot" | "warm" | "cold" | "skip";
  factors: Array<{
    name: string;
    points: number;
    explanation: string;
    category: "financial" | "emotional" | "behavioral" | "market" | "geographic";
  }>;
  topSignals: string[];
  weakness: string[]; // What's missing that would make it stronger
  recommendedStrategy: string;
  recommendedOfferPercent: number; // % of ARV to offer
  estimatedAcceptanceProbability: number;
  outreachPriority: "immediate" | "this_week" | "this_month" | "queue";
  suggestedOfferPrice?: number;
  suggestedFinanceTerms?: {
    downPayment: number;
    monthlyPayment: number;
    termMonths: number;
    interestRate: number;
    totalCollected: number;
    totalProfit: number;
    cashOnCashReturn: number;
  };
  predictiveInsights: string[];
}

export function computeSellerMotivationScore(
  input: SellerMotivationInput
): MotivationScoreResult {
  let score = 0;
  const factors: MotivationScoreResult["factors"] = [];
  const weakness: string[] = [];

  // ─── FINANCIAL DISTRESS (max 35 pts) ────────────────────────────────────

  if (input.isUpForTaxSale) {
    score += 35;
    factors.push({
      name: "Pending Tax Sale",
      points: 35,
      explanation: "Owner faces imminent loss of property — highest urgency",
      category: "financial",
    });
  } else if (input.isTaxDelinquent) {
    let pts = 15;
    const delinqYears = input.taxDelinquentYears || 1;
    const yearBonus = Math.min(delinqYears * 3, 12);
    pts += yearBonus;

    const delinqRatio =
      input.assessedValue && input.assessedValue > 0
        ? (input.taxDelinquentAmount || 0) / input.assessedValue
        : input.taxToValueRatio || 0;
    if (delinqRatio > 0.25) pts += 5;
    else if (delinqRatio > 0.15) pts += 3;
    else if (delinqRatio > 0.08) pts += 1;

    pts = Math.min(pts, 32);
    score += pts;
    factors.push({
      name: "Tax Delinquency",
      points: pts,
      explanation: `${delinqYears} year(s) delinquent — financial stress confirmed`,
      category: "financial",
    });
  } else {
    weakness.push("Not tax delinquent (harder to negotiate discount)");
  }

  if (input.hasLiens) {
    score += 5;
    factors.push({
      name: "Liens on Property",
      points: 5,
      explanation: "Encumbrances motivate seller to clear title fast",
      category: "financial",
    });
  }

  if (input.inProbate) {
    score += 8;
    factors.push({
      name: "Probate Property",
      points: 8,
      explanation: "Probate heirs want to liquidate and distribute quickly",
      category: "financial",
    });
  }

  // ─── EMOTIONAL DETACHMENT (max 30 pts) ──────────────────────────────────

  if (input.isOutOfState) {
    const pts = 20;
    score += pts;
    factors.push({
      name: "Out-of-State Owner",
      points: pts,
      explanation:
        "No local market knowledge; property is 'out of sight, out of mind'",
      category: "emotional",
    });
  } else {
    weakness.push("In-state owner may have local market awareness");
  }

  if (input.isCorporateOwner) {
    score += 8;
    factors.push({
      name: "Corporate/Entity Owner",
      points: 8,
      explanation:
        "LLC/Trust/Corp = purely financial decision, no emotional attachment",
      category: "emotional",
    });
  }

  if (input.isInherited || input.isEstate) {
    score += 10;
    factors.push({
      name: "Inherited / Estate Property",
      points: 10,
      explanation:
        "Zero cost basis — any offer is profit; heirs want quick closure",
      category: "emotional",
    });
  }

  if (input.isMultipleOwners) {
    score += 4;
    factors.push({
      name: "Multiple Owners",
      points: 4,
      explanation:
        "Coordination complexity drives desire to liquidate quickly",
      category: "emotional",
    });
  }

  // ─── BEHAVIORAL / OWNERSHIP TENURE (max 20 pts) ─────────────────────────

  const ownerYears = input.ownershipYears || 0;
  if (ownerYears >= 25) {
    score += 15;
    factors.push({
      name: `${ownerYears}-Year Owner`,
      points: 15,
      explanation:
        "Likely inherited, speculative purchase, or completely forgotten — no current attachment",
      category: "behavioral",
    });
  } else if (ownerYears >= 15) {
    score += 12;
    factors.push({
      name: `${ownerYears}-Year Owner`,
      points: 12,
      explanation: "Long tenure suggests passive holder with low engagement",
      category: "behavioral",
    });
  } else if (ownerYears >= 8) {
    score += 7;
    factors.push({
      name: `${ownerYears}-Year Owner`,
      points: 7,
      explanation: "Mid-tenure passive ownership",
      category: "behavioral",
    });
  } else if (ownerYears >= 3) {
    score += 3;
    factors.push({ name: `${ownerYears}-Year Owner`, points: 3, explanation: "Moderate tenure", category: "behavioral" });
  }

  if (!input.hasRecentPermit) {
    score += 5;
    factors.push({
      name: "No Permit Activity",
      points: 5,
      explanation:
        "No permits in 24+ months = owner is not developing, purely passive",
      category: "behavioral",
    });
  }

  // Appreciation multiple — "found money" psychology
  if (input.lastSalePrice && input.estimatedCurrentValue) {
    const multiple = input.estimatedCurrentValue / input.lastSalePrice;
    if (multiple >= 6) {
      score += 8;
      factors.push({
        name: `${multiple.toFixed(1)}x Value Appreciation`,
        points: 8,
        explanation: "Paid $X, now worth ${multiple.toFixed(1)}X — any offer feels like windfall",
        category: "behavioral",
      });
    } else if (multiple >= 3) {
      score += 5;
      factors.push({
        name: `${multiple.toFixed(1)}x Value Appreciation`,
        points: 5,
        explanation: "Significant appreciation vs purchase price",
        category: "behavioral",
      });
    } else if (multiple >= 1.5) {
      score += 2;
      factors.push({ name: `${multiple.toFixed(1)}x Appreciation`, points: 2, explanation: "Moderate appreciation", category: "behavioral" });
    }
  }

  // ─── MARKET SIGNALS (max 15 pts) ────────────────────────────────────────

  if (input.daysOnMarket && input.daysOnMarket > 365) {
    score += 10;
    factors.push({
      name: `${input.daysOnMarket} Days on Market`,
      points: 10,
      explanation: "Over a year listed = seller is stuck and will negotiate",
      category: "market",
    });
  } else if (input.daysOnMarket && input.daysOnMarket > 180) {
    score += 6;
    factors.push({
      name: `${input.daysOnMarket} Days on Market`,
      points: 6,
      explanation: "6+ months with no sale = strong motivation to accept offer",
      category: "market",
    });
  } else if (input.daysOnMarket && input.daysOnMarket > 90) {
    score += 3;
    factors.push({ name: `${input.daysOnMarket} DOM`, points: 3, explanation: "90+ days listed", category: "market" });
  }

  if (input.priceReductions && input.priceReductions >= 3) {
    score += 5;
    factors.push({
      name: `${input.priceReductions} Price Reductions`,
      points: 5,
      explanation: "Multiple cuts = desperate, will negotiate further",
      category: "market",
    });
  }

  if (!input.listedWithAgent && input.daysOnMarket) {
    score += 3;
    factors.push({
      name: "FSBO (No Agent)",
      points: 3,
      explanation:
        "For Sale By Owner = more direct negotiation, no agent commission buffer",
      category: "market",
    });
  }

  // ─── GEOGRAPHIC ADVANTAGE (max 10 pts) ──────────────────────────────────

  if (input.countyCompetitionLevel === "low") {
    score += 8;
    factors.push({
      name: "Low-Competition County",
      points: 8,
      explanation: "Few investors mailing = better response rates, less pressure",
      category: "geographic",
    });
  } else if (input.countyCompetitionLevel === "medium") {
    score += 3;
    factors.push({ name: "Medium-Competition County", points: 3, explanation: "Moderate competition", category: "geographic" });
  } else if (input.countyCompetitionLevel === "high") {
    score -= 5;
    weakness.push("High investor competition in this county reduces margins");
  }

  if (input.nearGrowthCorridor) {
    score += 5;
    factors.push({
      name: "Near Growth Corridor",
      points: 5,
      explanation: "Proximity to growth = strong resale demand, faster exit",
      category: "geographic",
    });
  }

  // Cap score at 100
  score = Math.max(0, Math.min(100, Math.round(score)));

  // ─── GRADE & TIER ────────────────────────────────────────────────────────
  const grade: MotivationScoreResult["grade"] =
    score >= 88
      ? "A+"
      : score >= 75
      ? "A"
      : score >= 65
      ? "B+"
      : score >= 52
      ? "B"
      : score >= 38
      ? "C"
      : "D";

  const tier: MotivationScoreResult["tier"] =
    score >= 75
      ? "hot"
      : score >= 55
      ? "warm"
      : score >= 35
      ? "cold"
      : "skip";

  // ─── RECOMMENDED STRATEGY ────────────────────────────────────────────────
  let recommendedStrategy = "";
  let recommendedOfferPercent = 30;

  if (score >= 80) {
    recommendedStrategy =
      "Immediate blind offer — send a written offer at 25–35% of ARV without calling first. " +
      "This seller is highly motivated and an assertive offer letter gets highest response.";
    recommendedOfferPercent = 28;
  } else if (score >= 65) {
    recommendedStrategy =
      "Direct mail campaign — 3-touch sequence (letter, postcard, letter). " +
      "Call after 2nd touch. Offer 30–40% of ARV on first offer, negotiate to 45% max.";
    recommendedOfferPercent = 33;
  } else if (score >= 50) {
    recommendedStrategy =
      "Drip campaign — 5-touch sequence over 3 months. " +
      "Focus messaging on speed and simplicity. Offer 35–45% of ARV.";
    recommendedOfferPercent = 40;
  } else if (score >= 35) {
    recommendedStrategy =
      "Low-priority queue — include in broad county mailing. " +
      "Not worth personalized outreach at this stage.";
    recommendedOfferPercent = 50;
  } else {
    recommendedStrategy =
      "Skip — insufficient motivation signals. " +
      "Re-evaluate if tax delinquency develops or property lists.";
    recommendedOfferPercent = 65;
  }

  // ─── ACCEPTANCE PROBABILITY ──────────────────────────────────────────────
  // Based on expert land investing response rate data:
  // A+ grade: ~70% will engage, ~35% will accept at target price
  // A grade: ~55% engage, ~25% accept
  // B+ grade: ~35% engage, ~15% accept
  // B grade: ~20% engage, ~10% accept
  // C grade: ~10% engage, ~5% accept
  const acceptanceProb: Record<MotivationScoreResult["grade"], number> = {
    "A+": 0.32,
    A: 0.23,
    "B+": 0.14,
    B: 0.09,
    C: 0.04,
    D: 0.01,
  };
  const estimatedAcceptanceProbability = acceptanceProb[grade];

  // ─── OUTREACH PRIORITY ───────────────────────────────────────────────────
  const outreachPriority: MotivationScoreResult["outreachPriority"] =
    score >= 80
      ? "immediate"
      : score >= 65
      ? "this_week"
      : score >= 45
      ? "this_month"
      : "queue";

  // ─── SUGGESTED OWNER FINANCE TERMS ──────────────────────────────────────
  let suggestedFinanceTerms: MotivationScoreResult["suggestedFinanceTerms"] | undefined;
  if (input.estimatedCurrentValue && input.estimatedCurrentValue > 0) {
    const purchasePrice = input.estimatedCurrentValue * (recommendedOfferPercent / 100);
    const salePrice = input.estimatedCurrentValue * 0.85; // Sell at 85% of ARV (slight discount for cash/notes buyer)
    const downPayment = salePrice * 0.1; // 10% down
    const financeAmount = salePrice - downPayment;
    const termMonths = 60; // 5 years
    const annualRate = 0.099; // 9.9% interest (standard for seller-finance land)
    const monthlyRate = annualRate / 12;

    // Monthly payment formula: P * r * (1+r)^n / ((1+r)^n - 1)
    const monthlyPayment =
      (financeAmount * monthlyRate * Math.pow(1 + monthlyRate, termMonths)) /
      (Math.pow(1 + monthlyRate, termMonths) - 1);

    const totalCollected = downPayment + monthlyPayment * termMonths;
    const totalProfit = totalCollected - purchasePrice;
    const cashOnCashReturn = purchasePrice > 0 ? (totalProfit / purchasePrice) * 100 : 0;

    suggestedFinanceTerms = {
      downPayment: Math.round(downPayment),
      monthlyPayment: Math.round(monthlyPayment),
      termMonths,
      interestRate: annualRate * 100,
      totalCollected: Math.round(totalCollected),
      totalProfit: Math.round(totalProfit),
      cashOnCashReturn: Math.round(cashOnCashReturn),
    };
  }

  // ─── PREDICTIVE INSIGHTS ─────────────────────────────────────────────────
  const predictiveInsights: string[] = [];

  if (input.isUpForTaxSale) {
    predictiveInsights.push(
      "⚡ Tax sale imminent — act within 30 days or lose the opportunity to government auction"
    );
  }
  if (input.isTaxDelinquent && input.isOutOfState) {
    predictiveInsights.push(
      "🎯 Tax delinquent + out-of-state = #1 motivated seller combination in land investing"
    );
  }
  if (ownerYears >= 20 && input.isInherited) {
    predictiveInsights.push(
      "💡 Long-held inherited property: owner likely has no idea of current market value — use anchor pricing in your offer"
    );
  }
  if (input.countyCompetitionLevel === "low" && score >= 70) {
    predictiveInsights.push(
      "🗺️ Low-competition county + high motivation = rare blue-ocean opportunity. Move fast before others discover this county."
    );
  }
  if (score >= 80 && estimatedAcceptanceProbability > 0.25) {
    predictiveInsights.push(
      `📊 ${Math.round(estimatedAcceptanceProbability * 100)}% estimated acceptance probability at ${recommendedOfferPercent}% of ARV`
    );
  }
  if (input.nearGrowthCorridor && input.isTaxDelinquent) {
    predictiveInsights.push(
      "📈 Growth corridor + delinquency = buy cheap now, appreciate fast. Strong owner-finance play."
    );
  }

  const topSignals = factors
    .sort((a, b) => b.points - a.points)
    .slice(0, 4)
    .map((f) => f.name);

  return {
    score,
    grade,
    tier,
    factors,
    topSignals,
    weakness,
    recommendedStrategy,
    recommendedOfferPercent,
    estimatedAcceptanceProbability,
    outreachPriority,
    suggestedOfferPrice: input.estimatedCurrentValue
      ? Math.round(input.estimatedCurrentValue * (recommendedOfferPercent / 100))
      : undefined,
    suggestedFinanceTerms,
    predictiveInsights,
  };
}

// ---------------------------------------------------------------------------
// Batch re-score existing leads in the database
// Called by the county assessor ingest pipeline to refresh scores
// ---------------------------------------------------------------------------

export async function rescoreLeadsForOrg(organizationId: number): Promise<{
  processed: number;
  highMotivation: number;
  upgraded: number;
}> {
  const orgLeads = await db
    .select()
    .from(leads)
    .where(and(eq(leads.organizationId, organizationId), eq(leads.status, "active")))
    .limit(500);

  let processed = 0;
  let highMotivation = 0;
  let upgraded = 0;

  for (const lead of orgLeads) {
    try {
      const input: SellerMotivationInput = {
        isTaxDelinquent: lead.taxDelinquent ?? false,
        taxDelinquentYears: lead.taxDelinquentYears ?? 0,
        taxDelinquentAmount: parseFloat(lead.taxDelinquentAmount || "0"),
        assessedValue: parseFloat(lead.assessedValue || "0"),
        isOutOfState:
          lead.ownerState && lead.county
            ? lead.ownerState.toUpperCase() !== (lead.state || "").toUpperCase()
            : false,
        ownershipYears: lead.ownershipYears ?? 0,
        isInherited: lead.ownerName?.toLowerCase().includes("estate") || false,
        isCorporateOwner: /llc|inc|corp|trust|ltd/i.test(lead.ownerName || ""),
        lastSalePrice: parseFloat(lead.lastSalePrice || "0"),
        estimatedCurrentValue: parseFloat(lead.estimatedValue || lead.assessedValue || "0"),
        hasRecentPermit: false, // Default
        countyCompetitionLevel: "medium", // Default
      };

      const result = computeSellerMotivationScore(input);
      const prevScore = lead.score || 0;

      await db
        .update(leads)
        .set({
          score: result.score,
          updatedAt: new Date(),
        })
        .where(eq(leads.id, lead.id));

      processed++;
      if (result.score >= 75) highMotivation++;
      if (result.score > prevScore + 10) upgraded++;
    } catch (err: any) {
      console.warn(`[SellerMotivation] Lead ${lead.id} rescore failed:`, err.message);
    }
  }

  return { processed, highMotivation, upgraded };
}

// ---------------------------------------------------------------------------
// Predictive outreach timing
//
// Expert data shows these time windows have highest letter-to-call conversion:
// - Tuesday–Thursday > Monday > Friday > Weekend
// - 10am–2pm local time gets best callbacks
// - Spring (March–May) and Fall (Sept–Nov) are highest response seasons
// - Avoid: major holidays, tax season peaks (April 15 ± 2 weeks)
// ---------------------------------------------------------------------------

export function getOptimalOutreachTiming(
  ownerState: string,
  urgencyLevel: "immediate" | "this_week" | "this_month" | "queue"
): {
  recommendedSendDate: Date;
  recommendedCallWindow: string;
  seasonalMultiplier: number;
  dayOfWeekRecommendation: string;
  expectedResponseRate: number;
} {
  const now = new Date();
  const month = now.getMonth() + 1; // 1–12
  const dayOfWeek = now.getDay(); // 0=Sun, 6=Sat

  // Seasonal multiplier (1.0 = baseline)
  let seasonalMultiplier = 1.0;
  if (month >= 3 && month <= 5) seasonalMultiplier = 1.25; // Spring — people thinking about land
  else if (month >= 9 && month <= 11) seasonalMultiplier = 1.15; // Fall — year-end planning
  else if (month === 12 || month === 1) seasonalMultiplier = 0.8; // Holiday slowdown
  else if (month === 4) seasonalMultiplier = 0.85; // Tax season distraction

  // Next optimal mail day (Tue–Thu preferred)
  let daysToAdd = 1;
  let sendDate = new Date(now);
  while (true) {
    sendDate = new Date(now.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
    const dow = sendDate.getDay();
    if (urgencyLevel === "immediate" && [2, 3, 4].includes(dow)) break; // Next Tue-Thu
    if (urgencyLevel === "this_week" && [2, 3, 4].includes(dow)) break;
    if (urgencyLevel === "this_month" && [2, 3].includes(dow)) break; // Next Tue-Wed
    if (urgencyLevel === "queue") { daysToAdd += 7; break; }
    daysToAdd++;
    if (daysToAdd > 14) break; // Safety
  }

  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dayRec = dayNames[sendDate.getDay()];

  // Expected response rate adjusted for season and urgency
  const baseRate = urgencyLevel === "immediate" ? 0.08 : urgencyLevel === "this_week" ? 0.06 : 0.04;
  const expectedResponseRate = baseRate * seasonalMultiplier;

  return {
    recommendedSendDate: sendDate,
    recommendedCallWindow: "10:00 AM – 2:00 PM local time",
    seasonalMultiplier,
    dayOfWeekRecommendation: `${dayRec} — optimal for land investor outreach`,
    expectedResponseRate,
  };
}

// ---------------------------------------------------------------------------
// County scoring for target county selection
//
// Expert county selection framework:
// Sweet spot = counties where:
//   - Population: 20k–150k (land market exists, not too competitive)
//   - Median home value: $80k–$250k (buyers can afford land)
//   - Land sales velocity: 5–30/month (active market)
//   - Average investor count: < 20 mailing simultaneously
//   - Distance to metro: 1–3 hours (recreational buyers)
// ---------------------------------------------------------------------------

export interface CountyScorecardInput {
  state: string;
  county: string;
  population?: number;
  medianHomeValue?: number;
  medianIncome?: number;
  landSalesPerMonth?: number;
  avgDaysOnMarket?: number;
  priceVelocity12Mo?: number; // % change
  investorMailingCount?: number; // Estimated # of investors mailing
  distanceToNearestMetroMiles?: number;
  hasLakeOrRiver?: boolean;
  hasNationalForestNearby?: boolean;
  growthRate5Year?: number; // Population growth %
}

export function scoreCountyForTargeting(
  input: CountyScorecardInput
): {
  overallScore: number; // 0–100
  marketMaturityScore: number;
  competitionScore: number;
  exitabilityScore: number; // How easy is it to resell?
  opportunityWindow: "open" | "narrowing" | "closed";
  recommendation: string;
  bestUseCase: string;
} {
  let marketScore = 0;
  let competitionScore = 0;
  let exitScore = 0;

  // ── Population sweet spot ────────────────────────────────────────────────
  const pop = input.population || 0;
  if (pop >= 20000 && pop <= 100000) marketScore += 25;
  else if (pop >= 100000 && pop <= 200000) marketScore += 15;
  else if (pop >= 10000 && pop < 20000) marketScore += 10;
  else if (pop < 10000) marketScore += 5; // Too rural — hard to find buyers

  // ── Land sales velocity ───────────────────────────────────────────────────
  const salesPerMonth = input.landSalesPerMonth || 0;
  if (salesPerMonth >= 5 && salesPerMonth <= 30) marketScore += 25;
  else if (salesPerMonth > 30) marketScore += 15; // Too active = high competition
  else if (salesPerMonth >= 2) marketScore += 10;
  else marketScore += 0; // < 2/month = dead market

  // ── Days on market ────────────────────────────────────────────────────────
  const dom = input.avgDaysOnMarket || 180;
  if (dom <= 60) exitScore += 30; // Fast market — great exit velocity
  else if (dom <= 90) exitScore += 22;
  else if (dom <= 180) exitScore += 15;
  else exitScore += 5;

  // ── Price velocity ────────────────────────────────────────────────────────
  const velocity = input.priceVelocity12Mo || 0;
  if (velocity >= 10) { exitScore += 20; } // Rising market
  else if (velocity >= 5) { exitScore += 15; }
  else if (velocity >= 0) { exitScore += 10; }
  else { exitScore += 0; } // Declining = risky

  // ── Competition level ─────────────────────────────────────────────────────
  const investors = input.investorMailingCount || 10;
  if (investors < 5) competitionScore += 100; // Blue ocean!
  else if (investors < 15) competitionScore += 70;
  else if (investors < 30) competitionScore += 40;
  else if (investors < 50) competitionScore += 20;
  else competitionScore += 0; // Red ocean

  // ── Recreational amenities (boost exitability) ───────────────────────────
  if (input.hasLakeOrRiver) exitScore += 15;
  if (input.hasNationalForestNearby) exitScore += 10;

  // ── Growth indicators ─────────────────────────────────────────────────────
  const growthRate = input.growthRate5Year || 0;
  if (growthRate >= 10) marketScore += 25;
  else if (growthRate >= 5) marketScore += 15;
  else if (growthRate >= 2) marketScore += 8;

  // ── Normalize to 0–100 ───────────────────────────────────────────────────
  marketScore = Math.min(100, marketScore);
  competitionScore = Math.min(100, competitionScore);
  exitScore = Math.min(100, exitScore);

  const overallScore = Math.round(
    marketScore * 0.35 + competitionScore * 0.35 + exitScore * 0.3
  );

  const opportunityWindow: "open" | "narrowing" | "closed" =
    competitionScore >= 60
      ? "open"
      : competitionScore >= 30
      ? "narrowing"
      : "closed";

  const recommendation =
    overallScore >= 75
      ? `🎯 Prime target county — launch your highest-volume mailing here immediately`
      : overallScore >= 55
      ? `✅ Good target county — include in rotation, test with 200-piece mailing first`
      : overallScore >= 35
      ? `⚠️ Marginal county — consider only if you have specific local knowledge`
      : `❌ Pass on this county — poor market conditions or too competitive`;

  const bestUseCase =
    dom <= 60
      ? "Cash flip (fast market supports quick resale)"
      : dom <= 120
      ? "Owner-finance portfolio (moderate DOM, steady buyer pool)"
      : "High-discount cash deals only (slow market needs deep discount to exit)";

  return {
    overallScore,
    marketMaturityScore: marketScore,
    competitionScore,
    exitabilityScore: exitScore,
    opportunityWindow,
    recommendation,
    bestUseCase,
  };
}

export default {
  computeSellerMotivationScore,
  rescoreLeadsForOrg,
  getOptimalOutreachTiming,
  scoreCountyForTargeting,
};

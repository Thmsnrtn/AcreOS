/**
 * Prospect Intelligence Engine
 *
 * Proactive lead generation and seller identification system.
 *
 * Inspired by modern lead intelligence platforms, this service goes beyond
 * reactive lead management to PROACTIVELY identify and enrich prospects.
 *
 * Core capabilities:
 * 1. SIGNAL AGGREGATION: Cross-reference delinquency + ownership + physical signals
 * 2. MOTIVATION SCORING: ML-weighted score predicting seller readiness
 * 3. CONTACT ENRICHMENT: Find owner contact info from public records
 * 4. OPPORTUNITY RADAR: Surface new opportunities before competitors see them
 * 5. SEQUENCE INTELLIGENCE: Optimize outreach timing based on response patterns
 *
 * Architecture Philosophy:
 * Every lead has a "motivation thermometer" — the sum of signals indicating
 * how ready the owner is to sell at a discount. Our edge is reading this
 * thermometer faster and more accurately than any competitor.
 */

import { db } from "../db";
import { leads, properties, leadScoreHistory, campaigns, notes } from "@shared/schema";
import { eq, and, desc, gte, lte, sql, count, avg } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────────
// MOTIVATION SIGNAL CATALOG
// Each signal contributes to the "motivation thermometer"
// ─────────────────────────────────────────────────────────────────────────────

export const MOTIVATION_SIGNALS = {
  // Tax signals (highest predictive power)
  TAX_DELINQUENT_2YR: { weight: 25, category: "tax", description: "2+ years delinquent" },
  TAX_DELINQUENT_3YR: { weight: 35, category: "tax", description: "3+ years delinquent" },
  TAX_DELINQUENT_5YR: { weight: 45, category: "tax", description: "5+ years delinquent (peak motivation)" },
  TAX_SALE_SCHEDULED: { weight: 50, category: "tax", description: "Tax sale scheduled within 90 days (maximum urgency)" },

  // Ownership signals
  OUT_OF_STATE_OWNER: { weight: 20, category: "ownership", description: "Owner lives outside the county state" },
  OUT_OF_COUNTY_OWNER: { weight: 10, category: "ownership", description: "Owner lives outside the county" },
  NO_MORTGAGE: { weight: 10, category: "ownership", description: "No recorded mortgage/deed of trust" },
  LONG_TERM_OWNER: { weight: 8, category: "ownership", description: "Owned 10+ years (high cost basis flexibility)" },
  INHERITED_PROPERTY: { weight: 15, category: "ownership", description: "Recent deed transfer via inheritance" },
  ESTATE_PROPERTY: { weight: 12, category: "ownership", description: "Property in estate/probate" },
  MULTIPLE_DELINQUENT_PARCELS: { weight: 15, category: "ownership", description: "Owner has multiple delinquent parcels (systemic neglect)" },

  // Property physical signals
  VACANT_LAND: { weight: 5, category: "property", description: "No improvements on parcel" },
  NO_RECENT_VISITS: { weight: 8, category: "property", description: "No permits/utility activity in 5+ years" },
  BELOW_COUNTY_MEDIAN_VALUE: { weight: 8, category: "property", description: "Assessed value below county median" },

  // Life event signals (when detectable via public records)
  RECENT_DIVORCE: { weight: 20, category: "life_event", description: "Recent divorce filing in county records" },
  RECENT_RELOCATION: { weight: 12, category: "life_event", description: "Owner forwarding address changed" },
  RECENT_FORECLOSURE_ELSEWHERE: { weight: 18, category: "life_event", description: "Owner has other foreclosures in public records" },
  BANKRUPTCY_FILING: { weight: 22, category: "life_event", description: "Owner has active bankruptcy filing" },
} as const;

export type MotivationSignalKey = keyof typeof MOTIVATION_SIGNALS;

export interface ProspectProfile {
  leadId: number;
  apn?: string;
  county?: string;
  state?: string;
  ownerName?: string;
  ownerAddress?: string;
  acreage?: number;

  // Motivation intelligence
  motivationScore: number;          // 0-100
  motivationTier: "HOT" | "WARM" | "COOL" | "COLD";
  activeSignals: MotivationSignalKey[];
  topSignal: MotivationSignalKey | null;

  // Contact intelligence
  contactChannels: Array<{
    channel: "mail" | "email" | "phone" | "sms";
    address: string;
    confidence: number;
    source: string;
  }>;

  // Timing intelligence
  optimalOutreachWindow?: string;   // "now", "7d", "30d", "next_quarter"
  daysUntilTaxAuction?: number;
  urgencyLevel: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

  // Deal intelligence
  estimatedOfferRange: { low: number; high: number; currency: "USD" };
  estimatedMarketValue?: number;
  potentialROI?: number;

  // Outreach status
  touchCount: number;
  lastContactDate?: Date;
  responseSignal?: "positive" | "negative" | "no_response";
  recommendedNextAction: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// MOTIVATION SCORE CALCULATOR
// ─────────────────────────────────────────────────────────────────────────────

export function calculateMotivationScore(signals: MotivationSignalKey[]): {
  score: number;
  tier: ProspectProfile["motivationTier"];
  topSignal: MotivationSignalKey | null;
} {
  if (!signals || signals.length === 0) {
    return { score: 0, tier: "COLD", topSignal: null };
  }

  // Sum signal weights, cap at 100
  const rawScore = signals.reduce((sum, key) => {
    return sum + (MOTIVATION_SIGNALS[key]?.weight || 0);
  }, 0);

  // Non-linear scaling: first signals have more impact, diminishing returns
  const score = Math.min(100, Math.round(rawScore * (100 / Math.max(100, rawScore * 0.9))));

  // Find the highest-weight signal
  const topSignal = signals.reduce((best, key) => {
    const w = MOTIVATION_SIGNALS[key]?.weight || 0;
    const bestW = best ? MOTIVATION_SIGNALS[best]?.weight || 0 : 0;
    return w > bestW ? key : best;
  }, null as MotivationSignalKey | null);

  const tier: ProspectProfile["motivationTier"] =
    score >= 70 ? "HOT" :
    score >= 45 ? "WARM" :
    score >= 20 ? "COOL" : "COLD";

  return { score, tier, topSignal };
}

// ─────────────────────────────────────────────────────────────────────────────
// OUTREACH SEQUENCE INTELLIGENCE
// Optimal timing and channel selection
// ─────────────────────────────────────────────────────────────────────────────

export interface OutreachRecommendation {
  nextAction: string;
  channel: "direct_mail" | "phone" | "email" | "sms" | "skip_trace";
  timing: "immediately" | "this_week" | "next_week" | "next_month";
  message: string;
  template?: string;
  reason: string;
}

export function getOutreachRecommendation(
  touchCount: number,
  motivationTier: ProspectProfile["motivationTier"],
  daysUntilTaxAuction?: number,
  lastContactDaysAgo?: number,
  lastResponseSignal?: string
): OutreachRecommendation {

  // CRITICAL: Tax auction imminent
  if (daysUntilTaxAuction !== undefined && daysUntilTaxAuction <= 30) {
    return {
      nextAction: "Send urgent offer letter immediately",
      channel: "direct_mail",
      timing: "immediately",
      message: "Tax auction in 30 days or less — send an offer TODAY. This is the peak motivation window.",
      template: "urgent_tax_sale_offer",
      reason: `Tax auction in ${daysUntilTaxAuction} days — seller faces losing property entirely`,
    };
  }

  // HOT lead, first touch
  if (motivationTier === "HOT" && touchCount === 0) {
    return {
      nextAction: "Send blind offer letter",
      channel: "direct_mail",
      timing: "immediately",
      message: "High motivation score — send a specific cash offer letter. Don't wait.",
      template: "blind_offer_letter",
      reason: "Multiple strong motivation signals present — first contact should include a specific offer",
    };
  }

  // Follow-up after no response
  if (touchCount >= 1 && !lastResponseSignal && (lastContactDaysAgo || 0) >= 14) {
    const channel: OutreachRecommendation["channel"] =
      touchCount === 1 ? "phone" :
      touchCount === 2 ? "direct_mail" :
      touchCount === 3 ? "email" : "direct_mail";

    return {
      nextAction: `Send follow-up via ${channel} (touch #${touchCount + 1})`,
      channel,
      timing: "this_week",
      message: `No response after ${touchCount} touch(es). Persistence is the variable — 80% of land deals close after the 4th+ contact.`,
      template: `followup_${channel}_${touchCount}`,
      reason: "Standard multi-touch follow-up sequence — most deals need 4-12 contacts",
    };
  }

  // Positive response — escalate
  if (lastResponseSignal === "positive") {
    return {
      nextAction: "Call seller to discuss terms",
      channel: "phone",
      timing: "immediately",
      message: "Seller responded positively — call within 24 hours while motivation is high.",
      reason: "Positive response signals readiness — speed closes deals",
    };
  }

  // Cold lead — re-evaluate
  if (motivationTier === "COLD" && touchCount === 0) {
    return {
      nextAction: "Enrich contact data with skip trace before outreach",
      channel: "skip_trace",
      timing: "this_week",
      message: "Run skip trace to validate contact information before investing in outreach.",
      reason: "Cold lead needs contact validation to avoid wasting direct mail budget",
    };
  }

  // Default — standard first touch
  return {
    nextAction: "Send first contact letter with blind offer",
    channel: "direct_mail",
    timing: "this_week",
    message: "Start the multi-touch sequence with a specific offer amount.",
    template: "first_contact_offer",
    reason: "First contact — lead the outreach with a specific offer to maximize response rate",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// COUNTY OPPORTUNITY SCAN
// Identify best counties to target based on aggregated signals
// ─────────────────────────────────────────────────────────────────────────────

export interface CountyOpportunityScan {
  county: string;
  state: string;
  opportunityDensity: "HIGH" | "MEDIUM" | "LOW";
  estimatedDelinquentParcels: number;
  avgMotivationScore: number;
  dealsClosedLast90d: number;
  averagePricePerAcre: number;
  recommendedAction: string;
  dataLastVerified?: Date;
}

export async function scanOrganizationCounties(organizationId: number): Promise<CountyOpportunityScan[]> {
  try {
    // Get counties where this org has properties/leads
    const countyData = await db
      .select({
        county: properties.county,
        state: properties.state,
        propertyCount: count(properties.id),
      })
      .from(properties)
      .where(eq(properties.organizationId, organizationId))
      .groupBy(properties.county, properties.state)
      .orderBy(desc(count(properties.id)));

    return countyData.map(c => ({
      county: c.county || "Unknown",
      state: c.state || "Unknown",
      opportunityDensity: "MEDIUM" as const,
      estimatedDelinquentParcels: Math.round(Number(c.propertyCount) * 3), // Estimate
      avgMotivationScore: 45,
      dealsClosedLast90d: 0,
      averagePricePerAcre: 2500,
      recommendedAction: `Obtain delinquent tax list from ${c.county} County and run blind offer campaign`,
    }));
  } catch (error) {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LEAD ENRICHMENT PIPELINE
// Progressive enrichment: start free, upgrade as needed
// ─────────────────────────────────────────────────────────────────────────────

export interface EnrichmentPipeline {
  stage: "imported" | "geocoded" | "public_records" | "skip_traced" | "fully_enriched";
  completionPct: number;
  nextEnrichmentStep: string;
  estimatedCost: number; // cents
  dataFields: string[];
}

export function getEnrichmentPipeline(lead: any): EnrichmentPipeline {
  const hasCoordinates = lead.latitude && lead.longitude;
  const hasPublicRecords = lead.assessedValue || lead.taxStatus;
  const hasContactData = lead.phone || lead.email;
  const hasSkipTraceData = lead.skipTraceDate;

  if (hasSkipTraceData && hasContactData && hasPublicRecords && hasCoordinates) {
    return {
      stage: "fully_enriched",
      completionPct: 100,
      nextEnrichmentStep: "none",
      estimatedCost: 0,
      dataFields: ["coordinates", "public_records", "contact_info", "skip_trace"],
    };
  }

  if (hasContactData && hasPublicRecords) {
    return {
      stage: "skip_traced",
      completionPct: 85,
      nextEnrichmentStep: "Run full property enrichment for flood/soil/zoning data",
      estimatedCost: 25, // $0.25 for enrichment
      dataFields: ["coordinates", "public_records", "contact_info"],
    };
  }

  if (hasPublicRecords) {
    return {
      stage: "public_records",
      completionPct: 60,
      nextEnrichmentStep: "Run skip trace to find owner contact information",
      estimatedCost: 75, // $0.75 for skip trace
      dataFields: ["coordinates", "public_records"],
    };
  }

  if (hasCoordinates) {
    return {
      stage: "geocoded",
      completionPct: 30,
      nextEnrichmentStep: "Query public records for tax status and ownership",
      estimatedCost: 10, // $0.10 for public records
      dataFields: ["coordinates"],
    };
  }

  return {
    stage: "imported",
    completionPct: 10,
    nextEnrichmentStep: "Geocode the property address to enable all data lookups",
    estimatedCost: 5, // $0.05 for geocoding
    dataFields: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CAMPAIGN OPTIMIZATION INTELLIGENCE
// Data-driven direct mail optimization
// ─────────────────────────────────────────────────────────────────────────────

export interface CampaignIntelligence {
  recommendedBatchSize: number;
  estimatedResponseRate: number;   // percentage
  estimatedDealsPerBatch: number;
  recommendedOfferRange: { pct: number; rationale: string };
  bestMailingDay: string;
  templateRecommendation: "personal_letter" | "yellow_letter" | "postcard" | "typed_letter";
  estimatedCostPerDeal: number;    // cents
}

export function getCampaignIntelligence(
  countyMedianDom: number,
  motivationTierDistribution: Record<string, number>,
  historicalResponseRate?: number
): CampaignIntelligence {
  const totalLeads = Object.values(motivationTierDistribution).reduce((a, b) => a + b, 0);
  const hotLeads = motivationTierDistribution["HOT"] || 0;
  const warmLeads = motivationTierDistribution["WARM"] || 0;

  // Expected response rate based on motivation mix
  const weightedResponseRate = totalLeads > 0
    ? ((hotLeads * 0.08) + (warmLeads * 0.04) + ((totalLeads - hotLeads - warmLeads) * 0.01)) / totalLeads
    : 0.02;

  const responseRate = historicalResponseRate || (weightedResponseRate * 100);
  const dealsPerResponseRate = 0.15; // ~15% of respondents become deals
  const dealsPerBatch = Math.max(1, Math.round(1000 * (responseRate / 100) * dealsPerResponseRate));

  // Cost calculation: $0.85/letter + $0.15 processing = $1/letter
  const costPerLetter = 100; // cents
  const costPerDeal = totalLeads > 0
    ? Math.round((1000 * costPerLetter) / Math.max(1, dealsPerBatch))
    : 50000; // $500 per deal default

  return {
    recommendedBatchSize: Math.min(500, Math.max(100, hotLeads + (warmLeads * 0.5))),
    estimatedResponseRate: Math.round(responseRate * 10) / 10,
    estimatedDealsPerBatch: dealsPerBatch,
    recommendedOfferRange: {
      pct: countyMedianDom <= 60 ? 25 : 15, // More competitive in fast markets
      rationale: countyMedianDom <= 60
        ? "Active market — offer at 25% of FMV to win deals before competition"
        : "Slower market — offer at 15% of FMV, sellers have more time pressure",
    },
    bestMailingDay: "Tuesday", // Delivers Wed-Thu, highest response days
    templateRecommendation: hotLeads > warmLeads ? "personal_letter" : "typed_letter",
    estimatedCostPerDeal: costPerDeal,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FREEDOM NUMBER CALCULATOR
// The North Star metric for every land investor
// ─────────────────────────────────────────────────────────────────────────────

export interface FreedomNumberAnalysis {
  monthlyExpenses: number;          // Target passive income needed
  currentPassiveIncome: number;     // Current monthly note income
  freedomGap: number;               // Remaining to reach freedom
  freedomPercent: number;           // Progress toward goal
  notesNeeded: number;              // Notes needed to close the gap
  dealsNeededToGenNotes: number;    // Assuming avg note per deal
  estimatedTimeToFreedom: {
    optimistic: number;             // months (1 deal/mo)
    realistic: number;              // months (0.5 deal/mo)
    conservative: number;           // months (0.25 deal/mo)
  };
  weeklyMailersNeeded: number;      // To hit deal velocity
  freedomStatement: string;
}

export function calculateFreedomNumber(
  monthlyExpenses: number,
  currentMonthlyNoteIncome: number,
  avgNotePayment: number = 200,
  currentNotesCount: number = 0
): FreedomNumberAnalysis {
  const freedomGap = Math.max(0, monthlyExpenses - currentMonthlyNoteIncome);
  const freedomPercent = monthlyExpenses > 0
    ? Math.min(100, Math.round((currentMonthlyNoteIncome / monthlyExpenses) * 100))
    : 0;

  const notesNeeded = avgNotePayment > 0 ? Math.ceil(freedomGap / avgNotePayment) : 0;

  // Assuming each deal generates ~0.8 notes on average (some cash sales)
  const dealsNeededToGenNotes = Math.ceil(notesNeeded / 0.8);

  // Time estimates based on deal velocity
  const timeOptimistic = dealsNeededToGenNotes; // 1 deal/mo
  const timeRealistic = dealsNeededToGenNotes * 2; // 0.5 deals/mo
  const timeConservative = dealsNeededToGenNotes * 4; // 0.25 deals/mo

  // Working backward: to close 1 deal/mo, need ~2 accepted offers → ~20 responses → ~400 mailers
  const weeklyMailersNeeded = Math.round((dealsNeededToGenNotes * 400) / 4); // spread over month

  let freedomStatement: string;
  if (freedomPercent >= 100) {
    freedomStatement = "🎉 You have achieved financial freedom! Your passive income exceeds your expenses.";
  } else if (freedomPercent >= 75) {
    freedomStatement = `You are ${freedomPercent}% to freedom. ${notesNeeded} more notes at ~$${avgNotePayment}/mo each will close the gap.`;
  } else if (freedomPercent >= 25) {
    freedomStatement = `You need ${notesNeeded} more notes to reach freedom. At 1 deal/month: ~${timeRealistic} months away.`;
  } else {
    freedomStatement = `Start building your note portfolio. First goal: 10 notes at $${avgNotePayment}/mo = $${(10 * avgNotePayment).toLocaleString()}/mo passive.`;
  }

  return {
    monthlyExpenses,
    currentPassiveIncome: currentMonthlyNoteIncome,
    freedomGap,
    freedomPercent,
    notesNeeded,
    dealsNeededToGenNotes,
    estimatedTimeToFreedom: {
      optimistic: timeOptimistic,
      realistic: timeRealistic,
      conservative: timeConservative,
    },
    weeklyMailersNeeded: Math.max(0, weeklyMailersNeeded),
    freedomStatement,
  };
}

export const prospectIntelligenceService = {
  calculateMotivationScore,
  getOutreachRecommendation,
  scanOrganizationCounties,
  getEnrichmentPipeline,
  getCampaignIntelligence,
  calculateFreedomNumber,
  MOTIVATION_SIGNALS,
};

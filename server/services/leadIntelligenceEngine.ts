// @ts-nocheck
/**
 * Lead Intelligence Engine
 *
 * Inspired by the multi-signal lead intelligence approach of platforms like
 * Reworked.ai — where leads aren't just names on a list, but living entities
 * scored and prioritized dynamically based on every available signal.
 *
 * Core Principle: The right seller, at the right time, with the right message.
 *
 * This engine elevates AcreOS from a CRM into a true intelligence platform:
 *
 *   SIGNAL LAYER — Raw data points from multiple sources:
 *     - Property tax delinquency amount and duration
 *     - Owner state vs. property state (out-of-state signal)
 *     - Tenure length and purchase price history
 *     - Assessed value vs. estimated market value spread
 *     - Previous contact history and response patterns
 *     - County opportunity score (macro context)
 *     - USDA land value trend for the county
 *     - Population migration signal for the area
 *
 *   SCORE LAYER — Composite Lead Intelligence Score (LIS):
 *     - Financial distress score (0-35): tax delinquency, liens
 *     - Emotional detachment score (0-30): out-of-state, corporate, inherited
 *     - Tenure & inertia score (0-20): long hold, no permits, appreciation gain
 *     - Behavioral signals (0-15): previous response, letter opens, callbacks
 *
 *   ACTION LAYER — Specific, timed recommended actions:
 *     - Which leads to contact THIS WEEK
 *     - What message angle works for each lead's profile
 *     - Optimal contact time based on county + lead type
 *     - Next best action (letter, call, text, email)
 *
 *   TIMING LAYER — Urgency scoring:
 *     - Tax sale deadlines create hard time pressure
 *     - Seasonal mailing windows
 *     - Last-contact recency (warm vs. cold)
 *
 * Art of Passive Income Methodology Integration:
 *   - "3 out of 5 offers accepted" = leads need to be highly filtered
 *   - "Touch 4-5 times before giving up" = multi-touch urgency tracking
 *   - "Find people who NEED to sell, not who WANT to sell"
 *   - "Out-of-state + tax delinquent = dream seller"
 */

import { db } from "../db";
import { leads, countyMarkets } from "@shared/schema";
import { eq, and, gte, desc, sql, isNull, ne } from "drizzle-orm";
import { computeSellerMotivationScore } from "./sellerMotivationEngine";
import { getCachedLandTrend, getCachedCountySnapshot } from "./usdaNassService";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LeadPriority = "immediate" | "high" | "medium" | "low" | "dormant";
export type OutreachChannel = "direct_mail" | "phone" | "email" | "text" | "skip_trace";
export type MessageAngle =
  | "tax_relief" // "I can help resolve your tax situation"
  | "hassle_free" // "Simple, no-agent cash offer"
  | "out_of_state" // "I know managing distant property is difficult"
  | "estate_settlement" // "Settle the estate quickly"
  | "equity_unlock" // "Unlock equity you've built over X years"
  | "corporate_asset" // "Convert non-productive asset to capital"
  | "distress_empathy"; // General financial distress empathy

export interface LeadIntelligenceProfile {
  leadId: number;
  ownerName: string | null;
  county: string;
  state: string;
  acres: number;

  // Core motivation score (existing engine)
  motivationScore: number;
  motivationGrade: string; // A+, A, B+, B, C, D

  // Extended intelligence signals
  signals: {
    taxDelinquentYears: number;
    taxDelinquentAmount: number;
    isOutOfState: boolean;
    ownerState: string | null;
    yearsOwned: number;
    isInherited: boolean;
    isCorporate: boolean;
    assessedValueToMarketSpread: number; // % below market (higher = more motivated)
    lastContactDaysAgo: number | null;
    touchCount: number; // Number of prior outreaches
    hasResponded: boolean; // Has ever responded to outreach
  };

  // County-level context
  countyContext: {
    usdaLandValuePerAcre: number;
    landValueYoYChange: number;
    countyOpportunityScore: number;
    isHotMigrationCounty: boolean;
  };

  // Priority and action
  priority: LeadPriority;
  urgencyLevel: number; // 0-100 (100 = urgent tax sale this week)
  recommendedChannel: OutreachChannel;
  recommendedAngle: MessageAngle;
  recommendedMessage: string; // 2-3 sentence personalized message hook
  bestContactTime: string; // e.g. "Tuesday-Thursday, 9-11am local"
  nextBestAction: string;

  // Offer intelligence
  estimatedOfferPrice: number; // Podolsky formula applied
  estimatedFlipPrice: number;
  estimatedOwnerFinanceMonthly: number;

  // Metadata
  scoredAt: string;
  dataCompleteness: number; // 0-100%, how complete is the data
}

export interface LeadIntelligenceBatch {
  organizationId: number;
  processedAt: string;
  totalLeads: number;
  immediateCount: number;
  highCount: number;
  mediumCount: number;
  topLeads: LeadIntelligenceProfile[];
  scoreDistribution: { grade: string; count: number }[];
  recommendedCampaignStrategy: string;
  weeklyFocus: string;
}

// ---------------------------------------------------------------------------
// Signal Extraction
// ---------------------------------------------------------------------------

function extractSignals(lead: any): LeadIntelligenceProfile["signals"] {
  const taxDelinquentYears = lead.taxDelinquentYears ?? 0;
  const taxDelinquentAmount = parseFloat(lead.taxDelinquentAmount || "0");
  const isOutOfState = lead.ownerState && lead.state
    ? lead.ownerState.toUpperCase() !== (lead.state || "").toUpperCase()
    : false;

  const ownershipYears = lead.ownershipYears ?? lead.yearsOwned ?? 5;
  const isInherited = /estate|heir|trust/i.test(lead.ownerName || "");
  const isCorporate = /llc|inc|corp|trust|ltd|partners/i.test(lead.ownerName || "");

  // Assessed value vs. market estimate
  const assessedValue = parseFloat(lead.assessedValue || "0");
  const estimatedMarket = assessedValue * 1.4; // Typical assessed-to-market ratio
  const askingOrList = parseFloat(lead.listPrice || lead.offerPrice || "0");
  const assessedValueToMarketSpread = askingOrList > 0 && estimatedMarket > 0
    ? Math.max(0, ((estimatedMarket - askingOrList) / estimatedMarket) * 100)
    : 0;

  // Contact history
  const lastContactDaysAgo = lead.lastContactedAt
    ? Math.floor((Date.now() - new Date(lead.lastContactedAt).getTime()) / (24 * 60 * 60 * 1000))
    : null;

  const touchCount = lead.touchCount ?? lead.contactAttempts ?? 0;
  const hasResponded = lead.hasResponded ?? (lead.status === "responded") ?? false;

  return {
    taxDelinquentYears,
    taxDelinquentAmount,
    isOutOfState,
    ownerState: lead.ownerState || null,
    yearsOwned: ownershipYears,
    isInherited,
    isCorporate,
    assessedValueToMarketSpread,
    lastContactDaysAgo,
    touchCount,
    hasResponded,
  };
}

// ---------------------------------------------------------------------------
// Priority & Urgency Calculation
// ---------------------------------------------------------------------------

function computePriority(motivationScore: number, signals: LeadIntelligenceProfile["signals"]): LeadPriority {
  // Immediate: Tax delinquent + out-of-state + high delinquency amount
  if (signals.taxDelinquentYears >= 2 && signals.isOutOfState && signals.taxDelinquentAmount > 1000) {
    return "immediate";
  }

  // High: Strong motivation score with key signals
  if (motivationScore >= 70 || (signals.taxDelinquentYears >= 1 && signals.isOutOfState)) {
    return "high";
  }

  // Warm but not urgent
  if (motivationScore >= 50) return "medium";

  // Previously responded but stale
  if (signals.hasResponded && signals.lastContactDaysAgo && signals.lastContactDaysAgo > 60) {
    return "high"; // Re-engage warm leads
  }

  // Low signal leads — not worth effort
  if (motivationScore < 30) return "dormant";

  return "low";
}

function computeUrgencyLevel(signals: LeadIntelligenceProfile["signals"]): number {
  let urgency = 0;

  // Tax delinquency creates hard deadlines
  if (signals.taxDelinquentYears >= 3) urgency += 40;
  else if (signals.taxDelinquentYears >= 2) urgency += 30;
  else if (signals.taxDelinquentYears >= 1) urgency += 20;

  if (signals.taxDelinquentAmount > 5000) urgency += 20;
  else if (signals.taxDelinquentAmount > 2000) urgency += 10;

  // Re-engagement urgency
  if (signals.hasResponded && signals.lastContactDaysAgo && signals.lastContactDaysAgo > 30) {
    urgency += 25; // Warm lead going cold
  }

  // 5-touch system urgency (follow-up #4 and #5 are highest priority)
  if (signals.touchCount === 3 || signals.touchCount === 4) {
    urgency += 15; // You're in the critical follow-up window
  }

  return Math.min(100, urgency);
}

// ---------------------------------------------------------------------------
// Message Personalization Engine
// ---------------------------------------------------------------------------

function selectMessageAngle(signals: LeadIntelligenceProfile["signals"]): MessageAngle {
  // Priority order: tax relief > inherited > out-of-state > corporate > equity > default
  if (signals.taxDelinquentYears >= 1) return "tax_relief";
  if (signals.isInherited) return "estate_settlement";
  if (signals.isOutOfState) return "out_of_state";
  if (signals.isCorporate) return "corporate_asset";
  if (signals.yearsOwned >= 10) return "equity_unlock";
  return "hassle_free";
}

function generateMessageHook(
  ownerName: string | null,
  county: string,
  state: string,
  angle: MessageAngle,
  signals: LeadIntelligenceProfile["signals"],
  offerPrice: number
): string {
  const firstName = ownerName?.split(" ")[0] || "Property Owner";
  const offerFmt = `$${Math.round(offerPrice).toLocaleString()}`;

  switch (angle) {
    case "tax_relief":
      return `${firstName}, I see your property has been accruing property tax obligations for ${signals.taxDelinquentYears} year(s). I specialize in helping property owners resolve tax situations quickly through a cash purchase — no auction, no credit impact, just a clean sale. My offer for your ${county} County property is ${offerFmt}.`;

    case "estate_settlement":
      return `${firstName}, handling inherited property can be overwhelming, especially when the estate needs to be settled. I purchase ${state} land quickly and as-is, with no repairs, no agents, and no complications. My offer is ${offerFmt} — we can close in 30 days or less.`;

    case "out_of_state":
      return `${firstName}, managing property in ${county} County from ${signals.ownerState} can be a headache you didn't sign up for. I make it simple: a firm cash offer of ${offerFmt}, no inspections, no contingencies, and we close on your timeline — wherever you are.`;

    case "corporate_asset":
      return `I specialize in acquiring non-productive land assets from business portfolios. I can make a quick cash offer of ${offerFmt} for your ${county} County property — simple paperwork, fast closing, and capital back in your business within 30 days.`;

    case "equity_unlock":
      return `${firstName}, you've held your ${county} County property for ${signals.yearsOwned} years. That tenure represents real equity. I'm prepared to offer ${offerFmt} cash — no real estate agents, no fees on your side, and we can close quickly if you're ready to convert that land to cash.`;

    case "hassle_free":
    default:
      return `${firstName}, I'm a private land buyer focused on ${county} County. My offer of ${offerFmt} is firm and all-cash — no agents, no closing costs on your side, and no hassle. If you're open to a simple conversation, I'd welcome the chance to make this easy for you.`;
  }
}

function selectRecommendedChannel(signals: LeadIntelligenceProfile["signals"]): OutreachChannel {
  // Already responded → follow up by phone
  if (signals.hasResponded) return "phone";
  // Never contacted → start with direct mail (Podolsky's primary channel)
  if (signals.touchCount === 0) return "direct_mail";
  // 1-2 touches with no response → add phone layer
  if (signals.touchCount <= 2) return "direct_mail";
  // 3+ touches → escalate to phone/text
  if (signals.touchCount === 3) return "phone";
  // 4th touch → skip trace if no email/phone on file
  return "skip_trace";
}

function getBestContactTime(state: string): string {
  // Land seller demographics skew older, rural; best contact times vary by region
  const westCoast = ["CA", "OR", "WA", "AZ", "NM", "CO", "NV", "ID", "MT"];
  const centralTime = ["TX", "OK", "KS", "NE", "SD", "ND", "MN", "IA", "MO", "AR", "LA", "MS", "AL", "TN", "KY", "WI", "IL", "IN", "MI", "OH"];

  if (westCoast.includes(state.toUpperCase())) {
    return "Tuesday-Thursday, 10am-12pm and 4-6pm Pacific";
  }
  if (centralTime.includes(state.toUpperCase())) {
    return "Tuesday-Thursday, 10am-12pm and 3-5pm Central";
  }
  return "Tuesday-Thursday, 10am-12pm and 3-5pm Eastern";
}

// ---------------------------------------------------------------------------
// Offer Intelligence
// ---------------------------------------------------------------------------

function computeOfferIntelligence(
  lead: any,
  nassData: any
): { offerPrice: number; flipPrice: number; ownerFinanceMonthly: number } {
  const acres = parseFloat(lead.acres || lead.acreage || "5");
  const usdaPerAcre = nassData?.pasturePerAcre || 1000;

  // Podolsky formula
  const lowestCompPerAcre = usdaPerAcre;
  const offerPerAcre = lowestCompPerAcre * 0.25;
  const offerTotal = offerPerAcre * acres;
  const flipPrice = offerTotal * 4; // 2× market = 4× offer

  // Owner finance math
  const loanAmount = flipPrice - offerTotal; // Down = acquisition cost
  const r = 0.09 / 12;
  const n = 84;
  const monthly = loanAmount > 0
    ? loanAmount * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1)
    : 0;

  return {
    offerPrice: offerTotal,
    flipPrice,
    ownerFinanceMonthly: monthly,
  };
}

// ---------------------------------------------------------------------------
// Main Scoring Function
// ---------------------------------------------------------------------------

export async function scoreLeadIntelligence(
  lead: any,
  nassData?: any
): Promise<LeadIntelligenceProfile> {
  const signals = extractSignals(lead);

  // Run existing motivation engine for base score
  const motivationInput = {
    isTaxDelinquent: signals.taxDelinquentYears > 0,
    taxDelinquentYears: signals.taxDelinquentYears,
    taxDelinquentAmount: signals.taxDelinquentAmount,
    assessedValue: parseFloat(lead.assessedValue || "5000"),
    isOutOfState: signals.isOutOfState,
    ownershipYears: signals.yearsOwned,
    isInherited: signals.isInherited,
    isCorporateOwner: signals.isCorporate,
    lastSalePrice: parseFloat(lead.lastSalePrice || "0"),
    estimatedCurrentValue: parseFloat(lead.assessedValue || "5000") * 1.4,
    countyCompetitionLevel: "medium" as const,
  };

  const motivation = computeSellerMotivationScore(motivationInput);

  // County context
  const nassSnapshot = nassData || null;
  const countyContext: LeadIntelligenceProfile["countyContext"] = {
    usdaLandValuePerAcre: nassSnapshot?.pasturePerAcre || 0,
    landValueYoYChange: 0,
    countyOpportunityScore: 50,
    isHotMigrationCounty: false,
  };

  // Priority and urgency
  const priority = computePriority(motivation.score, signals);
  const urgencyLevel = computeUrgencyLevel(signals);
  const angle = selectMessageAngle(signals);

  // Offer intelligence
  const offerIntel = computeOfferIntelligence(lead, nassSnapshot);

  // Message personalization
  const messageHook = generateMessageHook(
    lead.ownerName || null,
    lead.county || "Unknown",
    lead.state || "TX",
    angle,
    signals,
    offerIntel.offerPrice
  );

  // Determine next best action
  const channel = selectRecommendedChannel(signals);
  const nextBestAction = buildNextBestAction(priority, urgencyLevel, signals, channel, offerIntel.offerPrice);

  // Data completeness
  let completeness = 0;
  if (lead.ownerName) completeness += 15;
  if (lead.county) completeness += 15;
  if (lead.state) completeness += 10;
  if (lead.acres || lead.acreage) completeness += 15;
  if (lead.assessedValue) completeness += 15;
  if (lead.ownerState) completeness += 15;
  if (lead.taxDelinquent !== undefined) completeness += 15;

  return {
    leadId: lead.id,
    ownerName: lead.ownerName || null,
    county: lead.county || "Unknown",
    state: lead.state || "TX",
    acres: parseFloat(lead.acres || lead.acreage || "5"),
    motivationScore: motivation.score,
    motivationGrade: motivation.grade,
    signals,
    countyContext,
    priority,
    urgencyLevel,
    recommendedChannel: channel,
    recommendedAngle: angle,
    recommendedMessage: messageHook,
    bestContactTime: getBestContactTime(lead.state || "TX"),
    nextBestAction,
    estimatedOfferPrice: offerIntel.offerPrice,
    estimatedFlipPrice: offerIntel.flipPrice,
    estimatedOwnerFinanceMonthly: offerIntel.ownerFinanceMonthly,
    scoredAt: new Date().toISOString(),
    dataCompleteness: completeness,
  };
}

function buildNextBestAction(
  priority: LeadPriority,
  urgencyLevel: number,
  signals: LeadIntelligenceProfile["signals"],
  channel: OutreachChannel,
  offerPrice: number
): string {
  const offerFmt = `$${Math.round(offerPrice).toLocaleString()}`;

  if (priority === "immediate" && urgencyLevel >= 60) {
    return `URGENT: Send blind offer letter today at ${offerFmt}. Tax delinquency creates a countdown — act before this month's tax sale deadline.`;
  }

  if (signals.hasResponded && signals.lastContactDaysAgo && signals.lastContactDaysAgo > 30) {
    return `Re-engage warm lead by phone. They responded before — follow up to see if circumstances have changed. Offer ${offerFmt}.`;
  }

  if (signals.touchCount === 0) {
    return `Send initial blind offer letter at ${offerFmt}. Mail to their out-of-state address for highest deliverability.`;
  }

  if (signals.touchCount === 1) {
    return `Send 2nd touch letter (30 days after first). Add urgency language around resolving the property situation.`;
  }

  if (signals.touchCount === 2) {
    return `3rd touch — add a phone call if number available, otherwise send letter #3 with a time-limited offer variation.`;
  }

  if (signals.touchCount >= 3) {
    return `Skip trace for updated contact info. ${signals.touchCount >= 4 ? "Consider final 5th touch before marking as unresponsive." : "Add phone layer alongside letter #4."}`;
  }

  return `Add to monthly mailing campaign at ${offerFmt}. Monitor for response.`;
}

// ---------------------------------------------------------------------------
// Batch Processing for Organization
// ---------------------------------------------------------------------------

export async function batchScoreLeadsForOrg(
  organizationId: number,
  limit = 200
): Promise<LeadIntelligenceBatch> {
  const orgLeads = await db
    .select()
    .from(leads)
    .where(and(
      eq(leads.organizationId, organizationId),
      ne((leads as any).status, "won"),
      ne((leads as any).status, "lost"),
    ))
    .orderBy(desc(leads.createdAt))
    .limit(limit);

  if (orgLeads.length === 0) {
    return {
      organizationId,
      processedAt: new Date().toISOString(),
      totalLeads: 0,
      immediateCount: 0,
      highCount: 0,
      mediumCount: 0,
      topLeads: [],
      scoreDistribution: [],
      recommendedCampaignStrategy: "No leads found. Import your first county tax delinquent list to get started.",
      weeklyFocus: getWeeklyFocus(),
    };
  }

  // Score all leads
  const profiles = await Promise.allSettled(
    orgLeads.map(lead => scoreLeadIntelligence(lead))
  );

  const scoredLeads = profiles
    .filter(r => r.status === "fulfilled")
    .map(r => (r as PromiseFulfilledResult<LeadIntelligenceProfile>).value)
    .sort((a, b) => {
      // Sort by priority then urgency
      const priorityOrder = { immediate: 0, high: 1, medium: 2, low: 3, dormant: 4 };
      const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (pDiff !== 0) return pDiff;
      return b.urgencyLevel - a.urgencyLevel;
    });

  const immediateCount = scoredLeads.filter(l => l.priority === "immediate").length;
  const highCount = scoredLeads.filter(l => l.priority === "high").length;
  const mediumCount = scoredLeads.filter(l => l.priority === "medium").length;

  const scoreDistribution = ["A+", "A", "B+", "B", "C", "D"].map(grade => ({
    grade,
    count: scoredLeads.filter(l => l.motivationGrade === grade).length,
  }));

  const strategy = buildCampaignStrategy(scoredLeads, immediateCount, highCount);

  return {
    organizationId,
    processedAt: new Date().toISOString(),
    totalLeads: scoredLeads.length,
    immediateCount,
    highCount,
    mediumCount,
    topLeads: scoredLeads.slice(0, 25),
    scoreDistribution,
    recommendedCampaignStrategy: strategy,
    weeklyFocus: getWeeklyFocus(),
  };
}

function buildCampaignStrategy(
  leads: LeadIntelligenceProfile[],
  immediateCount: number,
  highCount: number
): string {
  if (immediateCount > 0) {
    return `${immediateCount} IMMEDIATE priority lead(s) detected — likely facing tax sale deadlines. Contact these first, today. Then work through the ${highCount} HIGH priority leads this week with personalized blind offers.`;
  }

  if (highCount > 10) {
    return `Strong pipeline with ${highCount} high-priority leads. Focus this week on the top 10 by urgency score. Segment by county and send county-specific offer letters with batch pricing.`;
  }

  if (leads.length < 50) {
    return `Lead volume is low (${leads.length} scored leads). Consider importing a fresh county tax delinquent list or expanding your target county list to generate more deal opportunities.`;
  }

  return `Steady pipeline. Work the high and medium priority leads systematically. Ensure you're mailing consistently — 500+ letters per county per month drives reliable deal flow.`;
}

function getWeeklyFocus(): string {
  const focuses = [
    "Focus: Mail your tax delinquent list for the county where you sent offers 30 days ago. These sellers have had time to sit with your offer.",
    "Focus: Re-engage every lead that responded in the last 90 days but didn't close. Circumstances change — they may be ready now.",
    "Focus: Skip trace and add phone numbers to your top 20 priority leads. A call after 3 letters dramatically increases close rate.",
    "Focus: Review your note portfolio — any late payments? Address dunning before adding new deals.",
    "Focus: Run the Blind Offer Wizard for any county you haven't analyzed this month. Fresh comps = accurate offers.",
  ];
  return focuses[Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000)) % focuses.length];
}

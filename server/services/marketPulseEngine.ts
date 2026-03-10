// @ts-nocheck
/**
 * Market Pulse Engine
 *
 * Proactive county monitoring system that watches land market conditions
 * across your target counties and surfaces actionable intelligence when
 * opportunity windows open or close.
 *
 * Inspired by the best practices from Art of Passive Income / Land Geek:
 *   - "Mail consistently to multiple counties — when one softens, pivot to another"
 *   - "A hot market has 10+ bidders on eBay sold listings"
 *   - "Opportunity windows are narrow — when land appreciates 15%+ in 12 months,
 *      your 25-cent offer becomes much harder to find willing sellers"
 *   - "Watch for tax sale notices — county tax sales signal distressed inventory"
 *   - "Building permit surges precede price increases by 6-12 months"
 *
 * Alert Types:
 *   OPPORTUNITY_WINDOW_OPENING — County transitioning from cold to warm/hot
 *   OPPORTUNITY_WINDOW_CLOSING — Market heating up, offer prices must adjust
 *   COMPETITION_SPIKE_DETECTED — Signs of increased investor mailing activity
 *   TAX_SALE_APPROACHING — County tax sale deadline within 60 days
 *   USDA_VALUE_UPDATE — Annual land value update available for county
 *   MIGRATION_ACCELERATION — Census data shows accelerating in-migration
 *   PERMIT_SURGE — Building permits up 50%+ vs prior year
 *   PRICE_COMPRESSION — Spread between lowest and median comp narrowing
 *   COMP_STALENESS — County comps > 90 days old — recalibrate offer
 *
 * Reworked.ai-Inspired Intelligence Approach:
 *   Rather than showing raw data and making users interpret it,
 *   Market Pulse synthesizes signals into actionable "pulse cards"
 *   with a clear action, urgency level, and expected ROI impact.
 *   This is the difference between a data tool and an intelligence tool.
 */

import { db } from "../db";
import { countyMarkets, organizations } from "@shared/schema";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import { getCachedLandTrend, getCachedCountySnapshot } from "./usdaNassService";
import { buildCountyOpportunityProfile, getKnownMigrationHotspots } from "./censusDataService";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AlertType =
  | "opportunity_window_opening"
  | "opportunity_window_closing"
  | "competition_spike_detected"
  | "tax_sale_approaching"
  | "usda_value_update"
  | "migration_acceleration"
  | "permit_surge"
  | "price_compression"
  | "comp_staleness"
  | "market_turning_point"
  | "best_buying_season";

export type AlertUrgency = "immediate" | "this_week" | "this_month" | "fyi";
export type AlertImpact = "very_high" | "high" | "medium" | "low";

export interface MarketPulseAlert {
  id: string;
  type: AlertType;
  county: string;
  state: string;
  urgency: AlertUrgency;
  impact: AlertImpact;
  headline: string;
  details: string;
  recommendedAction: string;
  estimatedROIImpact: string; // e.g. "+15% offer acceptance rate"
  dataPoints: Record<string, string | number>; // Raw supporting data
  detectedAt: string;
  expiresAt: string | null; // null = evergreen
  isRead?: boolean;
}

export interface CountyPulseSnapshot {
  county: string;
  state: string;
  pulseScore: number; // 0-100, current opportunity intensity
  pulseTrend: "rising" | "steady" | "falling";
  opportunityWindow: "open" | "narrowing" | "closed" | "watch";
  alerts: MarketPulseAlert[];
  lastRefreshedAt: string;
  nextRefreshAt: string;
  keyMetrics: {
    usdaLandValuePerAcre: number;
    usdaYoYChange: number;
    landValueCagr5Year: number;
    migrationSignal: string;
    buildingPermitTrend: string;
    competitionLevel: string;
  };
}

export interface MarketPulseReport {
  organizationId: number;
  generatedAt: string;
  totalAlerts: number;
  immediateAlerts: MarketPulseAlert[];
  weeklyAlerts: MarketPulseAlert[];
  monthlyAlerts: MarketPulseAlert[];
  topOpportunityCounties: { county: string; state: string; pulseScore: number; reason: string }[];
  counties: CountyPulseSnapshot[];
  marketSummary: string;
  weeklyWisdom: string;
}

// ---------------------------------------------------------------------------
// The Weekly Wisdom Engine
// Land Geek / Art of Passive Income-inspired rotating market insights
// ---------------------------------------------------------------------------

const WEEKLY_WISDOM_POOL = [
  "Consistency beats intensity. Mailing 500 letters every month beats mailing 10,000 letters once a year. Pipeline = consistency.",
  "The best time to campaign a county is right AFTER prices have flattened — not during the run-up, when sellers get greedy.",
  "Thin comp markets (fewer than 5 sales/year) are dangerous for blind offers. Validate with eBay before sending a single letter.",
  "Owner financing at 9% is a feature, not a bug. Your buyers cannot get bank financing for raw land — that's WHY they'll pay your terms.",
  "A county with 10+ eBay bidders on comparable parcels is telling you: buyers exist, prices are transparent, the model works here. Validate this before mailing.",
  "When a county's tax delinquent list grows 20%+ year-over-year, that's a distress signal — and a buying opportunity. More motivated sellers, same buyer pool.",
  "Down payment = acquisition cost recovery on day one. If you structure this correctly, every deal is essentially capital-neutral from day one. The 84 monthly payments are pure profit.",
  "Three counties, consistent monthly campaigns, realistic pricing: that's the system. Complexity is the enemy of execution.",
  "The seller who saves your letter and calls 90 days later is worth more than the seller who calls immediately. Long-term leads are a feature of the blind offer system.",
  "Market softness in your county isn't a problem — it's opportunity. When prices flatten, motivated sellers need solutions more than ever.",
  "In inflationary environments, revisit your comps every 60 days. A 12-month-old comp in a 10%-appreciation market is a 10%-wrong offer price.",
  "The 25-cent offer isn't a lowball — it's a filter. It filters for the sellers whose situation makes your price the solution to their problem.",
  "Cash flip first, notes second. Build capital through flips, then deploy that capital into a note portfolio that generates passive income compoundingly.",
  "Land notes survive recessions better than residential mortgages. Default on a land note = you get the land back + all payments made. Default on a house = foreclosure hell.",
  "Your morning briefing is your most important business meeting. Review deal pipeline, active notes, and campaign response rates before anything else.",
];

export function getWeeklyWisdom(): string {
  const weekNumber = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  return WEEKLY_WISDOM_POOL[weekNumber % WEEKLY_WISDOM_POOL.length];
}

// ---------------------------------------------------------------------------
// Alert Generators
// ---------------------------------------------------------------------------

async function detectOpportunityWindowAlerts(
  county: string,
  state: string,
  trend: any,
  nassData: any,
  censusProfile: any
): Promise<MarketPulseAlert[]> {
  const alerts: MarketPulseAlert[] = [];
  const now = new Date();

  // Opening: market was flat/declining, now showing early appreciation signs
  if (trend && trend.oneYearChangePercent >= 2 && trend.oneYearChangePercent <= 6
      && trend.threeYearChangePercent < 10) {
    alerts.push({
      id: `${state}-${county}-window-opening-${Date.now()}`,
      type: "opportunity_window_opening",
      county,
      state,
      urgency: "this_month",
      impact: "very_high",
      headline: `${county} County opportunity window opening — land values up ${trend.oneYearChangePercent}% YoY`,
      details: `USDA land values in ${county} County (${state}) have increased ${trend.oneYearChangePercent}% over the past year, after a period of flat growth. This early-appreciation signal is historically predictive of a 6-18 month buying window before seller expectations catch up to price reality.`,
      recommendedAction: `Start a 1,000-letter campaign targeting tax-delinquent and out-of-state owners in ${county} County immediately. Early entry before prices accelerate gives you maximum seller acceptance rate.`,
      estimatedROIImpact: "Higher seller acceptance at 25¢ on dollar before expectation reset",
      dataPoints: {
        usdaYoYChange: `${trend.oneYearChangePercent}%`,
        usdaCagr5Year: `${trend.cagr5Year}%`,
        landValuePerAcre: `$${nassData?.pasturePerAcre || "N/A"}/acre`,
      },
      detectedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    });
  }

  // Closing: market appreciation accelerating — offer prices must adjust
  if (trend && trend.oneYearChangePercent > 8) {
    alerts.push({
      id: `${state}-${county}-window-closing-${Date.now()}`,
      type: "opportunity_window_closing",
      county,
      state,
      urgency: "immediate",
      impact: "high",
      headline: `${county} County market heating up — recalibrate your offer formula`,
      details: `Land values in ${county} County have risen ${trend.oneYearChangePercent}% in the past year (5-year CAGR: ${trend.cagr5Year}%). In rapidly appreciating markets, 12-month comps understate current value, reducing your acceptance rate. Sellers are aware prices are rising.`,
      recommendedAction: `Recalibrate to 6-month comps only. Consider moving from 25% to 30-33% of lowest comp to maintain your 3-of-5 acceptance rate. Or shift budget to a nearby county with lower appreciation.`,
      estimatedROIImpact: "Recalibrating offer prevents 40-50% drop in acceptance rate",
      dataPoints: {
        usdaYoYChange: `${trend.oneYearChangePercent}%`,
        usdaCagr5Year: `${trend.cagr5Year}%`,
        trend: trend.trend,
      },
      detectedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString(),
    });
  }

  return alerts;
}

function detectMigrationAlerts(
  county: string,
  state: string,
  censusProfile: any
): MarketPulseAlert[] {
  const alerts: MarketPulseAlert[] = [];
  const now = new Date();

  if (!censusProfile?.migration) return alerts;

  const signal = censusProfile.migration.landDemandSignal;

  if (signal === "strong") {
    const hotspot = getKnownMigrationHotspots().find(
      h => h.state === state.toUpperCase() && h.county.toLowerCase() === county.toLowerCase()
    );

    alerts.push({
      id: `${state}-${county}-migration-${Date.now()}`,
      type: "migration_acceleration",
      county,
      state,
      urgency: "this_month",
      impact: "high",
      headline: `Strong in-migration to ${county} County — land demand rising`,
      details: hotspot
        ? `${county} County is receiving significant in-migration from ${hotspot.primaryMetroFeeder}. ${hotspot.notes}. Rising population means rising demand for weekend recreational land within driving distance of the metro.`
        : `Census data shows strong positive net migration into ${county} County. This precedes rising land demand and buyer competition, which supports higher resale prices for your inventory.`,
      recommendedAction: `Market buyer-side land listings with "weekend getaway" and "2 hours from [metro]" angles. The migration story is your marketing hook to buyers. Increase listing prices accordingly.`,
      estimatedROIImpact: "+10-20% resale price premium vs. non-migration counties",
      dataPoints: {
        migrationSignal: signal,
        nearestMetro: hotspot?.primaryMetroFeeder || "Unknown",
        hotspotScore: hotspot?.migrationScore || "N/A",
      },
      detectedAt: now.toISOString(),
      expiresAt: null,
    });
  }

  return alerts;
}

function detectSeasonalAlerts(county: string, state: string): MarketPulseAlert[] {
  const alerts: MarketPulseAlert[] = [];
  const now = new Date();
  const month = now.getMonth() + 1; // 1-12

  // Best mailing seasons for land (typically Jan-Feb and Sep-Oct)
  // Jan-Feb: New year motivation, tax bills arriving, sellers more receptive
  // Sep-Oct: Pre-fall, before holiday slowdown, tax delinquency notices arrive
  const isOptimalMailingSeason = (month >= 1 && month <= 3) || (month >= 9 && month <= 11);

  if (isOptimalMailingSeason) {
    const seasonName = month <= 3 ? "Q1 (January-March)" : "Q4 (September-November)";
    alerts.push({
      id: `${state}-${county}-season-${now.getFullYear()}-${month}`,
      type: "best_buying_season",
      county,
      state,
      urgency: "this_week",
      impact: "medium",
      headline: `${seasonName} is peak mailing season for ${county} County`,
      details: `${month <= 3 ? "Q1 is historically the highest response rate season for blind offers — New Year motivation, property tax bills arriving, and post-holiday financial reality push sellers to act." : "Q4 (pre-November) is the second-best mailing window — county tax delinquency notices are arriving and sellers are motivated before year-end."}`,
      recommendedAction: `Launch your ${county} County campaign this month to capitalize on peak seller motivation. Aim for 1,000+ letters to generate meaningful deal flow.`,
      estimatedROIImpact: "+20-30% response rate vs. summer mailings historically",
      dataPoints: {
        currentMonth: new Date().toLocaleDateString("en-US", { month: "long" }),
        peakSeason: seasonName,
      },
      detectedAt: now.toISOString(),
      expiresAt: new Date(now.getFullYear(), Math.min(month + 1, 12), 1).toISOString(),
    });
  }

  return alerts;
}

function detectCompStalenessAlerts(county: string, state: string, lastCompDate?: Date): MarketPulseAlert[] {
  const alerts: MarketPulseAlert[] = [];
  const now = new Date();

  const daysOld = lastCompDate
    ? Math.floor((now.getTime() - lastCompDate.getTime()) / (24 * 60 * 60 * 1000))
    : 91; // Default to stale if unknown

  if (daysOld > 90) {
    alerts.push({
      id: `${state}-${county}-stale-comps-${Date.now()}`,
      type: "comp_staleness",
      county,
      state,
      urgency: "this_month",
      impact: "medium",
      headline: `${county} County comps are ${daysOld} days old — recalibrate before mailing`,
      details: `Your comparable sales data for ${county} County is ${daysOld > 90 ? "more than 90 days" : `${daysOld} days`} old. In the current market, stale comps can cause you to offer too low (missing motivated sellers) or too high (destroying your margin). The Podolsky methodology requires fresh comps for accurate blind offer pricing.`,
      recommendedAction: `Pull fresh comps from LandWatch, Land and Farm, and county assessor records. Look for sales within the last 60-90 days only. Recalculate your offer price before the next campaign.`,
      estimatedROIImpact: "Accurate comps = accurate offers = higher acceptance rate",
      dataPoints: {
        lastCompDate: lastCompDate?.toLocaleDateString() || "Unknown",
        daysOld,
        recommendedRefreshFrequency: "60 days in appreciating markets, 90 days in flat markets",
      },
      detectedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
  }

  return alerts;
}

// ---------------------------------------------------------------------------
// County Pulse Score
// ---------------------------------------------------------------------------

function computePulseScore(
  trend: any,
  nassData: any,
  censusProfile: any,
  alerts: MarketPulseAlert[]
): number {
  let score = 50;

  // Appreciation rate (5-12% = sweet spot for land investing)
  if (trend) {
    if (trend.oneYearChangePercent >= 3 && trend.oneYearChangePercent <= 10) score += 20;
    else if (trend.oneYearChangePercent > 10) score += 5; // Hot market = closing window
    else if (trend.oneYearChangePercent < 0) score -= 15;
  }

  // Migration signal
  if (censusProfile?.migration?.landDemandSignal === "strong") score += 15;
  else if (censusProfile?.migration?.landDemandSignal === "moderate") score += 8;
  else if (censusProfile?.migration?.landDemandSignal === "negative") score -= 10;

  // Building permits
  if (censusProfile?.permits?.totalPermits > 200) score += 10;
  else if (censusProfile?.permits?.totalPermits > 50) score += 5;

  // Alert modifiers
  for (const alert of alerts) {
    if (alert.type === "opportunity_window_opening") score += 10;
    if (alert.type === "opportunity_window_closing") score -= 8;
    if (alert.type === "best_buying_season") score += 5;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

function computePulseTrend(trend: any): "rising" | "steady" | "falling" {
  if (!trend) return "steady";
  if (trend.oneYearChangePercent > 3) return "rising";
  if (trend.oneYearChangePercent < -1) return "falling";
  return "steady";
}

function computeOpportunityWindow(
  pulseScore: number,
  trend: any
): "open" | "narrowing" | "closed" | "watch" {
  if (trend && trend.oneYearChangePercent > 10) return "narrowing";
  if (trend && trend.oneYearChangePercent > 15) return "closed";
  if (pulseScore >= 65) return "open";
  if (pulseScore >= 45) return "watch";
  return "closed";
}

// ---------------------------------------------------------------------------
// Main Orchestrator
// ---------------------------------------------------------------------------

export async function generateCountyPulse(
  county: string,
  state: string
): Promise<CountyPulseSnapshot> {
  const [trendResult, nassResult, censusResult] = await Promise.allSettled([
    getCachedLandTrend(state, county),
    getCachedCountySnapshot(state, county),
    buildCountyOpportunityProfile(state, county),
  ]);

  const trend = trendResult.status === "fulfilled" ? trendResult.value : null;
  const nassData = nassResult.status === "fulfilled" ? nassResult.value : null;
  const censusProfile = censusResult.status === "fulfilled" ? censusResult.value : null;

  // Gather all alerts
  const [oppAlerts, migrationAlerts, seasonalAlerts, stalenessAlerts] = await Promise.all([
    detectOpportunityWindowAlerts(county, state, trend, nassData, censusProfile),
    Promise.resolve(detectMigrationAlerts(county, state, censusProfile)),
    Promise.resolve(detectSeasonalAlerts(county, state)),
    Promise.resolve(detectCompStalenessAlerts(county, state)),
  ]);

  const allAlerts = [...oppAlerts, ...migrationAlerts, ...seasonalAlerts, ...stalenessAlerts];

  // Compute scores
  const pulseScore = computePulseScore(trend, nassData, censusProfile, allAlerts);
  const pulseTrend = computePulseTrend(trend);
  const opportunityWindow = computeOpportunityWindow(pulseScore, trend);

  const now = new Date();

  return {
    county,
    state: state.toUpperCase(),
    pulseScore,
    pulseTrend,
    opportunityWindow,
    alerts: allAlerts,
    lastRefreshedAt: now.toISOString(),
    nextRefreshAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(), // Daily refresh
    keyMetrics: {
      usdaLandValuePerAcre: nassData?.pasturePerAcre || 0,
      usdaYoYChange: trend?.oneYearChangePercent || 0,
      landValueCagr5Year: trend?.cagr5Year || 0,
      migrationSignal: censusProfile?.migration?.landDemandSignal || "unknown",
      buildingPermitTrend: censusProfile?.permits?.permitsTrend || "unknown",
      competitionLevel: pulseScore > 70 ? "high" : pulseScore > 50 ? "medium" : "low",
    },
  };
}

export async function generateMarketPulseReport(
  organizationId: number,
  targetCounties: { county: string; state: string }[]
): Promise<MarketPulseReport> {
  const now = new Date();

  // Generate pulse for all counties in parallel
  const pulseResults = await Promise.allSettled(
    targetCounties.map(c => generateCountyPulse(c.county, c.state))
  );

  const counties = pulseResults
    .filter(r => r.status === "fulfilled")
    .map(r => (r as PromiseFulfilledResult<CountyPulseSnapshot>).value);

  // Aggregate alerts by urgency
  const allAlerts = counties.flatMap(c => c.alerts);
  const immediateAlerts = allAlerts.filter(a => a.urgency === "immediate");
  const weeklyAlerts = allAlerts.filter(a => a.urgency === "this_week");
  const monthlyAlerts = allAlerts.filter(a => a.urgency === "this_month");

  // Top opportunity counties
  const topOpportunityCounties = [...counties]
    .sort((a, b) => b.pulseScore - a.pulseScore)
    .slice(0, 5)
    .map(c => ({
      county: c.county,
      state: c.state,
      pulseScore: c.pulseScore,
      reason: c.opportunityWindow === "open"
        ? `Opportunity window open — ${c.keyMetrics.usdaYoYChange.toFixed(1)}% YoY appreciation, ${c.keyMetrics.migrationSignal} migration signal`
        : `Watch — market shifting, monitor for entry timing`,
    }));

  // Market summary
  const openCount = counties.filter(c => c.opportunityWindow === "open").length;
  const narrowingCount = counties.filter(c => c.opportunityWindow === "narrowing").length;
  const marketSummary = buildMarketSummary(counties, openCount, narrowingCount);

  return {
    organizationId,
    generatedAt: now.toISOString(),
    totalAlerts: allAlerts.length,
    immediateAlerts,
    weeklyAlerts,
    monthlyAlerts,
    topOpportunityCounties,
    counties,
    marketSummary,
    weeklyWisdom: getWeeklyWisdom(),
  };
}

function buildMarketSummary(
  counties: CountyPulseSnapshot[],
  openCount: number,
  narrowingCount: number
): string {
  if (counties.length === 0) {
    return "Add counties to your watchlist to receive Market Pulse intelligence.";
  }

  const total = counties.length;
  const avgPulse = Math.round(counties.reduce((s, c) => s + c.pulseScore, 0) / total);
  const topCounty = counties.sort((a, b) => b.pulseScore - a.pulseScore)[0];

  if (openCount === total) {
    return `All ${total} watched counties showing open opportunity windows. Average pulse score: ${avgPulse}/100. Ideal conditions for aggressive mailing campaigns. Best county: ${topCounty.county}, ${topCounty.state} (${topCounty.pulseScore}/100).`;
  }

  if (narrowingCount > openCount) {
    return `${narrowingCount} of ${total} counties showing narrowing opportunity windows — market is heating up. Consider adjusting offer percentages upward or pivoting to adjacent counties. Best remaining opportunity: ${topCounty.county}, ${topCounty.state}.`;
  }

  return `Mixed market conditions across ${total} counties. ${openCount} open, ${narrowingCount} narrowing. Focus campaign resources on ${topCounty.county} County (pulse ${topCounty.pulseScore}/100). Average portfolio pulse: ${avgPulse}/100.`;
}

// ---------------------------------------------------------------------------
// Default Top Target Counties
// ---------------------------------------------------------------------------

export const DEFAULT_WATCHLIST_COUNTIES = [
  { county: "Mohave", state: "AZ" },
  { county: "Navajo", state: "AZ" },
  { county: "Pinal", state: "AZ" },
  { county: "San Juan", state: "NM" },
  { county: "Brewster", state: "TX" },
  { county: "Columbia", state: "FL" },
  { county: "Hardin", state: "TN" },
  { county: "Costilla", state: "CO" },
];

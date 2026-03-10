// @ts-nocheck
/**
 * County Opportunity Score & Market Cycle Intelligence (EPIC 6)
 *
 * Transforms AcreOS market intelligence from descriptive to predictive:
 *   - What HAPPENED (sales data, prices)  → What IS HAPPENING (trends, velocity)
 *   - What IS HAPPENING → What WILL HAPPEN (cycle position, lead indicators)
 *   - What WILL HAPPEN → What TO DO (prescriptive county recommendations)
 *
 * Expert land investing market analysis framework:
 *
 * THE COUNTY SELECTION MATRIX (expert-validated):
 *
 * BEST TIME TO ENTER a county:
 *   - Population growth outpacing supply (pre-boom)
 *   - Days-on-market falling (demand accelerating)
 *   - Fewer than 10 investors actively mailing
 *   - No major economic negatives (plant closure, natural disaster)
 *   - Infrastructure investment announced (highway, hospital, school)
 *
 * WORST TIME TO ENTER a county:
 *   - Every investor is already mailing there (red ocean)
 *   - Days-on-market rising (buyer demand falling)
 *   - Major employer left the county
 *   - Prices have risen so much that 25-30% acquisitions are impossible
 *   - Market is in "distribution" phase (insiders selling to retail)
 *
 * THE MARKET CYCLE FOR RAW LAND:
 * Phase 1 — Accumulation: Prices flat/falling, smart money quietly buying
 * Phase 2 — Markup: Prices rising, volume increasing, media attention begins
 * Phase 3 — Distribution: Peak prices, high volume, widespread optimism
 * Phase 4 — Markdown: Prices falling, volume dropping, fear setting in
 *
 * LEAD INDICATOR SIGNALS (things that PRECEDE price movement):
 *   - Municipal planning approvals (18–36 month lead time before development)
 *   - Employer announcements (12–24 months before workforce arrives)
 *   - Infrastructure project awards (24–48 months before impact)
 *   - Building permit counts (3–6 months lead time)
 *   - Listing count changes (1–3 months lead time)
 *   - Out-of-state investor activity increase (1–3 months lead time)
 */

import { db } from "../db";
import { countyMarkets, properties, deals } from "@shared/schema";
import { eq, and, desc, gte, sql, avg, count } from "drizzle-orm";
import { subDays, subMonths, subYears } from "date-fns";

// ---------------------------------------------------------------------------
// County Opportunity Score (0–100)
// Updated monthly with fresh market data
// ---------------------------------------------------------------------------

export interface CountyOpportunityScoreInput {
  state: string;
  county: string;

  // Price signals
  priceVelocity3Mo: number; // % change in avg price/acre last 3 months
  priceVelocity12Mo: number; // % change in avg price/acre last 12 months
  avgPricePerAcre: number;
  pricePerAcreVs2YrAvg: number; // % above or below 2-year average

  // Volume signals
  salesVolume90Days: number; // # of closed sales in last 90 days
  salesVolume12Months: number; // # of closed sales in last 12 months
  avgDaysOnMarket: number;
  domTrend: number; // Change in DOM vs prior period (negative = market tightening = bullish)

  // Supply/demand
  activeListings: number;
  monthsOfSupply: number; // activeListings / (salesVolume12Months / 12)
  listingCountTrend: number; // % change in listings vs 3 months ago

  // Investor competition
  estimatedInvestorMailingCount: number; // How many investors are actively mailing
  recentPriceIncreasePercent: number; // Are prices going up so much deals are impossible?

  // Growth indicators
  populationGrowthRate: number; // % over 5 years
  permitCountTrend: number; // % change in building permits vs last year
  distanceToNearestMetroMiles: number;
  hasRecentInfrastructureAnnouncement: boolean; // New highway, hospital, school
  hasRecentEmployerAnnouncement: boolean; // Major employer moving in/out

  // Recreational value
  hasLakeOrRiver: boolean;
  hasNationalForest: boolean;
  hasRecreationalAmenities: boolean;
}

export interface CountyOpportunityScoreResult {
  overallScore: number; // 0–100
  cyclePosition: "accumulation" | "markup" | "distribution" | "markdown" | "unknown";
  opportunityWindow: "open" | "narrowing" | "closing" | "closed";
  marketMomentumScore: number; // Price + volume trend (0–100)
  buyerDemandScore: number; // How easy is it to sell here? (0–100)
  investorCompetitionScore: number; // Lower = better (inverted, 0–100)
  growthPotentialScore: number; // Lead indicators pointing to future appreciation (0–100)

  recommendation: "buy_aggressively" | "buy_selectively" | "test_with_small_mailing" | "watch_list" | "avoid";
  keyInsights: string[];
  redFlags: string[];
  tailwinds: string[];

  // For UI display
  trendArrow: "↑↑" | "↑" | "→" | "↓" | "↓↓";
  badgeColor: "green" | "yellow" | "orange" | "red" | "gray";
}

export function computeCountyOpportunityScore(
  input: CountyOpportunityScoreInput
): CountyOpportunityScoreResult {
  const keyInsights: string[] = [];
  const redFlags: string[] = [];
  const tailwinds: string[] = [];

  // ── Market Momentum Score (0–100) ────────────────────────────────────────
  let momentumScore = 0;

  // Price velocity — positive but not too hot (>25% = may be pricing out deals)
  if (input.priceVelocity12Mo >= 5 && input.priceVelocity12Mo <= 20) {
    momentumScore += 30;
    tailwinds.push(`Healthy price appreciation: +${input.priceVelocity12Mo.toFixed(1)}% over 12 months`);
  } else if (input.priceVelocity12Mo > 20) {
    momentumScore += 15; // Rising but may be overheated
    redFlags.push(`Rapid price appreciation (${input.priceVelocity12Mo.toFixed(1)}%) — deals at 30% of ARV may be difficult`);
  } else if (input.priceVelocity12Mo < -5) {
    momentumScore += 5;
    redFlags.push(`Prices declining (${input.priceVelocity12Mo.toFixed(1)}%) — cautious buying only`);
  } else {
    momentumScore += 20; // Flat market = can still find deals
    keyInsights.push(`Stable prices — flat market allows disciplined buying at consistent discounts`);
  }

  // Sales volume — consistent activity = healthy market
  if (input.salesVolume12Months >= 10 && input.salesVolume12Months <= 100) {
    momentumScore += 25;
    keyInsights.push(`${input.salesVolume12Months} land sales in last 12 months — healthy, active market`);
  } else if (input.salesVolume12Months > 100) {
    momentumScore += 15; // Very active = more competition
  } else if (input.salesVolume12Months >= 5) {
    momentumScore += 15;
  } else {
    momentumScore += 0; // < 5 sales/year = illiquid market
    redFlags.push(`Only ${input.salesVolume12Months} land sales in 12 months — very thin market, hard to exit`);
  }

  // DOM trend — falling DOM = demand outpacing supply
  if (input.domTrend < -15) {
    momentumScore += 20;
    tailwinds.push(`Days-on-market falling sharply (${Math.abs(input.domTrend)} days faster) — demand accelerating`);
  } else if (input.domTrend < 0) {
    momentumScore += 12;
    tailwinds.push(`Days-on-market trending down — improving buyer demand`);
  } else if (input.domTrend > 20) {
    momentumScore -= 10;
    redFlags.push(`Days-on-market rising (+${input.domTrend} days) — buyer demand weakening`);
  } else {
    momentumScore += 5;
  }

  momentumScore = Math.max(0, Math.min(100, momentumScore));

  // ── Buyer Demand Score (0–100) ────────────────────────────────────────────
  let demandScore = 0;

  if (input.avgDaysOnMarket <= 45) {
    demandScore += 40;
    tailwinds.push(`Fast market: average ${input.avgDaysOnMarket} days to sell — strong exit velocity`);
  } else if (input.avgDaysOnMarket <= 90) {
    demandScore += 28;
    keyInsights.push(`Moderate exit velocity: ${input.avgDaysOnMarket} average days on market`);
  } else if (input.avgDaysOnMarket <= 180) {
    demandScore += 15;
  } else {
    demandScore += 5;
    redFlags.push(`Slow market: ${input.avgDaysOnMarket} avg DOM — plan for 6+ month hold periods`);
  }

  if (input.monthsOfSupply <= 3) {
    demandScore += 30;
    tailwinds.push(`Only ${input.monthsOfSupply.toFixed(1)} months of supply — seller's market conditions`);
  } else if (input.monthsOfSupply <= 6) {
    demandScore += 20;
    keyInsights.push(`Balanced market: ${input.monthsOfSupply.toFixed(1)} months of supply`);
  } else if (input.monthsOfSupply <= 12) {
    demandScore += 10;
  } else {
    demandScore += 0;
    redFlags.push(`${input.monthsOfSupply.toFixed(1)} months of supply — buyer's market, hard to sell at asking price`);
  }

  if (input.hasLakeOrRiver || input.hasNationalForest || input.hasRecreationalAmenities) {
    demandScore += 20;
    tailwinds.push(`Recreational amenities drive premium buyer demand and reduce days on market`);
  }

  if (input.distanceToNearestMetroMiles >= 30 && input.distanceToNearestMetroMiles <= 120) {
    demandScore += 10;
    keyInsights.push(`Ideal distance from metro (${Math.round(input.distanceToNearestMetroMiles)} miles) — attractive to weekend/recreational buyers`);
  } else if (input.distanceToNearestMetroMiles > 200) {
    demandScore -= 10;
    redFlags.push(`Very remote location (${Math.round(input.distanceToNearestMetroMiles)} miles from metro) — limits buyer pool`);
  }

  demandScore = Math.max(0, Math.min(100, demandScore));

  // ── Investor Competition Score (0–100, lower competition = higher score) ──
  let competitionScore = 0;
  const mailCount = input.estimatedInvestorMailingCount;

  if (mailCount <= 3) {
    competitionScore = 100;
    tailwinds.push(`Blue ocean: only ${mailCount} investors mailing — first-mover advantage`);
  } else if (mailCount <= 10) {
    competitionScore = 80;
    tailwinds.push(`Low competition: ~${mailCount} investors in county — excellent opportunity`);
  } else if (mailCount <= 25) {
    competitionScore = 55;
    keyInsights.push(`Moderate competition: ~${mailCount} investors mailing — differentiate on speed and personalization`);
  } else if (mailCount <= 50) {
    competitionScore = 30;
    redFlags.push(`High competition: ~${mailCount} investors mailing — response rates will be compressed`);
  } else {
    competitionScore = 10;
    redFlags.push(`Red ocean: ~${mailCount}+ investors mailing — avoid unless you have deep local expertise`);
  }

  // ── Growth Potential Score (0–100) ────────────────────────────────────────
  let growthScore = 0;

  if (input.populationGrowthRate >= 10) {
    growthScore += 35;
    tailwinds.push(`Strong population growth: +${input.populationGrowthRate.toFixed(1)}% over 5 years — sustained demand ahead`);
  } else if (input.populationGrowthRate >= 5) {
    growthScore += 20;
    tailwinds.push(`Positive population growth: +${input.populationGrowthRate.toFixed(1)}% over 5 years`);
  } else if (input.populationGrowthRate < -2) {
    growthScore -= 10;
    redFlags.push(`Population declining (${input.populationGrowthRate.toFixed(1)}%) — long-term demand risk`);
  }

  if (input.hasRecentInfrastructureAnnouncement) {
    growthScore += 30;
    tailwinds.push(`Infrastructure investment announced — buy before construction begins for maximum appreciation`);
  }

  if (input.hasRecentEmployerAnnouncement) {
    growthScore += 25;
    tailwinds.push(`Major employer announced — workforce housing and land demand to follow`);
  }

  if (input.permitCountTrend >= 20) {
    growthScore += 15;
    tailwinds.push(`Building permits up ${input.permitCountTrend.toFixed(0)}% — developer demand for land increasing`);
  } else if (input.permitCountTrend >= 5) {
    growthScore += 8;
  } else if (input.permitCountTrend < -20) {
    redFlags.push(`Building permits declining ${Math.abs(input.permitCountTrend).toFixed(0)}% — development demand falling`);
  }

  growthScore = Math.max(0, Math.min(100, growthScore));

  // ── Overall Score ─────────────────────────────────────────────────────────
  const overallScore = Math.round(
    momentumScore * 0.25 +
    demandScore * 0.30 +
    competitionScore * 0.30 +
    growthScore * 0.15
  );

  // ── Cycle Position ────────────────────────────────────────────────────────
  let cyclePosition: CountyOpportunityScoreResult["cyclePosition"] = "unknown";

  if (input.priceVelocity12Mo < 0 && input.salesVolume12Months < 10) {
    cyclePosition = "markdown";
  } else if (input.priceVelocity12Mo < 5 && input.monthsOfSupply > 9) {
    cyclePosition = "accumulation"; // Cheap and quiet = accumulate
  } else if (input.priceVelocity12Mo >= 5 && input.domTrend <= 0 && input.monthsOfSupply <= 8) {
    cyclePosition = "markup"; // Prices rising, demand strong = markup phase
  } else if (input.priceVelocity12Mo >= 15 && input.estimatedInvestorMailingCount > 30) {
    cyclePosition = "distribution"; // Everyone's in, prices peak = distribution
  } else {
    cyclePosition = "accumulation";
  }

  // ── Opportunity Window ────────────────────────────────────────────────────
  let opportunityWindow: CountyOpportunityScoreResult["opportunityWindow"];
  if (cyclePosition === "accumulation" && competitionScore >= 70) {
    opportunityWindow = "open";
  } else if (cyclePosition === "markup" && competitionScore >= 50) {
    opportunityWindow = "narrowing";
  } else if (cyclePosition === "distribution") {
    opportunityWindow = "closing";
  } else if (cyclePosition === "markdown") {
    opportunityWindow = "closed";
  } else {
    opportunityWindow = cyclePosition === "accumulation" ? "open" : "narrowing";
  }

  // ── Recommendation ────────────────────────────────────────────────────────
  let recommendation: CountyOpportunityScoreResult["recommendation"];
  if (overallScore >= 75 && redFlags.length === 0) {
    recommendation = "buy_aggressively";
  } else if (overallScore >= 60) {
    recommendation = "buy_selectively";
  } else if (overallScore >= 45) {
    recommendation = "test_with_small_mailing";
  } else if (overallScore >= 30) {
    recommendation = "watch_list";
  } else {
    recommendation = "avoid";
  }

  // ── Trend Arrow ───────────────────────────────────────────────────────────
  let trendArrow: CountyOpportunityScoreResult["trendArrow"];
  if (input.priceVelocity12Mo >= 10 && input.domTrend < -10) trendArrow = "↑↑";
  else if (input.priceVelocity12Mo >= 5 || input.domTrend < 0) trendArrow = "↑";
  else if (input.priceVelocity12Mo < -5) trendArrow = "↓↓";
  else if (input.priceVelocity12Mo < 0) trendArrow = "↓";
  else trendArrow = "→";

  // ── Badge Color ───────────────────────────────────────────────────────────
  const badgeColor =
    overallScore >= 75
      ? "green"
      : overallScore >= 55
      ? "yellow"
      : overallScore >= 35
      ? "orange"
      : overallScore >= 20
      ? "red"
      : "gray";

  return {
    overallScore,
    cyclePosition,
    opportunityWindow,
    marketMomentumScore: momentumScore,
    buyerDemandScore: demandScore,
    investorCompetitionScore: competitionScore,
    growthPotentialScore: growthScore,
    recommendation,
    keyInsights: keyInsights.slice(0, 4),
    redFlags: redFlags.slice(0, 4),
    tailwinds: tailwinds.slice(0, 4),
    trendArrow,
    badgeColor,
  };
}

// ---------------------------------------------------------------------------
// Lead Indicator Alerts
//
// Track pre-boom signals BEFORE prices move — enter early, exit at the peak
// ---------------------------------------------------------------------------

export interface LeadIndicatorAlert {
  county: string;
  state: string;
  alertType:
    | "infrastructure_project"
    | "employer_announcement"
    | "population_surge"
    | "permit_spike"
    | "investor_rush"
    | "price_inflection";
  title: string;
  description: string;
  severity: "informational" | "notable" | "significant" | "major";
  estimatedPriceImpact: string; // e.g., "+15-25% over 24 months"
  actionRecommendation: string;
  sourceUrl?: string;
  detectedAt: Date;
  isActedUpon: boolean;
}

export async function detectLeadIndicatorAlerts(
  state: string,
  county: string
): Promise<LeadIndicatorAlert[]> {
  const alerts: LeadIndicatorAlert[] = [];

  // Check news APIs for infrastructure/employer announcements
  // In production: query BLS API, DOT project database, news APIs
  const newsApiKey = process.env.NEWS_API_KEY;
  if (newsApiKey) {
    try {
      const query = `${county} county ${state} (new development OR highway OR hospital OR employer OR manufacturing OR distribution center OR data center)`;
      const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&sortBy=publishedAt&pageSize=10&language=en&from=${new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]}`;

      const resp = await fetch(url, {
        headers: { "X-Api-Key": newsApiKey },
        signal: AbortSignal.timeout(5000),
      });

      if (resp.ok) {
        const data = await resp.json();
        for (const article of (data.articles || []).slice(0, 5)) {
          const title = article.title?.toLowerCase() || "";
          const desc = article.description?.toLowerCase() || "";
          const text = title + " " + desc;

          let alertType: LeadIndicatorAlert["alertType"] | null = null;
          let estimatedImpact = "+5-15% over 18-36 months";
          let severity: LeadIndicatorAlert["severity"] = "informational";

          if (/highway|interstate|route expansion|road project|bypass/i.test(text)) {
            alertType = "infrastructure_project";
            estimatedImpact = "+10-25% over 24-48 months";
            severity = "significant";
          } else if (/data center|manufacturing plant|distribution center|warehouse|amazon|tesla|toyota/i.test(text)) {
            alertType = "employer_announcement";
            estimatedImpact = "+15-30% over 12-24 months";
            severity = "major";
          } else if (/hospital|medical center|healthcare campus/i.test(text)) {
            alertType = "infrastructure_project";
            estimatedImpact = "+8-18% over 18-30 months";
            severity = "notable";
          }

          if (alertType) {
            alerts.push({
              county,
              state,
              alertType,
              title: article.title || "Unknown",
              description: article.description || "",
              severity,
              estimatedPriceImpact: estimatedImpact,
              actionRecommendation:
                alertType === "employer_announcement"
                  ? "Act within 60 days — employer announcements drive the fastest land price increases"
                  : "Add to watchlist and increase mailing frequency in surrounding areas",
              sourceUrl: article.url,
              detectedAt: new Date(),
              isActedUpon: false,
            });
          }
        }
      }
    } catch (err: any) {
      console.warn(`[CountyOpportunity] News API error for ${county}, ${state}:`, err.message);
    }
  }

  return alerts;
}

// ---------------------------------------------------------------------------
// Market Intelligence Report Generator
// Creates a county-level narrative report for investors
// ---------------------------------------------------------------------------

export function generateCountyIntelligenceReport(
  county: string,
  state: string,
  score: CountyOpportunityScoreResult,
  historicalData: {
    avgPricePerAcre12MoAgo: number;
    avgPricePerAcreNow: number;
    salesVolume12MoAgo: number;
    salesVolumeNow: number;
    domNow: number;
  }
): string {
  const priceChange =
    historicalData.avgPricePerAcre12MoAgo > 0
      ? (
          ((historicalData.avgPricePerAcreNow - historicalData.avgPricePerAcre12MoAgo) /
            historicalData.avgPricePerAcre12MoAgo) *
          100
        ).toFixed(1)
      : "0";

  const cycleEmoji = {
    accumulation: "🌱",
    markup: "📈",
    distribution: "⚠️",
    markdown: "📉",
    unknown: "❓",
  }[score.cyclePosition];

  const recommendationLabel = {
    buy_aggressively: "🎯 Buy Aggressively",
    buy_selectively: "✅ Buy Selectively",
    test_with_small_mailing: "🔍 Test with Small Mailing",
    watch_list: "👀 Watch List",
    avoid: "❌ Avoid for Now",
  }[score.recommendation];

  return `
# ${county} County, ${state} — Market Intelligence Report

## Opportunity Score: ${score.overallScore}/100 ${score.trendArrow}
**Cycle Position:** ${cycleEmoji} ${score.cyclePosition.charAt(0).toUpperCase() + score.cyclePosition.slice(1)}
**Recommendation:** ${recommendationLabel}

## Market Snapshot
- Average price/acre: $${historicalData.avgPricePerAcreNow.toLocaleString()} (${parseFloat(priceChange) >= 0 ? "+" : ""}${priceChange}% YoY)
- Sales volume (12 months): ${historicalData.salesVolumeNow} transactions
- Average days on market: ${historicalData.domNow} days

## Opportunity Window: ${score.opportunityWindow.toUpperCase()}
${score.tailwinds.length > 0 ? "\n### Tailwinds\n" + score.tailwinds.map((t) => `- ${t}`).join("\n") : ""}
${score.redFlags.length > 0 ? "\n### Red Flags\n" + score.redFlags.map((r) => `- ⚠️ ${r}`).join("\n") : ""}
${score.keyInsights.length > 0 ? "\n### Key Insights\n" + score.keyInsights.map((i) => `- ${i}`).join("\n") : ""}

## Subscores
| Category | Score | Weight |
|----------|-------|--------|
| Market Momentum | ${score.marketMomentumScore}/100 | 25% |
| Buyer Demand | ${score.buyerDemandScore}/100 | 30% |
| Low Competition | ${score.investorCompetitionScore}/100 | 30% |
| Growth Potential | ${score.growthPotentialScore}/100 | 15% |

*Report generated ${new Date().toLocaleDateString()} · AcreOS Market Intelligence*
`.trim();
}

export default {
  computeCountyOpportunityScore,
  detectLeadIndicatorAlerts,
  generateCountyIntelligenceReport,
};

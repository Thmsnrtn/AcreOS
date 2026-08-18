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
import { logger } from "../utils/logger";

// ---------------------------------------------------------------------------
// County Opportunity Score (0–100)
// Updated monthly with fresh market data
// ---------------------------------------------------------------------------

/**
 * EVERY signal is nullable, and null means "not measured" — never zero, never
 * false, never a stand-in average.
 *
 * Why the whole interface is nullable
 * ───────────────────────────────────
 * This model was designed for a live market feed AcreOS does not have. All
 * three production callers responded to that by passing literal constants —
 * `avgDaysOnMarket: 90`, `monthsOfSupply: 6`, `estimatedInvestorMailingCount:
 * 10`, `distanceToNearestMetroMiles: 80`, four `has…: false` — and the model
 * dutifully turned them into "Moderate exit velocity: 90 average days on
 * market", a 0–100 opportunity score, and a recommendation to *buy*. That is a
 * fixed number dressed up as a proprietary model output, which is exactly what
 * `parcelIntelligenceFusion.ts` refused to do (see its note at ~line 207) and
 * is what the standing no-fabrication rule forbids.
 *
 * Making every field `| null` moves the decision from "what default should I
 * pass?" to "do I actually have this?". A caller can no longer supply a
 * plausible constant by omission — it has to write the constant down, where a
 * reviewer and `countyOpportunityHonesty.test.ts` can both see it.
 *
 * Booleans are nullable for the same reason and it matters most there:
 * `hasRecentInfrastructureAnnouncement: false` ASSERTS that AcreOS checked and
 * found none. `null` says it never looked.
 */
export interface CountyOpportunityScoreInput {
  state: string;
  county: string;

  // Price signals
  priceVelocity3Mo: number | null; // % change in avg price/acre last 3 months
  priceVelocity12Mo: number | null; // % change in avg price/acre last 12 months
  avgPricePerAcre: number | null;
  pricePerAcreVs2YrAvg: number | null; // % above or below 2-year average

  // Volume signals
  salesVolume90Days: number | null; // # of closed sales in last 90 days
  salesVolume12Months: number | null; // # of closed sales in last 12 months
  avgDaysOnMarket: number | null;
  domTrend: number | null; // Change in DOM vs prior period (negative = market tightening = bullish)

  // Supply/demand
  activeListings: number | null;
  monthsOfSupply: number | null; // activeListings / (salesVolume12Months / 12)
  listingCountTrend: number | null; // % change in listings vs 3 months ago

  // Investor competition
  estimatedInvestorMailingCount: number | null; // How many investors are actively mailing
  recentPriceIncreasePercent: number | null; // Are prices going up so much deals are impossible?

  // Growth indicators
  populationGrowthRate: number | null; // % over 5 years
  permitCountTrend: number | null; // % change in building permits vs last year
  distanceToNearestMetroMiles: number | null;
  hasRecentInfrastructureAnnouncement: boolean | null; // New highway, hospital, school
  hasRecentEmployerAnnouncement: boolean | null; // Major employer moving in/out

  // Recreational value
  hasLakeOrRiver: boolean | null;
  hasNationalForest: boolean | null;
  hasRecreationalAmenities: boolean | null;
}

/**
 * The signals without which there is no market to score. Fewer than all four
 * and the model refuses outright rather than scoring a county from its
 * defaults — which is how a county AcreOS holds no data for used to come back
 * with "Opportunity Score: 61/100 — Buy Selectively".
 */
export const REQUIRED_SIGNALS = [
  "priceVelocity12Mo",
  "avgPricePerAcre",
  "salesVolume12Months",
  "avgDaysOnMarket",
] as const;

export interface CountyOpportunityScoreResult {
  overallScore: number; // 0–100, over the dimensions actually measured
  /**
   * Which signals were measured and which were absent. Every consumer that
   * renders `overallScore` must render this too — a score built from two of
   * four dimensions is a different claim from one built from four, and without
   * this field the two are indistinguishable.
   */
  dataBasis: {
    measured: string[];
    missing: string[];
    /** The four weighted dimensions that had at least one measured signal. */
    dimensionsScored: Array<"momentum" | "demand" | "competition" | "growth">;
    /** 0–1: the share of the model's weight that rests on measured signals. */
    weightCoverage: number;
  };
  cyclePosition: "accumulation" | "markup" | "distribution" | "markdown" | "unknown";
  opportunityWindow: "open" | "narrowing" | "closing" | "closed";
  // Each subscore is `null` when none of its signals were measured — NOT 0.
  // A zero here reads "we looked and this county is bad"; null reads "we did
  // not look". Renderers must distinguish them.
  marketMomentumScore: number | null; // Price + volume trend (0–100)
  buyerDemandScore: number | null; // How easy is it to sell here? (0–100)
  investorCompetitionScore: number | null; // Lower = better (inverted, 0–100)
  growthPotentialScore: number | null; // Lead indicators pointing to future appreciation (0–100)

  recommendation: "buy_aggressively" | "buy_selectively" | "test_with_small_mailing" | "watch_list" | "avoid";
  keyInsights: string[];
  redFlags: string[];
  tailwinds: string[];

  // For UI display
  trendArrow: "↑↑" | "↑" | "→" | "↓" | "↓↓";
  badgeColor: "green" | "yellow" | "orange" | "red" | "gray";
}

/**
 * Returns `null` when the county cannot be scored — see `REQUIRED_SIGNALS`.
 *
 * A null return is a real answer and callers must render it as one. The
 * previous contract could not express "I don't know", so every caller got a
 * number whether or not one existed.
 */
export function computeCountyOpportunityScore(
  input: CountyOpportunityScoreInput
): CountyOpportunityScoreResult | null {
  const keyInsights: string[] = [];
  const redFlags: string[] = [];
  const tailwinds: string[] = [];

  // ── Data basis, computed before anything is scored ───────────────────────
  const SIGNALS = [
    "priceVelocity3Mo", "priceVelocity12Mo", "avgPricePerAcre", "pricePerAcreVs2YrAvg",
    "salesVolume90Days", "salesVolume12Months", "avgDaysOnMarket", "domTrend",
    "activeListings", "monthsOfSupply", "listingCountTrend",
    "estimatedInvestorMailingCount", "recentPriceIncreasePercent",
    "populationGrowthRate", "permitCountTrend", "distanceToNearestMetroMiles",
    "hasRecentInfrastructureAnnouncement", "hasRecentEmployerAnnouncement",
    "hasLakeOrRiver", "hasNationalForest", "hasRecreationalAmenities",
  ] as const;
  const has = (k: (typeof SIGNALS)[number]): boolean =>
    input[k] !== null && input[k] !== undefined;
  const measured = SIGNALS.filter(has) as string[];
  const missing = SIGNALS.filter((k) => !has(k)) as string[];

  // REFUSE. Without the core market signals there is nothing to score, and a
  // score produced anyway is indistinguishable from one produced from data.
  const missingRequired = REQUIRED_SIGNALS.filter((k) => !has(k));
  if (missingRequired.length > 0) {
    logger.info("county_opportunity_refused", {
      metadata: { state: input.state, county: input.county, missingRequired },
    });
    return null;
  }

  /**
   * Each dimension accumulates `points` out of the `weight` it was actually
   * able to look at, so a dimension with one of three signals present is
   * scored out of that one signal — NOT out of three with two scored zero,
   * which would read as "measured, and bad".
   */
  const dim = () => ({ points: 0, available: 0 });
  const norm = (d: { points: number; available: number }): number | null =>
    d.available === 0 ? null : Math.max(0, Math.min(100, (d.points / d.available) * 100));

  // ── Market Momentum ──────────────────────────────────────────────────────
  const momentum = dim();

  // Price velocity — positive but not too hot (>25% = may be pricing out deals)
  // (required signal, so non-null here)
  const pv12 = input.priceVelocity12Mo!;
  momentum.available += 30;
  if (pv12 >= 5 && pv12 <= 20) {
    momentum.points += 30;
    tailwinds.push(`Healthy price appreciation: +${pv12.toFixed(1)}% over 12 months`);
  } else if (pv12 > 20) {
    momentum.points += 15; // Rising but may be overheated
    redFlags.push(`Rapid price appreciation (${pv12.toFixed(1)}%) — deals at 30% of ARV may be difficult`);
  } else if (pv12 < -5) {
    momentum.points += 5;
    redFlags.push(`Prices declining (${pv12.toFixed(1)}%) — cautious buying only`);
  } else {
    momentum.points += 20; // Flat market = can still find deals
    keyInsights.push(`Stable prices — flat market allows disciplined buying at consistent discounts`);
  }

  // Sales volume — consistent activity = healthy market (required signal)
  const vol12 = input.salesVolume12Months!;
  momentum.available += 25;
  if (vol12 >= 10 && vol12 <= 100) {
    momentum.points += 25;
    keyInsights.push(`${vol12} land sales in last 12 months — healthy, active market`);
  } else if (vol12 > 100) {
    momentum.points += 15; // Very active = more competition
  } else if (vol12 >= 5) {
    momentum.points += 15;
  } else {
    momentum.points += 0; // < 5 sales/year = illiquid market
    redFlags.push(`Only ${vol12} land sales in 12 months — very thin market, hard to exit`);
  }

  // DOM trend — falling DOM = demand outpacing supply.
  // Optional: with no prior period on file there is no trend, and the old
  // `else` branch scored an unmeasured trend as mildly positive.
  if (input.domTrend !== null) {
    const dt = input.domTrend;
    momentum.available += 20;
    if (dt < -15) {
      momentum.points += 20;
      tailwinds.push(`Days-on-market falling sharply (${Math.abs(dt)} days faster) — demand accelerating`);
    } else if (dt < 0) {
      momentum.points += 12;
      tailwinds.push(`Days-on-market trending down — improving buyer demand`);
    } else if (dt > 20) {
      momentum.points += 0;
      redFlags.push(`Days-on-market rising (+${dt} days) — buyer demand weakening`);
    } else {
      momentum.points += 5;
    }
  }

  const momentumScore = norm(momentum);

  // ── Buyer Demand ─────────────────────────────────────────────────────────
  const demand = dim();

  const dom = input.avgDaysOnMarket!; // required signal
  demand.available += 40;
  if (dom <= 45) {
    demand.points += 40;
    tailwinds.push(`Fast market: average ${dom} days to sell — strong exit velocity`);
  } else if (dom <= 90) {
    demand.points += 28;
    keyInsights.push(`Moderate exit velocity: ${dom} average days on market`);
  } else if (dom <= 180) {
    demand.points += 15;
  } else {
    demand.points += 5;
    redFlags.push(`Slow market: ${dom} avg DOM — plan for 6+ month hold periods`);
  }

  if (input.monthsOfSupply !== null) {
    const mos = input.monthsOfSupply;
    demand.available += 30;
    if (mos <= 3) {
      demand.points += 30;
      tailwinds.push(`Only ${mos.toFixed(1)} months of supply — seller's market conditions`);
    } else if (mos <= 6) {
      demand.points += 20;
      keyInsights.push(`Balanced market: ${mos.toFixed(1)} months of supply`);
    } else if (mos <= 12) {
      demand.points += 10;
    } else {
      demand.points += 0;
      redFlags.push(`${mos.toFixed(1)} months of supply — buyer's market, hard to sell at asking price`);
    }
  }

  // Amenities: three independent booleans, any of which may be unmeasured.
  // The dimension only widens for the ones actually checked, and the tailwind
  // is claimed only on a TRUE — never on an unchecked null read as false.
  const amenities = [input.hasLakeOrRiver, input.hasNationalForest, input.hasRecreationalAmenities];
  if (amenities.some((a) => a !== null)) {
    demand.available += 20;
    if (amenities.some((a) => a === true)) {
      demand.points += 20;
      tailwinds.push(`Recreational amenities drive premium buyer demand and reduce days on market`);
    }
  }

  if (input.distanceToNearestMetroMiles !== null) {
    const miles = input.distanceToNearestMetroMiles;
    demand.available += 10;
    if (miles >= 30 && miles <= 120) {
      demand.points += 10;
      keyInsights.push(`Ideal distance from metro (${Math.round(miles)} miles) — attractive to weekend/recreational buyers`);
    } else if (miles > 200) {
      demand.points += 0;
      redFlags.push(`Very remote location (${Math.round(miles)} miles from metro) — limits buyer pool`);
    } else {
      demand.points += 5;
    }
  }

  const demandScore = norm(demand);

  // ── Investor Competition (lower competition = higher score) ──────────────
  // This dimension carries 30% of the model on ONE signal AcreOS has never
  // measured: how many investors are mailing a county. Every caller passed a
  // literal 10, which lands in the "Low competition — excellent opportunity"
  // band and pushed a fixed +80 into 30% of every score ever produced. With
  // the signal absent the dimension is simply not scored, and the weight
  // redistributes across the dimensions that were.
  let competitionScore: number | null = null;
  if (input.estimatedInvestorMailingCount !== null) {
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
  }

  // ── Growth Potential ─────────────────────────────────────────────────────
  const growth = dim();

  if (input.populationGrowthRate !== null) {
    const pop = input.populationGrowthRate;
    growth.available += 35;
    if (pop >= 10) {
      growth.points += 35;
      tailwinds.push(`Strong population growth: +${pop.toFixed(1)}% over 5 years — sustained demand ahead`);
    } else if (pop >= 5) {
      growth.points += 20;
      tailwinds.push(`Positive population growth: +${pop.toFixed(1)}% over 5 years`);
    } else if (pop < -2) {
      growth.points += 0;
      redFlags.push(`Population declining (${pop.toFixed(1)}%) — long-term demand risk`);
    } else {
      growth.points += 10;
    }
  }

  // `false` here means "checked, none announced" and scores zero out of 30.
  // `null` means nobody checked, and must not be scored at all.
  if (input.hasRecentInfrastructureAnnouncement !== null) {
    growth.available += 30;
    if (input.hasRecentInfrastructureAnnouncement) {
      growth.points += 30;
      tailwinds.push(`Infrastructure investment announced — buy before construction begins for maximum appreciation`);
    }
  }

  if (input.hasRecentEmployerAnnouncement !== null) {
    growth.available += 25;
    if (input.hasRecentEmployerAnnouncement) {
      growth.points += 25;
      tailwinds.push(`Major employer announced — workforce housing and land demand to follow`);
    }
  }

  if (input.permitCountTrend !== null) {
    const permits = input.permitCountTrend;
    growth.available += 15;
    if (permits >= 20) {
      growth.points += 15;
      tailwinds.push(`Building permits up ${permits.toFixed(0)}% — developer demand for land increasing`);
    } else if (permits >= 5) {
      growth.points += 8;
    } else if (permits < -20) {
      growth.points += 0;
      redFlags.push(`Building permits declining ${Math.abs(permits).toFixed(0)}% — development demand falling`);
    } else {
      growth.points += 4;
    }
  }

  const growthScore = norm(growth);

  // ── Overall Score, over the dimensions that were measurable ──────────────
  // Weights renormalize across the dimensions that scored. A dimension with no
  // measured signal contributes neither points nor weight — the alternative
  // (treating it as zero) reads as "we measured this county and it is bad".
  const WEIGHTS = { momentum: 0.25, demand: 0.30, competition: 0.30, growth: 0.15 } as const;
  const dimensionScores: Array<[keyof typeof WEIGHTS, number | null]> = [
    ["momentum", momentumScore],
    ["demand", demandScore],
    ["competition", competitionScore],
    ["growth", growthScore],
  ];
  const scored = dimensionScores.filter((d): d is [keyof typeof WEIGHTS, number] => d[1] !== null);
  const weightCoverage = scored.reduce((sum, [k]) => sum + WEIGHTS[k], 0);
  // `momentum` and `demand` both contain required signals, so weightCoverage
  // is at least 0.55 here and the division is safe — but be explicit anyway.
  const overallScore =
    weightCoverage > 0
      ? Math.round(scored.reduce((sum, [k, v]) => sum + v * WEIGHTS[k], 0) / weightCoverage)
      : 0;

  // ── Cycle Position ────────────────────────────────────────────────────────
  // Every clause needs signals the model may not have. `unknown` is a real
  // cycle position (it is in the union, and the report renders it as ❓);
  // previously the final `else` asserted "accumulation" — the phase you buy
  // in — for any county whose signals didn't match, including a county with
  // no signals at all.
  let cyclePosition: CountyOpportunityScoreResult["cyclePosition"] = "unknown";
  const mos = input.monthsOfSupply;
  const dTrend = input.domTrend;
  const mail = input.estimatedInvestorMailingCount;

  if (pv12 < 0 && vol12 < 10) {
    cyclePosition = "markdown";
  } else if (mos !== null && pv12 < 5 && mos > 9) {
    cyclePosition = "accumulation"; // Cheap and quiet = accumulate
  } else if (mos !== null && dTrend !== null && pv12 >= 5 && dTrend <= 0 && mos <= 8) {
    cyclePosition = "markup"; // Prices rising, demand strong = markup phase
  } else if (mail !== null && pv12 >= 15 && mail > 30) {
    cyclePosition = "distribution"; // Everyone's in, prices peak = distribution
  } else if (mos !== null && dTrend !== null) {
    // All the supply/trend signals are present and none of the phases matched.
    cyclePosition = "accumulation";
  }

  // ── Opportunity Window ────────────────────────────────────────────────────
  // Depends on the competition dimension, which is null whenever the mailing
  // count is unmeasured — and on a known cycle position.
  let opportunityWindow: CountyOpportunityScoreResult["opportunityWindow"];
  if (cyclePosition === "distribution") {
    opportunityWindow = "closing";
  } else if (cyclePosition === "markdown") {
    opportunityWindow = "closed";
  } else if (competitionScore !== null && cyclePosition === "accumulation" && competitionScore >= 70) {
    opportunityWindow = "open";
  } else if (competitionScore !== null && cyclePosition === "markup" && competitionScore >= 50) {
    opportunityWindow = "narrowing";
  } else {
    opportunityWindow = "narrowing";
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
  // priceVelocity12Mo is required; domTrend is not, so the clauses that need
  // it are gated. "→" for flat is the honest fallback: it is the only arrow
  // that asserts nothing about direction.
  let trendArrow: CountyOpportunityScoreResult["trendArrow"];
  if (dTrend !== null && pv12 >= 10 && dTrend < -10) trendArrow = "↑↑";
  else if (pv12 >= 5 || (dTrend !== null && dTrend < 0)) trendArrow = "↑";
  else if (pv12 < -5) trendArrow = "↓↓";
  else if (pv12 < 0) trendArrow = "↓";
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
    dataBasis: {
      measured,
      missing,
      dimensionsScored: scored.map(([k]) => k),
      weightCoverage: Number(weightCoverage.toFixed(2)),
    },
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
      logger.warn(`[CountyOpportunity] News API error for ${county}, ${state}`, { metadata: { detail: err.message } });
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
    avgPricePerAcre12MoAgo: number | null;
    avgPricePerAcreNow: number | null;
    salesVolume12MoAgo: number | null;
    salesVolumeNow: number | null;
    domNow: number | null;
  }
): string {
  /** A figure that isn't on file is printed as "not on file", never as 0. */
  const fig = (v: number | null, fmt: (n: number) => string): string =>
    v === null || v === undefined ? "not on file" : fmt(v);
  const sub = (v: number | null): string => (v === null ? "not scored" : `${v}/100`);

  // A YoY change needs BOTH years. The old expression fell back to "0", which
  // printed "(+0.0% YoY)" — a claim that prices were flat — for a county with
  // no prior year on file at all.
  const priceChange =
    historicalData.avgPricePerAcre12MoAgo !== null &&
    historicalData.avgPricePerAcre12MoAgo > 0 &&
    historicalData.avgPricePerAcreNow !== null
      ? (
          ((historicalData.avgPricePerAcreNow - historicalData.avgPricePerAcre12MoAgo) /
            historicalData.avgPricePerAcre12MoAgo) *
          100
        ).toFixed(1)
      : null;

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
- Average price/acre: ${fig(historicalData.avgPricePerAcreNow, (n) => `$${n.toLocaleString()}`)}${priceChange === null ? "" : ` (${parseFloat(priceChange) >= 0 ? "+" : ""}${priceChange}% YoY)`}
- Sales volume (12 months): ${fig(historicalData.salesVolumeNow, (n) => `${n} transactions`)}
- Average days on market: ${fig(historicalData.domNow, (n) => `${n} days`)}
- Signals measured: ${score.dataBasis.measured.length} of ${score.dataBasis.measured.length + score.dataBasis.missing.length} (${Math.round(score.dataBasis.weightCoverage * 100)}% of the model's weight); dimensions scored: ${score.dataBasis.dimensionsScored.join(", ") || "none"}

## Opportunity Window: ${score.opportunityWindow.toUpperCase()}
${score.tailwinds.length > 0 ? "\n### Tailwinds\n" + score.tailwinds.map((t) => `- ${t}`).join("\n") : ""}
${score.redFlags.length > 0 ? "\n### Red Flags\n" + score.redFlags.map((r) => `- ⚠️ ${r}`).join("\n") : ""}
${score.keyInsights.length > 0 ? "\n### Key Insights\n" + score.keyInsights.map((i) => `- ${i}`).join("\n") : ""}

## Subscores
| Category | Score | Weight |
|----------|-------|--------|
| Market Momentum | ${sub(score.marketMomentumScore)} | 25% |
| Buyer Demand | ${sub(score.buyerDemandScore)} | 30% |
| Low Competition | ${sub(score.investorCompetitionScore)} | 30% |
| Growth Potential | ${sub(score.growthPotentialScore)} | 15% |

*Report generated ${new Date().toLocaleDateString()} · AcreOS Market Intelligence*
`.trim();
}

export default {
  computeCountyOpportunityScore,
  detectLeadIndicatorAlerts,
  generateCountyIntelligenceReport,
};

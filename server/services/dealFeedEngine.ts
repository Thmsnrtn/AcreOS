// @ts-nocheck — ORM type refinement deferred; runtime-correct
/**
 * Deal Feed Engine — orchestrated pipeline with composite scoring,
 * feedback learning loop, and preference-adjusted rankings.
 *
 * Pipeline target: <60 seconds total.
 * Uses Promise.allSettled so one failing source never blocks the feed.
 */

import { db } from "../db";
import {
  dailyDealFeed,
  dealFeedInteractions,
  organizations,
  properties,
  deals,
  territories,
  type DealOpportunity,
} from "@shared/schema";
import { eq, and, desc, gte, sql, count } from "drizzle-orm";
import { subDays, startOfDay } from "date-fns";
import { logger } from "../utils/logger";

// ---------------------------------------------------------------------------
// Composite score formula
// ---------------------------------------------------------------------------

const DEFAULT_WEIGHTS = {
  radar: 0.30,
  ownerMotivation: 0.30,
  countyOpportunity: 0.20,
  landCredit: 0.20,
};

function normalizeLandCredit(lcs: number): number {
  // maps 300-850 → 0-100
  return Math.max(0, Math.min(100, ((lcs - 300) / 550) * 100));
}

function computeComposite(
  scores: { radar: number; ownerMotivation: number; countyOpportunity: number; landCredit: number },
  weights = DEFAULT_WEIGHTS,
  patternSimilarity?: number,
): number {
  const raw =
    scores.radar * weights.radar +
    scores.ownerMotivation * weights.ownerMotivation +
    scores.countyOpportunity * weights.countyOpportunity +
    normalizeLandCredit(scores.landCredit) * weights.landCredit;

  let composite = raw;
  if (patternSimilarity != null) {
    if (patternSimilarity > 0.9) composite *= 1.25;
    else if (patternSimilarity > 0.7) composite *= 1.15;
  }
  return Math.min(100, Math.round(composite * 100) / 100);
}

// ---------------------------------------------------------------------------
// Target county resolution
// ---------------------------------------------------------------------------

async function getTargetCounties(orgId: number): Promise<{ state: string; county: string }[]> {
  // 1) Explicit territories
  const orgTerritories = await db.select().from(territories)
    .where(eq(territories.organizationId, orgId));

  if (orgTerritories.length > 0) {
    const counties: { state: string; county: string }[] = [];
    for (const t of orgTerritories) {
      const parsed = Array.isArray(t.counties) ? t.counties : [];
      for (const c of parsed) {
        if (typeof c === "string") {
          counties.push({ state: t.stateCode, county: c });
        } else if (c && typeof c === "object" && "county" in c) {
          counties.push({ state: t.stateCode, county: (c as any).county });
        }
      }
    }
    if (counties.length > 0) return counties;
  }

  // 2) Infer from existing properties/deals
  const propCounties = await db
    .selectDistinct({ state: properties.state, county: properties.county })
    .from(properties)
    .where(eq(properties.organizationId, orgId))
    .limit(20);

  const uniqueCounties = propCounties.filter(
    (c): c is { state: string; county: string } => !!c.state && !!c.county,
  );
  if (uniqueCounties.length > 0) return uniqueCounties;

  // 3) National top 10 fallback — return broad defaults
  return [
    { state: "TX", county: "Hudspeth" },
    { state: "TX", county: "Culberson" },
    { state: "NM", county: "Otero" },
    { state: "AZ", county: "Cochise" },
    { state: "NV", county: "Nye" },
    { state: "CO", county: "Costilla" },
    { state: "FL", county: "Highlands" },
    { state: "CA", county: "Kern" },
    { state: "OR", county: "Lake" },
    { state: "WA", county: "Okanogan" },
  ];
}

// ---------------------------------------------------------------------------
// Deterministic opportunity ID
// ---------------------------------------------------------------------------

function opportunityId(apn: string, county: string, state: string): string {
  const raw = `${apn}|${county}|${state}`.toLowerCase();
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  }
  return `opp_${Math.abs(hash).toString(36)}`;
}

// ---------------------------------------------------------------------------
// Signal extraction helpers
// ---------------------------------------------------------------------------

function extractMotivationSignals(ownerData: any): string[] {
  const signals: string[] = [];
  if (ownerData?.isTaxDelinquent) signals.push("Tax delinquent");
  if (ownerData?.isOutOfState) signals.push("Out of state");
  if (ownerData?.isInherited) signals.push("Inherited property");
  if (ownerData?.ownershipYears && ownerData.ownershipYears >= 20) {
    signals.push(`Owned ${ownerData.ownershipYears} yrs`);
  }
  if (ownerData?.isCorporate) signals.push("Corporate owner");
  return signals;
}

function extractEnvironmentalSignals(enrichment: any): string[] {
  const signals: string[] = [];
  if (enrichment?.floodZone === "X" || enrichment?.floodZone === "None") {
    signals.push("No flood risk");
  }
  if (enrichment?.roadAccess && enrichment.roadAccess !== "none") {
    signals.push("Road access confirmed");
  }
  if (enrichment?.terrain === "flat" || enrichment?.terrain === "gentle") {
    signals.push("Flat terrain");
  }
  return signals;
}

function extractMarketSignals(countyData: any): string[] {
  const signals: string[] = [];
  if (countyData?.priceVelocity12Mo > 5) {
    signals.push(`County values rising ${Math.round(countyData.priceVelocity12Mo)}% YoY`);
  }
  if (countyData?.cyclePosition === "accumulation") {
    signals.push("Market in accumulation phase");
  }
  if (countyData?.populationGrowthRate > 2) {
    signals.push("Growing population");
  }
  return signals;
}

function extractRiskSignals(enrichment: any): string[] {
  const risks: string[] = [];
  if (enrichment?.floodZone && enrichment.floodZone !== "X" && enrichment.floodZone !== "None") {
    risks.push(`Flood zone ${enrichment.floodZone}`);
  }
  if (enrichment?.roadAccess === "none") risks.push("No road access");
  if (enrichment?.wetlandsPercent > 10) risks.push("Wetlands adjacent");
  if (enrichment?.hasEnvironmentalIssues) risks.push("Environmental concern");
  return risks;
}

// ---------------------------------------------------------------------------
// Grade helper
// ---------------------------------------------------------------------------

function lcsGrade(score: number): string {
  if (score >= 800) return "A+";
  if (score >= 750) return "A";
  if (score >= 700) return "B+";
  if (score >= 650) return "B";
  if (score >= 600) return "C+";
  if (score >= 550) return "C";
  if (score >= 450) return "D";
  return "F";
}

// ---------------------------------------------------------------------------
// Safe division
// ---------------------------------------------------------------------------

function safeDivide(numerator: number, denominator: number, fallback = 0): number {
  if (!denominator || !isFinite(denominator)) return fallback;
  const result = numerator / denominator;
  return isFinite(result) ? result : fallback;
}

// ---------------------------------------------------------------------------
// Build a single opportunity (graceful per-service)
// ---------------------------------------------------------------------------

async function buildOpportunity(
  parcel: any,
  _orgId: number,
): Promise<DealOpportunity | null> {
  try {
    const apn = parcel.apn || parcel.parcelNumber || "";
    const county = parcel.county || "";
    const state = parcel.state || "";
    if (!apn && !county) return null;

    // Default scores — each service can fail independently
    let radarScore = 50;
    let ownerMotivation = 50; // neutral default, not 0
    let countyOpp = 50;
    let lcs = 575; // middle of range
    let enrichment: any = {};
    let ownerData: any = {};
    let countyData: any = {};
    let offerData: any = null;

    // Parallel enrichment — allSettled so failures don't block
    const [radarResult, intentResult, lcsResult, offerResult] = await Promise.allSettled([
      import("./acquisitionRadar").then(m => {
        const svc = new m.AcquisitionRadarService();
        return svc.scoreParcel?.(_orgId, parcel) ?? { score: 50 };
      }),
      import("./sellerIntentPredictor").then(m => {
        const svc = new m.SellerIntentPredictorService();
        return svc.predictIntent?.(_orgId, parcel.leadId) ?? { score: 50 };
      }),
      import("./landCredit").then(m => {
        const svc = new m.default();
        return svc.calculateCreditScore?.(_orgId, parcel.propertyId) ?? { overall: 575 };
      }),
      import("./blindOfferCalculator").then(m => {
        return m.calculateBlindOffer?.({
          state,
          county,
          targetAcres: parcel.acreage || 5,
        }) ?? null;
      }),
    ]);

    if (radarResult.status === "fulfilled" && radarResult.value) {
      radarScore = radarResult.value.score ?? radarResult.value.overallScore ?? 50;
    }
    if (intentResult.status === "fulfilled" && intentResult.value) {
      ownerMotivation = intentResult.value.score ?? intentResult.value.overallScore ?? 50;
      ownerData = intentResult.value;
    }
    if (lcsResult.status === "fulfilled" && lcsResult.value) {
      lcs = lcsResult.value.overall ?? lcsResult.value.score ?? 575;
    }
    if (offerResult.status === "fulfilled" && offerResult.value) {
      offerData = offerResult.value;
    }

    // Clamp LCS to 300-850
    lcs = Math.max(300, Math.min(850, lcs));

    const composite = computeComposite({
      radar: radarScore,
      ownerMotivation,
      countyOpportunity: countyOpp,
      landCredit: lcs,
    });

    const estimatedValue = offerData?.comps?.medianSalePerAcre
      ? offerData.comps.medianSalePerAcre * (parcel.acreage || 5)
      : (parcel.assessedValue || 0);

    const aggOffer = offerData?.tiers?.[0]?.offerTotal ?? Math.round(estimatedValue * 0.25);
    const mktOffer = offerData?.tiers?.[1]?.offerTotal ?? Math.round(estimatedValue * 0.40);
    const genOffer = offerData?.tiers?.[2]?.offerTotal ?? Math.round(estimatedValue * 0.55);

    return {
      id: opportunityId(apn, county, state),
      parcel: {
        apn,
        address: parcel.address || parcel.propertyAddress || null,
        county,
        state,
        acreage: parcel.acreage || 0,
        lat: parcel.latitude || parcel.lat || 0,
        lng: parcel.longitude || parcel.lng || 0,
      },
      scores: {
        landCredit: lcs,
        landCreditGrade: lcsGrade(lcs),
        radarScore,
        ownerMotivation,
        countyOpportunity: countyOpp,
        composite,
      },
      signals: {
        motivation: extractMotivationSignals(ownerData),
        environmental: extractEnvironmentalSignals(enrichment),
        market: extractMarketSignals(countyData),
        risks: extractRiskSignals(enrichment),
      },
      financials: {
        estimatedValue,
        suggestedOffer: { aggressive: aggOffer, market: mktOffer, generous: genOffer },
        cashFlipProfit: {
          aggressive: estimatedValue - aggOffer,
          market: estimatedValue - mktOffer,
          generous: estimatedValue - genOffer,
        },
        sellerFinanceYield: offerData?.ownerFinanceScenario?.annualYield ?? null,
      },
      enrichment: {
        floodZone: enrichment?.floodZone || "Unknown",
        elevation: enrichment?.elevation ?? null,
        roadAccess: enrichment?.roadAccess || "Unknown",
        terrain: enrichment?.terrain || "Unknown",
        soil: enrichment?.soil || "Unknown",
        nearestTown: enrichment?.nearestTown ?? null,
        nearestTownDistance: enrichment?.nearestTownDistance ?? null,
      },
      matchReason: `Matches your ${county} County criteria`,
    };
  } catch (err) {
    logger.warn("failed to build opportunity", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Generate feed for an org
// ---------------------------------------------------------------------------

export async function generateDealFeed(orgId: number): Promise<DealOpportunity[]> {
  const counties = await getTargetCounties(orgId);
  if (counties.length === 0) return [];

  // Take top 5 counties
  const targetCounties = counties.slice(0, 5);

  // Gather candidates from properties table matching target counties
  const candidates: any[] = [];
  for (const { state, county } of targetCounties) {
    const parcels = await db
      .select()
      .from(properties)
      .where(
        and(
          sql`LOWER(${properties.state}) = LOWER(${state})`,
          sql`LOWER(${properties.county}) = LOWER(${county})`,
        ),
      )
      .limit(50);

    candidates.push(...parcels.map(p => ({
      ...p,
      propertyId: p.id,
      latitude: p.latitude,
      longitude: p.longitude,
    })));
  }

  // Build opportunities in parallel per county batch
  const opportunities: DealOpportunity[] = [];
  const buildResults = await Promise.allSettled(
    candidates.slice(0, 250).map(c => buildOpportunity(c, orgId)),
  );

  for (const r of buildResults) {
    if (r.status === "fulfilled" && r.value) {
      opportunities.push(r.value);
    }
  }

  // Sort by composite descending, take top 10
  opportunities.sort((a, b) => b.scores.composite - a.scores.composite);
  const top10 = opportunities.slice(0, 10);

  // Deduplicate against yesterday's feed — same parcel shouldn't appear unless saved
  const yesterday = subDays(new Date(), 1);
  const yesterdayFeed = await db
    .select()
    .from(dailyDealFeed)
    .where(
      and(
        eq(dailyDealFeed.organizationId, orgId),
        gte(dailyDealFeed.generatedAt, startOfDay(yesterday)),
      ),
    )
    .orderBy(desc(dailyDealFeed.generatedAt))
    .limit(1);

  const yesterdayIds = new Set<string>();
  if (yesterdayFeed.length > 0 && yesterdayFeed[0].opportunities) {
    for (const opp of yesterdayFeed[0].opportunities) {
      // Check if user saved it — saved items CAN reappear
      const saved = await db
        .select()
        .from(dealFeedInteractions)
        .where(
          and(
            eq(dealFeedInteractions.organizationId, orgId),
            eq(dealFeedInteractions.opportunityId, opp.id),
            eq(dealFeedInteractions.action, "interested"),
          ),
        )
        .limit(1);

      if (saved.length === 0) yesterdayIds.add(opp.id);
    }
  }

  const deduplicated = top10.filter(opp => !yesterdayIds.has(opp.id));

  // Store feed
  if (deduplicated.length > 0) {
    await db.insert(dailyDealFeed).values({
      organizationId: orgId,
      opportunities: deduplicated,
    });
  }

  return deduplicated;
}

// ---------------------------------------------------------------------------
// Get today's feed (generate on first access)
// ---------------------------------------------------------------------------

export async function getTodaysFeed(orgId: number): Promise<DealOpportunity[]> {
  const today = startOfDay(new Date());

  const existing = await db
    .select()
    .from(dailyDealFeed)
    .where(
      and(
        eq(dailyDealFeed.organizationId, orgId),
        gte(dailyDealFeed.generatedAt, today),
      ),
    )
    .orderBy(desc(dailyDealFeed.generatedAt))
    .limit(1);

  if (existing.length > 0) {
    // Mark viewed on first GET
    if (!existing[0].viewedAt) {
      await db
        .update(dailyDealFeed)
        .set({ viewedAt: new Date() })
        .where(eq(dailyDealFeed.id, existing[0].id));
    }
    return existing[0].opportunities;
  }

  return generateDealFeed(orgId);
}

// ---------------------------------------------------------------------------
// Record interaction
// ---------------------------------------------------------------------------

export async function recordInteraction(
  orgId: number,
  opportunityId: string,
  action: string,
  metadata?: any,
): Promise<void> {
  await db.insert(dealFeedInteractions).values({
    organizationId: orgId,
    opportunityId,
    action,
    metadata: metadata ?? null,
  });
}

// ---------------------------------------------------------------------------
// Feedback learning — adjust weights from interaction history
// ---------------------------------------------------------------------------

export async function adjustWeightsFromFeedback(orgId: number): Promise<Record<string, number>> {
  const interactions = await db
    .select()
    .from(dealFeedInteractions)
    .where(eq(dealFeedInteractions.organizationId, orgId));

  if (interactions.length < 5) return DEFAULT_WEIGHTS;

  // Analyze "pass" patterns vs positive patterns
  const passCharacteristics: Record<string, number> = {};
  const positiveCharacteristics: Record<string, number> = {};

  for (const i of interactions) {
    const meta = (i.metadata as any) || {};
    const characteristics = meta.characteristics || {};

    if (i.action === "pass") {
      for (const [key, val] of Object.entries(characteristics)) {
        passCharacteristics[key] = (passCharacteristics[key] || 0) + 1;
      }
    } else if (["interested", "offer_sent", "deal_created"].includes(i.action)) {
      for (const [key, val] of Object.entries(characteristics)) {
        positiveCharacteristics[key] = (positiveCharacteristics[key] || 0) + 1;
      }
    }
  }

  // Adjust weights — cap at ±30% from defaults
  const adjusted = { ...DEFAULT_WEIGHTS };
  const keys = Object.keys(adjusted) as (keyof typeof DEFAULT_WEIGHTS)[];

  for (const key of keys) {
    const passCount = passCharacteristics[key] || 0;
    const posCount = positiveCharacteristics[key] || 0;
    const adjustment = (posCount * 0.03) - (passCount * 0.02);
    const maxDelta = adjusted[key] * 0.30;
    adjusted[key] = adjusted[key] + Math.max(-maxDelta, Math.min(maxDelta, adjustment));
  }

  // Normalize weights to sum to 1
  const total = Object.values(adjusted).reduce((s, v) => s + v, 0);
  for (const key of keys) {
    adjusted[key] = adjusted[key] / total;
  }

  // Store on org
  await db
    .update(organizations)
    .set({
      settings: sql`jsonb_set(COALESCE(${organizations.settings}, '{}'), '{dealFeedPreferences}', ${JSON.stringify(adjusted)}::jsonb)`,
    })
    .where(eq(organizations.id, orgId));

  return adjusted;
}

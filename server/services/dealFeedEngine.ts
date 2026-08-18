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
import { acquisitionRadar, type ParcelData } from "./acquisitionRadar";
import type { RadarConfig } from "@shared/schema";

// NEUTRAL_RADAR_SCORE = 50 used to live here, described as keeping the feed
// "honest rather than crashing or fabricating a high score". It did prevent a
// HIGH score. It did not prevent a fabricated one: 50 entered the composite at
// full weight, so a parcel nothing could score ranked as an average parcel,
// and the comment's own framing — that the alternative to a default is a crash
// — is what hid the third option. The third option is to leave the pillar
// unscored and renormalise, which is what the scorers below now do.

/**
 * Map a feed candidate (a `properties` row, loosely typed in this pipeline)
 * onto the `ParcelData` shape the real acquisition-radar scorer expects.
 * Mirrors the mapping in acquisitionRadar.scanParcelsForOrganization so the
 * two code paths score identical inputs identically.
 */
function toParcelData(parcel: any): ParcelData {
  const num = (v: any): number | undefined => {
    if (v == null || v === "") return undefined;
    const n = typeof v === "number" ? v : parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    propertyId: typeof parcel.propertyId === "number" ? parcel.propertyId
      : typeof parcel.id === "number" ? parcel.id : undefined,
    apn: parcel.apn || parcel.parcelNumber || undefined,
    county: parcel.county || undefined,
    state: parcel.state || undefined,
    latitude: num(parcel.latitude ?? parcel.lat),
    longitude: num(parcel.longitude ?? parcel.lng),
    listPrice: num(parcel.listPrice),
    assessedValue: num(parcel.assessedValue),
    acreage: num(parcel.acreage ?? parcel.sizeAcres),
    zoning: parcel.zoning || undefined,
    daysOnMarket: num(parcel.daysOnMarket),
  };
}

/**
 * Run the REAL acquisition-radar scorer for a single parcel, falling OPEN to
 * the neutral default on any failure so one bad parcel never breaks the feed.
 * The radar scorer owns its own enrichment (fetchEnrichedData) — the feed does
 * not pre-fetch parcel/tax/market/flood data, so this adds no double-fetch.
 */
/**
 * Returns null when the radar could not score this parcel.
 *
 * This used to "fall open to the neutral default" (50) on a missing config,
 * a non-numeric result, or any thrown error. That is not neutral: 50 is
 * averaged into the composite at full weight, so an unscorable parcel was
 * ranked as an average one. Null removes the pillar from the composite
 * instead, and the weights renormalise over what did score.
 */
export async function scoreParcelRadar(
  parcel: any,
  config: RadarConfig | null,
): Promise<number | null> {
  if (!config) return null;
  try {
    const result = await acquisitionRadar.scoreParcel(toParcelData(parcel), config);
    const score = result?.score;
    return typeof score === "number" && Number.isFinite(score) ? score : null;
  } catch (err) {
    logger.warn("radar scoring failed for parcel; pillar left unscored", {
      apn: parcel?.apn || parcel?.parcelNumber || null,
      county: parcel?.county || null,
      state: parcel?.state || null,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * COLD-parcel ownerMotivation (no leadId, so no conversation to read). Mines the
 * parcel's own append-only observation log via the log-native seller-likelihood
 * scorer. Returns an intentResult-compatible shape so the existing assignment
 * (`intentScore`, plus motivation signals) needs no change downstream.
 *
 * Honesty gate: when the biography has no real longitudinal series the scorer
 * returns null — and this function now PROPAGATES that null rather than
 * substituting `intentScore: 50`. Falling open to a neutral default meant the
 * gate detected the absence of evidence and then discarded that finding, which
 * is the failure the gate exists to prevent. An unscored pillar is dropped
 * from the composite and its weight redistributed; it is not ranked as
 * average.
 *
 * Read-only and non-throwing: any error leaves the pillar unscored, never
 * breaks the feed.
 */
export async function scoreColdParcelMotivation(
  parcel: any,
  orgId: number,
): Promise<{ intentScore: number | null; drivers?: string[]; source: string }> {
  const unscored = { intentScore: null, source: "cold_no_series" };
  try {
    const apn = parcel?.apn || parcel?.parcelNumber || "";
    const state = parcel?.state || "";
    if (!apn || !state) return unscored;

    const { getParcelBiography, scoreSellerLikelihood } = await import("./parcel-biography");
    const bio = await getParcelBiography({
      apn,
      state,
      county: parcel?.county ?? null,
      organizationId: orgId,
    });

    const likelihood = scoreSellerLikelihood(bio);
    if (!likelihood) return unscored; // honesty gate → propagate the absence

    return {
      intentScore: likelihood.score,
      drivers: likelihood.drivers,
      source: "log_native_seller_likelihood",
    };
  } catch (err) {
    logger.warn("cold-parcel log-native motivation scoring failed; pillar left unscored", {
      apn: parcel?.apn || parcel?.parcelNumber || null,
      state: parcel?.state || null,
      error: err instanceof Error ? err.message : String(err),
    });
    return unscored;
  }
}

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

/**
 * Every pillar is nullable, and null means the scorer did not answer for this
 * parcel — not a neutral 50.
 *
 * Why this changed
 * ────────────────
 * The four pillars used to be seeded `radar = 50`, `ownerMotivation = 50`,
 * `countyOpp = 50`, `lcs = 575` ("middle of range"), and a scorer that failed
 * left its seed in place. `countyOpportunity` was never assigned from anything
 * at all — 20% of every composite score in the feed was the constant 50, on a
 * surface that RANKS parcels for a customer and prints three dollar offer
 * amounts beside them. A neutral midpoint is not neutral when it is averaged
 * against real scores: it pulls every ranking toward the middle and makes an
 * unscored parcel indistinguishable from a genuinely average one.
 *
 * Now a pillar that did not answer contributes neither score nor weight, and
 * the weights renormalise over the pillars that did — the same treatment
 * `countyOpportunityScore` received. `scoredPillars` travels with the result
 * so the ranking can say what it rests on.
 */
export interface CompositeResult {
  composite: number;
  scoredPillars: Array<keyof typeof DEFAULT_WEIGHTS>;
  missingPillars: Array<keyof typeof DEFAULT_WEIGHTS>;
  /** 0-1 — the share of the model's weight backed by a real score. */
  weightCoverage: number;
}

function computeComposite(
  scores: {
    radar: number | null;
    ownerMotivation: number | null;
    countyOpportunity: number | null;
    landCredit: number | null;
  },
  weights = DEFAULT_WEIGHTS,
  patternSimilarity?: number,
): CompositeResult | null {
  const pillars: Array<[keyof typeof DEFAULT_WEIGHTS, number | null]> = [
    ["radar", scores.radar],
    ["ownerMotivation", scores.ownerMotivation],
    ["countyOpportunity", scores.countyOpportunity],
    ["landCredit", scores.landCredit === null ? null : normalizeLandCredit(scores.landCredit)],
  ];
  const scored = pillars.filter((p): p is [keyof typeof DEFAULT_WEIGHTS, number] => p[1] !== null);
  const missing = pillars.filter((p) => p[1] === null).map(([k]) => k);
  const weightCoverage = scored.reduce((sum, [k]) => sum + weights[k], 0);

  // No pillar answered. There is nothing to rank this parcel by, and a
  // composite of 0 or 50 would both be claims.
  if (weightCoverage === 0) return null;

  const raw = scored.reduce((sum, [k, v]) => sum + v * weights[k], 0) / weightCoverage;

  let composite = raw;
  if (patternSimilarity != null) {
    if (patternSimilarity > 0.9) composite *= 1.25;
    else if (patternSimilarity > 0.7) composite *= 1.15;
  }
  return {
    composite: Math.min(100, Math.round(composite * 100) / 100),
    scoredPillars: scored.map(([k]) => k),
    missingPillars: missing,
    weightCoverage: Number(weightCoverage.toFixed(2)),
  };
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
  // Cold parcels carry log-native `drivers` from scoreSellerLikelihood — surface
  // them directly so the score stays explainable on the deal card (the biography
  // card is the full explanation surface; these are its headline bullets).
  if (Array.isArray(ownerData?.drivers) && ownerData.drivers.length > 0) {
    return ownerData.drivers.slice(0, 5);
  }
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

function lcsGrade(score: number | null): string | null {
  // No score, no grade. A letter is the most confident-looking thing on the
  // card; manufacturing one from a seeded 575 printed a "C" for a parcel
  // nothing had scored.
  if (score === null) return null;
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
  radarConfig: RadarConfig | null,
): Promise<DealOpportunity | null> {
  try {
    const apn = parcel.apn || parcel.parcelNumber || "";
    const county = parcel.county || "";
    const state = parcel.state || "";
    if (!apn && !county) return null;

    // null until a scorer answers. Each service can fail independently, and a
    // failure must leave its pillar UNSCORED rather than seeded at a midpoint
    // — see computeComposite for why a neutral 50 is not neutral.
    let radarScore: number | null = null;
    let ownerMotivation: number | null = null;
    // countyOpportunity has no scorer wired on this path at all. It was
    // seeded 50 and never assigned, so 20% of every composite was a constant.
    // It stays null until something computes it; `computeCountyOpportunityScore`
    // is the candidate, and it refuses without a county market row.
    const countyOpp: number | null = null;
    let lcs: number | null = null;
    let enrichment: any = {};
    let ownerData: any = {};
    let countyData: any = {};
    let offerData: any = null;

    // Parallel enrichment — allSettled so failures don't block
    const [radarResult, intentResult, lcsResult, offerResult] = await Promise.allSettled([
      // Real acquisition-radar scoring. scoreParcelRadar maps the candidate to
      // the scorer's ParcelData shape, uses the org's RadarConfig weights, and
      // falls open to the neutral default (logging a structured warn) on any
      // failure so a single bad parcel never breaks the feed.
      scoreParcelRadar(parcel, radarConfig).then(score => ({ score })),
      // ownerMotivation pillar (25% of composite). For WARM parcels (a leadId)
      // the conversation-driven predictor is correct — it reads the actual
      // dialogue. But for COLD discovery parcels (no leadId) that predictor
      // returns a constant neutral 50, making a quarter of the score a no-op for
      // exactly the parcels the feed exists to surface. There we instead mine
      // the parcel's own longitudinal biography (owner tenure, tax-delinquency
      // recurrence, stalling value acceleration) via the log-native
      // seller-likelihood scorer. The scorer's honesty gate returns null on
      // insufficient series → we fall open to the same neutral 50 as before (no
      // regression). See scoreSellerLikelihood in parcel-biography.ts.
      // FUTURE-CONSOLIDATION FLAG: conversation / snapshot / log-native are
      // three separate motivation engines; this only ROUTES the log-native one
      // to cold parcels. Unifying them is a deliberate later decision.
      (parcel.leadId
        ? import("./sellerIntentPredictor").then(m => {
            const svc = new m.SellerIntentPredictorService();
            // `?? { intentScore: 50 }` used to manufacture a mid-range
            // motivation whenever the method was absent. Absent means unscored.
            return svc.predictIntent?.(_orgId, parcel.leadId) ?? { intentScore: null };
          })
        : scoreColdParcelMotivation(parcel, _orgId)),
      import("./landCredit").then(m => {
        const svc = m.landCredit;
        // `?? { overall: 575 }` invented a mid-range land-credit score — a
        // number this feed then prints as a GRADE beside the parcel.
        return svc.calculateCreditScore?.(String(_orgId), String(parcel.propertyId)) ?? { overall: null };
      }),
      // `targetAcres: parcel.acreage || 5` — a parcel of unknown size was
      // priced as five acres, and the result drove three dollar offer amounts
      // shown to the customer. No acreage, no offer.
      import("./blindOfferCalculator").then(m => {
        const acres = Number(parcel.acreage);
        if (!Number.isFinite(acres) || acres <= 0) return null;
        return m.calculateBlindOffer?.({ state, county, targetAcres: acres }) ?? null;
      }),
    ]);

    // A rejected promise, or a fulfilled one carrying no score, both leave the
    // pillar null. `?? 50` / `?? 575` on these lines were the second half of
    // the same defect: even when a scorer answered "I have nothing", a number
    // was substituted.
    if (radarResult.status === "fulfilled" && radarResult.value) {
      radarScore = radarResult.value.score ?? null;
    }
    if (intentResult.status === "fulfilled" && intentResult.value) {
      // seller_intent_predictions exposes intentScore (0-100), not score.
      ownerMotivation = intentResult.value.intentScore ?? null;
      ownerData = intentResult.value;
    }
    if (lcsResult.status === "fulfilled" && lcsResult.value) {
      lcs = lcsResult.value.overall ?? null;
    }
    if (offerResult.status === "fulfilled" && offerResult.value) {
      offerData = offerResult.value;
    }

    // Clamp LCS to 300-850 — only if there is one.
    if (lcs !== null) lcs = Math.max(300, Math.min(850, lcs));

    const compositeResult = computeComposite({
      radar: radarScore,
      ownerMotivation,
      countyOpportunity: countyOpp,
      landCredit: lcs,
    });

    // A value needs a real per-acre figure AND a real acreage. `|| 5` supplied
    // the second when it was missing, so `medianSalePerAcre * 5` became the
    // parcel's "estimated value" and three offer tiers were derived from it.
    const parcelAcres = Number(parcel.acreage);
    const acresKnown = Number.isFinite(parcelAcres) && parcelAcres > 0;
    const assessed = Number(parcel.assessedValue);
    const estimatedValue: number | null =
      offerData?.comps?.medianSalePerAcre && acresKnown
        ? offerData.comps.medianSalePerAcre * parcelAcres
        : Number.isFinite(assessed) && assessed > 0
          ? assessed
          : null;

    // Offer tiers come from the calculator when it ran. The percentage
    // fallbacks apply only to a value that exists — no value, no offer, rather
    // than 25% of nothing presented as a suggested offer.
    const tierOrNull = (i: number, pct: number): number | null =>
      offerData?.tiers?.[i]?.offerTotal ??
      (estimatedValue === null ? null : Math.round(estimatedValue * pct));
    const aggOffer = tierOrNull(0, 0.25);
    const mktOffer = tierOrNull(1, 0.40);
    const genOffer = tierOrNull(2, 0.55);

    return {
      id: opportunityId(apn, county, state),
      parcel: {
        apn,
        address: parcel.address || parcel.propertyAddress || null,
        county,
        state,
        acreage: acresKnown ? parcelAcres : null,
        lat: parcel.latitude || parcel.lat || 0,
        lng: parcel.longitude || parcel.lng || 0,
      },
      scores: {
        landCredit: lcs,
        landCreditGrade: lcsGrade(lcs),
        radarScore,
        ownerMotivation,
        countyOpportunity: countyOpp,
        composite: compositeResult?.composite ?? null,
        basis: {
          scoredPillars: compositeResult?.scoredPillars ?? [],
          missingPillars: compositeResult?.missingPillars ?? [
            "radar", "ownerMotivation", "countyOpportunity", "landCredit",
          ],
          weightCoverage: compositeResult?.weightCoverage ?? 0,
        },
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
        // Profit is a subtraction of two figures; if either is absent there is
        // no profit to state.
        cashFlipProfit: {
          aggressive: estimatedValue !== null && aggOffer !== null ? estimatedValue - aggOffer : null,
          market: estimatedValue !== null && mktOffer !== null ? estimatedValue - mktOffer : null,
          generous: estimatedValue !== null && genOffer !== null ? estimatedValue - genOffer : null,
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
    // TENANCY. This query filtered on state + county ONLY, so the daily feed
    // built for one organization drew candidates from EVERY organization's
    // parcels in those counties — and `buildOpportunity` returns the parcel's
    // APN, address, coordinates, assessed value, tax-delinquency signals and
    // owner-motivation analysis, then persists them into that org's
    // `daily_deal_feed`. `properties.organization_id` is NOT NULL with a
    // cascade FK; there is no shared or public parcel pool for this to have
    // been reading. Every other query in this module is org-scoped
    // (`getTargetCounties` above, `daily_deal_feed`, `deal_feed_interactions`),
    // which is what marks this as an omission rather than a design.
    const parcels = await db
      .select()
      .from(properties)
      .where(
        and(
          eq(properties.organizationId, orgId),
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

  // Load the org's radar config ONCE (honest schema-default weights when the
  // org has none — getOrCreateConfig creates a Default row). Threaded into
  // every buildOpportunity so we don't reload it per parcel. If config loading
  // itself fails, fall open: radar scoring uses the neutral default.
  let radarConfig: RadarConfig | null = null;
  try {
    radarConfig = await acquisitionRadar.getOrCreateConfig(orgId);
  } catch (err) {
    logger.warn("failed to load radar config for deal feed; radar scores fall open to neutral", {
      orgId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Build opportunities in parallel per county batch
  const opportunities: DealOpportunity[] = [];
  const buildResults = await Promise.allSettled(
    candidates.slice(0, 250).map(c => buildOpportunity(c, orgId, radarConfig)),
  );

  for (const r of buildResults) {
    if (r.status === "fulfilled" && r.value) {
      opportunities.push(r.value);
    }
  }

  // A parcel with no composite cannot be ranked, and must not be surfaced as
  // a "today's deal" — the feed's whole claim is that these are the ten best
  // parcels it found, and an unscored parcel is not evidence for that claim.
  // It is dropped here rather than sorted to the bottom, so its absence is a
  // consequence of having nothing to say about it, not a low rating.
  const rankable = opportunities.filter(
    (o): o is typeof o & { scores: { composite: number } } => o.scores.composite !== null,
  );
  const unrankable = opportunities.length - rankable.length;
  if (unrankable > 0) {
    logger.info("deal_feed_dropped_unscored", {
      metadata: { orgId, dropped: unrankable, considered: opportunities.length },
    });
  }

  // Sort by composite descending, take top 10
  rankable.sort((a, b) => b.scores.composite - a.scores.composite);
  const top10 = rankable.slice(0, 10);

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

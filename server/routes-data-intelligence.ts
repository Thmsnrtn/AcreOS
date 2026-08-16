/**
 * Data Intelligence Routes
 *
 * New API endpoints powering the open-source data fusion layer:
 *
 *   GET  /api/data-intel/county-snapshot/:state/:county
 *        — Full county intelligence: USDA land values, Census demographics,
 *          migration signals, building permits, opportunity score
 *
 *   GET  /api/data-intel/land-value-trend/:state/:county
 *        — USDA NASS 5-year land value trend with CAGR calculation
 *
 *   POST /api/data-intel/blind-offer
 *        — Calculate a blind offer for a specific parcel
 *          Body: { state, county, targetAcres, comps?, sellerProfile? }
 *
 *   POST /api/data-intel/parcel-intelligence
 *        — Full parcel intelligence report (FEMA + NWI + EPA + soil + USDA + Census)
 *          Body: { lat, lng, acres, state, county, ... }
 *
 *   POST /api/data-intel/screen-counties
 *        — Batch screen multiple counties for campaign targeting
 *          Body: { counties: [{ state, county, metroMiles? }] }
 *
 *   GET  /api/data-intel/migration-hotspots
 *        — Known population in-migration hotspots by state
 *
 *   GET  /api/data-intel/county-momentum/:state/:county
 *        — Fused county momentum (IRS SOI migration + Census BPS permits +
 *          BLS QCEW employment) with full per-signal evidence breakdown
 *
 *   POST /api/data-intel/campaign-sizing
 *        — Calculate how many letters to mail for a target deal count
 *          Body: { county, state, targetDealsPerMonth }
 *
 *   GET  /api/data-intel/freedom-snapshot
 *        — Passive income vs. expenses snapshot for the Freedom Meter
 *          Query: ?expenses=4500
 *
 *   GET  /api/data-intel/state-land-rankings
 *        — Rank target states by land value appreciation (USDA data)
 *
 *   GET  /api/data-intel/corroboration/:lat/:lng
 *        — Cross-source corroboration for a point: independent federal
 *          instruments (FEMA NFHL, USFWS NWI, USDA SSURGO, MRLC NLCD)
 *          triangulated; agreement raises confidence, contradiction is
 *          surfaced as a finding. Query: ?lat=&lng=[&state=&county=]
 *
 *   GET  /api/data-intel/data-changes
 *        — Recent open-data change events (county-signal temporal swings
 *          emitted by the IRS SOI / Census BPS / BLS QCEW ETLs).
 *          Query: ?scopeType=county&scopeRef=TX/travis&sinceDays=90&limit=50
 */

import { Router, type Request, type Response } from "express";
import { db } from "./db";
import { properties } from "../shared/schema";
import { eq, and } from "drizzle-orm";
import { assertFeeSimpleOrThrow, handleLandStatusError } from "./utils/landStatus";
import { Errors } from "./utils/errors";
import type { AuthenticatedRequest } from "./types/request";

const router = Router();

function getUser(req: Request) { return req.user; }

// ---------------------------------------------------------------------------
// County Intelligence Snapshot
// ---------------------------------------------------------------------------

router.get("/county-snapshot/:state/:county", async (req: Request, res: Response) => {
  try {
    const { buildCountyAgSnapshot, getCachedLandTrend } = await import("./services/usdaNassService");
    const { buildCountyOpportunityProfile, getCountyFips } = await import("./services/censusDataService");
    const { computeCountyOpportunityScore, generateCountyIntelligenceReport } = await import("./services/countyOpportunityScore");
    const { getPermitTrend } = await import("./services/openData/countyMarketSignals");
    const { state, county } = req.params;

    // Ingested Census BPS annual data (county_building_permits) beats the
    // hardcoded placeholder — but only when both years actually exist.
    const fips = getCountyFips(state, county);
    const [nassSnapshot, trend, censusProfile, bpsPermitTrend] = await Promise.allSettled([
      buildCountyAgSnapshot(state, county),
      getCachedLandTrend(state, county),
      buildCountyOpportunityProfile(state, county),
      fips ? getPermitTrend(fips.stateFips, fips.countyFips) : Promise.resolve(null),
    ]);

    const nassData = nassSnapshot.status === "fulfilled" ? nassSnapshot.value : null;
    const trendData = trend.status === "fulfilled" ? trend.value : null;
    const censusData = censusProfile.status === "fulfilled" ? censusProfile.value : null;
    const permitTrend = bpsPermitTrend.status === "fulfilled" ? bpsPermitTrend.value : null;

    // County opportunity score
    const countyScore = computeCountyOpportunityScore({
      state: state.toUpperCase(),
      county,
      priceVelocity3Mo: trendData ? (trendData.oneYearChangePercent / 4) : 2,
      priceVelocity12Mo: trendData?.oneYearChangePercent || 3,
      avgPricePerAcre: nassData?.pasturePerAcre || 1000,
      pricePerAcreVs2YrAvg: trendData?.oneYearChangePercent || 0,
      salesVolume90Days: 5,
      salesVolume12Months: 20,
      avgDaysOnMarket: 90,
      domTrend: -10,
      activeListings: 15,
      monthsOfSupply: 6,
      listingCountTrend: -5,
      estimatedInvestorMailingCount: 10,
      recentPriceIncreasePercent: trendData?.oneYearChangePercent || 3,
      populationGrowthRate: censusData?.demographics?.populationChangePercent || 1,
      permitCountTrend: permitTrend?.trendPercent ?? (censusData?.permits ? 5 : 0),
      distanceToNearestMetroMiles: 80,
      hasRecentInfrastructureAnnouncement: false,
      hasRecentEmployerAnnouncement: false,
      hasLakeOrRiver: false,
      hasNationalForest: false,
      hasRecreationalAmenities: false,
    });

    res.json({
      state: state.toUpperCase(),
      county,
      usda: nassData,
      trend: trendData,
      census: censusData,
      countyOpportunityScore: countyScore,
      generatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// ---------------------------------------------------------------------------
// Land Value Trend
// ---------------------------------------------------------------------------

router.get("/land-value-trend/:state/:county", async (req: Request, res: Response) => {
  try {
    const { getCachedLandTrend } = await import("./services/usdaNassService");
    const { state, county } = req.params;
    const trend = await getCachedLandTrend(state, county);
    res.json(trend);
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// ---------------------------------------------------------------------------
// Auto-pull comps for the blind-offer wizard (Tom Hsiao / Lens 36)
//
// GET /api/data-intel/county-comps?state=TX&county=Brewster&acres=20
//
// Pulls recent land sales comps from ATTOM for the given county and ±50%
// acreage band. Returns a small set the wizard can preload at Step 2 so
// the investor isn't forced to keep PropStream open just to enter comps
// manually. Falls back gracefully when ATTOM is not configured — the
// wizard's "paste manually" path stays the working escape hatch.
// ---------------------------------------------------------------------------

router.get("/county-comps", async (req: Request, res: Response) => {
  try {
    const state = String(req.query.state || "").trim();
    const county = String(req.query.county || "").trim();
    const acres = parseFloat(String(req.query.acres || "0"));
    const monthsBack = Math.min(36, parseInt(String(req.query.monthsBack || "18"), 10) || 18);

    if (!state || !county) {
      return Errors.badRequest(res, "state and county are required");
    }

    const acreageMin = acres > 0 ? Math.max(0.25, acres * 0.5) : 0.25;
    const acreageMax = acres > 0 ? acres * 1.5 : 200;

    const { fetchAttomComparables } = await import("./jobs/countyAssessorIngest");
    const comps = await fetchAttomComparables(state, county, acreageMin, acreageMax, monthsBack);

    // Strip down to the wizard's Comp shape. Cap at 25 so the UI stays
    // browseable on mobile. Sort by price-per-acre asc so the "lowest
    // comp" anchor surfaces at the top — same convention the wizard uses.
    const trimmed = comps
      .filter(c => c.pricePerAcre > 0)
      .sort((a, b) => a.pricePerAcre - b.pricePerAcre)
      .slice(0, 25)
      .map(c => ({
        pricePerAcre: Math.round(c.pricePerAcre),
        acres: Number(c.acreage.toFixed(2)),
        totalPrice: Math.round(c.salePrice),
        source: "attom_recent_sales",
        notes: c.saleDate ? `Sold ${c.saleDate}${c.address ? ` — ${c.address}` : ""}` : (c.address || undefined),
      }));

    res.json({
      state: state.toUpperCase(),
      county,
      acreageBand: { min: acreageMin, max: acreageMax },
      monthsBack,
      compCount: trimmed.length,
      comps: trimmed,
      source: process.env.ATTOM_API_KEY ? "attom" : "unavailable",
      fallback: process.env.ATTOM_API_KEY ? null : "ATTOM_API_KEY not configured — paste comps manually",
      generatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// ---------------------------------------------------------------------------
// Blind Offer Calculator
// ---------------------------------------------------------------------------

router.post("/blind-offer", async (req: Request, res: Response) => {
  try {
    const { calculateBlindOffer } = await import("./services/blindOfferCalculator");
    const { state, county, targetAcres, comps, sellerProfile, marketCondition, ownerFinanceGoal, propertyId } = req.body;

    if (!state || !county || !targetAcres) {
      return Errors.badRequest(res, "state, county, and targetAcres are required");
    }

    // Aniyah §2 — block blind-offer generation on Indian-Country / federal
    // trust parcels. When the caller pins the offer to a specific propertyId
    // we look up its landStatus; if not 'fee' we throw LandStatusBlockError.
    // Callers without a propertyId are typically running campaign-level
    // exploration and aren't generating a binding letter — those still flow
    // through, but the per-property lookup runs at letter-generation time.
    if (propertyId) {
      const org = (req as AuthenticatedRequest).organization;
      const orgId = org?.id;
      if (orgId) {
        const [parcel] = await db
          .select({ landStatus: properties.landStatus })
          .from(properties)
          .where(and(eq(properties.id, Number(propertyId)), eq(properties.organizationId, orgId)));
        assertFeeSimpleOrThrow(parcel ?? null, "blind-offer");
      }
    }

    // Pull per-org owner-finance underwriting defaults so the calculator
    // builds the scenario against the org's actual book (Hank's Texas
    // standard: 9.9% / 120mo / 20% down / no balloon) instead of the
    // legacy 9%/84mo hardcode. Org settings live on
    // organizations.underwritingDefaults; falls back gracefully when
    // unset.
    const orgForUnderwriting = (req as AuthenticatedRequest).organization;
    const ownerFinanceDefaults =
      (orgForUnderwriting?.underwritingDefaults as any)?.ownerFinance ?? undefined;

    const report = await calculateBlindOffer({
      state,
      county,
      targetAcres: parseFloat(targetAcres),
      comps: comps || [],
      sellerProfile,
      marketCondition,
      ownerFinanceGoal: ownerFinanceGoal || false,
      ownerFinanceDefaults,
    });

    res.json(report);
  } catch (err: any) {
    if (handleLandStatusError(res, err)) return;
    Errors.internal(res, err);
  }
});

// ---------------------------------------------------------------------------
// Full Parcel Intelligence Report
// ---------------------------------------------------------------------------

router.post("/parcel-intelligence", async (req: Request, res: Response) => {
  try {
    const { generateLandIntelligenceReport } = await import("./services/parcelIntelligenceFusion");
    // Iyari #2: persist the report; serve fresh re-opens from store in <100ms
    // instead of a cold ~8-API recompute. Wraps the fusion COMPUTATION
    // (store-read/store-write) WITHOUT changing the fusion math.
    const {
      parcelKeyFor, readStoredReport, writeStoredReport, isReportFresh,
    } = await import("./services/data-cache/land-intelligence-store");
    const {
      latitude, longitude, acres, state, county, address, apn,
      askingPrice, assessedValue, ownerName, ownerState,
      taxDelinquent, taxDelinquentAmount, yearsOwned,
      forceRefresh,
    } = req.body;

    if (!latitude || !longitude || !state || !county) {
      return Errors.badRequest(res, "latitude, longitude, state, and county are required");
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    const parsedAcres = parseFloat(acres) || 1;
    const organizationId = (req as AuthenticatedRequest).organization?.id ?? null;

    const identity = {
      apn: apn ?? null,
      state,
      county,
      latitude: lat,
      longitude: lng,
      acres: parsedAcres,
    };
    const parcelKey = parcelKeyFor(identity);

    // 1) Store-read: serve a fresh stored report immediately (<100ms).
    if (!forceRefresh) {
      const stored = await readStoredReport(parcelKey, organizationId);
      if (stored && isReportFresh(stored)) {
        res.setHeader("X-LIS-Cache", "hit");
        return res.json(stored.report);
      }
    }

    // 2) Miss / stale / forced: recompute (unchanged fusion math).
    const report = await generateLandIntelligenceReport({
      latitude: lat,
      longitude: lng,
      acres: parsedAcres,
      state,
      county,
      address,
      apn,
      askingPrice: askingPrice ? parseFloat(askingPrice) : undefined,
      assessedValue: assessedValue ? parseFloat(assessedValue) : undefined,
      ownerName,
      ownerState,
      taxDelinquent: !!taxDelinquent,
      taxDelinquentAmount: taxDelinquentAmount ? parseFloat(taxDelinquentAmount) : undefined,
      yearsOwned: yearsOwned ? parseInt(yearsOwned) : undefined,
    });

    // 3) Store-write (best-effort, never blocks the response on failure).
    void writeStoredReport({ parcelKey, organizationId, identity, report });

    res.setHeader("X-LIS-Cache", "miss");
    res.json(report);
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// ---------------------------------------------------------------------------
// County Batch Screening
// ---------------------------------------------------------------------------

router.post("/screen-counties", async (req: Request, res: Response) => {
  try {
    const { screenCountiesForCampaign } = await import("./services/parcelIntelligenceFusion");
    const { counties } = req.body;

    if (!Array.isArray(counties) || counties.length === 0) {
      return Errors.badRequest(res, "counties array is required");
    }

    if (counties.length > 20) {
      return Errors.badRequest(res, "Maximum 20 counties per batch");
    }

    const results = await screenCountiesForCampaign(counties);
    res.json({ results, screened: results.length });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// ---------------------------------------------------------------------------
// Migration Hotspots
// ---------------------------------------------------------------------------

router.get("/migration-hotspots", async (req: Request, res: Response) => {
  try {
    const { getKnownMigrationHotspots } = await import("./services/censusDataService");
    const { state } = req.query;

    let hotspots = getKnownMigrationHotspots();
    if (state && typeof state === "string") {
      hotspots = hotspots.filter(h => h.state === state.toUpperCase());
    }

    res.json({ hotspots, total: hotspots.length });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// ---------------------------------------------------------------------------
// Campaign Sizing
// ---------------------------------------------------------------------------

router.post("/campaign-sizing", async (req: Request, res: Response) => {
  try {
    const { sizeCampaign } = await import("./services/blindOfferCalculator");
    const { county, state, targetDealsPerMonth, expectedAcceptanceRate, averageDealSize } = req.body;

    if (!county || !state || !targetDealsPerMonth) {
      return Errors.badRequest(res, "county, state, and targetDealsPerMonth are required");
    }

    const sizing = sizeCampaign({
      county,
      state,
      targetDealsPerMonth: parseInt(targetDealsPerMonth),
      expectedAcceptanceRate: expectedAcceptanceRate ? parseFloat(expectedAcceptanceRate) : undefined,
      averageDealSize: averageDealSize ? parseFloat(averageDealSize) : undefined,
    });

    res.json(sizing);
  } catch (err) {
    Errors.badRequest(res, err instanceof Error ? err.message : "Bad request");
  }
});

// ---------------------------------------------------------------------------
// Freedom Meter Snapshot
// ---------------------------------------------------------------------------
//
// Truth-immutable (Quinn): this endpoint fabricated note balances, remaining
// terms, next-payment dates, portfolio value, a "freedom score", and a 12-month
// synthetic history — none of it backed by a real notes/amortization system of
// record. It has no current client caller. Rather than fabricate a customer's
// financial picture, the handler is hard-gated to an honest "unavailable" state
// so it cannot be wired by accident. Restore real data here only once a notes
// ledger / amortization source exists.
// ---------------------------------------------------------------------------

router.get("/freedom-snapshot", async (_req: Request, res: Response) => {
  res.status(503).json({
    error: "SERVICE_UNAVAILABLE",
    message:
      "Freedom snapshot is not available — there is no notes/amortization system of record to source it from. This surface will not return fabricated note income, balances, or a freedom score.",
    statusCode: 503,
    status: "unavailable",
  });
});

// ---------------------------------------------------------------------------
// State Land Value Rankings
// ---------------------------------------------------------------------------

router.get("/state-land-rankings", async (req: Request, res: Response) => {
  try {
    const { rankStatesByLandAppreciation } = await import("./services/usdaNassService");
    const rankings = await rankStatesByLandAppreciation();
    res.json({ rankings, generatedAt: new Date().toISOString() });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// ---------------------------------------------------------------------------
// Census County Opportunity Profile
// ---------------------------------------------------------------------------

router.get("/census-profile/:state/:county", async (req: Request, res: Response) => {
  try {
    const { buildCountyOpportunityProfile } = await import("./services/censusDataService");
    const { state, county } = req.params;
    const metroMiles = req.query.metroMiles ? parseFloat(String(req.query.metroMiles)) : undefined;
    const profile = await buildCountyOpportunityProfile(state, county, metroMiles);
    res.json(profile);
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// ---------------------------------------------------------------------------
// Market Pulse Engine
// ---------------------------------------------------------------------------

/**
 * GET /api/data-intel/market-pulse
 * Generate a proactive market pulse report for one or more counties on the
 * org's watchlist.  Returns alerts, opportunity windows, and weekly wisdom.
 *
 * Query params:
 *   ?counties=Pinal%2CAZ|Flagler%2CFL   (pipe-separated "county,state" pairs)
 *   Omit counties to use the default top-target watchlist.
 */
router.get("/market-pulse", async (req: Request, res: Response) => {
  try {
    const { generateMarketPulseReport, DEFAULT_WATCHLIST_COUNTIES } = await import("./services/marketPulseEngine");
    const org = req.organization;

    let counties: { county: string; state: string }[] = DEFAULT_WATCHLIST_COUNTIES;

    if (req.query.counties) {
      const raw = String(req.query.counties).split("|");
      const parsed = raw
        .map((s) => {
          const [county, state] = s.split(",").map((x) => x.trim());
          return county && state ? { county, state } : null;
        })
        .filter(Boolean) as { county: string; state: string }[];
      if (parsed.length > 0) counties = parsed;
    }

    const report = await generateMarketPulseReport(org?.id ?? "demo", counties);
    res.json(report);
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

/**
 * GET /api/data-intel/market-pulse/:state/:county
 * Single-county pulse snapshot — alerts, opportunity window, pulse score.
 */
router.get("/market-pulse/:state/:county", async (req: Request, res: Response) => {
  try {
    const { generateCountyPulse, getWeeklyWisdom } = await import("./services/marketPulseEngine");
    const { state, county } = req.params;
    const [snapshot, wisdom] = await Promise.all([
      generateCountyPulse(county, state),
      Promise.resolve(getWeeklyWisdom()),
    ]);
    res.json({ ...snapshot, weeklyWisdom: wisdom });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// ---------------------------------------------------------------------------
// Lead Intelligence Engine
// ---------------------------------------------------------------------------

/**
 * GET /api/data-intel/lead-intelligence/batch
 * Score up to 200 leads for the authenticated org.
 * Returns prioritised leads with urgency scores and personalized message angles.
 *
 * Query params:
 *   ?limit=100   (default 100, max 200)
 */
router.get("/lead-intelligence/batch", async (req: Request, res: Response) => {
  try {
    const { batchScoreLeadsForOrg } = await import("./services/leadIntelligenceEngine");
    const org = req.organization;
    const limit = Math.min(100, parseInt(String(req.query.limit || "100"), 10));
    const result = await batchScoreLeadsForOrg(org?.id ?? "demo", limit);
    res.json(result);
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

/**
 * POST /api/data-intel/lead-intelligence/score
 * Score a single lead (or a manually constructed lead object) and return its
 * full intelligence profile with urgency, message angle, and recommended channel.
 *
 * Body: { lead: LeadRecord, nassData?: CountyAgSnapshot }
 */
router.post("/lead-intelligence/score", async (req: Request, res: Response) => {
  try {
    const { scoreLeadIntelligence } = await import("./services/leadIntelligenceEngine");
    const { lead, nassData } = req.body;
    if (!lead) return Errors.badRequest(res, "lead object is required");
    const profile = await scoreLeadIntelligence(lead, nassData);
    res.json(profile);
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

/**
 * GET /api/data-intel/lead-intelligence/focus
 * Returns this week's recommended focus action for the org's lead pipeline.
 */
router.get("/lead-intelligence/focus", async (req: Request, res: Response) => {
  try {
    // getWeeklyFocus is a private (non-exported) deterministic rotator in
    // leadIntelligenceEngine; replicated here to avoid importing a non-export.
    const focuses = [
      "Focus: Mail your tax delinquent list for the county where you sent offers 30 days ago. These sellers have had time to sit with your offer.",
      "Focus: Re-engage every lead that responded in the last 90 days but didn't close. Circumstances change — they may be ready now.",
      "Focus: Skip trace and add phone numbers to your top 20 priority leads. A call after 3 letters dramatically increases close rate.",
      "Focus: Review your note portfolio — any late payments? Address dunning before adding new deals.",
      "Focus: Run the Blind Offer Wizard for any county you haven't analyzed this month. Fresh comps = accurate offers.",
    ];
    const focus = focuses[Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000)) % focuses.length];
    res.json({ focus, generatedAt: new Date().toISOString() });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// ---------------------------------------------------------------------------
// EPIC E: Solar Potential Assessment
// POST /api/data-intel/solar-potential
// ---------------------------------------------------------------------------

router.post("/solar-potential", async (req: Request, res: Response) => {
  try {
    const { lat, lng, acres, state, zoning, floodZone } = req.body as {
      lat: number;
      lng: number;
      acres: number;
      state: string;
      zoning?: string;
      floodZone?: string;
    };

    if (!lat || !lng || !acres || !state) {
      return Errors.badRequest(res, "lat, lng, acres, and state are required");
    }

    const { calculateSolarPotential } = await import("./services/solarPotentialService");
    const result = await calculateSolarPotential({ lat, lng, acres, state, zoning, floodZone });

    res.json({
      ...result,
      generatedAt: new Date().toISOString(),
      input: { lat, lng, acres, state, zoning, floodZone },
    });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// ---------------------------------------------------------------------------
// EPIC B5: County Disaster History
// GET /api/data-intel/county-disaster-history/:state/:county
// ---------------------------------------------------------------------------

router.get("/county-disaster-history/:state/:county", async (req: Request, res: Response) => {
  try {
    const { state, county } = req.params;
    const { getCountyDisasterHistory } = await import("./services/censusDataService");
    const result = await getCountyDisasterHistory(state, county);
    if (!result) return Errors.notFound(res, "disaster data");
    res.json(result);
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// ---------------------------------------------------------------------------
// EPIC B6: County Migration Flows
// GET /api/data-intel/county-migration-flows/:stateFips/:countyFips
// ---------------------------------------------------------------------------

router.get("/county-migration-flows/:stateFips/:countyFips", async (req: Request, res: Response) => {
  try {
    const { stateFips, countyFips } = req.params;
    const { getCountyMigrationFlows } = await import("./services/censusDataService");
    const result = await getCountyMigrationFlows(stateFips, countyFips);
    if (!result) return Errors.notFound(res, "migration flow data");
    res.json(result);
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// ---------------------------------------------------------------------------
// Fused County Momentum (IRS SOI migration + Census BPS permits + BLS QCEW)
// GET /api/data-intel/county-momentum/:state/:county
//
// Accepts either FIPS codes ("48"/"043") or state abbreviation + county name
// ("TX"/"Brewster", resolved via the census FIPS map). The response is always
// the full evidence breakdown — per-signal source labels, data years, and raw
// numbers, plus which signals were missing and why. The composite direction
// vote is present only when >=2 of 3 signals are ingested; otherwise
// `composite` is null with `compositeUnavailableReason` — never a bare score.
// Auth: router is mounted with isAuthenticated + getOrCreateOrg (routes.ts),
// same as every other endpoint in this file.
// ---------------------------------------------------------------------------

router.get("/county-momentum/:state/:county", async (req: Request, res: Response) => {
  try {
    const { getCountyMomentum } = await import("./services/openData/countyMarketSignals");
    const { state, county } = req.params;

    let stateFips: string;
    let countyFips: string;
    if (/^\d{2}$/.test(state) && /^\d{3}$/.test(county)) {
      stateFips = state;
      countyFips = county;
    } else {
      const { getCountyFips } = await import("./services/censusDataService");
      const fips = getCountyFips(state, county);
      if (!fips) {
        return Errors.notFound(res, `FIPS mapping for ${county}, ${state}`);
      }
      stateFips = fips.stateFips;
      countyFips = fips.countyFips;
    }

    const momentum = await getCountyMomentum(stateFips, countyFips);
    res.json({ ...momentum, generatedAt: new Date().toISOString() });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// ---------------------------------------------------------------------------
// Corroboration Engine (ruling #9 wave 2 — founder-decisions-2026-07-28 §9)
// GET /api/data-intel/corroboration/:lat/:lng[?state=..&county=..]
// Path params (matching /county-momentum/:state/:county in this file) —
// coordinates are the resource being queried, not query modifiers.
//
// Cross-source triangulation of independent free federal instruments for a
// point: the wetness triangle (USFWS NWI wetlands vs USDA SSURGO hydric
// rating vs MRLC NLCD wetland land cover) and flood coherence (FEMA NFHL
// zone vs SSURGO flooding frequency). Agreement raises confidence
// mechanically; CONTRADICTION is surfaced as a finding — never smoothed
// over. Category results are fetched through the EXISTING broker seam
// (dataSourceBroker.lookupMultiple, maxTier "free" — same free-federal path
// as routes-public-parcel-check); the engine itself is pure. Missing or
// failed categories are reported as unchecked — never assumed.
// Auth: router is mounted with isAuthenticated + getOrCreateOrg (routes.ts),
// same as every other endpoint in this file.
// ---------------------------------------------------------------------------

router.get("/corroboration/:lat/:lng", async (req: Request, res: Response) => {
  try {
    const lat = parseFloat(String(req.params.lat));
    const lng = parseFloat(String(req.params.lng));
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      return Errors.badRequest(res, "lat and lng path segments must be valid WGS84 coordinates");
    }
    const state = req.query.state ? String(req.query.state).trim() : undefined;
    const county = req.query.county ? String(req.query.county).trim() : undefined;

    const { dataSourceBroker } = await import("./services/data-source-broker");
    const { corroborateParcel, CORROBORATION_CATEGORIES } = await import(
      "./services/openData/corroboration"
    );

    const multi = await dataSourceBroker.lookupMultiple(
      [...CORROBORATION_CATEGORIES],
      { latitude: lat, longitude: lng, state, county, maxTier: "free" }
    );

    const pick = (category: (typeof CORROBORATION_CATEGORIES)[number]) => {
      const r = multi.results[category];
      return r?.success && r.data ? r.data : undefined;
    };

    const report = corroborateParcel({
      floodZone: pick("flood_zone"),
      wetlands: pick("wetlands"),
      soil: pick("soil"),
      landCover: pick("land_cover"),
    });

    // Per-category lookup provenance so "unchecked" is explainable: which
    // upstream answered, from cache or live, and the honest failure trail
    // when a source produced nothing.
    const lookups = Object.fromEntries(
      CORROBORATION_CATEGORIES.map((category) => {
        const r = multi.results[category];
        return [
          category,
          {
            fetched: !!r?.success,
            source: r?.success ? r.source.title : null,
            fromCache: !!r?.fromCache,
            failureReasons: r && !r.success && r.fallbacksUsed.length > 0 ? r.fallbacksUsed : undefined,
          },
        ];
      })
    );

    res.json({
      latitude: lat,
      longitude: lng,
      ...report,
      lookups,
      lookupTimeMs: multi.totalLookupTimeMs,
    });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// ---------------------------------------------------------------------------
// Open-data change events (ruling #9 wave 3)
// GET /api/data-intel/data-changes
//   ?scopeType=county&scopeRef=TX/travis&sinceDays=90&limit=50
//
// Lists recent temporal change events emitted by the county reference ETLs
// (IRS SOI migration flips/swings, Census BPS permit doublings/halvings,
// BLS QCEW employment-trend threshold crossings) via the change-detection
// service. Filters are QUERY params — scopeRef contains a slash
// ("TX/travis"), so unlike /corroboration/:lat/:lng (where the coordinates
// ARE the resource) it cannot be a path segment; this endpoint is a filtered
// listing, matching the file's query-param convention for listings.
// An empty result is answered honestly: no events means no material swing
// was detected in the window — never padded with placeholder activity.
// Auth: router is mounted with isAuthenticated + getOrCreateOrg (routes.ts),
// same as every other endpoint in this file.
// ---------------------------------------------------------------------------

router.get("/data-changes", async (req: Request, res: Response) => {
  try {
    const rawScopeType = req.query.scopeType ? String(req.query.scopeType).trim() : undefined;
    if (rawScopeType !== undefined && rawScopeType !== "point" && rawScopeType !== "county") {
      return Errors.badRequest(res, 'scopeType must be "point" or "county"');
    }
    const scopeType = rawScopeType;
    const scopeRef = req.query.scopeRef ? String(req.query.scopeRef).trim() : undefined;

    const parseBoundedInt = (raw: unknown, fallback: number, min: number, max: number): number | null => {
      if (raw === undefined) return fallback;
      const n = parseInt(String(raw), 10);
      if (!Number.isFinite(n) || String(raw).trim() !== String(n)) return null;
      return Math.min(max, Math.max(min, n));
    };
    const sinceDays = parseBoundedInt(req.query.sinceDays, 90, 1, 365);
    const limit = parseBoundedInt(req.query.limit, 50, 1, 200);
    if (sinceDays === null || limit === null) {
      return Errors.badRequest(res, "sinceDays and limit must be integers");
    }

    const { listRecentChangeEvents } = await import("./services/openData/changeDetection");
    const events = await listRecentChangeEvents({ scopeType, scopeRef, sinceDays, limit });

    res.json({
      events,
      count: events.length,
      window: { sinceDays },
      filters: { scopeType: scopeType ?? null, scopeRef: scopeRef ?? null },
      // Honest empty state: change events only exist when a newly ingested
      // data year materially shifted a county signal. An empty list means no
      // such swing was detected in the window — not that data is broken.
      emptyReason:
        events.length === 0
          ? `No open-data change events recorded in the last ${sinceDays} days${scopeRef ? ` for ${scopeRef}` : ""}. Events are emitted only when a newly ingested data year materially shifts a county signal (migration flip/swing, permit doubling/halving, employment-trend threshold crossing).`
          : null,
      generatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// ---------------------------------------------------------------------------
// EPIC G: Data Source Health
// GET /api/data-intel/source-health
// ---------------------------------------------------------------------------

router.get("/source-health", async (req: Request, res: Response) => {
  try {
    const { getLatestHealth } = await import("./services/dataQualityMonitor");
    const health = getLatestHealth();
    res.json(health);
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// ---------------------------------------------------------------------------
// EPIC H: AcreOS Opportunity Scoring Engine
// POST /api/data-intel/opportunity-score   — Score a parcel from signals
// GET  /api/data-intel/signal-catalog      — Full signal catalog
// GET  /api/data-intel/data-freshness/:id  — Property data freshness report
// GET  /api/data-intel/county-score        — County opportunity score
// GET  /api/data-intel/freedom-number      — Freedom number analysis
// GET  /api/data-intel/prospect/:leadId    — Prospect intelligence profile
// GET  /api/data-intel/campaign-intel      — Campaign intelligence for a county
// ---------------------------------------------------------------------------

router.post("/opportunity-score", async (req: Request, res: Response) => {
  try {
    const { calculateOpportunityScore } = await import("./services/dataIntelligenceEngine");
    const score = calculateOpportunityScore(req.body || {});
    res.json(score);
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.get("/signal-catalog", async (_req: Request, res: Response) => {
  try {
    const { getDataSignalCatalog } = await import("./services/dataIntelligenceEngine");
    const catalog = getDataSignalCatalog();
    res.json({
      signals: catalog,
      totalSignals: catalog.length,
      layers: [...new Set(catalog.map((s: any) => s.layer))],
      freeSignals: catalog.filter((s: any) => s.tier === "free").length,
      paidSignals: catalog.filter((s: any) => s.tier === "paid").length,
      summary: "AcreOS fuses data across 5 layers: Parcel Identity, Ownership Signals, Physical Reality, Market Context, and Environmental Overlays.",
    });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.get("/data-freshness/:propertyId", async (req: Request, res: Response) => {
  try {
    const { storage } = await import("./storage");
    const org = req.organization;
    const propertyId = parseInt(req.params.propertyId);
    const property = await storage.getProperty(org.id, propertyId);
    if (!property) return Errors.notFound(res, "Property");
    const { assessDataFreshness } = await import("./services/dataIntelligenceEngine");
    const report = assessDataFreshness((property as any).enrichmentData, propertyId);
    res.json(report);
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.post("/county-score", async (req: Request, res: Response) => {
  try {
    const { scoreCounty } = await import("./services/dataIntelligenceEngine");
    const score = scoreCounty(req.body || {});
    res.json(score);
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.get("/freedom-number", async (req: Request, res: Response) => {
  try {
    const { calculateFreedomNumber } = await import("./services/prospectIntelligence");
    const { db } = await import("./db");
    const { payments, notes } = await import("@shared/schema");
    const { eq, and, gte, sum, count } = await import("drizzle-orm");

    const org = req.organization;

    // There is no organizations.settings.monthlyExpenses nor freedomNumber
    // column — the denominator has no system of record, so an absent query
    // param is an absent fact. Refuse-not-fabricate: 422, never a default.
    const rawMonthlyExpenses = req.query.monthlyExpenses;
    const monthlyExpenses =
      typeof rawMonthlyExpenses === "string" ? parseFloat(rawMonthlyExpenses) : NaN;
    if (!Number.isFinite(monthlyExpenses) || monthlyExpenses <= 0) {
      return Errors.validationFailed(res, [
        {
          path: ["monthlyExpenses"],
          message:
            "monthlyExpenses (a positive dollar amount) must be supplied — there is no stored expense figure to fall back on, and the freedom number cannot be computed without its denominator.",
        },
      ]);
    }

    // Trailing-12-month window: an all-time payment total divided by 12
    // misstates monthly income for any portfolio older or younger than a year.
    const windowStart = new Date();
    windowStart.setMonth(windowStart.getMonth() - 12);

    const [incomeResult] = await db
      .select({ total: sum(payments.amount) })
      .from(payments)
      .where(and(eq(payments.organizationId, org.id), gte(payments.paymentDate, windowStart)));

    const [notesResult] = await db
      .select({ noteCount: count() })
      .from(notes)
      .where(and(eq(notes.organizationId, org.id), eq(notes.status, "active")));

    const monthlyIncome = Number(incomeResult?.total ?? 0) / 12;
    const noteCount = Number(notesResult?.noteCount ?? 0);

    // avgNotePayment is derived only from real payments over real active
    // notes. Without both there is no honest basis for the per-note
    // projections: they come back as nulls with known:false, never $200.
    const avgNotePaymentKnown = noteCount > 0 && monthlyIncome > 0;
    const avgNotePayment = avgNotePaymentKnown ? monthlyIncome / noteCount : 0;

    const analysis = calculateFreedomNumber(monthlyExpenses, monthlyIncome, avgNotePayment, noteCount);

    if (!avgNotePaymentKnown) {
      return res.json({
        ...analysis,
        avgNotePayment: null,
        avgNotePaymentKnown: false,
        notesNeeded: null,
        dealsNeededToGenNotes: null,
        estimatedTimeToFreedom: null,
        weeklyMailersNeeded: null,
        freedomStatement: `Passive income covers ${analysis.freedomPercent}% of your $${monthlyExpenses.toLocaleString()}/mo target. Note-based projections are unavailable until at least one active note has payment history in the last 12 months.`,
      });
    }

    res.json({ ...analysis, avgNotePayment, avgNotePaymentKnown: true });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.get("/prospect/:leadId", async (req: Request, res: Response) => {
  try {
    const { calculateMotivationScore, getOutreachRecommendation, getEnrichmentPipeline } = await import("./services/prospectIntelligence");
    const { storage } = await import("./storage");
    const org = req.organization;
    const leadId = parseInt(req.params.leadId);
    const lead = await storage.getLead(org.id, leadId);
    if (!lead) return Errors.notFound(res, "Lead");

    const leadData = lead as any;
    const activeSignals: string[] = [];
    if (leadData.taxDelinquencyYears >= 5) activeSignals.push("TAX_DELINQUENT_5YR");
    else if (leadData.taxDelinquencyYears >= 3) activeSignals.push("TAX_DELINQUENT_3YR");
    else if (leadData.taxDelinquencyYears >= 2) activeSignals.push("TAX_DELINQUENT_2YR");
    if (leadData.isOutOfState) activeSignals.push("OUT_OF_STATE_OWNER");
    if (leadData.hasMortgage === false) activeSignals.push("NO_MORTGAGE");
    if (leadData.ownershipYears >= 10) activeSignals.push("LONG_TERM_OWNER");

    const { score, tier, topSignal } = calculateMotivationScore(activeSignals as any);
    const enrichmentPipeline = getEnrichmentPipeline(lead);
    const outreach = getOutreachRecommendation(
      leadData.touchCount || 0,
      tier,
      leadData.daysUntilTaxAuction,
      leadData.lastContactDaysAgo,
      leadData.lastResponseSignal
    );

    res.json({ leadId, motivationScore: score, motivationTier: tier, activeSignals, topSignal, enrichmentPipeline, outreachRecommendation: outreach });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.post("/campaign-intel", async (req: Request, res: Response) => {
  try {
    const { getCampaignIntelligence } = await import("./services/prospectIntelligence");
    const { countyMedianDom = 90, motivationTierDistribution = {}, historicalResponseRate } = req.body;
    const intel = getCampaignIntelligence(countyMedianDom, motivationTierDistribution, historicalResponseRate);
    res.json(intel);
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

export default router;

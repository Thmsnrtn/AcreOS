/**
 * Parcel Intelligence Fusion Engine
 *
 * The crown jewel of AcreOS data science — a master fusion layer that combines
 * ALL available open-source and premium data sources into a single, unified
 * "Land Intelligence Score" (LIS) for any parcel or county.
 *
 * Data Sources Fused:
 *   FREE (no API key):
 *     - FEMA NFHL: Flood zone designation
 *     - USFWS NWI: Wetlands coverage
 *     - EPA ECHO: Environmental hazard proximity
 *     - OpenStreetMap Overpass: Road access, amenities
 *     - USGS 3DEP: Elevation, slope, terrain
 *     - USDA Web Soil Survey: Soil type, farmland class
 *     - NLCD: Land cover classification (forest, developed, grassland, etc.)
 *
 *   FREE (API key required):
 *     - USDA NASS QuickStats: County land values, historical trends
 *     - Census ACS: Demographics, migration, income
 *     - Census Building Permits: Construction activity
 *     - EPA ATTAINS: Watershed/water quality
 *     - USFWS IPaC: Endangered species presence
 *
 *   PREMIUM (BYOK or subscription):
 *     - ATTOM Data: AVM, comp sales, tax records
 *     - PropStream: Distressed property data
 *     - Regrid: Parcel boundaries
 *
 * Output: A comprehensive LandIntelligenceReport with:
 *   - Deal killer flags (flood, wetlands, landlocked, contamination)
 *   - Opportunity signals (soil quality, road access, county growth)
 *   - Pricing intelligence (AcreOS offer formula + USDA data-backed)
 *   - Owner finance viability score
 *   - Comparable market analysis
 *   - Recommended next actions
 *
 * Philosophy: Inspired by the industry-standard due diligence methodology,
 * this engine automates the 100-step checklist's Phase 1 and Phase 2 checks in under
 * 60 seconds. What once took days of manual research now takes one API call.
 */

import { runAutoDueDiligence } from "./dueDiligenceEngine";
import { recordParcelObservations } from "./data-cache/observation-log";
import { buildCountyAgSnapshot, getCachedLandTrend } from "./usdaNassService";
import { buildCountyOpportunityProfile, getKnownMigrationHotspots } from "./censusDataService";
// NOTE: computeCountyOpportunityScore is intentionally NOT imported/used here.
// It requires a live market feed; feeding it placeholder constants produced a
// fabricated score (Quinn data-honesty lens, item 4). Re-introduce it only
// when a real comps/market source is wired (Phase 2).

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParcelIntelligenceInput {
  latitude: number;
  longitude: number;
  acres: number;
  state: string;
  county: string;
  address?: string;
  apn?: string;
  askingPrice?: number; // Current listing price if available
  assessedValue?: number; // County assessed value
  ownerName?: string;
  ownerState?: string; // Owner's mailing state (out-of-state = positive signal)
  taxDelinquent?: boolean;
  taxDelinquentAmount?: number;
  yearsOwned?: number;
}

export interface DealKillerFlag {
  type: "landlocked" | "flood_zone_ae" | "wetlands_dominant" | "superfund_nearby" |
        "endangered_species" | "conservation_easement" | "military_airspace" |
        "no_road_access" | "extreme_slope";
  severity: "dealbreaker" | "major_risk" | "moderate_risk";
  description: string;
  action: string; // What to do about it
}

export interface OpportunitySignal {
  type: "tax_delinquent" | "out_of_state_owner" | "long_tenure" | "below_market_price" |
        "growing_county" | "migration_hotspot" | "good_soil" | "road_access" | "utilities" |
        "recreation_adjacent" | "metro_proximity" | "appreciating_market";
  strength: "strong" | "moderate" | "weak";
  description: string;
}

export interface BlindOfferAnalysis {
  // The core offer formula: lowest comp ÷ 4
  lowestComparableSale: number | null; // $/acre from county data
  usdaLandValuePerAcre: number; // USDA NASS baseline
  recommendedOfferPerAcre: number; // Minimum of (lowest comp ÷ 4, USDA ÷ 4)
  recommendedOfferTotal: number; // × acres
  targetFlipPriceTotal: number; // 2-4× offer (for cash sale)
  targetFlipROI: number; // %
  // Owner finance structure (optimal terms)
  ownerFinance: {
    downPayment: number; // = acquisition cost (recoups capital day 1)
    loanAmount: number; // listing price - down payment
    interestRate: number; // 9% standard
    termMonths: number; // 84 months (7 years)
    monthlyPayment: number;
    totalCollected: number; // Down + all payments
    totalROI: number; // %
    passiveIncomeMonths: number; // Months of passive income
  };
  confidenceLevel: "high" | "medium" | "low"; // Based on data availability
  pricingNotes: string[];
}

/**
 * Per-field provenance (Quinn item 5): the authoritative source + fetch time
 * for each due-diligence datum, so the customer-facing card can render a
 * "FEMA NFHL · fetched 2026-06-06" chip per field rather than one blanket
 * "sources queried" footnote. classification is "authoritative" for the
 * federal systems-of-record we query directly.
 */
export interface FieldProvenance {
  source: string;
  fetchedAt: string; // ISO; this is WHEN WE pulled it (no per-fact asOf upstream)
  classification: "authoritative" | "estimate" | "modeled" | "unknown";
}

export interface LandIntelligenceReport {
  // Metadata
  generatedAt: string;
  dataSourcesQueried: string[];
  processingTimeMs: number;
  /**
   * Per-field provenance for the dueDiligence block (flood/wetlands/
   * environmental/roadAccess/soil/elevation). Absent fields = not pulled.
   */
  fieldProvenance: Partial<Record<
    "floodZone" | "wetlands" | "environmental" | "roadAccess" | "soil" | "elevation",
    FieldProvenance
  >>;

  // The most critical output
  recommendation: "buy_aggressively" | "buy_selectively" | "conduct_due_diligence" |
                   "pass" | "dealbreaker";
  confidenceScore: number; // 0-100
  landIntelligenceScore: number; // 0-100 composite

  // Deal killers — if any are present, reconsider the deal
  dealKillers: DealKillerFlag[];
  hasDealKiller: boolean;

  // Positive signals — reasons to pursue
  opportunitySignals: OpportunitySignal[];
  opportunityStrength: "very_strong" | "strong" | "moderate" | "weak";

  // Pricing intelligence
  offerAnalysis: BlindOfferAnalysis;

  // Due diligence checks
  dueDiligence: {
    floodZone: { risk: string; zone: string | null; description: string };
    wetlands: { hasWetlands: boolean; acres: number; percent: number; risk: string };
    environmental: { superfundCount: number; nearestMiles: number | null; risk: string };
    roadAccess: { hasAccess: boolean; roadType: string | null; risk: string };
    soil: { classification: string | null; farmlandClass: string | null; risk: string };
    elevation: { feet: number | null; slope: string | null; risk: string };
  } | null;

  // County intelligence
  countyIntel: {
    /**
     * County opportunity score (0–100), or null when we lack live market
     * inputs to compute it honestly. Quinn data-honesty lens: a score built
     * from hardcoded placeholder market data is "a constant wearing a lab
     * coat" — when the market inputs are placeholders we return null + an
     * honest note rather than ship a fabricated number.
     */
    opportunityScore: number | null;
    /** Honest provenance note for the opportunity score. */
    opportunityScoreNote: string;
    trend: string;
    usdaLandValue: number;
    landValueCagr5Year: number;
    populationGrowthSignal: string;
    isMigrationHotspot: boolean;
    nearestMetroMiles: number | null;
  };

  // Seller motivation
  sellerMotivation: {
    score: number;
    grade: string;
    topSignals: string[];
    outreachPriority: string;
  } | null;

  // Recommended actions
  nextSteps: string[];
  warningFlags: string[];
}

// ---------------------------------------------------------------------------
// Main Fusion Function
// ---------------------------------------------------------------------------

export async function generateLandIntelligenceReport(
  input: ParcelIntelligenceInput
): Promise<LandIntelligenceReport> {
  const startTime = Date.now();
  const dataSourcesQueried: string[] = [];

  // Run all checks in parallel for maximum speed.
  //
  // Quinn data-honesty lens (item 4): we deliberately DO NOT call
  // computeCountyOpportunityScore here. That model requires live market data
  // (price velocity, sales volume, DOM, active listings, investor competition)
  // which this free-data path does not have — feeding it hardcoded placeholder
  // constants produced a fixed number dressed up as a "proprietary model"
  // output. Until we have a live comps/market feed (Phase 2, when paid data
  // justifies it), countyIntel.opportunityScore is null with an honest note,
  // and the composite score draws only on the data we actually queried (USDA
  // baselines + Census demographics + environmental due-diligence).
  const [ddReport, countySnapshot, countyTrend, censusProfile] =
    await Promise.allSettled([
      // Due diligence checks (FEMA, NWI, EPA, OSM, USDA soil, USGS)
      runAutoDueDiligence(0, 0, input.latitude, input.longitude, input.acres, input.state).then(r => {
        dataSourcesQueried.push("FEMA NFHL", "USFWS NWI", "EPA ECHO", "OpenStreetMap", "USDA WSS", "USGS 3DEP");
        return r;
      }),
      // USDA NASS land value data
      buildCountyAgSnapshot(input.state, input.county).then(r => {
        dataSourcesQueried.push("USDA NASS QuickStats");
        return r;
      }),
      // Land value trend
      getCachedLandTrend(input.state, input.county).then(r => {
        return r;
      }),
      // Census demographic profile
      buildCountyOpportunityProfile(input.state, input.county).then(r => {
        dataSourcesQueried.push("US Census ACS", "Census Building Permits");
        return r;
      }),
    ]);

  // Unpack results
  const dd = ddReport.status === "fulfilled" ? ddReport.value : null;
  const nassData = countySnapshot.status === "fulfilled" ? countySnapshot.value : null;
  const trend = countyTrend.status === "fulfilled" ? countyTrend.value : null;
  const census = censusProfile.status === "fulfilled" ? censusProfile.value : null;
  // No live market feed in the free-data path → no honest county opportunity
  // score (Quinn item 4). Downstream consumers guard on `if (countyScore)`.
  const countyScore = null;

  // Identify deal killers
  const dealKillers = identifyDealKillers(dd, input);

  // Identify opportunity signals
  const opportunitySignals = identifyOpportunitySignals(input, nassData, trend, census, countyScore);

  // Build offer analysis
  const offerAnalysis = buildOfferAnalysis(input, nassData, trend);

  // Compute composite Land Intelligence Score
  const lis = computeLandIntelligenceScore(
    dealKillers,
    opportunitySignals,
    offerAnalysis,
    dd,
    countyScore,
    census
  );

  // Build county intelligence summary
  const migrationHotspots = getKnownMigrationHotspots();
  const isMigrationHotspot = migrationHotspots.some(
    h => h.state === input.state.toUpperCase() &&
         h.county.toLowerCase() === input.county.toLowerCase()
  );

  const countyIntel = {
    // Honest: no live market data → no opportunity score, with a note that
    // says what we DO have. Never a fabricated 50 (Quinn item 4).
    opportunityScore: null,
    opportunityScoreNote:
      "County opportunity score needs live market data (sales velocity, days-on-market, active listings) we don't pull on the free tier yet — this assessment is based on USDA land-value baselines and Census demographics only.",
    trend: trend?.trend || "unknown",
    usdaLandValue: nassData?.pasturePerAcre || 0,
    landValueCagr5Year: trend?.cagr5Year || 0,
    populationGrowthSignal: census?.migration?.landDemandSignal || "unknown",
    isMigrationHotspot,
    nearestMetroMiles: null, // Would come from geocoding
  };

  // Seller motivation
  const sellerMotivation = input.taxDelinquent || input.ownerState
    ? computeQuickMotivationScore(input)
    : null;

  // Determine recommendation
  const recommendation = determineRecommendation(dealKillers, lis, offerAnalysis);

  // Build next steps
  const nextSteps = buildNextSteps(recommendation, dealKillers, opportunitySignals, input);
  const warningFlags = buildWarningFlags(dd, input, nassData);

  // Tier 2A (elevation blueprint 2026-06-10): the fusion path sees
  // authoritative federal facts about this parcel — record them into the
  // observation log so they join the longitudinal series. Fire-and-forget;
  // only when the parcel has a real identity and the DD pass actually ran.
  // Absent facts stay absent (recordParcelObservations skips null/undefined).
  if (input.apn && input.state && input.county && dd) {
    void recordParcelObservations({
      apn: input.apn,
      state: input.state.toUpperCase(),
      county: input.county,
      source: "fusion_due_diligence",
      facts: {
        flood_zone: dd.checks.floodZone.zone ?? undefined,
        wetlands_percent: dd.checks.wetlands.wetlandPercent ?? undefined,
        road_access: dd.checks.roadAccess.roadType ?? (dd.checks.roadAccess.hasDirectRoadAccess ? "yes" : "none"),
        soil_class: dd.checks.soil.dominantSoilName ?? undefined,
        elevation_feet: dd.checks.elevation.elevationFeet ?? undefined,
      },
    });
  }

  // Per-field provenance (Quinn item 5). Only stamped when the DD pass actually
  // ran — an absent field means "not pulled", never a fabricated default.
  const nowIso = new Date().toISOString();
  const fieldProvenance: LandIntelligenceReport["fieldProvenance"] = dd
    ? {
        floodZone: { source: "FEMA NFHL", fetchedAt: nowIso, classification: "authoritative" },
        wetlands: { source: "USFWS NWI", fetchedAt: nowIso, classification: "authoritative" },
        environmental: { source: "EPA ECHO", fetchedAt: nowIso, classification: "authoritative" },
        roadAccess: { source: "OpenStreetMap", fetchedAt: nowIso, classification: "authoritative" },
        soil: { source: "USDA WSS", fetchedAt: nowIso, classification: "authoritative" },
        elevation: { source: "USGS 3DEP", fetchedAt: nowIso, classification: "authoritative" },
      }
    : {};

  return {
    generatedAt: new Date().toISOString(),
    dataSourcesQueried: [...new Set(dataSourcesQueried)],
    processingTimeMs: Date.now() - startTime,
    fieldProvenance,
    recommendation,
    confidenceScore: Math.round(lis * 0.8 + (dd ? 20 : 0)),
    landIntelligenceScore: lis,
    dealKillers,
    hasDealKiller: dealKillers.some(d => d.severity === "dealbreaker"),
    opportunitySignals,
    opportunityStrength: getOpportunityStrength(opportunitySignals),
    offerAnalysis,
    dueDiligence: dd ? {
      floodZone: {
        risk: dd.checks.floodZone.risk,
        zone: dd.checks.floodZone.zone,
        description: dd.checks.floodZone.zoneDescription || "",
      },
      wetlands: {
        hasWetlands: dd.checks.wetlands.hasWetlands,
        acres: dd.checks.wetlands.wetlandAcres,
        percent: dd.checks.wetlands.wetlandPercent,
        risk: dd.checks.wetlands.risk,
      },
      environmental: {
        superfundCount: dd.checks.environmental.superfundSitesWithin1Mile,
        nearestMiles: dd.checks.environmental.nearestHazardDistanceMiles,
        risk: dd.checks.environmental.risk,
      },
      roadAccess: {
        hasAccess: dd.checks.roadAccess.hasDirectRoadAccess,
        roadType: dd.checks.roadAccess.roadType,
        risk: dd.checks.roadAccess.risk,
      },
      soil: {
        classification: dd.checks.soil.dominantSoilName,
        farmlandClass: dd.checks.soil.farmlandClassification,
        risk: dd.checks.soil.risk,
      },
      elevation: {
        feet: dd.checks.elevation.elevationFeet,
        slope: dd.checks.elevation.slope,
        risk: dd.checks.elevation.risk,
      },
    } : null,
    countyIntel,
    sellerMotivation,
    nextSteps,
    warningFlags,
  };
}

// ---------------------------------------------------------------------------
// Deal Killer Detection
// ---------------------------------------------------------------------------

function identifyDealKillers(
  dd: any,
  input: ParcelIntelligenceInput
): DealKillerFlag[] {
  const flags: DealKillerFlag[] = [];

  if (!dd) return flags;

  // Landlocked / No road access — absolute dealbreaker
  if (dd.checks.roadAccess.risk === "critical" || !dd.checks.roadAccess.hasDirectRoadAccess) {
    flags.push({
      type: "landlocked",
      severity: "dealbreaker",
      description: "Property appears to have no direct road access. Landlocked parcels are nearly impossible to sell and require expensive legal easement acquisition.",
      action: "Verify access with county GIS. If truly landlocked, pass on this deal — the legal and cost burden to establish access exceeds typical investor margins.",
    });
  }

  // Flood Zone AE — high-risk flood zone
  if (dd.checks.floodZone.zone === "AE" || dd.checks.floodZone.zone === "VE") {
    flags.push({
      type: "flood_zone_ae",
      severity: "dealbreaker",
      description: `FEMA Special Flood Hazard Area (Zone ${dd.checks.floodZone.zone}). Mandatory flood insurance required for any structure, often $1,500-$4,000/year.`,
      action: "Obtain FEMA LOMA (Letter of Map Amendment) to verify if structures could be built. Most investors pass on Zone AE parcels due to restricted development potential.",
    });
  }

  // Dominant wetlands
  if (dd.checks.wetlands.wetlandPercent > 50) {
    flags.push({
      type: "wetlands_dominant",
      severity: dd.checks.wetlands.wetlandPercent > 75 ? "dealbreaker" : "major_risk",
      description: `${Math.round(dd.checks.wetlands.wetlandPercent)}% of parcel is classified as wetlands. Army Corps of Engineers jurisdiction severely restricts development.`,
      action: "Order a wetland delineation report before proceeding. If >75% wetlands, pass — the development restrictions eliminate most buyer use cases.",
    });
  }

  // Superfund within 1 mile
  if (dd.checks.environmental.superfundSitesWithin1Mile > 0) {
    flags.push({
      type: "superfund_nearby",
      severity: "major_risk",
      description: `${dd.checks.environmental.superfundSitesWithin1Mile} EPA Superfund site(s) within 1 mile. Potential contamination plume risk and significant buyer resistance.`,
      action: "Check EPA ATTAINS for contamination plume data. Order Phase 1 Environmental Site Assessment before closing.",
    });
  }

  // Extreme slope
  if (dd.checks.elevation.slope === "steep") {
    flags.push({
      type: "extreme_slope",
      severity: "moderate_risk",
      description: "Steep terrain (>15% grade) significantly limits development options and adds cost. Septic systems often require engineered alternatives.",
      action: "Factor 20-30% price reduction vs. flat comparables. Market to recreational/view buyers rather than development-focused buyers.",
    });
  }

  return flags;
}

// ---------------------------------------------------------------------------
// Opportunity Signal Detection
// ---------------------------------------------------------------------------

function identifyOpportunitySignals(
  input: ParcelIntelligenceInput,
  nassData: any,
  trend: any,
  census: any,
  countyScore: any
): OpportunitySignal[] {
  const signals: OpportunitySignal[] = [];

  // Tax delinquency — #1 motivation signal in land investing
  if (input.taxDelinquent) {
    signals.push({
      type: "tax_delinquent",
      strength: input.taxDelinquentAmount && input.taxDelinquentAmount > 2000 ? "strong" : "moderate",
      description: `Owner is delinquent on property taxes${input.taxDelinquentAmount ? ` ($${input.taxDelinquentAmount.toLocaleString()} owed)` : ""}. Tax liens create urgency to sell — this is the strongest motivation signal in land investing.`,
    });
  }

  // Out-of-state owner — #2 motivation signal
  if (input.ownerState && input.ownerState.toUpperCase() !== input.state.toUpperCase()) {
    signals.push({
      type: "out_of_state_owner",
      strength: "strong",
      description: `Owner lives in ${input.ownerState} — property is ${input.state}. Out-of-state owners have lower emotional attachment, can't easily visit, and often accumulated the property speculatively or through inheritance.`,
    });
  }

  // Long tenure
  if (input.yearsOwned && input.yearsOwned >= 10) {
    signals.push({
      type: "long_tenure",
      strength: input.yearsOwned >= 20 ? "strong" : "moderate",
      description: `Owner has held this property for ${input.yearsOwned} years without selling. Long-tenure owners often no longer remember why they bought, have forgotten the property exists, or are waiting for someone to make an offer.`,
    });
  }

  // Below-market asking price
  if (input.askingPrice && nassData?.pasturePerAcre) {
    const askingPerAcre = input.askingPrice / input.acres;
    const marketPerAcre = nassData.pasturePerAcre;
    const discount = ((marketPerAcre - askingPerAcre) / marketPerAcre) * 100;
    if (discount > 30) {
      signals.push({
        type: "below_market_price",
        strength: discount > 50 ? "strong" : "moderate",
        description: `Asking price (${Math.round(askingPerAcre)}/acre) is ${Math.round(discount)}% below USDA land value benchmark ($${Math.round(marketPerAcre)}/acre). Motivated seller or inherited/unwanted property.`,
      });
    }
  }

  // Growing county
  if (countyScore && countyScore.totalScore > 65) {
    signals.push({
      type: "growing_county",
      strength: countyScore.totalScore > 80 ? "strong" : "moderate",
      description: `County opportunity score: ${countyScore.totalScore}/100. Strong buyer demand, growing market, favorable conditions for land investing.`,
    });
  }

  // Migration hotspot
  const hotspots = getKnownMigrationHotspots();
  const isHotspot = hotspots.find(
    h => h.state === input.state.toUpperCase() &&
         h.county.toLowerCase() === input.county.toLowerCase()
  );
  if (isHotspot) {
    signals.push({
      type: "migration_hotspot",
      strength: isHotspot.migrationScore > 80 ? "strong" : "moderate",
      description: `${input.county} County is a documented population in-migration destination from ${isHotspot.primaryMetroFeeder}. ${isHotspot.notes}`,
    });
  }

  // Appreciating market
  if (trend && trend.cagr5Year > 5) {
    signals.push({
      type: "appreciating_market",
      strength: trend.cagr5Year > 8 ? "strong" : "moderate",
      description: `USDA land values in this area have appreciated ${trend.cagr5Year.toFixed(1)}% annually over 5 years. Strong appreciation supports higher resale prices and reduces holding risk.`,
    });
  }

  return signals;
}

// ---------------------------------------------------------------------------
// Blind Offer Analysis
// ---------------------------------------------------------------------------

function buildOfferAnalysis(
  input: ParcelIntelligenceInput,
  nassData: any,
  trend: any
): BlindOfferAnalysis {
  const usdaPerAcre = nassData?.pasturePerAcre || (nassData?.farmRealEstatePerAcre * 0.6) || 1000;

  // Offer formula: lowest comp ÷ 4
  // Use USDA NASS pastureland value as the "lowest comp" baseline
  const lowestCompPerAcre = usdaPerAcre;
  const offerPerAcre = lowestCompPerAcre * 0.25; // 25 cents on the dollar
  const offerTotal = offerPerAcre * input.acres;

  // Cash flip at 2× (conservative) to 4× (hot market)
  const flipMultiple = nassData?.interpretations?.impliedFlipPrice
    ? nassData.interpretations.impliedFlipPrice / nassData.interpretations.rawLandProxyValue
    : 2;
  // Flip price = offer × multiple (typically 2-4x). Previous bug: was offerTotal * flipMultiple * 4 = 8x
  const effectiveMultiple = Math.min(flipMultiple > 0 ? flipMultiple : 2, 6);
  const flipPriceTotal = offerTotal * effectiveMultiple;
  const flipROI = offerTotal > 0 ? ((flipPriceTotal - offerTotal) / offerTotal) * 100 : 300;

  // Owner finance structure
  const downPayment = offerTotal; // Down payment = acquisition cost (capital recovery day 1)
  const loanAmount = flipPriceTotal - downPayment;
  const monthlyRate = 0.09 / 12;
  const n = 84;
  const monthlyPayment = loanAmount > 0
    ? loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, n)) / (Math.pow(1 + monthlyRate, n) - 1)
    : 0;
  const totalCollected = downPayment + (monthlyPayment * n);
  const ownerFinanceROI = offerTotal > 0 ? ((totalCollected - offerTotal) / offerTotal) * 100 : 800;

  // Confidence
  const confidence = nassData && trend
    ? nassData.farmRealEstatePerAcre > 0 ? "high" : "medium"
    : "low";

  const notes: string[] = [];
  if (!nassData || nassData.farmRealEstatePerAcre === 0) {
    notes.push("No USDA NASS data available — using regional estimates. Validate with local MLS/LandWatch comps.");
  }
  if (trend && trend.trend === "accelerating") {
    notes.push(`Market is accelerating (${trend.oneYearChangePercent}% YoY growth). Consider offering up to 30 cents on the dollar to compete in this hot market.`);
  }
  if (input.acres < 1) {
    notes.push("Sub-acre parcel — standard land model may not apply. Verify use case and comp pool before offering.");
  }
  notes.push("Always pull 5-10 direct comparables from LandWatch, Land and Farm, and county records before finalizing offer.");
  notes.push("eBay sold listings in this county validate the model — look for 10+ bidders on similar parcels.");

  return {
    lowestComparableSale: lowestCompPerAcre,
    usdaLandValuePerAcre: usdaPerAcre,
    recommendedOfferPerAcre: Math.round(offerPerAcre),
    recommendedOfferTotal: Math.round(offerTotal),
    targetFlipPriceTotal: Math.round(flipPriceTotal),
    targetFlipROI: Math.round(flipROI),
    ownerFinance: {
      downPayment: Math.round(downPayment),
      loanAmount: Math.round(loanAmount),
      interestRate: 9,
      termMonths: 84,
      monthlyPayment: Math.round(monthlyPayment),
      totalCollected: Math.round(totalCollected),
      totalROI: Math.round(ownerFinanceROI),
      passiveIncomeMonths: 84,
    },
    confidenceLevel: confidence,
    pricingNotes: notes,
  };
}

// ---------------------------------------------------------------------------
// Composite Scoring
// ---------------------------------------------------------------------------

function computeLandIntelligenceScore(
  dealKillers: DealKillerFlag[],
  signals: OpportunitySignal[],
  offer: BlindOfferAnalysis,
  dd: any,
  countyScore: any,
  census: any
): number {
  // Start at 50
  let score = 50;

  // Deal killers tank the score
  for (const killer of dealKillers) {
    if (killer.severity === "dealbreaker") score -= 40;
    else if (killer.severity === "major_risk") score -= 20;
    else score -= 10;
  }

  // Opportunity signals boost the score
  for (const signal of signals) {
    if (signal.strength === "strong") score += 10;
    else if (signal.strength === "moderate") score += 6;
    else score += 3;
  }

  // County score contribution
  if (countyScore) {
    score += (countyScore.totalScore - 50) * 0.2;
  }

  // Due diligence bonus (low risk = bonus)
  if (dd) {
    if (dd.overallRisk === "low") score += 10;
    else if (dd.overallRisk === "medium") score += 0;
    else if (dd.overallRisk === "high") score -= 10;
    else if (dd.overallRisk === "critical") score -= 25;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getOpportunityStrength(
  signals: OpportunitySignal[]
): "very_strong" | "strong" | "moderate" | "weak" {
  const strongCount = signals.filter(s => s.strength === "strong").length;
  const totalCount = signals.length;
  if (strongCount >= 3) return "very_strong";
  if (strongCount >= 2 || totalCount >= 4) return "strong";
  if (totalCount >= 2) return "moderate";
  return "weak";
}

function determineRecommendation(
  dealKillers: DealKillerFlag[],
  lis: number,
  offer: BlindOfferAnalysis
): LandIntelligenceReport["recommendation"] {
  if (dealKillers.some(d => d.severity === "dealbreaker")) return "dealbreaker";
  if (dealKillers.some(d => d.severity === "major_risk")) return "pass";
  if (lis >= 75) return "buy_aggressively";
  if (lis >= 55) return "buy_selectively";
  if (lis >= 35) return "conduct_due_diligence";
  return "pass";
}

function buildNextSteps(
  recommendation: LandIntelligenceReport["recommendation"],
  dealKillers: DealKillerFlag[],
  signals: OpportunitySignal[],
  input: ParcelIntelligenceInput
): string[] {
  const steps: string[] = [];

  if (recommendation === "dealbreaker") {
    steps.push("STOP: One or more deal-killer flags identified. Review the flags carefully before proceeding.");
    for (const killer of dealKillers.filter(k => k.severity === "dealbreaker")) {
      steps.push(`Deal Killer: ${killer.description}`);
      steps.push(`Action: ${killer.action}`);
    }
    return steps;
  }

  if (recommendation === "buy_aggressively" || recommendation === "buy_selectively") {
    steps.push("Pull 5-10 comparable sales from LandWatch, Land and Farm, and county assessor records to refine offer price.");
    steps.push("Check eBay sold listings for this county — look for 10+ bidders as validation the model works here.");
    steps.push(`Send a blind offer letter at $${Math.round(input.acres * 250).toLocaleString()} or your calculated offer amount.`);

    if (signals.some(s => s.type === "tax_delinquent")) {
      steps.push("Tax delinquency detected — contact before the tax sale deadline. Time-sensitive opportunity.");
    }
    if (signals.some(s => s.type === "out_of_state_owner")) {
      steps.push("Out-of-state owner — personalize the letter to acknowledge the distance and offer a hassle-free closing.");
    }
    steps.push("Prepare parallel buyer marketing: post to Craigslist and Facebook Marketplace the same week you send the offer.");
  }

  if (recommendation === "conduct_due_diligence") {
    steps.push("Run Phase 2 due diligence: order a preliminary title report and verify road access with county records.");
    steps.push("Call the county planning office to confirm zoning allows your intended use case.");
    steps.push("Run comparable sales analysis before sending an offer.");
  }

  if (recommendation === "pass") {
    steps.push("Risk factors outweigh opportunity signals for this specific parcel.");
    steps.push("Consider other parcels in this county or adjacent counties with better profiles.");
  }

  return steps;
}

function buildWarningFlags(dd: any, input: ParcelIntelligenceInput, nassData: any): string[] {
  const warnings: string[] = [];

  if (!nassData || nassData.farmRealEstatePerAcre === 0) {
    warnings.push("USDA land value data unavailable for this county — manual comp research required before pricing offer.");
  }

  if (input.acres < 0.5) {
    warnings.push("Sub-half-acre parcel — sub-acre lots require different marketing than typical raw land. Verify market for small lots in this county.");
  }

  if (input.acres > 500) {
    warnings.push("Large acreage parcel — consider whether to sell whole or subdivide. Subdivision adds value but requires survey and possibly subdivision platting approvals.");
  }

  if (dd?.checks.soil.farmlandClassification === "Prime Farmland") {
    warnings.push("Prime farmland classification — agricultural buyers may pay premium. Consider marketing to farmers in addition to real estate investors.");
  }

  return warnings;
}

function computeQuickMotivationScore(input: ParcelIntelligenceInput): {
  score: number;
  grade: string;
  topSignals: string[];
  outreachPriority: string;
} {
  let score = 0;
  const signals: string[] = [];

  if (input.taxDelinquent) {
    score += 35;
    signals.push("Tax delinquency");
    if (input.taxDelinquentAmount && input.taxDelinquentAmount > 5000) {
      score += 10;
      signals.push(`High delinquent amount ($${input.taxDelinquentAmount.toLocaleString()})`);
    }
  }

  if (input.ownerState && input.ownerState.toUpperCase() !== input.state.toUpperCase()) {
    score += 25;
    signals.push(`Out-of-state owner (${input.ownerState})`);
  }

  if (input.yearsOwned && input.yearsOwned >= 10) {
    score += 15;
    signals.push(`Long tenure (${input.yearsOwned} years)`);
  }

  const grade = score >= 70 ? "A+" : score >= 55 ? "A" : score >= 40 ? "B" : score >= 25 ? "C" : "D";
  const priority = score >= 60 ? "hot" : score >= 40 ? "warm" : "cold";

  return { score, grade, topSignals: signals, outreachPriority: priority };
}

// ---------------------------------------------------------------------------
// Batch County Screening
// ---------------------------------------------------------------------------

/**
 * Screen multiple counties simultaneously using open data.
 * Returns a ranked list of counties by investment opportunity.
 * Perfect for expanding to new markets or validating campaign targets.
 */
export async function screenCountiesForCampaign(
  counties: { state: string; county: string; metroMiles?: number }[]
): Promise<{
  county: string;
  state: string;
  rank: number;
  score: number;
  thesis: string;
  usdaLandValue: number;
  landValueTrend: string;
  recommendation: string;
}[]> {
  const results = await Promise.allSettled(
    counties.map(async c => {
      const [snapshot, trend, profile] = await Promise.allSettled([
        buildCountyAgSnapshot(c.state, c.county),
        getCachedLandTrend(c.state, c.county),
        buildCountyOpportunityProfile(c.state, c.county, c.metroMiles),
      ]);

      const nassData = snapshot.status === "fulfilled" ? snapshot.value : null;
      const trendData = trend.status === "fulfilled" ? trend.value : null;
      const profileData = profile.status === "fulfilled" ? profile.value : null;

      // `profileData?.opportunityScore || 50` put an unprofiled county at 50,
      // which lands on "Test with 500 letters" — an instruction to spend money,
      // issued for a county nothing had scored. Notably this file's own header
      // (~line 207) documents refusing to feed a scoring model placeholder
      // constants, for exactly this reason; the rule was written down here and
      // broken six hundred lines below it.
      const score: number | null = profileData?.opportunityScore ?? null;
      const usdaValue = nassData?.pasturePerAcre ?? null;

      return {
        county: c.county,
        state: c.state,
        score,
        thesis: profileData?.investorThesis || "Insufficient data for analysis.",
        usdaLandValue: usdaValue,
        landValueTrend: trendData?.trend || "unknown",
        // No score, no instruction. "Not scored" is a real answer and the only
        // honest one for a county with no profile on file.
        recommendation:
          score === null ? "Not scored — no county profile on file"
          : score >= 70 ? "Run campaign now"
          : score >= 50 ? "Test with 500 letters"
          : score >= 35 ? "Research further"
          : "Skip",
      };
    })
  );

  // Unscored counties sort last and are NOT ranked. `b.score - a.score` with a
  // null score yields NaN, which leaves the comparator's ordering undefined —
  // and a county nobody scored must not occupy a rank position either way.
  const all = results
    .filter(r => r.status === "fulfilled")
    .map(r => (r as PromiseFulfilledResult<any>).value);
  const scored = all.filter((r) => typeof r.score === "number");
  const unscored = all.filter((r) => typeof r.score !== "number");
  const ranked = [
    ...scored.sort((a, b) => b.score - a.score).map((item, idx) => ({ ...item, rank: idx + 1 })),
    ...unscored.map((item) => ({ ...item, rank: null })),
  ];

  return ranked;
}

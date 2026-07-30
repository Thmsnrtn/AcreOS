/**
 * Blind Offer Calculator
 *
 * Implements the industry standard blind offer pricing methodology — the
 * #1 acquisition strategy for raw land investing.
 *
 * The Core Formula (industry standard):
 *   Offer = Lowest Comparable Sale (last 12-18 months) ÷ 4
 *
 * This gives a 300% margin of safety — buying at 25 cents on the dollar creates
 * enough spread to profit even if the market drops 50% after acquisition.
 *
 * Why "blind"?
 *   The offer is mailed WITHOUT visiting or appraising the property.
 *   The letter contains a specific purchase price calculated from county comps.
 *   This is only possible when targeting the right county with sufficient comp data.
 *
 * Why ÷ 4?
 *   - Creates a "300% margin of safety" (Warren Buffett principle applied to land)
 *   - Filters for only the most motivated sellers (3 out of 5 accept at this price)
 *   - Leaves room for due diligence surprises, holding costs, and exit costs
 *   - Ensures profitability on both cash flip AND owner-financed exit
 *
 * The "3 Out of 5" Rule:
 *   When you send blind offer letters to the right county targeting the right
 *   seller profile, approximately 3 out of 5 offers get accepted. Lower acceptance
 *   rate = wrong county, wrong price, or wrong seller criteria.
 *
 * Industry Best Practices:
 *   - "Don't negotiate. Find sellers who want to sell at your price."
 *   - "The money is made at acquisition, not at sale."
 *   - "Your offer should solve the seller's problem, not meet the market price."
 *   - "Owner financing at 9% for 84 months turns a $10K purchase into $40K+ collected."
 */

import { getCachedCountySnapshot, getCachedLandTrend } from "./usdaNassService";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompData {
  pricePerAcre: number;
  acres: number;
  totalPrice: number;
  daysOnMarket?: number;
  saleDate?: string; // ISO date
  source: string; // "county_records" | "landwatch" | "land_and_farm" | "usda_nass" | "user_entered"
  address?: string;
  notes?: string;
}

export interface BlindOfferInput {
  state: string;
  county: string;
  targetAcres: number; // Acres of the parcel you're offering on
  comps?: CompData[]; // Optional manual comps (if available)
  marketCondition?: "buyers_market" | "balanced" | "sellers_market" | "hot"; // Override auto-detect
  sellerProfile?: {
    isTaxDelinquent: boolean;
    isOutOfState: boolean;
    yearsOwned: number;
    isInherited: boolean;
  };
  ownerFinanceGoal?: boolean; // True = optimize for note income
  preferredDownPayment?: number; // Override default (default = acquisition cost)
  // Per-org owner-finance underwriting defaults (Hank fix). When
  // provided, replaces the legacy 9% / 84 months hardcode in
  // buildOwnerFinanceScenario. Caller threads these in from
  // organizations.underwritingDefaults.ownerFinance.
  ownerFinanceDefaults?: {
    apr: number;
    termMonths: number;
    downPaymentPct: number;
    balloon: boolean;
  };
}

export interface CompAnalysis {
  allComps: CompData[];
  sourceBreakdown: Record<string, number>; // source → count
  // NULL — never a placeholder — when there is no comp to read the figure
  // from. These three numbers drive every offer tier and the dollar amount
  // merged into a PRINTED letter, so an invented value here becomes a real
  // offer in a stranger's mailbox. Until 2026-07-30 this shape returned
  // 1000 / 2000 / 5000 for an empty comp set; see analyzeComps().
  lowestSalePerAcre: number | null;
  medianSalePerAcre: number | null;
  highestSalePerAcre: number | null;
  avgDaysOnMarket: number | null;
  compCount: number;
  dataQuality: "excellent" | "good" | "limited" | "insufficient";
  dataQualityNotes: string[];
  isCountyValidated: boolean; // True if 10+ comps (eBay validation threshold)
}

export interface OfferTier {
  name: string;
  offerPerAcre: number;
  offerTotal: number;
  pctOfLowestComp: number;
  description: string;
  bestFor: string;
  acceptanceRateForecast: string;
}

export interface OwnerFinanceScenario {
  salePrice: number; // What you list it for
  downPayment: number; // Down = acquisition cost (capital recovery day 1)
  loanAmount: number; // What the buyer finances
  interestRate: number; // 9% per industry-standard methodology
  termMonths: number; // 84 months (7 years) standard
  monthlyPayment: number;
  totalCollected: number; // Down + all monthly payments
  netProfit: number; // Total collected − acquisition cost
  roi: number; // Net profit / acquisition cost × 100
  passiveIncomeYears: number; // Years of monthly payments
  breakEvenMonth: number; // Month when cumulative payments exceed acquisition cost
  noteValue: number; // Fair market value of the note (if sold to note buyer)
  cashFlowYear1: number; // Annual cash flow (12 × monthly)
  doddFrankExempt: boolean; // Raw land seller financing exemption
  regNotes: string;
}

export interface CashFlipScenario {
  salePrice: number;
  acquisition: number;
  holdingCosts: number; // Property taxes, insurance during hold
  dispositionCosts: number; // Agent, closing, listing fees
  netProfit: number;
  roi: number;
  holdingPeriodDays: number; // Target 30 days
  annualizedROI: number;
}

export interface BlindOfferReport {
  /** Discriminant. An offer report only ever exists with real comp data. */
  status: "ok";

  // Input summary
  state: string;
  county: string;
  targetAcres: number;
  generatedAt: string;

  // Comp analysis
  compAnalysis: CompAnalysis;

  // Core offer formula output
  lowestCompPerAcre: number;
  baseOfferPerAcre: number; // lowestComp ÷ 4
  baseOfferTotal: number; // × acres

  // Three offer tiers (for flexibility)
  offerTiers: {
    aggressive: OfferTier; // 20% of lowest comp (ultra-motivated sellers)
    standard: OfferTier; // 25% of lowest comp (industry standard)
    competitive: OfferTier; // 33% of lowest comp (hot markets, less competition)
  };

  // Recommended offer (based on market condition and seller profile)
  recommendedTier: "aggressive" | "standard" | "competitive";
  recommendedOfferTotal: number;
  recommendationReason: string;

  // Exit strategy modeling
  cashFlipScenario: CashFlipScenario;
  ownerFinanceScenario: OwnerFinanceScenario;
  hybridRecommendation: string; // Preferred hybrid approach

  // Letter generation inputs
  letterVariables: {
    offerAmount: number;
    offerAmountWords: string; // "Twenty-five hundred dollars"
    countyName: string;
    stateName: string;
    acquisitionType: "cash" | "both_options"; // Include owner-finance option?
    urgencyLanguage: string;
    closingTimeline: string; // "30 days or less"
  };

  // Market context
  marketContext: {
    usdaLandValuePerAcre: number;
    usdaCagr5Year: number;
    marketCondition: string;
    competitionLevel: string;
    ebayValidationNote: string;
  };

  // Warnings
  warnings: string[];
}

/**
 * The honest refusal. Mirrors the AVM's `insufficient_data` shape
 * (`services/acreOSValuation.ts`): a status discriminant plus a `missing[]`
 * array naming exactly what has to exist before an offer can be computed.
 *
 * There are NO offer fields on this shape, deliberately. A caller cannot read
 * an offer amount off a refusal even by accident — no `offerTiers`, no
 * `recommendedOfferTotal`, no `letterVariables`. The only numbers present are
 * ones that were actually measured (comp count = 0, USDA values as returned).
 *
 * Nothing is billed for a refusal: this path performs no credit-pool debit and
 * no paid provider lookup (USDA NASS is free), so there is no debit to refund.
 */
export interface BlindOfferRefusal {
  status: "insufficient_data";
  state: string;
  county: string;
  targetAcres: number;
  generatedAt: string;
  compAnalysis: CompAnalysis;
  /** What must exist before an offer can be calculated honestly. */
  missing: string[];
  /** Market context that WAS measured (zeros mean "USDA returned nothing"). */
  marketContext: BlindOfferReport["marketContext"];
  warnings: string[];
}

export type BlindOfferOutcome = BlindOfferReport | BlindOfferRefusal;

/** Narrowing helper for callers that only want the priced report. */
export function isBlindOfferRefusal(o: BlindOfferOutcome): o is BlindOfferRefusal {
  return o.status === "insufficient_data";
}

// ---------------------------------------------------------------------------
// Core Calculator
// ---------------------------------------------------------------------------

export async function calculateBlindOffer(input: BlindOfferInput): Promise<BlindOfferOutcome> {
  const { state, county, targetAcres, comps = [], marketCondition, sellerProfile, ownerFinanceGoal } = input;

  // Enrich with USDA NASS data
  const [nassSnapshot, nassTrend] = await Promise.allSettled([
    getCachedCountySnapshot(state, county),
    getCachedLandTrend(state, county),
  ]);

  const nassData = nassSnapshot.status === "fulfilled" ? nassSnapshot.value : null;
  const trend = nassTrend.status === "fulfilled" ? nassTrend.value : null;

  // Build complete comp dataset
  const allComps = buildCompDataset(comps, nassData, trend);
  const compAnalysis = analyzeComps(allComps);

  // Determine market condition (auto or override)
  const effectiveMarketCondition = marketCondition || detectMarketCondition(trend);

  const marketContext = {
    usdaLandValuePerAcre: nassData?.pasturePerAcre || 0,
    usdaCagr5Year: trend?.cagr5Year || 0,
    marketCondition: effectiveMarketCondition,
    competitionLevel:
      compAnalysis.compCount > 50 ? "high" : compAnalysis.compCount > 20 ? "medium" : "low",
    ebayValidationNote: compAnalysis.isCountyValidated
      ? `County validated: ${compAnalysis.compCount}+ comps confirm active market.`
      : `County has limited comp data (${compAnalysis.compCount} comps found). Validate via eBay sold listings before running campaign.`,
  };

  // Warnings
  const warnings = buildWarnings(compAnalysis, targetAcres, nassData, effectiveMarketCondition);

  // ── The refusal gate ────────────────────────────────────────────────────
  // Every offer figure below — and the dollar amount merged into a MAILED
  // letter — is derived from `lowestSalePerAcre`. If there is no real comp to
  // derive it from, there is no offer. We refuse, naming what's missing, and
  // return a shape that carries no offer amount at all.
  //
  // Before 2026-07-30 this path substituted 1000 / 2000 / 5000 per acre, so a
  // parcel with zero comps and no USDA coverage produced a confident,
  // fully-fabricated purchase price on a printed letter.
  const lowestCompPerAcre = compAnalysis.lowestSalePerAcre;
  const medianCompPerAcre = compAnalysis.medianSalePerAcre;
  const missing: string[] = [];

  if (compAnalysis.compCount === 0) {
    missing.push(
      `Comparable sales for ${county} County, ${state.toUpperCase()} — none were found. ` +
        `Paste comps from the county assessor / LandWatch / eBay sold listings, or connect an ATTOM key to pull them automatically.`,
    );
    if (!nassData?.pasturePerAcre) {
      missing.push(
        "USDA NASS land values for this state (the free per-acre benchmark used when no direct comps exist). " +
          "Set USDA_NASS_API_KEY, or the county has no NASS pastureland series.",
      );
    }
  } else if (
    lowestCompPerAcre === null ||
    medianCompPerAcre === null ||
    !Number.isFinite(lowestCompPerAcre) ||
    lowestCompPerAcre <= 0
  ) {
    missing.push(
      `At least one comparable sale with a positive price per acre for ${county} County, ` +
        `${state.toUpperCase()} — the ${compAnalysis.compCount} comp(s) on file carry no usable price.`,
    );
  }

  // A non-positive acreage would silently produce a $0 (or negative) mailed
  // offer. Refuse rather than price it.
  if (!Number.isFinite(targetAcres) || targetAcres <= 0) {
    missing.push("A positive parcel acreage (targetAcres) — an offer cannot be priced without it.");
  }

  if (missing.length > 0 || lowestCompPerAcre === null || medianCompPerAcre === null) {
    return {
      status: "insufficient_data",
      state: state.toUpperCase(),
      county,
      targetAcres,
      generatedAt: new Date().toISOString(),
      compAnalysis,
      missing: missing.length > 0
        ? missing
        : [
            `Comparable sales for ${county} County, ${state.toUpperCase()} with a usable price per acre.`,
          ],
      marketContext,
      warnings,
    };
  }

  // Core pricing — from here on every figure traces to a real comp.
  const basePerAcre = lowestCompPerAcre / 4;
  const baseTotal = basePerAcre * targetAcres;

  // Three tiers
  const offerTiers = buildOfferTiers(lowestCompPerAcre, targetAcres, effectiveMarketCondition);

  // Recommendation
  const { tier: recommendedTier, reason } = recommendTier(
    effectiveMarketCondition,
    sellerProfile,
    compAnalysis
  );
  const recommendedOfferTotal = offerTiers[recommendedTier].offerTotal;

  // Exit scenarios
  const acquisition = recommendedOfferTotal;
  const cashFlipScenario = buildCashFlipScenario(acquisition, medianCompPerAcre, targetAcres);
  const ownerFinanceScenario = buildOwnerFinanceScenario(
    acquisition,
    medianCompPerAcre,
    targetAcres,
    input.ownerFinanceDefaults,
  );

  // Hybrid recommendation
  const hybridRecommendation = buildHybridRecommendation(cashFlipScenario, ownerFinanceScenario, ownerFinanceGoal);

  // Letter variables
  const letterVariables = buildLetterVariables(
    recommendedOfferTotal,
    county,
    state,
    sellerProfile
  );

  return {
    status: "ok",
    state: state.toUpperCase(),
    county,
    targetAcres,
    generatedAt: new Date().toISOString(),
    compAnalysis,
    lowestCompPerAcre: Math.round(lowestCompPerAcre),
    baseOfferPerAcre: Math.round(basePerAcre),
    baseOfferTotal: Math.round(baseTotal),
    offerTiers,
    recommendedTier,
    recommendedOfferTotal: Math.round(recommendedOfferTotal),
    recommendationReason: reason,
    cashFlipScenario,
    ownerFinanceScenario,
    hybridRecommendation,
    letterVariables,
    marketContext,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Comp Dataset Construction
// ---------------------------------------------------------------------------

function buildCompDataset(
  userComps: CompData[],
  nassData: any,
  trend: any
): CompData[] {
  const allComps: CompData[] = [...userComps];

  // Inject USDA NASS data as a comp anchor
  if (nassData?.pasturePerAcre > 0) {
    allComps.push({
      pricePerAcre: nassData.pasturePerAcre,
      acres: 1, // Per-acre metric
      totalPrice: nassData.pasturePerAcre,
      source: "usda_nass",
      notes: `USDA NASS ${nassData.year} Pastureland Value — ${nassData.state} statewide`,
    });
  }

  // Add historical year for trend context
  if (trend?.years && trend.years.length > 1) {
    const priorYear = trend.years[trend.years.length - 2];
    if (priorYear) {
      allComps.push({
        pricePerAcre: priorYear.valuePerAcre,
        acres: 1,
        totalPrice: priorYear.valuePerAcre,
        source: "usda_nass",
        saleDate: `${priorYear.year}-01-01`,
        notes: `USDA NASS ${priorYear.year} Pastureland Value (prior year)`,
      });
    }
  }

  return allComps;
}

// ---------------------------------------------------------------------------
// Comp Analysis
// ---------------------------------------------------------------------------

/**
 * Reduce a comp set to the statistics the offer formula reads.
 *
 * EXPORTED so the unit suite drives the real implementation. It used to be
 * private, and `tests/unit/blindOfferCalculator.test.ts` carried an inline
 * copy — which is how the fabricated empty-set branch survived a test file
 * that asserted it.
 *
 * With zero comps the three price fields are NULL. They were 1000 / 2000 /
 * 5000 — invented numbers that flowed straight through the offer tiers into
 * `letterVariables.offerAmount`, i.e. a made-up purchase price on a mailed
 * letter. There is no honest placeholder for "we don't know what land sells
 * for here"; the only honest value is absence.
 */
export function analyzeComps(comps: CompData[]): CompAnalysis {
  if (comps.length === 0) {
    return {
      allComps: [],
      sourceBreakdown: {},
      lowestSalePerAcre: null,
      medianSalePerAcre: null,
      highestSalePerAcre: null,
      avgDaysOnMarket: null,
      compCount: 0,
      dataQuality: "insufficient",
      dataQualityNotes: [
        "No comparable sales found — no offer can be calculated. Research comps (county assessor, LandWatch, eBay sold listings) before offering.",
      ],
      isCountyValidated: false,
    };
  }

  const prices = comps.map(c => c.pricePerAcre).sort((a, b) => a - b);
  const lowest = prices[0];
  const highest = prices[prices.length - 1];
  const median = prices[Math.floor(prices.length / 2)];

  const domValues = comps.filter(c => c.daysOnMarket !== undefined).map(c => c.daysOnMarket!);
  const avgDom = domValues.length > 0
    ? Math.round(domValues.reduce((a, b) => a + b, 0) / domValues.length)
    : null;

  const sourceBreakdown: Record<string, number> = {};
  for (const comp of comps) {
    sourceBreakdown[comp.source] = (sourceBreakdown[comp.source] || 0) + 1;
  }

  const compCount = comps.length;
  const isCountyValidated = compCount >= 10; // Validation threshold

  let dataQuality: CompAnalysis["dataQuality"];
  const notes: string[] = [];

  if (compCount >= 10) {
    dataQuality = "excellent";
  } else if (compCount >= 5) {
    dataQuality = "good";
    notes.push("Good comp data. Consider pulling additional comps from LandWatch and eBay sold listings for higher confidence.");
  } else if (compCount >= 2) {
    dataQuality = "limited";
    notes.push("Limited comps available. Pull 5-10 comparables from county assessor, LandWatch, and Land and Farm before finalizing offer.");
  } else {
    dataQuality = "insufficient";
    notes.push("Insufficient comp data. Do not send offer until 5+ direct comparables are researched. Check eBay for this county to validate the model works here.");
  }

  // Flag extreme range
  if (highest > lowest * 5) {
    notes.push(`High price variance (${Math.round(lowest)}/acre to ${Math.round(highest)}/acre). Focus on most recent and most similar-acreage comps.`);
  }

  return {
    allComps: comps,
    sourceBreakdown,
    lowestSalePerAcre: lowest,
    medianSalePerAcre: median,
    highestSalePerAcre: highest,
    avgDaysOnMarket: avgDom,
    compCount,
    dataQuality,
    dataQualityNotes: notes,
    isCountyValidated,
  };
}

// ---------------------------------------------------------------------------
// Offer Tiers
// ---------------------------------------------------------------------------

function buildOfferTiers(
  lowestCompPerAcre: number,
  acres: number,
  marketCondition: string
): BlindOfferReport["offerTiers"] {
  return {
    aggressive: {
      name: "Ultra-Motivated Seller (20%)",
      offerPerAcre: Math.round(lowestCompPerAcre * 0.20),
      offerTotal: Math.round(lowestCompPerAcre * 0.20 * acres),
      pctOfLowestComp: 20,
      description: "20 cents on the dollar — maximum margin, minimum acceptance rate",
      bestFor: "Tax delinquent lists, inherited property, distressed sellers, markets with abundant supply",
      acceptanceRateForecast: "~1 in 5 sellers (higher volume campaigns needed)",
    },
    standard: {
      name: "Standard (25%)",
      offerPerAcre: Math.round(lowestCompPerAcre * 0.25),
      offerTotal: Math.round(lowestCompPerAcre * 0.25 * acres),
      pctOfLowestComp: 25,
      description: "25 cents on the dollar — the proven industry standard formula",
      bestFor: "Most counties, mixed seller motivation profiles, balanced markets",
      acceptanceRateForecast: "~3 in 5 sellers (reported rate in validated counties)",
    },
    competitive: {
      name: "Competitive Market (33%)",
      offerPerAcre: Math.round(lowestCompPerAcre * 0.33),
      offerTotal: Math.round(lowestCompPerAcre * 0.33 * acres),
      pctOfLowestComp: 33,
      description: "33 cents on the dollar — for hot markets with thin seller motivation",
      bestFor: "Sellers markets, fast-appreciating counties, urban-adjacent parcels",
      acceptanceRateForecast: "~4 in 5 sellers (higher acceptance, lower margin)",
    },
  };
}

// ---------------------------------------------------------------------------
// Market Condition Detection
// ---------------------------------------------------------------------------

function detectMarketCondition(
  trend: any
): "buyers_market" | "balanced" | "sellers_market" | "hot" {
  if (!trend) return "balanced";
  if (trend.oneYearChangePercent > 8) return "hot";
  if (trend.oneYearChangePercent > 3) return "sellers_market";
  if (trend.oneYearChangePercent > 0) return "balanced";
  return "buyers_market";
}

function recommendTier(
  marketCondition: string,
  sellerProfile?: BlindOfferInput["sellerProfile"],
  compAnalysis?: CompAnalysis
): { tier: "aggressive" | "standard" | "competitive"; reason: string } {
  // In a hot market, need to offer more to find willing sellers
  if (marketCondition === "hot") {
    return {
      tier: "competitive",
      reason: "Hot market detected — using 33% of lowest comp to maintain competitive acceptance rate. Even at 33 cents, your 3× markup potential preserves excellent margins.",
    };
  }

  // Strong seller motivation = can offer less
  if (sellerProfile?.isTaxDelinquent && sellerProfile?.isOutOfState) {
    return {
      tier: "aggressive",
      reason: "Tax delinquent + out-of-state owner — highest motivation profile. 20% offer targets ultra-motivated sellers. Run with a 30-day follow-up sequence if no response.",
    };
  }

  // Insufficient data = standard to be safe
  if (compAnalysis?.dataQuality === "insufficient") {
    return {
      tier: "standard",
      reason: "Limited comp data — using standard 25% formula as a conservative starting point. Validate county with manual comp research before sending.",
    };
  }

  return {
    tier: "standard",
    reason: "Standard market conditions — using the proven formula of 25 cents on the dollar. This targets the right seller profile and delivers ~3 of 5 acceptance rate in validated counties.",
  };
}

// ---------------------------------------------------------------------------
// Exit Scenarios
// ---------------------------------------------------------------------------

function buildCashFlipScenario(
  acquisition: number,
  medianMarketPerAcre: number,
  acres: number
): CashFlipScenario {
  const salePrice = medianMarketPerAcre * acres; // Sell at median (not highest)
  const holdingCosts = (acquisition * 0.02) + (salePrice * 0.01); // ~2% of acquisition + 1% taxes
  const dispositionCosts = salePrice * 0.08; // 8% closing/marketing (no agent on buyer side = lower)
  const netProfit = salePrice - acquisition - holdingCosts - dispositionCosts;
  const roi = acquisition > 0 ? (netProfit / acquisition) * 100 : 0;
  const holdingPeriodDays = 45; // 30-day target + buffer
  const annualizedROI = roi * (365 / holdingPeriodDays);

  return {
    salePrice: Math.round(salePrice),
    acquisition: Math.round(acquisition),
    holdingCosts: Math.round(holdingCosts),
    dispositionCosts: Math.round(dispositionCosts),
    netProfit: Math.round(netProfit),
    roi: Math.round(roi),
    holdingPeriodDays,
    annualizedROI: Math.round(annualizedROI),
  };
}

// Legacy hardcode preserved as fallback for orgs that haven't set their
// underwriting defaults yet. Texas standard (and Hank's book of 70 notes
// across $4M GMV) is 9.9% / 120mo / 20% down / no balloon — see Settings
// → Underwriting for the per-org override.
const LEGACY_OWNER_FINANCE_DEFAULTS = {
  apr: 9,
  termMonths: 84,
  downPaymentPct: 0, // 0 means "downpayment = acquisition cost" (legacy behavior)
  balloon: false,
};

function buildOwnerFinanceScenario(
  acquisition: number,
  medianMarketPerAcre: number,
  acres: number,
  defaults?: { apr: number; termMonths: number; downPaymentPct: number; balloon: boolean },
): OwnerFinanceScenario {
  const cfg = defaults ?? LEGACY_OWNER_FINANCE_DEFAULTS;
  // Industry standard: list at 2-3x acquisition price; down = acquisition cost
  const salePrice = Math.max(medianMarketPerAcre * acres * 1.1, acquisition * 3);
  // Down payment: when downPaymentPct > 0 (explicit org default), use a
  // percentage of sale price. When 0 (legacy fallback), recover the full
  // acquisition cost at closing — that's the original behavior.
  const downPayment = cfg.downPaymentPct > 0
    ? salePrice * (cfg.downPaymentPct / 100)
    : acquisition;
  const loanAmount = Math.max(0, salePrice - downPayment);

  const r = (cfg.apr / 100) / 12;
  const n = cfg.termMonths;
  const monthlyPayment = loanAmount > 0
    ? loanAmount * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1)
    : 0;

  // With a balloon, the borrower pays interest-only (approx) for n months
  // and the principal balloons at term end. We still credit the full
  // collected amount but flag the structure via the regNotes string.
  const totalCollected = downPayment + (monthlyPayment * n) + (cfg.balloon ? loanAmount : 0);
  const netProfit = totalCollected - acquisition;
  const roi = acquisition > 0 ? (netProfit / acquisition) * 100 : 800;

  // Break-even: when cumulative payments cover acquisition cost.
  // If down payment >= acquisition we recover capital at closing.
  const breakEvenMonth = downPayment >= acquisition
    ? 0
    : monthlyPayment > 0
      ? Math.ceil((acquisition - downPayment) / monthlyPayment)
      : 0;

  // Note market value: typical note buyers pay 70-85 cents on the dollar
  const noteValue = loanAmount * 0.75;

  const cashFlowYear1 = monthlyPayment * 12;

  const balloonNote = cfg.balloon
    ? " A balloon payment for the remaining principal is due at term end."
    : "";

  return {
    salePrice: Math.round(salePrice),
    downPayment: Math.round(downPayment),
    loanAmount: Math.round(loanAmount),
    interestRate: cfg.apr,
    termMonths: cfg.termMonths,
    monthlyPayment: Math.round(monthlyPayment),
    totalCollected: Math.round(totalCollected),
    netProfit: Math.round(netProfit),
    roi: Math.round(roi),
    passiveIncomeYears: Math.round(cfg.termMonths / 12),
    breakEvenMonth,
    noteValue: Math.round(noteValue),
    cashFlowYear1: Math.round(cashFlowYear1),
    doddFrankExempt: true, // Raw land seller financing exempt from Dodd-Frank/RESPA
    regNotes: "Raw land seller financing is exempt from Dodd-Frank, RESPA, and SAFE Act requirements that apply to residential mortgages. No mortgage license required. Standard land contract or deed of trust with installment sale note." + balloonNote,
  };
}

function buildHybridRecommendation(
  cashFlip: CashFlipScenario,
  ownerFinance: OwnerFinanceScenario,
  preferOwnerFinance?: boolean
): string {
  if (preferOwnerFinance || ownerFinance.roi > cashFlip.roi * 1.5) {
    return `Owner Finance (Recommended): ${ownerFinance.roi}% ROI over 7 years vs. ${cashFlip.roi}% ROI from a cash flip. Down payment of $${ownerFinance.downPayment.toLocaleString()} recoups your entire acquisition cost on day 1. Then collect $${ownerFinance.monthlyPayment.toLocaleString()}/month for 84 months — pure passive income. This is how the industry standard model builds wealth compoundingly.`;
  }
  return `Cash Flip (Recommended for capital recycling): ${cashFlip.roi}% ROI in ~45 days. Deploy capital immediately into the next deal. Once you have 10-20 successful flips and understand the market, transition to owner financing to build the note portfolio that generates true passive income.`;
}

// ---------------------------------------------------------------------------
// Letter Variables
// ---------------------------------------------------------------------------

function buildLetterVariables(
  offerAmount: number,
  county: string,
  state: string,
  sellerProfile?: BlindOfferInput["sellerProfile"]
): BlindOfferReport["letterVariables"] {
  // Last line of defense before a dollar amount is printed and mailed. The
  // refusal gate in calculateBlindOffer should make this unreachable; if a
  // future caller finds another way in, it must fail loudly rather than mail a
  // $0 / NaN / negative offer.
  if (!Number.isFinite(offerAmount) || offerAmount <= 0) {
    throw new Error(
      `Refusing to build letter variables for a non-positive offer amount (${offerAmount}) — ` +
        "an offer letter must never carry a fabricated or empty price.",
    );
  }

  // Convert number to words (simplified)
  const offerWords = numberToWords(offerAmount);

  const urgencyLanguage = sellerProfile?.isTaxDelinquent
    ? "I understand property taxes can become a burden. My offer resolves this quickly."
    : sellerProfile?.isOutOfState
    ? "As an out-of-area property owner, selling can feel complicated. I make it simple."
    : "This is a straightforward, no-obligation offer with no real estate agents or fees.";

  const acquisitionType = offerAmount < 20000 ? "both_options" : "cash";

  return {
    offerAmount,
    offerAmountWords: offerWords,
    countyName: county,
    stateName: getStateName(state),
    acquisitionType,
    urgencyLanguage,
    closingTimeline: "30 days or less",
  };
}

function numberToWords(amount: number): string {
  if (amount >= 1000000) return `${(amount / 1000000).toFixed(1)} million dollars`;
  if (amount >= 1000) {
    const thousands = Math.floor(amount / 1000);
    const remainder = amount % 1000;
    if (remainder === 0) return `${thousands} thousand dollars`;
    return `${thousands} thousand ${remainder} dollars`;
  }
  return `${amount} dollars`;
}

const STATE_NAMES: Record<string, string> = {
  AZ: "Arizona", NM: "New Mexico", TX: "Texas", FL: "Florida",
  NC: "North Carolina", TN: "Tennessee", CO: "Colorado", OR: "Oregon",
  GA: "Georgia", SC: "South Carolina", MO: "Missouri", AR: "Arkansas",
  OK: "Oklahoma", KS: "Kansas", NE: "Nebraska", SD: "South Dakota",
  ND: "North Dakota", MT: "Montana", ID: "Idaho", WA: "Washington",
  CA: "California", AL: "Alabama", MS: "Mississippi", LA: "Louisiana",
  IA: "Iowa", MN: "Minnesota", WI: "Wisconsin", MI: "Michigan",
  OH: "Ohio", IN: "Indiana", IL: "Illinois", KY: "Kentucky",
  WV: "West Virginia", VA: "Virginia", PA: "Pennsylvania", NY: "New York",
};

function getStateName(stateCode: string): string {
  return STATE_NAMES[stateCode.toUpperCase()] || stateCode.toUpperCase();
}

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

function buildWarnings(
  compAnalysis: CompAnalysis,
  acres: number,
  nassData: any,
  marketCondition: string
): string[] {
  const warnings: string[] = [];

  if (compAnalysis.dataQuality === "insufficient") {
    warnings.push("CRITICAL: Insufficient comp data. Do not send offer letters until you have 5+ direct comparables. Sending offers without comp data risks accepting properties at above-market prices.");
  }

  if (!compAnalysis.isCountyValidated) {
    warnings.push(`County not yet validated (only ${compAnalysis.compCount} comps). We recommend validating with eBay sold listings — look for 10+ bidders on similar parcels before running a campaign.`);
  }

  if (marketCondition === "hot") {
    warnings.push("Hot market alert: Land values appreciating rapidly. Re-check comps every 60 days — stale comps in a rising market cause offer prices to lag reality and reduce seller acceptance.");
  }

  if (acres > 100) {
    warnings.push("Large acreage parcel: Consider whether the model works at this size. Large parcels have thinner buyer pools. Explore subdivision potential or target institutional land buyers.");
  }

  if (acres < 1) {
    warnings.push("Sub-acre parcel: The standard land model may not apply. Verify comp pool and buyer demand for small lots specifically in this county.");
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Batch County Campaign Sizing
// ---------------------------------------------------------------------------

export interface CampaignSizingInput {
  county: string;
  state: string;
  targetDealsPerMonth: number;
  expectedAcceptanceRate?: number; // Default 0.6 (3 of 5)
  averageDealSize?: number; // Average property acreage
}

export interface CampaignSizingOutput {
  county: string;
  state: string;
  lettersNeeded: number;
  responsesExpected: number;
  dealsExpected: number;
  estimatedCostDollars: number; // ~$0.75-$1.25 per piece all-in
  timelineWeeks: number;
  scalingNotes: string;
}

export function sizeCampaign(input: CampaignSizingInput): CampaignSizingOutput {
  const acceptanceRate = input.expectedAcceptanceRate || 0.60; // 60% = 3 of 5
  const responseRate = 0.04; // ~4% response rate on blind offer letters
  const closeRate = acceptanceRate; // Of responses, closure rate

  // Back-calculate: how many letters to get targetDeals/month
  const responsesNeeded = input.targetDealsPerMonth / closeRate;
  const lettersNeeded = Math.ceil(responsesNeeded / responseRate);

  const costPerLetter = 1.00; // ~$1 all-in (printing + postage + list)
  const totalCost = lettersNeeded * costPerLetter;

  const timelineWeeks = 6; // 2 weeks production + 4 weeks response window

  return {
    county: input.county,
    state: input.state,
    lettersNeeded,
    responsesExpected: Math.round(lettersNeeded * responseRate),
    dealsExpected: input.targetDealsPerMonth,
    estimatedCostDollars: Math.round(totalCost),
    timelineWeeks,
    scalingNotes: `To close ${input.targetDealsPerMonth} deal(s)/month in ${input.county} County: mail ${lettersNeeded.toLocaleString()} letters, expect ~${Math.round(lettersNeeded * responseRate)} responses, close ~${input.targetDealsPerMonth}. Campaign cost: $${Math.round(totalCost).toLocaleString()}. Mail monthly for consistent pipeline.`,
  };
}

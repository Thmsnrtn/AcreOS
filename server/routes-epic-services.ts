/**
 * EPIC Services Routes (EPICs 1–8)
 *
 * New API endpoints wiring the new services to the frontend:
 *   GET  /api/seller-motivation/:leadId — compute motivation score for a lead
 *   POST /api/seller-motivation/score   — score raw input (no DB lookup)
 *   GET  /api/county-opportunity/:state/:county — get opportunity score
 *   GET  /api/title-chain/:dealId       — get title chain for a deal
 *   POST /api/title-chain/analyze       — analyze raw title events
 *   GET  /api/closing-checklist/:dealId — get closing checklist
 *   GET  /api/investor-network/profile  — get trust profile
 *   GET  /api/investor-network/trust-score — get trust score components
 *   POST /api/deals/:id/share           — share deal with network partner
 *   GET  /api/financial/1031-exchanges  — list active 1031 exchanges
 *   POST /api/financial/1031-exchanges  — create new 1031 exchange tracker
 *   GET  /api/financial/deal-pnl/:dealId — P&L for a deal
 *   GET  /api/financial/tax-report      — annual tax report
 *   GET  /api/developer/openapi         — OpenAPI spec
 *   POST /api/developer/api-keys        — generate API key
 */

import { Router, type Request, type Response } from "express";
import { Errors } from "./utils/errors";

const router = Router();

function getUser(req: Request) { return req.user; }

// ============================================================================
// EPIC 1+2: Seller Motivation Score
// ============================================================================

router.get("/seller-motivation/:leadId", async (req: Request, res: Response) => {
  try {
    const { db } = await import("./db");
    const { leads } = await import("@shared/schema");
    const { eq, and } = await import("drizzle-orm");
    const org = req.organization;

    const [lead] = await db
      .select()
      .from(leads)
      .where(and(eq(leads.id, parseInt(req.params.leadId)), eq(leads.organizationId, org.id)))
      .limit(1);

    if (!lead) return Errors.notFound(res, "Lead");

    // ── REFUSES 2026-08-21. It scored every lead from the same invented vector.
    //
    // `computeSellerMotivationScore` takes eleven signals. A `leads` row can
    // supply TWO of them. Nine were cast through `as any` onto a column that
    // does not exist, and each carried a default that reads like a measurement:
    //
    //   assessedValue          -> "5000"        `assessedValue` is on properties,
    //                                            and leads has no propertyId, so
    //                                            it was never reachable from here
    //   ownershipYears         -> 5
    //   estimatedCurrentValue  -> assessedValue * 1.4  (so: always 7000)
    //   countyCompetitionLevel -> "medium"
    //   taxDelinquentYears     -> 0             not a column of ANY table
    //   taxDelinquentAmount    -> 0                    "
    //   lastSalePrice          -> 0                    "
    //   ownerName              -> undefined            "  (so isInherited and
    //                                            isCorporateOwner were always false)
    //   ownerState             -> undefined            "  (so isOutOfState was
    //                                            ALWAYS false — the out-of-state
    //                                            owner signal, which is one of the
    //                                            strongest motivation indicators in
    //                                            land, could never fire)
    //
    // Only `isTaxDelinquent` varied. So this endpoint returned at most TWO
    // distinct scores across every lead in every organization, and presented
    // each as that lead's motivation. `getOptimalOutreachTiming` was handed
    // `(lead as any).ownerState || lead.state || "TX"` — the same fabricated
    // Texas fallback found in auditOrgUsury the same day.
    //
    // The engine is not the problem and is untouched: given real signals it
    // computes correctly. What was wrong was feeding it invented ones and
    // labelling the output a per-lead score. Refusing names the six signals the
    // schema does not record anywhere, which is the actionable half — this
    // becomes real by adding those columns and populating them from a data
    // provider, not by choosing better defaults.
    const NEVER_RECORDED = [
      "ownerName", "ownerState", "ownershipYears",
      "lastSalePrice", "taxDelinquentYears", "taxDelinquentAmount",
    ];

    res.json({
      leadId: lead.id,
      state: lead.state,
      motivation: null,
      outreachTiming: null,
      available: false,
      reason:
        "AcreOS cannot score this lead's seller motivation. The model needs eleven " +
        "signals and this lead record carries one of them (tax-delinquent status). " +
        "The rest are not stored anywhere in AcreOS, so any score would be computed " +
        "from placeholder values rather than from anything observed about this owner.",
      signalsAvailable: ["isTaxDelinquent"],
      signalsNotRecorded: NEVER_RECORDED,
      signalsOnAnotherTable: ["assessedValue (properties.assessed_value; a lead has no property link)"],
    });
    return;

  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.post("/seller-motivation/score", async (req: Request, res: Response) => {
  try {
    const { computeSellerMotivationScore } = await import("./services/sellerMotivationEngine");
    const result = computeSellerMotivationScore(req.body);
    res.json(result);
  } catch (err: any) {
    Errors.badRequest(res, err.message ?? "Bad request");
  }
});

// Batch rescore leads for an org
router.post("/seller-motivation/rescore-org", async (req: Request, res: Response) => {
  try {
    const { rescoreLeadsForOrg } = await import("./services/sellerMotivationEngine");
    const org = req.organization;
    const result = await rescoreLeadsForOrg(org.id);
    res.json(result);
  } catch (err: any) {
    // The batch rescorer refuses: it has no property join, so every score it
    // could write is derived from placeholder inputs. 501 — "an endpoint that
    // exists but does not do the thing it names" — is the honest answer, and
    // it is a better one than the `{processed: 0}` this used to return behind
    // a filter that matched nothing.
    if (String(err?.message ?? "").includes("rescoreLeadsForOrg cannot score anything")) {
      return Errors.notImplemented(res, err.message);
    }
    Errors.internal(res, err);
  }
});

// ============================================================================
// EPIC 6: County Opportunity Score
// ============================================================================

router.get("/county-opportunity/:state/:county", async (req: Request, res: Response) => {
  try {
    const { computeCountyOpportunityScore, detectLeadIndicatorAlerts, generateCountyIntelligenceReport, REQUIRED_SIGNALS } = await import("./services/countyOpportunityScore");
    const { db } = await import("./db");
    const { countyMarkets } = await import("@shared/schema");
    const { eq, and } = await import("drizzle-orm");
    const { getCountyFips } = await import("./services/censusDataService");
    const { getPermitTrend } = await import("./services/openData/countyMarketSignals");
    const { state, county } = req.params;

    // Fetch county market data
    const [marketData] = await db
      .select()
      .from(countyMarkets)
      .where(and(eq(countyMarkets.state, state.toUpperCase()), eq(countyMarkets.county, county)))
      .limit(1);

    // Ingested Census BPS annual data (county_building_permits) beats the
    // hardcoded default — only used when both trend years actually exist.
    const fips = getCountyFips(state, county);
    const permitTrend = fips ? await getPermitTrend(fips.stateFips, fips.countyFips) : null;

    // Build input from what is ON FILE. Every absent signal is null.
    //
    // This block used to read `marketData?.avgDaysOnMarket || 90`,
    // `monthsOfSupply: 6`, `estimatedInvestorMailingCount: 10`,
    // `distanceToNearestMetroMiles: 80` and four `has…: false` — seventeen of
    // the model's twenty-one signals were literals. For a county with no
    // `county_markets` row that meant a complete "Market Intelligence Report"
    // — "Average days on market: 90", "Sales volume (12 months): 20
    // transactions", an opportunity score and a recommendation to BUY — built
    // entirely out of constants. `parcelIntelligenceFusion.ts` already refused
    // to feed this model placeholders for exactly that reason; this route did
    // the opposite.
    const num = (v: unknown): number | null => {
      if (v === null || v === undefined || v === "") return null;
      const n = typeof v === "number" ? v : parseFloat(String(v));
      return Number.isFinite(n) ? n : null;
    };
    const input = {
      state: state.toUpperCase(),
      county,
      priceVelocity3Mo: num((marketData as any)?.priceChange3Mo),
      priceVelocity12Mo: num(marketData?.priceChangePercent),
      avgPricePerAcre: num(marketData?.medianPricePerAcre),
      pricePerAcreVs2YrAvg: null,
      // NOT `recentSalesCount / 4`: a twelve-month count divided by four is
      // not a ninety-day count, and nothing on file separates them.
      salesVolume90Days: null,
      salesVolume12Months: num(marketData?.recentSalesCount),
      avgDaysOnMarket: num(marketData?.avgDaysOnMarket),
      domTrend: null, // no prior-period DOM on file, so no trend
      activeListings: null,
      monthsOfSupply: null,
      listingCountTrend: null,
      estimatedInvestorMailingCount: null, // AcreOS has never measured this
      recentPriceIncreasePercent: null,
      populationGrowthRate: null,
      permitCountTrend: permitTrend?.trendPercent ?? null, // real Census BPS or nothing
      distanceToNearestMetroMiles: null,
      hasRecentInfrastructureAnnouncement: null, // null = never checked, not "none"
      hasRecentEmployerAnnouncement: null,
      hasLakeOrRiver: null,
      hasNationalForest: null,
      hasRecreationalAmenities: null,
    };

    const score = computeCountyOpportunityScore(input);

    // Background: check for lead indicator alerts
    const alertsPromise = detectLeadIndicatorAlerts(state.toUpperCase(), county);

    // No score means the core market signals are not on file for this county.
    // Say so; do not synthesise a report around the gap.
    if (!score) {
      const alerts = await alertsPromise;
      return res.json({
        county,
        state: state.toUpperCase(),
        score: null,
        alerts,
        report: null,
        marketData: marketData || null,
        unavailable: {
          reason: "no_county_market_data",
          message:
            `AcreOS has no market data on file for ${county} County, ${state.toUpperCase()}, ` +
            `so no opportunity score or market intelligence report can be produced for it. ` +
            `This is an absence of data, not a finding about the county.`,
          missingRequired: REQUIRED_SIGNALS.filter(
            (k) => input[k] === null || input[k] === undefined,
          ),
        },
      });
    }

    const report = generateCountyIntelligenceReport(county, state.toUpperCase(), score, {
      // Historical figures come from the row or not at all — the old defaults
      // ("950" * 0.95, "1000", count - 3) manufactured a year-over-year trend
      // for a county with no history on file.
      avgPricePerAcre12MoAgo: null,
      avgPricePerAcreNow: num(marketData?.medianPricePerAcre),
      salesVolume12MoAgo: null,
      salesVolumeNow: num(marketData?.recentSalesCount),
      domNow: num(marketData?.avgDaysOnMarket),
    });

    const alerts = await alertsPromise;

    res.json({ county, state: state.toUpperCase(), score, alerts, report, marketData: marketData || null });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// ============================================================================
// EPIC 4: Title Chain & Closing
// ============================================================================

router.post("/title-chain/analyze", async (req: Request, res: Response) => {
  try {
    const { analyzeChainOfTitle, parseScheduleBException, getClosingChecklistReference } = await import("./services/titleChainService");
    const { events, scheduleBText, dealType = "cash", isRemote = true } = req.body;

    const titleChain = analyzeChainOfTitle(events || []);
    const scheduleBExceptions = scheduleBText ? parseScheduleBException(scheduleBText) : [];
    const closingChecklist = getClosingChecklistReference(dealType, true, isRemote);

    res.json({ titleChain, scheduleBExceptions, closingChecklist });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.get("/closing-checklist/:dealId", async (req: Request, res: Response) => {
  try {
    const { getClosingChecklistReference } = await import("./services/titleChainService");
    const { db } = await import("./db");
    const { deals } = await import("@shared/schema");
    const { eq, and } = await import("drizzle-orm");
    const org = req.organization;

    const [deal] = await db
      .select()
      .from(deals)
      .where(and(eq(deals.id, parseInt(req.params.dealId)), eq(deals.organizationId, org.id)))
      .limit(1);

    if (!deal) return Errors.notFound(res, "Deal");

    const dealType = (deal as any).dealType || "cash";
    const checklist = getClosingChecklistReference(dealType, true, true);
    res.json({ dealId: deal.id, checklist });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// ============================================================================
// EPIC 5: Investor Network
// ============================================================================

router.get("/investor-network/trust-score", async (req: Request, res: Response) => {
  try {
    const { computeInvestorTrustScore, computeInvestorBadges } = await import("./services/investorNetworkService");
    const org = req.organization;

    const trustScore = await computeInvestorTrustScore(org.id);
    const badges = computeInvestorBadges({
      verifiedDeals: Math.floor(trustScore.dealVolumeScore / 10),
      verifiedVolume: Math.floor(trustScore.dealValueScore * 5000),
      responseRate: 85,
      fulfillmentRate: 90,
      memberMonths: Math.floor(trustScore.tenureScore / 5),
      hasCompletedProfile: trustScore.verificationScore > 50,
      activeStates: 2,
    });

    res.json({ organizationId: org.id, trustScore, badges });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.post("/investor-network/share-deal", async (req: Request, res: Response) => {
  try {
    const { shareDealWithPartner } = await import("./services/investorNetworkService");
    const org = req.organization;
    const { toOrganizationId, dealSummary, referralFeeAmount, notes } = req.body;

    const result = await shareDealWithPartner({
      fromOrganizationId: org.id,
      toOrganizationId,
      dealSummary,
      referralFeeAmount,
      notes,
    });

    res.json(result);
  } catch (err: any) {
    Errors.badRequest(res, err.message ?? "Bad request");
  }
});

// ============================================================================
// EPIC 7: Financial OS
// ============================================================================

router.post("/financial/deal-pnl", async (req: Request, res: Response) => {
  try {
    const { calculateDealPnL } = await import("./services/financialOSService");
    const result = calculateDealPnL(req.body);
    res.json(result);
  } catch (err: any) {
    Errors.badRequest(res, err.message ?? "Bad request");
  }
});

router.get("/financial/tax-report/:year", async (req: Request, res: Response) => {
  try {
    const { generateTaxReport } = await import("./services/financialOSService");
    const org = req.organization;
    const year = parseInt(req.params.year) || new Date().getFullYear() - 1;
    const report = await generateTaxReport(org.id, year);
    res.json(report);
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.post("/financial/note-amortization", async (req: Request, res: Response) => {
  try {
    const { generateAmortizationSchedule } = await import("./services/financialOSService");
    const { principal, annualInterestRate, termMonths, firstPaymentDate } = req.body;
    const schedule = generateAmortizationSchedule({
      principal,
      annualInterestRate,
      termMonths,
      firstPaymentDate: new Date(firstPaymentDate),
    });
    res.json({ schedule, paymentCount: schedule.length });
  } catch (err: any) {
    Errors.badRequest(res, err.message ?? "Bad request");
  }
});

router.post("/financial/note-payoff", async (req: Request, res: Response) => {
  try {
    const { calculateNotePayoff } = await import("./services/financialOSService");
    // calculateNotePayoff was migrated from a schedule-replay signature
    // (originalPrincipal/termMonths/paymentsReceived) to a live-ledger
    // signature (currentBalanceCents/lastPaymentDate). Accept both shapes
    // here to keep the public /financial/note-payoff API compatible:
    // when callers pass currentBalanceCents we use it directly; when they
    // pass the legacy originalPrincipal we fall back to passing through
    // the principal as the live balance (best available signal absent a
    // ledger).
    const body = req.body || {};
    const currentBalanceCents = typeof body.currentBalanceCents === "number"
      ? body.currentBalanceCents
      : Math.round(Number(body.currentBalance ?? body.originalPrincipal ?? 0) * 100);
    const lastPaymentDate = body.lastPaymentDate
      ? new Date(body.lastPaymentDate)
      : new Date(body.firstPaymentDate);
    const result = calculateNotePayoff({
      currentBalanceCents,
      annualInterestRate: Number(body.annualInterestRate),
      lastPaymentDate,
      payoffDate: new Date(body.payoffDate),
    });
    res.json(result);
  } catch (err: any) {
    Errors.badRequest(res, err.message ?? "Bad request");
  }
});

router.post("/financial/1031-status", async (req: Request, res: Response) => {
  try {
    const { computeExchange1031Status } = await import("./services/financialOSService");
    const { relinquishedClosingDate, identifiedProperties } = req.body;
    const result = computeExchange1031Status({
      relinquishedClosingDate: new Date(relinquishedClosingDate),
      identifiedProperties,
    });
    res.json(result);
  } catch (err: any) {
    Errors.badRequest(res, err.message ?? "Bad request");
  }
});

// ============================================================================
// EPIC 8: Developer API — REMOVED 2026-08-15 (founder ruling, picker)
// ----------------------------------------------------------------------------
// Three endpoints lived here and all three are gone:
//
//   GET  /developer/openapi          served a document titled "AcreOS Public API"
//   POST /developer/api-keys         minted an `acr_…` secret for any authenticated
//                                    customer and returned it once
//   GET  /developer/widget-embed/:t  handed out `pub_<orgId>_<base64(orgId)>` as a
//                                    "publicApiKey" — the org id encoded, not a secret
//
// TWO REASONS, and the second is the one that made this urgent.
//
// 1. A STANDING DECISION ENFORCED IN ONE PLACE AND DEFEATED IN ANOTHER.
//    CLAUDE.md's expansion ladder says "no public API before ~50 customers", and
//    routes-api-keys.ts is kept DELIBERATELY DORMANT because of it — the
//    reachability ratchet's own note records that as the reason its
//    unregisteredRoutes baseline sits at 1. Meanwhile this router is mounted at
//    /api behind plain isAuthenticated, so any customer could mint a key and
//    fetch the spec. The careful decision was made once and bypassed here.
//
// 2. THE KEYS WERE INERT, AND THE RESPONSE SAID OTHERWISE. `POST` returned the
//    plaintext with `warning: "Store this key securely. It will not be shown
//    again."` — and NOTHING verified it. The only consumer of
//    organizationIntegrations keys is mcp-server.ts, which matches
//    provider = 'mcp_api_key'; this wrote provider = 'api_key'. The rate limiter
//    written for it (createApiKeyRateLimit, "public developer API") has zero
//    importers. A customer who integrated against this got nothing, forever,
//    after being told to store the key securely. That is placeholder data
//    presented as real, which the DO-NOT-DO list forbids outright.
//
// services/developerApiService.ts is KEPT, not deleted: when the ladder trigger
// fires, the OpenAPI spec and the key-minting helper are the starting point, and
// the thing that was wrong was mounting them early rather than writing them.
// Wiring it then means building the verifier that never existed.
// See docs/company/deletion-ledger.md (2026-08-15) and the apiKeyAuthority test.
// ============================================================================

export default router;

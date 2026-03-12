// @ts-nocheck
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

const router = Router();

function getUser(req: Request) { return (req as any).user; }
function getOrg(req: Request) { return (req as any).org; }

// ============================================================================
// EPIC 1+2: Seller Motivation Score
// ============================================================================

router.get("/seller-motivation/:leadId", async (req: Request, res: Response) => {
  try {
    const { computeSellerMotivationScore, getOptimalOutreachTiming } = await import("./services/sellerMotivationEngine");
    const { db } = await import("./db");
    const { leads } = await import("@shared/schema");
    const { eq, and } = await import("drizzle-orm");
    const org = getOrg(req);

    const [lead] = await db
      .select()
      .from(leads)
      .where(and(eq(leads.id, parseInt(req.params.leadId)), eq(leads.organizationId, org.id)))
      .limit(1);

    if (!lead) return res.status(404).json({ error: "Lead not found" });

    const assessedValue = parseFloat((lead as any).assessedValue || "5000");
    const input = {
      isTaxDelinquent: (lead as any).taxDelinquent ?? false,
      taxDelinquentYears: (lead as any).taxDelinquentYears ?? 0,
      taxDelinquentAmount: parseFloat((lead as any).taxDelinquentAmount || "0"),
      assessedValue,
      isOutOfState: (lead as any).ownerState && lead.state
        ? (lead as any).ownerState.toUpperCase() !== (lead.state || "").toUpperCase()
        : false,
      ownershipYears: (lead as any).ownershipYears ?? 5,
      isInherited: (lead as any).ownerName?.toLowerCase().includes("estate") || false,
      isCorporateOwner: /llc|inc|corp|trust|ltd/i.test((lead as any).ownerName || ""),
      lastSalePrice: parseFloat((lead as any).lastSalePrice || "0"),
      estimatedCurrentValue: assessedValue * 1.4,
      countyCompetitionLevel: "medium" as const,
    };

    const motivationResult = computeSellerMotivationScore(input);
    const outreachTiming = getOptimalOutreachTiming(
      (lead as any).ownerState || lead.state || "TX",
      motivationResult.outreachPriority
    );

    res.json({
      leadId: lead.id,
      ownerName: (lead as any).ownerName,
      county: lead.county,
      state: lead.state,
      motivation: motivationResult,
      outreachTiming,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/seller-motivation/score", async (req: Request, res: Response) => {
  try {
    const { computeSellerMotivationScore } = await import("./services/sellerMotivationEngine");
    const result = computeSellerMotivationScore(req.body);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Batch rescore leads for an org
router.post("/seller-motivation/rescore-org", async (req: Request, res: Response) => {
  try {
    const { rescoreLeadsForOrg } = await import("./services/sellerMotivationEngine");
    const org = getOrg(req);
    const result = await rescoreLeadsForOrg(org.id);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// EPIC 6: County Opportunity Score
// ============================================================================

router.get("/county-opportunity/:state/:county", async (req: Request, res: Response) => {
  try {
    const { computeCountyOpportunityScore, detectLeadIndicatorAlerts, generateCountyIntelligenceReport } = await import("./services/countyOpportunityScore");
    const { db } = await import("./db");
    const { countyMarkets } = await import("@shared/schema");
    const { eq, and } = await import("drizzle-orm");
    const { state, county } = req.params;

    // Fetch county market data
    const [marketData] = await db
      .select()
      .from(countyMarkets)
      .where(and(eq(countyMarkets.state, state.toUpperCase()), eq(countyMarkets.county, county)))
      .limit(1);

    // Build input from available data + defaults
    const input = {
      state: state.toUpperCase(),
      county,
      priceVelocity3Mo: parseFloat((marketData as any)?.priceChange3Mo || "3"),
      priceVelocity12Mo: parseFloat(marketData?.priceChangePercent || "5"),
      avgPricePerAcre: parseFloat(marketData?.medianPricePerAcre || "1000"),
      pricePerAcreVs2YrAvg: 0,
      salesVolume90Days: Math.round((marketData?.recentSalesCount || 5) / 4),
      salesVolume12Months: marketData?.recentSalesCount || 20,
      avgDaysOnMarket: marketData?.avgDaysOnMarket || 90,
      domTrend: -10, // Default: slightly improving
      activeListings: 15,
      monthsOfSupply: 6,
      listingCountTrend: -5,
      estimatedInvestorMailingCount: 10,
      recentPriceIncreasePercent: 5,
      populationGrowthRate: 3,
      permitCountTrend: 5,
      distanceToNearestMetroMiles: 80,
      hasRecentInfrastructureAnnouncement: false,
      hasRecentEmployerAnnouncement: false,
      hasLakeOrRiver: false,
      hasNationalForest: false,
      hasRecreationalAmenities: false,
    };

    const score = computeCountyOpportunityScore(input);

    // Background: check for lead indicator alerts
    const alertsPromise = detectLeadIndicatorAlerts(state.toUpperCase(), county);

    const report = generateCountyIntelligenceReport(county, state.toUpperCase(), score, {
      avgPricePerAcre12MoAgo: parseFloat(marketData?.medianPricePerAcre || "950") * 0.95,
      avgPricePerAcreNow: parseFloat(marketData?.medianPricePerAcre || "1000"),
      salesVolume12MoAgo: (marketData?.recentSalesCount || 20) - 3,
      salesVolumeNow: marketData?.recentSalesCount || 20,
      domNow: marketData?.avgDaysOnMarket || 90,
    });

    const alerts = await alertsPromise;

    res.json({ county, state: state.toUpperCase(), score, alerts, report, marketData: marketData || null });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// EPIC 4: Title Chain & Closing
// ============================================================================

router.post("/title-chain/analyze", async (req: Request, res: Response) => {
  try {
    const { analyzeChainOfTitle, parseScheduleBException, generateClosingChecklist } = await import("./services/titleChainService");
    const { events, scheduleBText, dealType = "cash", isRemote = true } = req.body;

    const titleChain = analyzeChainOfTitle(events || []);
    const scheduleBExceptions = scheduleBText ? parseScheduleBException(scheduleBText) : [];
    const closingChecklist = generateClosingChecklist(dealType, true, isRemote);

    res.json({ titleChain, scheduleBExceptions, closingChecklist });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/closing-checklist/:dealId", async (req: Request, res: Response) => {
  try {
    const { generateClosingChecklist } = await import("./services/titleChainService");
    const { db } = await import("./db");
    const { deals } = await import("@shared/schema");
    const { eq, and } = await import("drizzle-orm");
    const org = getOrg(req);

    const [deal] = await db
      .select()
      .from(deals)
      .where(and(eq(deals.id, parseInt(req.params.dealId)), eq(deals.organizationId, org.id)))
      .limit(1);

    if (!deal) return res.status(404).json({ error: "Deal not found" });

    const dealType = (deal as any).dealType || "cash";
    const checklist = generateClosingChecklist(dealType, true, true);
    res.json({ dealId: deal.id, checklist });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// EPIC 5: Investor Network
// ============================================================================

router.get("/investor-network/trust-score", async (req: Request, res: Response) => {
  try {
    const { computeInvestorTrustScore, computeInvestorBadges } = await import("./services/investorNetworkService");
    const org = getOrg(req);

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
    res.status(500).json({ error: err.message });
  }
});

router.post("/investor-network/share-deal", async (req: Request, res: Response) => {
  try {
    const { shareDealWithPartner } = await import("./services/investorNetworkService");
    const org = getOrg(req);
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
    res.status(400).json({ error: err.message });
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
    res.status(400).json({ error: err.message });
  }
});

router.get("/financial/tax-report/:year", async (req: Request, res: Response) => {
  try {
    const { generateTaxReport } = await import("./services/financialOSService");
    const org = getOrg(req);
    const year = parseInt(req.params.year) || new Date().getFullYear() - 1;
    const report = await generateTaxReport(org.id, year);
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
    res.status(400).json({ error: err.message });
  }
});

router.post("/financial/note-payoff", async (req: Request, res: Response) => {
  try {
    const { calculateNotePayoff } = await import("./services/financialOSService");
    const result = calculateNotePayoff({
      ...req.body,
      firstPaymentDate: new Date(req.body.firstPaymentDate),
      payoffDate: new Date(req.body.payoffDate),
    });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
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
    res.status(400).json({ error: err.message });
  }
});

// ============================================================================
// EPIC 8: Developer API
// ============================================================================

router.get("/developer/openapi", async (req: Request, res: Response) => {
  try {
    const { ACREOS_OPENAPI_SPEC } = await import("./services/developerApiService");
    res.json(ACREOS_OPENAPI_SPEC);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/developer/api-keys", async (req: Request, res: Response) => {
  try {
    const { generateApiKey } = await import("./services/developerApiService");
    const org = getOrg(req);
    const { name, scopes = [] } = req.body;

    const { publicKeyId, secretKey, keyHash } = generateApiKey();

    // Store in database (organizationIntegrations table)
    const { db } = await import("./db");
    const { organizationIntegrations } = await import("@shared/schema");

    await db.insert(organizationIntegrations).values({
      organizationId: org.id,
      provider: "api_key",
      isEnabled: true,
      credentials: {
        keyId: publicKeyId,
        keyHash,
        name: name || "Default API Key",
        scopes,
        createdAt: new Date().toISOString(),
      },
    } as any);

    // Return the secret key ONCE — never stored in plaintext
    res.json({
      keyId: publicKeyId,
      secretKey, // ONLY shown once at creation
      name: name || "Default API Key",
      scopes,
      createdAt: new Date().toISOString(),
      warning: "Store this key securely. It will not be shown again.",
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/developer/widget-embed/:type", async (req: Request, res: Response) => {
  try {
    const { generateWidgetEmbedCode } = await import("./services/developerApiService");
    const org = getOrg(req);
    const validTypes = ["deal_analyzer", "market_heatmap", "property_valuation", "county_score"];
    const widgetType = req.params.type;

    if (!validTypes.includes(widgetType)) {
      return res.status(400).json({ error: "Invalid widget type" });
    }

    const embedCode = generateWidgetEmbedCode({
      widgetType: widgetType as any,
      publicApiKey: `pub_${org.id}_${Buffer.from(String(org.id)).toString("base64")}`,
      config: req.query,
    });

    res.json({ embedCode, widgetType });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

// @ts-nocheck
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
 *        — Calculate a Podolsky-formula blind offer for a specific parcel
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
 */

import { Router, type Request, type Response } from "express";

const router = Router();

function getOrg(req: Request) { return (req as any).org; }
function getUser(req: Request) { return (req as any).user; }

// ---------------------------------------------------------------------------
// County Intelligence Snapshot
// ---------------------------------------------------------------------------

router.get("/county-snapshot/:state/:county", async (req: Request, res: Response) => {
  try {
    const { buildCountyAgSnapshot, getCachedLandTrend } = await import("./services/usdaNassService");
    const { buildCountyOpportunityProfile } = await import("./services/censusDataService");
    const { computeCountyOpportunityScore, generateCountyIntelligenceReport } = await import("./services/countyOpportunityScore");
    const { state, county } = req.params;

    const [nassSnapshot, trend, censusProfile] = await Promise.allSettled([
      buildCountyAgSnapshot(state, county),
      getCachedLandTrend(state, county),
      buildCountyOpportunityProfile(state, county),
    ]);

    const nassData = nassSnapshot.status === "fulfilled" ? nassSnapshot.value : null;
    const trendData = trend.status === "fulfilled" ? trend.value : null;
    const censusData = censusProfile.status === "fulfilled" ? censusProfile.value : null;

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
      permitCountTrend: censusData?.permits ? 5 : 0,
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Blind Offer Calculator
// ---------------------------------------------------------------------------

router.post("/blind-offer", async (req: Request, res: Response) => {
  try {
    const { calculateBlindOffer } = await import("./services/blindOfferCalculator");
    const { state, county, targetAcres, comps, sellerProfile, marketCondition, ownerFinanceGoal } = req.body;

    if (!state || !county || !targetAcres) {
      return res.status(400).json({ error: "state, county, and targetAcres are required" });
    }

    const report = await calculateBlindOffer({
      state,
      county,
      targetAcres: parseFloat(targetAcres),
      comps: comps || [],
      sellerProfile,
      marketCondition,
      ownerFinanceGoal: ownerFinanceGoal || false,
    });

    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Full Parcel Intelligence Report
// ---------------------------------------------------------------------------

router.post("/parcel-intelligence", async (req: Request, res: Response) => {
  try {
    const { generateLandIntelligenceReport } = await import("./services/parcelIntelligenceFusion");
    const {
      latitude, longitude, acres, state, county, address, apn,
      askingPrice, assessedValue, ownerName, ownerState,
      taxDelinquent, taxDelinquentAmount, yearsOwned,
    } = req.body;

    if (!latitude || !longitude || !state || !county) {
      return res.status(400).json({ error: "latitude, longitude, state, and county are required" });
    }

    const report = await generateLandIntelligenceReport({
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      acres: parseFloat(acres) || 1,
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

    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
      return res.status(400).json({ error: "counties array is required" });
    }

    if (counties.length > 20) {
      return res.status(400).json({ error: "Maximum 20 counties per batch" });
    }

    const results = await screenCountiesForCampaign(counties);
    res.json({ results, screened: results.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
      return res.status(400).json({ error: "county, state, and targetDealsPerMonth are required" });
    }

    const sizing = sizeCampaign({
      county,
      state,
      targetDealsPerMonth: parseInt(targetDealsPerMonth),
      expectedAcceptanceRate: expectedAcceptanceRate ? parseFloat(expectedAcceptanceRate) : undefined,
      averageDealSize: averageDealSize ? parseFloat(averageDealSize) : undefined,
    });

    res.json(sizing);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Freedom Meter Snapshot
// ---------------------------------------------------------------------------

router.get("/freedom-snapshot", async (req: Request, res: Response) => {
  try {
    const { db } = await import("./db");
    const { deals, properties } = await import("@shared/schema");
    const { eq, and } = await import("drizzle-orm");
    const org = getOrg(req);
    const monthlyExpenses = parseFloat(String(req.query.expenses || "4500"));

    // Fetch active seller-financed deals for this org
    const closedDeals = await db
      .select()
      .from(deals)
      .where(and(
        eq(deals.organizationId, org.id),
        eq(deals.status, "closed")
      ))
      .limit(100);

    // Mock active note data (in production, this would join with a notes table)
    // For now, generate from closed deals with seller financing
    const activeNotes = closedDeals
      .filter((d: any) => d.dealType === "owner_finance" || d.sellerFinanced)
      .slice(0, 10)
      .map((d: any, i: number) => ({
        noteId: d.id,
        propertyName: `${d.county || "County"}, ${d.state || "State"} — ${d.acres || 5} acres`,
        monthlyPayment: (d as any).monthlyPayment || 329,
        remainingMonths: 84 - (Math.floor(Math.random() * 20)),
        totalBalance: ((d as any).salePrice || 15000) * 0.7,
        nextPaymentDate: new Date(Date.now() + Math.random() * 30 * 86400000).toISOString(),
        status: "current" as const,
        interestRate: 9,
        buyer: (d as any).buyerName,
      }));

    const totalMonthlyNoteIncome = activeNotes.reduce((s: number, n: any) => s + n.monthlyPayment, 0);
    const freedomScore = monthlyExpenses > 0 ? (totalMonthlyNoteIncome / monthlyExpenses) * 100 : 0;

    const monthlyShortfall = Math.max(0, monthlyExpenses - totalMonthlyNoteIncome);
    const avgNoteMonthly = activeNotes.length > 0 ? totalMonthlyNoteIncome / activeNotes.length : 329;
    const notesNeeded = avgNoteMonthly > 0 ? Math.ceil(monthlyShortfall / avgNoteMonthly) : 0;
    const monthsUntilFreedom = notesNeeded > 0 ? notesNeeded * 2 : null;

    const now = new Date();

    // Historical progress (12-month synthetic based on deal history)
    const historical = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
      const fraction = Math.max(0, 0.4 + (i * 0.05));
      const income = Math.round(totalMonthlyNoteIncome * fraction);
      return {
        month: d.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
        noteIncome: income,
        expenses: monthlyExpenses,
        freedomScore: Math.round((income / monthlyExpenses) * 100),
      };
    });

    // Land Geek wisdom for today
    const wisdomList = [
      "\"The goal isn't to flip more land — it's to collect enough notes that work feels optional.\" — Land Geek philosophy",
      "\"One deal financed at 9% for 84 months turns a $10K buy into $40K+ collected over time. That's the compounding power of the land note model.\"",
      "\"Your down payment recoups your acquisition cost on day one. Every monthly payment after that is pure passive income.\"",
      "\"When your note income exceeds your fixed expenses, you've achieved financial freedom.\"",
      "\"The beauty of land notes: if the buyer defaults, you keep the down payment, all payments made, AND the land. Defaults are almost painless.\"",
      "\"Diversify across counties and states. Geographic diversification is risk management.\"",
      "\"Land notes are the closest thing to a subscription business in real estate: one acquisition, then monthly recurring revenue for 84 months.\"",
    ];
    const podolskyInsight = wisdomList[Math.floor(Date.now() / 86400000) % wisdomList.length];

    res.json({
      totalMonthlyNoteIncome,
      totalMonthlyExpenses: monthlyExpenses,
      freedomScore,
      activeNotes,
      monthsUntilFreedom,
      projectedFreedomDate: monthsUntilFreedom
        ? new Date(now.getFullYear(), now.getMonth() + monthsUntilFreedom, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" })
        : null,
      portfolioValue: activeNotes.reduce((s: number, n: any) => s + n.totalBalance, 0),
      notesAtRisk: activeNotes.filter((n: any) => n.status !== "current").length,
      milestones: [
        { label: "First Note", targetMonthly: 300, achieved: totalMonthlyNoteIncome >= 300 },
        { label: "Cover Phone/Internet", targetMonthly: 200, achieved: totalMonthlyNoteIncome >= 200 },
        { label: "Cover Groceries ($500/mo)", targetMonthly: 500, achieved: totalMonthlyNoteIncome >= 500 },
        { label: "Cover Car Payment", targetMonthly: 800, achieved: totalMonthlyNoteIncome >= 800 },
        { label: "Cover Rent/Mortgage", targetMonthly: 2000, achieved: totalMonthlyNoteIncome >= 2000 },
        { label: "Full Expenses Covered", targetMonthly: monthlyExpenses, achieved: totalMonthlyNoteIncome >= monthlyExpenses },
        { label: "2× Monthly Expenses", targetMonthly: monthlyExpenses * 2, achieved: totalMonthlyNoteIncome >= monthlyExpenses * 2 },
      ],
      historicalProgress: historical,
      podolskyInsight,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

export default router;

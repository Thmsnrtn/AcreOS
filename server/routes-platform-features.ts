/**
 * Unified route registration for platform completion features:
 * - Financial depth (portfolio PDF, cash flow waterfall, opportunity cost, QBO)
 * - Compliance (AML, disclosures, SOL, RESPA)
 * - ML calibration, benchmarks, anomalies
 * - Behavioral retention (personal bests, monthly review)
 * - Ecosystem (Google Calendar, Drive, webhooks)
 */

import type { Express } from "express";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { storage, db } from "./storage";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { sql, eq, desc } from "drizzle-orm";
import { countyReviews } from "@shared/schema";
import { z } from "zod";

export function registerPlatformFeatureRoutes(app: Express): void {

  // ─── Financial Depth ──────────────────────────────────────────────

  // Portfolio Summary PDF
  app.get("/api/finance/portfolio-summary-pdf", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { generatePortfolioPdf } = await import("./services/reportPdfService");

      const notes = await storage.getNotes(org.id);
      const deals = await storage.getDeals(org.id);
      const properties = await storage.getProperties(org.id);

      // Build summary data
      const totalNotes = notes.length;
      const totalOutstanding = notes.reduce((s, n: any) => s + parseFloat(n.currentBalance || "0"), 0);
      const avgRate = totalNotes > 0
        ? notes.reduce((s, n: any) => s + parseFloat(n.interestRate || "0"), 0) / totalNotes
        : 0;

      const closedDeals = deals.filter(d => d.status === "closed");
      const thisYearStart = new Date(new Date().getFullYear(), 0, 1);
      const closedThisYear = closedDeals.filter((d: any) => d.updatedAt && new Date(d.updatedAt) >= thisYearStart);
      const portfolioValue = properties.reduce((s: number, p: any) => s + (Number(p.marketValue) || 0), 0);
      const totalAcquired = properties.reduce((s: number, p: any) => s + (Number(p.purchasePrice) || 0), 0);
      const monthlyIncome = notes.reduce((s, n: any) => s + parseFloat(n.monthlyPayment || "0"), 0);

      const data = {
        orgName: org.name || "Organization",
        organizationId: org.id,
        totalProperties: properties.length,
        activeDeals: deals.filter(d => d.status !== "closed" && d.status !== "cancelled").length,
        closedDealsThisYear: closedThisYear.length,
        portfolioValue,
        totalAcquiredCost: totalAcquired,
        totalEquity: Math.max(0, portfolioValue - totalAcquired),
        notesReceivableBalance: totalOutstanding,
        monthlyNoteIncome: monthlyIncome,
        avgCocReturn: avgRate,
        topMarkets: [],
        pipelineByStage: [],
      };

      const pdfBuffer = await generatePortfolioPdf(data);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", "attachment; filename=portfolio-summary.pdf");
      res.send(Buffer.from(pdfBuffer));
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // Cash Flow Waterfall data
  app.get("/api/finance/cash-flow-waterfall", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const notes = await storage.getNotes(org.id);

      if (notes.length === 0) {
        return res.json([]);
      }

      // Generate 7 months of waterfall data (6 trailing + current)
      const months: any[] = [];
      const now = new Date();

      for (let i = 6; i >= 0; i--) {
        const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const monthLabel = date.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
        const grossDue = notes.reduce((s, n: any) => s + parseFloat(n.monthlyPayment || "0"), 0);

        // Simulated collection rate based on delinquency
        const currentNotes = notes.filter((n: any) => n.delinquencyStatus === "current" || !n.delinquencyStatus);
        const collectionRate = notes.length > 0 ? currentNotes.length / notes.length : 1;

        months.push({
          month: monthLabel,
          grossDue: Math.round(grossDue),
          collected: Math.round(grossDue * collectionRate),
          lateFees: Math.round(grossDue * (1 - collectionRate) * 0.05),
          servicingCosts: 0,
          netCashFlow: Math.round(grossDue * collectionRate),
        });
      }

      res.json(months);
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // Opportunity cost analysis
  app.get("/api/deals/:id/opportunity-cost", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const dealId = Number(req.params.id);
      const deal = await storage.getDeal(org.id, dealId);
      if (!deal) return Errors.notFound(res, "Deal");

      // Get portfolio average ROI
      const { getPortfolioPnl } = await import("./services/portfolioPnl");
      let portfolioAvgRoi = 0;
      try {
        const pnl = await getPortfolioPnl(org.id, "quarterly");
        portfolioAvgRoi = pnl?.totals?.irr || 0;
      } catch {}

      const riskFreeRate = 5.0; // Default, could be org setting
      const investmentAmount = parseFloat(deal.offerAmount || deal.acceptedAmount || "0");
      const projectedReturn = (deal as any).analysisResults?.annualizedRoi || 0;
      const projectedAnnualIncome = investmentAmount * (projectedReturn / 100);
      const riskFreeAnnualIncome = investmentAmount * (riskFreeRate / 100);

      res.json({
        portfolioAvgRoi: Math.round(portfolioAvgRoi * 10) / 10,
        dealRoi: Math.round(projectedReturn * 10) / 10,
        roiSpread: Math.round((projectedReturn - portfolioAvgRoi) * 10) / 10,
        riskFreeRate,
        riskFreeAnnualIncome: Math.round(riskFreeAnnualIncome),
        projectedAnnualIncome: Math.round(projectedAnnualIncome),
        spreadOverRiskFree: Math.round(projectedAnnualIncome - riskFreeAnnualIncome),
        investmentAmount: Math.round(investmentAmount),
      });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // QuickBooks connect
  app.get("/api/integrations/quickbooks/connect", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      if (!process.env.QBO_CLIENT_ID) {
        return res.status(503).json({
          error: "integration_not_configured",
          message: "QuickBooks integration is not enabled on this deployment (QBO_CLIENT_ID is not set).",
          statusCode: 503,
        });
      }
      const org = req.organization;
      const { getQboOAuthUrl } = await import("./services/bookkeeping");
      const url = getQboOAuthUrl(org.id);
      res.json({ url });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // QuickBooks callback
  app.get("/api/integrations/quickbooks/callback", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { code, realmId } = req.query;

      if (!code || !realmId) {
        return Errors.badRequest(res, "Missing authorization code or realm ID");
      }

      // Store tokens (simplified — in prod, exchange code for tokens via Intuit OAuth)
      await db.execute(sql`
        INSERT INTO organization_integrations (organization_id, provider, credentials, is_active, created_at)
        VALUES (${org.id}, 'quickbooks', ${JSON.stringify({ code, realmId, connectedAt: new Date().toISOString() })}, true, NOW())
        ON CONFLICT (organization_id, provider) DO UPDATE SET
          credentials = EXCLUDED.credentials, is_active = true
      `);

      res.redirect("/settings/integrations?connected=quickbooks");
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // QuickBooks sync
  app.post("/api/integrations/quickbooks/sync", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { syncPaymentsToQbo } = await import("./services/bookkeeping");
      if (typeof syncPaymentsToQbo !== "function") {
        return Errors.badRequest(res, "QuickBooks sync not available");
      }
      const result = await syncPaymentsToQbo(org.id);
      res.json(result);
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // ─── Compliance Evolution ─────────────────────────────────────────

  // AML check for a deal
  app.get("/api/deals/:id/aml-check", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const dealId = Number(req.params.id);
      const deal = await storage.getDeal(org.id, dealId);
      if (!deal) return Errors.notFound(res, "Deal");

      const { checkDealAmlPatterns } = await import("./services/amlMonitor");
      const price = parseFloat(deal.acceptedAmount || deal.offerAmount || "0");
      const flags = await checkDealAmlPatterns(org.id, dealId, price);

      res.json({ flags, count: flags.length });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // State disclosures
  app.get("/api/compliance/disclosures/:state", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const state = req.params.state.toUpperCase();
      const disclosures = getRequiredDisclosures(state);
      res.json({ state, disclosures });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // Statute of limitations lookup
  app.get("/api/compliance/sol/:state", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const state = req.params.state.toUpperCase();
      const years = DEBT_COLLECTION_SOL[state] || 6;
      res.json({ state, years, source: DEBT_COLLECTION_SOL[state] ? "statute" : "default" });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // ─── ML Calibration ──────────────────────────────────────────────

  // Run calibration (admin/scheduled)
  app.post("/api/ml/calibrate", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { runWeeklyCalibration } = await import("./services/modelCalibration");
      const result = await runWeeklyCalibration();
      res.json(result);
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // Platform benchmarks
  app.get("/api/platform/benchmarks", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      // Check org count threshold
      const orgCount = await db.execute(sql`SELECT COUNT(*) as count FROM organizations`);
      const count = parseInt((orgCount.rows?.[0] as any)?.count || "0");

      if (count < 25) {
        return res.json({ available: false });
      }

      // Compute anonymized benchmarks
      const dealStats = await db.execute(sql`
        SELECT
          AVG(CAST(accepted_amount AS DECIMAL) - CAST(offer_amount AS DECIMAL)) as avg_profit,
          AVG(EXTRACT(DAY FROM (closing_date::timestamp - offer_date::timestamp))) as avg_days
        FROM deals
        WHERE status = 'closed' AND accepted_amount IS NOT NULL AND offer_amount IS NOT NULL
      `);

      const row = dealStats.rows?.[0] as any;

      res.json({
        available: true,
        avgProfitPerDeal: Math.round(parseFloat(row?.avg_profit || "0")),
        avgDaysToClose: Math.round(parseFloat(row?.avg_days || "0")),
      });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // ─── Behavioral Retention ────────────────────────────────────────

  // Personal bests
  app.get("/api/personal-bests", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { checkPersonalBests } = await import("./services/personalBests");

      // Get latest closed deal to check bests
      const deals = await storage.getDeals(org.id);
      const closedDeals = deals
        .filter(d => d.status === "closed")
        .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());

      if (closedDeals.length === 0) {
        return res.json({ bests: [] });
      }

      // Check bests for the most recent deal
      const latest = closedDeals[0];
      const profit = parseFloat(latest.acceptedAmount || "0") - parseFloat(latest.offerAmount || "0");
      const daysToClose = latest.closingDate && latest.offerDate
        ? Math.ceil((new Date(latest.closingDate).getTime() - new Date(latest.offerDate).getTime()) / 86400000)
        : 0;

      const bests = await checkPersonalBests(org.id, latest.id, profit, daysToClose);
      res.json({ bests });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // ─── Google Integration ──────────────────────────────────────────

  // Google OAuth connect
  app.get("/api/integrations/google/connect", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { getGoogleOAuthUrl } = await import("./services/googleCalendarSync");
      const redirectUri = `${req.protocol}://${req.get("host")}/api/integrations/google/callback`;
      const state = String(req.organization.id);
      const url = getGoogleOAuthUrl(redirectUri, state);

      if (!url) {
        return Errors.badRequest(res, "Google integration not configured. Set GOOGLE_CLIENT_ID in environment.");
      }

      res.json({ url });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // Google OAuth callback
  app.get("/api/integrations/google/callback", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { code } = req.query;

      if (!code) return Errors.badRequest(res, "Missing authorization code");

      const { exchangeGoogleCode } = await import("./services/googleCalendarSync");
      const redirectUri = `${req.protocol}://${req.get("host")}/api/integrations/google/callback`;
      const tokens = await exchangeGoogleCode(String(code), redirectUri);

      if (!tokens) {
        return Errors.badRequest(res, "Failed to exchange Google authorization code");
      }

      await db.execute(sql`
        INSERT INTO organization_integrations (organization_id, provider, credentials, is_active, created_at)
        VALUES (${org.id}, 'google', ${JSON.stringify(tokens)}, true, NOW())
        ON CONFLICT (organization_id, provider) DO UPDATE SET
          credentials = EXCLUDED.credentials, is_active = true
      `);

      res.redirect("/settings/integrations?connected=google");
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // ─── Content Evolution ──────────────────────────────────────────

  app.post("/api/evolution/subject-lines/:campaignId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const campaignId = Number(req.params.campaignId);
      const { evolveSubjectLines } = await import("./services/contentEvolution");
      const result = await evolveSubjectLines(org.id, campaignId);
      res.json(result);
    } catch (error) { Errors.internal(res, error); }
  });

  app.get("/api/evolution/pax-quality", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { analyzePaxResponseQuality } = await import("./services/contentEvolution");
      const metrics = await analyzePaxResponseQuality(org.id);
      res.json(metrics);
    } catch (error) { Errors.internal(res, error); }
  });

  app.get("/api/evolution/domain-whitelist", isAuthenticated, async (req, res) => {
    try {
      const { getDomainWhitelist } = await import("./services/contentEvolution");
      res.json(getDomainWhitelist());
    } catch (error) { Errors.internal(res, error); }
  });

  // ─── Community Intelligence ────────────────────────────────────────

  // County intelligence — combines network data with community reviews
  app.get("/api/county-intelligence/:state/:county", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const state = req.params.state;
      const county = req.params.county;

      // Get network data for this county
      const { getCountyIntelligenceOverview } = await import("./services/dataNetworkVisibility");
      const networkOverview = await getCountyIntelligenceOverview(org.id);
      const countyData = networkOverview.counties?.find(
        (c: any) => c.state?.toUpperCase() === state.toUpperCase() && c.county?.toUpperCase() === county.toUpperCase()
      ) || null;

      // Get community reviews for this county
      const { getCountyReviews } = await import("./services/communityIntelligence");
      const allReviews = await getCountyReviews(state);
      const countyReviewsList = allReviews.filter(
        (r: any) => r.county?.toUpperCase() === county.toUpperCase()
      );

      // Get LCS benchmarks if available
      const { getLcsBenchmarks } = await import("./services/dataNetworkVisibility");
      const benchmarks = await getLcsBenchmarks(org.id);

      res.json({
        state,
        county,
        networkData: countyData,
        reviews: countyReviewsList,
        avgRating: countyReviewsList.length > 0
          ? Math.round(countyReviewsList.reduce((s: number, r: any) => s + (r.rating || 0), 0) / countyReviewsList.length * 10) / 10
          : null,
        reviewCount: countyReviewsList.length,
        lcsBenchmarks: benchmarks,
        hasSufficientData: (countyData?.dealCount || 0) >= 5,
      });
    } catch (error) { Errors.internal(res, error); }
  });

  app.get("/api/community/county-reviews", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const state = req.query.state ? String(req.query.state) : undefined;
      const { getCountyReviews } = await import("./services/communityIntelligence");
      const baseReviews = await getCountyReviews(state);

      // Enrich with reviewer trust score and verified deal count from DB reviews
      const dbReviews = await db.select().from(countyReviews)
        .orderBy(desc(countyReviews.createdAt))
        .limit(100);

      const enrichedDbReviews = dbReviews.map(r => ({
        state: r.state,
        county: r.county,
        rating: r.rating,
        pros: r.pros,
        cons: r.cons,
        investorTrustScore: r.investorTrustScore ?? 0,
        verifiedDeals: r.verifiedDeals ?? 0,
        createdAt: r.createdAt,
      }));

      res.json({ reviews: [...enrichedDbReviews, ...baseReviews] });
    } catch (error) { Errors.internal(res, error); }
  });

  app.post("/api/community/county-reviews", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;

      const bodySchema = z.object({
        state: z.string().min(1),
        county: z.string().min(1),
        rating: z.number().int().min(1).max(5),
        pros: z.string().min(1),
        cons: z.string().min(1),
      });

      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.errors);
      }

      // Compute trust score — require > 300 to post
      const { computeInvestorTrustScore } = await import("./services/investorNetworkService");
      const trustResult = await computeInvestorTrustScore(org.id);

      if (trustResult.total <= 300) {
        return Errors.forbidden(res, "Trust score must be greater than 300 to submit county reviews. Current score: " + trustResult.total);
      }

      // Count verified deals for the reviewer
      const { count } = await import("drizzle-orm");
      const { deals } = await import("@shared/schema");
      const [dealCount] = await db.select({ cnt: count() }).from(deals)
        .where(eq(deals.organizationId, org.id));
      const verifiedDealCount = Number(dealCount?.cnt || 0);

      const [review] = await db.insert(countyReviews).values({
        organizationId: org.id,
        state: parsed.data.state,
        county: parsed.data.county,
        rating: parsed.data.rating,
        pros: parsed.data.pros,
        cons: parsed.data.cons,
        investorTrustScore: trustResult.total,
        verifiedDeals: verifiedDealCount,
      }).returning();

      logger.info("county_review_created", {
        organizationId: org.id,
        state: parsed.data.state,
        county: parsed.data.county,
        trustScore: trustResult.total,
      });

      res.json({ review });
    } catch (error) { Errors.internal(res, error); }
  });

  app.get("/api/community/case-studies", isAuthenticated, async (req, res) => {
    try {
      const limit = Number(req.query.limit) || 10;
      const { getAnonymizedCaseStudies } = await import("./services/communityIntelligence");
      const studies = await getAnonymizedCaseStudies(limit);
      res.json({ studies });
    } catch (error) { Errors.internal(res, error); }
  });

  app.get("/api/community/mentor-matches", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { findMentorMatches } = await import("./services/communityIntelligence");
      const matches = await findMentorMatches(org.id);
      res.json({ matches });
    } catch (error) { Errors.internal(res, error); }
  });

  app.get("/api/community/achievements", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { getAchievements } = await import("./services/communityIntelligence");
      const achievements = await getAchievements(org.id);
      res.json({ achievements });
    } catch (error) { Errors.internal(res, error); }
  });

  // ─── Pipeline Intelligence ─────────────────────────────────────────

  app.get("/api/pipeline/throughput", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const days = Number(req.query.days) || 90;
      const { analyzeThroughput } = await import("./services/pipelineIntelligence");
      const metrics = await analyzeThroughput(org.id, days);
      res.json(metrics);
    } catch (error) { Errors.internal(res, error); }
  });

  app.get("/api/pipeline/disposition/:dealId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const dealId = Number(req.params.dealId);
      const { recommendDisposition } = await import("./services/pipelineIntelligence");
      const recommendations = await recommendDisposition(org.id, dealId);
      res.json({ recommendations });
    } catch (error) { Errors.internal(res, error); }
  });

  app.get("/api/pipeline/attribution", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { computeAttributionROI } = await import("./services/pipelineIntelligence");
      const attribution = await computeAttributionROI(org.id);
      res.json({ attribution });
    } catch (error) { Errors.internal(res, error); }
  });

  // ─── Data Portability ──────────────────────────────────────────────

  app.post("/api/export/full", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const exportId = `export_${org.id}_${Date.now()}`;

      // Generate synchronously and return the data inline
      const { generateFullExport } = await import("./services/dataPortability");
      const data = await generateFullExport(org.id);

      logger.info("full_export_generated", { organizationId: org.id, exportId });

      res.json({
        exportId,
        status: "ready",
        downloadUrl: "/api/data/export",
        data,
      });
    } catch (error) { Errors.internal(res, error); }
  });

  app.get("/api/export/status/:exportId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const exportId = req.params.exportId;
      // Since we generate synchronously, status is always ready
      res.json({
        exportId,
        status: "ready",
        downloadUrl: "/api/data/export",
      });
    } catch (error) { Errors.internal(res, error); }
  });

  app.get("/api/data/export", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { generateFullExport } = await import("./services/dataPortability");
      const data = await generateFullExport(org.id);
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="acreos-export-${org.id}-${Date.now()}.json"`);
      res.json(data);
    } catch (error) { Errors.internal(res, error); }
  });

  app.get("/api/data/contribution-report", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { generateContributionReport } = await import("./services/dataPortability");
      const report = await generateContributionReport(org.id);
      res.json(report);
    } catch (error) { Errors.internal(res, error); }
  });

  // ─── Environmental Intelligence ─────────────────────────────────

  app.get("/api/environmental/water-rights/:state", isAuthenticated, async (req, res) => {
    try {
      const { getWaterRightsInfo } = await import("./services/environmentalIntelligence");
      res.json(getWaterRightsInfo(req.params.state));
    } catch (error) { Errors.internal(res, error); }
  });

  app.get("/api/environmental/mineral-rights/:state", isAuthenticated, async (req, res) => {
    try {
      const { getMineralRightsInfo } = await import("./services/environmentalIntelligence");
      res.json(getMineralRightsInfo(req.params.state));
    } catch (error) { Errors.internal(res, error); }
  });

  app.get("/api/environmental/carbon-credits", isAuthenticated, async (req, res) => {
    try {
      const state = String(req.query.state || "TX");
      const acres = Number(req.query.acres || 0);
      const landType = req.query.landType ? String(req.query.landType) : undefined;
      const { estimateCarbonCredits } = await import("./services/environmentalIntelligence");
      res.json(estimateCarbonCredits(state, acres, landType));
    } catch (error) { Errors.internal(res, error); }
  });

  app.get("/api/environmental/climate-risk", isAuthenticated, async (req, res) => {
    try {
      const state = String(req.query.state || "TX");
      const county = req.query.county ? String(req.query.county) : undefined;
      const { assessClimateRisk } = await import("./services/environmentalIntelligence");
      res.json(assessClimateRisk(state, county));
    } catch (error) { Errors.internal(res, error); }
  });

  app.post("/api/environmental/highest-best-use", isAuthenticated, async (req, res) => {
    try {
      const { analyzeHighestBestUse } = await import("./services/environmentalIntelligence");
      res.json(analyzeHighestBestUse(req.body));
    } catch (error) { Errors.internal(res, error); }
  });

  // ─── Entity Portfolio ──────────────────────────────────────────────

  app.get("/api/portfolio/entities", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { getEntities } = await import("./services/entityPortfolio");
      const entities = await getEntities(org.id);
      res.json({ entities });
    } catch (error) { Errors.internal(res, error); }
  });

  app.get("/api/portfolio/by-entity", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const entityName = req.query.entity ? String(req.query.entity) : undefined;
      const { getPortfolioByEntity } = await import("./services/entityPortfolio");
      const portfolio = await getPortfolioByEntity(org.id, entityName);
      res.json(portfolio);
    } catch (error) { Errors.internal(res, error); }
  });

  app.get("/api/portfolio/entity-tax-summary", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { getEntityTaxSummary } = await import("./services/entityPortfolio");
      const summary = await getEntityTaxSummary(org.id);
      res.json(summary);
    } catch (error) { Errors.internal(res, error); }
  });

  app.get("/api/portfolio/opportunity-zones", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { checkOpportunityZones } = await import("./services/entityPortfolio");
      const zones = await checkOpportunityZones(org.id);
      res.json(zones);
    } catch (error) { Errors.internal(res, error); }
  });

  // ─── Legal Intelligence ────────────────────────────────────────────

  app.get("/api/legal/adverse-possession/:state", isAuthenticated, async (req, res) => {
    try {
      const { getAdversePossessionInfo } = await import("./services/legalIntelligence");
      res.json(getAdversePossessionInfo(req.params.state));
    } catch (error) { Errors.internal(res, error); }
  });

  app.post("/api/legal/partition-risk", isAuthenticated, async (req, res) => {
    try {
      const { ownerCount, ownership, hasHeirs, isInherited } = req.body;
      const { assessPartitionRisk } = await import("./services/legalIntelligence");
      res.json(assessPartitionRisk(ownerCount || 1, ownership || "unknown", hasHeirs, isInherited));
    } catch (error) { Errors.internal(res, error); }
  });

  app.get("/api/legal/tax-lien-context/:state", isAuthenticated, async (req, res) => {
    try {
      const { getTaxLienContext } = await import("./services/legalIntelligence");
      res.json(getTaxLienContext(req.params.state));
    } catch (error) { Errors.internal(res, error); }
  });

  app.post("/api/legal/respa-check", isAuthenticated, async (req, res) => {
    try {
      const { isSellerFinanced, hasMortgage, isResidential, numberOfUnits } = req.body;
      const { checkRespaApplicability } = await import("./services/legalIntelligence");
      res.json(checkRespaApplicability(!!isSellerFinanced, !!hasMortgage, !!isResidential, numberOfUnits));
    } catch (error) { Errors.internal(res, error); }
  });

  // ─── Data Network Visibility ─────────────────────────────────────

  app.get("/api/data-network/overview", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { getCountyIntelligenceOverview } = await import("./services/dataNetworkVisibility");
      const overview = await getCountyIntelligenceOverview(org.id);
      res.json(overview);
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  app.get("/api/data-network/contribution", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { getDataContributionMetrics } = await import("./services/dataNetworkVisibility");
      const metrics = await getDataContributionMetrics(org.id);
      res.json(metrics);
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  app.get("/api/data-network/lcs-benchmarks", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { getLcsBenchmarks } = await import("./services/dataNetworkVisibility");
      const benchmarks = await getLcsBenchmarks(org.id);
      res.json({ benchmarks });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // ─── Pax Relationship Arc ────────────────────────────────────────

  app.get("/api/pax/relationship", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { getRelationshipState, getStageBehavior } = await import("./services/paxRelationshipArc");
      const state = await getRelationshipState(org.id);
      const behavior = getStageBehavior(state.stage);
      res.json({ ...state, behavior });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // Record Pax interaction (called from Atlas chat)
  app.post("/api/pax/interaction", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { recordPaxInteraction } = await import("./services/paxRelationshipArc");
      await recordPaxInteraction(org.id);
      res.json({ ok: true });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // ─── Trust Scores → Platform Surfaces ────────────────────────────

  // Get trust profile for current org (marketplace, shared links, PDFs)
  app.get("/api/trust/profile", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { computeInvestorTrustScore, computeInvestorBadges } = await import("./services/investorNetworkService");
      const trustProfile = await computeInvestorTrustScore(org.id);

      // computeInvestorBadges expects a profile shape; derive it from the score components.
      // We don't have verified deal counts surfaced yet — pass conservative defaults so
      // we still return a valid response instead of 500ing.
      const badges = computeInvestorBadges({
        verifiedDeals: 0,
        verifiedVolume: 0,
        responseRate: 0,
        fulfillmentRate: 0,
        memberMonths: 0,
        hasCompletedProfile: trustProfile.tenureScore > 0,
        activeStates: 0,
      });

      const tier = trustProfile.tier;
      const total = trustProfile.total;
      const components = {
        dealVolumeScore: trustProfile.dealVolumeScore,
        dealValueScore: trustProfile.dealValueScore,
        responseRateScore: trustProfile.responseRateScore,
        fulfillmentRateScore: trustProfile.fulfillmentRateScore,
        tenureScore: trustProfile.tenureScore,
        peerReviewScore: trustProfile.peerReviewScore,
        verificationScore: trustProfile.verificationScore,
      };

      res.json({
        score: total,
        tier,
        components,
        badges,
        achievementProgress: {
          nextTier: tier === "platinum" ? null
            : tier === "gold" ? "platinum"
            : tier === "silver" ? "gold"
            : tier === "bronze" ? "silver"
            : "bronze",
          pointsNeeded: tier === "platinum" ? 0
            : tier === "gold" ? 800 - total
            : tier === "silver" ? 600 - total
            : tier === "bronze" ? 400 - total
            : 200 - total,
        },
      });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // ─── Seller Psychology → Negotiation ─────────────────────────────

  // Get motivation profile + strategy recommendation for a lead
  app.get("/api/leads/:id/motivation-profile", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const leadId = Number(req.params.id);
      const { buildMotivationProfile, selectNegotiationStrategy, recommendOfferTier } = await import("./services/sellerPsychologyStrategy");

      const profile = await buildMotivationProfile(org.id, leadId);
      if (!profile) return res.json({ available: false, message: "No seller intent prediction available for this lead." });

      const strategy = selectNegotiationStrategy(profile);
      const offerTier = recommendOfferTier(profile);

      res.json({ available: true, profile, strategy, offerTier });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // Get motivation signals for Deal Feed
  app.post("/api/deals/motivation-signals", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { dealIds } = req.body as { dealIds?: number[] };
      if (!dealIds || !Array.isArray(dealIds)) return Errors.badRequest(res, "dealIds array required");

      const { getDealFeedMotivationSignals } = await import("./services/sellerPsychologyStrategy");
      const signals = await getDealFeedMotivationSignals(org.id, dealIds.slice(0, 50));
      res.json({ signals });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // ─── Calibration Loop ────────────────────────────────────────────

  // Full calibration report (LCS, confidence intervals, backtest, seller intent, radar)
  app.get("/api/ml/calibration-report", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { runFullCalibration } = await import("./services/outcomeCalibrationLoop");
      const report = await runFullCalibration(org.id);
      res.json(report);
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // Record deal outcome for calibration (called on deal close)
  app.post("/api/ml/record-outcome", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { dealId, outcome } = req.body as { dealId?: number; outcome?: "won" | "lost" };
      if (!dealId || !outcome) return Errors.badRequest(res, "dealId and outcome required");

      const { onDealClosed } = await import("./services/outcomeCalibrationLoop");
      await onDealClosed(org.id, dealId, outcome);
      res.json({ ok: true });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // Confidence intervals for LCS dimensions
  app.get("/api/ml/confidence-intervals", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { computeConfidenceIntervals } = await import("./services/outcomeCalibrationLoop");
      const intervals = await computeConfidenceIntervals(org.id);
      res.json({ intervals });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // Backtest accuracy
  app.get("/api/ml/backtest", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { runBacktestAccuracy } = await import("./services/outcomeCalibrationLoop");
      const result = await runBacktestAccuracy(org.id);
      res.json(result);
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // ─── LCS Accuracy + Calibration Triggers ─────────────────────────

  // Land Credit Score accuracy report with current weights
  app.get("/api/land-credit/accuracy", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { runBacktestAccuracy } = await import("./services/outcomeCalibrationLoop");
      const { getCurrentWeights } = await import("./services/lcsCalibrator");

      const backtest = await runBacktestAccuracy(org.id);
      const { weights, lastUpdated } = getCurrentWeights(org.id);

      const sampleSize = backtest.totalPredictions || 0;
      if (sampleSize < 20) {
        return res.json({
          sampleSize,
          message: "Insufficient data for accuracy report. Need 20+ closed deals with LCS scores.",
        });
      }

      res.json({
        sampleSize,
        avgError: backtest.calibrationError,
        accuracyByRange: backtest.bucketAccuracy,
        defaultRateByRange: backtest.bucketAccuracy.map((b: any) => ({
          bucket: b.bucket,
          rate: b.accuracy,
        })),
        weights,
        lastUpdated,
      });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // Trigger LCS weight calibration
  app.post("/api/calibration/lcs", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { runLcsCalibration } = await import("./services/lcsCalibrator");
      const result = await runLcsCalibration(org.id);
      res.json(result);
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // Trigger seller intent weight calibration
  app.post("/api/calibration/seller-intent", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { sellerIntentPredictorService } = await import("./services/sellerIntentPredictor");
      await sellerIntentPredictorService.calibrateWeights(org.id);
      res.json({ ok: true, message: "Seller intent weights calibrated." });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // Trigger radar weight calibration
  app.post("/api/calibration/radar", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { acquisitionRadar } = await import("./services/acquisitionRadar");
      await acquisitionRadar.calibrateRadarWeights(org.id);
      res.json({ ok: true, message: "Radar weights calibrated." });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // ─── Credit Benchmarking ─────────────────────────────────────────

  // Compare LCS to industry benchmarks for a property
  app.get("/api/land-credit/benchmark/:propertyId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const propertyId = Number(req.params.propertyId);
      const { CreditBenchmarkingService } = await import("./services/creditBenchmarking");
      const benchmarking = new CreditBenchmarkingService();

      // Get property's LCS and state/type
      const { landCreditScores, properties } = await import("@shared/schema");
      const { eq, desc } = await import("drizzle-orm");
      const [score] = await db.select().from(landCreditScores)
        .where(eq(landCreditScores.propertyId, propertyId))
        .orderBy(desc(landCreditScores.createdAt)).limit(1);
      const [property] = await db.select().from(properties)
        .where(eq(properties.id, propertyId)).limit(1);

      if (!score || !property) return Errors.notFound(res, "Property or LCS");

      const state = property.state || "TX";
      const propertyType = (property as any).zoning || "agricultural";
      const comparison = benchmarking.compareToIndustry(score.overall ?? 0, propertyType, state);
      const benchmarks = benchmarking.getBenchmarks(propertyType, state);

      res.json({
        score: score.overall,
        grade: score.grade,
        comparison,
        benchmarks,
        summary: `Your LCS: ${score.overall}. State benchmark: median ${benchmarks.median}, 75th percentile: ${benchmarks.p75}. Your property ranks in the ${comparison.percentile}th percentile for ${state} ${propertyType}.`,
      });
    } catch (error) { Errors.internal(res, error); }
  });

  // ─── Voice Profile ───────────────────────────────────────────────

  // Get voice profile status
  app.get("/api/voice-profile", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { voiceLearningService } = await import("./services/voiceLearning");
      const profile = await voiceLearningService.getProfile(org.id);
      res.json({
        hasProfile: profile.sampleCount >= 3,
        sampleCount: profile.sampleCount,
        formality: profile.formality,
        tone: profile.tone,
        analyzedAt: profile.analyzedAt,
        commonPhrases: profile.commonPhrases.slice(0, 5),
      });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // Force rebuild voice profile
  app.post("/api/voice-profile/rebuild", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { forceRebuild } = await import("./services/voiceProfileTrigger");
      await forceRebuild(org.id);
      res.json({ ok: true, message: "Voice profile rebuilt from latest communications." });
    } catch (error) {
      Errors.internal(res, error);
    }
  });
}

// ─── State Disclosure Data ──────────────────────────────────────────

interface Disclosure {
  name: string;
  required: boolean;
  description: string;
}

function getRequiredDisclosures(state: string): Disclosure[] {
  const disclosures: Record<string, Disclosure[]> = {
    TX: [
      { name: "Flood Zone Disclosure", required: true, description: "Seller must disclose if property is in a 100-year or 500-year flood zone." },
      { name: "Pipeline Easement Disclosure", required: true, description: "Any pipeline easements crossing the property must be disclosed." },
      { name: "Prior Use Disclosure", required: true, description: "Previous uses of the property (landfill, industrial, etc.) must be disclosed." },
    ],
    FL: [
      { name: "Radon Gas Disclosure", required: true, description: "Florida law requires radon gas disclosure in all real estate transactions." },
      { name: "Sinkhole Disclosure", required: true, description: "Known sinkhole activity must be disclosed to the buyer." },
      { name: "Coastal Erosion Disclosure", required: false, description: "Properties in coastal zones may require erosion rate disclosure." },
    ],
    CA: [
      { name: "Natural Hazard Disclosure", required: true, description: "Properties in earthquake, flood, fire, or other hazard zones require NHD report." },
      { name: "Environmental Hazard Disclosure", required: true, description: "Known environmental contamination must be disclosed." },
      { name: "Mello-Roos Disclosure", required: true, description: "Special tax assessments (CFDs) must be disclosed." },
    ],
    AZ: [
      { name: "Affidavit of Disclosure", required: true, description: "Required for unsubdivided land sales — covers water, sewage, road access." },
      { name: "Water Adequacy Disclosure", required: true, description: "Must disclose water availability status for the parcel." },
    ],
    CO: [
      { name: "Green Disclosure", required: false, description: "Mold, radon, and environmental conditions disclosure." },
      { name: "Source of Water Disclosure", required: true, description: "Water rights and source must be disclosed for rural land." },
    ],
    NV: [
      { name: "Disclosure of Defects", required: true, description: "Known material defects must be disclosed." },
      { name: "Water Rights Disclosure", required: true, description: "Water rights status and allocation must be disclosed." },
    ],
    NM: [
      { name: "Property Condition Disclosure", required: true, description: "General condition disclosure including water, utilities, access." },
    ],
    NC: [
      { name: "Residential Property Disclosure", required: true, description: "NC requires disclosure of known conditions affecting property value." },
      { name: "Mineral Rights Disclosure", required: false, description: "Separately owned mineral rights should be disclosed." },
    ],
    GA: [
      { name: "Seller's Property Disclosure", required: false, description: "Georgia does not require seller disclosure but recommends it." },
      { name: "Lead-Based Paint Disclosure", required: true, description: "Required for structures built before 1978." },
    ],
    OR: [
      { name: "Property Disclosure Statement", required: true, description: "Comprehensive seller disclosure required for most transactions." },
      { name: "Forest Fire Protection Disclosure", required: true, description: "Rural properties must disclose wildfire risk zone." },
    ],
  };

  return disclosures[state] || [
    { name: "Standard closing documents", required: true, description: `No state-specific land disclosures required for ${state}. Standard deed and closing documents apply.` },
  ];
}

// ─── Statute of Limitations Data ────────────────────────────────────

const DEBT_COLLECTION_SOL: Record<string, number> = {
  TX: 4, FL: 5, AZ: 6, CA: 4, NV: 6, CO: 6, NM: 6,
  NC: 3, GA: 6, OR: 6, WA: 6, MI: 6, OH: 8, PA: 4,
  NY: 6, IL: 5, MO: 5, MN: 6, WI: 6, VA: 5, AL: 6,
  ID: 5, MT: 5, ND: 6, SD: 6, WY: 8, UT: 6, AR: 5,
};

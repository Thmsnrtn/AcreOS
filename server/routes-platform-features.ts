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
import { sql } from "drizzle-orm";

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

      const data = {
        properties: { total: properties.length, owned: properties.filter(p => p.status === "owned").length },
        deals: { total: deals.length, closed: closedDeals.length, pipeline: deals.filter(d => d.status !== "closed" && d.status !== "cancelled").length },
        notes: {
          total: totalNotes,
          outstandingPrincipal: totalOutstanding,
          avgInterestRate: avgRate,
          monthlyIncome: notes.reduce((s, n: any) => s + parseFloat(n.monthlyPayment || "0"), 0),
        },
        markets: [],
        pipeline: [],
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
      const { getQboOAuthUrl } = await import("./services/bookkeeping");
      if (typeof getQboOAuthUrl !== "function") {
        return Errors.badRequest(res, "QuickBooks integration not configured");
      }
      const url = getQboOAuthUrl();
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

import type { Express } from "express";
import type { AuthenticatedRequest } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

export async function registerEnhancementRoutes(app: Express) {

  // ── Onboarding (Domain A) ──

  // Item 2: Seed sample leads for new org
  app.post("/api/enhancements/seed-sample-leads", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as AuthenticatedRequest).organization;
      const { seedSampleLeads } = await import("./services/onboardingEnhancements");
      const count = await seedSampleLeads(org.id);
      res.json({ success: true, leadsCreated: count });
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  // Item 9: Column mapping for CSV imports
  app.post("/api/enhancements/detect-columns", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { headers } = req.body;
      if (!headers || !Array.isArray(headers)) return Errors.badRequest(res, "headers array required");
      const { detectColumnMapping, detectCsvFormat } = await import("./services/onboardingEnhancements");
      const mapping = detectColumnMapping(headers);
      const format = detectCsvFormat(headers);
      res.json({ mapping, detectedFormat: format });
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  // Item 12: Suggest starter counties
  app.get("/api/enhancements/starter-counties/:state", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { suggestStarterCounties } = await import("./services/onboardingEnhancements");
      const suggestions = suggestStarterCounties(req.params.state);
      res.json(suggestions);
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  // ── CRM (Domain D) ──

  // Item 51: Lead deduplication
  app.get("/api/enhancements/lead-duplicates", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as AuthenticatedRequest).organization;
      const { findDuplicateLeads } = await import("./services/crmEnhancements");
      const duplicates = await findDuplicateLeads(org.id);
      res.json(duplicates);
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  // Item 55: Lead aging alerts
  app.get("/api/enhancements/aging-leads", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as AuthenticatedRequest).organization;
      const days = parseInt(req.query.days as string) || 14;
      const { getAgingLeads } = await import("./services/crmEnhancements");
      const leads = await getAgingLeads(org.id, days);
      res.json(leads);
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  // Item 65: Lead scoring explanation
  app.get("/api/enhancements/lead-score-explanation/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as AuthenticatedRequest).organization;
      const { leads } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      const { db } = await import("./storage");
      const lead = await db.query.leads.findFirst({ where: and(eq(leads.id, parseInt(req.params.id)), eq(leads.organizationId, org.id)) });
      if (!lead) return Errors.notFound(res, "Lead");
      const { explainLeadScore } = await import("./services/crmEnhancements");
      res.json(explainLeadScore(lead));
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  // Item 68: Lead conversion funnel
  app.get("/api/enhancements/lead-funnel", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as AuthenticatedRequest).organization;
      const { getLeadFunnel } = await import("./services/crmEnhancements");
      const funnel = await getLeadFunnel(org.id);
      res.json(funnel);
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  // ── Negotiation (Domain E) ──

  // Item 73: Negotiation analytics
  app.get("/api/enhancements/negotiation-analytics", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as AuthenticatedRequest).organization;
      const { getNegotiationAnalytics } = await import("./services/negotiationEnhancements");
      const analytics = await getNegotiationAnalytics(org.id);
      res.json(analytics);
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  // Item 79: Offer acceptance prediction
  app.post("/api/enhancements/predict-acceptance", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { motivationScore, offerPercent } = req.body;
      if (motivationScore === undefined || offerPercent === undefined) return Errors.badRequest(res, "motivationScore and offerPercent required");
      const { predictOfferAcceptance } = await import("./services/negotiationEnhancements");
      res.json(predictOfferAcceptance(motivationScore, offerPercent));
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  // ── Finance (Domain F) ──

  // Item 86: Payment calendar
  app.get("/api/enhancements/payment-calendar/:year/:month", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as AuthenticatedRequest).organization;
      const { getPaymentCalendar } = await import("./services/financeEnhancements");
      const calendar = await getPaymentCalendar(org.id, parseInt(req.params.year), parseInt(req.params.month));
      res.json(calendar);
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  // Item 92: Portfolio stress test
  app.get("/api/enhancements/stress-test", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as AuthenticatedRequest).organization;
      const defaultRate = parseFloat(req.query.defaultRate as string) || 0.2;
      const { stressTestPortfolio } = await import("./services/financeEnhancements");
      const result = await stressTestPortfolio(org.id, defaultRate);
      res.json(result);
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  // ── Campaign (Domain G) ──

  // Item 106: Campaign ROI
  app.get("/api/enhancements/campaign-roi/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { calculateCampaignROI } = await import("./services/campaignEnhancements");
      const roi = await calculateCampaignROI(parseInt(req.params.id));
      res.json(roi);
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  // ── Reporting (Domain I) ──

  // Item 155: Pipeline velocity
  app.get("/api/enhancements/pipeline-velocity", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as AuthenticatedRequest).organization;
      const { getPipelineVelocity } = await import("./services/reportingEnhancements");
      const velocity = await getPipelineVelocity(org.id);
      res.json(velocity);
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  // ── Pax Intelligence (Domain J) ──

  // Item 172: Pax suggested questions per page
  app.get("/api/enhancements/pax-suggestions", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const page = req.query.page as string || "/today";
      const { getPaxSuggestedQuestions } = await import("./services/paxEnhancements");
      res.json({ questions: getPaxSuggestedQuestions(page) });
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  // ── Performance (Domain L) ──

  // Item 220: Deep health check
  app.get("/api/health/deep", async (_req, res) => {
    try {
      const { deepHealthCheck } = await import("./services/performanceEnhancements");
      const health = await deepHealthCheck();
      res.status(health.status === "unhealthy" ? 503 : 200).json(health);
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  // ── Analytics (Domain N) ──

  // Item 241: Signup funnel
  app.get("/api/enhancements/signup-funnel", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as AuthenticatedRequest).organization;
      if (!org?.isFounder) return Errors.forbidden(res, "Founder access required");
      const { getSignupFunnel } = await import("./services/analyticsEnhancements");
      const funnel = await getSignupFunnel();
      res.json(funnel);
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  // Item 244: Retention curves
  app.get("/api/enhancements/retention", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as AuthenticatedRequest).organization;
      if (!org?.isFounder) return Errors.forbidden(res, "Founder access required");
      const { getRetentionCurves } = await import("./services/analyticsEnhancements");
      const curves = await getRetentionCurves();
      res.json(curves);
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  // ── Community (Domain P) ──

  // Item 281: Knowledge base search
  app.get("/api/enhancements/knowledge-base", async (req, res) => {
    try {
      const query = req.query.q as string || "";
      const { searchKnowledgeBase, KNOWLEDGE_BASE } = await import("./services/communityEnhancements");
      const results = query ? searchKnowledgeBase(query) : KNOWLEDGE_BASE;
      res.json(results);
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  // Item 289: Weekly tip
  app.get("/api/enhancements/weekly-tip", async (_req, res) => {
    try {
      const { getWeeklyTip } = await import("./services/communityEnhancements");
      res.json({ tip: getWeeklyTip() });
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  // Item 293: Changelog
  app.get("/api/enhancements/changelog", async (_req, res) => {
    try {
      const { getChangelog } = await import("./services/communityEnhancements");
      res.json(getChangelog());
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  logger.info("[routes-enhancements] 20 enhancement endpoints registered");
}

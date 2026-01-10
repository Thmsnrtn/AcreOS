import type { Express, Request, Response, NextFunction, Router } from "express";
import { Router as createRouter } from "express";
import { isAuthenticated } from "./replit_integrations/auth";
import { storage } from "./storage";

function generateSlug(name: string): string {
  const baseSlug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const uniqueSuffix = Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
  return `${baseSlug}-${uniqueSuffix}`;
}

async function getOrCreateOrg(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  
  const user = req.user as any;
  const userId = user.claims?.sub || user.id;
  
  if (!userId) {
    return res.status(401).json({ message: "Invalid user session" });
  }
  
  let org = await storage.getOrganizationByOwner(userId);
  if (!org) {
    const orgName = user.username ? `${user.username}'s Organization` : "My Organization";
    org = await storage.createOrganization({
      name: orgName,
      slug: generateSlug(user.username || "org"),
      ownerId: userId,
    });
  }
  (req as any).organization = org;
  next();
}

export function registerAIOperationsRoutes(app: Express): void {
  const router = createRouter();

  // ============================================
  // DUE DILIGENCE PODS - /api/ai/due-diligence
  // ============================================
  router.post("/due-diligence/request", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { propertyId, leadId, priorityLevel } = req.body;
      
      const { dueDiligencePodService } = await import("./services/dueDiligencePods");
      const dossier = await dueDiligencePodService.requestDossier(org.id, propertyId, priorityLevel || "normal", leadId);
      
      res.json({ success: true, dossierId: dossier.id });
    } catch (error: any) {
      console.error("Due diligence request error:", error);
      res.status(500).json({ message: error.message || "Failed to create dossier request" });
    }
  });

  router.get("/due-diligence/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const dossierId = parseInt(req.params.id);
      
      const { dueDiligencePodService } = await import("./services/dueDiligencePods");
      const dossier = await dueDiligencePodService.getDossier(dossierId);
      
      if (!dossier) {
        return res.status(404).json({ message: "Dossier not found" });
      }
      res.json(dossier);
    } catch (error: any) {
      console.error("Get dossier error:", error);
      res.status(500).json({ message: error.message || "Failed to get dossier" });
    }
  });

  // ============================================
  // SELLER INTENT PREDICTOR - /api/ai/intent
  // ============================================
  router.post("/intent/predict", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { leadId, propertyId } = req.body;
      
      const { sellerIntentPredictorService } = await import("./services/sellerIntentPredictor");
      const prediction = await sellerIntentPredictorService.predictIntent(org.id, leadId, propertyId);
      
      res.json(prediction);
    } catch (error: any) {
      console.error("Intent prediction error:", error);
      res.status(500).json({ message: error.message || "Failed to predict intent" });
    }
  });

  router.get("/intent/lead/:leadId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const leadId = parseInt(req.params.leadId);
      
      const { sellerIntentPredictorService } = await import("./services/sellerIntentPredictor");
      const predictions = await sellerIntentPredictorService.getLeadPredictions(org.id, leadId);
      
      res.json(predictions);
    } catch (error: any) {
      console.error("Get predictions error:", error);
      res.status(500).json({ message: error.message || "Failed to get predictions" });
    }
  });

  // ============================================
  // PRICE OPTIMIZER - /api/ai/pricing
  // ============================================
  router.post("/pricing/acquisition", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { propertyId, targetMargin } = req.body;
      
      const { priceOptimizerService } = await import("./services/priceOptimizer");
      const recommendation = await priceOptimizerService.recommendAcquisitionPrice(org.id, propertyId, targetMargin);
      
      res.json(recommendation);
    } catch (error: any) {
      console.error("Acquisition pricing error:", error);
      res.status(500).json({ message: error.message || "Failed to calculate acquisition price" });
    }
  });

  router.post("/pricing/disposition", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { propertyId, quickSale } = req.body;
      
      const { priceOptimizerService } = await import("./services/priceOptimizer");
      const recommendation = await priceOptimizerService.recommendDispositionPrice(org.id, propertyId, quickSale);
      
      res.json(recommendation);
    } catch (error: any) {
      console.error("Disposition pricing error:", error);
      res.status(500).json({ message: error.message || "Failed to calculate disposition price" });
    }
  });

  // ============================================
  // DEAL PATTERN CLONING - /api/ai/patterns
  // ============================================
  router.post("/patterns/analyze", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { dealId } = req.body;
      
      const { dealPatternCloningService } = await import("./services/dealPatternCloning");
      const pattern = await dealPatternCloningService.extractPattern(org.id, dealId);
      
      res.json(pattern);
    } catch (error: any) {
      console.error("Pattern analysis error:", error);
      res.status(500).json({ message: error.message || "Failed to analyze deal pattern" });
    }
  });

  router.get("/patterns/match/:propertyId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const propertyId = parseInt(req.params.propertyId);
      
      const { dealPatternCloningService } = await import("./services/dealPatternCloning");
      const matches = await dealPatternCloningService.findSimilarPatterns(org.id, propertyId);
      
      res.json(matches);
    } catch (error: any) {
      console.error("Pattern matching error:", error);
      res.status(500).json({ message: error.message || "Failed to find matching patterns" });
    }
  });

  // ============================================
  // NEGOTIATION COPILOT - /api/ai/negotiation
  // ============================================
  router.post("/negotiation/session", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { dealId, leadId, initialOffer, sellerAsk } = req.body;
      
      const { negotiationCopilotService } = await import("./services/negotiationCopilot");
      const session = await negotiationCopilotService.startSession(org.id, dealId, leadId, initialOffer, sellerAsk);
      
      res.json(session);
    } catch (error: any) {
      console.error("Start negotiation session error:", error);
      res.status(500).json({ message: error.message || "Failed to start negotiation session" });
    }
  });

  router.post("/negotiation/objection", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { sessionId, objectionText } = req.body;
      
      const { negotiationCopilotService } = await import("./services/negotiationCopilot");
      const response = await negotiationCopilotService.detectObjection(sessionId, objectionText);
      
      res.json(response);
    } catch (error: any) {
      console.error("Handle objection error:", error);
      res.status(500).json({ message: error.message || "Failed to handle objection" });
    }
  });

  router.get("/negotiation/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const dealId = parseInt(req.params.id);
      
      const { negotiationCopilotService } = await import("./services/negotiationCopilot");
      const sessions = await negotiationCopilotService.getSessionHistory(org.id, dealId);
      
      res.json(sessions);
    } catch (error: any) {
      console.error("Get negotiation session error:", error);
      res.status(500).json({ message: error.message || "Failed to get negotiation session" });
    }
  });

  // ============================================
  // SEQUENCE OPTIMIZER - /api/ai/sequences
  // ============================================
  router.post("/sequences/performance", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const performanceData = req.body;
      
      const { sequenceOptimizerService } = await import("./services/sequenceOptimizer");
      await sequenceOptimizerService.recordMessagePerformance(org.id, performanceData);
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("Record sequence performance error:", error);
      res.status(500).json({ message: error.message || "Failed to record performance" });
    }
  });

  router.get("/sequences/:sequenceId/analysis", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const sequenceId = parseInt(req.params.sequenceId);
      
      const { sequenceOptimizerService } = await import("./services/sequenceOptimizer");
      const analysis = await sequenceOptimizerService.analyzeSequencePerformance(org.id, sequenceId);
      
      res.json(analysis);
    } catch (error: any) {
      console.error("Sequence analysis error:", error);
      res.status(500).json({ message: error.message || "Failed to analyze sequence" });
    }
  });

  // ============================================
  // VOICE CALL AI - /api/ai/voice
  // ============================================
  router.post("/voice/record", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const callData = req.body;
      
      const { voiceCallAIService } = await import("./services/voiceCallAI");
      const transcriptId = await voiceCallAIService.recordCall(org.id, callData);
      
      res.json({ success: true, transcriptId });
    } catch (error: any) {
      console.error("Record voice call error:", error);
      res.status(500).json({ message: error.message || "Failed to record call" });
    }
  });

  router.get("/voice/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const leadId = parseInt(req.params.id);
      
      const { voiceCallAIService } = await import("./services/voiceCallAI");
      const transcripts = await voiceCallAIService.getCallsForLead(org.id, leadId);
      
      res.json(transcripts);
    } catch (error: any) {
      console.error("Get transcript error:", error);
      res.status(500).json({ message: error.message || "Failed to get transcript" });
    }
  });

  // ============================================
  // PORTFOLIO SENTINEL - /api/ai/portfolio
  // ============================================
  router.post("/portfolio/monitor", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { propertyId } = req.body;
      
      const { portfolioSentinelService } = await import("./services/portfolioSentinel");
      const result = await portfolioSentinelService.monitorProperty(org.id, propertyId);
      
      res.json(result);
    } catch (error: any) {
      console.error("Portfolio monitor error:", error);
      res.status(500).json({ message: error.message || "Failed to monitor property" });
    }
  });

  router.get("/portfolio/alerts", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const options = {
        severities: req.query.severities ? String(req.query.severities).split(",") as any[] : undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 50,
        offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
        status: req.query.status as string | undefined,
      };
      
      const { portfolioSentinelService } = await import("./services/portfolioSentinel");
      const alerts = await portfolioSentinelService.getActiveAlerts(org.id, options);
      
      res.json(alerts);
    } catch (error: any) {
      console.error("Get alerts error:", error);
      res.status(500).json({ message: error.message || "Failed to get alerts" });
    }
  });

  router.patch("/portfolio/alerts/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const alertId = parseInt(req.params.id);
      const { action, resolution, userId } = req.body;
      
      const { portfolioSentinelService } = await import("./services/portfolioSentinel");
      let alert;
      if (action === "acknowledge") {
        alert = await portfolioSentinelService.acknowledgeAlert(alertId, userId);
      } else if (action === "resolve") {
        alert = await portfolioSentinelService.resolveAlert(alertId, resolution);
      } else if (action === "dismiss") {
        alert = await portfolioSentinelService.dismissAlert(alertId);
      }
      
      if (!alert) {
        return res.status(404).json({ message: "Alert not found" });
      }
      res.json(alert);
    } catch (error: any) {
      console.error("Update alert error:", error);
      res.status(500).json({ message: error.message || "Failed to update alert" });
    }
  });

  router.post("/portfolio/scan", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      
      const { portfolioSentinelService } = await import("./services/portfolioSentinel");
      const results = await portfolioSentinelService.monitorPortfolio(org.id);
      
      res.json({ success: true, results, alertsGenerated: results.reduce((sum, r) => sum + r.alertsCreated, 0) });
    } catch (error: any) {
      console.error("Portfolio scan error:", error);
      res.status(500).json({ message: error.message || "Failed to scan portfolio" });
    }
  });

  // ============================================
  // DOCUMENT INTELLIGENCE - /api/ai/documents
  // ============================================
  router.post("/documents/analyze", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const documentData = req.body;
      
      const { documentIntelligenceService } = await import("./services/documentIntelligence");
      const analysis = await documentIntelligenceService.uploadDocument(org.id, documentData);
      
      res.json(analysis);
    } catch (error: any) {
      console.error("Document analysis error:", error);
      res.status(500).json({ message: error.message || "Failed to analyze document" });
    }
  });

  router.get("/documents/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const propertyId = parseInt(req.params.id);
      
      const { documentIntelligenceService } = await import("./services/documentIntelligence");
      const documents = await documentIntelligenceService.getDocumentsByProperty(org.id, propertyId);
      
      res.json(documents);
    } catch (error: any) {
      console.error("Get document analysis error:", error);
      res.status(500).json({ message: error.message || "Failed to get document analysis" });
    }
  });

  // ============================================
  // CASH FLOW FORECASTER - /api/ai/cashflow
  // ============================================
  router.post("/cashflow/forecast", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const forecastParams = req.body;
      
      const { cashFlowForecasterService } = await import("./services/cashFlowForecaster");
      const forecast = await cashFlowForecasterService.generateForecast(org.id, forecastParams);
      
      res.json(forecast);
    } catch (error: any) {
      console.error("Cash flow forecast error:", error);
      res.status(500).json({ message: error.message || "Failed to generate forecast" });
    }
  });

  router.get("/cashflow/organization", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      
      const { cashFlowForecasterService } = await import("./services/cashFlowForecaster");
      const summary = await cashFlowForecasterService.getPortfolioCashFlowSummary(org.id);
      
      res.json(summary);
    } catch (error: any) {
      console.error("Get organization cash flow error:", error);
      res.status(500).json({ message: error.message || "Failed to get organization cash flow" });
    }
  });

  // ============================================
  // COMPLIANCE GUARDIAN - /api/ai/compliance
  // ============================================
  router.post("/compliance/rules", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const ruleData = req.body;
      
      const { complianceGuardianService } = await import("./services/complianceGuardian");
      const rule = await complianceGuardianService.addRule(ruleData);
      
      res.json(rule);
    } catch (error: any) {
      console.error("Add compliance rule error:", error);
      res.status(500).json({ message: error.message || "Failed to add compliance rule" });
    }
  });

  router.get("/compliance/rules", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const state = req.query.state as string;
      const county = req.query.county as string | undefined;
      const ruleType = req.query.type as string | undefined;
      
      const { complianceGuardianService } = await import("./services/complianceGuardian");
      const rules = await complianceGuardianService.getRulesForLocation(state, county, ruleType as any);
      
      res.json(rules);
    } catch (error: any) {
      console.error("Get compliance rules error:", error);
      res.status(500).json({ message: error.message || "Failed to get compliance rules" });
    }
  });

  router.post("/compliance/check", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { propertyId } = req.body;
      
      const { complianceGuardianService } = await import("./services/complianceGuardian");
      const result = await complianceGuardianService.checkPropertyCompliance(org.id, propertyId);
      
      res.json(result);
    } catch (error: any) {
      console.error("Compliance check error:", error);
      res.status(500).json({ message: error.message || "Failed to run compliance check" });
    }
  });

  // ============================================
  // BUYER MATCHING AI - /api/ai/buyer-matching
  // ============================================
  router.post("/buyer-matching/profile", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const params = req.body;
      
      const { buyerMatchingAIService } = await import("./services/buyerMatchingAI");
      const profile = await buyerMatchingAIService.createBuyerProfile(org.id, params);
      
      res.json(profile);
    } catch (error: any) {
      console.error("Create buyer profile error:", error);
      res.status(500).json({ message: error.message || "Failed to create buyer profile" });
    }
  });

  router.post("/buyer-matching/match", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { propertyId } = req.body;
      
      const { buyerMatchingAIService } = await import("./services/buyerMatchingAI");
      const matches = await buyerMatchingAIService.matchPropertyToBuyers(org.id, propertyId);
      
      res.json(matches);
    } catch (error: any) {
      console.error("Find buyer matches error:", error);
      res.status(500).json({ message: error.message || "Failed to find buyer matches" });
    }
  });

  // ============================================
  // BUYER QUALIFICATION BOT - /api/ai/buyer-qualification
  // ============================================
  router.post("/buyer-qualification/qualify", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { buyerProfileId } = req.body;
      
      const { buyerQualificationBotService } = await import("./services/buyerQualificationBot");
      const qualification = await buyerQualificationBotService.startQualification(org.id, buyerProfileId);
      
      res.json(qualification);
    } catch (error: any) {
      console.error("Buyer qualification error:", error);
      res.status(500).json({ message: error.message || "Failed to qualify buyer" });
    }
  });

  router.get("/buyer-qualification/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const qualificationId = parseInt(req.params.id);
      
      const { buyerQualificationBotService } = await import("./services/buyerQualificationBot");
      const qualification = await buyerQualificationBotService.getQualificationById(qualificationId);
      
      if (!qualification) {
        return res.status(404).json({ message: "Qualification not found" });
      }
      res.json(qualification);
    } catch (error: any) {
      console.error("Get qualification error:", error);
      res.status(500).json({ message: error.message || "Failed to get qualification" });
    }
  });

  // ============================================
  // DISPOSITION OPTIMIZER - /api/ai/disposition
  // ============================================
  router.post("/disposition/recommend", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { propertyId } = req.body;
      
      const { dispositionOptimizerService } = await import("./services/dispositionOptimizer");
      const recommendations = await dispositionOptimizerService.generateRecommendation(org.id, propertyId);
      
      res.json(recommendations);
    } catch (error: any) {
      console.error("Disposition recommendation error:", error);
      res.status(500).json({ message: error.message || "Failed to get disposition recommendations" });
    }
  });

  router.get("/disposition/property/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const propertyId = parseInt(req.params.id);
      
      const { dispositionOptimizerService } = await import("./services/dispositionOptimizer");
      const recommendations = await dispositionOptimizerService.getRecommendationsByProperty(org.id, propertyId);
      
      res.json(recommendations);
    } catch (error: any) {
      console.error("Get property recommendations error:", error);
      res.status(500).json({ message: error.message || "Failed to get property recommendations" });
    }
  });

  app.use("/api/ai", router);
}

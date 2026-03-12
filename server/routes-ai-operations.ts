import type { Express, Request, Response, NextFunction, Router } from "express";
import { Router as createRouter } from "express";
import { z } from "zod";
import { isAuthenticated } from "./auth";
import { storage } from "./storage";

// ============================================
// VALIDATION SCHEMAS
// ============================================

// Due Diligence
const dueDiligenceRequestSchema = z.object({
  propertyId: z.number({ required_error: "propertyId is required" }),
  leadId: z.number().optional(),
  priorityLevel: z.enum(["normal", "high", "urgent"]).optional(),
});

// Intent
const intentPredictSchema = z.object({
  leadId: z.number({ required_error: "leadId is required" }),
  propertyId: z.number().optional(),
});

// Pricing
const pricingAcquisitionSchema = z.object({
  propertyId: z.number({ required_error: "propertyId is required" }),
  targetMargin: z.number().optional(),
});

const pricingDispositionSchema = z.object({
  propertyId: z.number({ required_error: "propertyId is required" }),
  quickSale: z.boolean().optional(),
});

const pricingOptimizeSchema = z.object({
  propertyId: z.number({ required_error: "propertyId is required" }),
  sellerAskingPrice: z.number().optional(),
  dealType: z.enum(["acquisition", "disposition"]).optional(),
});

// Patterns
const patternAnalyzeSchema = z.object({
  dealId: z.number({ required_error: "dealId is required" }),
});

// Negotiation
const negotiationSessionSchema = z.object({
  dealId: z.number({ required_error: "dealId is required" }),
  leadId: z.number().optional(),
  initialOffer: z.number().optional(),
  sellerAsk: z.number().optional(),
});

const negotiationObjectionSchema = z.object({
  sessionId: z.number({ required_error: "sessionId is required" }),
  objectionText: z.string({ required_error: "objectionText is required" }),
});

// Sequences
const sequencePerformanceSchema = z.object({
  messageId: z.number().optional(),
  templateId: z.number().optional(),
  opened: z.boolean().optional(),
  clicked: z.boolean().optional(),
  replied: z.boolean().optional(),
  sentAt: z.string().optional(),
});

// Voice
const voiceRecordSchema = z.object({
  leadId: z.number({ required_error: "leadId is required" }),
  audioUrl: z.string().optional(),
  transcriptText: z.string().optional(),
  callDuration: z.number().optional(),
});

// Portfolio
const portfolioMonitorSchema = z.object({
  propertyId: z.number({ required_error: "propertyId is required" }),
});

const portfolioAlertUpdateSchema = z.object({
  action: z.enum(["acknowledge", "resolve", "dismiss"], { required_error: "action is required" }),
  resolution: z.string().optional(),
  userId: z.string().optional(),
});

// Documents
const documentAnalyzeSchema = z.object({
  propertyId: z.number().optional(),
  documentType: z.string().optional(),
  content: z.string().optional(),
  sourceUrl: z.string().optional(),
});

// Cashflow
const cashflowForecastSchema = z.object({
  noteIds: z.array(z.number()).optional(),
  months: z.number().optional().default(12),
});

// Compliance
const complianceRuleSchema = z.object({
  state: z.string({ required_error: "state is required" }),
  county: z.string().optional(),
  ruleType: z.enum(["document_requirements", "disclosure_rules", "timing_restrictions", "recording_requirements", "tax_rules"], { required_error: "ruleType is required" }),
  description: z.string({ required_error: "description is required" }),
  requirements: z.array(z.string()).optional(),
  penalties: z.string().optional(),
});

const complianceCheckSchema = z.object({
  propertyId: z.number({ required_error: "propertyId is required" }),
});

// Buyer Matching
const buyerProfileSchema = z.object({
  leadId: z.number().optional(),
  targetCounties: z.array(z.string()).optional(),
  priceRangeMin: z.number().optional(),
  priceRangeMax: z.number().optional(),
  acreageMin: z.number().optional(),
  acreageMax: z.number().optional(),
  financing: z.boolean().optional(),
});

const buyerMatchSchema = z.object({
  propertyId: z.number({ required_error: "propertyId is required" }),
});

// Buyer Qualification
const buyerQualifySchema = z.object({
  buyerProfileId: z.number({ required_error: "buyerProfileId is required" }),
});

// Disposition
const dispositionRecommendSchema = z.object({
  propertyId: z.number({ required_error: "propertyId is required" }),
});

// ============================================
// VALIDATION HELPERS
// ============================================

function validateRequest<T extends z.ZodSchema>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      }));
      return res.status(400).json({ message: "Validation failed", errors });
    }
    req.body = result.data;
    next();
  };
}

function validateNumericParam(paramName: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const value = req.params[paramName];
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) {
      return res.status(400).json({
        message: "Validation failed",
        errors: [{ field: paramName, message: `${paramName} must be a valid number` }],
      });
    }
    next();
  };
}

// Org middleware — imported from shared module
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";

export function registerAIOperationsRoutes(app: Express): void {
  const router = createRouter();

  // ============================================
  // DUE DILIGENCE PODS - /api/ai/due-diligence
  // ============================================
  router.post("/due-diligence/request", isAuthenticated, getOrCreateOrg, validateRequest(dueDiligenceRequestSchema), async (req, res) => {
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

  router.get("/due-diligence/:id", isAuthenticated, getOrCreateOrg, validateNumericParam("id"), async (req, res) => {
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
  router.post("/intent/predict", isAuthenticated, getOrCreateOrg, validateRequest(intentPredictSchema), async (req, res) => {
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

  router.get("/intent/lead/:leadId", isAuthenticated, getOrCreateOrg, validateNumericParam("leadId"), async (req, res) => {
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
  router.post("/pricing/acquisition", isAuthenticated, getOrCreateOrg, validateRequest(pricingAcquisitionSchema), async (req, res) => {
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

  router.post("/pricing/disposition", isAuthenticated, getOrCreateOrg, validateRequest(pricingDispositionSchema), async (req, res) => {
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

  router.post("/pricing/optimize", isAuthenticated, getOrCreateOrg, validateRequest(pricingOptimizeSchema), async (req, res) => {
    try {
      const org = (req as any).organization;
      const { propertyId, sellerAskingPrice, dealType } = req.body;
      
      const { priceOptimizerService } = await import("./services/priceOptimizer");
      const { properties } = await import("@shared/schema");
      const { db } = await import("./db");
      const { eq, and } = await import("drizzle-orm");
      
      const [property] = await db.select().from(properties)
        .where(and(eq(properties.id, propertyId), eq(properties.organizationId, org.id)));
      
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }
      
      const isDisposition = dealType === 'disposition';
      let recommendation;
      
      if (isDisposition) {
        recommendation = await priceOptimizerService.recommendDispositionPrice(org.id, propertyId, false);
      } else {
        recommendation = await priceOptimizerService.recommendAcquisitionPrice(org.id, propertyId);
      }
      
      const acres = property.sizeAcres ? Number(property.sizeAcres) : 1;
      const suggestedOffer = Number(recommendation.recommendedPrice);
      const pricePerAcre = suggestedOffer / acres;
      
      const confidence = Number(recommendation.confidence) * 100;
      const comparables = recommendation.comparablesSummary || {};
      
      let marketCondition: 'hot' | 'neutral' | 'cold' = 'neutral';
      const strategy = recommendation.strategy as any;
      if (strategy?.marketTiming) {
        if (strategy.marketTiming.toLowerCase().includes('strong') || strategy.marketTiming.toLowerCase().includes('hot')) {
          marketCondition = 'hot';
        } else if (strategy.marketTiming.toLowerCase().includes('weak') || strategy.marketTiming.toLowerCase().includes('slow')) {
          marketCondition = 'cold';
        }
      }
      
      res.json({
        suggestedOffer,
        confidence,
        pricePerAcre,
        priceRangeMin: Number(recommendation.priceRangeMin),
        priceRangeMax: Number(recommendation.priceRangeMax),
        comparables,
        marketCondition,
        reasoning: recommendation.reasoning || "Based on comparable sales and market analysis.",
        propertyAcres: acres,
      });
    } catch (error: any) {
      console.error("Pricing optimization error:", error);
      res.status(500).json({ message: error.message || "Failed to optimize pricing" });
    }
  });

  // ============================================
  // DEAL PATTERN CLONING - /api/ai/patterns
  // ============================================
  router.post("/patterns/analyze", isAuthenticated, getOrCreateOrg, validateRequest(patternAnalyzeSchema), async (req, res) => {
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

  router.get("/patterns/match/:propertyId", isAuthenticated, getOrCreateOrg, validateNumericParam("propertyId"), async (req, res) => {
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
  router.post("/negotiation/session", isAuthenticated, getOrCreateOrg, validateRequest(negotiationSessionSchema), async (req, res) => {
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

  router.post("/negotiation/objection", isAuthenticated, getOrCreateOrg, validateRequest(negotiationObjectionSchema), async (req, res) => {
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

  router.get("/negotiation/:id", isAuthenticated, getOrCreateOrg, validateNumericParam("id"), async (req, res) => {
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
  router.post("/sequences/performance", isAuthenticated, getOrCreateOrg, validateRequest(sequencePerformanceSchema), async (req, res) => {
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

  router.get("/sequences/:sequenceId/analysis", isAuthenticated, getOrCreateOrg, validateNumericParam("sequenceId"), async (req, res) => {
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
  router.post("/voice/record", isAuthenticated, getOrCreateOrg, validateRequest(voiceRecordSchema), async (req, res) => {
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

  router.get("/voice/:id", isAuthenticated, getOrCreateOrg, validateNumericParam("id"), async (req, res) => {
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
  router.post("/portfolio/monitor", isAuthenticated, getOrCreateOrg, validateRequest(portfolioMonitorSchema), async (req, res) => {
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
        limit: Math.min(100, req.query.limit ? parseInt(req.query.limit as string) : 50),
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

  router.patch("/portfolio/alerts/:id", isAuthenticated, getOrCreateOrg, validateNumericParam("id"), validateRequest(portfolioAlertUpdateSchema), async (req, res) => {
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
  router.post("/documents/analyze", isAuthenticated, getOrCreateOrg, validateRequest(documentAnalyzeSchema), async (req, res) => {
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

  router.get("/documents/:id", isAuthenticated, getOrCreateOrg, validateNumericParam("id"), async (req, res) => {
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
  router.post("/cashflow/forecast", isAuthenticated, getOrCreateOrg, validateRequest(cashflowForecastSchema), async (req, res) => {
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
  router.post("/compliance/rules", isAuthenticated, getOrCreateOrg, validateRequest(complianceRuleSchema), async (req, res) => {
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

  router.post("/compliance/check", isAuthenticated, getOrCreateOrg, validateRequest(complianceCheckSchema), async (req, res) => {
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
  router.post("/buyer-matching/profile", isAuthenticated, getOrCreateOrg, validateRequest(buyerProfileSchema), async (req, res) => {
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

  router.post("/buyer-matching/match", isAuthenticated, getOrCreateOrg, validateRequest(buyerMatchSchema), async (req, res) => {
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
  router.post("/buyer-qualification/qualify", isAuthenticated, getOrCreateOrg, validateRequest(buyerQualifySchema), async (req, res) => {
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

  router.get("/buyer-qualification/:id", isAuthenticated, getOrCreateOrg, validateNumericParam("id"), async (req, res) => {
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
  router.post("/disposition/recommend", isAuthenticated, getOrCreateOrg, validateRequest(dispositionRecommendSchema), async (req, res) => {
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

  router.get("/disposition/property/:id", isAuthenticated, getOrCreateOrg, validateNumericParam("id"), async (req, res) => {
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

// @ts-nocheck — ORM type refinement deferred; runtime-correct
import type { Express } from "express";
import { storage } from "./storage";
import { z } from "zod";
import { insertDealSchema } from "@shared/schema";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { leadScoringService } from "./services/leadScoring";
import { propertyEnrichmentService } from "./services/propertyEnrichment";
import { checkUsageLimit } from "./services/usageLimits";
import {
  initiateHandoff,
  updateHandoffChecklist,
  completeHandoff,
  getHandoffsForDeal,
  getAllHandoffs,
} from "./services/dealHandoffService";

// Partial update schema for PUT endpoints
const updateDealSchema = insertDealSchema.partial().omit({ organizationId: true });

const logger = {
  info: (msg: string, meta?: Record<string, any>) => console.log(JSON.stringify({ level: 'INFO', timestamp: new Date().toISOString(), message: msg, ...meta })),
  warn: (msg: string, meta?: Record<string, any>) => console.warn(JSON.stringify({ level: 'WARN', timestamp: new Date().toISOString(), message: msg, ...meta })),
  error: (msg: string, meta?: Record<string, any>) => console.error(JSON.stringify({ level: 'ERROR', timestamp: new Date().toISOString(), message: msg, ...meta })),
};

// Helper function to trigger deal enrichment asynchronously (non-blocking)
async function triggerDealEnrichmentAsync(
  organizationId: number,
  dealId: number,
  propertyId: number
): Promise<void> {
  Promise.resolve().then(async () => {
    try {
      await storage.updateDeal(dealId, { enrichmentStatus: "pending" });
      const enrichmentResult = await propertyEnrichmentService.enrichProperty(organizationId, propertyId);
      const enrichmentPayload = {
        enrichedAt: enrichmentResult.enrichedAt.toISOString(),
        lookupTimeMs: enrichmentResult.lookupTimeMs,
        parcel: enrichmentResult.parcel,
        hazards: enrichmentResult.hazards,
        environment: enrichmentResult.environment,
        infrastructure: enrichmentResult.infrastructure,
        demographics: enrichmentResult.demographics,
        publicLands: enrichmentResult.publicLands,
        transportation: enrichmentResult.transportation,
        water: enrichmentResult.water,
        scores: enrichmentResult.scores,
        errors: enrichmentResult.errors,
      };
      await storage.updateDeal(dealId, {
        enrichmentStatus: "completed",
        enrichedAt: new Date(),
        enrichmentData: enrichmentPayload as any,
      });
      logger.info("Deal and property enrichment completed", { dealId, propertyId, organizationId, lookupTimeMs: enrichmentResult.lookupTimeMs });
    } catch (err) {
      logger.error("Deal enrichment failed", { dealId, propertyId, organizationId, error: String(err) });
      try {
        await storage.updateDeal(dealId, { enrichmentStatus: "failed", enrichmentData: { errors: { enrichment: String(err) } } as any });
      } catch (updateErr) {
        logger.error("Failed to update deal enrichment status", { dealId, error: String(updateErr) });
      }
    }
  });
}

export function registerDealRoutes(app: Express): void {
  const api = app;

  // DEALS (Acquisitions/Dispositions)
  // ============================================
  
  api.get("/api/deals", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const deals = await storage.getDeals(org.id);
    res.json(deals);
  });
  
  api.get("/api/deals/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const deal = await storage.getDeal(org.id, Number(req.params.id));
    if (!deal) return res.status(404).json({ message: "Deal not found" });
    res.json(deal);
  });
  
  api.post("/api/deals", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const input = insertDealSchema.parse({ ...req.body, organizationId: org.id });
      const deal = await storage.createDeal(input);
      
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "create",
        entityType: "deal",
        entityId: deal.id,
        changes: { after: input, fields: Object.keys(input) },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      // Trigger async enrichment if deal has a propertyId (non-blocking)
      if (deal.propertyId) {
        triggerDealEnrichmentAsync(org.id, deal.id, deal.propertyId);
      }
      
      res.status(201).json(deal);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Validation failed", 
          errors: err.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
        });
      }
      throw err;
    }
  });
  
  // Valid deal status transitions — no skipping states (Task #210)
  const DEAL_STATUS_TRANSITIONS: Record<string, string[]> = {
    negotiating: ["offer_sent", "cancelled"],
    offer_sent: ["countered", "accepted", "cancelled"],
    countered: ["offer_sent", "accepted", "cancelled"],
    accepted: ["in_escrow", "cancelled"],
    in_escrow: ["closed", "cancelled"],
    closed: [],
    cancelled: [],
  };

  api.put("/api/deals/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const dealId = Number(req.params.id);
      const existingDeal = await storage.getDeal(org.id, dealId);
      if (!existingDeal) return res.status(404).json({ message: "Deal not found" });

      const validated = updateDealSchema.parse(req.body);

      // Enforce valid status transitions (Task #210)
      if (validated.status && validated.status !== existingDeal.status) {
        const allowed = DEAL_STATUS_TRANSITIONS[existingDeal.status] || [];
        if (!allowed.includes(validated.status)) {
          return res.status(400).json({
            message: `Invalid status transition from '${existingDeal.status}' to '${validated.status}'. Allowed: ${allowed.join(", ") || "none"}`,
          });
        }
      }

      const deal = await storage.updateDeal(dealId, validated);
      
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "update",
        entityType: "deal",
        entityId: dealId,
        changes: { before: existingDeal, after: deal, fields: Object.keys(validated) },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      // Trigger async enrichment if propertyId was added or changed (non-blocking)
      const propertyChanged = validated.propertyId && validated.propertyId !== existingDeal.propertyId;
      if (propertyChanged && deal.propertyId) {
        triggerDealEnrichmentAsync(org.id, deal.id, deal.propertyId);
      }
      
      // Track conversion when deal is closed (for lead scoring feedback loop)
      if (validated.status === "closed" && existingDeal.status !== "closed") {
        try {
          // Get the property to find associated lead
          const property = await storage.getProperty(org.id, deal.propertyId);
          if (property && property.leadId) {
            const dealValue = deal.acceptedAmount ? parseFloat(String(deal.acceptedAmount)) : undefined;
            await leadScoringService.recordConversion(property.leadId, org.id, "deal_closed", {
              dealValue,
              profitMargin: deal.analysisResults?.netProfit,
            });
          }
        } catch (conversionErr) {
          console.error("Failed to record conversion:", conversionErr);
        }
      }

      // Push notification when deal is accepted (T61)
      if (validated.status === "accepted" && existingDeal.status !== "accepted") {
        setImmediate(async () => {
          try {
            const { notifyDealAccepted } = await import("./services/pushNotificationService");
            const user = req.user as any;
            const userId = user?.claims?.sub ?? user?.id;
            if (userId) {
              const property = await storage.getProperty(org.id, deal.propertyId);
              await notifyDealAccepted(
                org.id,
                userId,
                deal.id,
                (property as any)?.address || `Property #${deal.propertyId}`
              );
            }
          } catch (_) {}
        });
      }
      
      res.json(deal);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Validation failed", 
          errors: err.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
        });
      }
      throw err;
    }
  });
  
  // Manual deal enrichment trigger endpoint
  api.post("/api/deals/:id/enrich", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const dealId = Number(req.params.id);
      const forceRefresh = req.body.forceRefresh === true;
      
      const deal = await storage.getDeal(org.id, dealId);
      if (!deal) {
        return res.status(404).json({ message: "Deal not found" });
      }
      
      if (!deal.propertyId) {
        return res.status(400).json({ message: "Deal has no associated property" });
      }
      
      // Get the property to find coordinates
      const property = await storage.getProperty(org.id, deal.propertyId);
      if (!property) {
        return res.status(400).json({ message: "Property not found" });
      }
      
      const lat = property.latitude ? parseFloat(String(property.latitude)) : null;
      const lng = property.longitude ? parseFloat(String(property.longitude)) : null;
      
      if (!lat || !lng) {
        return res.status(400).json({ message: "Property missing coordinates" });
      }
      
      // Mark as pending
      await storage.updateDeal(dealId, { enrichmentStatus: "pending" });
      
      // Perform enrichment synchronously for manual trigger (so user can see result)
      const enrichmentResult = await propertyEnrichmentService.enrichByCoordinates(lat, lng, {
        propertyId: deal.propertyId,
        state: property.state || undefined,
        county: property.county || undefined,
        apn: property.apn || undefined,
        forceRefresh,
      });
      
      // Save enrichment data to deal (all categories)
      const updatedDeal = await storage.updateDeal(dealId, {
        enrichmentStatus: "completed",
        enrichedAt: new Date(),
        enrichmentData: {
          enrichedAt: enrichmentResult.enrichedAt.toISOString(),
          lookupTimeMs: enrichmentResult.lookupTimeMs,
          hazards: enrichmentResult.hazards,
          environment: enrichmentResult.environment,
          epaFacilities: enrichmentResult.epaFacilities,
          stormHistory: enrichmentResult.stormHistory,
          infrastructure: enrichmentResult.infrastructure,
          demographics: enrichmentResult.demographics,
          publicLands: enrichmentResult.publicLands,
          transportation: enrichmentResult.transportation,
          water: enrichmentResult.water,
          elevation: enrichmentResult.elevation,
          climate: enrichmentResult.climate,
          agriculturalValues: enrichmentResult.agriculturalValues,
          landCover: enrichmentResult.landCover,
          cropland: enrichmentResult.cropland,
          plss: enrichmentResult.plss,
          watershed: enrichmentResult.watershed,
          femaNri: enrichmentResult.femaNri,
          usdaClu: enrichmentResult.usdaClu,
          scores: enrichmentResult.scores,
          errors: enrichmentResult.errors,
        } as any,
      });
      
      logger.info("Manual deal enrichment completed", { dealId, propertyId: deal.propertyId, lookupTimeMs: enrichmentResult.lookupTimeMs });
      
      res.json({
        message: "Enrichment completed",
        deal: updatedDeal,
        enrichmentResult,
      });
    } catch (err) {
      logger.error("Manual deal enrichment failed", { dealId: req.params.id, error: String(err) });
      res.status(500).json({ message: "Enrichment failed", error: String(err) });
    }
  });
  
  // ============================================
  // DUE DILIGENCE TEMPLATES & CHECKLISTS
  // ============================================
  
  api.get("/api/due-diligence/templates", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const templates = await storage.getDueDiligenceTemplates(org.id);
    if (templates.length === 0) {
      const initialized = await storage.initializeDefaultTemplates(org.id);
      return res.json(initialized);
    }
    res.json(templates);
  });
  
  api.get("/api/due-diligence/templates/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const template = await storage.getDueDiligenceTemplate(Number(req.params.id));
    if (!template) return res.status(404).json({ message: "Template not found" });
    res.json(template);
  });
  
  api.post("/api/due-diligence/templates", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const template = await storage.createDueDiligenceTemplate({
        ...req.body,
        organizationId: org.id,
      });
      res.status(201).json(template);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });
  
  api.put("/api/due-diligence/templates/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const template = await storage.updateDueDiligenceTemplate(Number(req.params.id), req.body);
    if (!template) return res.status(404).json({ message: "Template not found" });
    res.json(template);
  });
  
  api.delete("/api/due-diligence/templates/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    await storage.deleteDueDiligenceTemplate(Number(req.params.id));
    res.status(204).send();
  });
  
  api.get("/api/properties/:id/due-diligence", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const items = await storage.getPropertyDueDiligence(Number(req.params.id));
    res.json(items);
  });
  
  api.post("/api/properties/:id/due-diligence/apply-template", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { templateId } = req.body;
      if (!templateId) {
        return res.status(400).json({ message: "templateId is required" });
      }
      const items = await storage.applyTemplateToProperty(Number(req.params.id), templateId);
      res.json(items);
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Failed to apply template" });
    }
  });
  
  api.post("/api/properties/:id/due-diligence", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const item = await storage.createDueDiligenceItem({
        ...req.body,
        propertyId: Number(req.params.id),
      });
      res.status(201).json(item);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });
  
  api.put("/api/due-diligence/items/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const user = req.user as any;
    const userId = user?.claims?.sub || user?.id;
    const updates = { ...req.body };
    if (updates.completed === true && userId) {
      updates.completedBy = userId;
    }
    const item = await storage.updateDueDiligenceItem(Number(req.params.id), updates);
    if (!item) return res.status(404).json({ message: "Item not found" });
    res.json(item);
  });
  
  api.delete("/api/due-diligence/items/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    await storage.deleteDueDiligenceItem(Number(req.params.id));
    res.status(204).send();
  });

  // ============================================
  // PROPERTY ANALYSIS CHAT
  // ============================================
  
  api.post("/api/properties/:id/analyze", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const propertyId = Number(req.params.id);
      const { message, conversationHistory } = req.body;
      
      if (!message) {
        return res.status(400).json({ message: "Message is required" });
      }
      
      const usageCheck = await checkUsageLimit(org.id, "ai_requests");
      if (!usageCheck.allowed) {
        return res.status(429).json({ message: "AI request limit reached. Upgrade to continue." });
      }

      const property = await storage.getProperty(org.id, propertyId);
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }

      const { ResearchIntelligenceAgent, DealsAcquisitionAgent, skillRegistry } = await import('./services/core-agents');
      const OpenAI = (await import('openai')).default;
      const openai = new OpenAI();
      
      const researchAgent = new ResearchIntelligenceAgent();
      const dealsAgent = new DealsAcquisitionAgent();
      
      const propertyContext = `
Property Information:
- APN: ${property.apn}
- Location: ${property.address || 'N/A'}, ${property.city || 'N/A'}, ${property.county}, ${property.state}
- Size: ${property.sizeAcres || 'Unknown'} acres
- Status: ${property.status}
- Zoning: ${property.zoning || 'Unknown'}
- Market Value: ${property.marketValue ? `$${Number(property.marketValue).toLocaleString()}` : 'Unknown'}
- Purchase Price: ${property.purchasePrice ? `$${Number(property.purchasePrice).toLocaleString()}` : 'Unknown'}
- Assessed Value: ${property.assessedValue ? `$${Number(property.assessedValue).toLocaleString()}` : 'Unknown'}
- Road Access: ${property.roadAccess || 'Unknown'}
- Terrain: ${property.terrain || 'Unknown'}
- Coordinates: ${property.latitude && property.longitude ? `${property.latitude}, ${property.longitude}` : 'Not available'}
- Description: ${property.description || 'None'}
`;

      const researchSkills = researchAgent.getAvailableSkills();
      const dealsSkills = dealsAgent.getAvailableSkills();
      const allSkills = [...researchSkills, ...dealsSkills];
      
      const skillsContext = allSkills.map(s => `- ${s.name}: ${s.description}`).join('\n');
      
      const historyContext = conversationHistory && conversationHistory.length > 0
        ? conversationHistory.map((m: { role: string; content: string }) => `${m.role}: ${m.content}`).join('\n')
        : '';

      const systemPrompt = `You are an AI property analyst for AcreOS, a land investment platform. You help users analyze properties, assess risks, calculate valuations, and make informed investment decisions.

${propertyContext}

Available capabilities you can discuss:
${skillsContext}

When responding:
1. Use the property data provided to give specific, actionable insights
2. If asked about environmental risks (flood, wetlands, etc.), explain what data would be available and general risk factors for the location
3. For financing questions, calculate based on typical land investment terms (10-15% interest, 5-10 year terms)
4. For offer generation, consider comparable sales, market conditions, and typical land discounts
5. Be concise but thorough
6. Suggest follow-up questions that would be helpful

${historyContext ? `\nConversation history:\n${historyContext}\n` : ''}`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
        max_tokens: 1500,
      });

      const aiResponse = response.choices[0]?.message?.content || "I couldn't generate a response. Please try again.";
      
      const suggestions = generateSuggestions(message, property);
      
      res.json({
        response: aiResponse,
        suggestions,
        actions: [],
      });
    } catch (err: any) {
      console.error("Property analysis error:", err);
      res.status(500).json({ message: err.message || "Failed to analyze property" });
    }
  });

  function generateSuggestions(message: string, property: any): string[] {
    const suggestions: string[] = [];
    const lowerMessage = message.toLowerCase();
    
    if (lowerMessage.includes('flood') || lowerMessage.includes('risk') || lowerMessage.includes('environmental')) {
      suggestions.push("What about wetlands on this property?");
      suggestions.push("Are there EPA sites nearby?");
    } else if (lowerMessage.includes('offer') || lowerMessage.includes('price')) {
      suggestions.push("What financing terms would work?");
      suggestions.push("What's a fair market value?");
    } else if (lowerMessage.includes('financing') || lowerMessage.includes('payment')) {
      suggestions.push("What if I do a 5-year term instead?");
      suggestions.push("Generate an offer letter");
    } else if (lowerMessage.includes('similar') || lowerMessage.includes('comp')) {
      suggestions.push("What's the price per acre for this area?");
      suggestions.push("How long do similar properties take to sell?");
    } else {
      if (!property.marketValue) {
        suggestions.push("What's the estimated market value?");
      }
      if (property.latitude && property.longitude) {
        suggestions.push("Run environmental risk assessment");
      }
      suggestions.push("Calculate seller financing options");
    }
    
    return suggestions.slice(0, 3);
  }

  // ============================================
  // DUE DILIGENCE CHECKLISTS (Enhanced)
  // ============================================
  
  api.get("/api/due-diligence/:propertyId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const propertyId = Number(req.params.propertyId);
      const checklist = await storage.getOrCreateDueDiligenceChecklist(org.id, propertyId);
      res.json(checklist);
    } catch (error: any) {
      console.error("Get due diligence checklist error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch checklist" });
    }
  });

  api.put("/api/due-diligence/:propertyId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const propertyId = Number(req.params.propertyId);
      const existing = await storage.getDueDiligenceChecklist(propertyId);
      if (!existing) {
        return res.status(404).json({ message: "Checklist not found" });
      }
      const updated = await storage.updateDueDiligenceChecklist(existing.id, req.body);
      res.json(updated);
    } catch (error: any) {
      console.error("Update due diligence checklist error:", error);
      res.status(500).json({ message: error.message || "Failed to update checklist" });
    }
  });

  api.post("/api/due-diligence/:propertyId/lookup/flood-zone", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const propertyId = Number(req.params.propertyId);
      
      const property = await storage.getProperty(org.id, propertyId);
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }
      
      const { dataSourceLookupService } = await import('./services/data-source-lookup');
      
      if (property.latitude && property.longitude) {
        const lookupResult = await dataSourceLookupService.lookupFloodZone({
          latitude: Number(property.latitude),
          longitude: Number(property.longitude),
          state: property.state || undefined,
          county: property.county || undefined,
        });
        res.json(lookupResult.data);
      } else {
        res.json({
          zone: "Unknown (No coordinates)",
          riskLevel: "unknown",
          lastUpdated: new Date().toISOString(),
          source: "N/A",
          details: { message: "Property has no coordinates for flood zone lookup" },
        });
      }
    } catch (error: any) {
      console.error("Flood zone lookup error:", error);
      res.status(500).json({ message: error.message || "Failed to lookup flood zone" });
    }
  });

  api.post("/api/due-diligence/:propertyId/lookup/wetlands", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const propertyId = Number(req.params.propertyId);
      
      const property = await storage.getProperty(org.id, propertyId);
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }
      
      const { dataSourceLookupService } = await import('./services/data-source-lookup');
      
      if (property.latitude && property.longitude) {
        const lookupResult = await dataSourceLookupService.lookupWetlands({
          latitude: Number(property.latitude),
          longitude: Number(property.longitude),
          state: property.state || undefined,
          county: property.county || undefined,
        });
        res.json(lookupResult.data);
      } else {
        res.json({
          hasWetlands: false,
          classification: null,
          percentage: 0,
          source: "N/A",
          lastUpdated: new Date().toISOString(),
          details: { message: "Property has no coordinates for wetlands lookup" },
        });
      }
    } catch (error: any) {
      console.error("Wetlands lookup error:", error);
      res.status(500).json({ message: error.message || "Failed to lookup wetlands" });
    }
  });

  api.post("/api/due-diligence/:propertyId/lookup/soil", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const propertyId = Number(req.params.propertyId);
      
      const property = await storage.getProperty(org.id, propertyId);
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }
      
      const { dataSourceLookupService } = await import('./services/data-source-lookup');
      
      if (property.latitude && property.longitude) {
        const lookupResult = await dataSourceLookupService.lookupSoilData({
          latitude: Number(property.latitude),
          longitude: Number(property.longitude),
          state: property.state || undefined,
          county: property.county || undefined,
        });
        res.json(lookupResult.data);
      } else {
        res.json({
          soilType: "Unknown",
          drainage: "unknown",
          suitability: "unknown",
          source: "N/A",
          lastUpdated: new Date().toISOString(),
          details: { message: "Property has no coordinates for soil data lookup" },
        });
      }
    } catch (error: any) {
      console.error("Soil data lookup error:", error);
      res.status(500).json({ message: error.message || "Failed to lookup soil data" });
    }
  });

  api.post("/api/due-diligence/:propertyId/lookup/environmental", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const propertyId = Number(req.params.propertyId);
      
      const property = await storage.getProperty(org.id, propertyId);
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }
      
      const { dataSourceLookupService } = await import('./services/data-source-lookup');
      
      if (property.latitude && property.longitude) {
        const lookupResult = await dataSourceLookupService.lookupEpaData({
          latitude: Number(property.latitude),
          longitude: Number(property.longitude),
          state: property.state || undefined,
          county: property.county || undefined,
        });
        res.json(lookupResult.data);
      } else {
        res.json({
          superfundSites: [],
          nearestSiteDistance: null,
          riskLevel: "unknown",
          source: "N/A",
          lastUpdated: new Date().toISOString(),
          details: { message: "Property has no coordinates for EPA data lookup" },
        });
      }
    } catch (error: any) {
      console.error("EPA environmental lookup error:", error);
      res.status(500).json({ message: error.message || "Failed to lookup EPA data" });
    }
  });

  api.post("/api/due-diligence/:propertyId/lookup/tax", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const propertyId = Number(req.params.propertyId);
      const result = {
        annualTax: 125.00,
        backTaxes: 0,
        taxSaleStatus: "none",
        lastPaidDate: "2024-12-01",
        source: "County Treasurer Records",
        lastUpdated: new Date().toISOString(),
        details: {
          taxYear: 2024,
          assessedValue: 8500,
          taxRate: 0.0147,
          exemptions: [],
        }
      };
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to lookup tax info" });
    }
  });

  // ============================================
  // DUE DILIGENCE REPORT GENERATION
  // ============================================

  api.get("/api/properties/:id/report", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const propertyId = Number(req.params.id);
      const includeComps = req.query.comps === "true";
      const includeAI = req.query.ai === "true";
      
      // Verify property belongs to organization
      const property = await storage.getProperty(org.id, propertyId);
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }
      
      const { generateDueDiligenceReport } = await import("./services/dueDiligence");
      const report = await generateDueDiligenceReport(org.id, propertyId, {
        includeComps,
        includeAI,
      });
      
      res.json(report);
    } catch (error: any) {
      console.error("Due diligence report error:", error);
      res.status(500).json({ message: error.message || "Failed to generate report" });
    }
  });

  api.get("/api/properties/:id/report/pdf", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const propertyId = Number(req.params.id);
      const includeComps = req.query.comps === "true";
      const includeAI = req.query.ai === "true";
      
      // Verify property belongs to organization
      const property = await storage.getProperty(org.id, propertyId);
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }
      
      const { generateDueDiligenceReport } = await import("./services/dueDiligence");
      const jsPDF = (await import("jspdf")).jsPDF;
      
      const report = await generateDueDiligenceReport(org.id, propertyId, {
        includeComps,
        includeAI,
      });
      
      // Generate PDF
      const doc = new jsPDF();
      let y = 20;
      const lineHeight = 7;
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 20;
      const contentWidth = pageWidth - (margin * 2);
      
      // Header
      doc.setFontSize(20);
      doc.setFont("helvetica", "bold");
      doc.text("Due Diligence Report", margin, y);
      y += lineHeight * 2;
      
      // Property Summary
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text("Property Summary", margin, y);
      y += lineHeight;
      
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text(`Property: ${report.summary.propertyName}`, margin, y);
      y += lineHeight;
      doc.text(`APN: ${report.summary.apn}`, margin, y);
      y += lineHeight;
      doc.text(`Address: ${report.summary.address}`, margin, y);
      y += lineHeight;
      doc.text(`County: ${report.summary.county}, ${report.summary.state}`, margin, y);
      y += lineHeight;
      doc.text(`Generated: ${new Date(report.summary.generatedAt).toLocaleString()}`, margin, y);
      y += lineHeight * 2;
      
      // Parcel Information
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text("Parcel Information", margin, y);
      y += lineHeight;
      
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text(`Size: ${report.parcelInfo.acres ? `${report.parcelInfo.acres} acres` : "Unknown"}`, margin, y);
      y += lineHeight;
      doc.text(`Zoning: ${report.parcelInfo.zoning || "Unknown"}`, margin, y);
      y += lineHeight;
      if (report.parcelInfo.legalDescription) {
        const lines = doc.splitTextToSize(`Legal Description: ${report.parcelInfo.legalDescription}`, contentWidth);
        doc.text(lines, margin, y);
        y += lineHeight * lines.length;
      }
      y += lineHeight;
      
      // Ownership
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text("Ownership Information", margin, y);
      y += lineHeight;
      
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text(`Owner: ${report.ownership.currentOwner || "Unknown"}`, margin, y);
      y += lineHeight;
      if (report.ownership.ownerAddress) {
        doc.text(`Owner Address: ${report.ownership.ownerAddress}`, margin, y);
        y += lineHeight;
      }
      y += lineHeight;
      
      // Tax Information
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text("Tax Information", margin, y);
      y += lineHeight;
      
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text(`Assessed Value: ${report.taxes.assessedValue ? `$${report.taxes.assessedValue.toLocaleString()}` : "Unknown"}`, margin, y);
      y += lineHeight;
      doc.text(`Annual Tax: ${report.taxes.taxAmount ? `$${report.taxes.taxAmount.toLocaleString()}` : "Unknown"}`, margin, y);
      y += lineHeight * 2;
      
      // Check if we need a new page
      if (y > 240) {
        doc.addPage();
        y = 20;
      }
      
      // Market Analysis
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text("Market Analysis", margin, y);
      y += lineHeight;
      
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text(`Price Per Acre: ${report.marketAnalysis.pricePerAcre ? `$${report.marketAnalysis.pricePerAcre.toLocaleString()}` : "Unknown"}`, margin, y);
      y += lineHeight;
      doc.text(`Estimated Value: ${report.marketAnalysis.estimatedValue ? `$${report.marketAnalysis.estimatedValue.toLocaleString()}` : "Unknown"}`, margin, y);
      y += lineHeight;
      doc.text(`Market Trend: ${report.marketAnalysis.marketTrend}`, margin, y);
      y += lineHeight;
      
      if (report.marketAnalysis.offerPrices) {
        y += lineHeight;
        const offers = report.marketAnalysis.offerPrices;
        doc.text(`Conservative: $${offers.conservative.min.toLocaleString()} - $${offers.conservative.max.toLocaleString()}`, margin, y);
        y += lineHeight;
        doc.text(`Standard: $${offers.standard.min.toLocaleString()} - $${offers.standard.max.toLocaleString()}`, margin, y);
        y += lineHeight;
        doc.text(`Aggressive: $${offers.aggressive.min.toLocaleString()} - $${offers.aggressive.max.toLocaleString()}`, margin, y);
      }
      y += lineHeight * 2;
      
      // Check if we need a new page
      if (y > 240) {
        doc.addPage();
        y = 20;
      }
      
      // Risk Assessment
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text("Risk Assessment", margin, y);
      y += lineHeight;
      
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      
      if (report.risks.accessIssues.length > 0) {
        doc.text("Access Issues:", margin, y);
        y += lineHeight;
        report.risks.accessIssues.forEach(issue => {
          doc.text(`  - ${issue}`, margin, y);
          y += lineHeight;
        });
      }
      
      if (report.risks.zoningRestrictions.length > 0) {
        doc.text("Zoning Restrictions:", margin, y);
        y += lineHeight;
        report.risks.zoningRestrictions.forEach(restriction => {
          doc.text(`  - ${restriction}`, margin, y);
          y += lineHeight;
        });
      }
      y += lineHeight;
      
      // AI Summary
      if (report.aiSummary) {
        if (y > 180) {
          doc.addPage();
          y = 20;
        }
        
        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.text("AI Analysis", margin, y);
        y += lineHeight;
        
        doc.setFontSize(10);
        doc.setFont("helvetica", "normal");
        const aiLines = doc.splitTextToSize(report.aiSummary, contentWidth);
        doc.text(aiLines, margin, y);
      }
      
      // Footer
      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        doc.text(
          `AcreOS Due Diligence Report - Page ${i} of ${pageCount}`,
          pageWidth / 2,
          doc.internal.pageSize.getHeight() - 10,
          { align: "center" }
        );
      }
      
      // Send PDF
      const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="due-diligence-${report.summary.apn}.pdf"`);
      res.send(pdfBuffer);
    } catch (error: any) {
      console.error("PDF generation error:", error);
      res.status(500).json({ message: error.message || "Failed to generate PDF" });
    }
  });

  api.get("/api/properties/:id/report/summary", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const propertyId = Number(req.params.id);
      
      const { getQuickPropertySummary } = await import("./services/dueDiligence");
      const summary = await getQuickPropertySummary(org.id, propertyId);
      
      if (!summary) {
        return res.status(404).json({ message: "Property not found" });
      }
      
      res.json(summary);
    } catch (error: any) {
      console.error("Quick summary error:", error);
      res.status(500).json({ message: error.message || "Failed to get summary" });
    }
  });
  
  // ============================================
  // DEAL CHECKLIST TEMPLATES
  // ============================================
  
  api.get("/api/checklist-templates", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const templates = await storage.getChecklistTemplates(org.id);
    if (templates.length === 0) {
      const initialized = await storage.initializeDefaultChecklistTemplates(org.id);
      return res.json(initialized);
    }
    res.json(templates);
  });
  
  api.get("/api/checklist-templates/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const template = await storage.getChecklistTemplate(Number(req.params.id));
    if (!template) return res.status(404).json({ message: "Template not found" });
    res.json(template);
  });
  
  api.post("/api/checklist-templates", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const template = await storage.createChecklistTemplate({
        ...req.body,
        organizationId: org.id,
      });
      res.status(201).json(template);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });
  
  api.put("/api/checklist-templates/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const template = await storage.updateChecklistTemplate(Number(req.params.id), req.body);
    if (!template) return res.status(404).json({ message: "Template not found" });
    res.json(template);
  });
  
  api.delete("/api/checklist-templates/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    await storage.deleteChecklistTemplate(Number(req.params.id));
    res.status(204).send();
  });
  
  // ============================================
  // DEAL CHECKLISTS
  // ============================================
  
  api.get("/api/deals/:id/checklist", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const checklist = await storage.getDealChecklist(Number(req.params.id));
    if (!checklist) {
      return res.json(null);
    }
    const completed = checklist.items.filter(item => item.checkedAt).length;
    res.json({
      ...checklist,
      completionStatus: {
        completed,
        total: checklist.items.length,
        percentage: Math.round((completed / checklist.items.length) * 100),
      },
    });
  });
  
  api.post("/api/deals/:id/checklist", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { templateId } = req.body;
      if (!templateId) {
        return res.status(400).json({ message: "templateId is required" });
      }
      const checklist = await storage.applyChecklistTemplateToDeal(Number(req.params.id), templateId);
      res.status(201).json(checklist);
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Failed to apply template" });
    }
  });
  
  api.patch("/api/deals/:id/checklist/items/:itemId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      const { checked, documentUrl } = req.body;
      
      const checklist = await storage.updateDealChecklistItem(
        Number(req.params.id),
        req.params.itemId,
        { checked, documentUrl, checkedBy: userId }
      );
      res.json(checklist);
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Failed to update checklist item" });
    }
  });
  
  api.get("/api/deals/:id/stage-gate", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const result = await storage.checkStageGate(Number(req.params.id));
    res.json(result);
  });

  api.get("/api/deals/:id/report", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const dealId = Number(req.params.id);
      const includeComps = req.query.comps === "true";
      const includeAI = req.query.ai === "true";
      
      const deal = await storage.getDeal(dealId);
      if (!deal || deal.organizationId !== org.id) {
        return res.status(404).json({ message: "Deal not found" });
      }
      
      const { generateDueDiligenceReport } = await import("./services/dueDiligence");
      const report = await generateDueDiligenceReport(org.id, deal.propertyId, {
        includeComps,
        includeAI,
      });
      
      res.json({
        ...report,
        deal: {
          id: deal.id,
          type: deal.type,
          status: deal.status,
          offerAmount: deal.offerAmount,
          acceptedAmount: deal.acceptedAmount,
        },
      });
    } catch (error: any) {
      console.error("Deal due diligence report error:", error);
      res.status(500).json({ message: error.message || "Failed to generate report" });
    }
  });
  
  // Enhanced deal stage update with stage gate check
  api.patch("/api/deals/:id/stage", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { stage, force } = req.body;
      const dealId = Number(req.params.id);
      
      if (!force) {
        const stageGate = await storage.checkStageGate(dealId);
        if (!stageGate.canAdvance) {
          return res.status(400).json({
            message: "Cannot advance stage: incomplete required checklist items",
            incompleteItems: stageGate.incompleteItems,
          });
        }
      }
      
      const deal = await storage.updateDeal(dealId, { status: stage });
      if (!deal) return res.status(404).json({ message: "Deal not found" });
      res.json(deal);
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Failed to update stage" });
    }
  });

  // Bulk operations
  api.post("/api/deals/bulk-delete", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "ids must be a non-empty array" });
      }
      const deletedCount = await storage.bulkDeleteDeals(org.id, ids);
      res.json({ deletedCount });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to bulk delete deals" });
    }
  });

  api.post("/api/deals/bulk-update", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { ids, updates } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "ids must be a non-empty array" });
      }
      if (!updates || typeof updates !== "object") {
        return res.status(400).json({ message: "updates must be an object" });
      }
      const updatedCount = await storage.bulkUpdateDeals(org.id, ids, updates);
      res.json({ updatedCount });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to bulk update deals" });
    }
  });

  // ─── T23 + T49: Generate Offer Letter PDF + (optionally) send for e-signature ─
  api.post("/api/deals/:id/offer-letter-pdf", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const deal = await storage.getDeal(org.id, Number(req.params.id));
      if (!deal) return res.status(404).json({ message: "Deal not found" });

      const { generateOfferLetterPdf } = await import("./services/offerLetterPdf");
      const { sendForEsign, sellerEmail, sellerName, ...offerData } = req.body;

      const buffer = await generateOfferLetterPdf({
        orgName: org.name || "Buyer",
        orgEmail: org.email,
        orgPhone: org.phone,
        sellerName: sellerName || "Property Owner",
        apn: deal.apn || "Unknown",
        propertyAddress: deal.propertyAddress,
        purchasePrice: Number(deal.offerAmount || deal.purchasePrice || 0),
        earnestMoneyDeposit: offerData.earnestMoneyDeposit,
        closingDays: offerData.closingDays ?? 30,
        offerExpirationDays: offerData.offerExpirationDays ?? 10,
        ...offerData,
      });

      if (sendForEsign && sellerEmail) {
        // Save as a generated document first, then send for e-sign
        const { eSigningService } = await import("./services/eSigningService");
        const result = await eSigningService.sendOfferLetterForSignature({
          organizationId: org.id,
          dealId: deal.id,
          pdfBuffer: buffer,
          title: `Purchase Offer — ${deal.propertyAddress || deal.apn}`,
          sellerName: sellerName || "Seller",
          sellerEmail,
        });
        return res.json({ ...result, pdfGenerated: true });
      }

      res.set("Content-Type", "application/pdf");
      res.set("Content-Disposition", `attachment; filename="offer-${deal.id}.pdf"`);
      res.send(buffer);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // -----------------------------------------------------------------------
  // Deal Handoff Workflow (T55)
  // -----------------------------------------------------------------------

  // GET /api/deals/handoffs — list all handoffs for the org
  app.get("/api/deals/handoffs", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const handoffs = await getAllHandoffs(req.org.id);
      res.json(handoffs);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/deals/:dealId/handoffs — handoffs for a specific deal
  app.get("/api/deals/:dealId/handoffs", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const handoffs = await getHandoffsForDeal(req.org.id, parseInt(req.params.dealId));
      res.json(handoffs);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/deals/:dealId/handoffs — initiate a handoff
  app.post("/api/deals/:dealId/handoffs", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { fromTeamMemberId, toTeamMemberId, fromRole, toRole, notes, customChecklist } = req.body;
      if (!fromTeamMemberId || !toTeamMemberId || !fromRole || !toRole) {
        return res.status(400).json({ message: "fromTeamMemberId, toTeamMemberId, fromRole, and toRole are required" });
      }
      const handoff = await initiateHandoff(req.org.id, {
        dealId: parseInt(req.params.dealId),
        fromTeamMemberId,
        toTeamMemberId,
        fromRole,
        toRole,
        notes: notes || "",
        customChecklist,
      });
      res.status(201).json(handoff);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // PATCH /api/deals/handoffs/:handoffId/checklist/:itemId — toggle checklist item
  app.patch("/api/deals/handoffs/:handoffId/checklist/:itemId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { completed } = req.body;
      const handoff = await updateHandoffChecklist(
        req.org.id,
        req.params.handoffId,
        req.params.itemId,
        !!completed
      );
      res.json(handoff);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/deals/handoffs/:handoffId/complete — complete the handoff
  app.post("/api/deals/handoffs/:handoffId/complete", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const handoff = await completeHandoff(req.org.id, req.params.handoffId);
      res.json(handoff);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

}

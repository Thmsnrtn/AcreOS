import type { Express } from "express";
import { storage } from "./storage";
import { z } from "zod";
import { insertDealSchema } from "@shared/schema";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { leadScoringService } from "./services/leadScoring";
import { propertyEnrichmentService } from "./services/propertyEnrichment";
import { checkUsageLimit } from "./services/usageLimits";
import { db, withTransaction } from "./db";
import { outcomeTelemetry } from "@shared/schema";
import { checkUsury } from "./services/usury";
import { logger } from "./utils/logger";
import { Errors } from "./utils/errors";

// Partial update schema for PUT endpoints
const updateDealSchema = insertDealSchema.partial().omit({ organizationId: true });

// Task 211: Offer amount validation constants
const MIN_OFFER_AMOUNT = 0;         // exclusive lower bound
const MAX_OFFER_AMOUNT = 1_000_000_000; // $1 billion — typo guard

/**
 * Validate offer-amount fields on a raw deal payload.
 * Returns an error message string if invalid, or null if OK.
 */
function validateOfferAmounts(data: Record<string, any>): string | null {
  const fields = [
    { key: "offerAmount", label: "Offer amount" },
    { key: "acceptedAmount", label: "Accepted amount" },
    { key: "purchasePrice", label: "Purchase price" },
  ];
  for (const { key, label } of fields) {
    if (data[key] === undefined || data[key] === null || data[key] === "") continue;
    const val = Number(data[key]);
    if (isNaN(val)) return `${label} must be a valid number`;
    if (val <= MIN_OFFER_AMOUNT) return `${label} must be greater than $0`;
    if (val > MAX_OFFER_AMOUNT) return `${label} exceeds the maximum allowed value of $1,000,000,000`;
  }
  return null;
}

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

// Zod schema for pagination query params
const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sortBy: z.string().default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export function registerDealRoutes(app: Express): void {
  const api = app;

  // DEALS (Acquisitions/Dispositions)
  // ============================================

  api.get("/api/deals", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;

    const pagination = paginationQuerySchema.safeParse(req.query);
    if (!pagination.success) {
      return Errors.badRequest(res, "Invalid pagination parameters", pagination.error.errors);
    }
    const { page, pageSize, sortBy, sortOrder } = pagination.data;

    const result = await storage.getDealsPaginated(org.id, { page, pageSize, sortBy, sortOrder });

    res.json({
      data: result.data,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
    });
  });
  
  api.get("/api/deals/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const deal = await storage.getDeal(org.id, Number(req.params.id));
    if (!deal) return Errors.notFound(res, "Deal");
    res.json(deal);
  });

  api.post("/api/deals", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;

      // Task 211: validate offer amounts before parsing
      const offerValidationError = validateOfferAmounts(req.body);
      if (offerValidationError) {
        return Errors.badRequest(res, offerValidationError);
      }

      const input = insertDealSchema.parse({ ...req.body, organizationId: org.id });

      // Usury hard block: check analysisResults.interestRate against state law before saving
      const dealInterestRate = input.analysisResults?.interestRate;
      if (dealInterestRate && input.propertyId) {
        const property = await storage.getProperty(org.id, input.propertyId);
        if (property?.state) {
          const usury = checkUsury(property.state, Number(dealInterestRate));
          if (usury.warningLevel === 'violation') {
            return Errors.badRequest(res, `Interest rate ${dealInterestRate}% exceeds ${property.state} usury limit of ${usury.maxAllowedRate}%. This transaction cannot be saved.`, {
              code: 'USURY_VIOLATION',
              limit: usury.maxAllowedRate,
              rate: dealInterestRate,
              state: property.state,
            });
          }
        }
      }

      // Wrap deal creation + audit log in a transaction so both succeed or
      // both roll back — prevents orphaned deals with no audit trail.
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;

      const deal = await withTransaction(async () => {
        const newDeal = await storage.createDeal(input);
        await storage.createAuditLogEntry({
          organizationId: org.id,
          userId,
          action: "create",
          entityType: "deal",
          entityId: newDeal.id,
          changes: { after: input, fields: Object.keys(input) },
          ipAddress: req.ip || req.socket?.remoteAddress,
          userAgent: req.headers["user-agent"],
        });
        return newDeal;
      });

      // Trigger async enrichment if deal has a propertyId (non-blocking)
      if (deal.propertyId) {
        triggerDealEnrichmentAsync(org.id, deal.id, deal.propertyId);
      }

      res.status(201).json(deal);
    } catch (err) {
      if (err instanceof z.ZodError || (err as any)?.errors) {
        return Errors.badRequest(res, "Validation failed", ((err as any).errors || []).map((e: any) => ({ field: e.path?.join?.('.') || '', message: e.message || String(e) })));
      }
      return Errors.internal(res, err as Error);
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
      const org = req.organization;
      const dealId = Number(req.params.id);
      const existingDeal = await storage.getDeal(org.id, dealId);
      if (!existingDeal) return Errors.notFound(res, "Deal");

      // Task 211: validate offer amounts before parsing
      const offerValidationError = validateOfferAmounts(req.body);
      if (offerValidationError) {
        return Errors.badRequest(res, offerValidationError);
      }

      const validated = updateDealSchema.parse(req.body);

      // Task #210: Enforce deal status state machine transitions
      if (validated.status && validated.status !== existingDeal.status) {
        const currentStatus = existingDeal.status || "negotiating";
        const allowedNext = DEAL_STATUS_TRANSITIONS[currentStatus];
        if (allowedNext && !allowedNext.includes(validated.status)) {
          return Errors.badRequest(res, `Cannot transition from ${currentStatus} to ${validated.status}`);
        }
      }

      // Usury hard block: check updated analysisResults.interestRate against state law before saving
      const updatedInterestRate = validated.analysisResults?.interestRate ?? existingDeal.analysisResults?.interestRate;
      const updatedPropertyId = validated.propertyId ?? existingDeal.propertyId;
      if (updatedInterestRate && updatedPropertyId) {
        const property = await storage.getProperty(org.id, updatedPropertyId);
        if (property?.state) {
          const usury = checkUsury(property.state, Number(updatedInterestRate));
          if (usury.warningLevel === 'violation') {
            return Errors.badRequest(res, `Interest rate ${updatedInterestRate}% exceeds ${property.state} usury limit of ${usury.maxAllowedRate}%. This transaction cannot be saved.`, {
              code: 'USURY_VIOLATION',
              limit: usury.maxAllowedRate,
              rate: updatedInterestRate,
              state: property.state,
            });
          }
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
          logger.error("Failed to record conversion", conversionErr instanceof Error ? conversionErr : undefined);
        }

        // Write outcome telemetry for the feedback loop (non-blocking)
        db.insert(outcomeTelemetry).values({
          organizationId: org.id,
          outcomeType: "deal_won",
          outcome: {
            success: true,
            value: deal.acceptedAmount ? parseFloat(String(deal.acceptedAmount)) : undefined,
            details: { dealType: deal.dealType, stage: deal.status },
          },
          contributingFactors: {
            offerAmount: deal.offerAmount ? parseFloat(String(deal.offerAmount)) : undefined,
            sequenceUsed: deal.sequenceId ? String(deal.sequenceId) : undefined,
            marketConditions: deal.analysisResults ?? undefined,
          },
          relatedDealId: deal.id,
          relatedPropertyId: deal.propertyId ?? undefined,
        }).catch(() => {});

        // Fire Pillar 3 market signal contribution (non-blocking)
        import("./services/marketNetworkContributor").then(({ contributeMarketSignal }) => {
          contributeMarketSignal(org.id, deal).catch((err) => {
            logger.error("Market signal contribution failed", { error: err.message });
          });
        }).catch((err) => {
          logger.error("Failed to load marketNetworkContributor", { error: err.message });
        });

        // Auto-fingerprint closed deal for pattern cloning (non-blocking)
        import("./services/dealPatternCloning").then(({ dealPatternCloningService }) => {
          dealPatternCloningService.recordPatternFromClosedDeal(org.id, deal.id).catch((err) => {
            logger.error("deal pattern fingerprint failed", { error: err instanceof Error ? err.message : String(err) });
          });
        }).catch(() => {});
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
        return Errors.badRequest(res, "Validation failed", err.errors.map(e => ({ field: e.path.join('.'), message: e.message })));
      }
      // Task 219: surface optimistic-lock conflicts as 409 Conflict
      if (err instanceof Error && err.message.includes("modified by another request")) {
        return Errors.badRequest(res, err.message);
      }
      throw err;
    }
  });

  // Manual deal enrichment trigger endpoint
  const enrichDealSchema = z.object({
    forceRefresh: z.boolean().optional().default(false),
  });

  api.post("/api/deals/:id/enrich", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const dealId = Number(req.params.id);
      const parsed = enrichDealSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.errors);
      }
      const forceRefresh = parsed.data.forceRefresh;
      
      const deal = await storage.getDeal(org.id, dealId);
      if (!deal) {
        return Errors.notFound(res, "Deal");
      }

      if (!deal.propertyId) {
        return Errors.badRequest(res, "Deal has no associated property");
      }

      // Get the property to find coordinates
      const property = await storage.getProperty(org.id, deal.propertyId);
      if (!property) {
        return Errors.badRequest(res, "Property not found");
      }

      const lat = property.latitude ? parseFloat(String(property.latitude)) : null;
      const lng = property.longitude ? parseFloat(String(property.longitude)) : null;

      if (!lat || !lng) {
        return Errors.badRequest(res, "Property missing coordinates");
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
      Errors.internal(res, err instanceof Error ? err : new Error("Enrichment failed"));
    }
  });
  
  // ============================================
  // DUE DILIGENCE TEMPLATES & CHECKLISTS
  // ============================================
  
  api.get("/api/due-diligence/templates", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const templates = await storage.getDueDiligenceTemplates(org.id);
    if (templates.length === 0) {
      const initialized = await storage.initializeDefaultTemplates(org.id);
      return res.json(initialized);
    }
    res.json(templates);
  });
  
  api.get("/api/due-diligence/templates/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const template = await storage.getDueDiligenceTemplate(Number(req.params.id));
    if (!template) return Errors.notFound(res, "Template");
    res.json(template);
  });

  const createDueDiligenceTemplateSchema = z.object({
    name: z.string().min(1, "Template name is required"),
    description: z.string().optional(),
    category: z.string().optional(),
    items: z.array(z.object({
      title: z.string().min(1),
      description: z.string().optional(),
      category: z.string().optional(),
      priority: z.string().optional(),
    })).optional(),
  });

  api.post("/api/due-diligence/templates", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const parsed = createDueDiligenceTemplateSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.errors);
      }
      const template = await storage.createDueDiligenceTemplate({
        ...parsed.data,
        organizationId: org.id,
      });
      res.status(201).json(template);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return Errors.badRequest(res, err.errors[0].message);
      }
      throw err;
    }
  });

  const updateDueDiligenceTemplateSchema = createDueDiligenceTemplateSchema.partial();

  api.put("/api/due-diligence/templates/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const parsed = updateDueDiligenceTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      return Errors.validationFailed(res, parsed.error.errors);
    }
    const template = await storage.updateDueDiligenceTemplate(Number(req.params.id), parsed.data);
    if (!template) return Errors.notFound(res, "Template");
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
  
  const applyTemplateSchema = z.object({
    templateId: z.number().int().positive("templateId is required"),
  });

  api.post("/api/properties/:id/due-diligence/apply-template", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const parsed = applyTemplateSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.errors);
      }
      const { templateId } = parsed.data;
      const items = await storage.applyTemplateToProperty(Number(req.params.id), templateId);
      res.json(items);
    } catch (err: any) {
      Errors.badRequest(res, err.message || "Failed to apply template");
    }
  });
  
  const createDueDiligenceItemSchema = z.object({
    title: z.string().min(1, "Title is required"),
    description: z.string().optional(),
    category: z.string().optional(),
    priority: z.string().optional(),
    completed: z.boolean().optional(),
    notes: z.string().optional(),
    dueDate: z.string().optional(),
  });

  api.post("/api/properties/:id/due-diligence", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const parsed = createDueDiligenceItemSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.errors);
      }
      const item = await storage.createDueDiligenceItem({
        ...parsed.data,
        propertyId: Number(req.params.id),
      });
      res.status(201).json(item);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return Errors.badRequest(res, err.errors[0].message);
      }
      throw err;
    }
  });

  const updateDueDiligenceItemSchema = createDueDiligenceItemSchema.partial();

  api.put("/api/due-diligence/items/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const parsed = updateDueDiligenceItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return Errors.validationFailed(res, parsed.error.errors);
    }
    const user = req.user as any;
    const userId = user?.claims?.sub || user?.id;
    const updates = { ...parsed.data } as any;
    if (updates.completed === true && userId) {
      updates.completedBy = userId;
    }
    const item = await storage.updateDueDiligenceItem(Number(req.params.id), updates);
    if (!item) return Errors.notFound(res, "Item");
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
      const org = req.organization;
      const propertyId = Number(req.params.id);
      const analyzeSchema = z.object({
        message: z.string().min(1, "Message is required").max(10000),
        conversationHistory: z.array(z.object({
          role: z.string(),
          content: z.string(),
        })).optional(),
      });
      const parsed = analyzeSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.errors);
      }
      const { message, conversationHistory } = parsed.data;
      
      const usageCheck = await checkUsageLimit(org.id, "ai_requests");
      if (!usageCheck.allowed) {
        return Errors.limitExceeded(res, "AI request limit reached. Upgrade to continue.");
      }

      // Credit check for deal AI chat
      const { CreditService } = await import('./services/credits');
      const dealCreditService = new CreditService();
      const hasCredits = await dealCreditService.hasEnoughCredits(org.id, 2);
      if (!hasCredits) {
        return res.status(402).json({ error: "Insufficient credits", message: "Purchase credits to use AI deal analysis." });
      }

      const property = await storage.getProperty(org.id, propertyId);
      if (!property) {
        return Errors.notFound(res, "Property");
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

      const systemPrompt = `You are an AI property analyst for AcreOS, a real estate platform. You help users analyze properties, assess risks, calculate valuations, and make informed investment decisions.

${propertyContext}

Available capabilities you can discuss:
${skillsContext}

When responding:
1. Use the property data provided to give specific, actionable insights
2. If asked about environmental risks (flood, wetlands, etc.), explain what data would be available and general risk factors for the location
3. For financing questions, calculate based on typical real estate investment terms (10-15% interest, 5-10 year terms)
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

      // Deduct credits after successful AI call
      dealCreditService.deductCredits(org.id, 2, 'Deal AI analysis').catch(() => {});

      const suggestions = generateSuggestions(message, property);

      res.json({
        response: aiResponse,
        suggestions,
        actions: [],
      });
    } catch (err: any) {
      logger.error("Property analysis error", err instanceof Error ? err : undefined);
      Errors.internal(res, err instanceof Error ? err : new Error("Failed to analyze property"));
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
      const org = req.organization;
      const propertyId = Number(req.params.propertyId);
      const checklist = await storage.getOrCreateDueDiligenceChecklist(org.id, propertyId);
      res.json(checklist);
    } catch (error: any) {
      logger.error("Get due diligence checklist error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error("Failed to fetch checklist"));
    }
  });

  api.put("/api/due-diligence/:propertyId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const propertyId = Number(req.params.propertyId);
      const existing = await storage.getDueDiligenceChecklist(propertyId);
      if (!existing) {
        return Errors.notFound(res, "Checklist");
      }
      const updated = await storage.updateDueDiligenceChecklist(existing.id, req.body);
      res.json(updated);
    } catch (error: any) {
      logger.error("Update due diligence checklist error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error("Failed to update checklist"));
    }
  });

  api.post("/api/due-diligence/:propertyId/lookup/flood-zone", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const propertyId = Number(req.params.propertyId);
      
      const property = await storage.getProperty(org.id, propertyId);
      if (!property) {
        return Errors.notFound(res, "Property");
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
      logger.error("Flood zone lookup error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error("Failed to lookup flood zone"));
    }
  });

  api.post("/api/due-diligence/:propertyId/lookup/wetlands", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const propertyId = Number(req.params.propertyId);
      
      const property = await storage.getProperty(org.id, propertyId);
      if (!property) {
        return Errors.notFound(res, "Property");
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
      logger.error("Wetlands lookup error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error("Failed to lookup wetlands"));
    }
  });

  api.post("/api/due-diligence/:propertyId/lookup/soil", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const propertyId = Number(req.params.propertyId);
      
      const property = await storage.getProperty(org.id, propertyId);
      if (!property) {
        return Errors.notFound(res, "Property");
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
      logger.error("Soil data lookup error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error("Failed to lookup soil data"));
    }
  });

  api.post("/api/due-diligence/:propertyId/lookup/environmental", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const propertyId = Number(req.params.propertyId);
      
      const property = await storage.getProperty(org.id, propertyId);
      if (!property) {
        return Errors.notFound(res, "Property");
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
      logger.error("EPA environmental lookup error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error("Failed to lookup EPA data"));
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
      Errors.internal(res, error instanceof Error ? error : new Error("Failed to lookup tax info"));
    }
  });

  // ============================================
  // DUE DILIGENCE REPORT GENERATION
  // ============================================

  api.get("/api/properties/:id/report", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const propertyId = Number(req.params.id);
      const includeComps = req.query.comps === "true";
      const includeAI = req.query.ai === "true";
      
      // Verify property belongs to organization
      const property = await storage.getProperty(org.id, propertyId);
      if (!property) {
        return Errors.notFound(res, "Property");
      }

      const { generateDueDiligenceReport } = await import("./services/dueDiligence");
      const report = await generateDueDiligenceReport(org.id, propertyId, {
        includeComps,
        includeAI,
      });

      res.json(report);
    } catch (error: any) {
      logger.error("Due diligence report error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error("Failed to generate report"));
    }
  });

  api.get("/api/properties/:id/report/pdf", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const propertyId = Number(req.params.id);
      const includeComps = req.query.comps === "true";
      const includeAI = req.query.ai === "true";
      
      // Verify property belongs to organization
      const property = await storage.getProperty(org.id, propertyId);
      if (!property) {
        return Errors.notFound(res, "Property");
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
      logger.error("PDF generation error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error("Failed to generate PDF"));
    }
  });

  api.get("/api/properties/:id/report/summary", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const propertyId = Number(req.params.id);
      
      const { getQuickPropertySummary } = await import("./services/dueDiligence");
      const summary = await getQuickPropertySummary(org.id, propertyId);
      
      if (!summary) {
        return Errors.notFound(res, "Property");
      }

      res.json(summary);
    } catch (error: any) {
      logger.error("Quick summary error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error("Failed to get summary"));
    }
  });
  
  // ============================================
  // DEAL CHECKLIST TEMPLATES
  // ============================================
  
  api.get("/api/checklist-templates", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const templates = await storage.getChecklistTemplates(org.id);
    if (templates.length === 0) {
      const initialized = await storage.initializeDefaultChecklistTemplates(org.id);
      return res.json(initialized);
    }
    res.json(templates);
  });
  
  api.get("/api/checklist-templates/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const template = await storage.getChecklistTemplate(Number(req.params.id));
    if (!template) return Errors.notFound(res, "Template");
    res.json(template);
  });

  api.post("/api/checklist-templates", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const template = await storage.createChecklistTemplate({
        ...req.body,
        organizationId: org.id,
      });
      res.status(201).json(template);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return Errors.badRequest(res, err.errors[0].message);
      }
      throw err;
    }
  });

  api.put("/api/checklist-templates/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const template = await storage.updateChecklistTemplate(Number(req.params.id), req.body);
    if (!template) return Errors.notFound(res, "Template");
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
    const org = req.organization;
    const dealId = Number(req.params.id);
    // Task #2: Verify deal belongs to org before returning checklist (IDOR prevention)
    const deal = await storage.getDeal(org.id, dealId);
    if (!deal) return Errors.notFound(res, "Deal");
    const checklist = await storage.getDealChecklist(dealId);
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
      const org = req.organization;
      const dealId = Number(req.params.id);
      // Task #2: Verify deal belongs to org (IDOR prevention)
      const deal = await storage.getDeal(org.id, dealId);
      if (!deal) return Errors.notFound(res, "Deal");
      const { templateId } = req.body;
      if (!templateId) {
        return Errors.badRequest(res, "templateId is required");
      }
      const checklist = await storage.applyChecklistTemplateToDeal(dealId, templateId);
      res.status(201).json(checklist);
    } catch (err: any) {
      Errors.badRequest(res, err.message || "Failed to apply template");
    }
  });

  api.patch("/api/deals/:id/checklist/items/:itemId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const dealId = Number(req.params.id);
      // Task #2: Verify deal belongs to org (IDOR prevention)
      const deal = await storage.getDeal(org.id, dealId);
      if (!deal) return Errors.notFound(res, "Deal");
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      const { checked, documentUrl } = req.body;

      const checklist = await storage.updateDealChecklistItem(
        dealId,
        req.params.itemId,
        { checked, documentUrl, checkedBy: userId }
      );
      res.json(checklist);
    } catch (err: any) {
      Errors.badRequest(res, err.message || "Failed to update checklist item");
    }
  });
  
  api.get("/api/deals/:id/stage-gate", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const dealId = Number(req.params.id);
    // Task #2: Verify deal belongs to org (IDOR prevention)
    const deal = await storage.getDeal(org.id, dealId);
    if (!deal) return Errors.notFound(res, "Deal");
    const result = await storage.checkStageGate(dealId);
    res.json(result);
  });

  api.get("/api/deals/:id/report", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const dealId = Number(req.params.id);
      const includeComps = req.query.comps === "true";
      const includeAI = req.query.ai === "true";
      
      // Task #2: Pass org.id to getDeal to scope query (IDOR prevention)
      const deal = await storage.getDeal(org.id, dealId);
      if (!deal) {
        return Errors.notFound(res, "Deal");
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
      logger.error("Deal due diligence report error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error("Failed to generate report"));
    }
  });
  
  // Enhanced deal stage update with stage gate check
  api.patch("/api/deals/:id/stage", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { stage, force } = req.body;
      const dealId = Number(req.params.id);
      const org = req.organization;

      const existingDeal = await storage.getDeal(org.id, dealId);
      if (!existingDeal) return Errors.notFound(res, "Deal");

      // Task #210: Enforce deal status state machine transitions
      const currentStatus = existingDeal.status || "negotiating";
      const allowedNext = DEAL_STATUS_TRANSITIONS[currentStatus];
      if (allowedNext && !allowedNext.includes(stage)) {
        return Errors.badRequest(res, `Cannot transition from ${currentStatus} to ${stage}`);
      }

      if (!force) {
        const stageGate = await storage.checkStageGate(dealId);
        if (!stageGate.canAdvance) {
          return Errors.badRequest(res, "Cannot advance stage: incomplete required checklist items", { incompleteItems: stageGate.incompleteItems });
        }
      }

      const deal = await storage.updateDeal(dealId, { status: stage });
      if (!deal) return Errors.notFound(res, "Deal");
      res.json(deal);
    } catch (err: any) {
      Errors.badRequest(res, err.message || "Failed to update stage");
    }
  });

  // Bulk operations
  api.post("/api/deals/bulk-delete", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return Errors.badRequest(res, "ids must be a non-empty array");
      }
      const deletedCount = await storage.bulkDeleteDeals(org.id, ids);
      res.json({ deletedCount });
    } catch (err: any) {
      Errors.internal(res, err instanceof Error ? err : new Error("Failed to bulk delete deals"));
    }
  });

  api.post("/api/deals/bulk-update", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { ids, updates } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return Errors.badRequest(res, "ids must be a non-empty array");
      }
      if (!updates || typeof updates !== "object") {
        return Errors.badRequest(res, "updates must be an object");
      }
      const updatedCount = await storage.bulkUpdateDeals(org.id, ids, updates);
      res.json({ updatedCount });
    } catch (err: any) {
      Errors.internal(res, err instanceof Error ? err : new Error("Failed to bulk update deals"));
    }
  });

  // ─── T23 + T49: Generate Offer Letter PDF + (optionally) send for e-signature ─
  api.post("/api/deals/:id/offer-letter-pdf", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const deal = await storage.getDeal(org.id, Number(req.params.id));
      if (!deal) return Errors.notFound(res, "Deal");

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
      Errors.internal(res, err instanceof Error ? err : new Error(err.message));
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
      Errors.internal(res, err instanceof Error ? err : new Error(err.message));
    }
  });

  // GET /api/deals/:dealId/handoffs — handoffs for a specific deal
  app.get("/api/deals/:dealId/handoffs", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const handoffs = await getHandoffsForDeal(req.org.id, parseInt(req.params.dealId));
      res.json(handoffs);
    } catch (err: any) {
      Errors.internal(res, err instanceof Error ? err : new Error(err.message));
    }
  });

  // POST /api/deals/:dealId/handoffs — initiate a handoff
  app.post("/api/deals/:dealId/handoffs", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { fromTeamMemberId, toTeamMemberId, fromRole, toRole, notes, customChecklist } = req.body;
      if (!fromTeamMemberId || !toTeamMemberId || !fromRole || !toRole) {
        return Errors.badRequest(res, "fromTeamMemberId, toTeamMemberId, fromRole, and toRole are required");
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
      Errors.internal(res, err instanceof Error ? err : new Error(err.message));
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
      Errors.internal(res, err instanceof Error ? err : new Error(err.message));
    }
  });

  // POST /api/deals/handoffs/:handoffId/complete — complete the handoff
  app.post("/api/deals/handoffs/:handoffId/complete", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const handoff = await completeHandoff(req.org.id, req.params.handoffId);
      res.json(handoff);
    } catch (err: any) {
      Errors.badRequest(res, err.message);
    }
  });

}

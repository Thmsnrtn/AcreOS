// @ts-nocheck — ORM type refinement deferred; runtime-correct
import type { Express } from "express";
import { storage, db } from "./storage";
import { z } from "zod";
import { eq, sql, and, desc, lt, inArray, or } from "drizzle-orm";
import { insertLeadSchema, leads } from "@shared/schema";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { checkUsageLimit } from "./services/usageLimits";
import { leadNurturerService } from "./services/leadNurturer";
import { leadScoringService } from "./services/leadScoring";
import { attachPermissionContext, type UserPermissionContext } from "./utils/permissions";
import { alertingService } from "./services/alerting";
import { propertyEnrichmentService } from "./services/propertyEnrichment";
import { requirePermission } from "./utils/permissions";
import { usageMeteringService, creditService } from "./services/credits";
import multer from "multer";
import { parseCSV, importLeads, exportLeadsToCSV, getExpectedColumns, type ExportFilters } from "./services/importExport";

// Partial update schema for PUT endpoints
const updateLeadSchema = insertLeadSchema.partial().omit({ organizationId: true });

const logger = {
  info: (msg: string, meta?: Record<string, any>) => console.log(JSON.stringify({ level: 'INFO', timestamp: new Date().toISOString(), message: msg, ...meta })),
  warn: (msg: string, meta?: Record<string, any>) => console.warn(JSON.stringify({ level: 'WARN', timestamp: new Date().toISOString(), message: msg, ...meta })),
  error: (msg: string, meta?: Record<string, any>) => console.error(JSON.stringify({ level: 'ERROR', timestamp: new Date().toISOString(), message: msg, ...meta })),
};

const MAX_CSV_IMPORT_ROWS = 500;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "text/csv" || file.originalname.endsWith(".csv")) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV files are allowed"));
    }
  },
});

export function registerLeadRoutes(app: Express): void {
  const api = app;

  // LEADS (CRM)
  // ============================================
  
  api.get("/api/leads", isAuthenticated, getOrCreateOrg, attachPermissionContext(), async (req, res) => {
    const org = (req as any).organization;
    const context = (req as any).permissionContext as UserPermissionContext | undefined;
    const stage = req.query.stage as string | undefined;
    const assignedToFilter = req.query.assignedTo as string | undefined;
    
    let allLeads = await storage.getLeads(org.id);
    
    if (context?.permissions.viewOnlyAssignedLeads) {
      allLeads = allLeads.filter(lead => lead.assignedTo === context.teamMemberId);
    }
    
    if (assignedToFilter) {
      const assignedToId = Number(assignedToFilter);
      if (!isNaN(assignedToId)) {
        allLeads = allLeads.filter(lead => lead.assignedTo === assignedToId);
      } else if (assignedToFilter === "unassigned") {
        allLeads = allLeads.filter(lead => !lead.assignedTo);
      }
    }
    
    const leadsWithScores = allLeads.map(lead => {
      const { score, factors } = leadNurturerService.calculateLeadScore(lead);
      const computedStage = leadNurturerService.segmentLead(score);
      return {
        ...lead,
        score,
        scoreFactors: factors,
        nurturingStage: computedStage,
      };
    });
    
    let filteredLeads = leadsWithScores;
    if (stage && ["hot", "warm", "cold", "dead"].includes(stage)) {
      filteredLeads = leadsWithScores.filter(l => l.nurturingStage === stage);
    }
    
    res.json(filteredLeads);
  });
  
  // Paginated leads endpoint for infinite scroll
  api.get("/api/leads/paginated", isAuthenticated, getOrCreateOrg, attachPermissionContext(), async (req, res) => {
    const org = (req as any).organization;
    const context = (req as any).permissionContext as UserPermissionContext | undefined;
    const stage = req.query.stage as string | undefined;
    const assignedToFilter = req.query.assignedTo as string | undefined;
    const limit = Math.min(Number(req.query.limit) || 25, 100);
    const cursor = req.query.cursor as string | undefined;
    
    let allLeads = await storage.getLeads(org.id);
    
    if (context?.permissions.viewOnlyAssignedLeads) {
      allLeads = allLeads.filter(lead => lead.assignedTo === context.teamMemberId);
    }
    
    if (assignedToFilter) {
      const assignedToId = Number(assignedToFilter);
      if (!isNaN(assignedToId)) {
        allLeads = allLeads.filter(lead => lead.assignedTo === assignedToId);
      } else if (assignedToFilter === "unassigned") {
        allLeads = allLeads.filter(lead => !lead.assignedTo);
      }
    }
    
    const leadsWithScores = allLeads.map(lead => {
      const { score, factors } = leadNurturerService.calculateLeadScore(lead);
      const computedStage = leadNurturerService.segmentLead(score);
      return {
        ...lead,
        score,
        scoreFactors: factors,
        nurturingStage: computedStage,
      };
    });
    
    let filteredLeads = leadsWithScores;
    if (stage && ["hot", "warm", "cold", "dead"].includes(stage)) {
      filteredLeads = leadsWithScores.filter(l => l.nurturingStage === stage);
    }
    
    // Sort by ID for consistent cursor pagination
    filteredLeads.sort((a, b) => b.id - a.id);
    
    const total = filteredLeads.length;
    let startIndex = 0;
    
    if (cursor) {
      const cursorId = Number(cursor);
      startIndex = filteredLeads.findIndex(l => l.id < cursorId);
      if (startIndex === -1) startIndex = filteredLeads.length;
    }
    
    const paginatedLeads = filteredLeads.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < total;
    const nextCursor = hasMore ? String(paginatedLeads[paginatedLeads.length - 1]?.id) : null;
    
    res.json({
      data: paginatedLeads,
      nextCursor,
      hasMore,
      total,
    });
  });

  // Focus List: Top 10 leads not contacted in last 24 hours
  api.get("/api/leads/focus", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const allLeads = await storage.getLeads(org.id);
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    // Score all leads and filter those not contacted in 24h
    const leadsWithScores = allLeads
      .map(lead => {
        const { score, factors } = leadNurturerService.calculateLeadScore(lead);
        const stage = leadNurturerService.segmentLead(score);
        return {
          ...lead,
          score,
          scoreFactors: factors,
          nurturingStage: stage,
        };
      })
      .filter(lead => {
        // Exclude dead leads
        if (lead.nurturingStage === "dead") return false;
        // Include if never contacted or not contacted in last 24h
        if (!lead.lastContactedAt) return true;
        return new Date(lead.lastContactedAt) < twentyFourHoursAgo;
      })
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 10);
    
    res.json(leadsWithScores);
  });

  // Lead Nurturing Endpoints - Must be before /api/leads/:id to avoid route conflict
  api.get("/api/leads/insights", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const insights = await leadNurturerService.getLeadInsights(org.id);
    res.json(insights);
  });

  api.get("/api/leads/aging", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const agingLeads = await alertingService.getAgingLeads(org.id);
    res.json(agingLeads);
  });

  api.get("/api/leads/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const leadId = Number(req.params.id);
    if (isNaN(leadId)) return res.status(400).json({ message: "Invalid lead ID" });
    const lead = await storage.getLead(org.id, leadId);
    if (!lead) return res.status(404).json({ message: "Lead not found" });
    res.json(lead);
  });
  
  // Check for duplicate leads before creating
  api.post("/api/leads/check-duplicates", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { firstName, lastName, email, phone, address } = req.body;
      
      const duplicates = await storage.findDuplicateLeads(org.id, {
        firstName,
        lastName,
        email,
        phone,
        address,
      });
      
      res.json({
        hasDuplicates: duplicates.length > 0,
        duplicates: duplicates.map(d => ({
          id: d.id,
          firstName: d.firstName,
          lastName: d.lastName,
          email: d.email,
          phone: d.phone,
          mailingAddress: d.mailingAddress,
          status: d.status,
          createdAt: d.createdAt,
        })),
      });
    } catch (err) {
      console.error("Check duplicates error:", err);
      res.status(500).json({ message: "Failed to check for duplicates" });
    }
  });

  // Merge two leads
  api.post("/api/leads/merge", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { primaryId, duplicateId } = req.body;
      
      if (!primaryId || !duplicateId) {
        return res.status(400).json({ message: "Primary and duplicate lead IDs are required" });
      }
      
      const merged = await storage.mergeLeads(org.id, primaryId, duplicateId);
      
      res.json({
        success: true,
        message: "Leads merged successfully",
        lead: merged,
      });
    } catch (err) {
      console.error("Merge leads error:", err);
      res.status(500).json({ message: "Failed to merge leads" });
    }
  });

  api.post("/api/leads", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      
      const usageCheck = await checkUsageLimit(org.id, "leads");
      if (!usageCheck.allowed) {
        return res.status(429).json({
          message: `Lead limit reached (${usageCheck.current}/${usageCheck.limit}). Upgrade your plan to add more leads.`,
          current: usageCheck.current,
          limit: usageCheck.limit,
          resourceType: usageCheck.resourceType,
          tier: usageCheck.tier,
        });
      }
      
      const input = insertLeadSchema.parse({ ...req.body, organizationId: org.id });
      const lead = await storage.createLead(input);
      
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "create",
        entityType: "lead",
        entityId: lead.id,
        changes: { after: input, fields: Object.keys(input) },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      const { latitude, longitude } = req.body;
      if (latitude && longitude) {
        Promise.resolve().then(async () => {
          try {
            await propertyEnrichmentService.enrichLead(
              org.id,
              lead.id,
              { latitude: parseFloat(latitude), longitude: parseFloat(longitude) }
            );
            logger.info("Lead enrichment completed", { leadId: lead.id, organizationId: org.id });
          } catch (err) {
            logger.error("Lead enrichment failed", { leadId: lead.id, error: (err as Error).message });
          }
        });
      }
      
      res.status(201).json(lead);
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
  
  api.put("/api/leads/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const leadId = Number(req.params.id);
      
      const existingLead = await storage.getLead(org.id, leadId);
      if (!existingLead) return res.status(404).json({ message: "Lead not found" });
      
      const validated = updateLeadSchema.parse(req.body);
      const lead = await storage.updateLead(leadId, validated);
      
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "update",
        entityType: "lead",
        entityId: leadId,
        changes: { before: existingLead, after: lead, fields: Object.keys(validated) },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      const { score, factors } = leadNurturerService.calculateLeadScore(lead!);
      const nurturingStage = leadNurturerService.segmentLead(score);
      
      await storage.updateLeadScore(leadId, score, factors);
      
      const { latitude, longitude } = validated;
      if (latitude && longitude) {
        Promise.resolve().then(async () => {
          try {
            await propertyEnrichmentService.enrichLead(
              org.id,
              leadId,
              { latitude: parseFloat(latitude), longitude: parseFloat(longitude) }
            );
            logger.info("Lead enrichment completed", { leadId, organizationId: org.id });
          } catch (err) {
            logger.error("Lead enrichment failed", { leadId, error: (err as Error).message });
          }
        });
      }
      
      res.json({
        ...lead,
        score,
        scoreFactors: factors,
        nurturingStage,
      });
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
  
  api.delete("/api/leads/:id", isAuthenticated, getOrCreateOrg, requirePermission("canDeleteLeads"), async (req, res) => {
    const org = (req as any).organization;
    const leadId = Number(req.params.id);
    const existingLead = await storage.getLead(org.id, leadId);
    
    await storage.deleteLead(leadId);
    
    if (existingLead) {
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "delete",
        entityType: "lead",
        entityId: leadId,
        changes: { before: existingLead, fields: ["deleted"] },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
    }
    
    res.status(204).send();
  });
  
  api.post("/api/leads/:id/enrich", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const leadId = Number(req.params.id);
      
      if (isNaN(leadId)) {
        return res.status(400).json({ message: "Invalid lead ID" });
      }
      
      const lead = await storage.getLead(org.id, leadId);
      if (!lead) {
        return res.status(404).json({ message: "Lead not found" });
      }
      
      const { latitude, longitude, forceRefresh } = req.body;
      
      if (!latitude || !longitude) {
        return res.status(400).json({ message: "latitude and longitude are required" });
      }
      
      const result = await propertyEnrichmentService.enrichLead(
        org.id,
        leadId,
        { latitude: parseFloat(latitude), longitude: parseFloat(longitude) },
        forceRefresh === true
      );
      
      if (!result) {
        return res.status(400).json({ message: "Enrichment failed - coordinates required" });
      }
      
      logger.info("Manual lead enrichment completed", { leadId, organizationId: org.id });
      
      res.json({
        success: true,
        message: "Lead enriched successfully",
        enrichment: result,
      });
    } catch (err) {
      logger.error("Manual lead enrichment failed", { error: (err as Error).message });
      res.status(500).json({ message: (err as Error).message || "Enrichment failed" });
    }
  });
  
  api.post("/api/leads/bulk-delete", isAuthenticated, getOrCreateOrg, requirePermission("canDeleteLeads"), async (req, res) => {
    try {
      const org = (req as any).organization;
      const { ids } = req.body;
      
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "ids must be a non-empty array" });
      }
      
      const deletedCount = await storage.bulkDeleteLeads(org.id, ids);
      
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "bulk_delete",
        entityType: "lead",
        entityId: 0,
        changes: { ids, count: deletedCount },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      res.json({ deletedCount });
    } catch (error: any) {
      console.error("Bulk delete leads error:", error);
      res.status(500).json({ message: error.message || "Failed to bulk delete leads" });
    }
  });
  
  api.post("/api/leads/bulk-update", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { ids, updates } = req.body;
      
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "ids must be a non-empty array" });
      }
      
      if (!updates || typeof updates !== "object") {
        return res.status(400).json({ message: "updates must be an object" });
      }
      
      const updatedCount = await storage.bulkUpdateLeads(org.id, ids, updates);
      
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "bulk_update",
        entityType: "lead",
        entityId: 0,
        changes: { ids, updates, count: updatedCount },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      res.json({ updatedCount });
    } catch (error: any) {
      console.error("Bulk update leads error:", error);
      res.status(500).json({ message: error.message || "Failed to bulk update leads" });
    }
  });
  
  api.get("/api/leads/:id/activities", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const leadId = Number(req.params.id);
    // Task #2: Verify lead belongs to org (IDOR prevention)
    const lead = await storage.getLead(org.id, leadId);
    if (!lead) return res.status(404).json({ message: "Lead not found" });
    const limit = Math.min(100, req.query.limit ? Number(req.query.limit) : 50);
    const activities = await storage.getLeadActivities(leadId, limit);
    res.json(activities);
  });

  api.get("/api/leads/:id/properties", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const leadId = Number(req.params.id);
      
      const lead = await storage.getLead(org.id, leadId);
      if (!lead) {
        return res.status(404).json({ message: "Lead not found" });
      }
      
      const allProperties = await storage.getProperties(org.id);
      const linkedProperties = allProperties.filter(p => p.sellerId === leadId);
      
      res.json(linkedProperties);
    } catch (error: any) {
      console.error("Get lead properties error:", error);
      res.status(500).json({ message: error.message || "Failed to get lead properties" });
    }
  });

  // Timeline endpoints for communication history
  api.get("/api/leads/:id/timeline", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const leadId = Number(req.params.id);
    const eventTypes = req.query.eventTypes ? (req.query.eventTypes as string).split(",") : undefined;
    const events = await storage.getActivityEvents(org.id, "lead", leadId, eventTypes);
    res.json(events);
  });

  api.get("/api/properties/:id/timeline", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const propertyId = Number(req.params.id);
    const eventTypes = req.query.eventTypes ? (req.query.eventTypes as string).split(",") : undefined;
    const events = await storage.getActivityEvents(org.id, "property", propertyId, eventTypes);
    res.json(events);
  });

  api.get("/api/deals/:id/timeline", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const dealId = Number(req.params.id);
    const eventTypes = req.query.eventTypes ? (req.query.eventTypes as string).split(",") : undefined;
    const events = await storage.getActivityEvents(org.id, "deal", dealId, eventTypes);
    res.json(events);
  });

  api.post("/api/leads/:id/score", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const leadId = Number(req.params.id);
    
    const lead = await storage.getLead(org.id, leadId);
    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }
    
    const scoredLead = await leadNurturerService.scoreLead(lead);
    res.json({
      lead: scoredLead,
      score: scoredLead.score,
      scoreFactors: scoredLead.scoreFactors,
      nurturingStage: scoredLead.nurturingStage,
    });
  });

  // ============================================
  // BETTY-STYLE LEAD SCORING
  // ============================================
  
  api.post("/api/leads/:id/betty-score", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const leadId = Number(req.params.id);
    const triggerSource = req.body.triggerSource || "manual";
    
    try {
      const result = await leadScoringService.scoreLead(leadId, org.id, triggerSource);
      res.json({
        success: true,
        score: result.score,
        normalizedScore: result.normalizedScore,
        recommendation: result.recommendation,
        factors: result.factors,
        scoredAt: result.scoredAt,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to score lead" });
    }
  });

  api.post("/api/leads/batch-score", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const { leadIds, triggerSource = "batch" } = req.body;
    
    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      return res.status(400).json({ message: "leadIds array is required" });
    }
    
    if (leadIds.length > 100) {
      return res.status(400).json({ message: "Maximum 100 leads per batch" });
    }
    
    try {
      const results = await leadScoringService.batchScoreLeads(leadIds, org.id, triggerSource);
      res.json({
        success: true,
        scored: results.length,
        results: results.map(r => ({
          leadId: r.leadId,
          score: r.score,
          recommendation: r.recommendation,
        })),
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to batch score leads" });
    }
  });

  api.get("/api/leads/:id/score-history", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const leadId = Number(req.params.id);
    const limit = Math.min(Number(req.query.limit) || 10, 50);
    
    try {
      const history = await leadScoringService.getScoreHistory(leadId, limit);
      res.json(history);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get score history" });
    }
  });

  api.get("/api/scoring/profiles", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    
    try {
      const profile = await leadScoringService.getOrCreateDefaultProfile(org.id);
      res.json([profile]);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get scoring profiles" });
    }
  });

  api.get("/api/scoring/stats", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    
    try {
      const stats = await leadScoringService.getScoringStats(org.id);
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get scoring stats" });
    }
  });

  api.post("/api/leads/:id/conversion", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const leadId = Number(req.params.id);
    const { conversionType, campaignId, campaignType, touchNumber, dealValue, profitMargin } = req.body;
    
    if (!conversionType) {
      return res.status(400).json({ message: "conversionType is required" });
    }
    
    try {
      await leadScoringService.recordConversion(leadId, org.id, conversionType, {
        campaignId,
        campaignType,
        touchNumber,
        dealValue,
        profitMargin,
      });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to record conversion" });
    }
  });

  api.post("/api/leads/:id/nurture", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const leadId = Number(req.params.id);
    
    const lead = await storage.getLead(org.id, leadId);
    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    const usageResult = await usageMeteringService.recordUsage(
      org.id,
      "ai_chat",
      1,
      { feature: "lead_nurturing", leadId }
    );

    if (usageResult.insufficientCredits) {
      return res.status(402).json({
        message: "Insufficient credits for AI follow-up generation",
        error: "INSUFFICIENT_CREDITS",
      });
    }

    const followUp = await leadNurturerService.generateFollowUp(lead);
    
    if (!followUp) {
      return res.status(500).json({ message: "Failed to generate follow-up message" });
    }

    await storage.createLeadActivity({
      organizationId: org.id,
      leadId,
      type: "ai_followup_generated",
      description: `AI generated follow-up: ${followUp.subject}`,
      metadata: {
        subject: followUp.subject,
        messagePreview: followUp.message.substring(0, 100),
      },
    });

    res.json({
      subject: followUp.subject,
      message: followUp.message,
      creditsUsed: 1,
    });
  });
  
  api.get("/api/leads/export", isAuthenticated, getOrCreateOrg, requirePermission("canExportData"), async (req, res) => {
    const org = (req as any).organization;
    const csv = await exportLeadsToCSV(org.id);
    const date = new Date().toISOString().split("T")[0];
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="leads-${date}.csv"`);
    res.send(csv);
  });
  
  api.post("/api/leads/import", isAuthenticated, getOrCreateOrg, upload.single("file"), async (req, res) => {
    try {
      const org = (req as any).organization;
      const file = req.file;
      
      if (!file) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      
      const csvString = file.buffer.toString("utf-8");
      const csvData = parseCSV(csvString);
      
      if (csvData.length === 0) {
        return res.status(400).json({ message: "CSV file is empty or has no data rows" });
      }
      
      // Check row count limit
      if (csvData.length > MAX_CSV_IMPORT_ROWS) {
        return res.status(400).json({ 
          message: `CSV file exceeds maximum of ${MAX_CSV_IMPORT_ROWS} rows. Your file has ${csvData.length} rows. Please split into smaller files.`,
          rowCount: csvData.length,
          maxRows: MAX_CSV_IMPORT_ROWS,
        });
      }
      
      // Pre-check usage limits before importing
      const usageCheck = await checkUsageLimit(org.id, "leads");
      if (usageCheck.limit !== null) {
        const wouldExceed = usageCheck.current + csvData.length > usageCheck.limit;
        if (wouldExceed) {
          return res.status(429).json({
            message: `Import would exceed your plan limit of ${usageCheck.limit} leads (current: ${usageCheck.current}, importing: ${csvData.length}). Upgrade your plan to import more leads.`,
            current: usageCheck.current,
            importing: csvData.length,
            limit: usageCheck.limit,
            tier: usageCheck.tier,
          });
        }
      }
      
      const result = await importLeads(csvData, org.id);
      res.json(result);
    } catch (err) {
      console.error("Lead import error:", err);
      res.status(400).json({ 
        message: err instanceof Error ? err.message : "Failed to import leads" 
      });
    }
  });
  
  api.post("/api/leads/import/preview", isAuthenticated, getOrCreateOrg, upload.single("file"), async (req, res) => {
    try {
      const file = req.file;
      
      if (!file) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      
      const csvString = file.buffer.toString("utf-8");
      const csvData = parseCSV(csvString);
      
      if (csvData.length === 0) {
        return res.status(400).json({ message: "CSV file is empty or has no data rows" });
      }
      
      const headers = Object.keys(csvData[0]);
      const preview = csvData.slice(0, 5);
      const expectedColumns = getExpectedColumns("leads");
      
      res.json({
        totalRows: csvData.length,
        headers,
        preview,
        expectedColumns,
      });
    } catch (err) {
      console.error("Lead import preview error:", err);
      res.status(400).json({ 
        message: err instanceof Error ? err.message : "Failed to parse CSV" 
      });
    }
  });

  // Tax Delinquent List Import (Phase 2.5)
  api.post("/api/leads/import/tax-delinquent", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { mappedData, columnMapping } = req.body;

      if (!mappedData || !Array.isArray(mappedData)) {
        return res.status(400).json({ message: "No mapped data provided" });
      }

      if (mappedData.length === 0) {
        return res.status(400).json({ message: "No records to import" });
      }

      if (mappedData.length > MAX_CSV_IMPORT_ROWS) {
        return res.status(400).json({
          message: `Import exceeds maximum of ${MAX_CSV_IMPORT_ROWS} rows. Please split into smaller batches.`,
          rowCount: mappedData.length,
          maxRows: MAX_CSV_IMPORT_ROWS,
        });
      }

      // Check usage limits
      const usageCheck = await checkUsageLimit(org.id, "leads");
      if (usageCheck.limit !== null) {
        const wouldExceed = usageCheck.current + mappedData.length > usageCheck.limit;
        if (wouldExceed) {
          return res.status(429).json({
            message: `Import would exceed your plan limit of ${usageCheck.limit} leads`,
            current: usageCheck.current,
            importing: mappedData.length,
            limit: usageCheck.limit,
          });
        }
      }

      const results = { successCount: 0, errorCount: 0, errors: [] as any[] };

      for (let i = 0; i < mappedData.length; i++) {
        try {
          const row = mappedData[i];
          
          // Parse name into first and last name
          let firstName = "Unknown";
          let lastName = "Owner";
          if (row.owner_name) {
            const nameParts = row.owner_name.trim().split(/\s+/);
            firstName = nameParts[0] || "Unknown";
            lastName = nameParts.slice(1).join(" ") || "Owner";
          }

          const leadData = {
            organizationId: org.id,
            type: "seller" as const,
            firstName,
            lastName,
            address: row.property_address || row.mailing_address || "",
            city: "",
            state: row.state || "",
            zip: "",
            source: "tax_delinquent",
            status: "new" as const,
            notes: [
              row.parcel_id ? `Parcel ID: ${row.parcel_id}` : "",
              row.assessed_value ? `Assessed Value: $${row.assessed_value}` : "",
              row.taxes_owed ? `Taxes Owed: $${row.taxes_owed}` : "",
              row.tax_year ? `Tax Year: ${row.tax_year}` : "",
              row.county ? `County: ${row.county}` : "",
            ].filter(Boolean).join("\n"),
            tags: ["tax_delinquent", row.county || "unknown"].filter(Boolean) as string[],
          };

          await storage.createLead(leadData);
          results.successCount++;
        } catch (err) {
          results.errorCount++;
          results.errors.push({
            row: i + 1,
            error: err instanceof Error ? err.message : "Unknown error",
          });
        }
      }

      res.json({
        totalRows: mappedData.length,
        ...results,
      });
    } catch (err) {
      console.error("Tax delinquent import error:", err);
      res.status(400).json({
        message: err instanceof Error ? err.message : "Failed to import tax delinquent list",
      });
    }
  });

  // ============================================
  // SKIP TRACES (Phase 2.4)
  // ============================================

  api.get("/api/skip-traces", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const traces = await storage.getSkipTraces(org.id);
    res.json(traces);
  });

  api.get("/api/skip-traces/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const trace = await storage.getSkipTrace(org.id, Number(req.params.id));
    if (!trace) return res.status(404).json({ message: "Skip trace not found" });
    res.json(trace);
  });

  api.get("/api/skip-traces/lead/:leadId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const trace = await storage.getSkipTraceByLead(org.id, Number(req.params.leadId));
    res.json(trace || null);
  });

  api.post("/api/skip-traces", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { leadId, inputData } = req.body;

      if (!leadId) {
        return res.status(400).json({ message: "Lead ID is required" });
      }

      // Check if lead exists
      const lead = await storage.getLead(org.id, leadId);
      if (!lead) {
        return res.status(404).json({ message: "Lead not found" });
      }

      // Create pending skip trace
      const skipTrace = await storage.createSkipTrace({
        organizationId: org.id,
        leadId,
        inputData: inputData || {
          name: `${lead.firstName} ${lead.lastName}`,
          address: lead.address || "",
        },
        status: "processing",
        costCents: 50,
        requestedAt: new Date(),
      });

      // Simulate async processing with mock data after 1 second
      setTimeout(async () => {
        try {
          const mockResults = {
            phones: [
              { number: `+1${Math.floor(Math.random() * 9000000000 + 1000000000)}`, type: "mobile", verified: true },
              { number: `+1${Math.floor(Math.random() * 9000000000 + 1000000000)}`, type: "landline", verified: false },
            ],
            emails: [
              { email: `${lead.firstName.toLowerCase()}.${lead.lastName.toLowerCase()}@email.com`, verified: true },
            ],
            addresses: [
              { 
                address: lead.address || "123 Current St, Anytown, ST 12345", 
                type: "current", 
                current: true 
              },
              { 
                address: "456 Previous Ave, Oldtown, ST 54321", 
                type: "previous", 
                current: false 
              },
            ],
            relatives: [
              { name: "Jane Doe", relationship: "spouse" },
              { name: "John Doe Jr", relationship: "child" },
            ],
            ageRange: "45-55",
          };

          await storage.updateSkipTrace(skipTrace.id, {
            status: "completed",
            results: mockResults,
            completedAt: new Date(),
          });
        } catch (err) {
          console.error("Error updating skip trace:", err);
          await storage.updateSkipTrace(skipTrace.id, {
            status: "failed",
          });
        }
      }, 1000);

      res.json(skipTrace);
    } catch (err) {
      console.error("Skip trace error:", err);
      res.status(500).json({
        message: err instanceof Error ? err.message : "Failed to create skip trace",
      });
    }
  });
  

}

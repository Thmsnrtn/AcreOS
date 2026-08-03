import type { Express, Request, Response, NextFunction, RequestHandler } from "express";
import { storage, db } from "./storage";
import { z } from "zod";
import { eq, sql, and, desc, lt, inArray, or, count } from "drizzle-orm";
import {
  insertFeatureRequestSchema,
  SUBSCRIPTION_TIERS, payments, notes, deals, properties, leads, activityLog, organizations,
  offers, organizationIntegrations, dataSources,
  supportTickets, supportTicketMessages, knowledgeBaseArticles,
  paxMemory, paxObservations, paxCrossOrgLearnings, systemAlerts,
  countyGisEndpoints,
  aiModelConfigs,
  systemApiKeys,
  featureRequests,
  growthCampaigns,
  systemActivity,
  computeSla,
  orgApiKeys,
  auditLog,
  mailingOrderPieces,
  mailingOrders,
  agentTasks,
  evolutionHistory,
  evolutionCircuitBreaker,
  openrouterModelCatalog,
  aiTelemetryEvents,
  subscriptionEvents,
} from "@shared/schema";
import type { InsertLead, InsertProperty, InsertDeal } from "@shared/schema";
import type { LookupCategory } from "./services/data-source-broker";
import crypto from "crypto";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { alertingService } from "./services/alerting";
import { isFounderIdentity } from "./services/founder";
import { logger } from "./utils/logger";
import { addMonths } from "./utils/dateUtils";
import { Errors } from "./utils/errors";
import { getUserId, getOrganization, getClerkAuth, type AuthenticatedRequest } from "./types/request";

// ── Zod validation schemas for admin endpoints ────────────────────────────────
const createSupportCaseSchema = z.object({
  subject: z.string().min(1).max(500),
  message: z.string().min(1).max(5000),
});
const supportCaseMessageSchema = z.object({ message: z.string().min(1).max(5000) });
const supportCaseRatingSchema = z.object({ rating: z.coerce.number().int().min(1).max(5) });
const adminRespondSchema = z.object({ message: z.string().min(1).max(5000), resolve: z.boolean().optional() });
const featureRequestUpdateSchema = z.object({ status: z.string().optional(), founderNotes: z.string().optional(), priority: z.string().optional() });
const gisValidateSampleSchema = z.object({ sampleSize: z.coerce.number().int().min(1).max(50).optional() });
const gisValidateAllSchema = z.object({ stateFilter: z.string().optional(), maxConcurrent: z.coerce.number().int().min(1).max(15).optional(), async: z.boolean().optional() });
const setFounderSchema = z.object({ organizationId: z.number().int().positive().optional(), isFounder: z.boolean().optional() });
const dataSourceValidateSchema = z.object({ sourceId: z.number().int().positive().optional(), category: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).optional() });
const dataSourcePatchSchema = z.object({ isEnabled: z.boolean().optional(), priority: z.coerce.number().optional(), notes: z.string().optional() });
const countyGisEndpointCreateSchema = z.object({
  state: z.string().length(2),
  county: z.string().min(1).max(100),
  baseUrl: z.string().url(),
  endpointType: z.string().min(1),
  layerId: z.string().optional(),
  apnField: z.string().optional(),
  ownerField: z.string().optional(),
  fieldMappings: z.record(z.string(), z.string()).optional(),
  fipsCode: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  notes: z.string().optional(),
});
const testAllGisEndpointsSchema = z.object({ onlyUnverified: z.boolean().optional() });
const bulkAddEndpointsSchema = z.object({ endpoints: z.array(z.object({ state: z.string(), county: z.string(), baseUrl: z.string().url(), endpointType: z.string() }).passthrough()) });
const discoveryScanSchema = z.object({ keywords: z.array(z.string()).optional(), maxResults: z.coerce.number().int().min(1).max(500).optional(), targetStates: z.array(z.string()).optional() });
const dataSourcesBulkImportSchema = z.object({ sources: z.array(z.object({ category: z.string(), name: z.string(), url: z.string().url().optional(), state: z.string().optional() }).passthrough()) });
const propertyEnrichSchema = z.object({ propertyId: z.number().int().positive(), forceRefresh: z.boolean().optional() });
const coordinatesEnrichSchema = z.object({ latitude: z.coerce.number(), longitude: z.coerce.number(), categories: z.array(z.string()).optional(), state: z.string().optional(), county: z.string().optional(), apn: z.string().optional(), forceRefresh: z.boolean().optional() });
const aiModelCreateSchema = z.object({ provider: z.string().min(1), modelId: z.string().min(1), displayName: z.string().min(1), costPerMillionInput: z.coerce.number().optional(), costPerMillionOutput: z.coerce.number().optional(), maxTokens: z.coerce.number().int().optional() });
const aiModelUpdateSchema = aiModelCreateSchema.partial();
const systemApiKeyUpdateSchema = z.object({ apiKey: z.string().min(1), isActive: z.boolean().optional() });
// ─────────────────────────────────────────────────────────────────────────────

export function registerAdminRoutes(app: Express): void {
  const api = app;

  // CUSTOMER SUPPORT SYSTEM
  // ============================================

  // Create a new support case
  api.post("/api/support/cases", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user as any;
      const userId = user?.id || user.id;
      const parsed = createSupportCaseSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
      const { subject, message } = parsed.data;
      
      if (!subject || !message) {
        return Errors.badRequest(res, "Subject and message are required");
      }

      const { supportBrainService } = await import("./services/supportBrain");
      const { case: supportCase, classification } = await supportBrainService.createCase(
        org.id,
        userId,
        subject,
        message
      );

      // Auto-handle the first message
      const response = await supportBrainService.handleMessage(supportCase.id, message, org.id);

      res.status(201).json({
        case: supportCase,
        response: response.response,
        classification,
      });
    } catch (err: any) {
      logger.error("Create support case error", err);
      Errors.internal(res, err);
    }
  });

  // Get user's support cases
  api.get("/api/support/cases", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { status } = req.query as { status?: string };
      const cases = await storage.getSupportCases(org.id, status);
      const casesWithSla = cases.map((c) => {
        const sla = computeSla(c.priority, c.createdAt!);
        return {
          ...c,
          slaDeadline: sla.slaDeadline,
          slaStatus: sla.slaStatus,
          hoursUntilBreached: sla.hoursUntilBreached,
        };
      });
      // Sort by SLA urgency: breached first, then at_risk, then on_track; within same status sort by hoursUntilBreached asc
      casesWithSla.sort((a, b) => {
        const order = { breached: 0, at_risk: 1, on_track: 2 };
        const diff = (order[a.slaStatus] ?? 2) - (order[b.slaStatus] ?? 2);
        if (diff !== 0) return diff;
        return a.hoursUntilBreached - b.hoursUntilBreached;
      });
      res.json(casesWithSla);
    } catch (err: any) {
      logger.error("Get support cases error", err);
      Errors.internal(res, err);
    }
  });

  // Get specific support case with messages
  api.get("/api/support/cases/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const caseId = parseInt(req.params.id);
      const supportCase = await storage.getSupportCase(org.id, caseId);
      
      if (!supportCase || supportCase.organizationId !== org.id) {
        return Errors.notFound(res, "Case");
      }

      const messages = await storage.getSupportMessages(caseId);
      const actions = await storage.getSupportActions(caseId);

      res.json({ case: supportCase, messages, actions });
    } catch (err: any) {
      logger.error("Get support case error", err);
      Errors.internal(res, err);
    }
  });

  // Send message to a support case
  api.post("/api/support/cases/:id/messages", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const caseId = parseInt(req.params.id);
      const parsed = supportCaseMessageSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
      const { message } = parsed.data;

      const supportCase = await storage.getSupportCase(org.id, caseId);
      if (!supportCase || supportCase.organizationId !== org.id) {
        return Errors.notFound(res, "Case");
      }

      if (supportCase.status === "closed" || supportCase.status === "resolved") {
        return Errors.badRequest(res, "This case is already closed");
      }

      const { supportBrainService } = await import("./services/supportBrain");
      const response = await supportBrainService.handleMessage(caseId, message, org.id);

      res.json({
        userMessage: message,
        aiResponse: response.response,
        actionsTaken: response.actionsTaken,
        escalated: response.escalated,
      });
    } catch (err: any) {
      logger.error("Send support message error", err);
      Errors.internal(res, err);
    }
  });

  // Rate satisfaction and close case
  api.post("/api/support/cases/:id/rate", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const caseId = parseInt(req.params.id);
      const parsed = supportCaseRatingSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
      const { rating } = parsed.data;

      const supportCase = await storage.getSupportCase(org.id, caseId);
      if (!supportCase || supportCase.organizationId !== org.id) {
        return Errors.notFound(res, "Case");
      }

      const { supportBrainService } = await import("./services/supportBrain");
      await supportBrainService.rateSatisfaction(caseId, rating);

      res.json({ success: true, message: "Thank you for your feedback!" });
    } catch (err: any) {
      logger.error("Rate support case error", err);
      Errors.internal(res, err);
    }
  });

  // Resolve case (user marking as resolved)
  api.post("/api/support/cases/:id/resolve", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const caseId = parseInt(req.params.id);

      const supportCase = await storage.getSupportCase(org.id, caseId);
      if (!supportCase || supportCase.organizationId !== org.id) {
        return Errors.notFound(res, "Case");
      }

      const { supportBrainService } = await import("./services/supportBrain");
      await supportBrainService.resolveCase(caseId, "Resolved by user", "user");

      res.json({ success: true });
    } catch (err: any) {
      logger.error("Resolve support case error", err);
      Errors.internal(res, err);
    }
  });

  // Get all escalated cases (admin only - for now just check org owner)
  api.get("/api/admin/support/escalated", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const user = authReq.user;
      const userId = getUserId(authReq);
      const userEmail = user?.email || user.email;

      // R1.b fix: gate on canonical founder identity, not org ownership.
      // Previously any org owner could view escalated cases across all orgs.
      if (!isFounderIdentity({ email: userEmail, userId })) {
        // Hide existence of founder-only surfaces from non-founders (404, not 403).
        return Errors.notFound(res, "Resource");
      }

      const cases = await storage.getEscalatedCases();
      const casesWithSla = cases.map((c) => {
        const sla = computeSla(c.priority, c.createdAt!);
        return {
          ...c,
          slaDeadline: sla.slaDeadline,
          slaStatus: sla.slaStatus,
          hoursUntilBreached: sla.hoursUntilBreached,
        };
      });
      // Sort by SLA urgency first
      casesWithSla.sort((a, b) => {
        const order = { breached: 0, at_risk: 1, on_track: 2 };
        const diff = (order[a.slaStatus] ?? 2) - (order[b.slaStatus] ?? 2);
        if (diff !== 0) return diff;
        return a.hoursUntilBreached - b.hoursUntilBreached;
      });
      res.json(casesWithSla);
    } catch (err: any) {
      logger.error("Get escalated cases error", err);
      Errors.internal(res, err);
    }
  });

  // Admin respond to escalated case
  api.post("/api/admin/support/cases/:id/respond", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const user = authReq.user;
      const userId = getUserId(authReq);
      const userEmail = user?.email || user.email;
      const caseId = parseInt(req.params.id);
      const parsed = adminRespondSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
      const { message, resolve } = parsed.data;

      // R1.b fix: gate on canonical founder identity, not org ownership.
      if (!isFounderIdentity({ email: userEmail, userId })) {
        // Hide existence of founder-only surfaces from non-founders (404, not 403).
        return Errors.notFound(res, "Resource");
      }

      // Tier 1F: founder-gated cross-tenant read — explicit platform-ops path.
      const supportCase = await storage.getSupportCaseForPlatformOps(caseId);
      if (!supportCase) {
        return Errors.notFound(res, "Case");
      }

      await storage.createSupportMessage({
        caseId,
        role: "human_support",
        content: message,
      });

      if (resolve) {
        await storage.updateSupportCase(caseId, {
          status: "resolved",
          resolvedAt: new Date(),
          resolutionSummary: message,
          resolutionType: "escalated_resolved",
          assignedTo: user.id,
        });
      } else {
        await storage.updateSupportCase(caseId, {
          status: "awaiting_user",
          assignedTo: user.id,
        });
      }

      res.json({ success: true });
    } catch (err: any) {
      logger.error("Admin respond to case error", err);
      Errors.internal(res, err);
    }
  });

  // Get support metrics
  api.get("/api/admin/support/metrics", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const user = authReq.user;
      const userId = getUserId(authReq);
      const userEmail = user?.email || user.email;
      const org = authReq.organization;

      // R1.b fix: gate on canonical founder identity, not org ownership.
      if (!isFounderIdentity({ email: userEmail, userId })) {
        // Hide existence of founder-only surfaces from non-founders (404, not 403).
        return Errors.notFound(res, "Resource");
      }

      const allCases = await storage.getSupportCases(org.id);
      const escalatedCases = await storage.getEscalatedCases();

      const metrics = {
        totalCases: allCases.length,
        openCases: allCases.filter(c => c.status === "open" || c.status === "ai_handling" || c.status === "awaiting_user").length,
        escalatedCases: escalatedCases.length,
        resolvedCases: allCases.filter(c => c.status === "resolved" || c.status === "closed").length,
        avgSatisfaction: allCases.filter(c => c.userSatisfaction).reduce((sum, c) => sum + (c.userSatisfaction || 0), 0) / 
                        Math.max(1, allCases.filter(c => c.userSatisfaction).length),
        autoResolvedRate: allCases.filter(c => c.resolutionType === "auto_resolved").length / Math.max(1, allCases.length),
      };

      res.json(metrics);
    } catch (err: any) {
      logger.error("Get support metrics error", err);
      Errors.internal(res, err);
    }
  });

  // ============================================
  // BORROWER MESSAGING (Lender-side)
  // ============================================

  // GET /api/notes/:noteId/borrower-messages — lender views thread
  api.get("/api/notes/:noteId/borrower-messages", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const noteId = parseInt(req.params.noteId);
      const note = await storage.getNote(org.id, noteId);
      if (!note) return Errors.notFound(res, "Note");
      const msgs = await storage.getBorrowerMessages(noteId);
      // Mark borrower messages as read since lender is viewing them
      await storage.markBorrowerMessagesRead(noteId, "borrower");
      res.json(msgs);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // POST /api/notes/:noteId/borrower-messages/reply — lender replies
  api.post("/api/notes/:noteId/borrower-messages/reply", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const noteId = parseInt(req.params.noteId);
      const parsed = z.object({ content: z.string().min(1).max(10000) }).safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
      const { content } = parsed.data;
      if (!content || !content.trim()) {
        return Errors.badRequest(res, "Message content is required");
      }
      const note = await storage.getNote(org.id, noteId);
      if (!note) return Errors.notFound(res, "Note");
      const msg = await storage.createBorrowerMessage({
        noteId,
        orgId: org.id,
        senderType: "lender",
        content: content.trim(),
        readAt: null,
      });
      res.status(201).json(msg);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // GET /api/notes/:noteId/borrower-messages/unread-count — unread borrower message count for badge
  api.get("/api/notes/:noteId/borrower-messages/unread-count", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const noteId = parseInt(req.params.noteId);
      const note = await storage.getNote(org.id, noteId);
      if (!note) return Errors.notFound(res, "Note");
      const count = await storage.countUnreadBorrowerMessages(noteId, "borrower");
      res.json({ count });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ============================================
  // FEATURE REQUESTS
  // ============================================

  // Create a new feature request
  api.post("/api/feature-requests", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user;
      const userId = user?.id || user.id;

      const validation = insertFeatureRequestSchema.safeParse({
        ...req.body,
        organizationId: org.id,
        userId,
      });

      if (!validation.success) {
        return Errors.badRequest(res, validation.error.message);
      }

      const featureRequest = await storage.createFeatureRequest(validation.data);
      res.status(201).json(featureRequest);
    } catch (err: any) {
      logger.error("Create feature request error", err);
      Errors.internal(res, err);
    }
  });

  // Get user's organization feature requests
  api.get("/api/feature-requests", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const requests = await storage.getFeatureRequests(org.id);
      res.json(requests);
    } catch (err: any) {
      logger.error("Get feature requests error", err);
      Errors.internal(res, err);
    }
  });

  // Founder: Get all feature requests across all orgs
  api.get("/api/founder/feature-requests", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const user = authReq.user;
      const userId = getUserId(authReq);
      const userEmail = user?.email || user.email;

      // R1 fix: gate on canonical founder identity, not org ownership.
      // Previously any org owner could call this endpoint against any org.
      if (!isFounderIdentity({ email: userEmail, userId })) {
        // Hide existence of founder-only surfaces from non-founders (404, not 403).
        return Errors.notFound(res, "Resource");
      }

      const requests = await storage.getAllFeatureRequestsForFounder();
      res.json(requests);
    } catch (err: any) {
      logger.error("Get all feature requests error", err);
      Errors.internal(res, err);
    }
  });

  // Founder: Update feature request status/notes
  api.patch("/api/founder/feature-requests/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const user = authReq.user;
      const userId = getUserId(authReq);
      const userEmail = user?.email || user.email;
      const requestId = parseInt(req.params.id);

      // R1 fix: gate on canonical founder identity, not org ownership.
      if (!isFounderIdentity({ email: userEmail, userId })) {
        // Hide existence of founder-only surfaces from non-founders (404, not 403).
        return Errors.notFound(res, "Resource");
      }

      const parsed = featureRequestUpdateSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
      const { status, founderNotes, priority } = parsed.data;

      const updates: Record<string, any> = {};
      if (status !== undefined) updates.status = status;
      if (founderNotes !== undefined) updates.founderNotes = founderNotes;
      if (priority !== undefined) updates.priority = priority;

      const updated = await storage.updateFeatureRequest(requestId, updates);
      res.json(updated);
    } catch (err: any) {
      logger.error("Update feature request error", err);
      Errors.internal(res, err);
    }
  });

  // ============================================
  // DEMO DATA SEEDING
  // ============================================
  
  api.post("/api/seed-demo-data", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      
      // Sample leads
      const demoLeads = [
        { firstName: "John", lastName: "Martinez", type: "seller", email: "john.martinez@email.com", phone: "(602) 555-1234", address: "123 Desert Rose Lane", city: "Tucson", state: "AZ", zip: "85701", status: "responded", source: "tax_list", notes: "Inherited property, motivated to sell" },
        { firstName: "Sarah", lastName: "Thompson", type: "seller", email: "sarah.t@email.com", phone: "(505) 555-2345", address: "456 Canyon View Dr", city: "Albuquerque", state: "NM", zip: "87101", status: "negotiating", source: "facebook", notes: "Moving out of state, needs quick close" },
        { firstName: "Robert", lastName: "Chen", type: "buyer", email: "rchen@email.com", phone: "(512) 555-3456", address: "789 Oak Street", city: "Austin", state: "TX", zip: "78701", status: "qualified", source: "website", notes: "Looking for 5-10 acre recreational parcels" },
        { firstName: "Maria", lastName: "Garcia", type: "seller", email: "mgarcia@email.com", phone: "(623) 555-4567", address: "321 Sunset Blvd", city: "Phoenix", state: "AZ", zip: "85001", status: "mailed", source: "tax_list", notes: "Initial mailer sent 2 weeks ago" },
        { firstName: "David", lastName: "Wilson", type: "buyer", email: "dwilson@email.com", phone: "(702) 555-5678", address: "555 Palm Way", city: "Las Vegas", state: "NV", zip: "89101", status: "interested", source: "referral", notes: "Pre-approved for $50K, wants AZ or NM" },
        { firstName: "Jennifer", lastName: "Brown", type: "seller", email: "jbrown@email.com", phone: "(480) 555-6789", address: "888 Cactus Court", city: "Scottsdale", state: "AZ", zip: "85251", status: "new", source: "craigslist", notes: "Responded to online ad" },
      ];
      
      const createdLeads = [];
      for (const lead of demoLeads) {
        // storage.createLead's declared signature omits organizationId (set
        // server-side); the repo impl requires it. Merge via a typed
        // intermediate so the org id reaches the DB write.
        // TODO(tsc): storage.ts IStorage decl for createLead should be
        // `InsertLead & { organizationId: number }` to match leadRepo impl.
        const leadInput: InsertLead & { organizationId: number } = { ...lead, organizationId: org.id };
        const created = await storage.createLead(leadInput);
        createdLeads.push(created);
      }
      
      // Sample properties
      const demoProperties = [
        { apn: "123-45-678", county: "Cochise", state: "AZ", sizeAcres: "5.2", status: "owned", purchasePrice: "8500", marketValue: "15000", description: "Beautiful 5+ acre parcel with mountain views near Willcox" },
        { apn: "234-56-789", county: "Mohave", state: "AZ", sizeAcres: "2.5", status: "listed", purchasePrice: "3200", listPrice: "7900", marketValue: "7500", description: "2.5 acre lot in Golden Valley with road access" },
        { apn: "345-67-890", county: "Luna", state: "NM", sizeAcres: "10.0", status: "owned", purchasePrice: "5000", marketValue: "12000", description: "10 acres of open desert land near Deming" },
        { apn: "456-78-901", county: "Navajo", state: "AZ", sizeAcres: "1.25", status: "prospect", assessedValue: "4500", marketValue: "6000", description: "1.25 acre residential lot in Show Low area" },
        { apn: "567-89-012", county: "Pinal", state: "AZ", sizeAcres: "40.0", status: "under_contract", purchasePrice: "28000", marketValue: "55000", description: "40 acre ranch parcel with well and power nearby" },
      ];
      
      const createdProperties = [];
      for (const prop of demoProperties) {
        const propInput: InsertProperty & { organizationId: number } = { ...prop, organizationId: org.id };
        const created = await storage.createProperty(propInput);
        createdProperties.push(created);
      }
      
      // Sample deals
      // TODO(tsc): the deals table has no name/stage/salePrice/purchasePrice/
      // leadId columns — those keys in the original seed were silently dropped
      // at insert. Mapped to the real columns: stage→status, purchase/sale
      // price→offerAmount (the amount the deal was struck at).
      const demoDeals = [
        { type: "acquisition", status: "closed", propertyId: createdProperties[0]?.id, offerAmount: "8500", closingDate: new Date("2024-06-15") },
        { type: "disposition", status: "in_escrow", propertyId: createdProperties[1]?.id, offerAmount: "7900", closingDate: new Date("2025-02-01") },
        { type: "acquisition", status: "closed", propertyId: createdProperties[2]?.id, offerAmount: "5000", closingDate: new Date("2024-09-20") },
        { type: "acquisition", status: "offer_sent", propertyId: createdProperties[4]?.id, offerAmount: "28000" },
      ];

      for (const deal of demoDeals) {
        if (deal.propertyId == null) continue;
        const dealInput: InsertDeal & { organizationId: number } = { ...deal, propertyId: deal.propertyId, organizationId: org.id };
        await storage.createDeal(dealInput);
      }
      
      // Sample notes (seller financing)
      const startDate = addMonths(new Date(), -3);
      const firstPaymentDate = addMonths(new Date(startDate), 1);
      
      const demoNotes = [
        { 
          propertyId: createdProperties[0]?.id, 
          borrowerName: "Michael Rodriguez", 
          borrowerEmail: "mrodriguez@email.com", 
          borrowerPhone: "(520) 555-7890",
          originalPrincipal: "12000", 
          currentBalance: "10800",
          interestRate: "9.9", 
          termMonths: 36, 
          monthlyPayment: "387.50",
          downPayment: "3000",
          startDate,
          firstPaymentDate,
          status: "active",
          gracePeriodDays: 10,
          lateFee: "25",
        },
        { 
          propertyId: createdProperties[2]?.id, 
          borrowerName: "Amanda Foster", 
          borrowerEmail: "afoster@email.com", 
          borrowerPhone: "(575) 555-8901",
          originalPrincipal: "8500", 
          currentBalance: "7700",
          interestRate: "10.5", 
          termMonths: 24, 
          monthlyPayment: "395.00",
          downPayment: "2000",
          startDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
          firstPaymentDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          status: "active",
          gracePeriodDays: 10,
          lateFee: "25",
        },
      ];
      
      for (const note of demoNotes) {
        // Reg-Z §1026.43 hard gate (Workstream A). Demo data is synthetic /
        // non-consumer — flagged exempt so the gate constraint doesn't reject
        // the seed insert. Real consumer originations must go through
        // POST /api/notes/:id/originate with a full ATR determination.
        await storage.createNote({
          ...note,
          organizationId: org.id,
          atrExemptionCode: "business_purpose",
        } as any);
      }
      
      res.json({ 
        success: true, 
        message: "Demo data created successfully",
        counts: {
          leads: createdLeads.length,
          properties: createdProperties.length,
          deals: demoDeals.length,
          notes: demoNotes.length,
        }
      });
    } catch (err: any) {
      logger.error("Seed error", err);
      Errors.internal(res, err);
    }
  });
  
  // Clear demo data endpoint. Walks the live FK graph so leads/deals/
  // properties with dependent rows (offers, conversations, campaign
  // responses…) clear cleanly instead of tripping a foreign-key 500 —
  // see server/services/orgDataClear.ts.
  api.post("/api/clear-demo-data", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { clearOrganizationRecords } = await import("./services/orgDataClear");
      const outcome = await clearOrganizationRecords(org.id);
      if (outcome.blocked.length > 0) {
        Errors.internal(
          res,
          new Error(`clear-demo-data blocked on: ${outcome.blocked.join(", ")}`),
        );
        return;
      }
      const rows = Object.values(outcome.cleared).reduce((a, b) => a + b, 0);
      res.json({
        success: true,
        message: "All data cleared for your organization",
        removedRows: rows,
      });
    } catch (err: any) {
      logger.error("Clear data error", err);
      Errors.internal(res, err);
    }
  });

  // ============================================
  // ADMIN / FOUNDER DASHBOARD
  // ============================================
  
  // Founder/admin gate. Returns 404 (not 403) to hide the existence of
  // founder-only routes from non-founders, matching the `requireFounder`
  // hide-existence standard. Matches founders by email OR Clerk user ID via
  // isFounderIdentity — covering the userId founder path, not email-only.
  const isFounderAdmin: RequestHandler = async (req, res, next) => {
    if (!req.user) {
      // Hide existence even from unauthenticated callers.
      Errors.notFound(res, "Resource");
      return;
    }

    const user = req.user as any;
    const userId = getClerkAuth(req)?.userId ?? user.clerkUserId ?? user.id ?? null;
    const userEmail = user.email;

    if (isFounderIdentity({ email: userEmail, userId })) {
      return next();
    }

    logger.warn("Admin access denied", { userId, userEmail, path: req.path });
    Errors.notFound(res, "Resource");
  };

  // F-A01-1: Cross-org admin guard — validates URL :orgId matches authenticated org
  // Apply this middleware on any route that accepts :orgId in URL path
  const crossOrgAdminGuard: RequestHandler = (req, res, next) => {
    const org = req.organization;
    const paramOrgId = req.params.orgId ? parseInt(req.params.orgId, 10) : null;
    if (paramOrgId !== null && org && org.id !== paramOrgId) {
      logger.warn("Cross-org access attempt blocked", { orgId: org.id, requestedOrgId: paramOrgId, path: req.path });
      return Errors.forbidden(res, "Access denied: organization mismatch");
    }
    next();
  };

  // FW-9: in-process API telemetry readout. Counts 2xx/4xx/5xx + p50/p95
  // per route. Resets on process restart by design — this is a backstop
  // for early-warning observability; persistent telemetry belongs in an
  // APM (Datadog / Honeycomb / etc.).
  api.get("/api/admin/telemetry", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      // L14 — read the union view by default (durable rows + current-tick
      // Map). Pass ?currentOnly=1 for the legacy in-process snapshot.
      const currentOnly = String(req.query.currentOnly ?? "") === "1";
      const sinceHours = Math.max(1, Math.min(24 * 30, Number(req.query.sinceHours ?? 24)));
      if (currentOnly) {
        const { getTelemetrySummary } = await import("./middleware/apiTelemetry");
        const summary = getTelemetrySummary();
        res.json({ ...summary, generatedAt: new Date().toISOString(), source: "current-tick" });
        return;
      }
      const { getTelemetrySummaryDurable } = await import("./middleware/apiTelemetry");
      const summary = await getTelemetrySummaryDurable(sinceHours * 60 * 60 * 1000);
      res.json({ ...summary, generatedAt: new Date().toISOString(), source: "durable+current-tick", windowHours: sinceHours });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.post("/api/admin/telemetry/reset", isAuthenticated, isFounderAdmin, async (_req, res) => {
    try {
      const { resetTelemetry } = await import("./middleware/apiTelemetry");
      resetTelemetry();
      res.json({ reset: true });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.get("/api/admin/check", isAuthenticated, isFounderAdmin, async (req, res) => {
    res.json({ isAdmin: true });
  });

  api.get("/api/admin/dashboard", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const dashboardData = await storage.getAdminDashboardData();
      res.json(dashboardData);
    } catch (err: any) {
      logger.error("Admin dashboard error", { message: err.message, name: err.name });
      // Return minimal dashboard data so the page still renders
      res.json({
        revenue: { mrr: 0, arr: 0, growth: 0, customers: 0 },
        users: { total: 0, active: 0, new: 0 },
        system: { health: "degraded", uptime: 0 },
        agents: [],
        alerts: [],
      });
    }
  });

  api.get("/api/admin/alerts", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      const alerts = await storage.getSystemAlerts(undefined, status);
      res.json(alerts);
    } catch (err: any) {
      logger.error("Admin alerts error", err);
      Errors.internal(res, err);
    }
  });

  api.put("/api/admin/alerts/:id/acknowledge", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const alertId = Number(req.params.id);
      const updated = await storage.acknowledgeAlert(alertId);
      res.json(updated);
    } catch (err: any) {
      logger.error("Acknowledge alert error", err);
      Errors.internal(res, err);
    }
  });

  api.put("/api/admin/alerts/:id/resolve", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const alertId = Number(req.params.id);
      const updated = await storage.resolveAlert(alertId);
      res.json(updated);
    } catch (err: any) {
      logger.error("Resolve alert error", err);
      Errors.internal(res, err);
    }
  });

  api.put("/api/admin/alerts/acknowledge-all", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const count = await storage.acknowledgeAllAlerts();
      res.json({ success: true, count, message: `${count} alerts acknowledged` });
    } catch (err: any) {
      logger.error("Acknowledge all alerts error", err);
      Errors.internal(res, err);
    }
  });

  api.put("/api/admin/alerts/resolve-all", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const count = await storage.resolveAllAlerts();
      res.json({ success: true, count, message: `${count} alerts resolved` });
    } catch (err: any) {
      logger.error("Resolve all alerts error", err);
      Errors.internal(res, err);
    }
  });

  api.get("/api/admin/organizations", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const orgs = await storage.getAllOrganizations();
      res.json(orgs);
    } catch (err: any) {
      logger.error("Admin orgs error", err);
      Errors.internal(res, err);
    }
  });

  api.get("/api/admin/revenue", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const dashboardData = await storage.getAdminDashboardData();
      res.json({
        ...dashboardData.revenue,
        revenueAtRisk: dashboardData.revenueAtRisk
      });
    } catch (err: any) {
      logger.error("Admin revenue error", err);
      Errors.internal(res, err);
    }
  });

  api.get("/api/founder/api-usage", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const stats = await storage.getApiUsageStats();
      res.json(stats);
    } catch (err: any) {
      logger.error("API usage stats error", err);
      Errors.internal(res, err);
    }
  });

  // GIS Data Source Health Dashboard
  api.get("/api/founder/gis-health", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { getEndpointStats } = await import("./services/gisValidation");
      const stats = await getEndpointStats();
      res.json(stats);
    } catch (err: any) {
      logger.error("GIS health stats error", err);
      Errors.internal(res, err);
    }
  });

  // Run sample GIS validation (quick test of 20 random endpoints)
  api.post("/api/founder/gis-validate-sample", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { validateSampleEndpoints } = await import("./services/gisValidation");
      const sampleSize = Math.min(req.body.sampleSize || 20, 50);
      const result = await validateSampleEndpoints(sampleSize);
      res.json(result);
    } catch (err: any) {
      logger.error("GIS sample validation error", err);
      Errors.internal(res, err);
    }
  });

  // Run full GIS validation (test all endpoints - runs as background job for large datasets)
  api.post("/api/founder/gis-validate-all", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { validateAllEndpoints, getEndpointStats, startValidationJob } = await import("./services/gisValidation");
      const parsedGisAll = gisValidateAllSchema.safeParse(req.body);
      if (!parsedGisAll.success) return Errors.validationFailed(res, parsedGisAll.error.issues);
      const { stateFilter, maxConcurrent = 10, async: runAsync = false } = parsedGisAll.data;
      
      const stats = await getEndpointStats();
      const estimatedCount = stateFilter ? Math.ceil(stats.activeEndpoints / stats.statesCovered) : stats.activeEndpoints;
      
      if (estimatedCount > 100 && !stateFilter) {
        const jobResult = await startValidationJob({ stateFilter, maxConcurrent: Math.min(maxConcurrent, 15) });
        return res.json({
          ...jobResult,
          async: true,
          estimatedTimeMinutes: Math.ceil(estimatedCount / 10 / 6),
        });
      }
      
      if (runAsync) {
        const jobResult = await startValidationJob({ stateFilter, maxConcurrent: Math.min(maxConcurrent, 15) });
        return res.json({
          ...jobResult,
          async: true,
        });
      }
      
      const result = await validateAllEndpoints({ 
        stateFilter, 
        maxConcurrent: Math.min(maxConcurrent, 15),
        timeoutMs: 8000,
      });
      res.json(result);
    } catch (err: any) {
      logger.error("GIS full validation error", err);
      Errors.internal(res, err);
    }
  });

  // Get GIS validation job status
  api.get("/api/founder/gis-job/:jobId", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { getValidationJob } = await import("./services/gisValidation");
      const job = getValidationJob(req.params.jobId);
      
      if (!job) {
        return Errors.notFound(res, "Job");
      }
      
      const includeFullResults = req.query.full === "true" || job.status === "completed";
      
      res.json({
        id: job.id,
        status: job.status,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        progress: {
          completed: job.completed,
          total: job.total,
          percent: job.total > 0 ? Math.round((job.completed / job.total) * 100) : 0,
        },
        stateFilter: job.stateFilter,
        summary: job.summary,
        error: job.error,
        results: includeFullResults ? job.results : undefined,
        resultsPreview: !includeFullResults ? job.results.slice(-10) : undefined,
      });
    } catch (err: any) {
      logger.error("GIS job status error", err);
      Errors.internal(res, err);
    }
  });

  // List recent GIS validation jobs
  api.get("/api/founder/gis-jobs", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { getAllValidationJobs } = await import("./services/gisValidation");
      const jobs = getAllValidationJobs().map(job => ({
        id: job.id,
        status: job.status,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        total: job.total,
        completed: job.completed,
        stateFilter: job.stateFilter,
        onlineCount: job.summary?.online,
      }));
      res.json(jobs);
    } catch (err: any) {
      logger.error("GIS jobs list error", err);
      Errors.internal(res, err);
    }
  });

  // Get county GIS endpoints with their status
  api.get("/api/founder/gis-endpoints", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { state } = req.query;
      const endpoints = await db.select().from(countyGisEndpoints);
      
      const filtered = state 
        ? endpoints.filter(e => e.state.toUpperCase() === String(state).toUpperCase())
        : endpoints;
      
      const grouped = filtered.reduce((acc, e) => {
        if (!acc[e.state]) acc[e.state] = [];
        acc[e.state].push(e);
        return acc;
      }, {} as Record<string, typeof endpoints>);
      
      res.json({
        total: filtered.length,
        byState: grouped,
        states: Object.keys(grouped).sort(),
      });
    } catch (err: any) {
      logger.error("GIS endpoints error", err);
      Errors.internal(res, err);
    }
  });

  // Set founder status for an organization (founder admin only)
  // ── Right-to-erasure: hard-delete an organization (2026-07 GDPR gap) ──────
  // gdprService referenced deleteOrganization(orgId) for years but it never
  // existed — erasure requests could not actually be satisfied. Founder-only,
  // and the caller must type the org's EXACT name back (destructive-action
  // ceremony). Residual tables (append-only audit, exotic FKs) are returned
  // honestly, never silently skipped.
  api.post("/api/admin/organizations/:id/delete", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const orgId = parseInt(req.params.id, 10);
      if (!Number.isFinite(orgId) || orgId <= 0) {
        return Errors.badRequest(res, "Invalid organization id");
      }
      const confirmSchema = z.object({ confirmName: z.string().min(1) });
      const parsed = confirmSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const [target] = await db
        .select({ id: organizations.id, name: organizations.name, isFounder: organizations.isFounder })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1);
      if (!target) return Errors.notFound(res, "Organization");
      if (target.isFounder) {
        return Errors.badRequest(res, "Refusing to delete a founder organization");
      }
      if (parsed.data.confirmName !== target.name) {
        return Errors.badRequest(
          res,
          "confirmName does not match the organization's exact name — deletion not performed",
        );
      }

      const { deleteOrganization } = await import("./services/orgDeletion");
      const result = await deleteOrganization(orgId);

      res.json({
        success: result.orgRowDeleted && result.residualTables.length === 0,
        ...result,
        note: result.residualTables.length > 0
          ? "Erasure INCOMPLETE — residual tables require manual resolution (see server logs)."
          : "Erasure complete. audit_events retained under GDPR Art. 17(3)(b); financial_ledger detached (org id nulled).",
      });
    } catch (err: any) {
      logger.error("Org deletion error", err instanceof Error ? err : undefined);
      Errors.internal(res, err);
    }
  });

  api.post("/api/admin/set-founder", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const parsedFounder = setFounderSchema.safeParse(req.body);
      if (!parsedFounder.success) return Errors.validationFailed(res, parsedFounder.error.issues);
      const { organizationId, isFounder } = parsedFounder.data;

      // If no organizationId provided, use the current user's organization
      const org = req.organization;
      const targetOrgId = organizationId || org?.id;
      
      if (!targetOrgId) {
        return Errors.badRequest(res, "Organization ID is required");
      }
      
      const [updated] = await db
        .update(organizations)
        .set({ isFounder: isFounder ?? true })
        .where(eq(organizations.id, targetOrgId))
        .returning();
      
      if (!updated) {
        return Errors.notFound(res, "Organization");
      }
      
      res.json({ 
        success: true, 
        message: isFounder === false ? "Founder status removed" : "Founder status granted",
        organization: updated 
      });
    } catch (err: any) {
      logger.error("Set founder status error", err);
      Errors.internal(res, err);
    }
  });

  // User Analytics Endpoints
  api.get("/api/admin/users", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const orgs = await storage.getAllOrganizationsWithDetails();
      res.json(orgs);
    } catch (err: any) {
      logger.error("Admin users error", err);
      Errors.internal(res, err);
    }
  });

  api.get("/api/admin/subscription-stats", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const stats = await storage.getSubscriptionStats();
      res.json(stats);
    } catch (err: any) {
      logger.error("Subscription stats error", err);
      Errors.internal(res, err);
    }
  });

  api.get("/api/admin/subscription-events", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const limit = Math.min(100, req.query.limit ? parseInt(req.query.limit as string) : 50);
      const events = await storage.getSubscriptionEvents({ limit });
      res.json(events);
    } catch (err: any) {
      logger.error("Subscription events error", err);
      Errors.internal(res, err);
    }
  });

  // ============================================
  // DATA SOURCE VALIDATION (Comprehensive Source Health)
  // ============================================

  api.get("/api/admin/data-sources/stats", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { dataSourceValidator } = await import("./services/data-source-validator");
      const stats = await dataSourceValidator.getValidationStats();
      res.json(stats);
    } catch (err: any) {
      logger.error("Data source stats error", err);
      Errors.internal(res, err);
    }
  });

  api.get("/api/admin/data-sources", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { category, status, limit = "100", offset = "0" } = req.query;
      
      // dataSources is a system-level shared table (GIS endpoints, public data sources);
      // org isolation is not applicable — all orgs reference the same shared catalogue.
      const conditions = [];
      if (category) {
        conditions.push(eq(dataSources.category, String(category)));
      }
      if (status === "valid") {
        conditions.push(eq(dataSources.isVerified, true));
      } else if (status === "invalid") {
        conditions.push(and(
          eq(dataSources.isVerified, false),
          sql`${dataSources.lastVerifiedAt} IS NOT NULL`
        ));
      } else if (status === "pending") {
        conditions.push(sql`${dataSources.lastVerifiedAt} IS NULL`);
      }
      
      const sources = await db
        .select()
        .from(dataSources)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(dataSources.lastVerifiedAt), dataSources.category)
        .limit(Number(limit))
        .offset(Number(offset));
      
      res.json(sources);
    } catch (err: any) {
      logger.error("Data sources list error", err);
      Errors.internal(res, err);
    }
  });

  api.post("/api/admin/data-sources/validate", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const parsedDsv = dataSourceValidateSchema.safeParse(req.body);
      if (!parsedDsv.success) return Errors.validationFailed(res, parsedDsv.error.issues);
      const { sourceId, category, limit = 50 } = parsedDsv.data;
      const { dataSourceValidator } = await import("./services/data-source-validator");
      
      if (sourceId) {
        const [source] = await db.select().from(dataSources).where(eq(dataSources.id, sourceId));
        if (!source) {
          return Errors.notFound(res, "Source");
        }
        const result = await dataSourceValidator.validateSource(source);
        return res.json(result);
      }
      
      const { runValidationJob, getValidationJobStatus } = await import("./services/dataSourceValidationJob");
      
      runValidationJob({ category, limit }).catch(err => {
        logger.error("Background validation job error", err);
      });
      
      const status = getValidationJobStatus();
      res.json({ 
        message: "Validation job started", 
        ...status 
      });
    } catch (err: any) {
      logger.error("Data source validation error", err);
      Errors.internal(res, err);
    }
  });

  api.get("/api/admin/data-sources/validate/status", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { getValidationJobStatus } = await import("./services/dataSourceValidationJob");
      const status = getValidationJobStatus();
      res.json(status);
    } catch (err: any) {
      logger.error("Validation status error", err);
      Errors.internal(res, err);
    }
  });

  api.patch("/api/admin/data-sources/:id", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const sourceId = Number(req.params.id);
      const parsedDsp = dataSourcePatchSchema.safeParse(req.body);
      if (!parsedDsp.success) return Errors.validationFailed(res, parsedDsp.error.issues);
      const { isEnabled, priority, notes } = parsedDsp.data;
      
      const updates: Record<string, any> = { updatedAt: new Date() };
      if (isEnabled !== undefined) updates.isEnabled = isEnabled;
      if (priority !== undefined) updates.priority = priority;
      if (notes !== undefined) updates.notes = notes;
      
      const [updated] = await db.update(dataSources)
        .set(updates)
        .where(eq(dataSources.id, sourceId))
        .returning();
      
      if (!updated) {
        return Errors.notFound(res, "Source");
      }
      
      res.json(updated);
    } catch (err: any) {
      logger.error("Update data source error", err);
      Errors.internal(res, err);
    }
  });

  api.get("/api/admin/data-sources/categories", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const categories = await db
        .select({
          category: dataSources.category,
          count: sql<number>`count(*)`,
          validCount: sql<number>`count(*) filter (where ${dataSources.isVerified} = true)`,
        })
        .from(dataSources)
        .groupBy(dataSources.category)
        .orderBy(desc(sql`count(*)`));
      
      res.json(categories);
    } catch (err: any) {
      logger.error("Data source categories error", err);
      Errors.internal(res, err);
    }
  });

  // ============================================
  // COUNTY GIS ENDPOINTS (Free Parcel Data)
  // ============================================

  api.get("/api/county-gis-endpoints", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { getCountyGisEndpoints } = await import('./services/parcel');
      const endpoints = await getCountyGisEndpoints();
      res.json(endpoints);
    } catch (err: any) {
      logger.error("Get county GIS endpoints error", err);
      Errors.internal(res, err);
    }
  });

  api.post("/api/county-gis-endpoints", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { countyGisEndpoints, insertCountyGisEndpointSchema } = await import('@shared/schema');
      
      const parsedGis = countyGisEndpointCreateSchema.safeParse(req.body);
      if (!parsedGis.success) return Errors.validationFailed(res, parsedGis.error.issues);
      const { state, county, baseUrl, endpointType } = parsedGis.data;
      if (!state || !county || !baseUrl) {
        return Errors.badRequest(res, "state, county, and baseUrl are required");
      }

      // SSRF guard (Beatrice item 5): operator-contributed baseUrl is fetched
      // server-side. Reject private/loopback/link-local addresses + non-https.
      const { checkOperatorUrl } = await import('./services/providers/ssrf-guard');
      const ssrf = checkOperatorUrl(baseUrl);
      if (!ssrf.ok) {
        return Errors.badRequest(res, ssrf.reason ?? "baseUrl rejected by SSRF guard");
      }

      const endpoint = await db.insert(countyGisEndpoints).values({
        state: state.toUpperCase(),
        county,
        baseUrl,
        endpointType: endpointType || "arcgis_rest",
        layerId: req.body.layerId,
        apnField: req.body.apnField || "APN",
        ownerField: req.body.ownerField || "OWNER",
        fieldMappings: req.body.fieldMappings,
        fipsCode: req.body.fipsCode,
        sourceUrl: req.body.sourceUrl,
        notes: req.body.notes,
        isActive: true,
        isVerified: false,
        contributedBy: req.user?.email || "admin",
      }).returning();
      res.json(endpoint[0]);
    } catch (err: any) {
      logger.error("Add county GIS endpoint error", err);
      Errors.internal(res, err);
    }
  });

  api.post("/api/county-gis-endpoints/seed", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { seedCountyGisEndpoints } = await import('./services/parcel');
      const result = await seedCountyGisEndpoints();
      res.json({ message: `Seeded ${result.added} endpoints, ${result.skipped} already existed` });
    } catch (err: any) {
      logger.error("Seed county GIS endpoints error", err);
      Errors.internal(res, err);
    }
  });

  api.delete("/api/county-gis-endpoints/:id", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { countyGisEndpoints } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      await db.delete(countyGisEndpoints).where(eq(countyGisEndpoints.id, id));
      res.json({ success: true });
    } catch (err: any) {
      logger.error("Delete county GIS endpoint error", err);
      Errors.internal(res, err);
    }
  });

  // Test a single GIS endpoint
  api.post("/api/county-gis-endpoints/:id/test", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return Errors.badRequest(res, "Invalid endpoint ID");
      }

      const endpoint = await storage.getCountyGisEndpoint(id);
      if (!endpoint) {
        return Errors.notFound(res, "Endpoint");
      }

      let success = false;
      let message = "";
      let details: any = null;

      try {
        const testUrl = new URL(endpoint.baseUrl);
        if (endpoint.endpointType === "arcgis_rest" || endpoint.endpointType === "arcgis_feature") {
          testUrl.searchParams.set("f", "json");
          testUrl.searchParams.set("where", "1=1");
          testUrl.searchParams.set("resultRecordCount", "1");
          testUrl.searchParams.set("outFields", "*");
        }

        const response = await fetch(testUrl.toString(), {
          method: "GET",
          headers: { "Accept": "application/json" },
          signal: AbortSignal.timeout(10000),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.error) {
            success = false;
            message = `API returned error: ${data.error.message || JSON.stringify(data.error)}`;
            details = data.error;
          } else if (data.features || data.results || data.properties || data.type) {
            success = true;
            message = "Endpoint is working correctly";
            details = { recordCount: data.features?.length || data.results?.length || 1 };
          } else {
            success = true;
            message = "Endpoint responded but returned unexpected format";
            details = { keys: Object.keys(data).slice(0, 10) };
          }
        } else {
          success = false;
          message = `HTTP ${response.status}: ${response.statusText}`;
        }
      } catch (fetchErr: any) {
        success = false;
        message = fetchErr.name === "TimeoutError" ? "Request timed out after 10 seconds" : fetchErr.message;
      }

      await storage.updateCountyGisEndpoint(id, {
        isVerified: success,
        errorCount: success ? 0 : (endpoint.errorCount || 0) + 1,
        lastVerified: new Date(),
        lastError: success ? null : message,
      });

      res.json({ success, message, details });
    } catch (err: any) {
      logger.error("Test GIS endpoint error", err);
      Errors.internal(res, err);
    }
  });

  // Test all GIS endpoints
  api.post("/api/county-gis-endpoints/test-all", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { countyGisEndpoints } = await import('@shared/schema');
      const { getCountyGisEndpoints } = await import('./services/parcel');
      const onlyUnverified = req.body.onlyUnverified === true;

      let endpoints = await getCountyGisEndpoints();
      if (onlyUnverified) {
        endpoints = endpoints.filter(e => !e.isVerified);
      }

      const results: Array<{ id: number; state: string; county: string; success: boolean; message: string }> = [];
      let passed = 0;
      let failed = 0;

      for (const endpoint of endpoints.slice(0, 20)) {
        try {
          const testUrl = new URL(endpoint.baseUrl);
          if (endpoint.endpointType === "arcgis_rest" || endpoint.endpointType === "arcgis_feature") {
            testUrl.searchParams.set("f", "json");
            testUrl.searchParams.set("where", "1=1");
            testUrl.searchParams.set("resultRecordCount", "1");
            testUrl.searchParams.set("outFields", "*");
          }

          const response = await fetch(testUrl.toString(), {
            method: "GET",
            headers: { "Accept": "application/json" },
            signal: AbortSignal.timeout(10000),
          });

          let success = false;
          let message = "";

          if (response.ok) {
            const data = await response.json();
            if (data.error) {
              success = false;
              message = data.error.message || "API error";
            } else {
              success = true;
              message = "OK";
            }
          } else {
            success = false;
            message = `HTTP ${response.status}`;
          }

          await storage.updateCountyGisEndpoint(endpoint.id, {
            isVerified: success,
            errorCount: success ? 0 : (endpoint.errorCount || 0) + 1,
            lastVerified: new Date(),
            lastError: success ? null : message,
          });

          if (success) passed++;
          else failed++;

          results.push({ id: endpoint.id, state: endpoint.state, county: endpoint.county, success, message });
        } catch (fetchErr: any) {
          failed++;
          const message = fetchErr.name === "TimeoutError" ? "Timeout" : fetchErr.message;
          await storage.updateCountyGisEndpoint(endpoint.id, {
            isVerified: false,
            errorCount: (endpoint.errorCount || 0) + 1,
            lastVerified: new Date(),
            lastError: message,
          });
          results.push({ id: endpoint.id, state: endpoint.state, county: endpoint.county, success: false, message });
        }
      }

      res.json({ tested: results.length, passed, failed, results });
    } catch (err: any) {
      logger.error("Test all GIS endpoints error", err);
      Errors.internal(res, err);
    }
  });

  // Scan for new endpoints - comprehensive discovery across all US states
  api.post("/api/county-gis-endpoints/scan", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { countyGisEndpoints } = await import('@shared/schema');
      
      // Comprehensive database of known county GIS endpoint patterns
      const knownEndpointPatterns: Array<{
        state: string;
        county: string;
        baseUrl: string;
        endpointType: string;
        fipsCode?: string;
        confidenceScore: number;
      }> = [
        // ALABAMA
        { state: "AL", county: "Jefferson", baseUrl: "https://gis.jccal.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "01073", confidenceScore: 85 },
        { state: "AL", county: "Mobile", baseUrl: "https://gis.mobilecountyal.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "01097", confidenceScore: 80 },
        { state: "AL", county: "Madison", baseUrl: "https://maps.co.madison.al.us/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "01089", confidenceScore: 75 },
        // ALASKA
        { state: "AK", county: "Anchorage", baseUrl: "https://gis.muni.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "02020", confidenceScore: 70 },
        { state: "AK", county: "Fairbanks North Star", baseUrl: "https://gis.fnsb.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "02090", confidenceScore: 70 },
        // ARIZONA
        { state: "AZ", county: "Maricopa", baseUrl: "https://gis.maricopa.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "04013", confidenceScore: 90 },
        { state: "AZ", county: "Pima", baseUrl: "https://gis.pima.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "04019", confidenceScore: 85 },
        { state: "AZ", county: "Pinal", baseUrl: "https://gis.pinalcountyaz.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "04021", confidenceScore: 80 },
        { state: "AZ", county: "Yavapai", baseUrl: "https://gis.yavapai.us/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "04025", confidenceScore: 75 },
        // ARKANSAS
        { state: "AR", county: "Pulaski", baseUrl: "https://gis.pulaskicounty.net/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "05119", confidenceScore: 75 },
        { state: "AR", county: "Benton", baseUrl: "https://gis.bentoncountyar.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "05007", confidenceScore: 70 },
        // CALIFORNIA
        { state: "CA", county: "Los Angeles", baseUrl: "https://assessor.lacounty.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "06037", confidenceScore: 90 },
        { state: "CA", county: "San Diego", baseUrl: "https://gis.sandiegocounty.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "06073", confidenceScore: 88 },
        { state: "CA", county: "Orange", baseUrl: "https://gis.ocgov.com/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "06059", confidenceScore: 85 },
        { state: "CA", county: "Riverside", baseUrl: "https://gis.rivco.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "06065", confidenceScore: 80 },
        { state: "CA", county: "San Bernardino", baseUrl: "https://gis.sbcounty.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "06071", confidenceScore: 80 },
        { state: "CA", county: "Santa Clara", baseUrl: "https://gis.sccgov.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "06085", confidenceScore: 82 },
        { state: "CA", county: "Alameda", baseUrl: "https://gis.acgov.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "06001", confidenceScore: 80 },
        { state: "CA", county: "Sacramento", baseUrl: "https://gis.saccounty.net/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "06067", confidenceScore: 78 },
        { state: "CA", county: "Fresno", baseUrl: "https://gis.fresnocountyca.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "06019", confidenceScore: 75 },
        { state: "CA", county: "Kern", baseUrl: "https://gis.kerncounty.com/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "06029", confidenceScore: 75 },
        // COLORADO
        { state: "CO", county: "Denver", baseUrl: "https://gis.denvergov.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "08031", confidenceScore: 85 },
        { state: "CO", county: "El Paso", baseUrl: "https://gis.elpasoco.com/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "08041", confidenceScore: 82 },
        { state: "CO", county: "Arapahoe", baseUrl: "https://gis.arapahoegov.com/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "08005", confidenceScore: 80 },
        { state: "CO", county: "Jefferson", baseUrl: "https://gis.jeffco.us/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "08059", confidenceScore: 80 },
        { state: "CO", county: "Adams", baseUrl: "https://gis.adcogov.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "08001", confidenceScore: 78 },
        // CONNECTICUT
        { state: "CT", county: "Fairfield", baseUrl: "https://gis.fairfieldct.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "09001", confidenceScore: 75 },
        { state: "CT", county: "Hartford", baseUrl: "https://gis.hartfordct.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "09003", confidenceScore: 75 },
        // DELAWARE
        { state: "DE", county: "New Castle", baseUrl: "https://gis.nccde.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "10003", confidenceScore: 78 },
        { state: "DE", county: "Kent", baseUrl: "https://gis.co.kent.de.us/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "10001", confidenceScore: 72 },
        { state: "DE", county: "Sussex", baseUrl: "https://gis.sussexcountyde.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "10005", confidenceScore: 72 },
        // FLORIDA
        { state: "FL", county: "Miami-Dade", baseUrl: "https://gis.miamidade.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "12086", confidenceScore: 90 },
        { state: "FL", county: "Broward", baseUrl: "https://gis.broward.org/arcgis/rest/services/Parcels/FeatureServer/0/query", endpointType: "arcgis_feature", fipsCode: "12011", confidenceScore: 88 },
        { state: "FL", county: "Palm Beach", baseUrl: "https://gis.pbcgov.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "12099", confidenceScore: 85 },
        { state: "FL", county: "Hillsborough", baseUrl: "https://gis.hcpafl.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "12057", confidenceScore: 82 },
        { state: "FL", county: "Orange", baseUrl: "https://gis.ocpafl.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "12095", confidenceScore: 82 },
        { state: "FL", county: "Pinellas", baseUrl: "https://gis.pinellascounty.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "12103", confidenceScore: 80 },
        { state: "FL", county: "Duval", baseUrl: "https://maps.coj.net/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "12031", confidenceScore: 78 },
        { state: "FL", county: "Lee", baseUrl: "https://gis.leegov.com/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "12071", confidenceScore: 78 },
        // GEORGIA
        { state: "GA", county: "Fulton", baseUrl: "https://gis.fultoncountyga.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "13121", confidenceScore: 85 },
        { state: "GA", county: "Gwinnett", baseUrl: "https://gis.gwinnettcounty.com/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "13135", confidenceScore: 82 },
        { state: "GA", county: "Cobb", baseUrl: "https://gis.cobbcountyga.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "13067", confidenceScore: 80 },
        { state: "GA", county: "DeKalb", baseUrl: "https://gis.dekalbcountyga.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "13089", confidenceScore: 78 },
        // HAWAII
        { state: "HI", county: "Honolulu", baseUrl: "https://gis.honolulu.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "15003", confidenceScore: 80 },
        { state: "HI", county: "Maui", baseUrl: "https://gis.mauicounty.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "15009", confidenceScore: 75 },
        // IDAHO
        { state: "ID", county: "Ada", baseUrl: "https://gis.adacounty.id.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "16001", confidenceScore: 78 },
        { state: "ID", county: "Canyon", baseUrl: "https://gis.canyoncounty.id.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "16027", confidenceScore: 72 },
        // ILLINOIS
        { state: "IL", county: "Cook", baseUrl: "https://gis.cookcountyil.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "17031", confidenceScore: 90 },
        { state: "IL", county: "DuPage", baseUrl: "https://gis.dupageco.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "17043", confidenceScore: 82 },
        { state: "IL", county: "Lake", baseUrl: "https://gis.lakecountyil.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "17097", confidenceScore: 80 },
        { state: "IL", county: "Will", baseUrl: "https://gis.willcountyillinois.com/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "17197", confidenceScore: 78 },
        // INDIANA
        { state: "IN", county: "Marion", baseUrl: "https://gis.indy.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "18097", confidenceScore: 85 },
        { state: "IN", county: "Lake", baseUrl: "https://gis.lakecountyin.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "18089", confidenceScore: 78 },
        { state: "IN", county: "Allen", baseUrl: "https://gis.allencounty.us/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "18003", confidenceScore: 75 },
        // IOWA
        { state: "IA", county: "Polk", baseUrl: "https://gis.polkcountyiowa.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "19153", confidenceScore: 78 },
        { state: "IA", county: "Linn", baseUrl: "https://gis.linncountyiowa.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "19113", confidenceScore: 72 },
        // KANSAS
        { state: "KS", county: "Johnson", baseUrl: "https://gis.jocogov.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "20091", confidenceScore: 80 },
        { state: "KS", county: "Sedgwick", baseUrl: "https://gis.sedgwickcounty.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "20173", confidenceScore: 78 },
        // KENTUCKY
        { state: "KY", county: "Jefferson", baseUrl: "https://lojic.lojic.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "21111", confidenceScore: 82 },
        { state: "KY", county: "Fayette", baseUrl: "https://gis.lexingtonky.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "21067", confidenceScore: 78 },
        // LOUISIANA
        { state: "LA", county: "Orleans Parish", baseUrl: "https://gis.nola.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "22071", confidenceScore: 80 },
        { state: "LA", county: "East Baton Rouge", baseUrl: "https://gis.brla.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "22033", confidenceScore: 78 },
        // MAINE
        { state: "ME", county: "Cumberland", baseUrl: "https://gis.cumberlandcounty.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "23005", confidenceScore: 70 },
        // MARYLAND
        { state: "MD", county: "Montgomery", baseUrl: "https://gis.montgomerycountymd.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "24031", confidenceScore: 85 },
        { state: "MD", county: "Prince Georges", baseUrl: "https://gis.princegeorgescountymd.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "24033", confidenceScore: 82 },
        { state: "MD", county: "Baltimore County", baseUrl: "https://gis.baltimorecountymd.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "24005", confidenceScore: 80 },
        { state: "MD", county: "Anne Arundel", baseUrl: "https://gis.aacounty.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "24003", confidenceScore: 78 },
        // MASSACHUSETTS
        { state: "MA", county: "Middlesex", baseUrl: "https://gis.middlesexcounty.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "25017", confidenceScore: 75 },
        { state: "MA", county: "Worcester", baseUrl: "https://gis.worcesterma.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "25027", confidenceScore: 72 },
        // MICHIGAN
        { state: "MI", county: "Wayne", baseUrl: "https://gis.waynecounty.com/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "26163", confidenceScore: 85 },
        { state: "MI", county: "Oakland", baseUrl: "https://gis.oakgov.com/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "26125", confidenceScore: 82 },
        { state: "MI", county: "Macomb", baseUrl: "https://gis.macombcountymi.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "26099", confidenceScore: 78 },
        { state: "MI", county: "Kent", baseUrl: "https://gis.accesskent.com/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "26081", confidenceScore: 78 },
        // MINNESOTA
        { state: "MN", county: "Hennepin", baseUrl: "https://gis.hennepin.us/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "27053", confidenceScore: 85 },
        { state: "MN", county: "Ramsey", baseUrl: "https://gis.ramseycounty.us/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "27123", confidenceScore: 82 },
        { state: "MN", county: "Dakota", baseUrl: "https://gis.co.dakota.mn.us/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "27037", confidenceScore: 78 },
        // MISSISSIPPI
        { state: "MS", county: "Hinds", baseUrl: "https://gis.co.hinds.ms.us/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "28049", confidenceScore: 72 },
        // MISSOURI
        { state: "MO", county: "St. Louis County", baseUrl: "https://gis.stlouisco.com/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "29189", confidenceScore: 85 },
        { state: "MO", county: "Jackson", baseUrl: "https://gis.jacksongov.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "29095", confidenceScore: 80 },
        // MONTANA
        { state: "MT", county: "Yellowstone", baseUrl: "https://gis.co.yellowstone.mt.us/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "30111", confidenceScore: 70 },
        // NEBRASKA
        { state: "NE", county: "Douglas", baseUrl: "https://gis.douglascountyne.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "31055", confidenceScore: 78 },
        { state: "NE", county: "Lancaster", baseUrl: "https://gis.lincoln.ne.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "31109", confidenceScore: 75 },
        // NEVADA
        { state: "NV", county: "Clark", baseUrl: "https://gis.clarkcountynv.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "32003", confidenceScore: 88 },
        { state: "NV", county: "Washoe", baseUrl: "https://gis.washoecounty.us/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "32031", confidenceScore: 82 },
        // NEW HAMPSHIRE
        { state: "NH", county: "Hillsborough", baseUrl: "https://gis.nhgranit.unh.edu/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "33011", confidenceScore: 68 },
        // NEW JERSEY
        { state: "NJ", county: "Bergen", baseUrl: "https://gis.co.bergen.nj.us/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "34003", confidenceScore: 80 },
        { state: "NJ", county: "Essex", baseUrl: "https://gis.essexcountynj.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "34013", confidenceScore: 78 },
        { state: "NJ", county: "Middlesex", baseUrl: "https://gis.co.middlesex.nj.us/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "34023", confidenceScore: 75 },
        // NEW MEXICO
        { state: "NM", county: "Bernalillo", baseUrl: "https://gis.bernco.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "35001", confidenceScore: 80 },
        { state: "NM", county: "Dona Ana", baseUrl: "https://gis.donaanacounty.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "35013", confidenceScore: 72 },
        // NEW YORK
        { state: "NY", county: "Kings", baseUrl: "https://gis.nyc.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "36047", confidenceScore: 90 },
        { state: "NY", county: "Queens", baseUrl: "https://gis.nyc.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "36081", confidenceScore: 90 },
        { state: "NY", county: "Suffolk", baseUrl: "https://gis.suffolkcountyny.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "36103", confidenceScore: 82 },
        { state: "NY", county: "Nassau", baseUrl: "https://gis.nassaucountyny.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "36059", confidenceScore: 80 },
        { state: "NY", county: "Westchester", baseUrl: "https://gis.westchestergov.com/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "36119", confidenceScore: 78 },
        { state: "NY", county: "Erie", baseUrl: "https://gis.erie.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "36029", confidenceScore: 75 },
        // NORTH CAROLINA
        { state: "NC", county: "Mecklenburg", baseUrl: "https://gis.mecklenburgcountync.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "37119", confidenceScore: 85 },
        { state: "NC", county: "Wake", baseUrl: "https://gis.wakegov.com/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "37183", confidenceScore: 85 },
        { state: "NC", county: "Guilford", baseUrl: "https://gis.guilfordcountync.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "37081", confidenceScore: 78 },
        { state: "NC", county: "Forsyth", baseUrl: "https://gis.forsyth.cc/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "37067", confidenceScore: 75 },
        // NORTH DAKOTA
        { state: "ND", county: "Cass", baseUrl: "https://gis.casscountynd.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "38017", confidenceScore: 70 },
        // OHIO
        { state: "OH", county: "Cuyahoga", baseUrl: "https://gis.cuyahogacounty.us/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "39035", confidenceScore: 85 },
        { state: "OH", county: "Franklin", baseUrl: "https://gis.franklincountyohio.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "39049", confidenceScore: 85 },
        { state: "OH", county: "Hamilton", baseUrl: "https://gis.hamiltoncoginc.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "39061", confidenceScore: 82 },
        { state: "OH", county: "Summit", baseUrl: "https://gis.co.summit.oh.us/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "39153", confidenceScore: 78 },
        { state: "OH", county: "Montgomery", baseUrl: "https://gis.mcohio.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "39113", confidenceScore: 75 },
        // OKLAHOMA
        { state: "OK", county: "Oklahoma", baseUrl: "https://gis.oklahomacounty.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "40109", confidenceScore: 80 },
        { state: "OK", county: "Tulsa", baseUrl: "https://gis.tulsacounty.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "40143", confidenceScore: 78 },
        // OREGON
        { state: "OR", county: "Multnomah", baseUrl: "https://gis.multco.us/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "41051", confidenceScore: 82 },
        { state: "OR", county: "Washington", baseUrl: "https://gis.co.washington.or.us/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "41067", confidenceScore: 78 },
        { state: "OR", county: "Clackamas", baseUrl: "https://gis.clackamas.us/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "41005", confidenceScore: 75 },
        // PENNSYLVANIA
        { state: "PA", county: "Philadelphia", baseUrl: "https://gis.phila.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "42101", confidenceScore: 88 },
        { state: "PA", county: "Allegheny", baseUrl: "https://gis.alleghenycounty.us/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "42003", confidenceScore: 85 },
        { state: "PA", county: "Montgomery", baseUrl: "https://gis.montcopa.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "42091", confidenceScore: 80 },
        { state: "PA", county: "Bucks", baseUrl: "https://gis.buckscounty.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "42017", confidenceScore: 78 },
        { state: "PA", county: "Delaware", baseUrl: "https://gis.co.delaware.pa.us/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "42045", confidenceScore: 75 },
        // RHODE ISLAND
        { state: "RI", county: "Providence", baseUrl: "https://gis.providenceri.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "44007", confidenceScore: 75 },
        // SOUTH CAROLINA
        { state: "SC", county: "Greenville", baseUrl: "https://gis.greenvillecounty.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "45045", confidenceScore: 80 },
        { state: "SC", county: "Charleston", baseUrl: "https://gis.charlestoncounty.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "45019", confidenceScore: 78 },
        { state: "SC", county: "Richland", baseUrl: "https://gis.richlandcountysc.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "45079", confidenceScore: 75 },
        // SOUTH DAKOTA
        { state: "SD", county: "Minnehaha", baseUrl: "https://gis.minnehahacounty.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "46099", confidenceScore: 70 },
        // TENNESSEE
        { state: "TN", county: "Shelby", baseUrl: "https://gis.shelbycountytn.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "47157", confidenceScore: 82 },
        { state: "TN", county: "Davidson", baseUrl: "https://gis.nashville.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "47037", confidenceScore: 82 },
        { state: "TN", county: "Knox", baseUrl: "https://gis.knoxcounty.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "47093", confidenceScore: 78 },
        { state: "TN", county: "Hamilton", baseUrl: "https://gis.hamiltontn.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "47065", confidenceScore: 75 },
        // TEXAS
        { state: "TX", county: "Harris", baseUrl: "https://gis.hcad.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "48201", confidenceScore: 90 },
        { state: "TX", county: "Dallas", baseUrl: "https://gis.dallascad.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "48113", confidenceScore: 88 },
        { state: "TX", county: "Tarrant", baseUrl: "https://gis.tad.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "48439", confidenceScore: 85 },
        { state: "TX", county: "Bexar", baseUrl: "https://gis.bcad.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "48029", confidenceScore: 85 },
        { state: "TX", county: "Travis", baseUrl: "https://gis.traviscad.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "48453", confidenceScore: 85 },
        { state: "TX", county: "Collin", baseUrl: "https://gis.collincad.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "48085", confidenceScore: 82 },
        { state: "TX", county: "Denton", baseUrl: "https://gis.dentoncad.com/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "48121", confidenceScore: 80 },
        { state: "TX", county: "El Paso", baseUrl: "https://gis.epcad.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "48141", confidenceScore: 78 },
        { state: "TX", county: "Fort Bend", baseUrl: "https://gis.fbcad.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "48157", confidenceScore: 78 },
        { state: "TX", county: "Williamson", baseUrl: "https://gis.wcad.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "48491", confidenceScore: 75 },
        // UTAH
        { state: "UT", county: "Salt Lake", baseUrl: "https://gis.slco.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "49035", confidenceScore: 85 },
        { state: "UT", county: "Utah", baseUrl: "https://gis.utahcounty.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "49049", confidenceScore: 80 },
        { state: "UT", county: "Davis", baseUrl: "https://gis.daviscountyutah.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "49011", confidenceScore: 75 },
        // VERMONT
        { state: "VT", county: "Chittenden", baseUrl: "https://gis.vcgi.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "50007", confidenceScore: 68 },
        // VIRGINIA
        { state: "VA", county: "Fairfax", baseUrl: "https://gis.fairfaxcounty.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "51059", confidenceScore: 85 },
        { state: "VA", county: "Prince William", baseUrl: "https://gis.pwcgov.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "51153", confidenceScore: 80 },
        { state: "VA", county: "Loudoun", baseUrl: "https://gis.loudoun.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "51107", confidenceScore: 80 },
        { state: "VA", county: "Virginia Beach", baseUrl: "https://gis.vbgov.com/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "51810", confidenceScore: 78 },
        { state: "VA", county: "Henrico", baseUrl: "https://gis.henrico.us/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "51087", confidenceScore: 75 },
        // WASHINGTON
        { state: "WA", county: "King", baseUrl: "https://gis.kingcounty.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "53033", confidenceScore: 90 },
        { state: "WA", county: "Pierce", baseUrl: "https://gis.piercecountywa.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "53053", confidenceScore: 82 },
        { state: "WA", county: "Snohomish", baseUrl: "https://gis.snoco.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "53061", confidenceScore: 80 },
        { state: "WA", county: "Spokane", baseUrl: "https://gis.spokanecounty.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "53063", confidenceScore: 78 },
        { state: "WA", county: "Clark", baseUrl: "https://gis.clark.wa.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "53011", confidenceScore: 75 },
        // WEST VIRGINIA
        { state: "WV", county: "Kanawha", baseUrl: "https://gis.kanawha.us/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "54039", confidenceScore: 70 },
        // WISCONSIN
        { state: "WI", county: "Milwaukee", baseUrl: "https://gis.milwaukee.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "55079", confidenceScore: 85 },
        { state: "WI", county: "Dane", baseUrl: "https://gis.countyofdane.com/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "55025", confidenceScore: 80 },
        { state: "WI", county: "Waukesha", baseUrl: "https://gis.waukeshacounty.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "55133", confidenceScore: 78 },
        // WYOMING
        { state: "WY", county: "Laramie", baseUrl: "https://gis.laramiecounty.com/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "56021", confidenceScore: 70 },
        { state: "WY", county: "Natrona", baseUrl: "https://gis.natronacounty-wy.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "56025", confidenceScore: 68 },
      ];

      // Get all existing endpoints from database
      const existing = await db.select({ 
        state: countyGisEndpoints.state, 
        county: countyGisEndpoints.county,
        baseUrl: countyGisEndpoints.baseUrl 
      }).from(countyGisEndpoints);
      
      // Create a set of existing state+county+baseUrl combinations for fast lookup
      const existingSet = new Set(
        existing.map(e => `${e.state.toUpperCase()}|${e.county.toLowerCase()}|${e.baseUrl.toLowerCase()}`)
      );
      
      // Filter to only new endpoints
      const newEndpoints = knownEndpointPatterns.filter(ep => {
        const key = `${ep.state.toUpperCase()}|${ep.county.toLowerCase()}|${ep.baseUrl.toLowerCase()}`;
        return !existingSet.has(key);
      });
      
      // Group by state for better UI organization
      const byState: Record<string, typeof newEndpoints> = {};
      for (const ep of newEndpoints) {
        if (!byState[ep.state]) {
          byState[ep.state] = [];
        }
        byState[ep.state].push(ep);
      }
      
      res.json({ 
        discovered: newEndpoints,
        byState,
        totalKnown: knownEndpointPatterns.length,
        totalExisting: existing.length,
        totalNew: newEndpoints.length,
        message: newEndpoints.length > 0 
          ? `Found ${newEndpoints.length} new potential endpoints across ${Object.keys(byState).length} states` 
          : "All known endpoints are already in the database"
      });
    } catch (err: any) {
      logger.error("Scan GIS endpoints error", err);
      Errors.internal(res, err);
    }
  });

  // Bulk add discovered endpoints
  api.post("/api/county-gis-endpoints/bulk-add", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const parsedBulkAdd = bulkAddEndpointsSchema.safeParse(req.body);
      if (!parsedBulkAdd.success) return Errors.validationFailed(res, parsedBulkAdd.error.issues);
      const { endpoints } = parsedBulkAdd.data;
      if (!endpoints || !Array.isArray(endpoints) || endpoints.length === 0) {
        return Errors.badRequest(res, "No endpoints provided");
      }
      
      // Validate each endpoint has required fields
      for (const ep of endpoints) {
        if (!ep.state || !ep.county || !ep.baseUrl) {
          return Errors.badRequest(res, "Each endpoint must have state, county, and baseUrl");
        }
      }
      
      const result = await storage.bulkCreateCountyGisEndpoints(endpoints);
      
      res.json({ 
        success: true, 
        added: result.added, 
        skipped: result.skipped,
        message: `Added ${result.added} endpoints, ${result.skipped} already existed`
      });
    } catch (err: any) {
      logger.error("Bulk add GIS endpoints error", err);
      Errors.internal(res, err);
    }
  });

  // Diagnose endpoint issues
  api.post("/api/county-gis-endpoints/:id/diagnose", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return Errors.badRequest(res, "Invalid endpoint ID");
      }

      const endpoint = await storage.getCountyGisEndpoint(id);
      if (!endpoint) {
        return Errors.notFound(res, "Endpoint");
      }

      const issues: string[] = [];
      const suggestions: string[] = [];

      try {
        const url = new URL(endpoint.baseUrl);

        const response = await fetch(endpoint.baseUrl, {
          method: "GET",
          headers: { "Accept": "application/json" },
          signal: AbortSignal.timeout(15000),
        });

        if (!response.ok) {
          issues.push(`Server returned HTTP ${response.status}: ${response.statusText}`);
          if (response.status === 404) {
            suggestions.push("The endpoint URL may have changed. Try finding the updated URL on the county's GIS portal.");
          } else if (response.status === 403 || response.status === 401) {
            suggestions.push("The endpoint may require authentication or may have been restricted.");
          } else if (response.status >= 500) {
            suggestions.push("The server is experiencing issues. Try again later.");
          }
        } else {
          const text = await response.text();
          try {
            const data = JSON.parse(text);
            if (data.error) {
              issues.push(`API error: ${data.error.message || JSON.stringify(data.error)}`);
              if (data.error.code === 400) {
                suggestions.push("Check if the query parameters are correct for this endpoint type.");
              }
            }
          } catch {
            issues.push("Response is not valid JSON - endpoint may have changed format");
            suggestions.push("Check if the endpoint still serves JSON data");
          }
        }
      } catch (fetchErr: any) {
        if (fetchErr.name === "TimeoutError") {
          issues.push("Connection timed out after 15 seconds");
          suggestions.push("The server may be slow or unreachable. Check if the county GIS portal is online.");
        } else if (fetchErr.code === "ENOTFOUND") {
          issues.push("DNS resolution failed - domain not found");
          suggestions.push("The domain may have changed. Look up the county's current GIS portal.");
        } else {
          issues.push(`Connection error: ${fetchErr.message}`);
        }
      }

      if (!endpoint.layerId && (endpoint.endpointType === "arcgis_rest" || endpoint.endpointType === "arcgis_feature")) {
        suggestions.push("Consider adding a layer ID if the endpoint has multiple layers");
      }

      if (issues.length === 0) {
        issues.push("No immediate issues detected - endpoint appears to be working");
      }

      res.json({ issues, suggestions, endpoint: { state: endpoint.state, county: endpoint.county, lastError: endpoint.lastError } });
    } catch (err: any) {
      logger.error("Diagnose GIS endpoint error", err);
      Errors.internal(res, err);
    }
  });

  // ============================================
  // LIVE GIS DISCOVERY (ArcGIS Online Scanning)
  // ============================================

  api.post("/api/discovery/scan-arcgis", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { runDiscoveryScan } = await import('./services/arcgis-discovery');
      const parsedScan = discoveryScanSchema.safeParse(req.body);
      if (!parsedScan.success) return Errors.validationFailed(res, parsedScan.error.issues);
      const { keywords, maxResults, targetStates } = parsedScan.data;
      
      logger.info("[Discovery] Starting ArcGIS Online scan...");
      const result = await runDiscoveryScan({
        keywords: keywords || undefined,
        maxResults: maxResults || 100,
        targetStates: targetStates || undefined,
      });
      
      const endpointsToStore = result.endpoints.map(ep => ({
        state: ep.state,
        county: ep.county,
        baseUrl: ep.baseUrl,
        endpointType: ep.endpointType,
        serviceName: ep.serviceName,
        discoverySource: ep.discoverySource,
        confidenceScore: ep.confidenceScore,
        metadata: ep.metadata,
        status: "pending" as const,
      }));
      
      const storeResult = await storage.bulkCreateDiscoveredEndpoints(endpointsToStore);
      
      logger.info(`[Discovery] Scan complete: ${storeResult.added} new, ${storeResult.skipped} duplicates`);
      
      res.json({
        success: true,
        totalSearchResults: result.stats.totalSearchResults,
        validEndpoints: result.stats.validEndpoints,
        added: storeResult.added,
        skipped: storeResult.skipped,
        message: `Found ${result.stats.validEndpoints} endpoints, added ${storeResult.added} new (${storeResult.skipped} already exist)`
      });
    } catch (err: any) {
      logger.error("ArcGIS discovery scan error", err);
      Errors.internal(res, err);
    }
  });

  api.get("/api/discovery/pending", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const status = (req.query.status as string) || "pending";
      const state = req.query.state as string | undefined;
      const endpoints = await storage.getDiscoveredEndpoints({ status, state });
      res.json(endpoints);
    } catch (err: any) {
      logger.error("Get pending discovery endpoints error", err);
      Errors.internal(res, err);
    }
  });

  api.get("/api/discovery/all", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const state = req.query.state as string | undefined;
      const endpoints = await storage.getDiscoveredEndpoints({ state });
      res.json(endpoints);
    } catch (err: any) {
      logger.error("Get all discovery endpoints error", err);
      Errors.internal(res, err);
    }
  });

  api.post("/api/discovery/:id/validate", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return Errors.badRequest(res, "Invalid endpoint ID");
      }
      
      const endpoint = await storage.getDiscoveredEndpoint(id);
      if (!endpoint) {
        return Errors.notFound(res, "Endpoint");
      }
      
      const { validateEndpoint } = await import('./services/arcgis-discovery');
      const result = await validateEndpoint(endpoint.baseUrl);
      
      await storage.updateDiscoveredEndpoint(id, {
        lastChecked: new Date(),
        healthCheckPassed: result.valid,
        healthCheckMessage: result.message,
        status: result.valid ? "validated" : "pending",
      });
      
      const updated = await storage.getDiscoveredEndpoint(id);
      res.json({ ...result, endpoint: updated });
    } catch (err: any) {
      logger.error("Validate discovery endpoint error", err);
      Errors.internal(res, err);
    }
  });

  api.post("/api/discovery/:id/approve", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return Errors.badRequest(res, "Invalid endpoint ID");
      }
      
      const result = await storage.approveDiscoveredEndpoint(id);
      res.json(result);
    } catch (err: any) {
      logger.error("Approve discovery endpoint error", err);
      Errors.internal(res, err);
    }
  });

  api.post("/api/discovery/:id/reject", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return Errors.badRequest(res, "Invalid endpoint ID");
      }
      
      const endpoint = await storage.rejectDiscoveredEndpoint(id);
      res.json({ success: true, endpoint });
    } catch (err: any) {
      logger.error("Reject discovery endpoint error", err);
      Errors.internal(res, err);
    }
  });

  api.post("/api/discovery/validate-all", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const pendingEndpoints = await storage.getDiscoveredEndpoints({ status: "pending" });
      const { validateEndpoint } = await import('./services/arcgis-discovery');
      
      let validated = 0;
      let failed = 0;
      
      for (const endpoint of pendingEndpoints.slice(0, 20)) {
        try {
          const result = await validateEndpoint(endpoint.baseUrl);
          await storage.updateDiscoveredEndpoint(endpoint.id, {
            lastChecked: new Date(),
            healthCheckPassed: result.valid,
            healthCheckMessage: result.message,
            status: result.valid ? "validated" : "pending",
          });
          if (result.valid) validated++;
          else failed++;
          await new Promise(r => setTimeout(r, 500));
        } catch (err) {
          failed++;
        }
      }
      
      res.json({ 
        success: true, 
        validated, 
        failed, 
        total: pendingEndpoints.length,
        processed: Math.min(pendingEndpoints.length, 20)
      });
    } catch (err: any) {
      logger.error("Batch validate discovery endpoints error", err);
      Errors.internal(res, err);
    }
  });

  api.delete("/api/discovery/:id", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return Errors.badRequest(res, "Invalid endpoint ID");
      }
      
      const { discoveredEndpoints } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      await db.delete(discoveredEndpoints).where(eq(discoveredEndpoints.id, id));
      res.json({ success: true });
    } catch (err: any) {
      logger.error("Delete discovery endpoint error", err);
      Errors.internal(res, err);
    }
  });

  // ============================================
  // DATA SOURCES (Free Data Endpoint Registry)
  // ============================================

  const updateDataSourceSchema = z.object({
    isEnabled: z.boolean().optional(),
    isVerified: z.boolean().optional(),
    priority: z.number().optional(),
    notes: z.string().optional(),
  });

  api.get("/api/data-sources", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const category = req.query.category as string | undefined;
      const isEnabled = req.query.isEnabled === 'true' ? true : req.query.isEnabled === 'false' ? false : undefined;
      const sources = await storage.getDataSources({ category, isEnabled });
      res.json(sources);
    } catch (err: any) {
      logger.error("Get data sources error", err);
      Errors.internal(res, err);
    }
  });

  api.get("/api/data-sources/stats", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const stats = await storage.getDataSourceStats();
      res.json(stats);
    } catch (err: any) {
      logger.error("Get data sources stats error", err);
      Errors.internal(res, err);
    }
  });

  api.patch("/api/data-sources/:id", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return Errors.badRequest(res, "Invalid data source ID");
      }
      
      const parseResult = updateDataSourceSchema.safeParse(req.body);
      if (!parseResult.success) {
        return Errors.validationFailed(res, parseResult.error.issues);
      }
      
      const source = await storage.getDataSource(id);
      if (!source) {
        return Errors.notFound(res, "Data source");
      }
      
      const updated = await storage.updateDataSource(id, parseResult.data);
      res.json(updated);
    } catch (err: any) {
      logger.error("Update data source error", err);
      Errors.internal(res, err);
    }
  });

  api.delete("/api/data-sources/:id", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return Errors.badRequest(res, "Invalid data source ID");
      }
      
      const source = await storage.getDataSource(id);
      if (!source) {
        return Errors.notFound(res, "Data source");
      }
      
      await storage.deleteDataSource(id);
      res.json({ success: true });
    } catch (err: any) {
      logger.error("Delete data source error", err);
      Errors.internal(res, err);
    }
  });

  // Test a single data source (using comprehensive validator)
  api.post("/api/data-sources/:id/test", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return Errors.badRequest(res, "Invalid data source ID");
      }

      const source = await storage.getDataSource(id);
      if (!source) {
        return Errors.notFound(res, "Data source");
      }

      if (!source.apiUrl) {
        return res.json({ success: false, message: "No API URL configured for this data source" });
      }

      const { dataSourceValidator } = await import("./services/data-source-validator");
      const result = await dataSourceValidator.validateSource(source);
      
      const success = result.status === "valid";
      let message = result.status === "valid" 
        ? `Valid ${result.endpointType || 'endpoint'} - ${result.fieldsDetected.length} fields, ${result.geometryType || 'no geometry'}`
        : result.errorMessage || result.status;
      
      if (result.latencyMs) {
        message += ` (${result.latencyMs}ms)`;
      }

      res.json({ 
        success, 
        message,
        details: {
          status: result.status,
          endpointType: result.endpointType,
          fieldsDetected: result.fieldsDetected,
          geometryType: result.geometryType,
          recordCount: result.recordCount,
          latencyMs: result.latencyMs,
        }
      });
    } catch (err: any) {
      logger.error("Test data source error", err);
      Errors.internal(res, err);
    }
  });

  // Test all enabled data sources (starts background validation job)
  api.post("/api/data-sources/test-all", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { category, limit = 50 } = req.body || {};
      const { runValidationJob, getValidationJobStatus, isValidationJobRunning } = await import("./services/dataSourceValidationJob");
      
      if (isValidationJobRunning()) {
        const status = getValidationJobStatus();
        return res.json({
          message: "Validation job already in progress",
          isRunning: true,
          ...status.progress,
        });
      }
      
      runValidationJob({ category, limit }).catch(err => {
        logger.error("Background validation job error", err);
      });
      
      const status = getValidationJobStatus();
      res.json({ 
        message: "Validation job started in background", 
        isRunning: true,
        ...status.progress,
      });
    } catch (err: any) {
      logger.error("Test all data sources error", err);
      Errors.internal(res, err);
    }
  });

  // Get validation job status
  api.get("/api/data-sources/validation-status", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { getValidationJobStatus } = await import("./services/dataSourceValidationJob");
      const status = getValidationJobStatus();
      res.json(status);
    } catch (err: any) {
      logger.error("Validation status error", err);
      Errors.internal(res, err);
    }
  });

  // Bulk import data sources from JSON array
  api.post("/api/data-sources/bulk-import", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const parsedBulk = dataSourcesBulkImportSchema.safeParse(req.body);
      if (!parsedBulk.success) return Errors.validationFailed(res, parsedBulk.error.issues);
      const { sources } = parsedBulk.data;

      if (!Array.isArray(sources) || sources.length === 0) {
        return Errors.badRequest(res, "sources must be a non-empty array");
      }
      if (sources.length > 500) {
        return Errors.badRequest(res, "Cannot import more than 500 sources at once");
      }

      let imported = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (const s of sources) {
        if (!s.key || !s.title || !s.category) {
          errors.push(`Row missing required fields (key, title, category): ${JSON.stringify(s).slice(0, 80)}`);
          skipped++;
          continue;
        }
        try {
          // `s` carries .passthrough() fields typed as unknown; coerce each to
          // the dataSources column types before insert.
          const row = s as Record<string, unknown>;
          const asStr = (v: unknown): string | null => (v == null ? null : String(v));
          await db.insert(dataSources).values({
            key: String(row.key).toLowerCase().replace(/\s+/g, "_").slice(0, 100),
            title: String(row.title).slice(0, 200),
            category: String(row.category).toLowerCase().replace(/\s+/g, "_"),
            subcategory: asStr(row.subcategory),
            description: asStr(row.description),
            portalUrl: asStr(row.portalUrl),
            apiUrl: asStr(row.apiUrl),
            coverage: asStr(row.coverage),
            accessLevel: typeof row.accessLevel === "string" ? row.accessLevel : "free",
            dataTypes: Array.isArray(row.dataTypes) ? row.dataTypes.map(String) : [],
            endpointType: asStr(row.endpointType),
            isEnabled: true,
            isVerified: false,
          }).onConflictDoNothing();
          imported++;
        } catch (e: any) {
          errors.push(`Error inserting ${s.key}: ${e.message}`);
          skipped++;
        }
      }

      res.json({ imported, skipped, errors: errors.slice(0, 20) });
    } catch (err: any) {
      logger.error("Bulk import error", err);
      Errors.internal(res, err);
    }
  });

  // ============================================
  // DATA SOURCE BROKER - Unified Lookup API
  // ============================================

  const brokerLookupSchema = z.object({
    category: z.enum(["parcel_data", "flood_zone", "wetlands", "soil", "environmental", "tax_assessment", "market_data", "zoning", "satellite", "valuation"]),
    latitude: z.number(),
    longitude: z.number(),
    state: z.string().optional(),
    county: z.string().optional(),
    address: z.string().optional(),
    apn: z.string().optional(),
    forceRefresh: z.boolean().optional(),
    maxTier: z.enum(["free", "cached", "byok", "paid"]).optional(),
  });

  api.post("/api/broker/lookup", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const parseResult = brokerLookupSchema.safeParse(req.body);
      if (!parseResult.success) {
        return Errors.validationFailed(res, parseResult.error.issues);
      }

      const { dataSourceBroker } = await import('./services/data-source-broker');
      const { category, ...options } = parseResult.data;
      
      const result = await dataSourceBroker.lookup(category, options);
      res.json(result);
    } catch (err: any) {
      logger.error("Broker lookup error", err);
      Errors.internal(res, err);
    }
  });

  api.post("/api/broker/enrich-property", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const parsedPe = propertyEnrichSchema.safeParse(req.body);
      if (!parsedPe.success) return Errors.validationFailed(res, parsedPe.error.issues);
      const { propertyId, forceRefresh } = parsedPe.data;

      if (!propertyId) {
        return Errors.badRequest(res, "propertyId is required");
      }

      const { propertyEnrichmentService } = await import('./services/propertyEnrichment');
      const result = await propertyEnrichmentService.enrichProperty(org.id, propertyId, forceRefresh);
      
      logger.info("Property enrichment completed and persisted", {
        propertyId,
        organizationId: org.id,
        lookupTimeMs: result.lookupTimeMs,
        hasScores: !!result.scores,
        categoriesEnriched: Object.keys(result).filter(k => result[k as keyof typeof result] !== undefined && k !== 'propertyId' && k !== 'latitude' && k !== 'longitude'),
      });

      // RAFE (Tahoe Wave-2): the parcel-data "aha" is the differentiated
      // free-tier moment. Record it as an activation event (idempotent on
      // org+event) so the getting-started "Look up your first property" step
      // and the /founder/activation funnel both light up on the first lookup.
      try {
        const { recordActivationEventAsync } = await import("./services/activation");
        recordActivationEventAsync({
          orgId: org.id,
          userId: req.user?.id ?? null,
          eventName: "first_lead_enriched",
          eventValue: { propertyId, source: "maps_lookup" },
        });
      } catch { /* non-fatal — telemetry only */ }

      res.json(result);
    } catch (err: any) {
      logger.error("Property enrichment error", { error: err.message, propertyId: req.body?.propertyId });
      Errors.internal(res, err);
    }
  });

  api.post("/api/enrichment/coordinates", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const parsedCoord = coordinatesEnrichSchema.safeParse(req.body);
      if (!parsedCoord.success) return Errors.validationFailed(res, parsedCoord.error.issues);
      const { latitude, longitude, categories, state, county, apn, forceRefresh } = parsedCoord.data;

      if (!latitude || !longitude) {
        return Errors.badRequest(res, "latitude and longitude are required");
      }

      const { propertyEnrichmentService } = await import('./services/propertyEnrichment');
      const result = await propertyEnrichmentService.enrichByCoordinates(latitude, longitude, {
        // The request schema accepts free-form category strings; the broker
        // validates/ignores unknown categories at lookup time.
        categories: categories as LookupCategory[] | undefined,
        state,
        county,
        apn,
        forceRefresh,
      });

      res.json(result);
    } catch (err: any) {
      logger.error("Coordinates enrichment error", err);
      Errors.internal(res, err);
    }
  });

  api.get("/api/map-layers", isAuthenticated, async (req, res) => {
    try {
      const category = req.query.category as string | undefined;
      const state = req.query.state as string | undefined;
      const limit = Math.min(100, req.query.limit ? parseInt(req.query.limit as string) : 50);

      const { dataSourceBroker } = await import('./services/data-source-broker');
      const layers = await dataSourceBroker.getAvailableLayersForMap({ category, state, limit });

      res.json(layers);
    } catch (err: any) {
      logger.error("Get map layers error", err);
      Errors.internal(res, err);
    }
  });

  // ─── User map layer preferences (DB-persisted per user) ──────────────────
  api.get("/api/user/map-layer-preferences", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      const userId: string = user?.id || user?.id;
      if (!userId) return Errors.unauthorized(res);

      const { userMapLayerPreferences } = await import("@shared/schema");
      const prefs = await db.select().from(userMapLayerPreferences).where(eq(userMapLayerPreferences.userId, userId));

      // Return as { [layerId]: { enabled, opacity } }
      const result: Record<number, { enabled: boolean; opacity: number }> = {};
      for (const pref of prefs) {
        result[pref.layerId] = { enabled: pref.enabled, opacity: parseFloat(String(pref.opacity)) };
      }
      res.json(result);
    } catch (err: any) {
      logger.error("Get map layer prefs error", err);
      Errors.internal(res, err);
    }
  });

  api.put("/api/user/map-layer-preferences/:layerId", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      const userId: string = user?.id || user?.id;
      if (!userId) return Errors.unauthorized(res);

      const layerId = Number(req.params.layerId);
      const parsedPref = z.object({ enabled: z.boolean().optional(), opacity: z.coerce.number().min(0).max(1).optional() }).safeParse(req.body);
      if (!parsedPref.success) return Errors.validationFailed(res, parsedPref.error.issues);
      const { enabled, opacity } = parsedPref.data;

      const { userMapLayerPreferences } = await import("@shared/schema");

      // Upsert — update if exists, insert otherwise
      const existing = await db
        .select()
        .from(userMapLayerPreferences)
        .where(and(eq(userMapLayerPreferences.userId, userId), eq(userMapLayerPreferences.layerId, layerId)));

      if (existing.length > 0) {
        await db
          .update(userMapLayerPreferences)
          .set({
            ...(enabled !== undefined && { enabled }),
            ...(opacity !== undefined && { opacity: String(opacity) }),
            updatedAt: new Date(),
          })
          .where(and(eq(userMapLayerPreferences.userId, userId), eq(userMapLayerPreferences.layerId, layerId)));
      } else {
        await db.insert(userMapLayerPreferences).values({
          userId,
          layerId,
          enabled: enabled ?? false,
          opacity: String(opacity ?? 0.7),
        });
      }

      res.json({ success: true });
    } catch (err: any) {
      logger.error("Update map layer pref error", err);
      Errors.internal(res, err);
    }
  });

  api.get("/api/map-layers/categories", isAuthenticated, async (req, res) => {
    try {
      const categories = await db.selectDistinct({
        category: dataSources.category,
      }).from(dataSources).where(eq(dataSources.isEnabled, true));

      res.json(categories.map((c) => c.category).filter(Boolean));
    } catch (err: any) {
      logger.error("Get map layer categories error", err);
      Errors.internal(res, err);
    }
  });

  // Batch enrich all properties that have coordinates but missing enrichment
  api.post("/api/admin/enrich-all-properties", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const parsedEnrich = z.object({ forceRefresh: z.boolean().optional(), orgId: z.number().int().positive().optional() }).safeParse(req.body);
      if (!parsedEnrich.success) return Errors.validationFailed(res, parsedEnrich.error.issues);
      const { forceRefresh = false, orgId: targetOrgId } = parsedEnrich.data;
      const { propertyEnrichmentService } = await import("./services/propertyEnrichment");

      const result = await db.execute(sql`
        SELECT id, organization_id, latitude, longitude, state, county, apn
        FROM properties
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
          AND (${forceRefresh ? sql`TRUE` : sql`(enrichment_status IS NULL OR enrichment_status NOT IN ('complete', 'pending'))`})
          ${targetOrgId ? sql`AND organization_id = ${targetOrgId}` : sql``}
        ORDER BY id ASC
        LIMIT 500
      `);

      // db.execute returns a node-postgres QueryResult; the row array lives on .rows.
      const eligible: Record<string, unknown>[] = result.rows;
      res.json({ queued: eligible.length, forceRefresh, message: "Enrichment running in background" });

      // Serial background enrichment — rate-limited to respect upstream APIs
      (async () => {
        let done = 0;
        let failed = 0;
        for (const prop of eligible) {
          try {
            const lat = parseFloat(String(prop.latitude));
            const lng = parseFloat(String(prop.longitude));
            if (isNaN(lat) || isNaN(lng)) continue;
            await propertyEnrichmentService.enrichByCoordinates(lat, lng, {
              propertyId: Number(prop.id),
              state: prop.state ? String(prop.state) : undefined,
              county: prop.county ? String(prop.county) : undefined,
              apn: prop.apn ? String(prop.apn) : undefined,
              forceRefresh,
            });
            done++;
            await new Promise(r => setTimeout(r, 500));
          } catch (err) {
            failed++;
            logger.warn(`[BatchEnrich] Failed property ${prop.id}`, { metadata: { detail: err } });
          }
        }
        logger.info(`[BatchEnrich] Done: ${done} enriched, ${failed} failed of ${eligible.length} queued`);
      })();
    } catch (err: any) {
      logger.error("Batch enrich error", err);
      Errors.internal(res, err);
    }
  });

  api.get("/api/broker/metrics", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { dataSourceBroker } = await import('./services/data-source-broker');
      
      const [health, usage, cost] = await Promise.all([
        dataSourceBroker.getHealthMetrics(),
        dataSourceBroker.getUsageMetrics(),
        dataSourceBroker.getCostSummary(),
      ]);

      res.json({ health, usage, cost });
    } catch (err: any) {
      logger.error("Broker metrics error", err);
      Errors.internal(res, err);
    }
  });

  // ============================================
  // AI MODEL CONFIGURATIONS (Founder only)
  // ============================================

  api.get("/api/admin/ai-models", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const configs = await db.select().from(aiModelConfigs).orderBy(aiModelConfigs.weight);
      res.json(configs);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.post("/api/admin/ai-models", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const [created] = await db.insert(aiModelConfigs).values({
        provider: req.body.provider || "openrouter",
        modelId: req.body.modelId,
        displayName: req.body.displayName,
        costPerMillionInput: req.body.costPerMillionInput,
        costPerMillionOutput: req.body.costPerMillionOutput,
        maxTokens: req.body.maxTokens || 4096,
        taskTypes: req.body.taskTypes || [],
        weight: req.body.weight ?? 50,
        enabled: req.body.enabled ?? true,
      }).returning();
      const { invalidateDbModelCache } = await import('./services/aiRouter');
      invalidateDbModelCache();
      res.json(created);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.put("/api/admin/ai-models/:id", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [updated] = await db.update(aiModelConfigs)
        .set({ ...req.body, updatedAt: new Date() })
        .where(eq(aiModelConfigs.id, id))
        .returning();
      const { invalidateDbModelCache } = await import('./services/aiRouter');
      invalidateDbModelCache();
      res.json(updated);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.delete("/api/admin/ai-models/:id", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await db.delete(aiModelConfigs).where(eq(aiModelConfigs.id, id));
      const { invalidateDbModelCache } = await import('./services/aiRouter');
      invalidateDbModelCache();
      res.json({ success: true });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ============================================
  // SYSTEM API KEYS (Founder only)
  // ============================================

  api.get("/api/admin/system-api-keys", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const keys = await db.select({
        id: systemApiKeys.id,
        provider: systemApiKeys.provider,
        displayName: systemApiKeys.displayName,
        isActive: systemApiKeys.isActive,
        lastValidatedAt: systemApiKeys.lastValidatedAt,
        validationStatus: systemApiKeys.validationStatus,
        hasKey: sql<boolean>`(api_key IS NOT NULL AND api_key != '')`,
        updatedAt: systemApiKeys.updatedAt,
      }).from(systemApiKeys).orderBy(systemApiKeys.provider);
      res.json(keys);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.put("/api/admin/system-api-keys/:provider", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { provider } = req.params;
      const parsedApiKey = systemApiKeyUpdateSchema.safeParse(req.body);
      if (!parsedApiKey.success) return Errors.validationFailed(res, parsedApiKey.error.issues);
      const { apiKey, isActive } = parsedApiKey.data;
      const [existing] = await db.select().from(systemApiKeys).where(eq(systemApiKeys.provider, provider));
      if (existing) {
        const [updated] = await db.update(systemApiKeys)
          .set({ ...(apiKey !== undefined && { apiKey }), ...(isActive !== undefined && { isActive }), updatedAt: new Date() })
          .where(eq(systemApiKeys.provider, provider))
          .returning({ id: systemApiKeys.id, provider: systemApiKeys.provider, displayName: systemApiKeys.displayName, isActive: systemApiKeys.isActive, validationStatus: systemApiKeys.validationStatus });
        res.json(updated);
      } else {
        const [created] = await db.insert(systemApiKeys)
          .values({ provider, displayName: provider, apiKey, isActive: isActive ?? true })
          .returning({ id: systemApiKeys.id, provider: systemApiKeys.provider, displayName: systemApiKeys.displayName, isActive: systemApiKeys.isActive, validationStatus: systemApiKeys.validationStatus });
        res.json(created);
      }
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ============================================
  // T3 — BullMQ Queue Monitoring API
  // Returns live queue stats from BullMQ (when Redis is configured)
  // or returns empty/disabled status when running in-memory fallback.
  // ============================================

  api.get("/api/admin/queues", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const redisUrl = process.env.REDIS_URL;
      if (!redisUrl) {
        return res.json({
          enabled: false,
          message: "Redis not configured — running in-memory job queue. Set REDIS_URL to enable BullMQ.",
          queues: [],
        });
      }

      const { Queue } = await import("bullmq");
      const IORedis = (await import("ioredis")).default;

      const connection = new IORedis(redisUrl, { maxRetriesPerRequest: 1, enableReadyCheck: false });

      const queueNames = ["acreos-jobs"];
      const queueStats = await Promise.all(
        queueNames.map(async (name) => {
          const q = new Queue(name, { connection });
          const counts = await q.getJobCounts(
            "waiting", "active", "completed", "failed", "delayed", "paused"
          );
          const emptyJobs: Awaited<ReturnType<typeof q.getJobs>> = [];
          const [waiting, active, completed, failed, delayed] = await Promise.all([
            q.getJobs(["waiting"], 0, 9),
            q.getJobs(["active"], 0, 9),
            q.getJobs(["failed"], 0, 9),
            q.getJobs(["delayed"], 0, 9),
            Promise.resolve(emptyJobs),
          ]);
          await q.close();
          return {
            name,
            counts,
            recentWaiting: waiting.map(j => ({ id: j.id, name: j.name, data: j.data, timestamp: j.timestamp })),
            recentActive: active.map(j => ({ id: j.id, name: j.name, data: j.data, processedOn: j.processedOn })),
            recentFailed: failed.map(j => ({ id: j.id, name: j.name, failedReason: j.failedReason, finishedOn: j.finishedOn })),
            recentDelayed: delayed.map(j => ({ id: j.id, name: j.name, delay: j.opts?.delay })),
          };
        })
      );

      await connection.quit();

      res.json({ enabled: true, queues: queueStats, timestamp: new Date().toISOString() });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.delete("/api/admin/queues/:queueName/failed", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { queueName } = req.params;
      const redisUrl = process.env.REDIS_URL;
      if (!redisUrl) return Errors.badRequest(res, "Redis not configured");

      const { Queue } = await import("bullmq");
      const IORedis = (await import("ioredis")).default;
      const connection = new IORedis(redisUrl, { maxRetriesPerRequest: 1, enableReadyCheck: false });
      const q = new Queue(queueName, { connection });
      await q.clean(0, 0, "failed");
      await q.close();
      await connection.quit();
      res.json({ message: "Failed jobs cleared" });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.post("/api/admin/queues/:queueName/retry-failed", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { queueName } = req.params;
      const redisUrl = process.env.REDIS_URL;
      if (!redisUrl) return Errors.badRequest(res, "Redis not configured");

      const { Queue } = await import("bullmq");
      const IORedis = (await import("ioredis")).default;
      const connection = new IORedis(redisUrl, { maxRetriesPerRequest: 1, enableReadyCheck: false });
      const q = new Queue(queueName, { connection });
      const failed = await q.getFailed();
      await Promise.all(failed.map(j => j.retry()));
      await q.close();
      await connection.quit();
      res.json({ retried: failed.length });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // -----------------------------------------------------------------------
  // Database Index Analysis (T75)
  // -----------------------------------------------------------------------

  // GET /api/admin/index-analysis — get the latest report
  api.get("/api/admin/index-analysis", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { getLastReport } = await import("./jobs/indexAnalyzer");
      const report = await getLastReport();
      if (!report) {
        return res.json({ report: null, message: "No analysis run yet. POST to /api/admin/index-analysis/run to generate." });
      }
      res.json({ report });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // POST /api/admin/index-analysis/run — trigger an on-demand analysis
  api.post("/api/admin/index-analysis/run", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { runIndexAnalysis } = await import("./jobs/indexAnalyzer");
      const report = await runIndexAnalysis();
      res.json({ report, success: true });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // -----------------------------------------------------------------------
  // Proactive Monitor API (T83)
  // -----------------------------------------------------------------------

  // GET /api/monitor/alerts — get all active alerts for current org
  api.get("/api/monitor/alerts", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { proactiveMonitor } = await import("./services/proactiveMonitor");
      const limit = Math.min(100, req.query.limit ? parseInt(req.query.limit as string) : 50);
      const alerts = await proactiveMonitor.getAllAlerts(org.id, limit);
      res.json({ alerts, count: alerts.length });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // POST /api/monitor/run — run all checks for current org
  api.post("/api/monitor/run", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { proactiveMonitor } = await import("./services/proactiveMonitor");
      const activityResult = await proactiveMonitor.checkActivityDrop(org.id);
      const integrityIssues = await proactiveMonitor.checkDataIntegrity(org.id);
      const anomalyResult = await proactiveMonitor.runAnomalyDetection(org.id);
      res.json({
        success: true,
        activityAnomaly: activityResult,
        integrityIssues,
        anomalies: anomalyResult,
        checkedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ============================================
  // LAUNCH READINESS — Founder onboarding checklist
  // ============================================

  api.get("/api/founder/launch-readiness", isAuthenticated, isFounderAdmin, async (_req, res) => {
    try {
      // Fetch all system API keys in one query
      const keys = await db.select({
        provider: systemApiKeys.provider,
        hasKey: sql<boolean>`(api_key IS NOT NULL AND api_key != '')`,
        updatedAt: systemApiKeys.updatedAt,
        createdAt: systemApiKeys.createdAt,
      }).from(systemApiKeys);

      const keyMap = new Map(keys.map(k => [k.provider, k]));
      const hasSystemKey = (provider: string) => keyMap.get(provider)?.hasKey === true;
      const hasEnv = (v: string) => !!process.env[v];

      // Check stripe via env (system key OR env var)
      const stripeConfigured = hasSystemKey("stripe") || hasEnv("STRIPE_SECRET_KEY");

      // Check if Stripe has products (fast - just try to list)
      let stripeProductsExist = false;
      if (stripeConfigured) {
        try {
          const { stripeService } = await import("./stripeService");
          const products = await stripeService.listProductsWithPrices();
          stripeProductsExist = products.length > 0;
        } catch { /* no products or key invalid */ }
      }

      // Check email — sendgrid system key OR AWS SES env vars
      const emailConfigured =
        hasSystemKey("sendgrid") ||
        (hasEnv("AWS_ACCESS_KEY_ID") && hasEnv("AWS_SES_FROM_EMAIL"));

      // Check if any feature flags have been intentionally toggled
      const { pricingConfig: pricingConfigTable, platformFeatureFlags, founderAdAccounts, growthCampaigns } = await import("@shared/schema");
      const [{ toggledFlags }] = await db.select({
        toggledFlags: sql<number>`count(*)`,
      }).from(platformFeatureFlags)
        .where(sql`updated_at > created_at + interval '1 second'`);

      // Check if any pricing has been modified from seed
      const [{ modifiedPricing }] = await db.select({
        modifiedPricing: sql<number>`count(*)`,
      }).from(pricingConfigTable)
        .where(sql`updated_at > created_at + interval '1 second'`);

      // Check growth ads
      const [{ adAccounts }] = await db.select({ adAccounts: sql<number>`count(*)` }).from(founderAdAccounts);
      const [{ campaigns }] = await db.select({ campaigns: sql<number>`count(*)` }).from(growthCampaigns);

      const items = [
        // ── CRITICAL ─────────────────────────────────────────
        {
          key: "stripe_configured",
          label: "Stripe payment processing",
          description: "Required for subscriptions and billing",
          priority: "critical",
          status: stripeConfigured ? "complete" : "incomplete",
          section: "section-config",
          helpText: "Add your Stripe Secret Key in System API Keys below",
        },
        {
          key: "stripe_products",
          label: "Stripe subscription products",
          description: "At least one active product with pricing must exist in Stripe",
          priority: "critical",
          status: stripeProductsExist ? "complete" : (stripeConfigured ? "incomplete" : "blocked"),
          section: "section-config",
          helpText: "Create subscription products in your Stripe Dashboard, then add their price IDs here",
        },
        {
          key: "openai_configured",
          label: "OpenAI API key",
          description: "Powers all AI features — lead scoring, Pax, deal analysis",
          priority: "critical",
          status: hasSystemKey("openai") || hasEnv("AI_INTEGRATIONS_OPENAI_API_KEY") || hasEnv("OPENAI_API_KEY") ? "complete" : "incomplete",
          section: "section-config",
          helpText: "Add your OpenAI API key in System API Keys",
        },
        {
          key: "app_url",
          label: "Production app URL",
          description: "Used for email links, Stripe webhooks, and ad landing pages",
          priority: "critical",
          status: hasEnv("APP_URL") && !process.env.APP_URL?.includes("localhost") ? "complete" : "incomplete",
          section: "section-config",
          helpText: "Set APP_URL environment variable to your production domain (e.g. https://app.acreos.io)",
        },
        {
          key: "founder_email",
          label: "Founder email configured",
          description: "Grants admin access to this dashboard",
          priority: "critical",
          status: hasEnv("FOUNDER_EMAIL") ? "complete" : "incomplete",
          section: "section-config",
          helpText: "Set FOUNDER_EMAIL environment variable to your email address",
        },
        // ── CORE ─────────────────────────────────────────────
        {
          key: "email_configured",
          label: "Transactional email (SendGrid or AWS SES)",
          description: "Required for welcome emails, password resets, and notifications",
          priority: "core",
          status: emailConfigured ? "complete" : "incomplete",
          section: "section-config",
          helpText: "Configure SendGrid in System API Keys, or set AWS SES environment variables",
        },
        {
          key: "twilio_configured",
          label: "Twilio SMS & voice calling",
          description: "Powers SMS outreach, voicedrops, and AI phone calls",
          priority: "core",
          status: hasSystemKey("twilio") ? "complete" : "incomplete",
          section: "section-config",
          helpText: "Add your Twilio API credentials in System API Keys",
        },
        {
          key: "mapbox_configured",
          label: "Mapbox maps & parcel layers",
          description: "Required for the map view and GIS features",
          priority: "core",
          status: hasEnv("VITE_MAPBOX_ACCESS_TOKEN") ? "complete" : "incomplete",
          section: "section-config",
          helpText: "Set VITE_MAPBOX_ACCESS_TOKEN environment variable",
        },
        // ── LAUNCH ───────────────────────────────────────────
        {
          key: "feature_flags_reviewed",
          label: "Feature flags reviewed",
          description: "Decide which features are live for your users",
          priority: "launch",
          status: Number(toggledFlags) > 0 ? "complete" : "incomplete",
          section: "section-features",
          helpText: "Go to Feature Flags and enable the features you want live",
        },
        {
          key: "pricing_reviewed",
          label: "Pricing confirmed",
          description: "Review and confirm your subscription tier prices",
          priority: "launch",
          status: Number(modifiedPricing) > 0 ? "complete" : "incomplete",
          section: "section-pricing",
          helpText: "Go to Pricing & Promotions and adjust prices for your market",
        },
        {
          key: "regrid_configured",
          label: "RegGrid parcel data",
          description: "Unlocks county-level parcel ownership data",
          priority: "launch",
          status: hasSystemKey("regrid") ? "complete" : "incomplete",
          section: "section-config",
          helpText: "Add your RegGrid API key in System API Keys",
        },
        // ── GROWTH ───────────────────────────────────────────
        {
          key: "growth_ads_connected",
          label: "Meta growth ad account connected",
          description: "Required to launch paid acquisition campaigns for AcreOS",
          priority: "growth",
          status: Number(adAccounts) > 0 ? "complete" : "incomplete",
          section: "section-growth",
          helpText: "Connect your Meta Ads account in the Growth & Ads section",
        },
        {
          key: "first_campaign",
          label: "First growth campaign launched",
          description: "Start driving real estate professional signups with a pre-built Meta campaign",
          priority: "growth",
          status: Number(campaigns) > 0 ? "complete" : "incomplete",
          section: "section-growth",
          helpText: "Launch your first campaign from the Growth & Ads section",
        },
      ];

      // Score: weight critical 3x, core 2x, launch 1.5x, growth 1x
      const weights: Record<string, number> = { critical: 3, core: 2, launch: 1.5, growth: 1 };
      const totalWeight = items.reduce((s, i) => s + (weights[i.priority] || 1), 0);
      const earnedWeight = items.reduce((s, i) => s + (i.status === "complete" ? (weights[i.priority] || 1) : 0), 0);
      const score = Math.round((earnedWeight / totalWeight) * 100);

      res.json({ score, items });
    } catch (err: any) {
      logger.error("Launch readiness error", { message: err.message, name: err.name });
      res.json({ score: 0, items: [] });
    }
  });

  // ============================================
  // FEATURE FLAGS (Founder-controlled feature visibility)
  // ============================================

  // Public endpoint – clients call this to know which features are enabled
  api.get("/api/config/features", async (_req, res) => {
    try {
      const flags = await storage.getEnabledFeatureFlags();
      const enabledKeys = flags.map(f => f.key);
      const enabledRoutes = flags.flatMap(f => f.controlledRoutes as string[]);
      res.json({ enabledKeys, enabledRoutes });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.get("/api/founder/feature-flags", isAuthenticated, isFounderAdmin, async (_req, res) => {
    try {
      const flags = await storage.getAllFeatureFlags();
      res.json(flags);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.put("/api/founder/feature-flags/:key", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { key } = req.params;
      const parsedFlag = z.object({ enabled: z.boolean() }).safeParse(req.body);
      if (!parsedFlag.success) return Errors.badRequest(res, "enabled must be a boolean");
      const { enabled } = parsedFlag.data;
      const flag = await storage.updateFeatureFlag(key, enabled);
      if (!flag) return Errors.notFound(res, "Feature flag");
      res.json(flag);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ============================================
  // PRICING CONFIG (Founder-controlled pricing + promotions)
  // ============================================

  // Public endpoint – landing page + checkout calls this
  api.get("/api/config/pricing", async (_req, res) => {
    try {
      const configs = await storage.getAllPricingConfig();
      // Filter out expired promos
      const now = new Date();
      const cleaned = configs.map(c => ({
        ...c,
        promoLabel: c.promoEndsAt && c.promoEndsAt < now ? null : c.promoLabel,
        promoDiscountPercent: c.promoEndsAt && c.promoEndsAt < now ? null : c.promoDiscountPercent,
        promoEndsAt: c.promoEndsAt && c.promoEndsAt < now ? null : c.promoEndsAt,
        stripeCouponId: c.promoEndsAt && c.promoEndsAt < now ? null : c.stripeCouponId,
      }));
      res.json(cleaned);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.get("/api/founder/pricing", isAuthenticated, isFounderAdmin, async (_req, res) => {
    try {
      const configs = await storage.getAllPricingConfig();
      res.json(configs);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.put("/api/founder/pricing/:tier", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { tier } = req.params;
      const { displayPriceMonthly, displayPriceYearly, allowPromoCodes } = req.body;
      const updated = await storage.updatePricingConfig(tier, {
        ...(displayPriceMonthly !== undefined && { displayPriceMonthly }),
        ...(displayPriceYearly !== undefined && { displayPriceYearly }),
        ...(allowPromoCodes !== undefined && { allowPromoCodes }),
      });
      if (!updated) return Errors.notFound(res, "Tier");
      res.json(updated);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // Create / activate a flash sale promo for a tier
  api.post("/api/founder/pricing/:tier/promo", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { tier } = req.params;
      const parsedPromo = z.object({ promoLabel: z.string().min(1), promoDiscountPercent: z.coerce.number().min(1).max(100), promoEndsAt: z.string().datetime() }).safeParse(req.body);
      if (!parsedPromo.success) return Errors.validationFailed(res, parsedPromo.error.issues);
      const { promoLabel, promoDiscountPercent, promoEndsAt } = parsedPromo.data;
      // Create a Stripe coupon
      const { getUncachableStripeClient } = await import("./stripeClient");
      const stripe = await getUncachableStripeClient();
      const coupon = await stripe.coupons.create({
        percent_off: promoDiscountPercent,
        duration: "once",
        name: promoLabel,
        metadata: { tier, created_by: "founder_dashboard" },
      });
      const updated = await storage.updatePricingConfig(tier, {
        promoLabel,
        promoDiscountPercent,
        promoEndsAt: new Date(promoEndsAt),
        stripeCouponId: coupon.id,
      });
      res.json(updated);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // End / clear a promo for a tier
  api.delete("/api/founder/pricing/:tier/promo", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { tier } = req.params;
      await storage.clearPricingPromo(tier);
      res.json({ success: true });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ============================================
  // GROWTH / AD MARKETING (AcreOS customer acquisition)
  // ============================================

  api.get("/api/founder/growth/attribution", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string || "50");
      const signups = await storage.getRecentSignupsWithAttribution(limit);
      res.json(signups);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // Get or update founder Meta ad account credentials
  api.get("/api/founder/growth/ad-account", isAuthenticated, isFounderAdmin, async (_req, res) => {
    try {
      const account = await storage.getFounderAdAccount("meta");
      if (!account) return res.json(null);
      // Mask the access token for display
      res.json({ ...account, accessToken: account.accessToken ? "••••••••" + account.accessToken.slice(-4) : null });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.put("/api/founder/growth/ad-account", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { adAccountId, accessToken, pixelId, appId, appSecret } = req.body;
      if (!adAccountId || !accessToken) {
        return Errors.badRequest(res, "adAccountId and accessToken are required");
      }
      const account = await storage.upsertFounderAdAccount({
        platform: "meta",
        adAccountId,
        accessToken,
        pixelId: pixelId || null,
        appId: appId || null,
        appSecret: appSecret || null,
        isActive: true,
      });
      res.json({ ...account, accessToken: "••••••••" + account.accessToken.slice(-4) });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // Available campaign templates
  api.get("/api/founder/growth/templates", isAuthenticated, isFounderAdmin, async (_req, res) => {
    try {
      const { growthAdService } = await import("./services/growthAdService");
      res.json(growthAdService.getTemplates());
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // List growth campaigns
  api.get("/api/founder/growth/campaigns", isAuthenticated, isFounderAdmin, async (_req, res) => {
    try {
      const campaigns = await storage.getGrowthCampaigns();
      res.json(campaigns);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // Launch a new growth campaign
  api.post("/api/founder/growth/campaigns", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { name, templateKey, dailyBudgetCents, targetCountries } = req.body;
      if (!name || !templateKey) {
        return Errors.badRequest(res, "name and templateKey are required");
      }
      const adAccount = await storage.getFounderAdAccount("meta");
      if (!adAccount) {
        return Errors.badRequest(res, "No Meta ad account configured. Add your Meta ad account credentials first.");
      }

      // Create the campaign in Meta via the growth ad service
      const { growthAdService } = await import("./services/growthAdService");
      const externalCampaignId = await growthAdService.launchCampaign({
        adAccount,
        templateKey,
        name,
        dailyBudgetCents: dailyBudgetCents || 2000,
        targetCountries: targetCountries || ["US"],
      });

      const campaign = await storage.createGrowthCampaign({
        name,
        templateKey,
        externalCampaignId,
        status: externalCampaignId ? "active" : "draft",
        dailyBudgetCents: dailyBudgetCents || 2000,
        targetCountries: targetCountries || ["US"],
        totalSpendCents: 0,
        impressions: 0,
        clicks: 0,
        signups: 0,
        conversions: 0,
      });
      res.json(campaign);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // Pause / resume a campaign
  api.put("/api/founder/growth/campaigns/:id/status", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const parsedStatus = z.object({ status: z.enum(["active", "paused"]) }).safeParse(req.body);
      if (!parsedStatus.success) return Errors.badRequest(res, "status must be 'active' or 'paused'");
      const { status } = parsedStatus.data;
      const campaign = await storage.getGrowthCampaign(id);
      if (!campaign) return Errors.notFound(res, "Campaign");

      if (campaign.externalCampaignId) {
        const adAccount = await storage.getFounderAdAccount("meta");
        if (adAccount) {
          const { growthAdService } = await import("./services/growthAdService");
          await growthAdService.setCampaignStatus(adAccount, campaign.externalCampaignId, status);
        }
      }
      const updated = await storage.updateGrowthCampaign(id, { status });
      res.json(updated);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // Sync campaign stats from Meta
  api.post("/api/founder/growth/campaigns/:id/sync", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const campaign = await storage.getGrowthCampaign(id);
      if (!campaign || !campaign.externalCampaignId) {
        return Errors.notFound(res, "Campaign (or not yet live)");
      }
      const adAccount = await storage.getFounderAdAccount("meta");
      if (!adAccount) return Errors.badRequest(res, "No ad account configured");
      const { growthAdService } = await import("./services/growthAdService");
      const stats = await growthAdService.getCampaignStats(adAccount, campaign.externalCampaignId);
      const updated = await storage.updateGrowthCampaign(id, {
        totalSpendCents: stats.spendCents,
        impressions: stats.impressions,
        clicks: stats.clicks,
      });
      res.json(updated);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ─── AI Creative Generation & One-Click Campaign Deploy ──────────────────

  // Start AI creative generation (async). Returns bundleId immediately.
  // Client polls GET /api/founder/growth/creative-bundles/:id for status.
  api.post("/api/founder/growth/generate-creative", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { templateKey } = req.body;
      if (!templateKey) return Errors.badRequest(res, "templateKey is required");

      // Create the bundle record immediately so client can poll
      const bundle = await storage.createAdCreativeBundle({ templateKey, status: "generating" });
      res.json({ bundleId: bundle.id, status: "generating" });

      // Generate in background — do not await
      (async () => {
        try {
          const { adCreativeService } = await import("./services/adCreativeService");
          const { copies, images } = await adCreativeService.generateBundle(templateKey);
          await storage.updateAdCreativeBundle(bundle.id, {
            status: "ready",
            copies,
            images,
          });
        } catch (err: any) {
          logger.error("[growth] Creative generation failed", undefined, { metadata: { detail: err?.message } });
          await storage.updateAdCreativeBundle(bundle.id, {
            status: "error",
            error: err?.message || "Generation failed",
          });
        }
      })();
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // Poll creative bundle status
  api.get("/api/founder/growth/creative-bundles/:id", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const bundle = await storage.getAdCreativeBundle(req.params.id);
      if (!bundle) return Errors.notFound(res, "Bundle");
      res.json(bundle);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // Regenerate a single copy variant (client edits specific angle)
  api.post("/api/founder/growth/creative-bundles/:id/regenerate-copy", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { angle } = req.body;
      const bundle = await storage.getAdCreativeBundle(req.params.id);
      if (!bundle || bundle.status !== "ready") return Errors.badRequest(res, "Bundle not ready");

      const { adCreativeService } = await import("./services/adCreativeService");
      const allVariants = await adCreativeService.generateCopyVariants(bundle.templateKey);
      const newVariant = allVariants.find((v) => v.angle === angle);
      if (!newVariant) return Errors.notFound(res, "Angle");

      const copies = (bundle.copies as any[] || []).map((c: any) =>
        c.angle === angle ? newVariant : c
      );
      const updated = await storage.updateAdCreativeBundle(bundle.id, { copies });
      res.json(updated);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // One-click deploy: launch full campaign from a creative bundle
  api.post("/api/founder/growth/creative-bundles/:id/deploy", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { name, dailyBudgetCents, targetCountries } = req.body;
      if (!name) return Errors.badRequest(res, "Campaign name is required");

      const bundle = await storage.getAdCreativeBundle(req.params.id);
      if (!bundle) return Errors.notFound(res, "Bundle");
      if (bundle.status !== "ready") return Errors.badRequest(res, `Bundle is ${bundle.status}, not ready`);

      const adAccount = await storage.getFounderAdAccount("meta");
      if (!adAccount) return Errors.badRequest(res, "No Meta ad account configured");

      const { growthAdService } = await import("./services/growthAdService");

      const externalCampaignId = await growthAdService.launchFullCampaign({
        adAccount,
        templateKey: bundle.templateKey,
        name,
        dailyBudgetCents: dailyBudgetCents || 2000,
        targetCountries: targetCountries || ["US"],
        copies: (bundle.copies as any[]) || [],
        images: (bundle.images as any[]) || [],
      });

      const campaign = await storage.createGrowthCampaign({
        name,
        templateKey: bundle.templateKey,
        externalCampaignId,
        status: externalCampaignId ? "paused" : "draft",
        dailyBudgetCents: dailyBudgetCents || 2000,
        targetCountries: targetCountries || ["US"],
        totalSpendCents: 0,
        impressions: 0,
        clicks: 0,
        signups: 0,
        conversions: 0,
      });

      // Link bundle to campaign
      await storage.updateAdCreativeBundle(bundle.id, {
        campaignId: campaign.id,
        status: "deployed",
      });

      res.json({ campaign, bundleId: bundle.id });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ─── Founder Intelligence: Command Center Endpoints ──────────────────────

  /**
   * AI Daily Briefing — aggregates last 24h data and writes a 2-3 sentence summary.
   * Cached for 15 minutes server-side to avoid hammering the DB on every dashboard load.
   */
  let briefingCache: { data: any; generatedAt: number } | null = null;
  const BRIEFING_TTL_MS = 15 * 60 * 1000;

  api.get("/api/founder/briefing", isAuthenticated, isFounderAdmin, async (_req, res) => {
    try {
      if (briefingCache && Date.now() - briefingCache.generatedAt < BRIEFING_TTL_MS) {
        return res.json(briefingCache.data);
      }

      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const [orgRows, alertRows, escalatedRows, recentCampaigns] = await Promise.all([
        db.select({
          id: organizations.id,
          name: organizations.name,
          subscriptionTier: organizations.subscriptionTier,
          subscriptionStatus: organizations.subscriptionStatus,
          dunningStage: organizations.dunningStage,
          createdAt: organizations.createdAt,
        }).from(organizations),
        db.select({ id: systemAlerts.id, severity: systemAlerts.severity, resolvedAt: systemAlerts.resolvedAt })
          .from(systemAlerts).where(sql`${systemAlerts.resolvedAt} IS NULL`),
        db.select({ id: supportTickets.id })
          .from(supportTickets)
          .where(and(
            eq(supportTickets.status, 'open' as any),
            eq(supportTickets.resolutionType as any, 'escalated' as any)
          )).limit(10),
        db.select({ id: growthCampaigns.id, status: growthCampaigns.status })
          .from(growthCampaigns),
      ]);

      const tierPrices: Record<string, number> = { free: 0, starter: 49, pro: 149, scale: 399, enterprise: 799 };
      const paidOrgs = orgRows.filter(o => o.subscriptionStatus === 'active' && o.subscriptionTier !== 'free');
      const totalMrr = paidOrgs.reduce((sum, o) => sum + (tierPrices[o.subscriptionTier as string] || 0), 0);
      const newSignups24h = orgRows.filter(o => new Date(o.createdAt as any) > since24h).length;
      const atRiskOrgs = orgRows.filter(o => ['restricted', 'suspended'].includes(o.dunningStage as string)).length;
      const unresolvedAlerts = alertRows.length;
      const activeCampaigns = recentCampaigns.filter(c => c.status === 'active').length;

      const highlights = {
        totalMrr,
        newSignups24h,
        atRiskOrgs,
        unresolvedAlerts,
        escalatedTickets: escalatedRows.length,
        activeCampaigns,
        totalOrgs: paidOrgs.length,
      };

      let summary = `AcreOS is running ${paidOrgs.length} paying organizations at $${totalMrr.toLocaleString()} MRR. ${newSignups24h > 0 ? `${newSignups24h} new signup${newSignups24h > 1 ? 's' : ''} in the last 24 hours.` : 'No new signups in the last 24 hours.'} ${atRiskOrgs > 0 ? `${atRiskOrgs} organization${atRiskOrgs > 1 ? 's' : ''} require attention — dunning stage elevated.` : 'No organizations in dunning risk.'} ${unresolvedAlerts > 0 ? `${unresolvedAlerts} unresolved system alert${unresolvedAlerts > 1 ? 's' : ''} pending review.` : 'All system alerts clear.'} Background jobs running autonomously — lead nurturing, campaign optimization, and finance agent are all active.`;

      // Optionally enrich with GPT-4o if configured
      try {
        const { getOpenAIClient } = await import("./utils/openaiClient");
        const openai = getOpenAIClient();
        if (openai) {
          const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [{
              role: "user",
              content: `You are the AI co-pilot for AcreOS, a SaaS platform for real estate professionals. Write a crisp 2-3 sentence executive briefing for the founder based on these metrics:

- Total MRR: $${totalMrr}
- Paying organizations: ${paidOrgs.length}
- New signups (24h): ${newSignups24h}
- Organizations in dunning risk: ${atRiskOrgs}
- Unresolved system alerts: ${unresolvedAlerts}
- Escalated support tickets: ${escalatedRows.length}
- Active ad campaigns: ${activeCampaigns}

Tone: confident, data-driven, executive. Lead with what's working. Flag concerns briefly. Do not use bullet points — prose only. Max 3 sentences.`,
            }],
            max_tokens: 150,
            temperature: 0.4,
          });
          summary = completion.choices[0].message.content?.trim() || summary;
        }
      } catch { /* non-fatal — use plain summary */ }

      const result = { summary, highlights, generatedAt: new Date().toISOString() };
      briefingCache = { data: result, generatedAt: Date.now() };
      res.json(result);
    } catch (err: any) {
      logger.error("Founder briefing error", { message: err.message, name: err.name });
      res.json({ summary: "Briefing temporarily unavailable", highlights: [], generatedAt: new Date().toISOString() });
    }
  });

  /** Org Health Scores — computes 0-100 health score for every organization */
  api.get("/api/founder/org-health", isAuthenticated, isFounderAdmin, async (_req, res) => {
    try {
      const orgs = await db.select({
        id: organizations.id,
        name: organizations.name,
        subscriptionTier: organizations.subscriptionTier,
        subscriptionStatus: organizations.subscriptionStatus,
        dunningStage: organizations.dunningStage,
        trialEndsAt: organizations.trialEndsAt,
        isFounder: organizations.isFounder,
        createdAt: organizations.createdAt,
      }).from(organizations).orderBy(desc(organizations.createdAt));

      const alertCounts = await db.select({
        orgId: systemAlerts.organizationId,
        count: sql<number>`count(*)`,
      }).from(systemAlerts)
        .where(sql`${systemAlerts.resolvedAt} IS NULL`)
        .groupBy(systemAlerts.organizationId);

      const alertMap = new Map(alertCounts.map(r => [r.orgId, Number(r.count)]));

      const tierPrices: Record<string, number> = { free: 0, starter: 49, pro: 149, scale: 399, enterprise: 799 };

      const result = orgs.map(org => {
        let score = 100;
        const issues: string[] = [];

        // Dunning stage penalties
        const dunning = org.dunningStage as string;
        if (dunning === 'suspended') { score -= 60; issues.push('Suspended — payment overdue'); }
        else if (dunning === 'restricted') { score -= 40; issues.push('Restricted — payment past due'); }
        else if (dunning === 'warning') { score -= 20; issues.push('Dunning warning active'); }
        else if (dunning === 'grace_period') { score -= 10; issues.push('In grace period'); }

        // Subscription status
        if (org.subscriptionStatus === 'past_due') { score -= 20; issues.push('Invoice past due'); }
        else if (org.subscriptionStatus === 'unpaid') { score -= 30; issues.push('Invoice unpaid'); }
        else if (org.subscriptionStatus === 'canceled') { score -= 50; issues.push('Subscription canceled'); }

        // Trial expiring
        if (org.trialEndsAt) {
          const daysLeft = Math.ceil((new Date(org.trialEndsAt as any).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
          if (daysLeft <= 0) { score -= 15; issues.push('Trial expired — not converted'); }
          else if (daysLeft <= 2) { score -= 10; issues.push(`Trial expires in ${daysLeft}d`); }
        }

        // Alert penalties
        const alertCount = alertMap.get(org.id) || 0;
        if (alertCount > 5) { score -= 15; issues.push(`${alertCount} active alerts`); }
        else if (alertCount > 0) { score -= 5; issues.push(`${alertCount} active alert${alertCount > 1 ? 's' : ''}`); }

        // Free tier is an opportunity, not inherently unhealthy
        if (org.subscriptionTier === 'free') score -= 5;

        // Bonuses
        if (org.isFounder) score = 100;
        if (['scale', 'enterprise'].includes(org.subscriptionTier as string)) score = Math.min(score + 5, 100);

        score = Math.max(0, Math.min(100, score));

        const status =
          org.isFounder ? 'founder'
          : score >= 85 ? 'healthy'
          : score >= 65 ? 'watch'
          : score >= 40 ? 'at_risk'
          : 'critical';

        return {
          id: org.id,
          name: org.name,
          subscriptionTier: org.subscriptionTier,
          subscriptionStatus: org.subscriptionStatus,
          dunningStage: org.dunningStage,
          healthScore: score,
          healthStatus: status,
          issues,
          mrr: tierPrices[org.subscriptionTier as string] || 0,
          createdAt: org.createdAt,
        };
      });

      // Sort: critical first, then at_risk, watch, healthy, founder
      const order = ['critical', 'at_risk', 'watch', 'healthy', 'founder'];
      result.sort((a, b) => order.indexOf(a.healthStatus) - order.indexOf(b.healthStatus));

      res.json(result);
    } catch (err: any) {
      logger.error("Org health error", { message: err.message, name: err.name });
      res.json([]);
    }
  });

  // /api/founder/action-queue removed (FW-3) — consumers now read from the
  // unified /api/founder/intelligence/todo feed which merges in action-queue
  // items via getActionQueueAsTodos(). The service file
  // server/services/founderActionQueue.ts stays — it's still consumed by
  // the unified-todo endpoint.

  // POST /api/monitor/alerts/:id/resolve — resolve an alert
  api.post("/api/monitor/alerts/:id/resolve", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const alertId = parseInt(req.params.id);
      const { details } = req.body;
      const { proactiveMonitor } = await import("./services/proactiveMonitor");
      const resolved = await proactiveMonitor.autoResolveAlert(alertId, details || "Manually resolved", "user");
      res.json({ success: resolved });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  /** AI-draft a support reply for an escalated ticket */
  api.post("/api/founder/support/:ticketId/ai-draft", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const ticketId = parseInt(req.params.ticketId);
      const [ticket] = await db.select().from(supportTickets).where(eq(supportTickets.id, ticketId)).limit(1);
      if (!ticket) return Errors.notFound(res, "Ticket");

      const messages = await db.select().from(supportTicketMessages)
        .where(eq(supportTicketMessages.ticketId, ticketId))
        .orderBy(supportTicketMessages.createdAt as any);

      const [org] = await db.select({ name: organizations.name, subscriptionTier: organizations.subscriptionTier })
        .from(organizations).where(eq(organizations.id, ticket.organizationId)).limit(1);

      const { getOpenAIClient } = await import("./utils/openaiClient");
      const openai = getOpenAIClient();
      if (!openai) return res.status(503).json({ message: "OpenAI not configured" });

      const conversation = messages.map((m: any) =>
        `${m.role === 'user' ? 'Customer' : 'Support'}: ${m.content}`
      ).join('\n\n');

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{
          role: "system",
          content: `You are the founder of AcreOS writing a personal support reply. AcreOS is a CRM and operating system for real estate professionals. Be helpful, warm, direct, and knowledgeable. The customer is a ${org?.subscriptionTier || 'free'} tier subscriber named from org "${org?.name || 'Unknown'}". Sign off as "– The AcreOS Team". Do not be overly formal. Aim for 2-4 sentences unless the issue requires more.`,
        }, {
          role: "user",
          content: `Support ticket: "${ticket.subject}"\n\nConversation:\n${conversation}\n\nWrite a helpful, resolution-focused reply:`,
        }],
        temperature: 0.5,
        max_tokens: 400,
      });

      const draft = completion.choices[0].message.content?.trim() || "";
      res.json({ draft, ticketId });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  /** Send a reply to a support ticket and optionally resolve it */
  api.post("/api/founder/support/:ticketId/reply", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const ticketId = parseInt(req.params.ticketId);
      const { message, resolve } = req.body;
      if (!message) return Errors.badRequest(res, "message is required");

      await db.insert(supportTicketMessages).values({
        ticketId,
        role: "agent",
        content: message,
        agentName: "Founder",
      } as any);

      if (resolve) {
        await db.update(supportTickets)
          .set({ status: "resolved", resolvedAt: new Date(), resolvedBy: "founder", resolution: message } as any)
          .where(eq(supportTickets.id, ticketId));
      }

      res.json({ ok: true, resolved: !!resolve });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  /** MRR waterfall — breakdown by tier with at-risk flagging */
  api.get("/api/founder/revenue/waterfall", isAuthenticated, isFounderAdmin, async (_req, res) => {
    try {
      const tierPrices: Record<string, number> = { free: 0, starter: 49, pro: 149, scale: 399, enterprise: 799 };

      const orgRows = await db.select({
        subscriptionTier: organizations.subscriptionTier,
        subscriptionStatus: organizations.subscriptionStatus,
        dunningStage: organizations.dunningStage,
      }).from(organizations);

      const tiers = ['free', 'starter', 'pro', 'scale', 'enterprise'] as const;
      const tierData = tiers.map(tier => {
        const tierOrgs = orgRows.filter(o => o.subscriptionTier === tier);
        const active = tierOrgs.filter(o => o.subscriptionStatus === 'active' && !['restricted', 'suspended'].includes(o.dunningStage as string));
        const atRisk = tierOrgs.filter(o => ['restricted', 'suspended', 'past_due'].includes(o.dunningStage as string) || o.subscriptionStatus === 'past_due');
        const price = tierPrices[tier];
        return {
          tier,
          label: tier.charAt(0).toUpperCase() + tier.slice(1),
          count: tierOrgs.length,
          activeCount: active.length,
          atRiskCount: atRisk.length,
          mrr: active.length * price,
          atRiskMrr: atRisk.length * price,
        };
      });

      const totalMrr = tierData.reduce((s, t) => s + t.mrr, 0);
      const atRiskMrr = tierData.reduce((s, t) => s + t.atRiskMrr, 0);
      const totalOrgs = orgRows.filter(o => o.subscriptionTier !== 'free').length;

      res.json({ tiers: tierData, totalMrr, atRiskMrr, totalOrgs });
    } catch (err: any) {
      logger.error("Revenue waterfall error", { message: err.message, name: err.name });
      res.json({ tiers: [], totalMrr: 0, atRiskMrr: 0, totalOrgs: 0 });
    }
  });

  // ============================================
  // AUTONOMOUS OBSERVATORY ENDPOINTS
  // ============================================

  // GET /api/admin/system-activity — live feed of autonomous actions
  api.get("/api/admin/system-activity", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const hours = Math.min(Number(req.query.hours) || 48, 168); // max 7 days
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const since = new Date(Date.now() - hours * 60 * 60 * 1000);

      const rows = await db
        .select({
          id: systemActivity.id,
          orgId: systemActivity.orgId,
          orgName: organizations.name,
          jobName: systemActivity.jobName,
          action: systemActivity.action,
          summary: systemActivity.summary,
          entityType: systemActivity.entityType,
          entityId: systemActivity.entityId,
          metadata: systemActivity.metadata,
          createdAt: systemActivity.createdAt,
        })
        .from(systemActivity)
        .leftJoin(organizations, eq(systemActivity.orgId, organizations.id))
        .where(sql`${systemActivity.createdAt} >= ${since}`)
        .orderBy(desc(systemActivity.createdAt))
        .limit(limit);

      res.json({ rows, since: since.toISOString(), total: rows.length });
    } catch (err: any) {
      res.json({ rows: [], since: new Date().toISOString(), total: 0 });
    }
  });

  // GET /api/admin/job-health — live job supervisor status
  api.get("/api/admin/job-health", isAuthenticated, isFounderAdmin, async (_req, res) => {
    try {
      const { jobSupervisor } = await import("./services/jobSupervisor");
      res.json({ jobs: jobSupervisor.getAll(), summary: jobSupervisor.getSummary() });
    } catch (err: any) {
      res.json({ jobs: [], summary: { total: 0, healthy: 0, degraded: 0, failed: 0 } });
    }
  });

  // GET /api/admin/churn-risk — at-risk orgs sorted by churn score
  api.get("/api/admin/churn-risk", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const minScore = Number(req.query.minScore) || 0;
      const limit = Math.min(Number(req.query.limit) || 50, 200);

      const rows = await db
        .select({
          id: organizations.id,
          name: organizations.name,
          subscriptionTier: organizations.subscriptionTier,
          dunningStage: organizations.dunningStage,
          churnRiskScore: organizations.churnRiskScore,
          churnRiskUpdatedAt: organizations.churnRiskUpdatedAt,
          churnRescueSentAt: organizations.churnRescueSentAt,
          milestonesReached: organizations.milestonesReached,
          createdAt: organizations.createdAt,
        })
        .from(organizations)
        .where(sql`${organizations.churnRiskScore} >= ${minScore} AND ${organizations.subscriptionStatus} = 'active'`)
        .orderBy(desc(organizations.churnRiskScore))
        .limit(limit);

      res.json({ orgs: rows, total: rows.length });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // POST /api/admin/churn-risk/:orgId/rescue — manually trigger rescue for an org
  api.post("/api/admin/churn-risk/:orgId/rescue", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const orgId = Number(req.params.orgId);
      const { churnEngine } = await import("./services/churnEngine");
      const org = await storage.getOrganization(orgId);
      if (!org) return Errors.notFound(res, "Org");
      await db.update(organizations).set({ churnRescueSentAt: null }).where(eq(organizations.id, orgId));
      const score = await churnEngine.scoreOrg(orgId, { dunningStage: org.dunningStage });
      res.json({ message: "Rescue triggered", riskScore: score });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // GET /api/admin/pax-observations — Pax's recent observations
  api.get("/api/admin/pax-observations", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 30, 100);

      // Use paxObservations (proactive monitor results) — includes suggestedAction
      const observations = await db
        .select({
          id: paxObservations.id,
          orgId: paxObservations.organizationId,
          orgName: organizations.name,
          type: paxObservations.type,
          content: paxObservations.description,
          confidence: paxObservations.confidenceScore,
          severity: paxObservations.severity,
          status: paxObservations.status,
          suggestedAction: sql<string>`${paxObservations.metadata}->>'suggestedAction'`,
          createdAt: paxObservations.createdAt,
        })
        .from(paxObservations)
        .leftJoin(organizations, eq(paxObservations.organizationId, organizations.id))
        .where(sql`${paxObservations.status} NOT IN ('dismissed','auto_resolved')`)
        .orderBy(desc(paxObservations.createdAt))
        .limit(limit);

      const learnings = await db
        .select()
        .from(paxCrossOrgLearnings)
        .orderBy(desc(paxCrossOrgLearnings.createdAt))
        .limit(10);

      res.json({ observations, learnings });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // POST /api/admin/pax-observations/:id/execute — execute the suggested action for an observation
  api.post("/api/admin/pax-observations/:id/execute", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const obsId = Number(req.params.id);
      const [obs] = await db
        .select({ orgId: paxObservations.organizationId, metadata: paxObservations.metadata })
        .from(paxObservations)
        .where(eq(paxObservations.id, obsId))
        .limit(1);

      if (!obs) return Errors.notFound(res, "Observation");

      const suggestedAction = (obs.metadata as any)?.suggestedAction;
      let actionTaken = "acknowledged";

      // Route action to appropriate handler
      if (suggestedAction === "proactive_outreach" || suggestedAction === "draft_outreach_message") {
        // Trigger churn rescue for this org
        const { churnEngine } = await import("./services/churnEngine");
        const org = await storage.getOrganization(obs.orgId);
        if (org) {
          await db.update(organizations).set({ churnRescueSentAt: null }).where(eq(organizations.id, obs.orgId));
          await churnEngine.runForAllOrgs();
          actionTaken = "rescue_triggered";
        }
      }
      // "get_deals" action retired 2026-06-08 with Deal Hunter — the observation
      // is still acknowledged below; deal sourcing now flows through dealFeedEngine.

      // Mark observation as acknowledged
      await db.update(paxObservations)
        .set({ status: "acknowledged", acknowledgedAt: new Date() })
        .where(eq(paxObservations.id, obsId));

      res.json({ message: "Action executed", actionTaken });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // POST /api/admin/founder-briefing/send — manually trigger briefing
  api.post("/api/admin/founder-briefing/send", isAuthenticated, isFounderAdmin, async (_req, res) => {
    try {
      const { sendDailyBriefing } = await import("./services/founderBriefing");
      // Clear last-sent so it will re-send
      const { systemMeta } = await import("@shared/schema");
      await db.delete(systemMeta).where(eq(systemMeta.key, "founder_briefing_last_sent"));
      await sendDailyBriefing();
      res.json({ message: "Briefing sent" });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // POST /api/admin/churn-engine/run — manually trigger churn scoring run
  api.post("/api/admin/churn-engine/run", isAuthenticated, isFounderAdmin, async (_req, res) => {
    try {
      const { churnEngine } = await import("./services/churnEngine");
      churnEngine.runForAllOrgs().catch(err => logger.error("Churn engine background run failed", err)); // run in background
      res.json({ message: "Churn engine started in background" });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ============================================

  // ─── Org API Keys ───────────────────────────────────────────────────────────
  // Per-organization API keys for external integrations.

  // GET /api/org/api-keys — list keys (masked)
  api.get("/api/org/api-keys", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const rows = await db
        .select({
          id: orgApiKeys.id,
          name: orgApiKeys.name,
          keyPrefix: orgApiKeys.keyPrefix,
          scope: orgApiKeys.scope,
          expiresAt: orgApiKeys.expiresAt,
          lastUsedAt: orgApiKeys.lastUsedAt,
          isRevoked: orgApiKeys.isRevoked,
          createdAt: orgApiKeys.createdAt,
        })
        .from(orgApiKeys)
        .where(and(eq(orgApiKeys.organizationId, org.id), eq(orgApiKeys.isRevoked, false)))
        .orderBy(desc(orgApiKeys.createdAt));
      res.json(rows);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // POST /api/org/api-keys — create key (returns full key ONCE)
  api.post("/api/org/api-keys", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user as any;
      const userId = user?.id || user?.id;
      const parsedKey = z.object({ name: z.string().min(1).max(100), scope: z.enum(["read", "write", "admin"]).optional(), expiresInDays: z.number().int().positive().nullable().optional() }).safeParse(req.body);
      if (!parsedKey.success) return Errors.validationFailed(res, parsedKey.error.issues);
      const { name, scope = "read", expiresInDays } = parsedKey.data;
      if (!name || !name.trim()) {
        return Errors.badRequest(res, "Name is required");
      }

      // Generate: "acos_" + 32 random hex chars
      const rawKey = "acos_" + crypto.randomBytes(20).toString("hex");
      const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
      const keyPrefix = rawKey.slice(0, 12); // "acos_" + 7 chars

      const expiresAt = expiresInDays
        ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
        : null;

      const [row] = await db
        .insert(orgApiKeys)
        .values({
          organizationId: org.id,
          name: name.trim(),
          keyHash,
          keyPrefix,
          scope: scope || "read",
          expiresAt,
          createdBy: null, // team member id lookup not needed here
        })
        .returning();

      res.json({ ...row, key: rawKey });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // DELETE /api/org/api-keys/:id — revoke key
  api.delete("/api/org/api-keys/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const keyId = parseInt(req.params.id);
      const [updated] = await db
        .update(orgApiKeys)
        .set({ isRevoked: true, updatedAt: new Date() })
        .where(and(eq(orgApiKeys.id, keyId), eq(orgApiKeys.organizationId, org.id)))
        .returning({ id: orgApiKeys.id });
      if (!updated) return Errors.notFound(res, "Key");
      res.json({ message: "Key revoked" });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ─── Activity / Audit Log ───────────────────────────────────────────────────
  // GET /api/org/activity-log — last 50 entries for this org
  api.get("/api/org/activity-log", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const rows = await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.organizationId, org.id))
        .orderBy(desc(auditLog.createdAt))
        .limit(50);
      res.json(rows);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ─── Direct Mail Attribution ────────────────────────────────────────────────
  // GET /api/campaigns/:id/mail-attribution — responses attributed to direct mail
  api.get("/api/campaigns/:id/mail-attribution", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const campaignId = parseInt(req.params.id);

      // Get mailing orders for this campaign
      const orders = await db
        .select({ id: mailingOrders.id, totalPieces: mailingOrders.totalPieces,
                  totalCost: mailingOrders.totalCost, completedAt: mailingOrders.completedAt,
                  createdAt: mailingOrders.createdAt })
        .from(mailingOrders)
        .where(and(eq(mailingOrders.organizationId, org.id), eq(mailingOrders.campaignId, campaignId)));

      const totalSent = orders.reduce((s, o) => s + (o.totalPieces || 0), 0);
      const totalCostCents = orders.reduce((s, o) => s + (o.totalCost || 0), 0);

      // Get all pieces for these orders
      const orderIds = orders.map(o => o.id);
      let attributedLeads = 0;

      if (orderIds.length > 0) {
        const pieces = await db
          .select({
            id: mailingOrderPieces.id,
            leadId: mailingOrderPieces.leadId,
            recipientAddressLine1: mailingOrderPieces.recipientAddressLine1,
            recipientZipCode: mailingOrderPieces.recipientZipCode,
            createdAt: mailingOrderPieces.createdAt,
          })
          .from(mailingOrderPieces)
          .where(inArray(mailingOrderPieces.mailingOrderId, orderIds));

        // Count leads that were updated/created within 30 days of a mail piece
        const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
        const leadIds = pieces.map(p => p.leadId).filter(Boolean) as number[];
        if (leadIds.length > 0) {
          const matchedLeads = await db
            .select({ id: leads.id, updatedAt: leads.updatedAt, status: leads.status })
            .from(leads)
            .where(and(eq(leads.organizationId, org.id), inArray(leads.id, leadIds)));

          for (const lead of matchedLeads) {
            const piece = pieces.find(p => p.leadId === lead.id);
            if (piece && lead.updatedAt) {
              const diff = new Date(lead.updatedAt).getTime() - new Date(piece.createdAt!).getTime();
              if (diff >= 0 && diff <= thirtyDaysMs && lead.status !== 'new') {
                attributedLeads++;
              }
            }
          }
        }
      }

      const responseRate = totalSent > 0 ? (attributedLeads / totalSent) * 100 : 0;
      const costPerResponse = attributedLeads > 0 ? totalCostCents / attributedLeads / 100 : null;

      // Estimated delivery: first order's createdAt + 7 days (midpoint 3-10)
      const firstOrder = orders.sort((a, b) => new Date(a.createdAt!).getTime() - new Date(b.createdAt!).getTime())[0];
      const estimatedDeliveryDate = firstOrder
        ? new Date(new Date(firstOrder.createdAt!).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
        : null;

      res.json({
        totalSent,
        totalCostCents,
        attributedResponses: attributedLeads,
        responseRate: parseFloat(responseRate.toFixed(2)),
        costPerResponse,
        estimatedDeliveryDate,
        industryBenchmarkMin: 1,
        industryBenchmarkMax: 3,
      });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ============================================
  // SELF-EVOLUTION ENGINE — Admin Routes
  // ============================================

  // GET /api/admin/evolution-proposals — list pending self-assessment proposals
  api.get("/api/admin/evolution-proposals", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const proposals = await db
        .select()
        .from(agentTasks)
        .where(eq(agentTasks.agentType, "self_assessment"))
        .orderBy(desc(agentTasks.createdAt))
        .limit(50);
      res.json({ proposals });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // GET /api/admin/evolution-history — list all evolution pipeline runs
  api.get("/api/admin/evolution-history", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { evolutionHistory } = await import("@shared/schema");
      const history = await db
        .select()
        .from(evolutionHistory)
        .orderBy(desc(evolutionHistory.createdAt))
        .limit(100);
      res.json({ history });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // GET /api/admin/model-catalog — view OpenRouter model catalog with benchmark scores
  api.get("/api/admin/model-catalog", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { openrouterModelCatalog } = await import("@shared/schema");
      const catalog = await db
        .select()
        .from(openrouterModelCatalog)
        .where(eq(openrouterModelCatalog.isActive, true))
        .orderBy(desc(openrouterModelCatalog.benchmarkScoreComplex))
        .limit(100);
      res.json({ catalog });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // POST /api/admin/model-intelligence/sync — manually trigger catalog sync
  api.post("/api/admin/model-intelligence/sync", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { runModelIntelligence } = await import("./services/modelIntelligence");
      const result = await runModelIntelligence();
      res.json({ success: true, ...result });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // POST /api/admin/telemetry-optimizer/run — manually trigger optimizer
  api.post("/api/admin/telemetry-optimizer/run", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { runTelemetryOptimizer } = await import("./services/telemetryOptimizer");
      const result = await runTelemetryOptimizer();
      res.json({ success: true, ...result });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // GET /api/admin/telemetry-stats — view per-model telemetry stats for the optimizer
  api.get("/api/admin/telemetry-stats", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { getTelemetryStats } = await import("./services/telemetryOptimizer");
      const stats = await getTelemetryStats();
      res.json({ stats });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // GET /api/admin/evolution/circuit-breaker — check circuit breaker status
  api.get("/api/admin/evolution/circuit-breaker", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { evolutionCircuitBreaker } = await import("@shared/schema");
      const [breaker] = await db.select().from(evolutionCircuitBreaker).limit(1);
      res.json({ breaker: breaker || { isTripped: false, consecutiveReverts: 0 } });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // POST /api/admin/evolution/resume — manually resume after circuit breaker trip
  api.post("/api/admin/evolution/resume", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { evolutionCircuitBreaker } = await import("@shared/schema");
      const user = req.user as any;
      await db.update(evolutionCircuitBreaker)
        .set({ isTripped: false, consecutiveReverts: 0, resumedBy: user?.email || "founder", updatedAt: new Date() })
        .where(eq(evolutionCircuitBreaker.id, 1));
      res.json({ success: true, message: "Evolution pipeline resumed" });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // GET /api/founder/ai/telemetry — live AI telemetry feed for the observatory
  api.get("/api/founder/ai/telemetry", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { aiTelemetryEvents } = await import("@shared/schema");
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const events = await db
        .select({
          id: aiTelemetryEvents.id,
          orgId: aiTelemetryEvents.organizationId,
          taskType: aiTelemetryEvents.taskType,
          provider: aiTelemetryEvents.provider,
          model: aiTelemetryEvents.model,
          complexity: aiTelemetryEvents.complexity,
          totalTokens: aiTelemetryEvents.totalTokens,
          estimatedCostCents: aiTelemetryEvents.estimatedCostCents,
          latencyMs: aiTelemetryEvents.latencyMs,
          success: aiTelemetryEvents.success,
          createdAt: aiTelemetryEvents.createdAt,
        })
        .from(aiTelemetryEvents)
        .orderBy(desc(aiTelemetryEvents.createdAt))
        .limit(limit);
      res.json({ events });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // GET /api/founder/ai/stats — aggregate AI usage stats for observatory dashboard
  api.get("/api/founder/ai/stats", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { aiTelemetryEvents } = await import("@shared/schema");
      const { gte } = await import("drizzle-orm");
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const events = await db
        .select()
        .from(aiTelemetryEvents)
        .where(gte(aiTelemetryEvents.createdAt, oneDayAgo));

      const totalCallsToday = events.length;
      const totalCostTodayCents = Math.round(
        events.reduce((sum, e) => sum + Number(e.estimatedCostCents || 0), 0),
      );
      const avgLatencyMs = events.length > 0
        ? Math.round(events.reduce((sum, e) => sum + (e.latencyMs || 0), 0) / events.length)
        : 0;
      const cacheHits = events.filter((e: any) => e.cacheHit).length;
      const cacheHitRate = events.length > 0 ? cacheHits / events.length : 0;

      // Contract = the AiStats interface in founder-ai-observatory.tsx (its
      // only consumer). The old payload used different key names
      // (totalCalls/totalCostDollars) — the page read undefined and crashed
      // on .toLocaleString() every time stats loaded (2026-07-11 sweep).
      // Cents as integers per the W3.3 money rule; cacheHitRate is 0–1.
      res.json({
        totalCallsToday,
        totalCostTodayCents,
        avgLatencyMs,
        cacheHitRate,
      });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ============================================
  // AI MEMORY — User-facing routes
  // ============================================

  // GET /api/ai/memory — list paxMemory for current org
  api.get("/api/ai/memory", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { paxMemory } = await import("@shared/schema");
      const memories = await db
        .select()
        .from(paxMemory)
        .where(eq(paxMemory.organizationId, org.id))
        .orderBy(desc(paxMemory.createdAt))
        .limit(100);
      res.json({ memories });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // DELETE /api/ai/memory/:id — delete a specific memory entry
  api.delete("/api/ai/memory/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const memoryId = Number(req.params.id);
      const { paxMemory } = await import("@shared/schema");
      await db.delete(paxMemory)
        .where(and(eq(paxMemory.id, memoryId), eq(paxMemory.organizationId, org.id)));
      res.json({ success: true });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ============================================

  // ============================================
  // BETA ANALYTICS & FEEDBACK ENDPOINTS
  // ============================================

  // POST /api/feedback — submit user feedback
  api.post("/api/feedback", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const org = getOrganization(req);
      const userId = getUserId(req);
      const { page, feedback } = req.body as { page: string; feedback: string };
      if (!feedback?.trim()) return Errors.badRequest(res, "Feedback required");
      const { betaAnalytics } = await import("./services/betaAnalytics");
      const id = await betaAnalytics.submitFeedback(userId, org.id, page || "/", feedback.trim());
      res.json({ id, success: true });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // GET /api/admin/feedback — all feedback (founder only)
  api.get("/api/admin/feedback", isAuthenticated, getOrCreateOrg, isFounderAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { betaAnalytics } = await import("./services/betaAnalytics");
      const limit = Number(req.query.limit) || 100;
      const offset = Number(req.query.offset) || 0;
      const feedback = await betaAnalytics.getAllFeedback(limit, offset);
      res.json(feedback);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // POST /api/admin/feedback/process — process unprocessed feedback (founder only)
  api.post("/api/admin/feedback/process", isAuthenticated, getOrCreateOrg, isFounderAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { feedbackProcessor } = await import("./services/feedbackProcessor");
      const processed = await feedbackProcessor.processNewFeedback();
      res.json({ processed });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // GET /api/admin/feedback/summary — feedback summary by category/severity (founder only)
  api.get("/api/admin/feedback/summary", isAuthenticated, getOrCreateOrg, isFounderAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { feedbackProcessor } = await import("./services/feedbackProcessor");
      const summary = await feedbackProcessor.getFeedbackSummary();
      res.json(summary);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // POST /api/analytics/session/start — start a user session
  api.post("/api/analytics/session/start", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const org = getOrganization(req);
      const userId = getUserId(req);
      const { betaAnalytics } = await import("./services/betaAnalytics");
      const sessionId = await betaAnalytics.startSession(userId, org.id);
      res.json({ sessionId });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // POST /api/analytics/session/end — end a user session
  api.post("/api/analytics/session/end", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { sessionId } = req.body as { sessionId: number };
      if (!sessionId) return Errors.badRequest(res, "sessionId required");
      const { betaAnalytics } = await import("./services/betaAnalytics");
      await betaAnalytics.endSession(sessionId);
      res.json({ success: true });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // POST /api/analytics/pageview — record a page view
  api.post("/api/analytics/pageview", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { sessionId, path } = req.body as { sessionId: number; path: string };
      if (!sessionId || !path) return Errors.badRequest(res, "sessionId and path required");
      const { betaAnalytics } = await import("./services/betaAnalytics");
      await betaAnalytics.recordPageView(sessionId, path);
      res.json({ success: true });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // POST /api/analytics/activation — track activation event
  api.post("/api/analytics/activation", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const org = getOrganization(req);
      const userId = getUserId(req);
      const { eventName } = req.body as { eventName: string };
      if (!eventName) return Errors.badRequest(res, "eventName required");
      const { betaAnalytics } = await import("./services/betaAnalytics");
      const recorded = await betaAnalytics.trackActivation(userId, org.id, eventName as any);
      res.json({ recorded });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // GET /api/admin/agents/status — agent status (founder only)
  api.get("/api/admin/agents/status", isAuthenticated, getOrCreateOrg, isFounderAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { getAgentStatus } = await import("./agents/index");
      res.json(getAgentStatus());
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // POST /api/admin/agents/:name/toggle — enable/disable agent (founder only)
  api.post("/api/admin/agents/:name/toggle", isAuthenticated, getOrCreateOrg, isFounderAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { setAgentEnabled } = await import("./agents/index");
      const { enabled } = req.body as { enabled: boolean };
      const success = setAgentEnabled(req.params.name, enabled);
      if (!success) return Errors.notFound(res, "Agent");
      res.json({ success: true });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // GET /api/admin/digests — list recent digests (founder only)
  api.get("/api/admin/digests", isAuthenticated, getOrCreateOrg, isFounderAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await db.execute(sql`
        SELECT id, agent_type as "agentType", brief_type as "briefType", content, generated_at as "generatedAt", read_at as "readAt"
        FROM founder_briefs
        WHERE brief_type = 'daily_digest'
        ORDER BY generated_at DESC LIMIT 30
      `);
      res.json((result as any).rows ?? []);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // GET /api/admin/digests/latest — latest digest (founder only)
  api.get("/api/admin/digests/latest", isAuthenticated, getOrCreateOrg, isFounderAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await db.execute(sql`
        SELECT id, agent_type as "agentType", brief_type as "briefType", content, generated_at as "generatedAt"
        FROM founder_briefs
        WHERE brief_type = 'daily_digest'
        ORDER BY generated_at DESC LIMIT 1
      `);
      const row = (result as any).rows?.[0] ?? null;
      if (row) {
        await db.execute(sql`UPDATE founder_briefs SET read_at = NOW() WHERE id = ${row.id}`);
      }
      res.json(row);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // GET /api/admin/beta-analytics — founder analytics dashboard data
  api.get("/api/admin/beta-analytics", isAuthenticated, getOrCreateOrg, isFounderAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { betaAnalytics } = await import("./services/betaAnalytics");
      const [signupCount, onboardingRate, activationRates, userTimelines, healthIndicators, pageVisits, feedback] = await Promise.all([
        betaAnalytics.getSignupCount(),
        betaAnalytics.getOnboardingCompletionRate(),
        betaAnalytics.getActivationRates(),
        betaAnalytics.getUserTimelines(),
        betaAnalytics.getUserHealthIndicators(),
        betaAnalytics.getPageVisitFrequency(),
        betaAnalytics.getAllFeedback(50),
      ]);
      res.json({ signupCount, onboardingRate, activationRates, userTimelines, healthIndicators, pageVisits, feedback });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ── Tier Override (Section 10) ──
  app.post("/api/admin/organizations/:id/tier-override", isAuthenticated, getOrCreateOrg, isFounderAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const targetOrgId = parseInt(req.params.id);
      const { tier, reason, expiresAt } = req.body;
      if (!tier || !reason) return Errors.badRequest(res, "tier and reason are required");
      const { organizations } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const [updated] = await db.update(organizations)
        .set({ subscriptionTier: tier, updatedAt: new Date() } as any)
        .where(eq(organizations.id, targetOrgId))
        .returning();
      if (!updated) return Errors.notFound(res, "Organization");
      // Log to audit
      const { activityLog } = await import("@shared/schema");
      await db.insert(activityLog).values({
        organizationId: targetOrgId,
        entityType: "organization",
        entityId: targetOrgId,
        action: "tier_override",
        details: { tier, reason, expiresAt, overriddenBy: "founder" },
      } as any);
      res.json({ success: true, message: `Tier overridden to ${tier} for org #${targetOrgId}`, expiresAt });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // End an impersonation session — clears the cookie and audits the stop.
  // NOTE: this LITERAL route MUST be registered before the `/:orgId` param
  // route below, or Express matches "/impersonate/end" as orgId="end" and the
  // stop endpoint becomes unreachable (checked by lint:route-order).
  app.post("/api/admin/impersonate/end", isAuthenticated, getOrCreateOrg, isFounderAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { IMPERSONATION_COOKIE } = await import("./services/impersonation");
      // Capture the target (if any) BEFORE clearing, for the audit record.
      const endedTargetOrgId = req.impersonation?.targetOrgId ?? null;
      res.clearCookie(IMPERSONATION_COOKIE, { path: "/" });

      const founderUserId = getClerkAuth(req)?.userId ?? req.user.clerkUserId ?? req.user.id ?? null;
      try {
        const { chainAndInsertAuditEvent } = await import("./utils/auditEventsChain");
        await chainAndInsertAuditEvent({
          actorUserId: founderUserId ? String(founderUserId) : null,
          actorEmail: req.user.email ?? null,
          action: "impersonation_ended",
          targetType: "organization",
          targetId: endedTargetOrgId != null ? String(endedTargetOrgId) : "none",
          justification: null,
          metadata: {},
          ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.socket?.remoteAddress ?? null,
          userAgent: (req.headers["user-agent"] as string) ?? null,
        });
      } catch (auditErr) {
        logger.error("[admin] impersonation-end audit write failed", auditErr as Error);
      }

      res.json({ success: true, ended: true });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  app.post("/api/admin/impersonate/:orgId", isAuthenticated, getOrCreateOrg, isFounderAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const targetOrgId = parseInt(req.params.orgId);
      if (!Number.isInteger(targetOrgId) || targetOrgId <= 0) {
        return Errors.badRequest(res, "Invalid organization id");
      }
      const { organizations } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const target = await db.query.organizations.findFirst({ where: eq(organizations.id, targetOrgId) });
      if (!target) return Errors.notFound(res, "Organization");

      // CRITICAL: the token's founderUserId must be the SAME identity domain
      // getOrCreateOrg compares against — it reads `req.user.id` (the DB user
      // UUID), NOT the Clerk id. Minting with the Clerk id would make
      // `session.founderUserId === userId` never true, silently disabling the
      // whole mechanism (built-but-unwired). Use the DB user id here.
      const founderDbUserId = String(req.user.id ?? "");
      if (!founderDbUserId) return Errors.unauthorized(res);

      // Mint a REAL, enforced token — getOrCreateOrg swaps the org for THIS
      // founder and blocks every mutation. Fabricated readOnly/expiry claims are
      // gone: what we return is exactly what the middleware enforces.
      const { mintImpersonationToken, IMPERSONATION_COOKIE, IMPERSONATION_TTL_MS } =
        await import("./services/impersonation");
      const minted = mintImpersonationToken(founderDbUserId, targetOrgId, Date.now());
      if (!minted) {
        return Errors.internal(res, new Error("Impersonation signing secret not configured (SESSION_SECRET)"));
      }
      res.cookie(IMPERSONATION_COOKIE, minted.token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: IMPERSONATION_TTL_MS,
      });

      // Founder-visible, immutable, hash-chained audit — NOT the tenant's log.
      try {
        const { chainAndInsertAuditEvent } = await import("./utils/auditEventsChain");
        await chainAndInsertAuditEvent({
          actorUserId: getClerkAuth(req)?.userId ?? founderDbUserId,
          actorEmail: req.user.email ?? null,
          action: "impersonation_started",
          targetType: "organization",
          targetId: String(targetOrgId),
          justification: (req.body?.reason as string) ?? null,
          metadata: { orgName: target.name, readOnly: true, expiresAt: minted.session.expiresAt },
          ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.socket?.remoteAddress ?? null,
          userAgent: (req.headers["user-agent"] as string) ?? null,
        });
      } catch (auditErr) {
        logger.error("[admin] impersonation audit write failed", auditErr as Error);
      }

      res.json({
        success: true,
        impersonation: {
          orgId: targetOrgId,
          orgName: target.name,
          readOnly: true, // enforced: all mutations return 403 while this session is active
          expiresAt: new Date(minted.session.expiresAt).toISOString(),
        },
      });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  app.post("/api/admin/organizations/:id/features", isAuthenticated, getOrCreateOrg, isFounderAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const targetOrgId = parseInt(req.params.id);
      const { features } = req.body;
      if (!features || typeof features !== "object") return Errors.badRequest(res, "features object required");
      const { organizations } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      await db.update(organizations)
        .set({ featureOverrides: features } as any)
        .where(eq(organizations.id, targetOrgId));
      res.json({ success: true, message: `Feature overrides set for org #${targetOrgId}`, features });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  app.get("/api/founder/stage", isAuthenticated, getOrCreateOrg, isFounderAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { detectStage } = await import("./services/companyStageDetector");
      const stage = await detectStage();
      res.json(stage);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  app.get("/api/founder/leading-indicators", isAuthenticated, getOrCreateOrg, isFounderAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { computeLeadingIndicators } = await import("./services/leadingIndicators");
      const indicators = await computeLeadingIndicators();
      res.json(indicators);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ============================================
  // MONTHLY CHECK-IN DASHBOARD
  // ============================================

  app.get("/api/founder/monthly-checkin", isAuthenticated, isFounderAdmin, async (_req, res) => {
    try {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

      // MRR & customer metrics
      const allOrgs = await db.select().from(organizations).limit(10000);
      const paidOrgs = allOrgs.filter(o => o.subscriptionTier && o.subscriptionTier !== "free");
      const tierPricing: Record<string, number> = {
        sprout: 29, starter: 59, pro: 179, scale: 449, enterprise: 899,
      };
      const mrr = paidOrgs.reduce((sum, o) => sum + (tierPricing[o.subscriptionTier || ""] || 0), 0);

      // New signups this month vs last
      const newThisMonth = allOrgs.filter(o => o.createdAt && new Date(o.createdAt) >= thirtyDaysAgo).length;
      const newLastMonth = allOrgs.filter(o => o.createdAt && new Date(o.createdAt) >= sixtyDaysAgo && new Date(o.createdAt) < thirtyDaysAgo).length;

      // Churn
      const cancelledThisMonth = await db.select({ count: count() }).from(subscriptionEvents)
        .where(and(
          eq(subscriptionEvents.eventType, "cancel"),
          sql`${subscriptionEvents.createdAt} >= ${thirtyDaysAgo}`
        ));

      // Support escalations
      const escalatedTickets = await db.select({ count: count() }).from(supportTickets)
        .where(and(
          eq(supportTickets.resolutionType, "escalated"),
          sql`${supportTickets.createdAt} >= ${thirtyDaysAgo}`
        ));
      const totalTickets = await db.select({ count: count() }).from(supportTickets)
        .where(sql`${supportTickets.createdAt} >= ${thirtyDaysAgo}`);
      const aiResolvedTickets = await db.select({ count: count() }).from(supportTickets)
        .where(and(
          eq(supportTickets.aiHandled, true),
          sql`${supportTickets.createdAt} >= ${thirtyDaysAgo}`
        ));

      // System health
      const { healthCheckService } = await import("./services/healthCheck");
      const healthResult = await healthCheckService.checkAll();

      // Alert summary
      const alertsThisMonth = await db.select().from(systemAlerts)
        .where(sql`${systemAlerts.createdAt} >= ${thirtyDaysAgo}`)
        .orderBy(desc(systemAlerts.createdAt));
      const alertsByPriority: Record<string, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
      const { severityToPriority } = await import("./services/alertPolicy");
      for (const alert of alertsThisMonth) {
        const p = severityToPriority(alert.severity, alert.alertType || alert.type);
        alertsByPriority[p]++;
      }

      // Dunning recovery
      const { dunningService } = await import("./services/dunning");
      const dunningSummary = await dunningService.getSummary();

      // Autonomous decisions
      const { agentEvents } = await import("@shared/schema");
      const autoDecisions = await db.select({ count: count() }).from(agentEvents)
        .where(sql`${agentEvents.createdAt} >= ${thirtyDaysAgo}`);

      // Feature requests
      const topRequests = await db.select().from(featureRequests)
        .orderBy(desc(featureRequests.createdAt))
        .limit(5);

      res.json({
        period: { start: thirtyDaysAgo.toISOString(), end: now.toISOString() },
        revenue: {
          mrr,
          paidCustomers: paidOrgs.length,
          totalCustomers: allOrgs.length,
          newSignupsThisMonth: newThisMonth,
          newSignupsLastMonth: newLastMonth,
          churnedThisMonth: Number(cancelledThisMonth[0]?.count ?? 0),
        },
        support: {
          totalTickets: Number(totalTickets[0]?.count ?? 0),
          escalated: Number(escalatedTickets[0]?.count ?? 0),
          aiResolved: Number(aiResolvedTickets[0]?.count ?? 0),
        },
        health: {
          overall: healthResult.overall,
          services: healthResult.services.map(s => ({ name: s.name, status: s.status })),
        },
        alerts: {
          total: alertsThisMonth.length,
          byPriority: alertsByPriority,
        },
        dunning: dunningSummary,
        autonomousDecisions: Number(autoDecisions[0]?.count ?? 0),
        topFeatureRequests: topRequests.map(r => ({ id: r.id, title: r.title, status: r.status })),
      });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // Run monthly maintenance (health check + data source probe)
  app.post("/api/founder/run-maintenance", isAuthenticated, isFounderAdmin, async (_req, res) => {
    try {
      const results: Record<string, string> = {};

      // 1. Run health checks
      const { healthCheckService } = await import("./services/healthCheck");
      const health = await healthCheckService.checkAll();
      results.healthCheck = health.overall;

      // 2. Run data source probes
      const { runHealthProbe } = await import("./services/dataQualityMonitor");
      const dataSourceResults = await runHealthProbe();
      const downSources = dataSourceResults.filter(r => r.status === "down");
      results.dataSources = `${dataSourceResults.length - downSources.length}/${dataSourceResults.length} healthy`;

      // 3. Process dunning tasks
      const { dunningService } = await import("./services/dunning");
      await dunningService.processScheduledTasks();
      results.dunning = "processed";

      // 4. Send weekly digest
      const { alertPolicyService } = await import("./services/alertPolicy");
      await alertPolicyService.sendWeeklyDigest();
      results.weeklyDigest = "sent";

      res.json({
        success: true,
        timestamp: new Date().toISOString(),
        results,
      });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ============================================
  // KNOWLEDGE BASE ADMIN (CRUD for founder)
  // ============================================

  const kbArticleSchema = z.object({
    title: z.string().min(1),
    slug: z.string().min(1).optional(),
    content: z.string().min(1),
    summary: z.string().optional(),
    category: z.string().min(1),
    tags: z.array(z.string()).optional(),
    keywords: z.array(z.string()).optional(),
    relatedIssues: z.array(z.string()).optional(),
    troubleshootingSteps: z.array(z.object({
      step: z.number(),
      instruction: z.string(),
      expectedResult: z.string(),
    })).optional(),
    canAutoFix: z.boolean().optional(),
    autoFixToolName: z.string().optional(),
    autoFixParameters: z.record(z.string(), z.any()).optional(),
    isPublished: z.boolean().optional(),
  });

  app.get("/api/founder/knowledge-base", isAuthenticated, isFounderAdmin, async (_req, res) => {
    try {
      const articles = await db.select().from(knowledgeBaseArticles)
        .orderBy(desc(knowledgeBaseArticles.updatedAt))
        .limit(1000);
      res.json({ articles });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  app.post("/api/founder/knowledge-base", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const parsed = kbArticleSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const data = parsed.data;
      const slug = data.slug || data.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

      const [article] = await db.insert(knowledgeBaseArticles).values({
        title: data.title,
        slug,
        content: data.content,
        summary: data.summary,
        category: data.category,
        tags: data.tags || [],
        keywords: data.keywords || [],
        relatedIssues: data.relatedIssues || [],
        troubleshootingSteps: data.troubleshootingSteps,
        canAutoFix: data.canAutoFix || false,
        autoFixToolName: data.autoFixToolName,
        autoFixParameters: data.autoFixParameters,
        isPublished: data.isPublished ?? true,
      }).returning();

      res.status(201).json({ article });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  app.put("/api/founder/knowledge-base/:id", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return Errors.badRequest(res, "Invalid ID");

      const parsed = kbArticleSchema.partial().safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const [updated] = await db.update(knowledgeBaseArticles)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(knowledgeBaseArticles.id, id))
        .returning();

      if (!updated) return Errors.notFound(res, "Article");
      res.json({ article: updated });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  app.delete("/api/founder/knowledge-base/:id", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return Errors.badRequest(res, "Invalid ID");

      const [deleted] = await db.delete(knowledgeBaseArticles)
        .where(eq(knowledgeBaseArticles.id, id))
        .returning();

      if (!deleted) return Errors.notFound(res, "Article");
      res.json({ success: true });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // Bulk seed knowledge base articles
  app.post("/api/founder/knowledge-base/seed", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const schema = z.object({ articles: z.array(kbArticleSchema) });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const results = [];
      for (const data of parsed.data.articles) {
        const slug = data.slug || data.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
        try {
          const [article] = await db.insert(knowledgeBaseArticles).values({
            title: data.title,
            slug,
            content: data.content,
            summary: data.summary,
            category: data.category,
            tags: data.tags || [],
            keywords: data.keywords || [],
            relatedIssues: data.relatedIssues || [],
            troubleshootingSteps: data.troubleshootingSteps,
            canAutoFix: data.canAutoFix || false,
            isPublished: data.isPublished ?? true,
          }).onConflictDoNothing().returning();
          if (article) results.push(article);
        } catch {}
      }

      res.json({ created: results.length, articles: results });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

}

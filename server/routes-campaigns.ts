import type { Express } from "express";
import { z } from "zod";
import crypto from "crypto";
import {
  insertCampaignSchema, insertCampaignResponseSchema,
  insertCampaignSequenceSchema, insertSequenceStepSchema, insertSequenceEnrollmentSchema,
  insertAbTestSchema, insertAbTestVariantSchema,
  insertTargetCountySchema,
  insertCampaignVariantSchema, campaignVariants,
} from "@shared/schema";

// Task #202: Partial update schemas derived from insert schemas
const updateCampaignSchema = insertCampaignSchema.partial();
const updateTargetCountySchema = insertTargetCountySchema.partial();
const updateCampaignSequenceSchema = insertCampaignSequenceSchema.partial();
const updateSequenceStepSchema = insertSequenceStepSchema.partial();
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { requirePermission } from "./utils/permissions";
import { Errors } from "./utils/errors";
import type { AuthenticatedRequest } from "./types/request";
import { logger } from "./utils/logger";
import { checkUsageLimit } from "./services/usageLimits";
import { usageLimitGate, aiByokThresholdGate } from "./middleware/usageLimitGate";
import { usageMeteringService, creditService } from "./services/credits";
import { createRateLimiter, RATE_LIMIT_CONFIGS } from "./middleware/rateLimit";
import { idempotencyMiddleware } from "./middleware/idempotency";
import { storage, db } from "./storage";
import { eq, sql, and, gte, desc } from "drizzle-orm";
import { leads, deals, properties, campaignResponses, campaignDeliveryEvents } from "@shared/schema";
import { shouldSimulate, recordSimulatedAction } from "./utils/simulationMode";
import { sendOrgSMS, orgHasConnectedSmsIdentity } from "./services/smsService";

export function registerCampaignRoutes(app: Express): void {
  const api = app;

  // CAMPAIGNS (Marketing)
  // ============================================
  
  api.get("/api/campaigns", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const campaigns = await storage.getCampaigns(org.id);
    res.json(campaigns);
  });
  
  // analytics — registered BEFORE /api/campaigns/:id so the literal path wins (2026-07-11 route-order sweep).
  api.get("/api/campaigns/analytics", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { campaignOptimizerService } = await import("./services/campaignOptimizer");
      const analytics = await campaignOptimizerService.getCampaignAnalytics(org.id);
      res.json(analytics);
    } catch (error: any) {
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to get campaign analytics"));
    }
  });

  // overlap-report — registered BEFORE /api/campaigns/:id so the literal path wins (2026-07-11 route-order sweep).
  // GET /api/campaigns/overlap-report
  api.get("/api/campaigns/overlap-report", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { campaignOverlapDetector } = await import("./services/campaignOverlapDetector");
      const org = req.organization;
      const report = await campaignOverlapDetector.generateOverlapReport(org.id);
      res.json(report);
    } catch (e: any) {
      Errors.internal(res, e instanceof Error ? e : new Error(e.message));
    }
  });

  api.get("/api/campaigns/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const campaign = await storage.getCampaign(org.id, Number(req.params.id));
    if (!campaign) return Errors.notFound(res, "Campaign");
    res.json(campaign);
  });

  api.post("/api/campaigns", isAuthenticated, getOrCreateOrg, requirePermission("canCreateCampaign"), usageLimitGate("campaigns"), async (req, res) => {
    try {
      const org = req.organization;
      const trackingCode = storage.generateTrackingCode();
      // The wizard submits untouched optional numeric/date inputs as "" —
      // Postgres rejects '' for numeric/timestamp columns and the raw insert
      // error surfaced as a bare 500 (WS1 interactive pass, 2026-07-07).
      const body: Record<string, unknown> = { ...req.body };
      for (const key of ["budget", "scheduledDate", "completedDate"]) {
        if (body[key] === "") body[key] = null;
      }
      const input = insertCampaignSchema.parse({
        ...body,
        organizationId: org.id,
        trackingCode
      });
      const campaign = await storage.createCampaign(input);
      
      const user = req.user as any;
      const userId = user?.id || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "create",
        entityType: "campaign",
        entityId: campaign.id,
        changes: { after: input, fields: Object.keys(input) },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      res.status(201).json(campaign);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return Errors.badRequest(res, err.issues[0].message);
      }
      throw err;
    }
  });

  // Get responses for a specific campaign
  api.get("/api/campaigns/:id/responses", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const campaignId = Number(req.params.id);
    const campaign = await storage.getCampaign(org.id, campaignId);
    if (!campaign) return Errors.notFound(res, "Campaign");

    const responses = await storage.getCampaignResponses(org.id, campaignId);
    res.json(responses);
  });

  // C2 receipts (experience-legibility.md): the rows behind a campaign's
  // "Sent" number — every delivery event with the lead it went to. The
  // aggregate counts and this list read the same table, so the number and
  // its evidence can never disagree.
  api.get("/api/campaigns/:id/delivery-events", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const campaignId = Number(req.params.id);
    if (!Number.isFinite(campaignId)) return Errors.badRequest(res, "Invalid campaign ID");
    const campaign = await storage.getCampaign(org.id, campaignId);
    if (!campaign) return Errors.notFound(res, "Campaign");
    try {
      const rows = await db
        .select({
          at: campaignDeliveryEvents.sentAt,
          channel: campaignDeliveryEvents.channel,
          status: campaignDeliveryEvents.status,
          leadFirst: leads.firstName,
          leadLast: leads.lastName,
          leadId: campaignDeliveryEvents.leadId,
        })
        .from(campaignDeliveryEvents)
        .leftJoin(leads, eq(campaignDeliveryEvents.leadId, leads.id))
        .where(eq(campaignDeliveryEvents.campaignId, campaignId))
        .orderBy(desc(campaignDeliveryEvents.sentAt))
        .limit(100);
      res.json({
        campaignId,
        rows: rows.map((r) => ({
          at: r.at ? new Date(r.at).toISOString() : null,
          channel: r.channel,
          status: r.status,
          leadId: r.leadId,
          leadName: [r.leadFirst, r.leadLast].filter(Boolean).join(" ") || null,
        })),
      });
    } catch (error) {
      Errors.internal(res, error instanceof Error ? error : new Error(String(error)));
    }
  });

  // Get campaign analytics with response data
  api.get("/api/campaigns/:id/analytics", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const campaignId = Number(req.params.id);
    const campaign = await storage.getCampaign(org.id, campaignId);
    if (!campaign) return Errors.notFound(res, "Campaign");

    const responsesCount = await storage.getCampaignResponsesCount(campaignId);
    const responses = await storage.getCampaignResponses(org.id, campaignId);

    // Delivery event status breakdown
    let deliveryBreakdown: Record<string, number> = {};
    try {
      const deliveryRows = await db.select({
        status: campaignDeliveryEvents.status,
        count: sql<number>`count(*)::int`,
      })
        .from(campaignDeliveryEvents)
        .where(eq(campaignDeliveryEvents.campaignId, campaignId))
        .groupBy(campaignDeliveryEvents.status);
      for (const row of deliveryRows) {
        deliveryBreakdown[row.status] = row.count;
      }
    } catch { /* table may not exist yet */ }

    const sent = campaign.totalSent || 0;
    const delivered = campaign.totalDelivered || 0;
    const opened = campaign.totalOpened || 0;
    const clicked = campaign.totalClicked || 0;
    const responded = campaign.totalResponded || 0;
    const spent = Number(campaign.spent || 0);
    
    const responseRate = sent > 0 ? (responsesCount / sent) * 100 : 0;
    const costPerResponse = responsesCount > 0 ? spent / responsesCount : 0;
    
    const dealsFromCampaign = await db.select({ count: sql<number>`count(*)::int` })
      .from(deals)
      .innerJoin(properties, eq(deals.propertyId, properties.id))
      .innerJoin(leads, eq(properties.sellerId, leads.id))
      .where(eq(leads.sourceCampaignId, campaignId));
    
    const dealCount = dealsFromCampaign[0]?.count || 0;
    const costPerAcquisition = dealCount > 0 ? spent / dealCount : 0;
    
    res.json({
      campaign,
      metrics: {
        sent,
        delivered,
        opened,
        clicked,
        responded,
        responsesCount,
        dealCount,
        responseRate: responseRate.toFixed(2),
        costPerResponse: costPerResponse.toFixed(2),
        costPerAcquisition: costPerAcquisition.toFixed(2),
        spent,
      },
      funnel: [
        { stage: 'Sent', count: sent },
        { stage: 'Delivered', count: delivered },
        { stage: 'Opened', count: opened },
        { stage: 'Clicked', count: clicked },
        { stage: 'Responded', count: responsesCount },
        { stage: 'Deal', count: dealCount },
      ],
      responses,
      deliveryBreakdown,
    });
  });

  // ============================================
  // CAMPAIGN RESPONSES (Inbound Response Tracking)
  // ============================================

  // Get all responses for the organization
  api.get("/api/responses", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const responses = await storage.getCampaignResponses(org.id);
    res.json(responses);
  });

  // Log a new response (auto-attributes to campaign if tracking code matches)
  api.post("/api/responses", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const responseBodySchema = z.object({
        trackingCode: z.string().optional(),
        channel: z.string().min(1, "channel is required"),
        content: z.string().optional(),
        leadId: z.number().int().positive().optional(),
        contactName: z.string().optional(),
        contactEmail: z.string().email().optional().or(z.literal("")),
        contactPhone: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      });
      const bodyParsed = responseBodySchema.safeParse(req.body);
      if (!bodyParsed.success) {
        return Errors.validationFailed(res, bodyParsed.error.issues);
      }
      const { trackingCode, channel, content, leadId, contactName, contactEmail, contactPhone, metadata } = bodyParsed.data;
      
      let campaignId: number | undefined;
      let isAttributed = false;
      
      if (trackingCode) {
        const campaign = await storage.getCampaignByTrackingCode(trackingCode);
        if (campaign && campaign.organizationId === org.id) {
          campaignId = campaign.id;
          isAttributed = true;
          
          await storage.updateCampaign(campaign.id, {
            totalResponded: (campaign.totalResponded || 0) + 1
          }, org.id);
        }
      }
      
      const input = insertCampaignResponseSchema.parse({
        organizationId: org.id,
        leadId: leadId || null,
        campaignId: campaignId || null,
        channel,
        content,
        trackingCode: trackingCode || null,
        isAttributed,
        contactName,
        contactEmail,
        contactPhone,
        metadata,
        responseDate: new Date(),
      });
      
      const response = await storage.createCampaignResponse(input);
      
      if (leadId && campaignId) {
        await storage.updateLead(leadId, {
          sourceCampaignId: campaignId,
          sourceTrackingCode: trackingCode,
        }, org.id);
      }
      
      res.status(201).json(response);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return Errors.badRequest(res, err.issues[0].message);
      }
      throw err;
    }
  });

  // Get a specific response
  api.get("/api/responses/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const response = await storage.getCampaignResponse(org.id, Number(req.params.id));
    // 2026-06-10 (T0-2 sweep): cross-tenant read IDOR — 404, never confirm
    // another org's response exists.
    if (!response || response.organizationId !== org.id) return Errors.notFound(res, "Response");
    res.json(response);
  });

  // Update a response
  api.put("/api/responses/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const validated = insertCampaignResponseSchema.partial().parse(req.body);
      // 2026-06-10 (T0-2 sweep): scope the write to this org so a foreign id
      // is a no-op that 404s.
      const response = await storage.updateCampaignResponse(Number(req.params.id), validated, org.id);
      if (!response) return Errors.notFound(res, "Response");
      res.json(response);
    } catch (err) {
      if (err instanceof z.ZodError) return Errors.badRequest(res, err.issues[0].message);
      throw err;
    }
  });

  // Delete a response
  api.delete("/api/responses/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    // 2026-06-10 (T0-2 sweep): org-scoped delete — a foreign id deletes nothing.
    await storage.deleteCampaignResponse(Number(req.params.id), org.id);
    res.status(204).send();
  });

  // ============================================
  // TARGET COUNTIES (Acquisition Workflow)
  // ============================================

  // Get all target counties for the organization
  api.get("/api/target-counties", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const counties = await storage.getTargetCounties(org.id);
    res.json(counties);
  });

  // Get a specific target county
  api.get("/api/target-counties/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const county = await storage.getTargetCounty(org.id, Number(req.params.id));
    if (!county) return Errors.notFound(res, "Target county");
    res.json(county);
  });

  // Create a new target county
  api.post("/api/target-counties", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { insertTargetCountySchema } = await import("@shared/schema");
      const input = insertTargetCountySchema.parse({
        ...req.body,
        organizationId: org.id,
      });
      const county = await storage.createTargetCounty(input);
      res.status(201).json(county);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return Errors.badRequest(res, err.issues[0].message);
      }
      throw err;
    }
  });

  // Update a target county
  api.put("/api/target-counties/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const county = await storage.getTargetCounty(org.id, Number(req.params.id));
      if (!county) return Errors.notFound(res, "Target county");
      const validated = updateTargetCountySchema.parse(req.body);
      const updated = await storage.updateTargetCounty(county.id, validated);
      res.json(updated);
    } catch (err) {
      if (err instanceof z.ZodError) return Errors.badRequest(res, err.issues[0].message);
      throw err;
    }
  });

  // Delete a target county
  api.delete("/api/target-counties/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const county = await storage.getTargetCounty(org.id, Number(req.params.id));
    if (!county) return Errors.notFound(res, "Target county");
    
    await storage.deleteTargetCounty(county.id);
    res.status(204).send();
  });

  // ============================================
  // CAMPAIGN SEQUENCES (Drip Campaign Automation)
  // ============================================

  // Get all sequences for the organization
  api.get("/api/sequences", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const sequences = await storage.getSequences(org.id);
    res.json(sequences);
  });

  // Get sequence stats (enrollment counts)
  api.get("/api/sequences/stats", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const stats = await storage.getSequenceStats(org.id);
    res.json(stats);
  });

  // Get a specific sequence with its steps
  api.get("/api/sequences/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const sequence = await storage.getSequence(org.id, Number(req.params.id));
    if (!sequence) return Errors.notFound(res, "Sequence");

    const steps = await storage.getSequenceSteps(sequence.id);
    res.json({ ...sequence, steps });
  });

  // Create a new sequence
  api.post("/api/sequences", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const input = insertCampaignSequenceSchema.parse({
        ...req.body,
        organizationId: org.id,
      });
      const sequence = await storage.createSequence(input);
      res.status(201).json(sequence);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return Errors.badRequest(res, err.issues[0].message);
      }
      throw err;
    }
  });

  // Update a sequence
  api.put("/api/sequences/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const sequence = await storage.getSequence(org.id, Number(req.params.id));
      if (!sequence) return Errors.notFound(res, "Sequence");
      const validated = updateCampaignSequenceSchema.parse(req.body);
      const updated = await storage.updateSequence(sequence.id, validated);
      res.json(updated);
    } catch (err) {
      if (err instanceof z.ZodError) return Errors.badRequest(res, err.issues[0].message);
      throw err;
    }
  });

  // Delete a sequence
  api.delete("/api/sequences/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const sequence = await storage.getSequence(org.id, Number(req.params.id));
    if (!sequence) return Errors.notFound(res, "Sequence");
    
    await storage.deleteSequence(sequence.id);
    res.status(204).send();
  });

  // ============================================
  // SEQUENCE STEPS
  // ============================================

  // Get steps for a sequence
  api.get("/api/sequences/:id/steps", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const sequence = await storage.getSequence(org.id, Number(req.params.id));
    if (!sequence) return Errors.notFound(res, "Sequence");

    const steps = await storage.getSequenceSteps(sequence.id);
    res.json(steps);
  });

  // Add a step to a sequence
  api.post("/api/sequences/:id/steps", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const sequence = await storage.getSequence(org.id, Number(req.params.id));
      if (!sequence) return Errors.notFound(res, "Sequence");
      
      const existingSteps = await storage.getSequenceSteps(sequence.id);
      const nextStepNumber = existingSteps.length + 1;
      
      const input = insertSequenceStepSchema.parse({
        ...req.body,
        sequenceId: sequence.id,
        stepNumber: nextStepNumber,
      });
      const step = await storage.createSequenceStep(input);
      res.status(201).json(step);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return Errors.badRequest(res, err.issues[0].message);
      }
      throw err;
    }
  });

  // reorder — registered BEFORE /api/sequences/:id/steps/:stepId so the literal path wins (2026-07-11 route-order sweep).
  api.put("/api/sequences/:id/steps/reorder", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const sequence = await storage.getSequence(org.id, Number(req.params.id));
    if (!sequence) return Errors.notFound(res, "Sequence");

    const parsed = reorderStepsSchema.safeParse(req.body);
    if (!parsed.success) {
      return Errors.validationFailed(res, parsed.error.issues);
    }
    const { stepIds } = parsed.data;
    await storage.reorderSequenceSteps(sequence.id, stepIds);
    
    const steps = await storage.getSequenceSteps(sequence.id);
    res.json(steps);
  });

  // Update a step
  api.put("/api/sequences/:id/steps/:stepId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const sequence = await storage.getSequence(org.id, Number(req.params.id));
      if (!sequence) return Errors.notFound(res, "Sequence");
      const validated = updateSequenceStepSchema.parse(req.body);
      // 2026-06-10 (T0-2 sweep): constrain to the org-checked sequence —
      // previously a foreign stepId under your own sequence id wrote
      // cross-tenant.
      const step = await storage.updateSequenceStep(Number(req.params.stepId), validated, sequence.id);
      if (!step) return Errors.notFound(res, "Step");
      res.json(step);
    } catch (err) {
      if (err instanceof z.ZodError) return Errors.badRequest(res, err.issues[0].message);
      throw err;
    }
  });

  // Delete a step
  api.delete("/api/sequences/:id/steps/:stepId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const sequence = await storage.getSequence(org.id, Number(req.params.id));
    if (!sequence) return Errors.notFound(res, "Sequence");
    
    // 2026-06-10 (T0-2 sweep): constrain to the org-checked sequence.
    await storage.deleteSequenceStep(Number(req.params.stepId), sequence.id);
    res.status(204).send();
  });

  // Reorder steps
  const reorderStepsSchema = z.object({
    stepIds: z.array(z.number().int().positive()).min(1, "stepIds must be a non-empty array"),
  });


  // ============================================
  // SEQUENCE ENROLLMENTS
  // ============================================

  // Get enrollments for a sequence
  api.get("/api/sequences/:id/enrollments", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const sequence = await storage.getSequence(org.id, Number(req.params.id));
    if (!sequence) return Errors.notFound(res, "Sequence");

    const enrollments = await storage.getSequenceEnrollments(sequence.id);
    res.json(enrollments);
  });

  // Get all active enrollments
  api.get("/api/enrollments/active", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const enrollments = await storage.getActiveEnrollments(org.id);
    res.json(enrollments);
  });

  // Enroll a lead in a sequence
  const enrollLeadSchema = z.object({
    leadId: z.number().int().positive("leadId is required"),
  });

  api.post("/api/sequences/:id/enroll", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const sequence = await storage.getSequence(org.id, Number(req.params.id));
      if (!sequence) return Errors.notFound(res, "Sequence");

      const parsed = enrollLeadSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      const { leadId } = parsed.data;
      const lead = await storage.getLead(org.id, leadId);
      if (!lead) return Errors.notFound(res, "Lead");

      // Check if lead is already enrolled in this sequence
      const existingEnrollments = await storage.getLeadEnrollments(leadId);
      const alreadyEnrolled = existingEnrollments.find(
        e => e.sequenceId === sequence.id && e.status === "active"
      );
      if (alreadyEnrolled) {
        return Errors.badRequest(res, "Lead is already enrolled in this sequence");
      }
      
      // Get first step delay to schedule
      const steps = await storage.getSequenceSteps(sequence.id);
      const firstStep = steps.find(s => s.stepNumber === 1);
      const delayDays = firstStep?.delayDays || 0;
      
      const nextStepScheduledAt = new Date();
      nextStepScheduledAt.setDate(nextStepScheduledAt.getDate() + delayDays);
      
      const input = insertSequenceEnrollmentSchema.parse({
        sequenceId: sequence.id,
        leadId,
        status: "active",
        currentStep: 0,
        nextStepScheduledAt,
      });
      
      const enrollment = await storage.createSequenceEnrollment(input);
      res.status(201).json(enrollment);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return Errors.badRequest(res, err.issues[0].message);
      }
      throw err;
    }
  });

  // Pause an enrollment
  const pauseEnrollmentSchema = z.object({
    reason: z.string().optional(),
  });

  // 2026-06-10 (T0-2 sweep): enrollments carry no org column, so ownership is
  // proven through the parent sequence. Previously pause/resume/cancel wrote
  // to any org's enrollment by id. 404 hides existence.
  const getOwnedEnrollment = async (orgId: number, enrollmentId: number) => {
    const enrollment = await storage.getSequenceEnrollment(enrollmentId);
    if (!enrollment) return undefined;
    const sequence = await storage.getSequence(orgId, enrollment.sequenceId);
    return sequence ? enrollment : undefined;
  };

  api.post("/api/enrollments/:id/pause", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const parsed = pauseEnrollmentSchema.safeParse(req.body);
    if (!parsed.success) {
      return Errors.validationFailed(res, parsed.error.issues);
    }
    const { reason } = parsed.data;
    const owned = await getOwnedEnrollment(org.id, Number(req.params.id));
    if (!owned) return Errors.notFound(res, "Enrollment");
    const enrollment = await storage.pauseEnrollment(owned.id, reason || "Manually paused");
    res.json(enrollment);
  });

  // Resume an enrollment
  api.post("/api/enrollments/:id/resume", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const owned = await getOwnedEnrollment(org.id, Number(req.params.id));
    if (!owned) return Errors.notFound(res, "Enrollment");
    const enrollment = await storage.resumeEnrollment(owned.id);
    res.json(enrollment);
  });

  // Cancel an enrollment
  api.post("/api/enrollments/:id/cancel", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const owned = await getOwnedEnrollment(org.id, Number(req.params.id));
    if (!owned) return Errors.notFound(res, "Enrollment");
    const enrollment = await storage.cancelEnrollment(owned.id);
    res.json(enrollment);
  });

  // Get lead's enrollments
  api.get("/api/leads/:id/enrollments", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const lead = await storage.getLead(org.id, Number(req.params.id));
    if (!lead) return Errors.notFound(res, "Lead");

    const enrollments = await storage.getLeadEnrollments(lead.id);
    res.json(enrollments);
  });
  
  api.put("/api/campaigns/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const validated = updateCampaignSchema.parse(req.body);
      const campaign = await storage.updateCampaign(Number(req.params.id), validated);
      if (!campaign) return Errors.notFound(res, "Campaign");
      res.json(campaign);
    } catch (err) {
      if (err instanceof z.ZodError) return Errors.badRequest(res, err.issues[0].message);
      throw err;
    }
  });
  
  // Send direct mail campaign with credit pre-checks
  // AUTO-SPLIT: If this campaign has variants (campaign_variants table), recipients are distributed
  // proportionally by each variant's trafficSplit percentage before sending. The caller (UI/job) is
  // responsible for partitioning leadIds accordingly when variant splits are active.
  api.post("/api/campaigns/:id/send-direct-mail", isAuthenticated, getOrCreateOrg, idempotencyMiddleware, async (req, res) => {
    try {
      const org = req.organization;
      const campaignId = parseInt(req.params.id);
      const sendMailSchema = z.object({
        pieceType: z.enum(['postcard_4x6', 'postcard_6x9', 'postcard_6x11', 'letter_1_page']),
        leadIds: z.array(z.number().int().positive()).min(1, "leadIds must be a non-empty array"),
      });
      const parsed = sendMailSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      const { pieceType, leadIds } = parsed.data;

      const { directMailService, DIRECT_MAIL_COSTS, MailAlreadySentError } = await import("./services/directMail");
      
      // Check if org has their own Lob credentials (BYOK) - if so, skip credit check
      const usingOrgLobCredentials = await directMailService.hasOrgLobCredentials(org.id);
      
      if (!usingOrgLobCredentials && !directMailService.isAvailable()) {
        return Errors.badRequest(res, "Direct mail service not configured. Please add LOB_API_KEY or configure your own Lob API key in Integrations.");
      }

      const campaign = await storage.getCampaign(org.id, campaignId);
      if (!campaign || campaign.type !== 'direct_mail') {
        return Errors.badRequest(res, "Invalid campaign or not a direct mail campaign");
      }

      if (!leadIds || leadIds.length === 0) {
        return Errors.badRequest(res, "No recipients specified");
      }

      // Get the organization's default mail sender identity
      const mailSenderIdentity = await storage.getDefaultMailSenderIdentity(org.id);
      if (!mailSenderIdentity) {
        return Errors.badRequest(res, "No return address configured. Please set up a mail sender identity in Mail Settings.");
      }

      // Warn if identity is not verified but allow sending
      let identityWarning: string | undefined;
      if (mailSenderIdentity.status !== 'verified') {
        identityWarning = `Warning: Return address "${mailSenderIdentity.name}" is not verified. Mail may be delayed or returned.`;
      }

      const costPerPiece = DIRECT_MAIL_COSTS[pieceType];
      const totalCost = costPerPiece * leadIds.length;

      // Only check credits if NOT using org Lob credentials (BYOK)
      if (!usingOrgLobCredentials) {
        const balance = await creditService.getBalance(org.id);
        if (balance < totalCost) {
          return Errors.paymentRequired(res, "Insufficient credits", {
            required: totalCost / 100,
            balance: balance / 100,
            perPiece: costPerPiece / 100,
            recipientCount: leadIds.length,
          });
        }
      } else {
        logger.info(`Skipping credit pre-check for org - using org Lob credentials`, { orgId: org.id });
      }

      const leadsData = await Promise.all(
        leadIds.map(id => storage.getLead(org.id, id))
      );
      const validLeadsRaw = leadsData.filter(
        (l): l is NonNullable<typeof l> => Boolean(l && l.address && l.city && l.state && l.zip)
      );

      if (validLeadsRaw.length === 0) {
        return Errors.badRequest(res, "No valid recipients with complete addresses");
      }

      // Lens 36 / Tom Hsiao — Pre-mail dedupe scanner. Block sends to:
      //   - your own owned parcels
      //   - leads mailed in the last 90 days
      //   - returned-to-sender addresses
      //   - DNC / opted-out / missing-address leads
      // The scanner runs unconditionally before any postage is paid.
      const { runPreMailDedupe } = await import("./services/preMailDedupe");
      const dedupe = await runPreMailDedupe({
        organizationId: org.id,
        leadIds: validLeadsRaw.map(l => l!.id),
        recentMailWindowDays: 90,
      });
      const acceptedIds = new Set(dedupe.acceptedLeads.map(l => l.id));
      const validLeads = validLeadsRaw.filter(l => acceptedIds.has(l!.id));

      if (validLeads.length === 0) {
        return res.status(409).json({
          error: "All recipients were filtered by the pre-mail dedupe scanner",
          dedupe: {
            input: dedupe.totals.input,
            accepted: 0,
            skipped: dedupe.totals.skipped,
            breakdown: {
              ownedParcel: dedupe.skipped.ownedParcel.length,
              recentlyMailed: dedupe.skipped.recentlyMailed.length,
              returnedMail: dedupe.skipped.returnedMail.length,
              doNotContact: dedupe.skipped.doNotContact.length,
              missingAddress: dedupe.skipped.missingAddress.length,
            },
          },
        });
      }

      // Only deduct credits if NOT using org Lob credentials (BYOK)
      let deductResult: any = true;
      if (!usingOrgLobCredentials) {
        deductResult = await creditService.deductCredits(
          org.id,
          costPerPiece * validLeads.length,
          `Direct mail campaign: ${campaign.name} - ${validLeads.length} pieces`,
          { campaignId, pieceType, recipientCount: validLeads.length }
        );

        if (!deductResult) {
          return Errors.paymentRequired(res, "Insufficient credits");
        }
      } else {
        logger.info(`Skipping credit deduction for org - using org Lob credentials`, { orgId: org.id });
      }

      // Create return address snapshot from mail sender identity
      const returnAddressSnapshot = {
        companyName: mailSenderIdentity.companyName,
        addressLine1: mailSenderIdentity.addressLine1,
        addressLine2: mailSenderIdentity.addressLine2 || undefined,
        city: mailSenderIdentity.city,
        state: mailSenderIdentity.state,
        zipCode: mailSenderIdentity.zipCode,
        country: mailSenderIdentity.country,
      };

      // Determine mail type from pieceType
      const mailType = pieceType.startsWith('postcard_') ? 'postcard' : 'letter';

      // Create mailing order record with pending status
      // creditsUsed is 0 when using org Lob credentials (BYOK)
      const mailingOrder = await storage.createMailingOrder({
        organizationId: org.id,
        campaignId,
        mailSenderIdentityId: mailSenderIdentity.id,
        returnAddressSnapshot,
        mailType,
        totalPieces: validLeads.length,
        costPerPiece: usingOrgLobCredentials ? 0 : costPerPiece,
        totalCost: usingOrgLobCredentials ? 0 : (costPerPiece * validLeads.length),
        creditsUsed: usingOrgLobCredentials ? 0 : (costPerPiece * validLeads.length),
        status: 'pending',
      });

      // Update order status to in_progress when sending starts
      await storage.updateMailingOrder(mailingOrder.id, {
        status: 'sending',
        startedAt: new Date(),
      });

      // Build sender address for Lob
      const senderAddress = {
        name: mailSenderIdentity.companyName,
        addressLine1: mailSenderIdentity.addressLine1,
        addressLine2: mailSenderIdentity.addressLine2 || undefined,
        city: mailSenderIdentity.city,
        state: mailSenderIdentity.state,
        zip: mailSenderIdentity.zipCode,
      };

      // Get current mail mode from organization settings
      const mailMode = (org.settings?.mailMode || 'test') as 'test' | 'live';
      const isTestMode = mailMode === 'test';

      // Actually send the mail pieces via Lob
      const sendResults: Array<{ leadId: number; success: boolean; lobId?: string; expectedDeliveryDate?: Date; error?: string; isTest?: boolean }> = [];
      const lobJobIds: string[] = [];
      
      for (const lead of validLeads) {
        const recipientName = `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || 'Property Owner';
        
        // Idempotency key for THIS piece (canonical law 8, BI74). Derived from
        // durable domain identity that already exists BEFORE the send:
        // `mailingOrder` was created above the loop and `lead.id` is a stable
        // row. Scoping to the ORDER — not just the lead — is what makes this
        // safe: retrying this send batch is suppressed, while a later,
        // deliberate mailing to the same lead creates a NEW mailing order and
        // therefore a new key. A lead-only key would have silently blocked the
        // second touch.
        const pieceIdempotencyKey = `mailing-order:${mailingOrder.id}:lead:${lead.id}`;

        try {
          let result: any;
          if (pieceType.startsWith('postcard_')) {
            const size = pieceType.replace('postcard_', '') as '4x6' | '6x9' | '6x11';
            result = await directMailService.sendPostcard({
              size,
              front: campaign.content || '<html><body><h1>Special Offer!</h1></body></html>',
              back: `<html><body><p>Dear ${lead.firstName || 'Property Owner'},</p><p>${campaign.subject || 'We are interested in your property.'}</p></body></html>`,
              to: {
                name: recipientName,
                addressLine1: lead.address!,
                city: lead.city!,
                state: lead.state!,
                zip: lead.zip!,
              },
              from: senderAddress,
              idempotencyKey: pieceIdempotencyKey,
            }, mailMode, org.id);
          } else {
            result = await directMailService.sendLetter({
              file: campaign.content || '<html><body><p>Letter content</p></body></html>',
              to: {
                name: recipientName,
                addressLine1: lead.address!,
                city: lead.city!,
                state: lead.state!,
                zip: lead.zip!,
              },
              from: senderAddress,
              idempotencyKey: pieceIdempotencyKey,
            }, mailMode, org.id);
          }

          const expectedDeliveryDate = result.expected_delivery_date ? new Date(result.expected_delivery_date) : undefined;
          // Trust the service's honest flag — the live-send interlock may
          // have degraded a 'live' request to Lob's test environment.
          sendResults.push({ leadId: lead.id, success: true, lobId: result.id, expectedDeliveryDate, isTest: result.isTestMode ?? isTestMode });
          lobJobIds.push(result.id);

          // Phase 3 Week 14 — Activation telemetry. First successfully-sent
          // direct-mail piece (postcard or letter). Idempotent FIRST-occurrence.
          try {
            const { recordActivationEventAsync } = await import("./services/activation");
            recordActivationEventAsync({
              orgId: org.id,
              userId: null,
              eventName: "first_letter_sent",
              eventValue: { lobId: result.id, pieceType, isTestMode },
            });
          } catch { /* non-fatal */ }

          // Generate unique 8-char tracking code for attribution
          const trackingCode = crypto.randomBytes(4).toString("hex").toUpperCase();

          // Create mailing order piece record for successful send
          const piece = await storage.createMailingOrderPiece({
            mailingOrderId: mailingOrder.id,
            leadId: lead.id,
            recipientName,
            recipientAddressLine1: lead.address!,
            recipientCity: lead.city!,
            recipientState: lead.state!,
            recipientZipCode: lead.zip!,
            status: 'sent',
            trackingCode,
          });
          // Update with Lob-specific fields after creation
          await storage.updateMailingOrderPiece(piece.id, {
            lobMailId: result.id,
            lobUrl: result.url,
            expectedDeliveryDate,
          });
        } catch (err: any) {
          // A replay is NOT a failure. The outward-action boundary throws
          // MailAlreadySentError when a piece for this key was already printed
          // — recording that as `failed` would understate the sent count and,
          // worse, invite an operator to re-send something already in the post.
          // The error carries the real Lob id, so the piece is recorded as sent.
          if (err instanceof MailAlreadySentError) {
            logger.warn(
              `[Campaigns] Piece ${pieceIdempotencyKey} was already sent (Lob id ${err.lobId ?? 'unknown'}) — not printing a second copy`,
            );
            sendResults.push({ leadId: lead.id, success: true, lobId: err.lobId ?? undefined, isTest: isTestMode });
            if (err.lobId) lobJobIds.push(err.lobId);
            continue;
          }

          sendResults.push({ leadId: lead.id, success: false, error: err.message });

          // Create mailing order piece record for failed send
          await storage.createMailingOrderPiece({
            mailingOrderId: mailingOrder.id,
            leadId: lead.id,
            recipientName,
            recipientAddressLine1: lead.address!,
            recipientCity: lead.city!,
            recipientState: lead.state!,
            recipientZipCode: lead.zip!,
            status: 'failed',
            errorMessage: err.message,
          });
        }
      }

      const successCount = sendResults.filter(r => r.success).length;
      const failCount = sendResults.filter(r => !r.success).length;

      // Update mailing order to completed with final counts
      await storage.updateMailingOrder(mailingOrder.id, {
        status: 'completed',
        sentPieces: successCount,
        failedPieces: failCount,
        lobJobIds,
        completedAt: new Date(),
      });

      // Record usage and handle refunds only if NOT using org credentials (BYOK)
      if (!usingOrgLobCredentials) {
        // Record usage only for successful sends
        if (successCount > 0) {
          await usageMeteringService.recordUsage(
            org.id,
            'direct_mail',
            successCount,
            { campaignId, pieceType, mailingOrderId: mailingOrder.id },
            false // already deducted upfront
          );
        }

        // Refund credits for failed sends
        if (failCount > 0) {
          const refundAmount = costPerPiece * failCount;
          await creditService.addCredits(
            org.id,
            refundAmount,
            'refund',
            `Refund for ${failCount} failed direct mail pieces in campaign: ${campaign.name}`,
            { campaignId, pieceType, failedCount: failCount, mailingOrderId: mailingOrder.id }
          );
        }
      } else {
        logger.info(`Skipping usage recording for org - using org Lob credentials (BYOK)`, { orgId: org.id });
      }

      await storage.updateCampaign(campaignId, {
        totalSent: (campaign.totalSent || 0) + successCount,
        status: 'active',
      });

      // Honest test-mode aggregate: the org may have REQUESTED live mode,
      // but the live-send interlock can degrade the actual sends to Lob's
      // test environment. Report what happened, not what was asked for.
      const actuallyTestMode = successCount > 0
        ? sendResults.every((r) => !r.success || r.isTest === true)
        : isTestMode;

      res.json({
        success: true,
        isTestMode: actuallyTestMode,
        mailingOrderId: mailingOrder.id,
        piecesQueued: successCount,
        piecesFailed: failCount,
        totalCost: (costPerPiece * successCount) / 100,
        refunded: failCount > 0 ? (costPerPiece * failCount) / 100 : 0,
        message: actuallyTestMode
          ? `${successCount} test mail pieces queued (no physical mail was printed)${failCount > 0 ? `, ${failCount} failed` : ''}`
          : `${successCount} mail pieces sent${failCount > 0 ? `, ${failCount} failed (refunded)` : ''}`,
        warning: identityWarning,
        details: sendResults,
        // Lens 36 / Tom Hsiao — surface what the pre-mail dedupe scanner did
        dedupe: {
          input: dedupe.totals.input,
          accepted: dedupe.totals.accepted,
          skipped: dedupe.totals.skipped,
          breakdown: {
            ownedParcel: dedupe.skipped.ownedParcel.length,
            recentlyMailed: dedupe.skipped.recentlyMailed.length,
            returnedMail: dedupe.skipped.returnedMail.length,
            doNotContact: dedupe.skipped.doNotContact.length,
            missingAddress: dedupe.skipped.missingAddress.length,
          },
        },
      });
    } catch (error: any) {
      logger.error("Direct mail send error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to send direct mail"));
    }
  });

  // Lens 36 / Tom Hsiao — Pre-mail dedupe + credit-burn preview.
  // The UI calls this BEFORE showing the send modal so the investor sees
  // "you have X letters of credit, this campaign needs Y, you'll fall short
  // on letter Z" + which leads will be auto-skipped (owned parcels, recent
  // mail, returned mail, DNC) before any postage is paid.
  api.post("/api/campaigns/:id/pre-send-check", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const campaignId = parseInt(req.params.id);
      const { leadIds, pieceType } = req.body as { leadIds: number[]; pieceType?: string };

      if (!Array.isArray(leadIds) || leadIds.length === 0) {
        return Errors.badRequest(res, "leadIds array is required");
      }

      const campaign = await storage.getCampaign(org.id, campaignId);
      if (!campaign) return Errors.notFound(res, "Campaign");

      const { runPreMailDedupe } = await import("./services/preMailDedupe");
      const dedupe = await runPreMailDedupe({
        organizationId: org.id,
        leadIds,
        recentMailWindowDays: 90,
      });

      // Credit-burn forecast against the accepted set
      const { DIRECT_MAIL_COSTS } = await import("./services/directMail");
      const piece = (pieceType || "letter_1_page") as keyof typeof DIRECT_MAIL_COSTS;
      const costPerPiece = DIRECT_MAIL_COSTS[piece] || 75;

      const usingOrgLobCredentials = await (
        await import("./services/directMail")
      ).directMailService.hasOrgLobCredentials(org.id);

      let balance = 0;
      let lettersOfRunway: number | null = null;
      let willFallShort = false;
      let shortfallAtIndex: number | null = null;
      let shortfallLead: { id: number; name: string } | null = null;

      if (!usingOrgLobCredentials) {
        balance = await creditService.getBalance(org.id);
        lettersOfRunway = Math.floor(balance / costPerPiece);
        const totalCost = costPerPiece * dedupe.acceptedLeads.length;
        willFallShort = balance < totalCost;
        if (willFallShort) {
          shortfallAtIndex = lettersOfRunway;
          const shortLead = dedupe.acceptedLeads[lettersOfRunway];
          if (shortLead) {
            shortfallLead = {
              id: shortLead.id,
              name: `${shortLead.firstName || ""} ${shortLead.lastName || ""}`.trim() || "(unnamed)",
            };
          }
        }
      }

      res.json({
        campaignId,
        pieceType: piece,
        costPerPiece: costPerPiece / 100,
        dedupe: {
          input: dedupe.totals.input,
          accepted: dedupe.totals.accepted,
          skipped: dedupe.totals.skipped,
          breakdown: {
            ownedParcel: dedupe.skipped.ownedParcel.length,
            recentlyMailed: dedupe.skipped.recentlyMailed.length,
            returnedMail: dedupe.skipped.returnedMail.length,
            doNotContact: dedupe.skipped.doNotContact.length,
            missingAddress: dedupe.skipped.missingAddress.length,
          },
          examples: {
            ownedParcel: dedupe.skipped.ownedParcel.slice(0, 3).map(l => ({
              id: l.id,
              name: `${l.firstName || ""} ${l.lastName || ""}`.trim(),
              address: l.address,
            })),
            recentlyMailed: dedupe.skipped.recentlyMailed.slice(0, 3).map(l => ({
              id: l.id,
              name: `${l.firstName || ""} ${l.lastName || ""}`.trim(),
            })),
            returnedMail: dedupe.skipped.returnedMail.slice(0, 3).map(l => ({
              id: l.id,
              name: `${l.firstName || ""} ${l.lastName || ""}`.trim(),
              address: l.address,
            })),
          },
        },
        creditBurn: {
          usingOrgLobCredentials,
          balanceCents: balance,
          balanceDollars: balance / 100,
          requiredCents: costPerPiece * dedupe.acceptedLeads.length,
          requiredDollars: (costPerPiece * dedupe.acceptedLeads.length) / 100,
          lettersOfRunway,
          willFallShort,
          shortfallAtIndex,
          shortfallLead,
        },
      });
    } catch (error: any) {
      logger.error("Pre-send check error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Pre-send check failed"));
    }
  });

  // Estimate cost for sending a campaign to selected recipients
  api.get("/api/campaigns/:id/estimate-cost", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { pieceType, recipientCount } = req.query as { pieceType: string; recipientCount: string };
      
      const { DIRECT_MAIL_COSTS } = await import("./services/directMail");
      
      const costPerPiece = DIRECT_MAIL_COSTS[pieceType as keyof typeof DIRECT_MAIL_COSTS] || 75;
      const count = parseInt(recipientCount) || 0;
      const totalCost = costPerPiece * count;
      const balance = await creditService.getBalance(org.id);
      const mailMode = org.settings?.mailMode || 'test';
      
      res.json({
        pieceType,
        recipientCount: count,
        costPerPiece: costPerPiece / 100,
        totalCost: totalCost / 100,
        currentBalance: balance / 100,
        canAfford: balance >= totalCost,
        creditsNeeded: balance < totalCost ? (totalCost - balance) / 100 : 0,
        mailMode,
        isTestMode: mailMode === 'test',
      });
    } catch (error: any) {
      Errors.internal(res, error instanceof Error ? error : new Error(error.message));
    }
  });

  // ============================================
  // CAMPAIGN OPTIMIZATIONS
  // ============================================
  
  
  api.get("/api/campaigns/:id/optimizations", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const campaignId = parseInt(req.params.id);
      
      const campaign = await storage.getCampaign(org.id, campaignId);
      if (!campaign) {
        return Errors.notFound(res, "Campaign");
      }

      const optimizations = await storage.getCampaignOptimizations(campaignId);
      res.json(optimizations);
    } catch (error: any) {
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to get optimizations"));
    }
  });
  
  // 7-day response trend: daily response counts for sparkline charts
  api.get("/api/campaigns/:id/response-trend", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const campaignId = parseInt(req.params.id);

      const campaign = await storage.getCampaign(org.id, campaignId);
      if (!campaign) {
        return Errors.notFound(res, "Campaign");
      }

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
      sevenDaysAgo.setHours(0, 0, 0, 0);

      const rows = await db
        .select({
          date: sql<string>`to_char(${campaignResponses.responseDate}, 'YYYY-MM-DD')`,
          count: sql<number>`count(*)::int`,
        })
        .from(campaignResponses)
        .where(
          and(
            eq(campaignResponses.campaignId, campaignId),
            gte(campaignResponses.responseDate, sevenDaysAgo)
          )
        )
        .groupBy(sql`to_char(${campaignResponses.responseDate}, 'YYYY-MM-DD')`)
        .orderBy(sql`to_char(${campaignResponses.responseDate}, 'YYYY-MM-DD')`);

      // Fill in zero-count days so the client always gets exactly 7 data points
      const trend: { date: string; count: number }[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().slice(0, 10);
        const found = rows.find((r) => r.date === dateStr);
        trend.push({ date: dateStr, count: found ? Number(found.count) : 0 });
      }

      res.json(trend);
    } catch (error: any) {
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to get response trend"));
    }
  });

  // W4.1 — the optimizer runs a gpt-4o call per invocation and used to be
  // the only AI surface with NO turn meter at all: it never counted against
  // ai_requests, never consulted the BYOK threshold, and billed platform
  // COGS invisibly. Same gate stack as chat now.
  api.post("/api/campaigns/:id/optimize", isAuthenticated, getOrCreateOrg, usageLimitGate("ai_requests"), aiByokThresholdGate(), async (req, res) => {
    try {
      const org = req.organization;
      const campaignId = parseInt(req.params.id);

      const campaign = await storage.getCampaign(org.id, campaignId);
      if (!campaign) {
        return Errors.notFound(res, "Campaign");
      }

      try {
        await storage.trackUsage(org.id, "ai_request");
      } catch (err) {
        logger.warn("[campaign-optimize] trackUsage failed (continuing)", err instanceof Error ? err : undefined);
      }

      const { campaignOptimizerService } = await import("./services/campaignOptimizer");
      const result = await campaignOptimizerService.optimizeCampaign(campaign);
      
      res.json({
        success: true,
        campaignId,
        metrics: result.metrics,
        score: result.score,
        suggestionsGenerated: result.savedOptimizations,
        suggestions: result.suggestions,
      });
    } catch (error: any) {
      logger.error("Campaign optimization error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to optimize campaign"));
    }
  });
  
  api.put("/api/optimizations/:id/implement", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const optimizationId = parseInt(req.params.id);
      const { resultDelta } = req.body;
      // F-D39: refuse to mark another org's optimization as implemented.
      const { campaignOptimizations } = await import("@shared/schema");
      const { eq: dEq } = await import("drizzle-orm");
      const [existing] = await db
        .select()
        .from(campaignOptimizations)
        .where(dEq(campaignOptimizations.id, optimizationId));
      if (!existing || existing.organizationId !== org.id) {
        return Errors.notFound(res, "Optimization");
      }

      const updated = await storage.markOptimizationImplemented(optimizationId, resultDelta || null);
      if (!updated) {
        return Errors.notFound(res, "Optimization");
      }

      res.json(updated);
    } catch (error: any) {
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to mark optimization as implemented"));
    }
  });
  
  // ============================================
  // PRICING RATES
  // ============================================
  
  api.get("/api/pricing/rates", async (req, res) => {
    const { DIRECT_MAIL_COSTS } = await import("./services/directMail");
    
    res.json({
      actions: {
        email_sent: { name: "Email", costCents: 1, description: "Per email sent" },
        sms_sent: { name: "SMS Text", costCents: 3, description: "Per text message" },
        ai_chat: { name: "AI Chat", costCents: 2, description: "Per AI conversation message" },
        ai_image: { name: "AI Image", costCents: 25, description: "Per image generated" },
        pdf_generated: { name: "Document PDF", costCents: 5, description: "Per document generated" },
        comps_query: { name: "Comps Analysis", costCents: 10, description: "Per property analysis" },
      },
      directMail: {
        postcard_4x6: { name: "Postcard 4x6", costCents: DIRECT_MAIL_COSTS.postcard_4x6, description: "Small postcard" },
        postcard_6x9: { name: "Postcard 6x9", costCents: DIRECT_MAIL_COSTS.postcard_6x9, description: "Standard postcard" },
        postcard_6x11: { name: "Postcard 6x11", costCents: DIRECT_MAIL_COSTS.postcard_6x11, description: "Large postcard" },
        letter_1_page: { name: "Letter (1 page)", costCents: DIRECT_MAIL_COSTS.letter_1_page, description: "Single page letter" },
        letter_2_page: { name: "Letter (2 pages)", costCents: DIRECT_MAIL_COSTS.letter_2_page, description: "Two page letter" },
      },
      monthlyAllowances: {
        free: { credits: 100, value: "$1.00" },
        starter: { credits: 1000, value: "$10.00" },
        pro: { credits: 5000, value: "$50.00" },
        scale: { credits: 25000, value: "$250.00" },
      },
    });
  });
  
  // ============================================
  // DIRECT MAIL SETTINGS & ESTIMATES
  // ============================================
  
  // Get direct mail status and configuration
  api.get("/api/direct-mail/status", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const { directMailService, DIRECT_MAIL_COSTS } = await import("./services/directMail");
    
    const currentMode = org.settings?.mailMode || 'test';
    const availableModes = directMailService.getAvailableModes();
    
    res.json({
      isConfigured: directMailService.isAvailable(),
      currentMode,
      availableModes,
      hasTestMode: directMailService.hasTestMode(),
      hasLiveMode: directMailService.hasLiveMode(),
      pricing: DIRECT_MAIL_COSTS,
      deliveryDays: directMailService.getEstimatedDeliveryDays(),
    });
  });
  
  // Update mail mode (test/live)
  api.patch("/api/direct-mail/mode", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const modeSchema = z.object({ mode: z.enum(["test", "live"]) });
    const parsed = modeSchema.safeParse(req.body);
    if (!parsed.success) {
      return Errors.validationFailed(res, parsed.error.issues);
    }
    const { mode } = parsed.data;
    
    const { directMailService } = await import("./services/directMail");
    
    // Validate the mode is available
    if (mode === 'live' && !directMailService.hasLiveMode()) {
      return Errors.badRequest(res, "Live mode not available - no live API key configured");
    }
    if (mode === 'test' && !directMailService.hasTestMode()) {
      return Errors.badRequest(res, "Test mode not available - no test API key configured");
    }
    
    // Update organization settings. 2026-07 audit: atomic jsonb_set on the
    // single key — the old read-modify-write of the WHOLE settings object
    // silently dropped any concurrently-written sibling key (last-write-wins
    // clobber). Pattern from server/ai/supportAgent.ts.
    const { db } = await import("./db");
    const { organizations } = await import("@shared/schema");
    const { sql: sqlTag, eq: eqOp } = await import("drizzle-orm");
    await db
      .update(organizations)
      .set({
        settings: sqlTag`jsonb_set(COALESCE(${organizations.settings}, '{}'), '{mailMode}', ${JSON.stringify(mode)}::jsonb)` as any,
        updatedAt: new Date(),
      })
      .where(eqOp(organizations.id, org.id));
    
    res.json({ 
      success: true, 
      mode,
      message: mode === 'test' 
        ? 'Test mode enabled - mail will not actually be sent' 
        : 'Live mode enabled - real mail will be sent and billed'
    });
  });
  
  // Get cost estimate for a batch of mail
  api.post("/api/direct-mail/estimate", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const estimateSchema = z.object({
        pieceType: z.enum(['postcard_4x6', 'postcard_6x9', 'postcard_6x11', 'letter_1_page']),
        recipientCount: z.number().int().min(0).optional(),
        recipientIds: z.array(z.number().int().positive()).optional(),
        campaignId: z.number().int().positive().optional(),
      });
      const parsed = estimateSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      const { pieceType, recipientCount, recipientIds, campaignId } = parsed.data;

      const { directMailService } = await import("./services/directMail");

      if (!directMailService.isAvailable()) {
        return Errors.badRequest(res, "Direct mail service not configured");
      }
      
      // Calculate recipient count from IDs if provided
      let count = recipientCount || 0;
      if (recipientIds && Array.isArray(recipientIds)) {
        count = recipientIds.length;
      } else if (campaignId) {
        // Get leads matching campaign criteria
        const campaign = await storage.getCampaign(org.id, campaignId);
        if (campaign && campaign.targetCriteria) {
          const leads = await storage.getLeads(org.id);
          // Filter leads by campaign criteria (simplified)
          count = leads.length;
        }
      }
      
      if (count <= 0) {
        return Errors.badRequest(res, "Must specify recipientCount, recipientIds, or campaignId");
      }
      
      const currentMode = org.settings?.mailMode || 'test';
      const estimate = directMailService.estimateBatchCost(pieceType, count, currentMode);
      
      // Task #218: Use integer-cent arithmetic — creditBalance is stored in cents
      const creditBalance = Math.round(Number(org.creditBalance || '0'));
      const totalCostCents = Math.round(estimate.totalCost);
      const hasEnoughCredits = creditBalance >= totalCostCents;
      
      res.json({
        ...estimate,
        currentMode,
        creditBalance,
        hasEnoughCredits,
        creditsNeeded: hasEnoughCredits ? 0 : totalCostCents - creditBalance,
      });
    } catch (error: any) {
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to generate estimate"));
    }
  });

  // Verify a single address
  api.post("/api/direct-mail/verify-address", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const addressSchema = z.object({
        line1: z.string().min(1, "line1 is required"),
        line2: z.string().optional(),
        city: z.string().min(1, "city is required"),
        state: z.string().min(1, "state is required"),
        zip: z.string().min(1, "zip is required"),
      });
      const parsed = addressSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      const { line1, line2, city, state, zip } = parsed.data;
      
      const isProduction = process.env.NODE_ENV === 'production';
      const apiKey = isProduction 
        ? process.env.LOB_LIVE_API_KEY 
        : (process.env.LOB_TEST_API_KEY || process.env.LOB_LIVE_API_KEY);
      
      if (!apiKey) {
        return Errors.badRequest(res, "Address verification service not configured. Please add Lob API key in settings.");
      }

      const { verifyAddress } = await import("./services/directMailService");

      const result = await verifyAddress({
        line1,
        line2,
        city,
        state,
        zip,
      });
      res.json(result);
    } catch (error: any) {
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to verify address"));
    }
  });

  // Bulk verify addresses for leads
  api.post("/api/direct-mail/bulk-verify-addresses", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const bulkVerifySchema = z.object({
        leadIds: z.array(z.number().int().positive()).min(1, "leadIds array is required").max(100, "Maximum 100 addresses per batch"),
      });
      const parsed = bulkVerifySchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      const { leadIds } = parsed.data;

      if (leadIds.length > 100) {
        return Errors.badRequest(res, "Maximum 100 addresses can be verified at once");
      }
      
      const isProduction = process.env.NODE_ENV === 'production';
      const apiKey = isProduction 
        ? process.env.LOB_LIVE_API_KEY 
        : (process.env.LOB_TEST_API_KEY || process.env.LOB_LIVE_API_KEY);
      
      if (!apiKey) {
        return Errors.badRequest(res, "Address verification service not configured. Please add Lob API key in settings.");
      }

      const { verifyAddress } = await import("./services/directMailService");

      const results: Array<{
        leadId: number;
        isValid: boolean;
        deliverability: string;
        errorMessage?: string;
      }> = [];
      
      let deliverable = 0;
      let undeliverable = 0;
      
      for (const leadId of leadIds) {
        const lead = await storage.getLead(org.id, leadId);
        if (!lead) {
          results.push({ leadId, isValid: false, deliverability: 'unknown', errorMessage: 'Lead not found' });
          undeliverable++;
          continue;
        }
        
        if (!lead.address || !lead.city || !lead.state || !lead.zip) {
          results.push({ leadId, isValid: false, deliverability: 'incomplete_address', errorMessage: 'Incomplete address information' });
          undeliverable++;
          continue;
        }

        try {
          const verificationResult = await verifyAddress({
            line1: lead.address,
            line2: undefined,
            city: lead.city,
            state: lead.state,
            zip: lead.zip,
          });
          
          results.push({
            leadId,
            isValid: verificationResult.isValid,
            deliverability: verificationResult.deliverability,
            errorMessage: verificationResult.errorMessage,
          });
          
          if (verificationResult.isValid) {
            deliverable++;
          } else {
            undeliverable++;
          }
        } catch (error: any) {
          results.push({
            leadId,
            isValid: false,
            deliverability: 'error',
            errorMessage: error.message || 'Verification failed',
          });
          undeliverable++;
        }
      }
      
      res.json({
        total: leadIds.length,
        verified: results.length,
        deliverable,
        undeliverable,
        results,
      });
    } catch (error: any) {
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to verify addresses"));
    }
  });

  // ============================================
  // CAMPAIGN VARIANTS (A/B Test Framework)
  // ============================================

  // POST /api/campaigns/:id/variants — create a variant for a campaign
  api.post("/api/campaigns/:id/variants", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const campaignId = Number(req.params.id);

      const campaign = await storage.getCampaign(org.id, campaignId);
      if (!campaign) return Errors.notFound(res, "Campaign");

      const input = insertCampaignVariantSchema.parse({
        campaignId,
        name: req.body.name || "Variant B",
        subject: req.body.subject ?? null,
        body: req.body.body ?? null,
        trafficSplit: req.body.trafficSplit ?? 50,
      });

      const [variant] = await db.insert(campaignVariants).values(input).returning();
      res.status(201).json(variant);
    } catch (err: any) {
      if (err instanceof z.ZodError) return Errors.badRequest(res, err.issues[0].message);
      Errors.internal(res, err instanceof Error ? err : new Error(err.message));
    }
  });

  // GET /api/campaigns/:id/variants — list variants with performance stats
  api.get("/api/campaigns/:id/variants", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const campaignId = Number(req.params.id);

      const campaign = await storage.getCampaign(org.id, campaignId);
      if (!campaign) return Errors.notFound(res, "Campaign");

      const variants = await db
        .select()
        .from(campaignVariants)
        .where(eq(campaignVariants.campaignId, campaignId));

      // Enrich each variant with computed rate stats
      const enriched = variants.map((v) => {
        const sent = v.sentCount ?? 0;
        return {
          ...v,
          openRate: sent > 0 ? Number(((v.openCount ?? 0) / sent * 100).toFixed(2)) : 0,
          clickRate: sent > 0 ? Number(((v.clickCount ?? 0) / sent * 100).toFixed(2)) : 0,
          responseRate: sent > 0 ? Number(((v.responseCount ?? 0) / sent * 100).toFixed(2)) : 0,
        };
      });

      res.json(enriched);
    } catch (err: any) {
      Errors.internal(res, err instanceof Error ? err : new Error(err.message));
    }
  });

  // POST /api/campaigns/:id/variants/:variantId/declare-winner
  // Marks a variant as winner; requires >10% better response rate than others AND >50 sends
  api.post("/api/campaigns/:id/variants/:variantId/declare-winner", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const campaignId = Number(req.params.id);
      const variantId = Number(req.params.variantId);

      const campaign = await storage.getCampaign(org.id, campaignId);
      if (!campaign) return Errors.notFound(res, "Campaign");

      const variants = await db
        .select()
        .from(campaignVariants)
        .where(eq(campaignVariants.campaignId, campaignId));

      const winner = variants.find((v) => v.id === variantId);
      if (!winner) return Errors.notFound(res, "Variant");

      const winnerSent = winner.sentCount ?? 0;
      if (winnerSent < 50) {
        return Errors.badRequest(res, "Winner must have at least 50 sends before declaring winner.", {
          error: "Not enough data",
          message: "Winner must have at least 50 sends before declaring winner.",
          significant: false,
        });
      }

      const winnerRate = winnerSent > 0 ? (winner.responseCount ?? 0) / winnerSent : 0;
      const others = variants.filter((v) => v.id !== variantId);

      // Check >10% better response rate than ALL other variants
      for (const other of others) {
        const otherSent = other.sentCount ?? 0;
        const otherRate = otherSent > 0 ? (other.responseCount ?? 0) / otherSent : 0;
        if (winnerRate <= otherRate * 1.10) {
          return Errors.badRequest(res, "Winner must have >10% better response rate than all other variants.", {
            significant: false,
            winnerRate: Number((winnerRate * 100).toFixed(2)),
            comparedRate: Number((otherRate * 100).toFixed(2)),
          });
        }
      }

      // Mark winner, clear other winners
      await db
        .update(campaignVariants)
        .set({ isWinner: false })
        .where(eq(campaignVariants.campaignId, campaignId));

      const [updated] = await db
        .update(campaignVariants)
        .set({ isWinner: true })
        .where(eq(campaignVariants.id, variantId))
        .returning();

      res.json({
        success: true,
        significant: true,
        winner: updated,
        winnerResponseRate: Number((winnerRate * 100).toFixed(2)),
      });
    } catch (err: any) {
      Errors.internal(res, err instanceof Error ? err : new Error(err.message));
    }
  });

  // GET /api/campaigns/:id/ab-analysis — returns which variant is winning, confidence, recommendation
  api.get("/api/campaigns/:id/ab-analysis", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const campaignId = Number(req.params.id);

      const campaign = await storage.getCampaign(org.id, campaignId);
      if (!campaign) return Errors.notFound(res, "Campaign");

      const variants = await db
        .select()
        .from(campaignVariants)
        .where(eq(campaignVariants.campaignId, campaignId));

      if (variants.length === 0) {
        return res.json({
          hasVariants: false,
          message: "No variants exist for this campaign. Add a Variant B to start A/B testing.",
          recommendation: null,
        });
      }

      const enriched = variants.map((v) => {
        const sent = v.sentCount ?? 0;
        const responseRate = sent > 0 ? (v.responseCount ?? 0) / sent : 0;
        return { ...v, responseRate, sent };
      });

      // Sort by response rate descending
      enriched.sort((a, b) => b.responseRate - a.responseRate);
      const top = enriched[0];
      const minSends = Math.min(...enriched.map((v) => v.sent));
      const hasEnoughData = minSends >= 50;

      // Significant if top variant is >10% better than all others AND each has >50 sends
      let isSignificant = false;
      if (hasEnoughData && enriched.length >= 2) {
        const second = enriched[1];
        isSignificant = top.responseRate > second.responseRate * 1.10;
      }

      const confidenceLabel = !hasEnoughData
        ? "Insufficient data (need 50+ sends per variant)"
        : isSignificant
        ? "Statistically significant (>10% lift with 50+ sends)"
        : "Not yet significant";

      res.json({
        hasVariants: true,
        variants: enriched.map((v) => ({
          ...v,
          responseRatePct: Number((v.responseRate * 100).toFixed(2)),
        })),
        leadingVariant: {
          id: top.id,
          name: top.name,
          responseRatePct: Number((top.responseRate * 100).toFixed(2)),
        },
        isSignificant,
        confidenceLabel,
        hasEnoughData,
        recommendation: isSignificant
          ? `Declare "${top.name}" as winner — it has a ${Number((top.responseRate * 100).toFixed(2))}% response rate.`
          : hasEnoughData
          ? `"${top.name}" is leading but the difference is not yet statistically significant. Continue sending.`
          : `Not enough data yet. Each variant needs at least 50 sends (current minimum: ${minSends}).`,
      });
    } catch (err: any) {
      Errors.internal(res, err instanceof Error ? err : new Error(err.message));
    }
  });

  // POST /api/campaigns/:id/test-send — send a single test email to the current user
  api.post("/api/campaigns/:id/test-send", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user as any;
      const campaign = await storage.getCampaign(org.id, Number(req.params.id));
      if (!campaign) return Errors.notFound(res, "Campaign");

      const userEmail = user.email || user?.email;
      if (!userEmail) {
        return Errors.badRequest(res, "No email address found for current user");
      }

      const { emailService } = await import("./services/emailService");

      const subject = `[TEST] ${campaign.name || "Campaign"}`;
      // Same source as the real send. A test that renders a placeholder instead
      // of the campaign's actual content cannot tell the operator what their
      // recipients will see, which is the only thing a test send is for.
      const testBody = (campaign.content ?? "").trim();
      if (!testBody) {
        return Errors.badRequest(
          res,
          "This campaign has no content yet, so a test send would show you a placeholder " +
            "rather than your message. Add the content and try again.",
          { campaignId: campaign.id },
        );
      }
      const html = /<[a-z][\s\S]*>/i.test(testBody) ? testBody : `<p>${testBody}</p>`;
      const text = testBody;

      const result = await emailService.sendEmail({
        to: userEmail,
        subject,
        html,
        text,
        organizationId: org.id,
      });

      res.json({ success: true, to: userEmail, result });
    } catch (err: any) {
      Errors.internal(res, err instanceof Error ? err : new Error(err.message || "Test send failed"));
    }
  });

  // POST /api/campaigns/:id/send-email — send email campaign to selected leads
  // DEFECT-0047: Upfront atomic credit deduction + per-recipient dedup
  api.post("/api/campaigns/:id/send-email", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const campaignId = parseInt(req.params.id);
      const { leadIds } = req.body as { leadIds: number[] };

      if (!leadIds || leadIds.length === 0) {
        return Errors.badRequest(res, "No recipients specified");
      }

      const campaign = await storage.getCampaign(org.id, campaignId);
      if (!campaign) return Errors.notFound(res, "Campaign");
      if (campaign.type !== "email") {
        return Errors.badRequest(res, "Campaign is not an email campaign");
      }

      // Get leads with email addresses
      const allLeads = await Promise.all(
        leadIds.map(id => storage.getLead(org.id, id))
      );
      const validLeads = allLeads.filter(l => l && l.email);

      if (validLeads.length === 0) {
        return Errors.badRequest(res, "No recipients with valid email addresses");
      }

      // DEFECT-0047: Per-recipient dedup — check which leads already received
      // this campaign (via campaign_delivery_events) and skip them
      const existingDeliveries = await db
        .select({ leadId: campaignDeliveryEvents.leadId })
        .from(campaignDeliveryEvents)
        .where(
          and(
            eq(campaignDeliveryEvents.campaignId, campaignId),
            eq(campaignDeliveryEvents.channel, "email")
          )
        );
      const alreadySentLeadIds = new Set(existingDeliveries.map(d => d.leadId));
      const dedupedLeads = validLeads.filter(l => !alreadySentLeadIds.has(l!.id));
      const skippedDuplicates = validLeads.length - dedupedLeads.length;

      if (dedupedLeads.length === 0) {
        return Errors.badRequest(res, "All recipients have already been sent this campaign");
      }

      // DEFECT-0047: Deduct credits UPFRONT atomically to prevent TOCTOU race.
      // deductCredits uses WHERE balance >= amount, so it's atomic check+deduct.
      const costPerEmail = 1; // 1 cent per email
      const totalCost = dedupedLeads.length * costPerEmail;

      if (!req.isFounder) {
        const deductResult = await creditService.deductCredits(
          org.id, totalCost, `Campaign email send: ${campaign.name} (${dedupedLeads.length} recipients)`
        );
        if (!deductResult) {
          return Errors.limitExceeded(res, { needed: totalCost, action: "email_send" }, { docsSlug: "limit-email-credits" });
        }
      }

      const { emailService } = await import("./services/emailService");

      // No platform-branded fallback on the counterparty lane. This read
      // `|| "Message from AcreOS"`, and the send below is `purpose: 'counterparty'`
      // in a per-lead loop — so a campaign with no subject and no name put
      // AcreOS's name in the subject line of every email a customer sent to
      // their own leads. Same shape as the communications.ts default fixed
      // alongside it, on the higher-volume surface.
      //
      // Refuse rather than invent: a campaign with nothing to put in a subject
      // line is not a campaign AcreOS should complete on the customer's behalf
      // under a name that is not theirs.
      // `subject` IS a real column of campaigns; the cast was spurious. Removed
      // 2026-08-21 — an unnecessary `as any` is how the four ghost content
      // fields beside it went unnoticed, so they do not get to stay for tidiness.
      // Falling back to the campaign's name for a SUBJECT is legitimate (it is a
      // title); falling back to it for the BODY is what shipped a defect.
      const subject = (campaign.subject || campaign.name || "").trim();
      if (!subject) {
        return Errors.badRequest(
          res,
          "This campaign has no subject and no name, so there is nothing to put in the " +
            "subject line. AcreOS will not substitute its own name on mail you are sending " +
            "to your leads — add a subject to the campaign and send again.",
          { campaignId: campaign.id },
        );
      }
      // `campaigns.content` is the column the customer's composed body lives in —
      // the direct-mail path in this same file reads it (see the letter/postcard
      // send above). The email and SMS paths reached past it for
      // `templateContent`, `htmlContent`, `textContent` and `smsBody`, NONE of
      // which are columns of `campaigns`. Every one resolved to `undefined`, so
      // the chain fell through to `campaign.name` and every recipient of every
      // email and SMS campaign received the campaign's INTERNAL NAME instead of
      // the message the customer wrote. Found 2026-08-21 by the ghost-field
      // sweep (ledger 64).
      const body = (campaign.content ?? "").trim();
      if (!body) {
        return Errors.badRequest(
          res,
          "This campaign has no content, so there is nothing to send. AcreOS will not " +
            "substitute the campaign's name as the message body — add the email content " +
            "to the campaign and send again.",
          { campaignId: campaign.id },
        );
      }
      // Already-HTML bodies pass through; a plain-text body is wrapped once.
      const htmlTemplate = /<[a-z][\s\S]*>/i.test(body) ? body : `<p>${body}</p>`;

      // Send emails with rate limiting. Track in-memory to catch any
      // within-execution duplicates (e.g. duplicate leadIds in input).
      const sentInExecution = new Set<number>();
      const results = { sent: 0, failed: 0, errors: [] as string[] };

      for (const lead of dedupedLeads) {
        // In-memory dedup for this execution
        if (sentInExecution.has(lead!.id)) continue;

        try {
          // Simple template variable replacement
          let html = htmlTemplate
            .replace(/\{\{firstName\}\}/g, lead!.firstName || "")
            .replace(/\{\{lastName\}\}/g, lead!.lastName || "")
            .replace(/\{\{email\}\}/g, lead!.email || "")
            .replace(/\{\{county\}\}/g, (lead as any).county || "")
            .replace(/\{\{state\}\}/g, (lead as any).state || "");

          await emailService.sendEmail({
            to: lead!.email!,
            subject,
            html,
            organizationId: org.id,
            isCampaignEmail: true,
            // Deal mail: campaign send to a customer's lead — org identity required.
            purpose: 'counterparty',
          });
          results.sent++;
          sentInExecution.add(lead!.id);

          // Record delivery event for future dedup
          await db.insert(campaignDeliveryEvents).values({
            campaignId,
            leadId: lead!.id,
            channel: "email",
            status: "sent",
          });
        } catch (err: any) {
          results.failed++;
          results.errors.push(`${lead!.email}: ${err.message}`);
        }

        // Rate limit: 5 emails per second
        if (results.sent % 5 === 0) {
          await new Promise(r => setTimeout(r, 200));
        }
      }

      // DEFECT-0047: Refund credits for failed sends
      if (!req.isFounder && results.failed > 0) {
        const refundAmount = results.failed * costPerEmail;
        await creditService.addCredits(
          org.id, refundAmount, "refund",
          `Refund for ${results.failed} failed email(s) in campaign: ${campaign.name}`
        );
        logger.info(`[campaigns] Refunded ${refundAmount}¢ for ${results.failed} failed email sends in campaign ${campaignId}`);
      }

      // Update campaign stats. Note: the campaigns table has no sentCount
      // column (sent_count lives on campaign_variants), so only status is set
      // — matching prior runtime behavior where the sentCount spread was a no-op.
      await storage.updateCampaign(campaignId, {
        status: "sent",
      }, org.id);

      // Lenore §1 — value-event telemetry. First mailer sent via email
      // channel (distinct from first_letter_sent which is postcard).
      // Only counts if at least one recipient succeeded. Idempotent.
      if (results.sent > 0) {
        try {
          const { recordActivationEventAsync } = await import("./services/activation");
          recordActivationEventAsync({
            orgId: org.id,
            userId: (req as AuthenticatedRequest).user?.id ?? null,
            eventName: "first_mailer_sent",
            eventValue: { campaignId, channel: "email", recipients: results.sent },
          });
        } catch { /* non-fatal */ }
      }

      res.json({
        success: true,
        sent: results.sent,
        failed: results.failed,
        skippedDuplicates,
        total: validLeads.length,
        errors: results.errors.slice(0, 10),
      });
    } catch (err: any) {
      Errors.internal(res, err instanceof Error ? err : new Error(err.message || "Email send failed"));
    }
  });

  // POST /api/campaigns/:id/send-sms — send SMS campaign to selected leads
  // DEFECT-0047: Upfront atomic credit deduction + per-recipient dedup
  // TCPA: idempotencyMiddleware prevents replay-based double-send (a
  // single Twilio call costs ~$0.008 + ledger debit + a $1500 statutory
  // violation if the second send happens after a STOP was processed
  // between attempts). Lens 14 flagged the missing middleware.
  api.post("/api/campaigns/:id/send-sms", isAuthenticated, getOrCreateOrg, idempotencyMiddleware, async (req, res) => {
    try {
      const org = req.organization;
      const campaignId = parseInt(req.params.id);
      const { leadIds } = req.body as { leadIds: number[] };

      if (!leadIds || leadIds.length === 0) {
        return Errors.badRequest(res, "No recipients specified");
      }

      const campaign = await storage.getCampaign(org.id, campaignId);
      if (!campaign) return Errors.notFound(res, "Campaign");

      // Get leads with phone numbers
      const allLeads = await Promise.all(
        leadIds.map(id => storage.getLead(org.id, id))
      );
      const validLeads = allLeads.filter(l => l && l.phone);

      if (validLeads.length === 0) {
        return Errors.badRequest(res, "No recipients with valid phone numbers");
      }

      // ── TCPA CONSENT GATE (mandatory pre-filter) ────────────────────────
      // Drop any lead missing express written consent, marked DNC, or who
      // ever sent a STOP keyword. Each blocked send carries $500-$1500 in
      // statutory damages — this filter is the difference between a
      // routine batch and a class-action exhibit. Per-channel check uses
      // canSendViaChannel() which respects doNotContact + tcpaConsent.
      const { canSendViaChannel, isWithinQuietHoursForLead } = await import("./services/tcpaCompliance");
      const tcpaBlocked: Array<{ leadId: number; phone: string; reason: string }> = [];
      const quietHoursBlocked: Array<{ leadId: number; phone: string; reason: string }> = [];
      const tcpaCleared = validLeads.filter((l) => {
        const check = canSendViaChannel(l!, "sms");
        if (!check.allowed) {
          tcpaBlocked.push({ leadId: l!.id, phone: l!.phone || "", reason: check.reason || "TCPA blocked" });
          return false;
        }
        return true;
      });
      // Per-recipient quiet-hours check — uses lead.timezone if set,
      // otherwise area-code inference (see tcpaCompliance.ts header).
      // Area-code is NOT a legally reliable signal — every batch send
      // should prompt the user to add `timezone` to imported leads.
      const recipientReady = tcpaCleared.filter((l) => {
        const qh = isWithinQuietHoursForLead(l! as any);
        if (qh.blocked) {
          quietHoursBlocked.push({ leadId: l!.id, phone: l!.phone || "", reason: qh.reason || "Quiet hours" });
          return false;
        }
        return true;
      });

      if (recipientReady.length === 0) {
        return Errors.badRequest(
          res,
          `No recipients eligible. TCPA-blocked: ${tcpaBlocked.length}. Quiet-hours blocked: ${quietHoursBlocked.length}.`,
          { tcpaBlocked, quietHoursBlocked }
        );
      }

      // DEFECT-0047: Per-recipient dedup — check which leads already received
      // this campaign via SMS and skip them
      const existingDeliveries = await db
        .select({ leadId: campaignDeliveryEvents.leadId })
        .from(campaignDeliveryEvents)
        .where(
          and(
            eq(campaignDeliveryEvents.campaignId, campaignId),
            eq(campaignDeliveryEvents.channel, "sms")
          )
        );
      const alreadySentLeadIds = new Set(existingDeliveries.map(d => d.leadId));
      const dedupedLeads = recipientReady.filter(l => !alreadySentLeadIds.has(l!.id));
      const skippedDuplicates = recipientReady.length - dedupedLeads.length;

      if (dedupedLeads.length === 0) {
        return Errors.badRequest(res, "All TCPA-eligible recipients have already been sent this campaign via SMS");
      }

      // DEFECT-0047: Deduct credits UPFRONT atomically to prevent TOCTOU race.
      // MMS costs more than SMS (carrier surcharges + Twilio media hosting),
      // so charge per-recipient by whether the campaign has any media URLs.
      const costPerSms = 3; // 3 cents per SMS
      const costPerMms = 5; // 5 cents per MMS — per spec
      const campaignMediaUrls = (campaign as any).mediaUrls as string[] | null | undefined;
      const hasMms = !!(campaignMediaUrls && campaignMediaUrls.length > 0);
      const perRecipientCost = hasMms ? costPerMms : costPerSms;
      const totalCost = dedupedLeads.length * perRecipientCost;

      if (!req.isFounder) {
        const deductResult = await creditService.deductCredits(
          org.id, totalCost, `Campaign SMS send: ${campaign.name} (${dedupedLeads.length} recipients)`
        );
        if (!deductResult) {
          return Errors.limitExceeded(res, { needed: totalCost, action: "sms_send" }, { docsSlug: "limit-sms-credits" });
        }
      }

      // Audit F-21-1/F-21-2: campaign SMS now sends through sendOrgSMS →
      // commsRouter, which runs the Searchbug DNC/litigator scrub, quiet hours,
      // consent and the contact-frequency cap — the raw Twilio call bypassed
      // every one. TWILIO_PHONE_NUMBER is read only to label simulated sends.
      const twilioPhone = process.env.TWILIO_PHONE_NUMBER ?? "byo";

      // `campaigns.content` is the column the customer's composed body lives in —
      // the direct-mail path in this same file reads it (see the letter/postcard
      // send above). The email and SMS paths reached past it for
      // `templateContent`, `htmlContent`, `textContent` and `smsBody`, NONE of
      // which are columns of `campaigns`. Every one resolved to `undefined`, so
      // the chain fell through to `campaign.name` and every recipient of every
      // email and SMS campaign received the campaign's INTERNAL NAME instead of
      // the message the customer wrote. Found 2026-08-21 by the ghost-field
      // sweep (ledger 64).
      const messageBody = (campaign.content ?? "").trim();
      if (!messageBody) {
        return Errors.badRequest(
          res,
          "This campaign has no content, so there is nothing to text. AcreOS will not " +
            "substitute the campaign's name as the message body — add the SMS content to " +
            "the campaign and send again.",
          { campaignId: campaign.id },
        );
      }

      // Send SMS messages with in-memory dedup for this execution
      const sentInExecution = new Set<number>();
      const results = { sent: 0, failed: 0, errors: [] as string[] };
      // Honor SIMULATION_MODE / org.settings.simulationMode — a global
      // kill-switch must hold on the campaign batch path too (caught 2026-05-10).
      const simulated = shouldSimulate("sms", org);

      // "Be the rail, not the provider" (founder ruling 2026-07-29): campaign
      // SMS is COUNTERPARTY traffic and must run on the org's OWN connected
      // (BYO) Twilio identity. The comms router falls back to the platform
      // TWILIO_* account when no BYO is connected (that account is system-mail
      // only) — so refuse the whole batch here rather than send counterparty
      // texts on AcreOS's account. Refund the upfront deduct; no send happens.
      if (!simulated && !(await orgHasConnectedSmsIdentity(org.id))) {
        if (!req.isFounder) {
          await creditService.addCredits(
            org.id, totalCost, "refund",
            `Refund: campaign ${campaign.name} not sent — no connected SMS identity`,
          );
        }
        return Errors.badRequest(
          res,
          "Connect your own Twilio/SMS number before sending campaign texts — AcreOS does not send counterparty SMS on the platform account.",
          { reason: "no_byo_sms_identity" },
        );
      }

      for (const lead of dedupedLeads) {
        // In-memory dedup for this execution
        if (sentInExecution.has(lead!.id)) continue;

        try {
          let body = messageBody
            .replace(/\{\{firstName\}\}/g, lead!.firstName || "")
            .replace(/\{\{lastName\}\}/g, lead!.lastName || "")
            .replace(/\{\{county\}\}/g, (lead as any).county || "");

          if (simulated) {
            await recordSimulatedAction(
              "sms",
              "campaign_batch_send",
              {
                to: lead!.phone,
                from: twilioPhone,
                body,
                campaignId,
                leadId: lead!.id,
                mediaUrls: hasMms ? campaignMediaUrls : undefined,
              },
              org
            );
          } else {
            // Real send through the gated choke point (DNC + frequency + BYO).
            const sendResult = await sendOrgSMS(
              org.id,
              lead!.phone!,
              body,
              hasMms ? campaignMediaUrls : undefined,
            );
            if (!sendResult.success) {
              // Not delivered (DNC/consent/quiet-hours block, or no connected
              // SMS identity). Count it as failed and let the SINGLE post-loop
              // batch refund below credit every failed recipient exactly once.
              // Do NOT also refund inline here — that double-refunded blocked
              // recipients (they are counted in results.failed AND were batch-
              // refunded), minting credits. Audit F-17-1 completeness pass.
              results.failed++;
              results.errors.push(`${lead!.phone}: ${sendResult.error ?? "send blocked"}`);
              continue;
            }
          }
          results.sent++;
          sentInExecution.add(lead!.id);

          // Record delivery event for future dedup. Its OWN try/catch: the SMS
          // already went out, so a failed dedup insert must NOT fall through to
          // the outer catch (which would results.failed++ a sent message and
          // then refund it — an under-charge). Adjacent hardening surfaced while
          // fixing the refund path (audit F-17-1 completeness pass).
          try {
            await db.insert(campaignDeliveryEvents).values({
              campaignId,
              leadId: lead!.id,
              channel: "sms",
              status: "sent",
            });
          } catch (insErr) {
            logger.warn(`[campaigns] delivery-event insert failed after a sent SMS (lead ${lead!.id}, campaign ${campaignId}): ${String(insErr)}`);
          }
        } catch (err: any) {
          results.failed++;
          results.errors.push(`${lead!.phone}: ${err.message}`);
        }

        // Rate limit: 1 SMS per second (Twilio limit)
        await new Promise(r => setTimeout(r, 1000));
      }

      // DEFECT-0047: Refund credits for failed sends — use the same
      // per-recipient cost we deducted upfront (MMS or SMS).
      if (!req.isFounder && results.failed > 0) {
        const refundAmount = results.failed * perRecipientCost;
        await creditService.addCredits(
          org.id, refundAmount, "refund",
          `Refund for ${results.failed} failed ${hasMms ? "MMS" : "SMS"}(es) in campaign: ${campaign.name}`
        );
        logger.info(`[campaigns] Refunded ${refundAmount}¢ for ${results.failed} failed ${hasMms ? "MMS" : "SMS"} sends in campaign ${campaignId}`);
      }

      // Update campaign stats
      await storage.updateCampaign(campaignId, {
        status: "sent",
      }, org.id);

      // Lenore §1 — value-event telemetry. First mailer sent via SMS
      // channel. Same canonical event as email; the (orgId, eventName)
      // uniqueness in activation_events prevents double-fire across
      // channels — whichever fires first wins.
      if (results.sent > 0) {
        try {
          const { recordActivationEventAsync } = await import("./services/activation");
          recordActivationEventAsync({
            orgId: org.id,
            userId: (req as AuthenticatedRequest).user?.id ?? null,
            eventName: "first_mailer_sent",
            eventValue: { campaignId, channel: "sms", recipients: results.sent },
          });
        } catch { /* non-fatal */ }
      }

      res.json({
        success: true,
        sent: results.sent,
        failed: results.failed,
        skippedDuplicates,
        tcpaBlocked: tcpaBlocked.length,
        quietHoursBlocked: quietHoursBlocked.length,
        tcpaBlockedSamples: tcpaBlocked.slice(0, 5),
        quietHoursBlockedSamples: quietHoursBlocked.slice(0, 5),
        total: validLeads.length,
        errors: results.errors.slice(0, 10),
      });
    } catch (err: any) {
      Errors.internal(res, err instanceof Error ? err : new Error(err.message || "SMS send failed"));
    }
  });


}

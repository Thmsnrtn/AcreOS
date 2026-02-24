import type { Express } from "express";
import { z } from "zod";
import {
  insertCampaignSchema, insertCampaignResponseSchema,
  insertCampaignSequenceSchema, insertSequenceStepSchema, insertSequenceEnrollmentSchema,
  insertAbTestSchema, insertAbTestVariantSchema,
} from "@shared/schema";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { requirePermission } from "./utils/permissions";
import { checkUsageLimit } from "./services/usageLimits";
import { usageMeteringService, creditService } from "./services/credits";
import { createRateLimiter, RATE_LIMIT_CONFIGS } from "./middleware/rateLimit";
import { storage, db } from "./storage";
import { eq, sql } from "drizzle-orm";
import { leads, deals, properties } from "@shared/schema";

export function registerCampaignRoutes(app: Express): void {
  const api = app;

  // CAMPAIGNS (Marketing)
  // ============================================
  
  api.get("/api/campaigns", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const campaigns = await storage.getCampaigns(org.id);
    res.json(campaigns);
  });
  
  api.get("/api/campaigns/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const campaign = await storage.getCampaign(org.id, Number(req.params.id));
    if (!campaign) return res.status(404).json({ message: "Campaign not found" });
    res.json(campaign);
  });
  
  api.post("/api/campaigns", isAuthenticated, getOrCreateOrg, requirePermission("canCreateCampaign"), async (req, res) => {
    try {
      const org = (req as any).organization;
      const trackingCode = storage.generateTrackingCode();
      const input = insertCampaignSchema.parse({ 
        ...req.body, 
        organizationId: org.id,
        trackingCode 
      });
      const campaign = await storage.createCampaign(input);
      
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
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
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  // Get responses for a specific campaign
  api.get("/api/campaigns/:id/responses", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const campaignId = Number(req.params.id);
    const campaign = await storage.getCampaign(org.id, campaignId);
    if (!campaign) return res.status(404).json({ message: "Campaign not found" });
    
    const responses = await storage.getCampaignResponses(org.id, campaignId);
    res.json(responses);
  });

  // Get campaign analytics with response data
  api.get("/api/campaigns/:id/analytics", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const campaignId = Number(req.params.id);
    const campaign = await storage.getCampaign(org.id, campaignId);
    if (!campaign) return res.status(404).json({ message: "Campaign not found" });
    
    const responsesCount = await storage.getCampaignResponsesCount(campaignId);
    const responses = await storage.getCampaignResponses(org.id, campaignId);
    
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
    });
  });

  // ============================================
  // CAMPAIGN RESPONSES (Inbound Response Tracking)
  // ============================================

  // Get all responses for the organization
  api.get("/api/responses", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const responses = await storage.getCampaignResponses(org.id);
    res.json(responses);
  });

  // Log a new response (auto-attributes to campaign if tracking code matches)
  api.post("/api/responses", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { trackingCode, channel, content, leadId, contactName, contactEmail, contactPhone, metadata } = req.body;
      
      let campaignId: number | undefined;
      let isAttributed = false;
      
      if (trackingCode) {
        const campaign = await storage.getCampaignByTrackingCode(trackingCode);
        if (campaign && campaign.organizationId === org.id) {
          campaignId = campaign.id;
          isAttributed = true;
          
          await storage.updateCampaign(campaign.id, {
            totalResponded: (campaign.totalResponded || 0) + 1
          });
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
        });
      }
      
      res.status(201).json(response);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  // Get a specific response
  api.get("/api/responses/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const response = await storage.getCampaignResponse(Number(req.params.id));
    if (!response) return res.status(404).json({ message: "Response not found" });
    res.json(response);
  });

  // Update a response
  api.put("/api/responses/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const response = await storage.updateCampaignResponse(Number(req.params.id), req.body);
    if (!response) return res.status(404).json({ message: "Response not found" });
    res.json(response);
  });

  // Delete a response
  api.delete("/api/responses/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    await storage.deleteCampaignResponse(Number(req.params.id));
    res.status(204).send();
  });

  // ============================================
  // TARGET COUNTIES (Acquisition Workflow)
  // ============================================

  // Get all target counties for the organization
  api.get("/api/target-counties", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const counties = await storage.getTargetCounties(org.id);
    res.json(counties);
  });

  // Get a specific target county
  api.get("/api/target-counties/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const county = await storage.getTargetCounty(org.id, Number(req.params.id));
    if (!county) return res.status(404).json({ message: "Target county not found" });
    res.json(county);
  });

  // Create a new target county
  api.post("/api/target-counties", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { insertTargetCountySchema } = await import("@shared/schema");
      const input = insertTargetCountySchema.parse({
        ...req.body,
        organizationId: org.id,
      });
      const county = await storage.createTargetCounty(input);
      res.status(201).json(county);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  // Update a target county
  api.put("/api/target-counties/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const county = await storage.getTargetCounty(org.id, Number(req.params.id));
    if (!county) return res.status(404).json({ message: "Target county not found" });
    
    const updated = await storage.updateTargetCounty(county.id, req.body);
    res.json(updated);
  });

  // Delete a target county
  api.delete("/api/target-counties/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const county = await storage.getTargetCounty(org.id, Number(req.params.id));
    if (!county) return res.status(404).json({ message: "Target county not found" });
    
    await storage.deleteTargetCounty(county.id);
    res.status(204).send();
  });

  // ============================================
  // CAMPAIGN SEQUENCES (Drip Campaign Automation)
  // ============================================

  // Get all sequences for the organization
  api.get("/api/sequences", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const sequences = await storage.getSequences(org.id);
    res.json(sequences);
  });

  // Get sequence stats (enrollment counts)
  api.get("/api/sequences/stats", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const stats = await storage.getSequenceStats(org.id);
    res.json(stats);
  });

  // Get a specific sequence with its steps
  api.get("/api/sequences/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const sequence = await storage.getSequence(org.id, Number(req.params.id));
    if (!sequence) return res.status(404).json({ message: "Sequence not found" });
    
    const steps = await storage.getSequenceSteps(sequence.id);
    res.json({ ...sequence, steps });
  });

  // Create a new sequence
  api.post("/api/sequences", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const input = insertCampaignSequenceSchema.parse({
        ...req.body,
        organizationId: org.id,
      });
      const sequence = await storage.createSequence(input);
      res.status(201).json(sequence);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  // Update a sequence
  api.put("/api/sequences/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const sequence = await storage.getSequence(org.id, Number(req.params.id));
    if (!sequence) return res.status(404).json({ message: "Sequence not found" });
    
    const updated = await storage.updateSequence(sequence.id, req.body);
    res.json(updated);
  });

  // Delete a sequence
  api.delete("/api/sequences/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const sequence = await storage.getSequence(org.id, Number(req.params.id));
    if (!sequence) return res.status(404).json({ message: "Sequence not found" });
    
    await storage.deleteSequence(sequence.id);
    res.status(204).send();
  });

  // ============================================
  // SEQUENCE STEPS
  // ============================================

  // Get steps for a sequence
  api.get("/api/sequences/:id/steps", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const sequence = await storage.getSequence(org.id, Number(req.params.id));
    if (!sequence) return res.status(404).json({ message: "Sequence not found" });
    
    const steps = await storage.getSequenceSteps(sequence.id);
    res.json(steps);
  });

  // Add a step to a sequence
  api.post("/api/sequences/:id/steps", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const sequence = await storage.getSequence(org.id, Number(req.params.id));
      if (!sequence) return res.status(404).json({ message: "Sequence not found" });
      
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
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  // Update a step
  api.put("/api/sequences/:id/steps/:stepId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const sequence = await storage.getSequence(org.id, Number(req.params.id));
    if (!sequence) return res.status(404).json({ message: "Sequence not found" });
    
    const step = await storage.updateSequenceStep(Number(req.params.stepId), req.body);
    res.json(step);
  });

  // Delete a step
  api.delete("/api/sequences/:id/steps/:stepId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const sequence = await storage.getSequence(org.id, Number(req.params.id));
    if (!sequence) return res.status(404).json({ message: "Sequence not found" });
    
    await storage.deleteSequenceStep(Number(req.params.stepId));
    res.status(204).send();
  });

  // Reorder steps
  api.put("/api/sequences/:id/steps/reorder", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const sequence = await storage.getSequence(org.id, Number(req.params.id));
    if (!sequence) return res.status(404).json({ message: "Sequence not found" });
    
    const { stepIds } = req.body as { stepIds: number[] };
    await storage.reorderSequenceSteps(sequence.id, stepIds);
    
    const steps = await storage.getSequenceSteps(sequence.id);
    res.json(steps);
  });

  // ============================================
  // SEQUENCE ENROLLMENTS
  // ============================================

  // Get enrollments for a sequence
  api.get("/api/sequences/:id/enrollments", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const sequence = await storage.getSequence(org.id, Number(req.params.id));
    if (!sequence) return res.status(404).json({ message: "Sequence not found" });
    
    const enrollments = await storage.getSequenceEnrollments(sequence.id);
    res.json(enrollments);
  });

  // Get all active enrollments
  api.get("/api/enrollments/active", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const enrollments = await storage.getActiveEnrollments(org.id);
    res.json(enrollments);
  });

  // Enroll a lead in a sequence
  api.post("/api/sequences/:id/enroll", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const sequence = await storage.getSequence(org.id, Number(req.params.id));
      if (!sequence) return res.status(404).json({ message: "Sequence not found" });
      
      const { leadId } = req.body;
      const lead = await storage.getLead(org.id, leadId);
      if (!lead) return res.status(404).json({ message: "Lead not found" });
      
      // Check if lead is already enrolled in this sequence
      const existingEnrollments = await storage.getLeadEnrollments(leadId);
      const alreadyEnrolled = existingEnrollments.find(
        e => e.sequenceId === sequence.id && e.status === "active"
      );
      if (alreadyEnrolled) {
        return res.status(400).json({ message: "Lead is already enrolled in this sequence" });
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
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  // Pause an enrollment
  api.post("/api/enrollments/:id/pause", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const { reason } = req.body;
    const enrollment = await storage.pauseEnrollment(Number(req.params.id), reason || "Manually paused");
    res.json(enrollment);
  });

  // Resume an enrollment
  api.post("/api/enrollments/:id/resume", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const enrollment = await storage.resumeEnrollment(Number(req.params.id));
    res.json(enrollment);
  });

  // Cancel an enrollment
  api.post("/api/enrollments/:id/cancel", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const enrollment = await storage.cancelEnrollment(Number(req.params.id));
    res.json(enrollment);
  });

  // Get lead's enrollments
  api.get("/api/leads/:id/enrollments", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const lead = await storage.getLead(org.id, Number(req.params.id));
    if (!lead) return res.status(404).json({ message: "Lead not found" });
    
    const enrollments = await storage.getLeadEnrollments(lead.id);
    res.json(enrollments);
  });
  
  api.put("/api/campaigns/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const campaign = await storage.updateCampaign(Number(req.params.id), req.body);
    if (!campaign) return res.status(404).json({ message: "Campaign not found" });
    res.json(campaign);
  });
  
  // Send direct mail campaign with credit pre-checks
  api.post("/api/campaigns/:id/send-direct-mail", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const campaignId = parseInt(req.params.id);
      const { pieceType, leadIds } = req.body as { 
        pieceType: 'postcard_4x6' | 'postcard_6x9' | 'postcard_6x11' | 'letter_1_page';
        leadIds: number[];
      };

      const { directMailService, DIRECT_MAIL_COSTS } = await import("./services/directMail");
      
      // Check if org has their own Lob credentials (BYOK) - if so, skip credit check
      const usingOrgLobCredentials = await directMailService.hasOrgLobCredentials(org.id);
      
      if (!usingOrgLobCredentials && !directMailService.isAvailable()) {
        return res.status(503).json({ error: "Direct mail service not configured. Please add LOB_API_KEY or configure your own Lob API key in Integrations." });
      }

      const campaign = await storage.getCampaign(org.id, campaignId);
      if (!campaign || campaign.type !== 'direct_mail') {
        return res.status(400).json({ error: "Invalid campaign or not a direct mail campaign" });
      }

      if (!leadIds || leadIds.length === 0) {
        return res.status(400).json({ error: "No recipients specified" });
      }

      // Get the organization's default mail sender identity
      const mailSenderIdentity = await storage.getDefaultMailSenderIdentity(org.id);
      if (!mailSenderIdentity) {
        return res.status(400).json({ 
          error: "No return address configured. Please set up a mail sender identity in Mail Settings." 
        });
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
          return res.status(402).json({
            error: "Insufficient credits",
            required: totalCost / 100,
            balance: balance / 100,
            perPiece: costPerPiece / 100,
            recipientCount: leadIds.length,
          });
        }
      } else {
        console.log(`[DirectMailRoute] Skipping credit pre-check for org ${org.id} - using org Lob credentials`);
      }

      const leadsData = await Promise.all(
        leadIds.map(id => storage.getLead(org.id, id))
      );
      const validLeads = leadsData.filter(l => l && l.address && l.city && l.state && l.zip);

      if (validLeads.length === 0) {
        return res.status(400).json({ error: "No valid recipients with complete addresses" });
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
          return res.status(402).json({ error: "Insufficient credits" });
        }
      } else {
        console.log(`[DirectMailRoute] Skipping credit deduction for org ${org.id} - using org Lob credentials`);
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
            }, mailMode, org.id);
          }

          const expectedDeliveryDate = result.expected_delivery_date ? new Date(result.expected_delivery_date) : undefined;
          sendResults.push({ leadId: lead.id, success: true, lobId: result.id, expectedDeliveryDate, isTest: isTestMode });
          lobJobIds.push(result.id);

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
          });
          // Update with Lob-specific fields after creation
          await storage.updateMailingOrderPiece(piece.id, {
            lobMailId: result.id,
            lobUrl: result.url,
            expectedDeliveryDate,
          });
        } catch (err: any) {
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
        console.log(`[DirectMailRoute] Skipping usage recording for org ${org.id} - using org Lob credentials (BYOK)`);
      }

      await storage.updateCampaign(campaignId, {
        totalSent: (campaign.totalSent || 0) + successCount,
        status: 'active',
      });

      res.json({
        success: true,
        isTestMode,
        mailingOrderId: mailingOrder.id,
        piecesQueued: successCount,
        piecesFailed: failCount,
        totalCost: (costPerPiece * successCount) / 100,
        refunded: failCount > 0 ? (costPerPiece * failCount) / 100 : 0,
        message: isTestMode 
          ? `${successCount} test mail pieces queued (no actual mail sent)${failCount > 0 ? `, ${failCount} failed` : ''}`
          : `${successCount} mail pieces sent${failCount > 0 ? `, ${failCount} failed (refunded)` : ''}`,
        warning: identityWarning,
        details: sendResults,
      });
    } catch (error: any) {
      console.error("Direct mail send error:", error);
      res.status(500).json({ error: error.message || "Failed to send direct mail" });
    }
  });

  // Estimate cost for sending a campaign to selected recipients
  api.get("/api/campaigns/:id/estimate-cost", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
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
      res.status(500).json({ error: error.message });
    }
  });
  
  // ============================================
  // CAMPAIGN OPTIMIZATIONS
  // ============================================
  
  api.get("/api/campaigns/analytics", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { campaignOptimizerService } = await import("./services/campaignOptimizer");
      const analytics = await campaignOptimizerService.getCampaignAnalytics(org.id);
      res.json(analytics);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get campaign analytics" });
    }
  });
  
  api.get("/api/campaigns/:id/optimizations", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const campaignId = parseInt(req.params.id);
      
      const campaign = await storage.getCampaign(org.id, campaignId);
      if (!campaign) {
        return res.status(404).json({ error: "Campaign not found" });
      }
      
      const optimizations = await storage.getCampaignOptimizations(campaignId);
      res.json(optimizations);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get optimizations" });
    }
  });
  
  api.post("/api/campaigns/:id/optimize", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const campaignId = parseInt(req.params.id);
      
      const campaign = await storage.getCampaign(org.id, campaignId);
      if (!campaign) {
        return res.status(404).json({ error: "Campaign not found" });
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
      console.error("Campaign optimization error:", error);
      res.status(500).json({ error: error.message || "Failed to optimize campaign" });
    }
  });
  
  api.put("/api/optimizations/:id/implement", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const optimizationId = parseInt(req.params.id);
      const { resultDelta } = req.body;
      
      const updated = await storage.markOptimizationImplemented(optimizationId, resultDelta || null);
      if (!updated) {
        return res.status(404).json({ error: "Optimization not found" });
      }
      
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to mark optimization as implemented" });
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
    const org = (req as any).organization;
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
    const org = (req as any).organization;
    const { mode } = req.body;
    
    if (mode !== 'test' && mode !== 'live') {
      return res.status(400).json({ error: "Mode must be 'test' or 'live'" });
    }
    
    const { directMailService } = await import("./services/directMail");
    
    // Validate the mode is available
    if (mode === 'live' && !directMailService.hasLiveMode()) {
      return res.status(400).json({ error: "Live mode not available - no live API key configured" });
    }
    if (mode === 'test' && !directMailService.hasTestMode()) {
      return res.status(400).json({ error: "Test mode not available - no test API key configured" });
    }
    
    // Update organization settings
    const updatedSettings = { ...org.settings, mailMode: mode };
    const updated = await storage.updateOrganization(org.id, { settings: updatedSettings });
    
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
      const org = (req as any).organization;
      const { pieceType, recipientCount, recipientIds, campaignId } = req.body;
      
      const { directMailService, DIRECT_MAIL_COSTS } = await import("./services/directMail");
      
      if (!directMailService.isAvailable()) {
        return res.status(400).json({ error: "Direct mail service not configured" });
      }
      
      // Validate piece type
      if (!DIRECT_MAIL_COSTS[pieceType as keyof typeof DIRECT_MAIL_COSTS]) {
        return res.status(400).json({ error: "Invalid piece type" });
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
        return res.status(400).json({ error: "Must specify recipientCount, recipientIds, or campaignId" });
      }
      
      const currentMode = org.settings?.mailMode || 'test';
      const estimate = directMailService.estimateBatchCost(pieceType, count, currentMode);
      
      // Check if user has enough credits
      const creditBalance = parseFloat(org.creditBalance || '0');
      const hasEnoughCredits = creditBalance >= estimate.totalCost;
      
      res.json({
        ...estimate,
        currentMode,
        creditBalance,
        hasEnoughCredits,
        creditsNeeded: hasEnoughCredits ? 0 : estimate.totalCost - creditBalance,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to generate estimate" });
    }
  });
  
  // Verify a single address
  api.post("/api/direct-mail/verify-address", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { line1, line2, city, state, zip } = req.body;
      
      if (!line1 || !city || !state || !zip) {
        return res.status(400).json({ error: "Address fields (line1, city, state, zip) are required" });
      }
      
      const isProduction = process.env.NODE_ENV === 'production';
      const apiKey = isProduction 
        ? process.env.LOB_LIVE_API_KEY 
        : (process.env.LOB_TEST_API_KEY || process.env.LOB_LIVE_API_KEY);
      
      if (!apiKey) {
        return res.status(400).json({ error: "Address verification service not configured. Please add Lob API key in settings." });
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
      res.status(500).json({ error: error.message || "Failed to verify address" });
    }
  });
  
  // Bulk verify addresses for leads
  api.post("/api/direct-mail/bulk-verify-addresses", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { leadIds } = req.body;
      
      if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
        return res.status(400).json({ error: "leadIds array is required" });
      }
      
      if (leadIds.length > 100) {
        return res.status(400).json({ error: "Maximum 100 addresses can be verified at once" });
      }
      
      const isProduction = process.env.NODE_ENV === 'production';
      const apiKey = isProduction 
        ? process.env.LOB_LIVE_API_KEY 
        : (process.env.LOB_TEST_API_KEY || process.env.LOB_LIVE_API_KEY);
      
      if (!apiKey) {
        return res.status(400).json({ error: "Address verification service not configured. Please add Lob API key in settings." });
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
        
        if (!lead.mailingAddress || !lead.city || !lead.state || !lead.zipCode) {
          results.push({ leadId, isValid: false, deliverability: 'incomplete_address', errorMessage: 'Incomplete address information' });
          undeliverable++;
          continue;
        }
        
        try {
          const verificationResult = await verifyAddress({
            line1: lead.mailingAddress,
            line2: undefined,
            city: lead.city,
            state: lead.state,
            zip: lead.zipCode,
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
      res.status(500).json({ error: error.message || "Failed to verify addresses" });
    }
  });
  

}

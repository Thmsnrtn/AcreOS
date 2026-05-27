import type { Express } from "express";
import { storage, db } from "./storage";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { alertingService } from "./services/alerting";
import { usageMeteringService, creditService } from "./services/credits";
import { organizationIntegrations, callTranscripts } from "@shared/schema";
import { requireAdminOrAbove } from "./utils/permissions";
import { registerAIOperationsRoutes } from "./routes-ai-operations";
import { logger } from "./utils/logger";
import { Errors } from "./utils/errors";
import { verifyTwilioSignature } from "./middleware/twilioSignature";
import { idempotencyMiddleware } from "./middleware/idempotency";
import { withIdempotency } from "./services/webhook-idempotency";
import { poolDebit, refundPoolDebit } from "./services/creditPool";

export async function registerMiscRoutes(app: Express): Promise<void> {
  const api = app;

  // LEAD QUALIFICATION & ALERTS
  // ============================================

  const leadQualificationService = await import("./services/leadQualification");

  api.get("/api/alerts", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { priority, limit } = req.query;
      const alerts = await leadQualificationService.getPendingAlerts(org.id, {
        priority: priority as string,
        limit: limit ? parseInt(limit as string) : undefined,
      });
      res.json(alerts);
    } catch (error: any) {
      logger.error("Get alerts error", error);
      res.status(500).json({ message: error.message || "Failed to fetch alerts" });
    }
  });

  api.post("/api/alerts/:id/acknowledge", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const user = req.user;
      const id = parseInt(req.params.id);
      const { actionTaken } = req.body;
      await leadQualificationService.acknowledgeAlert(id, user.id, actionTaken);
      res.json({ success: true });
    } catch (error: any) {
      logger.error("Acknowledge alert error", error);
      res.status(400).json({ message: error.message || "Failed to acknowledge alert" });
    }
  });

  api.post("/api/alerts/:id/dismiss", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await leadQualificationService.dismissAlert(id);
      res.json({ success: true });
    } catch (error: any) {
      logger.error("Dismiss alert error", error);
      res.status(400).json({ message: error.message || "Failed to dismiss alert" });
    }
  });

  api.get("/api/leads/:id/intent-score", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const leadId = parseInt(req.params.id);
      const score = await leadQualificationService.calculateLeadIntentScore(org.id, leadId);
      res.json(score);
    } catch (error: any) {
      logger.error("Get lead intent score error", error);
      res.status(500).json({ message: error.message || "Failed to calculate intent score" });
    }
  });

  api.post("/api/leads/:id/analyze-message", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const leadId = parseInt(req.params.id);
      const { message, conversationId } = req.body;
      const signals = await leadQualificationService.analyzeMessageForSignals(
        org.id,
        leadId,
        conversationId,
        message
      );
      res.json(signals);
    } catch (error: any) {
      logger.error("Analyze message error", error);
      res.status(400).json({ message: error.message || "Failed to analyze message" });
    }
  });

  api.get("/api/leads/:id/suggested-response", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const leadId = parseInt(req.params.id);
      const { propertyId } = req.query;
      const response = await leadQualificationService.generateSuggestedResponse(
        org.id,
        leadId,
        propertyId ? parseInt(propertyId as string) : undefined
      );
      res.json({ response });
    } catch (error: any) {
      logger.error("Generate suggested response error", error);
      res.status(400).json({ message: error.message || "Failed to generate response" });
    }
  });

  api.post("/api/check-hot-leads", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const hotLeadIds = await leadQualificationService.checkForHotLeads(org.id);
      res.json({ hotLeads: hotLeadIds.length, leadIds: hotLeadIds });
    } catch (error: any) {
      logger.error("Check hot leads error", error);
      res.status(500).json({ message: error.message || "Failed to check hot leads" });
    }
  });

  // ============================================
  // BROWSER AUTOMATION
  // ============================================

  const browserAutomationService = await import("./services/browserAutomation");

  api.get("/api/browser-automation/templates", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const systemTemplates = await browserAutomationService.getSystemTemplates();
      const orgTemplates = await browserAutomationService.getOrganizationTemplates(org.id);
      res.json({ system: systemTemplates, organization: orgTemplates });
    } catch (error: any) {
      logger.error("Get automation templates error", error);
      res.status(500).json({ message: error.message || "Failed to fetch templates" });
    }
  });

  api.get("/api/browser-automation/jobs", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { status, limit } = req.query;
      const jobs = await browserAutomationService.getOrganizationJobs(org.id, {
        status: status as string,
        limit: limit ? parseInt(limit as string) : undefined,
      });
      res.json(jobs);
    } catch (error: any) {
      logger.error("Get automation jobs error", error);
      res.status(500).json({ message: error.message || "Failed to fetch jobs" });
    }
  });

  api.get("/api/browser-automation/jobs/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const job = await browserAutomationService.getJobById(id);
      if (!job) {
        return Errors.notFound(res, "Job");
      }
      if (job.organizationId !== org.id) {
        return Errors.notFound(res, "Job");
      }
      res.json(job);
    } catch (error: any) {
      logger.error("Get automation job error", error);
      Errors.internal(res, error);
    }
  });

  api.post("/api/browser-automation/jobs", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user;
      const { templateId, name, inputData, priority } = req.body;
      const job = await browserAutomationService.createJob(org.id, {
        templateId,
        name,
        inputData,
        priority,
        triggeredByUserId: user.id,
      });
      res.status(201).json(job);
    } catch (error: any) {
      logger.error("Create automation job error", error);
      res.status(400).json({ message: error.message || "Failed to create job" });
    }
  });

  api.post("/api/browser-automation/jobs/:id/cancel", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const job = await browserAutomationService.getJobById(id);
      if (!job) {
        return Errors.notFound(res, "Job");
      }
      if (job.organizationId !== org.id) {
        return Errors.notFound(res, "Job");
      }
      await browserAutomationService.cancelJob(id);
      res.json({ success: true });
    } catch (error: any) {
      logger.error("Cancel automation job error", error);
      Errors.badRequest(res, error.message || "Failed to cancel job");
    }
  });

  // ============================================
  // SMS MESSAGING
  // ============================================

  const smsServiceModule = await import("./services/smsService");

  api.get("/api/sms/config", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const config = await smsServiceModule.checkTwilioConfiguration(org.id);
      res.json(config);
    } catch (error: any) {
      logger.error("Check SMS config error", error);
      res.status(500).json({ message: error.message || "Failed to check SMS configuration" });
    }
  });

  api.post("/api/sms/config", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { accountSid, authToken, fromPhoneNumber } = req.body;
      
      if (!accountSid || !authToken || !fromPhoneNumber) {
        return res.status(400).json({ message: "Account SID, Auth Token, and Phone Number are required" });
      }

      const result = await smsServiceModule.saveTwilioCredentials(
        org.id,
        accountSid,
        authToken,
        fromPhoneNumber
      );
      
      if (!result.success) {
        return res.status(400).json({ message: result.error });
      }
      
      res.json({ success: true });
    } catch (error: any) {
      logger.error("Save SMS config error", error);
      res.status(400).json({ message: error.message || "Failed to save SMS configuration" });
    }
  });

  api.post("/api/sms/send", isAuthenticated, getOrCreateOrg, idempotencyMiddleware, async (req, res) => {
    try {
      const org = req.organization;
      const { to, message } = req.body;

      if (!to || !message) {
        return res.status(400).json({ message: "Phone number and message are required" });
      }

      // ── TCPA gate ────────────────────────────────────────────────────
      // Even ad-hoc sends from a logged-in operator MUST go through the
      // consent + quiet-hours check. The recipient's prior STOP doesn't
      // care that the founder personally typed this. Try to match the
      // destination phone to a known lead; if found, gate on its
      // consent + zone. If unknown, gate on area-code quiet-hours only
      // (no consent record to consult, but we still won't text at 2 AM).
      const { canSendViaChannel, isWithinQuietHours, isWithinQuietHoursForLead } =
        await import("./services/tcpaCompliance");
      const { leads } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const cleanTo = String(to).replace(/\D/g, "").slice(-10);
      const orgLeads = await db
        .select()
        .from(leads)
        .where(eq(leads.organizationId, org.id));
      const matched = orgLeads.find(
        (l) => (l.phone || "").replace(/\D/g, "").slice(-10) === cleanTo
      );
      if (matched) {
        const consent = canSendViaChannel(matched, "sms");
        if (!consent.allowed) {
          return res.status(403).json({ message: `TCPA blocked: ${consent.reason}` });
        }
        const qh = isWithinQuietHoursForLead(matched as any, to);
        if (qh.blocked) {
          return res.status(403).json({ message: `TCPA quiet hours: ${qh.reason}` });
        }
      } else {
        const qh = isWithinQuietHours(to);
        if (qh.blocked) {
          return res.status(403).json({ message: `TCPA quiet hours: ${qh.reason}` });
        }
      }

      // Lens 3 (Pricing Coherence) — debit the pool BEFORE we call Twilio so
      // the gauge in the client doesn't show free SMS. Idempotency key is
      // route + org + dest + minute-bucket so an accidental double-click
      // doesn't double-bill (the Idempotency-Key middleware above already
      // collapses replays, but we belt-and-brace here because pool draws
      // are ledger inserts).
      const smsDebitKey = `sms:send:${org.id}:${cleanTo}:${Math.floor(Date.now() / 60000)}`;
      const smsDebit = await poolDebit({
        organizationId: org.id,
        action: "sms_outbound",
        units: 1,
        externalEventId: smsDebitKey,
        notes: `SMS to ${cleanTo}`,
        isFounder: req.isFounder,
      });

      const result = await smsServiceModule.sendOrgSMS(org.id, to, message);

      if (!result.success) {
        // Refund the pool draw — the message never went out.
        if (smsDebit.debitedCents > 0) {
          await refundPoolDebit({
            organizationId: org.id,
            originalEventId: smsDebitKey,
            amountCents: smsDebit.debitedCents,
            reason: `SMS send failed: ${result.error}`,
          });
        }
        return res.status(400).json({ message: result.error });
      }

      // Surface the pool deduction so the client can update the gauge
      // optimistically without a separate /credits/summary round-trip.
      res.json({
        ...result,
        creditPool: {
          debitedCents: smsDebit.debitedCents,
          remaining: smsDebit.remaining,
          poolMonthly: smsDebit.poolMonthly,
        },
      });
    } catch (error: any) {
      logger.error("Send SMS error", error);
      res.status(400).json({ message: error.message || "Failed to send SMS" });
    }
  });

  api.post("/api/leads/:leadId/sms", isAuthenticated, getOrCreateOrg, idempotencyMiddleware, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user;
      const leadId = parseInt(req.params.leadId);
      const { message } = req.body;

      if (!message) {
        return res.status(400).json({ message: "Message is required" });
      }

      // ── TCPA gate ────────────────────────────────────────────────────
      const lead = await storage.getLead(org.id, leadId);
      if (!lead) {
        return res.status(404).json({ message: "Lead not found" });
      }
      const { canSendViaChannel, isWithinQuietHoursForLead } = await import(
        "./services/tcpaCompliance"
      );
      const consent = canSendViaChannel(lead, "sms");
      if (!consent.allowed) {
        return res.status(403).json({ message: `TCPA blocked: ${consent.reason}` });
      }
      const qh = isWithinQuietHoursForLead(lead as any);
      if (qh.blocked) {
        return res.status(403).json({ message: `TCPA quiet hours: ${qh.reason}` });
      }

      const result = await smsServiceModule.sendSMSToLead(org.id, leadId, message, user.id);

      if (!result.success) {
        return res.status(400).json({ message: result.error });
      }

      res.json(result);
    } catch (error: any) {
      logger.error("Send SMS to lead error", error);
      res.status(400).json({ message: error.message || "Failed to send SMS to lead" });
    }
  });

  api.post("/api/webhooks/twilio/sms", verifyTwilioSignature, async (req, res) => {
    try {
      const { From, To, Body, MessageSid, AccountSid } = req.body;

      if (!From || !Body || !MessageSid) {
        return res.status(400).send("Invalid webhook payload");
      }

      // Pillar 9.5 — dedup by MessageSid. Twilio retries on 5xx and on
      // any timeout >15s; without this dedup, transient processing slow-
      // downs caused duplicate inbound-SMS rows in the messages table.
      const dedupCheck = await withIdempotency(
        "twilio",
        MessageSid,
        "sms.inbound",
        async () => "ok",
      );
      if (dedupCheck.duplicate) {
        logger.debug(`[Twilio Webhook] duplicate inbound SMS ${MessageSid} — already processed`);
        return res.status(200).send("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>");
      }

      logger.info(`[Twilio Webhook] Incoming SMS from ${From} to ${To}: ${Body.substring(0, 50)}...`);

      const orgIntegrations = await db
        .select()
        .from(organizationIntegrations)
        .where(
          and(
            eq(organizationIntegrations.provider, "twilio"),
            eq(organizationIntegrations.isEnabled, true)
          )
        );
      
      const cleanTo = To?.replace(/\D/g, "") || "";
      const matchingOrg = orgIntegrations.find(integration => {
        const creds = integration.credentials as any;
        if (!creds?.fromPhoneNumber) return false;
        const configuredPhone = creds.fromPhoneNumber.replace(/\D/g, "");
        return cleanTo.includes(configuredPhone) || configuredPhone.includes(cleanTo.slice(-10));
      });

      if (matchingOrg) {
        try {
          // Check for STOP/START opt keywords BEFORE storing the message
          const { processOptKeyword } = await import("./services/tcpaCompliance");
          const optResult = await processOptKeyword(
            matchingOrg.organizationId,
            From,
            Body,
            MessageSid
          );

          if (optResult.action === 'opt_out') {
            logger.info(`[Twilio Webhook] STOP keyword received from ${From} — lead ${optResult.leadId} opted out`);
            // Respond with TCPA-required opt-out confirmation message
            res.status(200).send(
              '<?xml version="1.0" encoding="UTF-8"?><Response><Message>You have been unsubscribed and will receive no further messages. Reply START to re-subscribe.</Message></Response>'
            );
            return;
          }
          if (optResult.action === 'opt_in') {
            logger.info(`[Twilio Webhook] START keyword received from ${From} — lead ${optResult.leadId} opted in`);
            res.status(200).send(
              '<?xml version="1.0" encoding="UTF-8"?><Response><Message>You have been re-subscribed. Reply STOP at any time to unsubscribe.</Message></Response>'
            );
            return;
          }

          await smsServiceModule.handleIncomingSMS(
            matchingOrg.organizationId,
            From,
            To,
            Body,
            MessageSid
          );
          logger.info(`[Twilio Webhook] Inbound SMS stored for org ${matchingOrg.organizationId}`);
        } catch (inboundError: any) {
          logger.error("[Twilio Webhook] Error storing inbound SMS", undefined, { metadata: { detail: inboundError.message } });
        }
      } else {
        logger.info("[Twilio Webhook] No matching organization found for phone", { metadata: { detail: To } });
      }

      res.status(200).send("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>");
    } catch (error: any) {
      logger.error("Twilio webhook error", error);
      res.status(500).send("Webhook processing error");
    }
  });

  // POST /api/webhooks/twilio/sms-status
  // Twilio posts delivery status updates for outbound messages here.
  api.post("/api/webhooks/twilio/sms-status", verifyTwilioSignature, async (req, res) => {
    res.status(200).send("OK");
    const { MessageSid, MessageStatus, ErrorCode, ErrorMessage } = req.body;
    if (!MessageSid || !MessageStatus) return;

    // Pillar 9.5 — dedup by (MessageSid + MessageStatus). The same SMS
    // can transition through multiple statuses (sent → delivered) so we
    // include the status to distinguish each transition.
    const dedup = await withIdempotency(
      "twilio",
      `${MessageSid}:${MessageStatus}`,
      "sms.status",
      async () => "ok",
    );
    if (dedup.duplicate) return;

    try {
      const { messages } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const statusMap: Record<string, string> = {
        sent: 'sent',
        delivered: 'delivered',
        failed: 'failed',
        undelivered: 'failed',
        read: 'delivered',
      };
      const mappedStatus = statusMap[MessageStatus] || MessageStatus;
      await db.update(messages)
        .set({ status: mappedStatus, updatedAt: new Date() } as any)
        .where(eq(messages.externalId, MessageSid));

      if (ErrorCode) {
        logger.warn(`[Twilio] SMS ${MessageSid} error ${ErrorCode}: ${ErrorMessage}`);
      }
    } catch (err: any) {
      logger.error("[Twilio SMS Status] Update failed", err);
    }
  });

  // POST /api/webhooks/twilio/recording-status
  // Twilio posts here when a call recording is ready.
  // Looks up the pending transcript by CallSid, then triggers Whisper transcription.
  api.post("/api/webhooks/twilio/recording-status", verifyTwilioSignature, async (req, res) => {
    // Always respond 200 immediately so Twilio doesn't retry
    res.status(200).send("OK");

    const { CallSid, RecordingUrl, RecordingSid, RecordingStatus } = req.body;

    if (RecordingStatus !== "completed" || !RecordingUrl || !CallSid) return;

    // Pillar 9.5 — dedup by RecordingSid (Twilio's globally-unique id for
    // the recording). Falls back to CallSid when RecordingSid is absent
    // — older Twilio API versions on legacy accounts.
    const recordingDedup = await withIdempotency(
      "twilio",
      RecordingSid || `call:${CallSid}`,
      "recording.complete",
      async () => "ok",
    );
    if (recordingDedup.duplicate) {
      logger.debug(`[Twilio Recording] duplicate recording-status ${RecordingSid ?? CallSid}`);
      return;
    }

    try {
      // MP3 format requires appending .mp3 to the Twilio URL
      const audioUrl = RecordingUrl.endsWith(".mp3") ? RecordingUrl : `${RecordingUrl}.mp3`;

      // Find the transcript that corresponds to this call
      const [transcript] = await db
        .select()
        .from(callTranscripts)
        .where(eq(callTranscripts.callId, CallSid))
        .limit(1);

      if (!transcript) {
        logger.info(`[Twilio Recording] No transcript found for CallSid ${CallSid}`);
        return;
      }

      // Update the audioUrl on the transcript record
      await db
        .update(callTranscripts)
        .set({ audioUrl })
        .where(eq(callTranscripts.id, transcript.id));

      // Trigger Whisper transcription asynchronously
      const { voiceCallAIService } = await import("./services/voiceCallAI");
      voiceCallAIService.transcribeCall(transcript.id, audioUrl).catch((err: any) => {
        logger.error(`[Twilio Recording] Whisper transcription failed for transcript ${transcript.id}`, err);
      });

      logger.info(`[Twilio Recording] Queued transcription for transcript ${transcript.id} (CallSid ${CallSid})`);
    } catch (error: any) {
      logger.error("[Twilio Recording] Webhook error", error);
    }
  });

  // ============================================
  // JOB QUEUE
  // ============================================
  
  // Create a new job
  api.post("/api/jobs", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { jobQueueService } = await import("./services/jobQueue");
      const { type, payload, maxAttempts, scheduledFor } = req.body;
      
      // Validate job type
      const validTypes = ["email", "webhook", "payment_sync", "notification"];
      if (!validTypes.includes(type)) {
        return res.status(400).json({ 
          message: `Invalid job type. Supported types: ${validTypes.join(", ")}` 
        });
      }
      
      // Validate payload is provided
      if (!payload || typeof payload !== "object") {
        return res.status(400).json({ message: "Payload is required and must be an object" });
      }
      
      // Create job
      const job = jobQueueService.addJob(type, payload, {
        maxAttempts,
        scheduledFor: scheduledFor ? new Date(scheduledFor) : undefined,
      });
      
      res.json(job);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to create job" });
    }
  });
  
  // Get job status by ID
  api.get("/api/jobs/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { jobQueueService } = await import("./services/jobQueue");
      const job = jobQueueService.getJobStatus(req.params.id);
      
      if (!job) {
        return res.status(404).json({ message: "Job not found" });
      }
      
      res.json(job);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get job" });
    }
  });
  
  // Get recent jobs (admin only)
  api.get("/api/jobs", isAuthenticated, getOrCreateOrg, requireAdminOrAbove(), async (req, res) => {
    try {
      const { jobQueueService } = await import("./services/jobQueue");
      const limit = Math.min(100, parseInt(req.query.limit as string) || 50);
      const jobs = jobQueueService.getRecentJobs(limit);
      
      res.json({
        total: jobs.length,
        jobs,
        stats: jobQueueService.getStats(),
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get jobs" });
    }
  });
  
  // Get job queue statistics (admin only)
  api.get("/api/jobs/stats", isAuthenticated, getOrCreateOrg, requireAdminOrAbove(), async (req, res) => {
    try {
      const { jobQueueService } = await import("./services/jobQueue");
      const stats = jobQueueService.getStats();
      
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get job statistics" });
    }
  });

  // ============================================
  // BYOK (BRING YOUR OWN KEY) SETTINGS
  // ============================================

  // Get integration statuses for BYOK services
  api.get("/api/settings/integrations/status", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const services = ["lob", "regrid", "twilio", "sendgrid", "rapidapi"];
      
      const statuses = await Promise.all(
        services.map(async (service) => {
          const integration = await storage.getOrganizationIntegration(org.id, service);
          return {
            provider: service,
            isConfigured: !!integration?.credentials?.apiKey,
            maskedKey: integration?.credentials?.apiKey
              ? integration.credentials.apiKey.slice(0, 3) + "..." + integration.credentials.apiKey.slice(-4)
              : undefined,
            lastValidatedAt: integration?.lastValidatedAt?.toISOString(),
            validationError: integration?.validationError,
          };
        })
      );
      
      res.json(statuses);
    } catch (error: any) {
      logger.error("Error fetching integration statuses", error);
      res.status(500).json({ message: "Failed to fetch integration statuses" });
    }
  });

  // Save API key for a service
  api.post("/api/settings/save-api-key", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { service, apiKey } = req.body;

      if (!service || !apiKey) {
        return res.status(400).json({ message: "Service and API key are required" });
      }

      // Validate service is one of the allowed ones
      const allowedServices = ["lob", "regrid", "twilio", "sendgrid", "rapidapi"];
      if (!allowedServices.includes(service)) {
        return res.status(400).json({ message: "Invalid service" });
      }

      // Save the integration
      const existing = await storage.getOrganizationIntegration(org.id, service);
      
      if (existing) {
        await storage.updateOrganizationIntegration(existing.id, {
          credentials: {
            ...existing.credentials,
            apiKey,
          },
          lastValidatedAt: new Date(),
          validationError: null,
        });
      } else {
        await storage.createOrganizationIntegration({
          organizationId: org.id,
          provider: service,
          isEnabled: true,
          credentials: { apiKey },
          lastValidatedAt: new Date(),
        });
      }

      res.json({ success: true, message: `${service} API key saved successfully` });
    } catch (error: any) {
      logger.error("Error saving API key", error);
      res.status(500).json({ message: error.message || "Failed to save API key" });
    }
  });

  // Validate Lob API key
  api.post("/api/settings/validate-lob", isAuthenticated, async (req, res) => {
    try {
      const { apiKey } = req.body;

      if (!apiKey) {
        return res.status(400).json({ valid: false, message: "API key is required" });
      }

      // Make a simple API call to verify the key works
      const response = await fetch("https://api.lob.com/v1/addresses", {
        headers: {
          Authorization: `Basic ${Buffer.from(apiKey + ":").toString("base64")}`,
        },
      });

      res.json({ valid: response.ok });
    } catch (error) {
      logger.error("Lob validation error", error);
      res.json({ valid: false });
    }
  });

  // Validate Regrid API key
  api.post("/api/settings/validate-regrid", isAuthenticated, async (req, res) => {
    try {
      const { apiKey } = req.body;

      if (!apiKey) {
        return res.status(400).json({ valid: false, message: "API key is required" });
      }

      // Make a simple API call to verify the key works
      const response = await fetch("https://api.regrid.com/api/v1/parcels", {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      res.json({ valid: response.ok });
    } catch (error) {
      logger.error("Regrid validation error", error);
      res.json({ valid: false });
    }
  });

  // Validate Twilio API key (Account SID + Auth Token)
  api.post("/api/settings/validate-twilio", isAuthenticated, async (req, res) => {
    try {
      const { apiKey } = req.body;

      if (!apiKey) {
        return res.status(400).json({ valid: false, message: "API key is required" });
      }

      // Twilio expects SID:TOKEN format, or just the auth token
      // Validate by calling a read-only endpoint (GET /Accounts)
      const parts = apiKey.includes(":") ? apiKey.split(":") : [null, apiKey];
      const sid = parts[0] || process.env.TWILIO_ACCOUNT_SID;
      const token = parts[1] || apiKey;

      if (!sid) {
        return res.json({ valid: false, message: "Account SID required (format: SID:TOKEN or set TWILIO_ACCOUNT_SID env)" });
      }

      const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        },
      });

      res.json({ valid: response.ok });
    } catch (error) {
      logger.error("Twilio validation error", error);
      res.json({ valid: false });
    }
  });

  // Validate SendGrid API key (read-only scopes check — does NOT send email)
  api.post("/api/settings/validate-sendgrid", isAuthenticated, async (req, res) => {
    try {
      const { apiKey } = req.body;

      if (!apiKey) {
        return res.status(400).json({ valid: false, message: "API key is required" });
      }

      // Use a read-only endpoint to verify the key — GET /v3/scopes
      const response = await fetch("https://api.sendgrid.com/v3/scopes", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      res.json({ valid: response.ok });
    } catch (error) {
      logger.error("SendGrid validation error", error);
      res.json({ valid: false });
    }
  });

  // Validate RapidAPI Property Lines key
  api.post("/api/settings/validate-rapidapi", isAuthenticated, async (req, res) => {
    try {
      const { apiKey } = req.body;

      if (!apiKey) {
        return res.status(400).json({ valid: false, message: "API key is required" });
      }

      // Make a simple API call to verify the key works
      const response = await fetch("https://property-lines.p.rapidapi.com/get_all_us_state_boundaries", {
        method: "GET",
        headers: {
          "x-rapidapi-host": "property-lines.p.rapidapi.com",
          "x-rapidapi-key": apiKey,
        },
      });

      res.json({ valid: response.ok });
    } catch (error) {
      logger.error("RapidAPI validation error", error);
      res.json({ valid: false });
    }
  });

  registerAIOperationsRoutes(api);

  // ============================================
  // TAX OPTIMIZER ROUTES (T79)
  // ============================================

  // GET /api/tax-optimizer/position — year-end tax position analysis
  api.get("/api/tax-optimizer/position", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const taxYear = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear();
      const { taxOptimizerService } = await import("./services/taxOptimizer");
      const position = await taxOptimizerService.analyzeYearEndPosition(org.id, taxYear);
      res.json(position);
    } catch (err: any) {
      logger.error("Tax optimizer error", err);
      res.status(500).json({ message: err.message || "Failed to analyze tax position" });
    }
  });

  // GET /api/tax-optimizer/deal/:dealId — quick tax estimate for a deal
  api.get("/api/tax-optimizer/deal/:dealId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const dealId = parseInt(req.params.dealId);
      const { taxOptimizerService } = await import("./services/taxOptimizer");
      const estimate = await taxOptimizerService.estimateDealTax(org.id, dealId);
      res.json(estimate);
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to estimate deal tax" });
    }
  });

  // POST /api/tax-optimizer/report — AI-generated tax planning report
  api.post("/api/tax-optimizer/report", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const taxYear = req.body.taxYear || new Date().getFullYear();
      const { taxOptimizerService } = await import("./services/taxOptimizer");
      const report = await taxOptimizerService.generateTaxPlanningReport(org.id, taxYear);
      res.json({ report, taxYear });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to generate tax report" });
    }
  });

  // GET /api/tax-optimizer/dealer-classification — dealer vs. investor
  // status assessment per §1221(a)(1). Audit-defense oriented.
  // Optional query: hoursLast12, exclusiveRealEstate (true|false)
  api.get("/api/tax-optimizer/dealer-classification", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const hoursLast12 = req.query.hoursLast12
        ? parseInt(String(req.query.hoursLast12), 10)
        : null;
      const exclusiveRealEstate =
        req.query.exclusiveRealEstate === "true"
          ? true
          : req.query.exclusiveRealEstate === "false"
          ? false
          : null;
      const { classifyDealerVsInvestor } = await import("./services/dealerInvestorClassifier");
      const result = await classifyDealerVsInvestor({
        orgId: org.id,
        selfReportedHoursLast12: Number.isFinite(hoursLast12 as number) ? hoursLast12 : null,
        exclusiveRealEstate,
      });
      res.json(result);
    } catch (err: any) {
      logger.error("Dealer classification error", err);
      res.status(500).json({ message: err.message || "Failed to classify" });
    }
  });

  // POST /api/tax-optimizer/re-professional — §469(c)(7) test.
  // Body: { realEstateHoursThisYear, totalWorkHoursThisYear, hasMaterialParticipationLog }
  api.post("/api/tax-optimizer/re-professional", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const realEstateHoursThisYear = Number(req.body?.realEstateHoursThisYear ?? 0);
      const totalWorkHoursThisYear = Number(req.body?.totalWorkHoursThisYear ?? 0);
      const hasMaterialParticipationLog = Boolean(req.body?.hasMaterialParticipationLog);
      if (!Number.isFinite(realEstateHoursThisYear) || realEstateHoursThisYear < 0) {
        return res.status(400).json({ message: "realEstateHoursThisYear must be a non-negative number" });
      }
      if (!Number.isFinite(totalWorkHoursThisYear) || totalWorkHoursThisYear < 0) {
        return res.status(400).json({ message: "totalWorkHoursThisYear must be a non-negative number" });
      }
      const { evaluateRealEstateProfessional } = await import("./services/dealerInvestorClassifier");
      const result = evaluateRealEstateProfessional({
        realEstateHoursThisYear,
        totalWorkHoursThisYear,
        hasMaterialParticipationLog,
      });
      res.json(result);
    } catch (err: any) {
      logger.error("RE-professional test error", err);
      res.status(500).json({ message: err.message || "Failed to evaluate" });
    }
  });

  // ============================================
  // INVESTOR VERIFICATION ROUTES (T82)
  // ============================================

  // GET /api/investor-profiles/my — get or create own investor profile
  api.get("/api/investor-profiles/my", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user;
      const { db: database } = await import("./db");
      const { investorProfiles } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const [profile] = await database
        .select()
        .from(investorProfiles)
        .where(eq(investorProfiles.organizationId, org.id));
      res.json({ profile: profile || null });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/investor-profiles — create/update investor profile
  api.post("/api/investor-profiles", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user;
      const body = req.body;
      const { db: database } = await import("./db");
      const { investorProfiles } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");

      const [existing] = await database
        .select()
        .from(investorProfiles)
        .where(eq(investorProfiles.organizationId, org.id));

      if (existing) {
        const [updated] = await database
          .update(investorProfiles)
          .set({ ...body, updatedAt: new Date() })
          .where(eq(investorProfiles.id, existing.id))
          .returning();
        res.json({ profile: updated });
      } else {
        const [created] = await database
          .insert(investorProfiles)
          .values({
            organizationId: org.id,
            userId: user?.id || "unknown",
            ...body,
            verificationStatus: "pending",
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();
        res.json({ profile: created });
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/investor-profiles/verify — submit verification documents
  api.post("/api/investor-profiles/verify", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { verificationType, documentUrl, selfAttestation } = req.body;
      const { db: database } = await import("./db");
      const { investorProfiles } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");

      // Simple self-attestation verification (production would integrate with Stripe Identity or Persona)
      const verificationData = {
        verificationType: verificationType || "self_attestation",
        submittedAt: new Date().toISOString(),
        documentUrl: documentUrl || null,
        selfAttestation: selfAttestation || null,
        reviewStatus: selfAttestation ? "approved" : "pending_review",
      };

      const [updated] = await database
        .update(investorProfiles)
        .set({
          verificationStatus: selfAttestation ? "verified" : "pending",
          verificationData,
          verifiedAt: selfAttestation ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(investorProfiles.organizationId, org.id))
        .returning();

      res.json({
        success: true,
        profile: updated,
        message: selfAttestation
          ? "Identity verified via self-attestation. Investor badge enabled."
          : "Verification documents submitted for review (1-2 business days).",
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/investor-profiles/directory — browse verified investors in marketplace
  api.get("/api/investor-profiles/directory", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { db: database } = await import("./db");
      const { investorProfiles } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      const profiles = await database
        .select()
        .from(investorProfiles)
        .where(eq(investorProfiles.verificationStatus, "verified"))
        .limit(50);
      res.json({ profiles, count: profiles.length });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ============================================

}

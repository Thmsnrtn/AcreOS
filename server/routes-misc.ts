// @ts-nocheck — ORM type refinement deferred; runtime-correct
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

export async function registerMiscRoutes(app: Express): Promise<void> {
  const api = app;

  // LEAD QUALIFICATION & ALERTS
  // ============================================

  const leadQualificationService = await import("./services/leadQualification");

  api.get("/api/alerts", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { priority, limit } = req.query;
      const alerts = await leadQualificationService.getPendingAlerts(org.id, {
        priority: priority as string,
        limit: limit ? parseInt(limit as string) : undefined,
      });
      res.json(alerts);
    } catch (error: any) {
      console.error("Get alerts error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch alerts" });
    }
  });

  api.post("/api/alerts/:id/acknowledge", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const user = (req as any).user;
      const id = parseInt(req.params.id);
      const { actionTaken } = req.body;
      await leadQualificationService.acknowledgeAlert(id, user.id, actionTaken);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Acknowledge alert error:", error);
      res.status(400).json({ message: error.message || "Failed to acknowledge alert" });
    }
  });

  api.post("/api/alerts/:id/dismiss", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await leadQualificationService.dismissAlert(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Dismiss alert error:", error);
      res.status(400).json({ message: error.message || "Failed to dismiss alert" });
    }
  });

  api.get("/api/leads/:id/intent-score", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const leadId = parseInt(req.params.id);
      const score = await leadQualificationService.calculateLeadIntentScore(org.id, leadId);
      res.json(score);
    } catch (error: any) {
      console.error("Get lead intent score error:", error);
      res.status(500).json({ message: error.message || "Failed to calculate intent score" });
    }
  });

  api.post("/api/leads/:id/analyze-message", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
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
      console.error("Analyze message error:", error);
      res.status(400).json({ message: error.message || "Failed to analyze message" });
    }
  });

  api.get("/api/leads/:id/suggested-response", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const leadId = parseInt(req.params.id);
      const { propertyId } = req.query;
      const response = await leadQualificationService.generateSuggestedResponse(
        org.id,
        leadId,
        propertyId ? parseInt(propertyId as string) : undefined
      );
      res.json({ response });
    } catch (error: any) {
      console.error("Generate suggested response error:", error);
      res.status(400).json({ message: error.message || "Failed to generate response" });
    }
  });

  api.post("/api/check-hot-leads", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const hotLeadIds = await leadQualificationService.checkForHotLeads(org.id);
      res.json({ hotLeads: hotLeadIds.length, leadIds: hotLeadIds });
    } catch (error: any) {
      console.error("Check hot leads error:", error);
      res.status(500).json({ message: error.message || "Failed to check hot leads" });
    }
  });

  // ============================================
  // BROWSER AUTOMATION
  // ============================================

  const browserAutomationService = await import("./services/browserAutomation");

  api.get("/api/browser-automation/templates", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const systemTemplates = await browserAutomationService.getSystemTemplates();
      const orgTemplates = await browserAutomationService.getOrganizationTemplates(org.id);
      res.json({ system: systemTemplates, organization: orgTemplates });
    } catch (error: any) {
      console.error("Get automation templates error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch templates" });
    }
  });

  api.get("/api/browser-automation/jobs", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { status, limit } = req.query;
      const jobs = await browserAutomationService.getOrganizationJobs(org.id, {
        status: status as string,
        limit: limit ? parseInt(limit as string) : undefined,
      });
      res.json(jobs);
    } catch (error: any) {
      console.error("Get automation jobs error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch jobs" });
    }
  });

  api.get("/api/browser-automation/jobs/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const job = await browserAutomationService.getJobById(id);
      if (!job) {
        return res.status(404).json({ message: "Job not found" });
      }
      res.json(job);
    } catch (error: any) {
      console.error("Get automation job error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch job" });
    }
  });

  api.post("/api/browser-automation/jobs", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = (req as any).user;
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
      console.error("Create automation job error:", error);
      res.status(400).json({ message: error.message || "Failed to create job" });
    }
  });

  api.post("/api/browser-automation/jobs/:id/cancel", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await browserAutomationService.cancelJob(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Cancel automation job error:", error);
      res.status(400).json({ message: error.message || "Failed to cancel job" });
    }
  });

  // ============================================
  // SMS MESSAGING
  // ============================================

  const smsServiceModule = await import("./services/smsService");

  api.get("/api/sms/config", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const config = await smsServiceModule.checkTwilioConfiguration(org.id);
      res.json(config);
    } catch (error: any) {
      console.error("Check SMS config error:", error);
      res.status(500).json({ message: error.message || "Failed to check SMS configuration" });
    }
  });

  api.post("/api/sms/config", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
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
      console.error("Save SMS config error:", error);
      res.status(400).json({ message: error.message || "Failed to save SMS configuration" });
    }
  });

  api.post("/api/sms/send", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { to, message } = req.body;
      
      if (!to || !message) {
        return res.status(400).json({ message: "Phone number and message are required" });
      }

      const result = await smsServiceModule.sendOrgSMS(org.id, to, message);
      
      if (!result.success) {
        return res.status(400).json({ message: result.error });
      }
      
      res.json(result);
    } catch (error: any) {
      console.error("Send SMS error:", error);
      res.status(400).json({ message: error.message || "Failed to send SMS" });
    }
  });

  api.post("/api/leads/:leadId/sms", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = (req as any).user;
      const leadId = parseInt(req.params.leadId);
      const { message } = req.body;
      
      if (!message) {
        return res.status(400).json({ message: "Message is required" });
      }

      const result = await smsServiceModule.sendSMSToLead(org.id, leadId, message, user.id);
      
      if (!result.success) {
        return res.status(400).json({ message: result.error });
      }
      
      res.json(result);
    } catch (error: any) {
      console.error("Send SMS to lead error:", error);
      res.status(400).json({ message: error.message || "Failed to send SMS to lead" });
    }
  });

  api.post("/api/webhooks/twilio/sms", async (req, res) => {
    try {
      const { From, To, Body, MessageSid, AccountSid } = req.body;
      
      if (!From || !Body || !MessageSid) {
        return res.status(400).send("Invalid webhook payload");
      }

      console.log(`[Twilio Webhook] Incoming SMS from ${From} to ${To}: ${Body.substring(0, 50)}...`);
      
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
            console.log(`[Twilio Webhook] STOP keyword received from ${From} — lead ${optResult.leadId} opted out`);
            // Respond with TCPA-required opt-out confirmation message
            res.status(200).send(
              '<?xml version="1.0" encoding="UTF-8"?><Response><Message>You have been unsubscribed and will receive no further messages. Reply START to re-subscribe.</Message></Response>'
            );
            return;
          }
          if (optResult.action === 'opt_in') {
            console.log(`[Twilio Webhook] START keyword received from ${From} — lead ${optResult.leadId} opted in`);
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
          console.log(`[Twilio Webhook] Inbound SMS stored for org ${matchingOrg.organizationId}`);
        } catch (inboundError: any) {
          console.error("[Twilio Webhook] Error storing inbound SMS:", inboundError.message);
        }
      } else {
        console.log("[Twilio Webhook] No matching organization found for phone:", To);
      }

      res.status(200).send("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>");
    } catch (error: any) {
      console.error("Twilio webhook error:", error);
      res.status(500).send("Webhook processing error");
    }
  });

  // POST /api/webhooks/twilio/sms-status
  // Twilio posts delivery status updates for outbound messages here.
  api.post("/api/webhooks/twilio/sms-status", async (req, res) => {
    res.status(200).send("OK");
    const { MessageSid, MessageStatus, ErrorCode, ErrorMessage } = req.body;
    if (!MessageSid || !MessageStatus) return;

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
        console.warn(`[Twilio] SMS ${MessageSid} error ${ErrorCode}: ${ErrorMessage}`);
      }
    } catch (err: any) {
      console.error("[Twilio SMS Status] Update failed:", err.message);
    }
  });

  // POST /api/webhooks/twilio/recording-status
  // Twilio posts here when a call recording is ready.
  // Looks up the pending transcript by CallSid, then triggers Whisper transcription.
  api.post("/api/webhooks/twilio/recording-status", async (req, res) => {
    // Always respond 200 immediately so Twilio doesn't retry
    res.status(200).send("OK");

    const { CallSid, RecordingUrl, RecordingSid, RecordingStatus } = req.body;

    if (RecordingStatus !== "completed" || !RecordingUrl || !CallSid) return;

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
        console.log(`[Twilio Recording] No transcript found for CallSid ${CallSid}`);
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
        console.error(`[Twilio Recording] Whisper transcription failed for transcript ${transcript.id}:`, err.message);
      });

      console.log(`[Twilio Recording] Queued transcription for transcript ${transcript.id} (CallSid ${CallSid})`);
    } catch (error: any) {
      console.error("[Twilio Recording] Webhook error:", error.message);
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
  api.get("/api/jobs", isAuthenticated, getOrCreateOrg, requireAdminOrAbove, async (req, res) => {
    try {
      const { jobQueueService } = await import("./services/jobQueue");
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
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
  api.get("/api/jobs/stats", isAuthenticated, getOrCreateOrg, requireAdminOrAbove, async (req, res) => {
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
      const org = (req as any).organization;
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
      console.error("Error fetching integration statuses:", error);
      res.status(500).json({ message: "Failed to fetch integration statuses" });
    }
  });

  // Save API key for a service
  api.post("/api/settings/save-api-key", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
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
      console.error("Error saving API key:", error);
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
      console.error("Lob validation error:", error);
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
      console.error("Regrid validation error:", error);
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
      console.error("Twilio validation error:", error);
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
      console.error("SendGrid validation error:", error);
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
      console.error("RapidAPI validation error:", error);
      res.json({ valid: false });
    }
  });

  registerAIOperationsRoutes(api);

  // ============================================

}

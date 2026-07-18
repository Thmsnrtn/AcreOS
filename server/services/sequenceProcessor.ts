import { storage, db } from "../storage";
import type { SequenceEnrollment, SequenceStep, CampaignSequence, Lead } from "@shared/schema";
import { campaignDeliveryEvents } from "@shared/schema";
import {
  checkTcpaConsentFromLead,
  canSendViaChannel,
  isWithinQuietHoursForLead,
} from "./tcpaCompliance";
import crypto from "crypto";
import { logger } from '../utils/logger';

type EnrollmentWithDetails = SequenceEnrollment & { sequence: CampaignSequence; lead: Lead };

const CHECK_INTERVAL_MS = 60 * 1000;
const JOB_LOCK_TTL_SECONDS = 55; // Slightly less than interval

// Instance identifier for job locking
const instanceId = crypto.randomUUID();

export class SequenceProcessorService {
  private isRunning = false;
  // P0 #3 — Sequence processor (lifecycle email/SMS/direct-mail cohort
  // builder) migrated to scheduleSelfRescheduling (Phase 3 Week 7-8). The
  // 60s setInterval was firing concurrent runs whenever a single
  // processEnrollments() exceeded 60s in production. The cancel function
  // returned by scheduleSelfRescheduling replaces clearInterval.
  private cancelFn: (() => void) | null = null;

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info("[sequence-processor] Starting sequence processor background job (self-rescheduling)");
    const { scheduleSelfRescheduling } = await import("../jobs/scheduler");
    this.cancelFn = scheduleSelfRescheduling({
      name: "sequence_processor",
      intervalMs: CHECK_INTERVAL_MS,
      run: () => this.runWithLock(),
    });
  }

  private async runWithLock() {
    const acquired = await storage.acquireJobLock('sequence_processor', instanceId, JOB_LOCK_TTL_SECONDS);
    if (!acquired) {
      logger.debug("[sequence-processor] Lock not acquired, skipping execution");
      return;
    }
    try {
      await this.processEnrollments();
    } finally {
      await storage.releaseJobLock('sequence_processor', instanceId);
    }
  }

  stop() {
    if (this.cancelFn) {
      this.cancelFn();
      this.cancelFn = null;
    }
    this.isRunning = false;
    logger.info("[sequence-processor] Stopped sequence processor");
  }

  async processEnrollments() {
    const JOB_TYPE = 'sequence_processor';
    
    try {
      await storage.setJobStatus(JOB_TYPE, 'running');
      
      const cursor = await storage.getJobCursor(JOB_TYPE);
      const lastProcessedId = cursor?.lastProcessedId || 0;
      
      const enrollmentsDue = await storage.getEnrollmentsDueForProcessing();
      
      const unprocessedEnrollments = enrollmentsDue.filter(e => e.id > lastProcessedId);
      
      if (unprocessedEnrollments.length === 0) {
        await storage.setJobStatus(JOB_TYPE, 'idle');
        return;
      }

      logger.info("[sequence-processor] Processing enrollments due", { metadata: { count: unprocessedEnrollments.length, skipped: enrollmentsDue.length - unprocessedEnrollments.length } });

      let maxProcessedId = lastProcessedId;
      for (const enrollment of unprocessedEnrollments) {
        try {
          await this.processEnrollment(enrollment);
        } catch (enrollErr) {
          logger.error("[sequence-processor] Failed to process enrollment, marking as failed and continuing", enrollErr, { metadata: { enrollmentId: enrollment.id } });
          // Mark individual enrollment as failed so it isn't retried indefinitely
          try {
            await storage.updateSequenceEnrollment(enrollment.id, { status: "failed" });
          } catch { /* best effort */ }
        }
        maxProcessedId = Math.max(maxProcessedId, enrollment.id);
        await storage.updateJobCursor(JOB_TYPE, maxProcessedId, 'running');
      }
      
      await storage.setJobStatus(JOB_TYPE, 'idle');
    } catch (error) {
      logger.error("[sequence-processor] Error processing enrollments", error);
      await storage.setJobStatus(JOB_TYPE, 'failed');
    }
  }

  async processEnrollment(enrollment: EnrollmentWithDetails) {
    try {
      const tcpaCheck = checkTcpaConsentFromLead(enrollment.lead);
      if (tcpaCheck.blocked) {
        await storage.pauseEnrollment(enrollment.id, `TCPA blocked: ${tcpaCheck.reason}`);
        logger.info("[sequence-processor] Pausing enrollment", { metadata: { enrollmentId: enrollment.id, reason: tcpaCheck.reason } });
        return;
      }

      const steps = await storage.getSequenceSteps(enrollment.sequenceId);
      const nextStepNumber = enrollment.currentStep + 1;
      const nextStep = steps.find(s => s.stepNumber === nextStepNumber);

      if (!nextStep) {
        await storage.completeEnrollment(enrollment.id);
        logger.info("[sequence-processor] Enrollment completed (no more steps)", { metadata: { enrollmentId: enrollment.id } });
        return;
      }

      const channelCheck = canSendViaChannel(enrollment.lead, nextStep.channel as 'email' | 'sms' | 'direct_mail');
      if (!channelCheck.allowed) {
        logger.info("[sequence-processor] Skipping step", { metadata: { stepNumber: nextStep.stepNumber, enrollmentId: enrollment.id, reason: channelCheck.reason } });
        
        const furtherStep = steps.find(s => s.stepNumber === nextStepNumber + 1);
        if (furtherStep) {
          const nextScheduledAt = new Date();
          nextScheduledAt.setDate(nextScheduledAt.getDate() + furtherStep.delayDays);
          
          await storage.updateSequenceEnrollment(enrollment.id, {
            currentStep: nextStepNumber,
            nextStepScheduledAt: nextScheduledAt,
          });
        } else {
          await storage.completeEnrollment(enrollment.id);
        }
        return;
      }

      const shouldSend = await this.evaluateCondition(enrollment, nextStep);

      if (shouldSend) {
        await this.sendStep(enrollment, nextStep);
        
        const furtherStep = steps.find(s => s.stepNumber === nextStepNumber + 1);
        if (furtherStep) {
          const nextScheduledAt = new Date();
          nextScheduledAt.setDate(nextScheduledAt.getDate() + furtherStep.delayDays);
          
          await storage.updateSequenceEnrollment(enrollment.id, {
            currentStep: nextStepNumber,
            lastStepSentAt: new Date(),
            nextStepScheduledAt: nextScheduledAt,
          });
        } else {
          await storage.completeEnrollment(enrollment.id);
          logger.info("[sequence-processor] Enrollment completed", { metadata: { enrollmentId: enrollment.id } });
        }
      } else {
        const furtherStep = steps.find(s => s.stepNumber === nextStepNumber + 1);
        if (furtherStep) {
          const nextScheduledAt = new Date();
          nextScheduledAt.setDate(nextScheduledAt.getDate() + furtherStep.delayDays);
          
          await storage.updateSequenceEnrollment(enrollment.id, {
            currentStep: nextStepNumber,
            nextStepScheduledAt: nextScheduledAt,
          });
        } else {
          await storage.completeEnrollment(enrollment.id);
        }
      }
    } catch (error) {
      logger.error("[sequence-processor] Error processing enrollment", error, { metadata: { enrollmentId: enrollment.id } });
    }
  }

  async evaluateCondition(enrollment: EnrollmentWithDetails, step: SequenceStep): Promise<boolean> {
    switch (step.conditionType) {
      case "always":
        return true;

      case "no_response": {
        const hasResponded = await this.checkLeadResponded(
          enrollment.lead.id,
          enrollment.sequence.organizationId,
          step.conditionDays || 3
        );
        return !hasResponded;
      }

      case "responded": {
        const hasResponded = await this.checkLeadResponded(
          enrollment.lead.id,
          enrollment.sequence.organizationId,
          step.conditionDays || 3
        );
        if (hasResponded) {
          await storage.pauseEnrollment(enrollment.id, "Lead responded - pausing sequence");
          return false;
        }
        return hasResponded;
      }

      default:
        return true;
    }
  }

  async checkLeadResponded(leadId: number, orgId: number, withinDays: number): Promise<boolean> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - withinDays);
      
      const activities = await storage.getLeadActivities(orgId, leadId);
      const responseActivities = activities.filter(
        a => 
          (a.type === "email_reply" || a.type === "sms_reply" || a.type === "call" || a.type === "response") &&
          a.createdAt && new Date(a.createdAt) > cutoffDate
      );
      
      return responseActivities.length > 0;
    } catch (error) {
      logger.error("[sequence-processor] Error checking lead response", error);
      return false;
    }
  }

  async sendStep(enrollment: EnrollmentWithDetails, step: SequenceStep) {
    const lead = enrollment.lead;
    
    const channelCheck = canSendViaChannel(lead, step.channel as 'email' | 'sms' | 'direct_mail');
    if (!channelCheck.allowed) {
      logger.warn("[sequence-processor] TCPA blocked channel", { metadata: { channel: step.channel, leadId: lead.id, reason: channelCheck.reason } });
      return;
    }
    
    const personalizedContent = this.personalizeContent(step.content, lead);
    const personalizedSubject = step.subject ? this.personalizeContent(step.subject, lead) : undefined;

    try {
      switch (step.channel) {
        case "email":
          await this.sendEmail(lead, personalizedSubject || "Follow-up", personalizedContent);
          break;

        case "sms":
          await this.sendSms(lead, personalizedContent);
          break;

        case "direct_mail":
          await this.sendDirectMail(lead, personalizedSubject || "Follow-up", personalizedContent);
          break;
      }

      logger.info("[sequence-processor] Sent message", { metadata: { channel: step.channel, leadId: lead.id, enrollmentId: enrollment.id, stepNumber: step.stepNumber } });

      // Track delivery event
      try {
        const campaignId = lead.sourceCampaignId || lead.campaignId;
        if (campaignId) {
          await db.insert(campaignDeliveryEvents).values({
            campaignId,
            leadId: lead.id,
            channel: step.channel,
            status: "sent",
            sentAt: new Date(),
            statusUpdatedAt: new Date(),
            metadata: { enrollmentId: enrollment.id, stepNumber: step.stepNumber },
          });
        }
      } catch (trackErr) {
        logger.warn("[sequence-processor] Failed to track delivery event", { metadata: { error: String(trackErr) } });
      }
    } catch (error) {
      logger.error("[sequence-processor] Failed to send message", error, { metadata: { channel: step.channel, enrollmentId: enrollment.id } });
    }
  }

  personalizeContent(content: string, lead: Lead): string {
    return content
      .replace(/\{\{firstName\}\}/g, lead.firstName || "")
      .replace(/\{\{lastName\}\}/g, lead.lastName || "")
      .replace(/\{\{email\}\}/g, lead.email || "")
      .replace(/\{\{phone\}\}/g, lead.phone || "")
      .replace(/\{\{address\}\}/g, lead.address || "")
      .replace(/\{\{propertyAddress\}\}/g, lead.address || "")
      .replace(/\{\{city\}\}/g, lead.city || "")
      .replace(/\{\{state\}\}/g, lead.state || "");
  }

  async sendEmail(lead: Lead, subject: string, content: string) {
    if (!lead.email) {
      logger.warn("[sequence-processor] Lead has no email address", { metadata: { leadId: lead.id } });
      return;
    }

    const channelCheck = canSendViaChannel(lead, 'email');
    if (!channelCheck.allowed) {
      logger.warn("[sequence-processor] Email blocked for lead", { metadata: { leadId: lead.id, reason: channelCheck.reason } });
      return;
    }

    try {
      const { emailService } = await import("./emailService");
      const configured = await emailService.isConfigured();
      if (configured) {
        const sendResult = await emailService.sendEmail({
          to: lead.email,
          subject,
          html: content,
          text: content.replace(/<[^>]*>/g, ""),
          // Deal mail: sequence outreach to a lead — org identity required.
          organizationId: lead.organizationId,
          purpose: 'counterparty',
        });
        if (!sendResult.success) {
          logger.warn("[sequence-processor] Email refused/failed", {
            metadata: { leadId: lead.id, error: sendResult.error },
          });
        }
      } else {
        logger.info("[sequence-processor] Email service not available", { metadata: { wouldSendTo: lead.email } });
      }
    } catch (error) {
      logger.error("[sequence-processor] Email send failed", error);
    }
  }

  async sendSms(lead: Lead, content: string) {
    if (!lead.phone) {
      logger.warn("[sequence-processor] Lead has no phone number", { metadata: { leadId: lead.id } });
      return;
    }

    // ── TCPA gate #1: consent + DNC + STOP history ──────────────────────
    const channelCheck = canSendViaChannel(lead, 'sms');
    if (!channelCheck.allowed) {
      logger.warn("[sequence-processor] SMS blocked for lead", { metadata: { leadId: lead.id, reason: channelCheck.reason } });
      return;
    }

    // ── TCPA gate #2: quiet hours in recipient's local time ─────────────
    // Lifecycle sequences fire on a schedule the founder didn't manually
    // pick — a 9:00 AM batch in the org's TZ might be 6:00 AM for a
    // Pacific lead. Block now and let the next scheduler tick retry.
    const quiet = isWithinQuietHoursForLead(lead as any);
    if (quiet.blocked) {
      logger.info("[sequence-processor] SMS deferred — quiet hours", {
        metadata: { leadId: lead.id, zone: quiet.zone, reason: quiet.reason },
      });
      return;
    }

    // ── TCPA gate #3: autonomy guardrails (daily rate cap + DNC double-
    // check at send-site). For sequenced sends this is "supervised"
    // autonomy — guardrails enforce per-org daily limits.
    try {
      const { checkSendRateLimit, recordAutonomousSend, checkTcpaBeforeSend } =
        await import("./autonomyGuardrails");
      // 2026-06-10 (T0-5): checkTcpaBeforeSend is now org-scoped, so resolve
      // the org BEFORE the guard. A lead without an orgId never sent anyway
      // (the send was already inside `if (orgId)`) — now it's explicit.
      const orgId = (lead as any).organizationId as number | undefined;
      if (!orgId) {
        logger.warn("[sequence-processor] SMS skipped — lead has no organizationId", {
          metadata: { leadId: lead.id },
        });
        return;
      }
      const tcpaGuard = await checkTcpaBeforeSend(orgId, lead.id);
      if (!tcpaGuard.allowed) {
        logger.warn("[sequence-processor] SMS blocked by guardrail", {
          metadata: { leadId: lead.id, reason: tcpaGuard.reason },
        });
        return;
      }
      const rate = await checkSendRateLimit(orgId, "sms");
      if (!rate.allowed) {
        logger.warn("[sequence-processor] SMS deferred — rate limit", {
          metadata: { leadId: lead.id, reason: rate.reason },
        });
        return;
      }
      // Actually send via org-aware SMS path (handles BYOK + ledger).
      const { sendOrgSMS } = await import("./smsService");
      const result = await sendOrgSMS(orgId, lead.phone, content);
      if (!result.success) {
        logger.warn("[sequence-processor] SMS send failed", {
          metadata: { leadId: lead.id, error: result.error },
        });
        return;
      }
      await recordAutonomousSend(orgId, "sms", lead.id, content);
      logger.info("[sequence-processor] SMS sent", {
        metadata: { phone: lead.phone, contentPreview: content.substring(0, 50), messageId: result.messageId },
      });
    } catch (err: any) {
      logger.error("[sequence-processor] SMS send pipeline error", err, { metadata: { leadId: lead.id } });
    }
  }

  async sendDirectMail(lead: Lead, subject: string, content: string) {
    if (!lead.address || !lead.city || !lead.state || !lead.zip) {
      logger.warn("[sequence-processor] Lead has incomplete address for direct mail", { metadata: { leadId: lead.id } });
      return;
    }

    const channelCheck = canSendViaChannel(lead, 'direct_mail');
    if (!channelCheck.allowed) {
      logger.warn("[sequence-processor] Direct mail blocked for lead", { metadata: { leadId: lead.id, reason: channelCheck.reason } });
      return;
    }

    // REAL SEND (product-truth audit): this step was a log-only stub —
    // "Direct mail sent" with no Lob call — so automated cadences silently
    // dropped their mail touch. Route through the same governed MailRouter →
    // Lob path the campaign blast uses (handles provider choice + the ledger).
    // Honest failure logging on missing config / sender identity, mirroring the
    // email/SMS steps above (never a fake success).
    const orgId = (lead as any).organizationId as number | undefined;
    if (!orgId) {
      logger.warn("[sequence-processor] Direct mail skipped — lead has no organizationId", { metadata: { leadId: lead.id } });
      return;
    }
    try {
      const { MailRouter } = await import("./mail/router");
      const route = await new MailRouter().route({
        customerId: orgId,
        organizationId: orgId,
        pieces: [
          {
            recipient: {
              firstName: lead.firstName ?? undefined,
              lastName: lead.lastName ?? undefined,
              address1: lead.address,
              city: lead.city,
              state: lead.state,
              zip: lead.zip,
            },
            pieceType: "letter_10",
            vars: { htmlContent: content },
          },
        ],
        speed: "standard",
        personalizationRequired: false,
        feature: "sequence_cadence",
      });
      logger.info("[sequence-processor] Direct mail SENT", {
        metadata: { leadId: lead.id, provider: route.chosenProvider, pieceId: route.result.pieces[0]?.providerPieceId },
      });
    } catch (err: any) {
      logger.warn("[sequence-processor] Direct mail send unavailable/failed", {
        metadata: { leadId: lead.id, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  async pauseEnrollmentOnResponse(leadId: number) {
    try {
      const enrollments = await storage.getLeadEnrollments(leadId);
      const activeEnrollments = enrollments.filter(e => e.status === "active");
      
      for (const enrollment of activeEnrollments) {
        await storage.pauseEnrollment(enrollment.id, "Lead responded");
        logger.info("[sequence-processor] Paused enrollment due to lead response", { metadata: { enrollmentId: enrollment.id } });
      }
    } catch (error) {
      logger.error("[sequence-processor] Error pausing enrollments for lead", error, { metadata: { leadId } });
    }
  }
}

export const sequenceProcessorService = new SequenceProcessorService();

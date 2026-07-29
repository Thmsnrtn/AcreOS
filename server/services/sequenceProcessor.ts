import { storage, db } from "../storage";
import type { SequenceEnrollment, SequenceStep, CampaignSequence, Lead } from "@shared/schema";
import { campaignDeliveryEvents } from "@shared/schema";
import {
  checkTcpaConsentFromLead,
  canSendViaChannel,
  isWithinQuietHoursForLead,
} from "./tcpaCompliance";
import {
  frequencyGateForLead,
  describeFrequencySkip,
  recordContactTouch,
  type ContactChannel,
} from "./compliance/contactFrequency";
import crypto from "crypto";
import { logger } from '../utils/logger';

type EnrollmentWithDetails = SequenceEnrollment & { sequence: CampaignSequence; lead: Lead };

/**
 * Outcome of one attempted step send. `sendStep` used to return void, which
 * meant the caller logged "Sent message" and wrote a campaign_delivery_events
 * row with status "sent" even when the channel helper had bailed out (no
 * phone, quiet hours, TCPA block). A skipped send must never be recorded as
 * sent — this type is how the caller finds out what actually happened.
 */
export type StepSendStatus = "sent" | "skipped" | "deferred" | "failed";

export interface StepSendResult {
  status: StepSendStatus;
  reason?: string;
  /** When deferred, the earliest time the step should be retried. */
  retryAt?: Date;
}

const CHECK_INTERVAL_MS = 60 * 1000;
const JOB_LOCK_TTL_SECONDS = 55; // Slightly less than interval

/**
 * Floor on how soon a frequency-deferred step is retried. The cap's own
 * next-eligible time is normally hours or days out; this only guards against
 * a clock-skew value in the past turning the deferral into a hot retry loop.
 */
const MIN_DEFER_MS = 15 * 60 * 1000;

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

      // Reset the crash-resume cursor once the batch is drained. The cursor
      // exists so a crash mid-batch doesn't re-send the enrollments already
      // processed in THIS run; left at its high-water mark it also excluded
      // every lower-id enrollment from all FUTURE runs — including a step we
      // deliberately deferred (frequency cap) and promised to retry. Due-ness
      // is already bounded by nextStepScheduledAt, so resetting is safe.
      await storage.updateJobCursor(JOB_TYPE, 0, 'idle');
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
        const outcome = await this.sendStep(enrollment, nextStep);

        // DEFERRED (contact-frequency cap, quiet hours): the step is NOT
        // consumed. currentStep stays put and the enrollment is rescheduled
        // for the moment the refusal clears, so the drip resumes instead of
        // silently losing a touch. The reason is recorded, not swallowed.
        if (outcome.status === "deferred") {
          const retryAt = this.clampRetryAt(outcome.retryAt);
          await storage.updateSequenceEnrollment(enrollment.id, {
            nextStepScheduledAt: retryAt,
          });
          logger.info("[sequence-processor] Step deferred — will retry", {
            metadata: {
              enrollmentId: enrollment.id,
              stepNumber: nextStep.stepNumber,
              channel: nextStep.channel,
              reason: outcome.reason,
              retryAt: retryAt.toISOString(),
            },
          });
          return;
        }

        const furtherStep = steps.find(s => s.stepNumber === nextStepNumber + 1);
        if (furtherStep) {
          const nextScheduledAt = new Date();
          nextScheduledAt.setDate(nextScheduledAt.getDate() + furtherStep.delayDays);

          await storage.updateSequenceEnrollment(enrollment.id, {
            currentStep: nextStepNumber,
            // Only stamp lastStepSentAt when something was ACTUALLY sent.
            // A skipped/failed step must not look like a delivered one.
            ...(outcome.status === "sent" ? { lastStepSentAt: new Date() } : {}),
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

  /** Never let a bad/absent next-eligible time turn a deferral into a hot loop. */
  clampRetryAt(retryAt?: Date): Date {
    const floor = Date.now() + MIN_DEFER_MS;
    if (!retryAt || Number.isNaN(retryAt.getTime()) || retryAt.getTime() < floor) {
      return new Date(floor);
    }
    return retryAt;
  }

  /**
   * Send one sequence step.
   *
   * GATE ORDER (never reordered, never bypassed):
   *   1. TCPA consent / doNotContact  — canSendViaChannel
   *   2. Recipient-local quiet hours  — SMS only, DST-correct
   *   3. Contact-frequency cap        — the fatigue detector's `suppress`
   *      verdict, now enforced rather than merely reported
   * Frequency is only ever an ADDITIONAL refusal; it is reached only when the
   * two gates above have already allowed the send.
   *
   * Returns what ACTUALLY happened. Only a "sent" outcome writes a
   * status:"sent" delivery event and a contact-touch row.
   */
  async sendStep(enrollment: EnrollmentWithDetails, step: SequenceStep): Promise<StepSendResult> {
    const lead = enrollment.lead;
    const channel = step.channel as ContactChannel;

    // ── Gate 1: consent ──────────────────────────────────────────────────
    const channelCheck = canSendViaChannel(lead, step.channel as 'email' | 'sms' | 'direct_mail');
    if (!channelCheck.allowed) {
      logger.warn("[sequence-processor] TCPA blocked channel", { metadata: { channel: step.channel, leadId: lead.id, reason: channelCheck.reason } });
      await this.recordStepSkip(enrollment, step, `TCPA: ${channelCheck.reason ?? "consent missing"}`);
      return { status: "skipped", reason: channelCheck.reason };
    }

    // ── Gate 2: quiet hours (SMS) ────────────────────────────────────────
    // Hoisted ahead of the frequency check so quiet hours keeps precedence:
    // a night-time send is deferred as a quiet-hours refusal, with its own
    // honest reason, exactly as before.
    if (step.channel === "sms") {
      const quiet = isWithinQuietHoursForLead(lead);
      if (quiet.blocked) {
        logger.info("[sequence-processor] SMS deferred — quiet hours", {
          metadata: { leadId: lead.id, zone: quiet.zone, reason: quiet.reason },
        });
        return { status: "deferred", reason: `quiet hours: ${quiet.reason ?? "recipient-local quiet hours"}` };
      }
    }

    // ── Gate 3: contact-frequency cap ────────────────────────────────────
    const orgId = lead.organizationId;
    if (orgId) {
      const frequency = await frequencyGateForLead(orgId, lead.id);
      if (!frequency.allowed) {
        const reason = describeFrequencySkip(frequency);
        logger.warn("[sequence-processor] Step deferred — contact-frequency cap", {
          metadata: {
            enrollmentId: enrollment.id,
            leadId: lead.id,
            channel: step.channel,
            stepNumber: step.stepNumber,
            reason,
          },
        });
        await this.recordStepSkip(enrollment, step, reason);
        return { status: "deferred", reason, retryAt: frequency.nextEligibleAt };
      }
    }

    const personalizedContent = this.personalizeContent(step.content, lead);
    const personalizedSubject = step.subject ? this.personalizeContent(step.subject, lead) : undefined;

    try {
      let result: StepSendResult;
      switch (step.channel) {
        case "email":
          result = await this.sendEmail(lead, personalizedSubject || "Follow-up", personalizedContent);
          break;

        case "sms":
          result = await this.sendSms(lead, personalizedContent);
          break;

        case "direct_mail":
          result = await this.sendDirectMail(lead, personalizedSubject || "Follow-up", personalizedContent);
          break;

        default:
          result = { status: "skipped", reason: `unknown channel "${step.channel}"` };
      }

      if (result.status !== "sent") {
        // Refuse-not-fabricate: no "Sent message" log, no status:"sent"
        // delivery row. The operator sees the real outcome and its reason.
        logger.info("[sequence-processor] Step not sent", {
          metadata: { channel: step.channel, leadId: lead.id, enrollmentId: enrollment.id, stepNumber: step.stepNumber, status: result.status, reason: result.reason },
        });
        if (result.status !== "deferred") {
          await this.recordStepSkip(enrollment, step, result.reason ?? result.status, result.status);
        }
        return result;
      }

      logger.info("[sequence-processor] Sent message", { metadata: { channel: step.channel, leadId: lead.id, enrollmentId: enrollment.id, stepNumber: step.stepNumber } });

      // Contact-frequency ledger. SMS records its own touch inside the send
      // choke point (sendOrgSMS), so recording it again here would
      // double-count one message; email and direct mail have no choke point
      // of their own, so the touch is recorded here — after a real send.
      if (orgId && step.channel !== "sms") {
        await recordContactTouch({
          organizationId: orgId,
          leadId: lead.id,
          channel,
          description: `${String(step.channel).toUpperCase()} sent (sequence step ${step.stepNumber})`,
          metadata: { enrollmentId: enrollment.id, stepNumber: step.stepNumber, source: "sequence" },
        });
      }

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
      return result;
    } catch (error) {
      logger.error("[sequence-processor] Failed to send message", error, { metadata: { channel: step.channel, enrollmentId: enrollment.id } });
      return { status: "failed", reason: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Surface a non-send to the operator on the SAME timeline the sends appear
   * on (campaign delivery events), with the honest reason attached. Status is
   * "skipped"/"deferred"/"failed" — never "sent".
   */
  async recordStepSkip(
    enrollment: EnrollmentWithDetails,
    step: SequenceStep,
    reason: string,
    status: Exclude<StepSendStatus, "sent"> = "deferred",
  ): Promise<void> {
    try {
      const campaignId = enrollment.lead.sourceCampaignId || enrollment.lead.campaignId;
      if (!campaignId) return;
      await db.insert(campaignDeliveryEvents).values({
        campaignId,
        leadId: enrollment.lead.id,
        channel: step.channel,
        status,
        sentAt: null,
        statusUpdatedAt: new Date(),
        metadata: {
          enrollmentId: enrollment.id,
          stepNumber: step.stepNumber,
          skipReason: reason,
        },
      });
    } catch (trackErr) {
      logger.warn("[sequence-processor] Failed to record step skip", { metadata: { error: String(trackErr) } });
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

  async sendEmail(lead: Lead, subject: string, content: string): Promise<StepSendResult> {
    if (!lead.email) {
      logger.warn("[sequence-processor] Lead has no email address", { metadata: { leadId: lead.id } });
      return { status: "skipped", reason: "lead has no email address" };
    }

    const channelCheck = canSendViaChannel(lead, 'email');
    if (!channelCheck.allowed) {
      logger.warn("[sequence-processor] Email blocked for lead", { metadata: { leadId: lead.id, reason: channelCheck.reason } });
      return { status: "skipped", reason: channelCheck.reason };
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
          return { status: "failed", reason: sendResult.error ?? "email send failed" };
        }
        return { status: "sent" };
      }
      logger.info("[sequence-processor] Email service not available", { metadata: { wouldSendTo: lead.email } });
      return { status: "skipped", reason: "email service not configured" };
    } catch (error) {
      logger.error("[sequence-processor] Email send failed", error);
      return { status: "failed", reason: error instanceof Error ? error.message : String(error) };
    }
  }

  async sendSms(lead: Lead, content: string): Promise<StepSendResult> {
    if (!lead.phone) {
      logger.warn("[sequence-processor] Lead has no phone number", { metadata: { leadId: lead.id } });
      return { status: "skipped", reason: "lead has no phone number" };
    }

    // ── TCPA gate #1: consent + DNC + STOP history ──────────────────────
    const channelCheck = canSendViaChannel(lead, 'sms');
    if (!channelCheck.allowed) {
      logger.warn("[sequence-processor] SMS blocked for lead", { metadata: { leadId: lead.id, reason: channelCheck.reason } });
      return { status: "skipped", reason: channelCheck.reason };
    }

    // ── TCPA gate #2: quiet hours in recipient's local time ─────────────
    // Lifecycle sequences fire on a schedule the founder didn't manually
    // pick — a 9:00 AM batch in the org's TZ might be 6:00 AM for a
    // Pacific lead. Block now and let the next scheduler tick retry.
    // (Also checked in sendStep ahead of the frequency cap so quiet hours
    // keeps precedence; kept here because this method must stand alone.)
    const quiet = isWithinQuietHoursForLead(lead);
    if (quiet.blocked) {
      logger.info("[sequence-processor] SMS deferred — quiet hours", {
        metadata: { leadId: lead.id, zone: quiet.zone, reason: quiet.reason },
      });
      return { status: "deferred", reason: `quiet hours: ${quiet.reason ?? "recipient-local quiet hours"}` };
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
      const orgId = lead.organizationId;
      if (!orgId) {
        logger.warn("[sequence-processor] SMS skipped — lead has no organizationId", {
          metadata: { leadId: lead.id },
        });
        return { status: "skipped", reason: "lead has no organizationId" };
      }
      const tcpaGuard = await checkTcpaBeforeSend(orgId, lead.id);
      if (!tcpaGuard.allowed) {
        logger.warn("[sequence-processor] SMS blocked by guardrail", {
          metadata: { leadId: lead.id, reason: tcpaGuard.reason },
        });
        return { status: "skipped", reason: tcpaGuard.reason };
      }
      const rate = await checkSendRateLimit(orgId, "sms");
      if (!rate.allowed) {
        logger.warn("[sequence-processor] SMS deferred — rate limit", {
          metadata: { leadId: lead.id, reason: rate.reason },
        });
        return { status: "deferred", reason: rate.reason };
      }
      // Actually send via org-aware SMS path (handles BYOK + ledger, and
      // re-runs the full consent → quiet-hours → DNC → frequency chain at
      // the choke point; a refusal there comes back as !success with the
      // named reason and is NEVER reported as sent).
      const { sendOrgSMS } = await import("./smsService");
      const result = await sendOrgSMS(orgId, lead.phone, content);
      if (!result.success) {
        logger.warn("[sequence-processor] SMS send failed", {
          metadata: { leadId: lead.id, error: result.error },
        });
        // A choke-point refusal (TCPA gate, incl. the frequency cap) is a
        // deferral, not a permanent failure — the step should be retried,
        // not consumed.
        const refused = (result.error ?? "").startsWith("TCPA gate:");
        return { status: refused ? "deferred" : "failed", reason: result.error };
      }
      await recordAutonomousSend(orgId, "sms", lead.id, content);
      logger.info("[sequence-processor] SMS sent", {
        metadata: { phone: lead.phone, contentPreview: content.substring(0, 50), messageId: result.messageId },
      });
      return { status: "sent" };
    } catch (err: any) {
      logger.error("[sequence-processor] SMS send pipeline error", err, { metadata: { leadId: lead.id } });
      return { status: "failed", reason: err instanceof Error ? err.message : String(err) };
    }
  }

  async sendDirectMail(lead: Lead, subject: string, content: string): Promise<StepSendResult> {
    if (!lead.address || !lead.city || !lead.state || !lead.zip) {
      logger.warn("[sequence-processor] Lead has incomplete address for direct mail", { metadata: { leadId: lead.id } });
      return { status: "skipped", reason: "incomplete mailing address" };
    }

    const channelCheck = canSendViaChannel(lead, 'direct_mail');
    if (!channelCheck.allowed) {
      logger.warn("[sequence-processor] Direct mail blocked for lead", { metadata: { leadId: lead.id, reason: channelCheck.reason } });
      return { status: "skipped", reason: channelCheck.reason };
    }

    // REAL SEND (product-truth audit): this step was a log-only stub —
    // "Direct mail sent" with no Lob call — so automated cadences silently
    // dropped their mail touch. Route through the same governed MailRouter →
    // Lob path the campaign blast uses (handles provider choice + the ledger).
    // Honest failure logging on missing config / sender identity, mirroring the
    // email/SMS steps above (never a fake success).
    const orgId = lead.organizationId;
    if (!orgId) {
      logger.warn("[sequence-processor] Direct mail skipped — lead has no organizationId", { metadata: { leadId: lead.id } });
      return { status: "skipped", reason: "lead has no organizationId" };
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
      return { status: "sent" };
    } catch (err: any) {
      logger.warn("[sequence-processor] Direct mail send unavailable/failed", {
        metadata: { leadId: lead.id, error: err instanceof Error ? err.message : String(err) },
      });
      return { status: "failed", reason: err instanceof Error ? err.message : String(err) };
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

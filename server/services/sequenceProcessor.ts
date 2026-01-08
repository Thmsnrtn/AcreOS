import { storage } from "../storage";
import type { SequenceEnrollment, SequenceStep, CampaignSequence, Lead } from "@shared/schema";
import { checkTcpaConsentFromLead, canSendViaChannel } from "./tcpaCompliance";
import crypto from "crypto";

type EnrollmentWithDetails = SequenceEnrollment & { sequence: CampaignSequence; lead: Lead };

const CHECK_INTERVAL_MS = 60 * 1000;
const JOB_LOCK_TTL_SECONDS = 55; // Slightly less than interval

// Instance identifier for job locking
const instanceId = crypto.randomUUID();

export class SequenceProcessorService {
  private isRunning = false;
  private intervalId: NodeJS.Timeout | null = null;

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log("[sequence-processor] Starting sequence processor background job");
    this.intervalId = setInterval(() => this.runWithLock(), CHECK_INTERVAL_MS);
    this.runWithLock();
  }

  private async runWithLock() {
    const acquired = await storage.acquireJobLock('sequence_processor', instanceId, JOB_LOCK_TTL_SECONDS);
    if (!acquired) {
      console.log("[sequence-processor] Lock not acquired, skipping execution");
      return;
    }
    try {
      await this.processEnrollments();
    } finally {
      await storage.releaseJobLock('sequence_processor', instanceId);
    }
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log("[sequence-processor] Stopped sequence processor");
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

      console.log(`[sequence-processor] Processing ${unprocessedEnrollments.length} enrollments due (skipped ${enrollmentsDue.length - unprocessedEnrollments.length} already processed)`);

      let maxProcessedId = lastProcessedId;
      for (const enrollment of unprocessedEnrollments) {
        await this.processEnrollment(enrollment);
        maxProcessedId = Math.max(maxProcessedId, enrollment.id);
        await storage.updateJobCursor(JOB_TYPE, maxProcessedId, 'running');
      }
      
      await storage.setJobStatus(JOB_TYPE, 'idle');
    } catch (error) {
      console.error("[sequence-processor] Error processing enrollments:", error);
      await storage.setJobStatus(JOB_TYPE, 'failed');
    }
  }

  async processEnrollment(enrollment: EnrollmentWithDetails) {
    try {
      const tcpaCheck = checkTcpaConsentFromLead(enrollment.lead);
      if (tcpaCheck.blocked) {
        await storage.pauseEnrollment(enrollment.id, `TCPA blocked: ${tcpaCheck.reason}`);
        console.log(`[sequence-processor] Pausing enrollment ${enrollment.id}: ${tcpaCheck.reason}`);
        return;
      }

      const steps = await storage.getSequenceSteps(enrollment.sequenceId);
      const nextStepNumber = enrollment.currentStep + 1;
      const nextStep = steps.find(s => s.stepNumber === nextStepNumber);

      if (!nextStep) {
        await storage.completeEnrollment(enrollment.id);
        console.log(`[sequence-processor] Enrollment ${enrollment.id} completed (no more steps)`);
        return;
      }

      const channelCheck = canSendViaChannel(enrollment.lead, nextStep.channel as 'email' | 'sms' | 'direct_mail');
      if (!channelCheck.allowed) {
        console.log(`[sequence-processor] Skipping step ${nextStep.stepNumber} for enrollment ${enrollment.id}: ${channelCheck.reason}`);
        
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
          console.log(`[sequence-processor] Enrollment ${enrollment.id} completed`);
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
      console.error(`[sequence-processor] Error processing enrollment ${enrollment.id}:`, error);
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
      console.error(`[sequence-processor] Error checking lead response:`, error);
      return false;
    }
  }

  async sendStep(enrollment: EnrollmentWithDetails, step: SequenceStep) {
    const lead = enrollment.lead;
    
    const channelCheck = canSendViaChannel(lead, step.channel as 'email' | 'sms' | 'direct_mail');
    if (!channelCheck.allowed) {
      console.warn(`[sequence-processor] TCPA blocked ${step.channel} to lead ${lead.id}: ${channelCheck.reason}`);
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

      console.log(`[sequence-processor] Sent ${step.channel} to lead ${lead.id} (enrollment ${enrollment.id}, step ${step.stepNumber})`);
    } catch (error) {
      console.error(`[sequence-processor] Failed to send ${step.channel} for enrollment ${enrollment.id}:`, error);
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
      console.warn(`[sequence-processor] Lead ${lead.id} has no email address`);
      return;
    }

    const channelCheck = canSendViaChannel(lead, 'email');
    if (!channelCheck.allowed) {
      console.warn(`[sequence-processor] Email blocked for lead ${lead.id}: ${channelCheck.reason}`);
      return;
    }

    try {
      const { emailService } = await import("./emailService");
      const configured = await emailService.isConfigured();
      if (configured) {
        await emailService.sendEmail({
          to: lead.email,
          subject,
          html: content,
          text: content.replace(/<[^>]*>/g, ""),
        });
      } else {
        console.log(`[sequence-processor] Email service not available - would send to ${lead.email}`);
      }
    } catch (error) {
      console.error(`[sequence-processor] Email send failed:`, error);
    }
  }

  async sendSms(lead: Lead, content: string) {
    if (!lead.phone) {
      console.warn(`[sequence-processor] Lead ${lead.id} has no phone number`);
      return;
    }

    const channelCheck = canSendViaChannel(lead, 'sms');
    if (!channelCheck.allowed) {
      console.warn(`[sequence-processor] SMS blocked for lead ${lead.id}: ${channelCheck.reason}`);
      return;
    }

    console.log(`[sequence-processor] SMS to ${lead.phone}: ${content.substring(0, 50)}...`);
  }

  async sendDirectMail(lead: Lead, subject: string, content: string) {
    if (!lead.address || !lead.city || !lead.state || !lead.zip) {
      console.warn(`[sequence-processor] Lead ${lead.id} has incomplete address for direct mail`);
      return;
    }

    const channelCheck = canSendViaChannel(lead, 'direct_mail');
    if (!channelCheck.allowed) {
      console.warn(`[sequence-processor] Direct mail blocked for lead ${lead.id}: ${channelCheck.reason}`);
      return;
    }

    console.log(`[sequence-processor] Direct mail to ${lead.firstName} ${lead.lastName} at ${lead.address}`);
  }

  async pauseEnrollmentOnResponse(leadId: number) {
    try {
      const enrollments = await storage.getLeadEnrollments(leadId);
      const activeEnrollments = enrollments.filter(e => e.status === "active");
      
      for (const enrollment of activeEnrollments) {
        await storage.pauseEnrollment(enrollment.id, "Lead responded");
        console.log(`[sequence-processor] Paused enrollment ${enrollment.id} due to lead response`);
      }
    } catch (error) {
      console.error(`[sequence-processor] Error pausing enrollments for lead ${leadId}:`, error);
    }
  }
}

export const sequenceProcessorService = new SequenceProcessorService();

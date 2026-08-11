import { emailService } from './emailService';
import { smsService } from './smsService';
import { storage } from '../storage';
import { checkTcpaConsentFromLead, canSendViaChannel, checkTcpaConsent } from './tcpaCompliance';
import { frequencyGateForLead, describeFrequencySkip } from './compliance/contactFrequency';
import { isPlatformMailConfigured } from './mail/mailLanes';
import { logger } from "../utils/logger";

export interface CommunicationOptions {
  leadId: number;
  organizationId: number;
  subject?: string;
  message: string;
  channel?: 'email' | 'sms' | 'both';
}

export interface CommunicationResult {
  success: boolean;
  channel: string;
  messageId?: string;
  error?: string;
  errorType?: string;
  tcpaBlocked?: boolean;
  /** True when the contact-frequency cap refused the send. */
  frequencyCapped?: boolean;
  retriesExhausted?: boolean;
}

export class CommunicationsService {
  async getChannelStatus(): Promise<{ email: boolean; sms: boolean; directMail: boolean }> {
    return {
      email: await emailService.isConfigured(),
      sms: smsService.isConfigured(),
      // R-2: physical mail is org-scoped — whether THIS org can mail its
      // counterparties is answered by mail/mailLanes.mailLaneStatus(orgId),
      // not by a process-wide env read. This flag now reports only whether a
      // platform mail rail exists at all.
      directMail: isPlatformMailConfigured(),
    };
  }

  async sendToLead(options: CommunicationOptions): Promise<CommunicationResult> {
    const lead = await storage.getLead(options.organizationId, options.leadId);
    if (!lead) {
      return { success: false, channel: 'none', error: 'Lead not found' };
    }

    const tcpaCheck = checkTcpaConsentFromLead(lead);
    
    if (tcpaCheck.blocked) {
      logger.info(`[Communications] All communications blocked for lead ${options.leadId}: ${tcpaCheck.reason}`);
      return { 
        success: false, 
        channel: 'none', 
        error: tcpaCheck.reason,
        tcpaBlocked: true,
      };
    }

    // Contact-frequency cap (2026-07-29). Every send from this service is
    // outreach TO A LEAD — marketing class — so the fatigue detector's
    // `suppress` verdict applies here exactly as it does at the SMS choke
    // point. This is an ADDITIONAL refusal layered after the consent check
    // above; SMS re-evaluates the full consent → quiet-hours → DNC →
    // frequency chain inside sendOrgSMS, so nothing here can bypass it.
    const frequency = await frequencyGateForLead(options.organizationId, options.leadId);
    if (!frequency.allowed) {
      const reason = describeFrequencySkip(frequency);
      logger.warn('[Communications] Send refused by contact-frequency cap', {
        metadata: { leadId: options.leadId, organizationId: options.organizationId, reason },
      });
      return {
        success: false,
        channel: options.channel ?? 'none',
        error: reason,
        frequencyCapped: true,
      };
    }

    const channel = options.channel || this.determinePreferredChannel(lead);

    const channelCheck = canSendViaChannel(lead, channel === 'both' ? 'email' : channel);
    
    if (channel === 'sms') {
      const smsCheck = canSendViaChannel(lead, 'sms');
      if (!smsCheck.allowed) {
        logger.info(`[Communications] SMS blocked for lead ${options.leadId}: ${smsCheck.reason}`);
        return { 
          success: false, 
          channel: 'sms', 
          error: smsCheck.reason,
          tcpaBlocked: true,
        };
      }
    }

    let emailResult: CommunicationResult | null = null;
    let smsResult: CommunicationResult | null = null;

    if (channel === 'email' || channel === 'both') {
      const emailCheck = canSendViaChannel(lead, 'email');
      if (emailCheck.allowed && lead.email) {
        const result = await emailService.sendEmail({
          to: lead.email,
          subject: options.subject || 'Message from AcreOS',
          html: `<p>${options.message}</p>`,
          // Deal mail: must carry the org's own identity (this call previously
          // omitted organizationId entirely, so lead outreach silently went
          // out as platform @acreos.io — the exact leak the counterparty
          // enforcement closes).
          organizationId: options.organizationId,
          purpose: 'counterparty',
        });

        if (result.success) {
          await this.recordCommunication(options.leadId, options.organizationId, 'email', {
            subject: options.subject,
            messageId: result.messageId,
          });
        }

        emailResult = { 
          success: result.success, 
          channel: 'email', 
          messageId: result.messageId, 
          error: result.error 
        };

        if (channel === 'email') {
          return emailResult;
        }
      } else if (!emailCheck.allowed) {
        emailResult = { 
          success: false, 
          channel: 'email', 
          error: emailCheck.reason,
          tcpaBlocked: true,
        };
        if (channel === 'email') {
          return emailResult;
        }
      }
    }

    if (channel === 'sms' || channel === 'both') {
      const smsCheck = canSendViaChannel(lead, 'sms');
      if (!smsCheck.allowed) {
        logger.info(`[Communications] SMS blocked for lead ${options.leadId}: ${smsCheck.reason}`);
        smsResult = { 
          success: false, 
          channel: 'sms', 
          error: smsCheck.reason,
          tcpaBlocked: true,
        };
      } else if (lead.phone) {
        // Route through the ORG-SCOPED choke point rather than the raw
        // sender: sendOrgSMS applies consent → recipient-local quiet hours →
        // DNC → contact-frequency in that order, and records the contact
        // touch itself on success (which is why recordCommunication is not
        // called again here — one send must produce exactly one touch row).
        const { sendOrgSMS } = await import('./smsService');
        const result = await sendOrgSMS(options.organizationId, lead.phone, options.message);

        smsResult = {
          success: result.success, 
          channel: 'sms', 
          messageId: result.messageId, 
          error: result.error 
        };
      }
      
      if (smsResult) {
        return smsResult;
      }
    }

    if (emailResult) {
      return emailResult;
    }

    return { success: false, channel: 'none', error: 'No valid contact method available' };
  }

  private determinePreferredChannel(lead: { email?: string | null; phone?: string | null; tcpaConsent?: boolean | null }): 'email' | 'sms' {
    // Prefer email if available, SMS as fallback for TCPA-consented leads
    if (lead.email) return 'email';
    if (lead.phone && smsService.isConfigured() && lead.tcpaConsent) return 'sms';
    return 'email';
  }

  async recordCommunication(
    leadId: number,
    organizationId: number,
    type: string,
    metadata: Record<string, any>
  ): Promise<void> {
    try {
      await storage.createLeadActivity({
        organizationId,
        leadId,
        type: `communication_${type}`,
        description: `${type.toUpperCase()} sent`,
        metadata,
      });
    } catch (error) {
      logger.error('[Communications] Error recording activity', error);
    }
  }

  async sendCampaign(
    campaignId: number,
    organizationId: number,
    leadIds: number[],
    channel: 'email' | 'sms',
    content: { subject?: string; message: string }
  ): Promise<{ sent: number; failed: number; tcpaBlocked: number; frequencyCapped: number; errors: string[] }> {
    let sent = 0;
    let failed = 0;
    let tcpaBlocked = 0;
    // Counted separately from `failed`: nothing broke — the send was refused
    // because the lead has already been contacted too often.
    let frequencyCapped = 0;
    const errors: string[] = [];

    for (const leadId of leadIds) {
      const tcpaCheck = await checkTcpaConsent(leadId, organizationId);
      
      if (tcpaCheck.blocked) {
        tcpaBlocked++;
        errors.push(`Lead ${leadId}: ${tcpaCheck.reason}`);
        continue;
      }

      if (channel === 'sms' && !tcpaCheck.canSms) {
        tcpaBlocked++;
        errors.push(`Lead ${leadId}: TCPA consent required for SMS`);
        continue;
      }

      const result = await this.sendToLead({
        leadId,
        organizationId,
        channel,
        subject: content.subject,
        message: content.message,
      });

      if (result.success) {
        sent++;
      } else {
        if (result.tcpaBlocked) {
          tcpaBlocked++;
        } else if (result.frequencyCapped) {
          frequencyCapped++;
        } else {
          failed++;
        }
        if (result.error) {
          errors.push(`Lead ${leadId}: ${result.error}`);
        }
      }
    }

    return { sent, failed, tcpaBlocked, frequencyCapped, errors };
  }

  /**
   * R-2 (founder ruling 2026-08-11) — the direct-mail methods that lived here
   * (`sendDirectMailToLead`, `sendDirectMailWithRetry`, `handleDirectMailFailure`)
   * were DELETED with `services/lobService.ts`. They were the repo's only
   * caller of that service, they had zero callers of their own
   * (`sendToLead` dispatches email/sms only), and lobService was the ONE Lob
   * client with no org-credential path at all — env singletons, no
   * organizationId anywhere. See docs/company/deletion-ledger.md.
   *
   * The LIVE physical-mail rails are the outreach queue
   * (`POST /api/outreach/mail/queue` → mailFlusher → MailRouter → lobAdapter),
   * the campaign blast (`POST /api/campaigns/:id/send-direct-mail`), the
   * sequence cadence, and the autopilot `send_letter` hand — all four now
   * resolve credentials through `services/mail/mailLanes.assertMailLane`.
   */

}

export const communicationsService = new CommunicationsService();

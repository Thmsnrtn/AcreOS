import { emailService } from './emailService';
import { smsService } from './smsService';
import { storage } from '../storage';
import { checkTcpaConsentFromLead, canSendViaChannel, checkTcpaConsent } from './tcpaCompliance';

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
  tcpaBlocked?: boolean;
}

export class CommunicationsService {
  getChannelStatus(): { email: boolean; sms: boolean; directMail: boolean } {
    return {
      email: emailService.isConfigured(),
      sms: smsService.isConfigured(),
      directMail: !!process.env.LOB_API_KEY,
    };
  }

  async sendToLead(options: CommunicationOptions): Promise<CommunicationResult> {
    const lead = await storage.getLead(options.organizationId, options.leadId);
    if (!lead) {
      return { success: false, channel: 'none', error: 'Lead not found' };
    }

    const tcpaCheck = checkTcpaConsentFromLead(lead);
    
    if (tcpaCheck.blocked) {
      console.log(`[Communications] All communications blocked for lead ${options.leadId}: ${tcpaCheck.reason}`);
      return { 
        success: false, 
        channel: 'none', 
        error: tcpaCheck.reason,
        tcpaBlocked: true,
      };
    }

    const channel = options.channel || this.determinePreferredChannel(lead);
    
    const channelCheck = canSendViaChannel(lead, channel === 'both' ? 'email' : channel);
    
    if (channel === 'sms') {
      const smsCheck = canSendViaChannel(lead, 'sms');
      if (!smsCheck.allowed) {
        console.log(`[Communications] SMS blocked for lead ${options.leadId}: ${smsCheck.reason}`);
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
        console.log(`[Communications] SMS blocked for lead ${options.leadId}: ${smsCheck.reason}`);
        smsResult = { 
          success: false, 
          channel: 'sms', 
          error: smsCheck.reason,
          tcpaBlocked: true,
        };
      } else if (lead.phone) {
        const result = await smsService.sendSMS({
          to: lead.phone,
          message: options.message,
        });

        if (result.success) {
          await this.recordCommunication(options.leadId, options.organizationId, 'sms', {
            messageId: result.messageId,
          });
        }

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
    if (lead.email && emailService.isConfigured()) return 'email';
    if (lead.phone && smsService.isConfigured() && lead.tcpaConsent) return 'sms';
    if (lead.email) return 'email';
    return 'sms';
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
      console.error('[Communications] Error recording activity:', error);
    }
  }

  async sendCampaign(
    campaignId: number,
    organizationId: number,
    leadIds: number[],
    channel: 'email' | 'sms',
    content: { subject?: string; message: string }
  ): Promise<{ sent: number; failed: number; tcpaBlocked: number; errors: string[] }> {
    let sent = 0;
    let failed = 0;
    let tcpaBlocked = 0;
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
        } else {
          failed++;
        }
        if (result.error) {
          errors.push(`Lead ${leadId}: ${result.error}`);
        }
      }
    }

    return { sent, failed, tcpaBlocked, errors };
  }

  async sendDirectMailToLead(
    leadId: number,
    organizationId: number,
    content: { subject: string; body: string }
  ): Promise<CommunicationResult> {
    const lead = await storage.getLead(organizationId, leadId);
    if (!lead) {
      return { success: false, channel: 'direct_mail', error: 'Lead not found' };
    }

    const channelCheck = canSendViaChannel(lead, 'direct_mail');
    if (!channelCheck.allowed) {
      console.log(`[Communications] Direct mail blocked for lead ${leadId}: ${channelCheck.reason}`);
      return { 
        success: false, 
        channel: 'direct_mail', 
        error: channelCheck.reason,
        tcpaBlocked: true,
      };
    }

    if (!lead.address || !lead.city || !lead.state || !lead.zip) {
      return { 
        success: false, 
        channel: 'direct_mail', 
        error: 'Incomplete address for direct mail' 
      };
    }

    console.log(`[Communications] Direct mail to ${lead.firstName} ${lead.lastName} at ${lead.address}`);
    
    await this.recordCommunication(leadId, organizationId, 'direct_mail', {
      subject: content.subject,
      address: lead.address,
    });

    return { success: true, channel: 'direct_mail' };
  }
}

export const communicationsService = new CommunicationsService();

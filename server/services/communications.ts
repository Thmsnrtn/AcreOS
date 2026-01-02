import { emailService, EmailOptions } from './emailService';
import { smsService, SmsOptions } from './smsService';
import { storage } from '../storage';

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

    const channel = options.channel || this.determinePreferredChannel(lead);

    if (channel === 'email' || channel === 'both') {
      if (lead.email) {
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

        if (channel === 'email') {
          return { success: result.success, channel: 'email', messageId: result.messageId, error: result.error };
        }
      }
    }

    if (channel === 'sms' || channel === 'both') {
      if (lead.phone) {
        const result = await smsService.sendSMS({
          to: lead.phone,
          message: options.message,
        });

        if (result.success) {
          await this.recordCommunication(options.leadId, options.organizationId, 'sms', {
            messageId: result.messageId,
          });
        }

        return { success: result.success, channel: 'sms', messageId: result.messageId, error: result.error };
      }
    }

    return { success: false, channel: 'none', error: 'No valid contact method available' };
  }

  private determinePreferredChannel(lead: { email?: string | null; phone?: string | null }): 'email' | 'sms' {
    if (lead.email && emailService.isConfigured()) return 'email';
    if (lead.phone && smsService.isConfigured()) return 'sms';
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
  ): Promise<{ sent: number; failed: number; errors: string[] }> {
    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const leadId of leadIds) {
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
        failed++;
        if (result.error) {
          errors.push(`Lead ${leadId}: ${result.error}`);
        }
      }
    }

    return { sent, failed, errors };
  }
}

export const communicationsService = new CommunicationsService();

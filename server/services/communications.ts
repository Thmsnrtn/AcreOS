import { emailService } from './emailService';
import { smsService } from './smsService';
import { storage } from '../storage';
import { checkTcpaConsentFromLead, canSendViaChannel, checkTcpaConsent } from './tcpaCompliance';
import { lobService, LobErrorType } from './lobService';
import { apiQueueService } from './apiQueue';

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
  lobMailingId?: string;
  expectedDeliveryDate?: string;
  error?: string;
  errorType?: LobErrorType;
  tcpaBlocked?: boolean;
  retriesExhausted?: boolean;
}

export interface DirectMailContent {
  subject: string;
  body: string;
  htmlContent?: string;
}

const RETRY_DELAYS = [1000, 2000, 4000];
const MAX_RETRIES = 3;

export class CommunicationsService {
  async getChannelStatus(): Promise<{ email: boolean; sms: boolean; directMail: boolean }> {
    return {
      email: await emailService.isConfigured(),
      sms: smsService.isConfigured(),
      directMail: !!process.env.LOB_API_KEY || !!process.env.LOB_TEST_API_KEY || !!process.env.LOB_LIVE_API_KEY,
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
          subject: options.subject || 'Message from Acreage Land Co.',
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
    content: DirectMailContent
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

    if (!lobService.isConfigured()) {
      console.error('[Communications] Lob service not configured - LOB_TEST_API_KEY or LOB_LIVE_API_KEY required');
      return {
        success: false,
        channel: 'direct_mail',
        error: 'Direct mail service not configured',
      };
    }

    const result = await this.sendDirectMailWithRetry(leadId, organizationId, {
      firstName: lead.firstName,
      lastName: lead.lastName,
      address: lead.address,
      city: lead.city,
      state: lead.state,
      zip: lead.zip,
    }, content);
    return result;
  }

  async sendDirectMailWithRetry(
    leadId: number,
    organizationId: number,
    lead: { firstName: string; lastName: string; address: string; city: string; state: string; zip: string },
    content: DirectMailContent,
    attempt: number = 0
  ): Promise<CommunicationResult> {
    const org = await storage.getOrganization(organizationId);
    const mailMode = org?.settings?.mailMode === 'live' ? 'live' : 'test';

    const fromAddress = {
      name: org?.name || 'Acreage Land Co.',
      addressLine1: org?.settings?.companyAddress || '123 Main St',
      city: 'Austin',
      state: 'TX',
      zip: '78701',
    };

    const toAddress = {
      name: `${lead.firstName} ${lead.lastName}`,
      addressLine1: lead.address,
      city: lead.city,
      state: lead.state,
      zip: lead.zip,
    };

    console.log(`[Communications] Sending direct mail to ${toAddress.name} at ${toAddress.addressLine1} (attempt ${attempt + 1}/${MAX_RETRIES})`);

    const letterHtml = content.htmlContent || `
      <html>
        <body>
          <h1>${content.subject}</h1>
          <p>${content.body}</p>
        </body>
      </html>
    `;

    const lobResult = await lobService.sendLetter(
      {
        to: toAddress,
        from: fromAddress,
        file: letterHtml,
        color: false,
        doubleSided: false,
      },
      mailMode
    );

    if (lobResult.success) {
      console.log(`[Communications] Direct mail sent successfully to lead ${leadId}, lob_mailing_id: ${lobResult.lobMailingId}`);
      
      await this.recordCommunication(leadId, organizationId, 'direct_mail', {
        subject: content.subject,
        address: lead.address,
        lob_mailing_id: lobResult.lobMailingId,
        expected_delivery_date: lobResult.expectedDeliveryDate,
        is_test_mode: lobResult.isTestMode,
      });

      return {
        success: true,
        channel: 'direct_mail',
        lobMailingId: lobResult.lobMailingId,
        expectedDeliveryDate: lobResult.expectedDeliveryDate,
      };
    }

    console.error(`[Communications] Direct mail failed for lead ${leadId}:`, {
      attempt: attempt + 1,
      errorType: lobResult.errorType,
      error: lobResult.error,
    });

    if (lobResult.errorType && lobService.isRetryableError(lobResult.errorType) && attempt < MAX_RETRIES - 1) {
      const delay = RETRY_DELAYS[attempt];
      console.log(`[Communications] Retrying direct mail for lead ${leadId} in ${delay}ms (attempt ${attempt + 2}/${MAX_RETRIES})`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
      return this.sendDirectMailWithRetry(leadId, organizationId, lead, content, attempt + 1);
    }

    if (attempt >= MAX_RETRIES - 1 || (lobResult.errorType && !lobService.isRetryableError(lobResult.errorType))) {
      await this.handleDirectMailFailure(leadId, organizationId, lead, content, lobResult.errorType, lobResult.error);
    }

    return {
      success: false,
      channel: 'direct_mail',
      error: lobResult.error,
      errorType: lobResult.errorType,
      retriesExhausted: attempt >= MAX_RETRIES - 1,
    };
  }

  private async handleDirectMailFailure(
    leadId: number,
    organizationId: number,
    lead: { firstName: string; lastName: string; address: string },
    content: DirectMailContent,
    errorType?: LobErrorType,
    errorMessage?: string
  ): Promise<void> {
    console.error(`[Communications] Direct mail retries exhausted for lead ${leadId}:`, {
      errorType,
      errorMessage,
      recipient: `${lead.firstName} ${lead.lastName}`,
      address: lead.address,
    });

    await apiQueueService.enqueue(
      'lob',
      'sendLetter',
      {
        leadId,
        organizationId,
        toName: `${lead.firstName} ${lead.lastName}`,
        toAddress: lead.address,
        subject: content.subject,
        body: content.body,
        failureReason: errorMessage,
        failureType: errorType,
      },
      organizationId,
      2
    );

    try {
      await storage.createSystemAlert({
        type: 'direct_mail_failure',
        alertType: 'system_error',
        severity: errorType === 'insufficient_funds' ? 'critical' : 'warning',
        title: 'Direct Mail Send Failed',
        message: `Failed to send direct mail to ${lead.firstName} ${lead.lastName} after ${MAX_RETRIES} retries. Error: ${errorMessage || 'Unknown error'}`,
        organizationId,
        relatedEntityType: 'lead',
        relatedEntityId: leadId,
        status: 'new',
        metadata: {
          leadId,
          recipientName: `${lead.firstName} ${lead.lastName}`,
          recipientAddress: lead.address,
          errorType,
          errorMessage,
          subject: content.subject,
          retriesAttempted: MAX_RETRIES,
        },
      });
      console.log(`[Communications] System alert created for direct mail failure to lead ${leadId}`);
    } catch (alertError) {
      console.error('[Communications] Failed to create system alert:', alertError);
    }
  }
}

export const communicationsService = new CommunicationsService();

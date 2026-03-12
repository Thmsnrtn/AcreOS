import { SESClient, SendEmailCommand, GetSendQuotaCommand } from '@aws-sdk/client-ses';
import { storage } from '../storage';
import { decryptJsonCredentials } from './encryption';

interface AWSCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  fromEmail: string;
  fromName?: string;
  source: 'organization' | 'platform';
}

export type EmailErrorType = 
  | 'sender_not_verified'
  | 'recipient_rejected'
  | 'rate_limit'
  | 'quota_exceeded'
  | 'configuration_error'
  | 'network_error'
  | 'unknown';

interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
};

const RETRYABLE_ERRORS = new Set([
  'Throttling',
  'ServiceUnavailable',
  'InternalFailure',
  'RequestTimeout',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
]);

function isRetryableError(error: any): boolean {
  if (!error) return false;
  const errorName = error.name || error.code || '';
  return RETRYABLE_ERRORS.has(errorName) || 
         errorName.includes('Throttl') || 
         errorName.includes('ServiceUnavailable') ||
         error.message?.includes('rate') ||
         error.message?.includes('throttl');
}

function categorizeError(error: any): EmailErrorType {
  const errorName = error.name || error.code || '';
  const errorMessage = (error.message || '').toLowerCase();
  
  if (errorName === 'MessageRejected' || errorMessage.includes('rejected')) {
    if (errorMessage.includes('not verified')) return 'sender_not_verified';
    return 'recipient_rejected';
  }
  if (errorName === 'MailFromDomainNotVerifiedException' || errorMessage.includes('not verified')) {
    return 'sender_not_verified';
  }
  if (errorName === 'Throttling' || errorMessage.includes('rate') || errorMessage.includes('throttl')) {
    return 'rate_limit';
  }
  if (errorName === 'LimitExceededException' || errorMessage.includes('quota') || errorMessage.includes('limit exceeded')) {
    return 'quota_exceeded';
  }
  if (errorName === 'ConfigurationSetDoesNotExistException' || errorMessage.includes('configuration')) {
    return 'configuration_error';
  }
  if (errorName.includes('ECONNRESET') || errorName.includes('ETIMEDOUT') || errorName.includes('ENOTFOUND')) {
    return 'network_error';
  }
  return 'unknown';
}

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function calculateBackoff(attempt: number, config: RetryConfig): number {
  const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * 0.3 * exponentialDelay;
  return Math.min(exponentialDelay + jitter, config.maxDelayMs);
}

function getPlatformCredentials(): AWSCredentials {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const region = process.env.AWS_SES_REGION || process.env.AWS_REGION || 'us-east-1';
  const fromEmail = process.env.AWS_SES_FROM_EMAIL;

  if (!accessKeyId || !secretAccessKey) {
    throw new Error('AWS credentials not configured (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)');
  }

  if (!fromEmail) {
    throw new Error('AWS SES from email not configured (AWS_SES_FROM_EMAIL)');
  }

  return {
    accessKeyId,
    secretAccessKey,
    region,
    fromEmail,
    fromName: process.env.AWS_SES_FROM_NAME || 'AcreOS',
    source: 'platform',
  };
}

async function getOrgCredentials(orgId: number): Promise<AWSCredentials | null> {
  try {
    const integration = await storage.getOrganizationIntegration(orgId, 'aws_ses');
    
    if (!integration || !integration.isEnabled || !integration.credentials?.encrypted) {
      return null;
    }
    
    const decrypted = decryptJsonCredentials<{
      accessKeyId: string;
      secretAccessKey: string;
      region?: string;
      fromEmail?: string;
      fromName?: string;
    }>(integration.credentials.encrypted, orgId);
    
    if (!decrypted.accessKeyId || !decrypted.secretAccessKey) {
      return null;
    }
    
    const domains = await storage.getVerifiedEmailDomains(orgId);
    const defaultDomain = domains.find(d => d.isDefault && d.status === 'verified') || 
                          domains.find(d => d.status === 'verified');
    
    let fromEmail = decrypted.fromEmail || defaultDomain?.fromEmail;
    let fromName = decrypted.fromName || defaultDomain?.fromName;
    
    if (!fromEmail) {
      try {
        const platformCreds = getPlatformCredentials();
        fromEmail = platformCreds.fromEmail;
        console.log('[EmailService] Using platform from-email for org-specific AWS credentials');
      } catch {
        console.warn('[EmailService] Org credentials have no verified sender and platform fallback unavailable');
        return null;
      }
    }
    
    return {
      accessKeyId: decrypted.accessKeyId,
      secretAccessKey: decrypted.secretAccessKey,
      region: decrypted.region || 'us-east-1',
      fromEmail,
      fromName: fromName || undefined,
      source: 'organization',
    };
  } catch (error) {
    console.error('[EmailService] Failed to get org credentials:', error);
    return null;
  }
}

async function getCredentials(orgId?: number): Promise<AWSCredentials> {
  if (orgId) {
    const orgCreds = await getOrgCredentials(orgId);
    if (orgCreds) {
      return orgCreds;
    }
  }
  return getPlatformCredentials();
}

function createSESClient(creds: AWSCredentials): SESClient {
  return new SESClient({
    region: creds.region,
    credentials: {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
    },
  });
}

export async function getSESClient(orgId?: number) {
  const creds = await getCredentials(orgId);
  return {
    client: createSESClient(creds),
    fromEmail: creds.fromEmail,
    fromName: creds.fromName,
    source: creds.source,
    region: creds.region,
  };
}

export interface EmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  fromName?: string;
  replyTo?: string;
  organizationId?: number;
  tags?: Record<string, string>;
  retryConfig?: Partial<RetryConfig>;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
  errorType?: EmailErrorType;
  attempts?: number;
  retryable?: boolean;
}

export interface EmailLogEntry {
  timestamp: Date;
  to: string;
  subject: string;
  status: 'sent' | 'failed';
  messageId?: string;
  error?: string;
  errorType?: EmailErrorType;
  attempts: number;
  organizationId?: number;
  durationMs: number;
}

export class EmailService {
  private recentLogs: EmailLogEntry[] = [];
  private maxLogEntries = 100;

  async isConfigured(orgId?: number): Promise<boolean> {
    try {
      await getCredentials(orgId);
      return true;
    } catch {
      return false;
    }
  }

  async getDefaultFromEmail(orgId?: number): Promise<string | null> {
    try {
      const creds = await getCredentials(orgId);
      return creds.fromEmail;
    } catch {
      return null;
    }
  }

  async sendEmail(options: EmailOptions): Promise<EmailResult> {
    const startTime = Date.now();
    const config: RetryConfig = {
      ...DEFAULT_RETRY_CONFIG,
      ...options.retryConfig,
    };
    
    const toAddresses = Array.isArray(options.to) ? options.to : [options.to];
    let lastError: any = null;
    let attempts = 0;
    
    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      attempts = attempt + 1;
      
      try {
        const { client, fromEmail: defaultFromEmail, fromName: defaultFromName, source } = 
          await getSESClient(options.organizationId);
        
        const fromAddress = options.from || defaultFromEmail;
        const fromNameFinal = options.fromName || defaultFromName || 'AcreOS';
        const fromFormatted = `${fromNameFinal} <${fromAddress}>`;

        const command = new SendEmailCommand({
          Source: fromFormatted,
          Destination: {
            ToAddresses: toAddresses,
          },
          Message: {
            Subject: {
              Data: options.subject,
              Charset: 'UTF-8',
            },
            Body: {
              Html: {
                Data: options.html,
                Charset: 'UTF-8',
              },
              Text: {
                Data: options.text || this.htmlToText(options.html),
                Charset: 'UTF-8',
              },
            },
          },
          ReplyToAddresses: options.replyTo ? [options.replyTo] : undefined,
        });

        const response = await client.send(command);
        const messageId = response.MessageId || `ses-${Date.now()}`;
        const durationMs = Date.now() - startTime;
        
        this.log({
          timestamp: new Date(),
          to: toAddresses.join(', '),
          subject: options.subject,
          status: 'sent',
          messageId,
          attempts,
          organizationId: options.organizationId,
          durationMs,
        });
        
        console.log(`[EmailService] Email sent via AWS SES (${source}) to ${toAddresses.join(', ')}, MessageId: ${messageId}, attempts: ${attempts}, duration: ${durationMs}ms`);
        
        return { success: true, messageId, attempts };
      } catch (error: any) {
        lastError = error;
        const errorType = categorizeError(error);
        const retryable = isRetryableError(error);
        
        console.warn(`[EmailService] Send attempt ${attempts} failed:`, {
          error: error.message,
          errorType,
          retryable,
          to: toAddresses.join(', '),
        });
        
        if (!retryable || attempt >= config.maxRetries) {
          break;
        }
        
        const backoffMs = calculateBackoff(attempt, config);
        console.log(`[EmailService] Retrying in ${backoffMs}ms (attempt ${attempt + 2}/${config.maxRetries + 1})`);
        await delay(backoffMs);
      }
    }
    
    const errorType = categorizeError(lastError);
    const errorMessage = this.formatErrorMessage(lastError, errorType);
    const durationMs = Date.now() - startTime;
    
    this.log({
      timestamp: new Date(),
      to: toAddresses.join(', '),
      subject: options.subject,
      status: 'failed',
      error: errorMessage,
      errorType,
      attempts,
      organizationId: options.organizationId,
      durationMs,
    });
    
    console.error('[EmailService] Failed to send email after all attempts:', {
      error: errorMessage,
      errorType,
      attempts,
      to: toAddresses.join(', '),
      durationMs,
    });
    
    return { 
      success: false, 
      error: errorMessage, 
      errorType, 
      attempts,
      retryable: isRetryableError(lastError),
    };
  }

  async sendBulkEmails(
    emails: EmailOptions[], 
    orgId?: number, 
    options?: { 
      concurrency?: number;
      rateLimitDelayMs?: number;
    }
  ): Promise<{ results: EmailResult[]; summary: { sent: number; failed: number; total: number } }> {
    const concurrency = options?.concurrency || 5;
    const rateLimitDelayMs = options?.rateLimitDelayMs || 100;
    const results: EmailResult[] = [];
    let sent = 0;
    let failed = 0;
    
    for (let i = 0; i < emails.length; i += concurrency) {
      const batch = emails.slice(i, i + concurrency);
      const batchPromises = batch.map(email => 
        this.sendEmail({ ...email, organizationId: email.organizationId || orgId })
      );
      
      const batchResults = await Promise.all(batchPromises);
      
      for (const result of batchResults) {
        results.push(result);
        if (result.success) sent++;
        else failed++;
      }
      
      if (i + concurrency < emails.length) {
        await delay(rateLimitDelayMs);
      }
    }
    
    console.log(`[EmailService] Bulk send complete: ${sent} sent, ${failed} failed, ${emails.length} total`);
    
    return { 
      results, 
      summary: { sent, failed, total: emails.length } 
    };
  }

  async sendTransactionalEmail(
    type: 'verification' | 'password_reset' | 'notification' | 'welcome' | 'alert',
    options: {
      to: string;
      subject?: string;
      templateData: Record<string, any>;
      organizationId?: number;
    }
  ): Promise<EmailResult> {
    const templates = {
      verification: {
        subject: 'Verify Your Email Address',
        html: this.buildVerificationTemplate(options.templateData),
      },
      password_reset: {
        subject: 'Reset Your Password',
        html: this.buildPasswordResetTemplate(options.templateData),
      },
      notification: {
        subject: options.templateData.subject || 'New Notification',
        html: this.buildNotificationTemplate(options.templateData),
      },
      welcome: {
        subject: 'Welcome to AcreOS',
        html: this.buildWelcomeTemplate(options.templateData),
      },
      alert: {
        subject: options.templateData.alertTitle || 'Important Alert',
        html: this.buildAlertTemplate(options.templateData),
      },
    };

    const template = templates[type];
    
    return this.sendEmail({
      to: options.to,
      subject: options.subject || template.subject,
      html: template.html,
      organizationId: options.organizationId,
    });
  }

  async getDeliveryStatus(messageId: string): Promise<'pending' | 'delivered' | 'failed' | 'unknown'> {
    return 'unknown';
  }
  
  async getCredentialSource(orgId: number): Promise<'organization' | 'platform' | null> {
    try {
      const creds = await getCredentials(orgId);
      return creds.source;
    } catch {
      return null;
    }
  }

  async getSendQuota(orgId?: number): Promise<{ max24HourSend: number; maxSendRate: number; sentLast24Hours: number } | null> {
    try {
      const { client } = await getSESClient(orgId);
      const command = new GetSendQuotaCommand({});
      const response = await client.send(command);
      return {
        max24HourSend: response.Max24HourSend || 0,
        maxSendRate: response.MaxSendRate || 0,
        sentLast24Hours: response.SentLast24Hours || 0,
      };
    } catch (error) {
      console.error('[EmailService] Failed to get send quota:', error);
      return null;
    }
  }

  getRecentLogs(limit: number = 50): EmailLogEntry[] {
    return this.recentLogs.slice(-limit);
  }

  getLogsByOrganization(orgId: number, limit: number = 50): EmailLogEntry[] {
    return this.recentLogs
      .filter(log => log.organizationId === orgId)
      .slice(-limit);
  }

  private log(entry: EmailLogEntry): void {
    this.recentLogs.push(entry);
    if (this.recentLogs.length > this.maxLogEntries) {
      this.recentLogs = this.recentLogs.slice(-this.maxLogEntries);
    }
  }

  private formatErrorMessage(error: any, errorType: EmailErrorType): string {
    const baseMessage = error?.message || 'Failed to send email';
    
    const friendlyMessages: Record<EmailErrorType, string> = {
      sender_not_verified: 'Sender email or domain not verified in AWS SES',
      recipient_rejected: 'Recipient email address was rejected',
      rate_limit: 'Email sending rate limit exceeded - please try again later',
      quota_exceeded: 'Daily email quota exceeded',
      configuration_error: 'Email service configuration error',
      network_error: 'Network error while sending email',
      unknown: baseMessage,
    };
    
    return friendlyMessages[errorType] || baseMessage;
  }

  private htmlToText(html: string): string {
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<li>/gi, '- ')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      .trim();
  }

  private buildVerificationTemplate(data: Record<string, any>): string {
    return `
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 24px;">Verify Your Email</h1>
        </div>
        <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
          <p>Hi ${data.name || 'there'},</p>
          <p>Please verify your email address by clicking the button below:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${data.verificationUrl}" style="background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">Verify Email</a>
          </div>
          <p style="color: #666; font-size: 14px;">If you didn't create an account, you can safely ignore this email.</p>
          <p style="color: #666; font-size: 14px;">This link expires in ${data.expiresIn || '24 hours'}.</p>
        </div>
      </body>
      </html>
    `;
  }

  private buildPasswordResetTemplate(data: Record<string, any>): string {
    return `
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); padding: 30px; border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 24px;">Reset Your Password</h1>
        </div>
        <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
          <p>Hi ${data.name || 'there'},</p>
          <p>We received a request to reset your password. Click the button below to create a new password:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${data.resetUrl}" style="background: #f5576c; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">Reset Password</a>
          </div>
          <p style="color: #666; font-size: 14px;">If you didn't request this, you can safely ignore this email.</p>
          <p style="color: #666; font-size: 14px;">This link expires in ${data.expiresIn || '1 hour'}.</p>
        </div>
      </body>
      </html>
    `;
  }

  private buildNotificationTemplate(data: Record<string, any>): string {
    return `
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #4a5568; padding: 30px; border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 24px;">${data.title || 'Notification'}</h1>
        </div>
        <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
          <p>${data.message || ''}</p>
          ${data.actionUrl ? `
            <div style="text-align: center; margin: 30px 0;">
              <a href="${data.actionUrl}" style="background: #4a5568; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">${data.actionText || 'View Details'}</a>
            </div>
          ` : ''}
        </div>
      </body>
      </html>
    `;
  }

  private buildWelcomeTemplate(data: Record<string, any>): string {
    return `
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); padding: 30px; border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 24px;">Welcome to AcreOS!</h1>
        </div>
        <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
          <p>Hi ${data.firstName || data.name || 'there'},</p>
          <p>Thank you for joining us! We're excited to help you manage your land investments.</p>
          <p>Here are some things you can do to get started:</p>
          <ul>
            <li>Complete your profile</li>
            <li>Import your first leads</li>
            <li>Set up your campaigns</li>
          </ul>
          ${data.dashboardUrl ? `
            <div style="text-align: center; margin: 30px 0;">
              <a href="${data.dashboardUrl}" style="background: #11998e; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">Go to Dashboard</a>
            </div>
          ` : ''}
        </div>
      </body>
      </html>
    `;
  }

  private buildAlertTemplate(data: Record<string, any>): string {
    const severityColors: Record<string, string> = {
      critical: '#dc2626',
      warning: '#f59e0b',
      info: '#3b82f6',
    };
    const color = severityColors[data.severity] || severityColors.info;
    
    return `
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: ${color}; padding: 30px; border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 24px;">${data.alertTitle || 'Alert'}</h1>
        </div>
        <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
          <p>${data.message || ''}</p>
          ${data.details ? `<p style="color: #666; font-size: 14px;">${data.details}</p>` : ''}
          ${data.actionUrl ? `
            <div style="text-align: center; margin: 30px 0;">
              <a href="${data.actionUrl}" style="background: ${color}; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">${data.actionText || 'Take Action'}</a>
            </div>
          ` : ''}
        </div>
      </body>
      </html>
    `;
  }
}

export const emailService = new EmailService();

export async function getEmailServiceStatus(): Promise<{
  isConfigured: boolean;
  defaultFromEmail?: string;
  provider: string;
  error?: string;
}> {
  try {
    const { fromEmail, region } = await getSESClient();
    return {
      isConfigured: true,
      defaultFromEmail: fromEmail,
      provider: `AWS SES (${region})`,
    };
  } catch (error: any) {
    return {
      isConfigured: false,
      provider: 'AWS SES',
      error: error.message,
    };
  }
}

export class AWSSESDomainService {
  async verifyEmailIdentity(email: string, orgId?: number): Promise<{ success: boolean; error?: string }> {
    try {
      const { client } = await getSESClient(orgId);
      const { VerifyEmailIdentityCommand } = await import('@aws-sdk/client-ses');
      const command = new VerifyEmailIdentityCommand({ EmailAddress: email });
      await client.send(command);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async verifyDomainIdentity(domain: string, orgId?: number): Promise<{ 
    success: boolean; 
    verificationToken?: string; 
    error?: string 
  }> {
    try {
      const { client } = await getSESClient(orgId);
      const { VerifyDomainIdentityCommand } = await import('@aws-sdk/client-ses');
      const command = new VerifyDomainIdentityCommand({ Domain: domain });
      const response = await client.send(command);
      return { 
        success: true, 
        verificationToken: response.VerificationToken 
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async listIdentities(orgId?: number): Promise<string[]> {
    try {
      const { client } = await getSESClient(orgId);
      const { ListIdentitiesCommand } = await import('@aws-sdk/client-ses');
      const command = new ListIdentitiesCommand({ IdentityType: 'EmailAddress' });
      const response = await client.send(command);
      return response.Identities || [];
    } catch (error) {
      console.error('[AWSSESDomainService] Failed to list identities:', error);
      return [];
    }
  }
}

export const awsSesDomainService = new AWSSESDomainService();

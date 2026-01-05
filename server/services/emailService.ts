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
    fromName: process.env.AWS_SES_FROM_NAME || 'Acreage Land Co.',
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
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  fromName?: string;
  replyTo?: string;
  organizationId?: number;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export class EmailService {
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
    try {
      const { client, fromEmail: defaultFromEmail, fromName: defaultFromName, source } = 
        await getSESClient(options.organizationId);
      
      const fromAddress = options.from || defaultFromEmail;
      const fromNameFinal = options.fromName || defaultFromName || 'Acreage Land Co.';
      const fromFormatted = `${fromNameFinal} <${fromAddress}>`;

      const command = new SendEmailCommand({
        Source: fromFormatted,
        Destination: {
          ToAddresses: [options.to],
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
              Data: options.text || options.html.replace(/<[^>]*>/g, ''),
              Charset: 'UTF-8',
            },
          },
        },
        ReplyToAddresses: options.replyTo ? [options.replyTo] : undefined,
      });

      const response = await client.send(command);
      const messageId = response.MessageId || `ses-${Date.now()}`;
      
      console.log(`[EmailService] Email sent via AWS SES (${source}) to ${options.to}, MessageId: ${messageId}`);
      return { success: true, messageId };
    } catch (error: any) {
      console.error('[EmailService] Failed to send email:', error);
      
      let errorMessage = error.message || 'Failed to send email';
      if (error.name === 'MessageRejected') {
        errorMessage = 'Email rejected - check sender verification in AWS SES';
      } else if (error.name === 'MailFromDomainNotVerifiedException') {
        errorMessage = 'From domain not verified in AWS SES';
      } else if (error.name === 'ConfigurationSetDoesNotExistException') {
        errorMessage = 'Configuration set not found';
      }
      
      return { success: false, error: errorMessage };
    }
  }

  async sendBulkEmails(emails: EmailOptions[], orgId?: number): Promise<EmailResult[]> {
    const results: EmailResult[] = [];
    for (const email of emails) {
      const result = await this.sendEmail({ ...email, organizationId: orgId });
      results.push(result);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return results;
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

import sgMail from '@sendgrid/mail';

let connectionSettings: any;

async function getCredentials() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=sendgrid',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  if (!connectionSettings || (!connectionSettings.settings.api_key || !connectionSettings.settings.from_email)) {
    throw new Error('SendGrid not connected');
  }
  return { apiKey: connectionSettings.settings.api_key, email: connectionSettings.settings.from_email };
}

export async function getUncachableSendGridClient() {
  const { apiKey, email } = await getCredentials();
  sgMail.setApiKey(apiKey);
  return {
    client: sgMail,
    fromEmail: email
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
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export class EmailService {
  async isConfigured(): Promise<boolean> {
    try {
      await getCredentials();
      return true;
    } catch {
      return false;
    }
  }

  async getDefaultFromEmail(): Promise<string | null> {
    try {
      const { email } = await getCredentials();
      return email;
    } catch {
      return null;
    }
  }

  async sendEmail(options: EmailOptions): Promise<EmailResult> {
    try {
      const { client, fromEmail: defaultFromEmail } = await getUncachableSendGridClient();
      
      const msg = {
        to: options.to,
        from: {
          email: options.from || defaultFromEmail,
          name: options.fromName || 'AcreOS',
        },
        subject: options.subject,
        text: options.text || options.html.replace(/<[^>]*>/g, ''),
        html: options.html,
        replyTo: options.replyTo,
      };

      const [response] = await client.send(msg);
      const messageId = response.headers['x-message-id'] || `sg-${Date.now()}`;
      
      return { success: true, messageId };
    } catch (error: any) {
      console.error('[EmailService] Failed to send email:', error);
      return { success: false, error: error.message || 'Failed to send email' };
    }
  }

  async sendBulkEmails(emails: EmailOptions[]): Promise<EmailResult[]> {
    const results: EmailResult[] = [];
    for (const email of emails) {
      const result = await this.sendEmail(email);
      results.push(result);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return results;
  }

  async getDeliveryStatus(messageId: string): Promise<'pending' | 'delivered' | 'failed' | 'unknown'> {
    return 'unknown';
  }
}

export const emailService = new EmailService();

export async function getEmailServiceStatus(): Promise<{
  isConfigured: boolean;
  defaultFromEmail?: string;
  error?: string;
}> {
  try {
    const { fromEmail } = await getUncachableSendGridClient();
    return {
      isConfigured: true,
      defaultFromEmail: fromEmail,
    };
  } catch (error: any) {
    return {
      isConfigured: false,
      error: error.message,
    };
  }
}

export class SendGridDomainService {
  private async getApiKey(): Promise<string> {
    const { apiKey } = await getCredentials();
    return apiKey;
  }

  async addDomain(domain: string): Promise<{
    id: string;
    domain: string;
    dnsRecords: Array<{
      type: string;
      host: string;
      data: string;
      valid: boolean;
    }>;
  }> {
    const apiKey = await this.getApiKey();
    
    const response = await fetch('https://api.sendgrid.com/v3/whitelabel/domains', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        domain,
        automatic_security: true,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.errors?.[0]?.message || 'Failed to add domain');
    }

    const data = await response.json();
    
    const dnsRecords: Array<{ type: string; host: string; data: string; valid: boolean }> = [];
    
    if (data.dns) {
      for (const [key, record] of Object.entries(data.dns) as [string, any][]) {
        if (record && record.host && record.data) {
          dnsRecords.push({
            type: record.type || 'CNAME',
            host: record.host,
            data: record.data,
            valid: record.valid || false,
          });
        }
      }
    }

    return {
      id: String(data.id),
      domain: data.domain,
      dnsRecords,
    };
  }

  async verifyDomain(domainId: string): Promise<{
    valid: boolean;
    dnsRecords: Array<{
      type: string;
      host: string;
      data: string;
      valid: boolean;
    }>;
  }> {
    const apiKey = await this.getApiKey();
    
    const response = await fetch(`https://api.sendgrid.com/v3/whitelabel/domains/${domainId}/validate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.errors?.[0]?.message || 'Failed to verify domain');
    }

    const data = await response.json();
    
    const dnsRecords: Array<{ type: string; host: string; data: string; valid: boolean }> = [];
    
    if (data.validation_results) {
      for (const [key, result] of Object.entries(data.validation_results) as [string, any][]) {
        if (result) {
          dnsRecords.push({
            type: result.type || 'CNAME',
            host: key,
            data: result.expected || '',
            valid: result.valid || false,
          });
        }
      }
    }

    return {
      valid: data.valid || false,
      dnsRecords,
    };
  }

  async getDomain(domainId: string): Promise<{
    id: string;
    domain: string;
    valid: boolean;
    dnsRecords: Array<{
      type: string;
      host: string;
      data: string;
      valid: boolean;
    }>;
  }> {
    const apiKey = await this.getApiKey();
    
    const response = await fetch(`https://api.sendgrid.com/v3/whitelabel/domains/${domainId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.errors?.[0]?.message || 'Failed to get domain');
    }

    const data = await response.json();
    
    const dnsRecords: Array<{ type: string; host: string; data: string; valid: boolean }> = [];
    
    if (data.dns) {
      for (const [key, record] of Object.entries(data.dns) as [string, any][]) {
        if (record && record.host && record.data) {
          dnsRecords.push({
            type: record.type || 'CNAME',
            host: record.host,
            data: record.data,
            valid: record.valid || false,
          });
        }
      }
    }

    return {
      id: String(data.id),
      domain: data.domain,
      valid: data.valid || false,
      dnsRecords,
    };
  }

  async deleteDomain(domainId: string): Promise<void> {
    const apiKey = await this.getApiKey();
    
    const response = await fetch(`https://api.sendgrid.com/v3/whitelabel/domains/${domainId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok && response.status !== 204) {
      const error = await response.json();
      throw new Error(error.errors?.[0]?.message || 'Failed to delete domain');
    }
  }
}

export const sendGridDomainService = new SendGridDomainService();

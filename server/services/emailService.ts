export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export class EmailService {
  private apiKey: string | undefined;

  constructor() {
    this.apiKey = process.env.SENDGRID_API_KEY;
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  async sendEmail(options: EmailOptions): Promise<EmailResult> {
    if (!this.isConfigured()) {
      console.log(`[Email] Not configured - would send to ${options.to}: ${options.subject}`);
      return { success: true, messageId: `mock-${Date.now()}` };
    }

    try {
      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: options.to }] }],
          from: { email: options.from || 'noreply@acreos.app' },
          subject: options.subject,
          content: [
            { type: 'text/html', value: options.html },
            ...(options.text ? [{ type: 'text/plain', value: options.text }] : []),
          ],
        }),
      });

      if (response.ok) {
        const messageId = response.headers.get('x-message-id') || `sg-${Date.now()}`;
        return { success: true, messageId };
      } else {
        const error = await response.text();
        return { success: false, error };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
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

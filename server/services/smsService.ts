export interface SmsOptions {
  to: string;
  message: string;
  from?: string;
}

export interface SmsResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export class SmsService {
  private accountSid: string | undefined;
  private authToken: string | undefined;
  private fromNumber: string | undefined;

  constructor() {
    this.accountSid = process.env.TWILIO_ACCOUNT_SID;
    this.authToken = process.env.TWILIO_AUTH_TOKEN;
    this.fromNumber = process.env.TWILIO_PHONE_NUMBER;
  }

  isConfigured(): boolean {
    return !!(this.accountSid && this.authToken && this.fromNumber);
  }

  async sendSMS(options: SmsOptions): Promise<SmsResult> {
    if (!this.isConfigured()) {
      console.log(`[SMS] Not configured - would send to ${options.to}: ${options.message.substring(0, 50)}...`);
      return { success: true, messageId: `mock-${Date.now()}` };
    }

    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
      const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');

      const body = new URLSearchParams({
        To: options.to,
        From: options.from || this.fromNumber!,
        Body: options.message,
      });

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      if (response.ok) {
        const data = await response.json();
        return { success: true, messageId: data.sid };
      } else {
        const error = await response.text();
        return { success: false, error };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async sendBulkSMS(messages: SmsOptions[]): Promise<SmsResult[]> {
    const results: SmsResult[] = [];
    for (const msg of messages) {
      const result = await this.sendSMS(msg);
      results.push(result);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return results;
  }

  async getDeliveryStatus(messageId: string): Promise<'pending' | 'delivered' | 'failed' | 'unknown'> {
    if (!this.isConfigured()) {
      return 'unknown';
    }

    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages/${messageId}.json`;
      const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');

      const response = await fetch(url, {
        headers: { 'Authorization': `Basic ${auth}` },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.status === 'delivered') return 'delivered';
        if (data.status === 'failed' || data.status === 'undelivered') return 'failed';
        return 'pending';
      }
    } catch (error) {
      console.error('[SMS] Error checking status:', error);
    }
    return 'unknown';
  }
}

export const smsService = new SmsService();

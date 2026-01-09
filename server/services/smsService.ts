import { db } from "../db";
import { messages, conversations, leads, organizationIntegrations } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

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

interface TwilioCredentials {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
}

async function getOrgTwilioCredentials(organizationId: number): Promise<TwilioCredentials | null> {
  const [twilioIntegration] = await db
    .select()
    .from(organizationIntegrations)
    .where(
      and(
        eq(organizationIntegrations.organizationId, organizationId),
        eq(organizationIntegrations.provider, "twilio"),
        eq(organizationIntegrations.isEnabled, true)
      )
    )
    .limit(1);

  if (!twilioIntegration || !twilioIntegration.credentials) {
    return null;
  }

  const creds = twilioIntegration.credentials;
  if (!creds.accountSid || !creds.authToken || !creds.fromPhoneNumber) {
    return null;
  }
  
  return {
    accountSid: creds.accountSid,
    authToken: creds.authToken,
    phoneNumber: creds.fromPhoneNumber,
  };
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

export async function sendOrgSMS(
  organizationId: number,
  to: string,
  message: string
): Promise<SmsResult> {
  const credentials = await getOrgTwilioCredentials(organizationId);
  
  if (!credentials) {
    if (smsService.isConfigured()) {
      return smsService.sendSMS({ to, message });
    }
    return {
      success: false,
      error: "Twilio credentials not configured. Please add your Twilio API keys in Settings.",
    };
  }

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}/Messages.json`;
    const auth = Buffer.from(`${credentials.accountSid}:${credentials.authToken}`).toString('base64');

    const body = new URLSearchParams({
      To: to,
      From: credentials.phoneNumber,
      Body: message,
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

export async function sendSMSToLead(
  organizationId: number,
  leadId: number,
  messageContent: string,
  userId: string
): Promise<SmsResult & { conversationId?: number; dbMessageId?: number }> {
  const [lead] = await db
    .select()
    .from(leads)
    .where(
      and(
        eq(leads.organizationId, organizationId),
        eq(leads.id, leadId)
      )
    )
    .limit(1);

  if (!lead) {
    return { success: false, error: "Lead not found" };
  }

  if (!lead.phone) {
    return { success: false, error: "Lead has no phone number" };
  }

  const smsResult = await sendOrgSMS(organizationId, lead.phone, messageContent);

  if (!smsResult.success) {
    return smsResult;
  }

  let [existingConversation] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.organizationId, organizationId),
        eq(conversations.leadId, leadId),
        eq(conversations.channel, "sms")
      )
    )
    .orderBy(desc(conversations.lastMessageAt))
    .limit(1);

  if (!existingConversation) {
    const [newConversation] = await db
      .insert(conversations)
      .values({
        organizationId,
        leadId,
        channel: "sms",
        status: "active",
        lastMessageAt: new Date(),
      })
      .returning();
    existingConversation = newConversation;
  }

  const [newMessage] = await db
    .insert(messages)
    .values({
      organizationId,
      conversationId: existingConversation.id,
      direction: "outbound",
      sender: "human",
      content: messageContent,
      status: "sent",
      externalId: smsResult.messageId,
    })
    .returning();

  await db
    .update(conversations)
    .set({
      lastMessageAt: new Date(),
    })
    .where(eq(conversations.id, existingConversation.id));

  return {
    success: true,
    messageId: smsResult.messageId,
    conversationId: existingConversation.id,
    dbMessageId: newMessage.id,
  };
}

export async function handleIncomingSMS(
  organizationId: number,
  fromPhone: string,
  toPhone: string,
  body: string,
  messageSid: string
): Promise<{ success: boolean; conversationId?: number; dbMessageId?: number; leadId?: number; error?: string }> {
  const cleanPhone = fromPhone.replace(/\D/g, "");
  const last10Digits = cleanPhone.slice(-10);
  
  const allLeads = await db
    .select()
    .from(leads)
    .where(eq(leads.organizationId, organizationId));
  
  const matchedLead = allLeads.find(l => {
    const leadPhone = l.phone?.replace(/\D/g, "") || "";
    if (leadPhone.length < 7) return false;
    const leadLast10 = leadPhone.slice(-10);
    return leadLast10 === last10Digits || leadPhone.includes(last10Digits) || last10Digits.includes(leadLast10);
  });

  const leadId = matchedLead?.id;

  let existingConversation: typeof conversations.$inferSelect | undefined;

  if (leadId) {
    const convos = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.organizationId, organizationId),
          eq(conversations.leadId, leadId),
          eq(conversations.channel, "sms")
        )
      )
      .orderBy(desc(conversations.lastMessageAt))
      .limit(1);
    existingConversation = convos[0];
  }

  if (!existingConversation && leadId) {
    const [newConversation] = await db
      .insert(conversations)
      .values({
        organizationId,
        leadId,
        channel: "sms",
        status: "active",
        lastMessageAt: new Date(),
      })
      .returning();
    existingConversation = newConversation;
  }

  if (!existingConversation) {
    console.log(`[SMS] No matching lead found for phone ${fromPhone} in org ${organizationId}. Message not stored.`);
    return { 
      success: false, 
      error: `No matching lead found for phone number ${fromPhone}. Consider creating a lead first.` 
    };
  }

  const [newMessage] = await db
    .insert(messages)
    .values({
      organizationId,
      conversationId: existingConversation.id,
      direction: "inbound",
      sender: "lead",
      content: body,
      status: "received",
      externalId: messageSid,
    })
    .returning();

  await db
    .update(conversations)
    .set({
      lastMessageAt: new Date(),
      status: "active",
    })
    .where(eq(conversations.id, existingConversation.id));

  return {
    success: true,
    conversationId: existingConversation.id,
    dbMessageId: newMessage.id,
    leadId,
  };
}

export async function checkTwilioConfiguration(organizationId: number): Promise<{
  configured: boolean;
  phoneNumber?: string;
  error?: string;
}> {
  const credentials = await getOrgTwilioCredentials(organizationId);
  
  if (!credentials) {
    if (smsService.isConfigured()) {
      return {
        configured: true,
        phoneNumber: process.env.TWILIO_PHONE_NUMBER,
      };
    }
    return {
      configured: false,
      error: "Twilio credentials not configured",
    };
  }

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}.json`;
    const auth = Buffer.from(`${credentials.accountSid}:${credentials.authToken}`).toString('base64');

    const response = await fetch(url, {
      headers: { 'Authorization': `Basic ${auth}` },
    });

    if (response.ok) {
      return {
        configured: true,
        phoneNumber: credentials.phoneNumber,
      };
    } else {
      return {
        configured: false,
        error: "Invalid Twilio credentials",
      };
    }
  } catch (error: any) {
    return {
      configured: false,
      error: error.message || "Failed to verify credentials",
    };
  }
}

export async function saveTwilioCredentials(
  organizationId: number,
  accountSid: string,
  authToken: string,
  fromPhoneNumber: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`;
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    const response = await fetch(url, {
      headers: { 'Authorization': `Basic ${auth}` },
    });

    if (!response.ok) {
      return {
        success: false,
        error: "Invalid Twilio credentials",
      };
    }
  } catch (error: any) {
    return {
      success: false,
      error: "Failed to verify Twilio credentials: " + (error.message || ""),
    };
  }

  const [existing] = await db
    .select()
    .from(organizationIntegrations)
    .where(
      and(
        eq(organizationIntegrations.organizationId, organizationId),
        eq(organizationIntegrations.provider, "twilio")
      )
    )
    .limit(1);

  const credentials = {
    accountSid,
    authToken,
    fromPhoneNumber,
  };

  if (existing) {
    await db
      .update(organizationIntegrations)
      .set({
        credentials,
        isEnabled: true,
        lastValidatedAt: new Date(),
        validationError: null,
        updatedAt: new Date(),
      })
      .where(eq(organizationIntegrations.id, existing.id));
  } else {
    await db
      .insert(organizationIntegrations)
      .values({
        organizationId,
        provider: "twilio",
        isEnabled: true,
        credentials,
        lastValidatedAt: new Date(),
      });
  }

  return { success: true };
}

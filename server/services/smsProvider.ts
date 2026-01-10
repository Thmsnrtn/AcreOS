import { db } from "../db";
import { organizationIntegrations } from "@shared/schema";
import { eq, and } from "drizzle-orm";

export enum SmsProvider {
  TWILIO = "twilio",
  TELNYX = "telnyx",
}

export interface SmsOptions {
  to: string;
  message: string;
  from?: string;
  organizationId?: number;
}

export interface SmsResult {
  success: boolean;
  messageId?: string;
  error?: string;
  provider: SmsProvider;
  cost?: number;
}

interface ProviderCredentials {
  provider: SmsProvider;
  accountSid?: string;
  authToken?: string;
  apiKey?: string;
  phoneNumber: string;
}

const TWILIO_COST_PER_SMS = 0.0079;
const TELNYX_COST_PER_SMS = 0.004;

async function getOrgSmsCredentials(organizationId: number): Promise<ProviderCredentials | null> {
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

  if (twilioIntegration?.credentials) {
    const creds = twilioIntegration.credentials;
    if (creds.accountSid && creds.authToken && creds.fromPhoneNumber) {
      return {
        provider: SmsProvider.TWILIO,
        accountSid: creds.accountSid,
        authToken: creds.authToken,
        phoneNumber: creds.fromPhoneNumber,
      };
    }
  }

  const [telnyxIntegration] = await db
    .select()
    .from(organizationIntegrations)
    .where(
      and(
        eq(organizationIntegrations.organizationId, organizationId),
        eq(organizationIntegrations.provider, "telnyx"),
        eq(organizationIntegrations.isEnabled, true)
      )
    )
    .limit(1);

  if (telnyxIntegration?.credentials) {
    const creds = telnyxIntegration.credentials;
    if (creds.apiKey && creds.fromPhoneNumber) {
      return {
        provider: SmsProvider.TELNYX,
        apiKey: creds.apiKey,
        phoneNumber: creds.fromPhoneNumber,
      };
    }
  }

  return null;
}

function getDefaultCredentials(): ProviderCredentials | null {
  if (process.env.TELNYX_API_KEY && process.env.TELNYX_PHONE_NUMBER) {
    return {
      provider: SmsProvider.TELNYX,
      apiKey: process.env.TELNYX_API_KEY,
      phoneNumber: process.env.TELNYX_PHONE_NUMBER,
    };
  }

  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER) {
    return {
      provider: SmsProvider.TWILIO,
      accountSid: process.env.TWILIO_ACCOUNT_SID,
      authToken: process.env.TWILIO_AUTH_TOKEN,
      phoneNumber: process.env.TWILIO_PHONE_NUMBER,
    };
  }

  return null;
}

async function sendViaTwilio(
  credentials: ProviderCredentials,
  options: SmsOptions
): Promise<SmsResult> {
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}/Messages.json`;
    const auth = Buffer.from(`${credentials.accountSid}:${credentials.authToken}`).toString('base64');

    const body = new URLSearchParams({
      To: options.to,
      From: options.from || credentials.phoneNumber,
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
      return { 
        success: true, 
        messageId: data.sid, 
        provider: SmsProvider.TWILIO,
        cost: TWILIO_COST_PER_SMS,
      };
    } else {
      const error = await response.text();
      return { success: false, error, provider: SmsProvider.TWILIO };
    }
  } catch (error: any) {
    return { success: false, error: error.message, provider: SmsProvider.TWILIO };
  }
}

async function sendViaTelnyx(
  credentials: ProviderCredentials,
  options: SmsOptions
): Promise<SmsResult> {
  try {
    const response = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${credentials.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: options.from || credentials.phoneNumber,
        to: options.to,
        text: options.message,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      return { 
        success: true, 
        messageId: data.data?.id, 
        provider: SmsProvider.TELNYX,
        cost: TELNYX_COST_PER_SMS,
      };
    } else {
      const error = await response.text();
      return { success: false, error, provider: SmsProvider.TELNYX };
    }
  } catch (error: any) {
    return { success: false, error: error.message, provider: SmsProvider.TELNYX };
  }
}

export async function sendSms(options: SmsOptions): Promise<SmsResult> {
  let credentials: ProviderCredentials | null = null;

  if (options.organizationId) {
    credentials = await getOrgSmsCredentials(options.organizationId);
  }

  if (!credentials) {
    credentials = getDefaultCredentials();
  }

  if (!credentials) {
    console.log(`[SMS] No provider configured - would send to ${options.to}: ${options.message.substring(0, 50)}...`);
    return { 
      success: true, 
      messageId: `mock-${Date.now()}`, 
      provider: SmsProvider.TWILIO,
    };
  }

  console.log(`[SMS] Sending via ${credentials.provider} to ${options.to}`);

  if (credentials.provider === SmsProvider.TELNYX) {
    return sendViaTelnyx(credentials, options);
  } else {
    return sendViaTwilio(credentials, options);
  }
}

export async function sendBulkSms(
  messages: SmsOptions[],
  delayMs: number = 100
): Promise<SmsResult[]> {
  const results: SmsResult[] = [];
  for (const msg of messages) {
    const result = await sendSms(msg);
    results.push(result);
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  return results;
}

export function getProviderInfo(): {
  available: SmsProvider[];
  default: SmsProvider | null;
  costs: Record<SmsProvider, number>;
} {
  const available: SmsProvider[] = [];
  let defaultProvider: SmsProvider | null = null;

  if (process.env.TELNYX_API_KEY) {
    available.push(SmsProvider.TELNYX);
    defaultProvider = SmsProvider.TELNYX;
  }

  if (process.env.TWILIO_ACCOUNT_SID) {
    available.push(SmsProvider.TWILIO);
    if (!defaultProvider) defaultProvider = SmsProvider.TWILIO;
  }

  return {
    available,
    default: defaultProvider,
    costs: {
      [SmsProvider.TWILIO]: TWILIO_COST_PER_SMS,
      [SmsProvider.TELNYX]: TELNYX_COST_PER_SMS,
    },
  };
}

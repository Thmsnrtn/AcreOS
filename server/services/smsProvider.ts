import { db } from "../db";
import { organizationIntegrations } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "../utils/logger";

export enum SmsProvider {
  TWILIO = "twilio",
}

export interface SmsOptions {
  to: string;
  message: string;
  from?: string;
  organizationId?: number;
  // MMS: when non-empty, this becomes an MMS send (different per-message
  // cost — see TWILIO_COST_PER_MMS).
  mediaUrls?: string[];
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
// Twilio MMS is roughly 2x SMS in the US (varies by carrier surcharge,
// but a stable enough default for cost-attribution accounting).
const TWILIO_COST_PER_MMS = 0.02;

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

  return null;
}

function getDefaultCredentials(): ProviderCredentials | null {
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
    const isMms = (options.mediaUrls?.length ?? 0) > 0;
    if (isMms) {
      for (const mu of options.mediaUrls!) {
        body.append("MediaUrl", mu);
      }
    }

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
        cost: isMms ? TWILIO_COST_PER_MMS : TWILIO_COST_PER_SMS,
      };
    } else {
      const error = await response.text();
      return { success: false, error, provider: SmsProvider.TWILIO };
    }
  } catch (error: any) {
    return { success: false, error: error.message, provider: SmsProvider.TWILIO };
  }
}

export async function sendSms(options: SmsOptions): Promise<SmsResult> {
  // SIMULATION_MODE short-circuits every outbound SMS, regardless of
  // which provider would have been used. Paired with the Twilio-only
  // block in smsService.ts — this is the multi-provider version.
  {
    const { shouldSimulate, recordSimulatedAction } = await import("../utils/simulationMode");
    const { storage } = await import("../storage");
    const org = options.organizationId
      ? await storage.getOrganization(options.organizationId).catch(() => null)
      : null;
    if (shouldSimulate("sms", org)) {
      const rec = await recordSimulatedAction(
        "sms",
        "provider.messages.create",
        { to: options.to, body: options.message.slice(0, 500), mediaUrls: options.mediaUrls },
        org
      );
      return {
        success: true,
        messageId: rec.id,
        provider: SmsProvider.TWILIO,
      } as SmsResult;
    }
  }

  let credentials: ProviderCredentials | null = null;

  if (options.organizationId) {
    credentials = await getOrgSmsCredentials(options.organizationId);
  }

  if (!credentials) {
    credentials = getDefaultCredentials();
  }

  if (!credentials) {
    // FAIL VISIBLY (product-truth audit): no SMS credentials ⇒ the message
    // genuinely cannot send. Previously returned success:true + a fake
    // `mock-<ts>` id, so an unconfigured prod silently "succeeded". Report the
    // real failure instead (a deliberate dry-run uses simulation mode above).
    logger.warn(`[SMS] No provider configured — cannot send to ${options.to}`);
    return {
      success: false,
      error: "SMS provider not configured (no org or platform Twilio credentials)",
      provider: SmsProvider.TWILIO,
    };
  }

  logger.info(`[SMS] Sending via ${credentials.provider} to ${options.to}`);
  return sendViaTwilio(credentials, options);
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

  if (process.env.TWILIO_ACCOUNT_SID) {
    available.push(SmsProvider.TWILIO);
    defaultProvider = SmsProvider.TWILIO;
  }

  return {
    available,
    default: defaultProvider,
    costs: {
      [SmsProvider.TWILIO]: TWILIO_COST_PER_SMS,
    },
  };
}

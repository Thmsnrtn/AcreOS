import { db } from "../db";
import { organizationIntegrations } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import Lob from 'lob';
import { logger } from "../utils/logger";
import { resolvePlatformLobKey, isLiveSendArmed } from './mail/liveSendInterlock';
import { readIntegrationCredentials } from './integrationCredentials';

export enum MailProvider {
  LOB = "lob",
}

export interface MailAddress {
  name: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  zip: string;
}

export interface LetterOptions {
  to: MailAddress;
  from: MailAddress;
  file: string;
  color?: boolean;
  doubleSided?: boolean;
  description?: string;
  organizationId?: number;
}

export interface PostcardOptions {
  to: MailAddress;
  from: MailAddress;
  front: string;
  back: string;
  size?: '4x6' | '6x9' | '6x11';
  description?: string;
  organizationId?: number;
}

export interface MailResult {
  success: boolean;
  mailingId?: string;
  expectedDeliveryDate?: string;
  trackingUrl?: string;
  isTestMode: boolean;
  provider: MailProvider;
  cost?: number;
  error?: string;
}

interface ProviderCredentials {
  provider: MailProvider;
  apiKey: string;
  isTestKey: boolean;
}

const LOB_LETTER_COST = 0.85;
const LOB_POSTCARD_COST = 0.45;

// Bounded timeout for the Lob API. The SDK's create() has no default timeout,
// so a stalled Lob endpoint would hang the autopilot hand indefinitely. We race
// the create against this timer and surface a distinct 'lob timeout' error so
// callers can retry rather than block forever.
const LOB_TIMEOUT_MS = 18_000;

class LobTimeoutError extends Error {
  constructor() {
    super('lob timeout');
    this.name = 'LobTimeoutError';
  }
}

function withLobTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new LobTimeoutError()), LOB_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function getOrgMailCredentials(organizationId: number): Promise<ProviderCredentials | null> {
  const [lobIntegration] = await db
    .select()
    .from(organizationIntegrations)
    .where(
      and(
        eq(organizationIntegrations.organizationId, organizationId),
        eq(organizationIntegrations.provider, "lob"),
        eq(organizationIntegrations.isEnabled, true)
      )
    )
    .limit(1);

  // Reads either shape. This function saw ONLY the plaintext field, and
  // directMail.ts saw only the envelope, so which of an org's own Lob keys got
  // used — or whether the platform key got used instead, with AcreOS paying the
  // bill — depended on which module happened to send the mail.
  const creds = readIntegrationCredentials<{ apiKey?: string }>(
    lobIntegration,
    organizationId,
    "lob mail credentials",
  );

  if (creds?.apiKey) {
    return {
      provider: MailProvider.LOB,
      apiKey: creds.apiKey,
      isTestKey: creds.apiKey.startsWith('test_'),
    };
  }

  return null;
}

function getDefaultCredentials(): ProviderCredentials | null {
  // Platform key under the live-send interlock (mail/liveSendInterlock.ts):
  // test environment unless production is explicitly armed. This path used
  // to prefer the live key in EVERY environment, which would have printed
  // real mail from dev/CI the moment the live secret existed there.
  try {
    const { apiKey, isTestKey } = resolvePlatformLobKey();
    return { provider: MailProvider.LOB, apiKey, isTestKey };
  } catch {
    // Legacy LOB_API_KEY-only installs: honor it, but never as a live key
    // while disarmed.
    const legacy = process.env.LOB_API_KEY;
    if (legacy && (legacy.startsWith('test_') || isLiveSendArmed())) {
      return {
        provider: MailProvider.LOB,
        apiKey: legacy,
        isTestKey: legacy.startsWith('test_'),
      };
    }
    return null;
  }
}

function formatAddressForLob(addr: MailAddress): any {
  return {
    name: addr.name,
    address_line1: addr.addressLine1,
    address_line2: addr.addressLine2 || undefined,
    address_city: addr.city,
    address_state: addr.state,
    address_zip: addr.zip,
    address_country: 'US',
  };
}

async function sendLetterViaLob(
  credentials: ProviderCredentials,
  options: LetterOptions
): Promise<MailResult> {
  try {
    const lob = new Lob({ apiKey: credentials.apiKey });

    const letter = await withLobTimeout<any>((lob.letters as any).create({
      to: formatAddressForLob(options.to),
      from: formatAddressForLob(options.from),
      file: options.file,
      color: options.color ?? false,
      double_sided: options.doubleSided ?? false,
      description: options.description,
    }));

    return {
      success: true,
      mailingId: letter.id,
      expectedDeliveryDate: letter.expected_delivery_date,
      trackingUrl: letter.tracking_number ? `https://tools.usps.com/go/TrackConfirmAction?tLabels=${letter.tracking_number}` : undefined,
      isTestMode: credentials.isTestKey,
      provider: MailProvider.LOB,
      cost: LOB_LETTER_COST,
    };
  } catch (error: any) {
    return {
      success: false,
      // Distinct, retryable signal when the Lob API stalls past LOB_TIMEOUT_MS.
      error: error instanceof LobTimeoutError ? 'lob timeout' : (error.message || String(error)),
      isTestMode: credentials.isTestKey,
      provider: MailProvider.LOB,
    };
  }
}

async function sendPostcardViaLob(
  credentials: ProviderCredentials,
  options: PostcardOptions
): Promise<MailResult> {
  try {
    const lob = new Lob({ apiKey: credentials.apiKey });

    const postcard = await withLobTimeout<any>((lob.postcards as any).create({
      to: formatAddressForLob(options.to),
      from: formatAddressForLob(options.from),
      front: options.front,
      back: options.back,
      size: options.size || '4x6',
      description: options.description,
    }));

    return {
      success: true,
      mailingId: postcard.id,
      expectedDeliveryDate: postcard.expected_delivery_date,
      isTestMode: credentials.isTestKey,
      provider: MailProvider.LOB,
      cost: LOB_POSTCARD_COST,
    };
  } catch (error: any) {
    return {
      success: false,
      // Distinct, retryable signal when the Lob API stalls past LOB_TIMEOUT_MS.
      error: error instanceof LobTimeoutError ? 'lob timeout' : (error.message || String(error)),
      isTestMode: credentials.isTestKey,
      provider: MailProvider.LOB,
    };
  }
}

export async function sendLetter(options: LetterOptions): Promise<MailResult> {
  let credentials: ProviderCredentials | null = null;

  if (options.organizationId) {
    credentials = await getOrgMailCredentials(options.organizationId);
  }

  if (!credentials) {
    credentials = getDefaultCredentials();
  }

  if (!credentials) {
    // No mail credentials configured. Only produce a mock mailing id under an
    // explicit dev flag — never as the silent default, which would fabricate a
    // successful send and let a real letter no-op while reporting success.
    if (process.env.MAIL_MOCK === '1') {
      logger.info(`[Mail] MAIL_MOCK - simulating letter to ${options.to.name}`);
      return {
        success: true,
        mailingId: `mock-letter-${Date.now()}`,
        isTestMode: true,
        provider: MailProvider.LOB,
      };
    }
    logger.warn(`[Mail] No provider configured - refusing to send letter to ${options.to.name}`);
    return {
      success: false,
      error: 'mail provider not configured',
      isTestMode: false,
      provider: MailProvider.LOB,
    };
  }

  logger.info(`[Mail] Sending letter via ${credentials.provider} to ${options.to.name}`);
  return sendLetterViaLob(credentials, options);
}

export async function sendPostcard(options: PostcardOptions): Promise<MailResult> {
  let credentials: ProviderCredentials | null = null;

  if (options.organizationId) {
    credentials = await getOrgMailCredentials(options.organizationId);
  }

  if (!credentials) {
    credentials = getDefaultCredentials();
  }

  if (!credentials) {
    // No mail credentials configured. Only produce a mock mailing id under an
    // explicit dev flag — never as the silent default, which would fabricate a
    // successful send and let a real postcard no-op while reporting success.
    if (process.env.MAIL_MOCK === '1') {
      logger.info(`[Mail] MAIL_MOCK - simulating postcard to ${options.to.name}`);
      return {
        success: true,
        mailingId: `mock-postcard-${Date.now()}`,
        isTestMode: true,
        provider: MailProvider.LOB,
      };
    }
    logger.warn(`[Mail] No provider configured - refusing to send postcard to ${options.to.name}`);
    return {
      success: false,
      error: 'mail provider not configured',
      isTestMode: false,
      provider: MailProvider.LOB,
    };
  }

  logger.info(`[Mail] Sending postcard via ${credentials.provider} to ${options.to.name}`);
  return sendPostcardViaLob(credentials, options);
}

export function getProviderInfo(): {
  available: MailProvider[];
  default: MailProvider | null;
  costs: Record<MailProvider, { letter: number; postcard: number }>;
} {
  const available: MailProvider[] = [];
  let defaultProvider: MailProvider | null = null;

  if (process.env.LOB_LIVE_API_KEY || process.env.LOB_TEST_API_KEY || process.env.LOB_API_KEY) {
    available.push(MailProvider.LOB);
    defaultProvider = MailProvider.LOB;
  }

  return {
    available,
    default: defaultProvider,
    costs: {
      [MailProvider.LOB]: { letter: LOB_LETTER_COST, postcard: LOB_POSTCARD_COST },
    },
  };
}

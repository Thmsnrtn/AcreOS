import { db } from "../db";
import { organizationIntegrations } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import Lob from 'lob';
import { logger } from "../utils/logger";
import { resolvePlatformLobKey, isLiveSendArmed } from './mail/liveSendInterlock';

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

  if (lobIntegration?.credentials?.apiKey) {
    return {
      provider: MailProvider.LOB,
      apiKey: lobIntegration.credentials.apiKey,
      isTestKey: lobIntegration.credentials.apiKey.startsWith('test_'),
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

    const letter = await (lob.letters as any).create({
      to: formatAddressForLob(options.to),
      from: formatAddressForLob(options.from),
      file: options.file,
      color: options.color ?? false,
      double_sided: options.doubleSided ?? false,
      description: options.description,
    });

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
      error: error.message || String(error),
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

    const postcard = await (lob.postcards as any).create({
      to: formatAddressForLob(options.to),
      from: formatAddressForLob(options.from),
      front: options.front,
      back: options.back,
      size: options.size || '4x6',
      description: options.description,
    });

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
      error: error.message || String(error),
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
    logger.info(`[Mail] No provider configured - would send letter to ${options.to.name}`);
    return {
      success: true,
      mailingId: `mock-letter-${Date.now()}`,
      isTestMode: true,
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
    logger.info(`[Mail] No provider configured - would send postcard to ${options.to.name}`);
    return {
      success: true,
      mailingId: `mock-postcard-${Date.now()}`,
      isTestMode: true,
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

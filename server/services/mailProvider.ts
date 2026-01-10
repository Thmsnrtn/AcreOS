import { db } from "../db";
import { organizationIntegrations } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import Lob from 'lob';

export enum MailProvider {
  LOB = "lob",
  PCM = "pcm",
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
const PCM_LETTER_COST = 0.75;
const PCM_POSTCARD_COST = 0.40;

async function getOrgMailCredentials(organizationId: number): Promise<ProviderCredentials | null> {
  const [pcmIntegration] = await db
    .select()
    .from(organizationIntegrations)
    .where(
      and(
        eq(organizationIntegrations.organizationId, organizationId),
        eq(organizationIntegrations.provider, "pcm"),
        eq(organizationIntegrations.isEnabled, true)
      )
    )
    .limit(1);

  if (pcmIntegration?.credentials?.apiKey) {
    return {
      provider: MailProvider.PCM,
      apiKey: pcmIntegration.credentials.apiKey,
      isTestKey: pcmIntegration.credentials.apiKey.startsWith('test_'),
    };
  }

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
  if (process.env.PCM_API_KEY) {
    return {
      provider: MailProvider.PCM,
      apiKey: process.env.PCM_API_KEY,
      isTestKey: process.env.PCM_API_KEY.startsWith('test_'),
    };
  }

  const lobKey = process.env.LOB_LIVE_API_KEY || process.env.LOB_TEST_API_KEY || process.env.LOB_API_KEY;
  if (lobKey) {
    return {
      provider: MailProvider.LOB,
      apiKey: lobKey,
      isTestKey: lobKey.startsWith('test_'),
    };
  }

  return null;
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

async function sendLetterViaPCM(
  credentials: ProviderCredentials,
  options: LetterOptions
): Promise<MailResult> {
  try {
    const response = await fetch('https://api.pcmintegrations.com/v1/letters', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${credentials.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: {
          name: options.to.name,
          address_line_1: options.to.addressLine1,
          address_line_2: options.to.addressLine2,
          city: options.to.city,
          state: options.to.state,
          zip: options.to.zip,
        },
        from: {
          name: options.from.name,
          address_line_1: options.from.addressLine1,
          address_line_2: options.from.addressLine2,
          city: options.from.city,
          state: options.from.state,
          zip: options.from.zip,
        },
        file_url: options.file,
        color: options.color ?? false,
        double_sided: options.doubleSided ?? false,
        description: options.description,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      return {
        success: true,
        mailingId: data.id,
        expectedDeliveryDate: data.expected_delivery_date,
        trackingUrl: data.tracking_url,
        isTestMode: credentials.isTestKey,
        provider: MailProvider.PCM,
        cost: PCM_LETTER_COST,
      };
    } else {
      const error = await response.text();
      return {
        success: false,
        error,
        isTestMode: credentials.isTestKey,
        provider: MailProvider.PCM,
      };
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      isTestMode: credentials.isTestKey,
      provider: MailProvider.PCM,
    };
  }
}

async function sendPostcardViaPCM(
  credentials: ProviderCredentials,
  options: PostcardOptions
): Promise<MailResult> {
  try {
    const response = await fetch('https://api.pcmintegrations.com/v1/postcards', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${credentials.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: {
          name: options.to.name,
          address_line_1: options.to.addressLine1,
          address_line_2: options.to.addressLine2,
          city: options.to.city,
          state: options.to.state,
          zip: options.to.zip,
        },
        from: {
          name: options.from.name,
          address_line_1: options.from.addressLine1,
          address_line_2: options.from.addressLine2,
          city: options.from.city,
          state: options.from.state,
          zip: options.from.zip,
        },
        front_url: options.front,
        back_url: options.back,
        size: options.size || '4x6',
        description: options.description,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      return {
        success: true,
        mailingId: data.id,
        expectedDeliveryDate: data.expected_delivery_date,
        isTestMode: credentials.isTestKey,
        provider: MailProvider.PCM,
        cost: PCM_POSTCARD_COST,
      };
    } else {
      const error = await response.text();
      return {
        success: false,
        error,
        isTestMode: credentials.isTestKey,
        provider: MailProvider.PCM,
      };
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      isTestMode: credentials.isTestKey,
      provider: MailProvider.PCM,
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
    console.log(`[Mail] No provider configured - would send letter to ${options.to.name}`);
    return {
      success: true,
      mailingId: `mock-letter-${Date.now()}`,
      isTestMode: true,
      provider: MailProvider.LOB,
    };
  }

  console.log(`[Mail] Sending letter via ${credentials.provider} to ${options.to.name}`);

  if (credentials.provider === MailProvider.PCM) {
    return sendLetterViaPCM(credentials, options);
  } else {
    return sendLetterViaLob(credentials, options);
  }
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
    console.log(`[Mail] No provider configured - would send postcard to ${options.to.name}`);
    return {
      success: true,
      mailingId: `mock-postcard-${Date.now()}`,
      isTestMode: true,
      provider: MailProvider.LOB,
    };
  }

  console.log(`[Mail] Sending postcard via ${credentials.provider} to ${options.to.name}`);

  if (credentials.provider === MailProvider.PCM) {
    return sendPostcardViaPCM(credentials, options);
  } else {
    return sendPostcardViaLob(credentials, options);
  }
}

export function getProviderInfo(): {
  available: MailProvider[];
  default: MailProvider | null;
  costs: Record<MailProvider, { letter: number; postcard: number }>;
} {
  const available: MailProvider[] = [];
  let defaultProvider: MailProvider | null = null;

  if (process.env.PCM_API_KEY) {
    available.push(MailProvider.PCM);
    defaultProvider = MailProvider.PCM;
  }

  if (process.env.LOB_LIVE_API_KEY || process.env.LOB_TEST_API_KEY || process.env.LOB_API_KEY) {
    available.push(MailProvider.LOB);
    if (!defaultProvider) defaultProvider = MailProvider.LOB;
  }

  return {
    available,
    default: defaultProvider,
    costs: {
      [MailProvider.LOB]: { letter: LOB_LETTER_COST, postcard: LOB_POSTCARD_COST },
      [MailProvider.PCM]: { letter: PCM_LETTER_COST, postcard: PCM_POSTCARD_COST },
    },
  };
}

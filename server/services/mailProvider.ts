import Lob from 'lob';
import { logger } from "../utils/logger";
import { resolvePlatformLobKey, isLiveSendArmed } from './mail/liveSendInterlock';
import { getLobClient } from './directMailService';

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

/**
 * A resolved, ready-to-send Lob client. Credential RESOLUTION does not live in
 * this module — `directMailService.getLobClient` is the single authority (BYOK
 * vault → legacy organization_integrations row → platform key). This module
 * only adapts the resolved client into its own send/timeout/result plumbing.
 */
interface ResolvedLobClient {
  client: InstanceType<typeof Lob>;
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

/**
 * Resolve the Lob client for a send.
 *
 * Org-scoped resolution is DELEGATED to `directMailService.getLobClient` — the
 * one credential authority — so every live sendLetter path agrees on whose Lob
 * account pays: BYOK vault first, then the legacy organization_integrations
 * row, then the platform key. This module previously ran its OWN resolution
 * (legacy row → platform, never the vault), so an org whose key lived in the
 * BYOK vault — the documented Universal-BYOK path — sent letters on ACREOS'S
 * account, against the BYO-rails ruling (founder, 2026-07-29). One resolver,
 * one answer.
 *
 * getLobClient throws only when no platform key is configured at all
 * (resolvePlatformLobKey); in that case we fall through to
 * getDefaultCredentials so the legacy LOB_API_KEY env fallback — and the
 * MAIL_MOCK / refuse-to-fabricate path behind it — behaves exactly as before.
 */
async function resolveLobClient(organizationId?: number): Promise<ResolvedLobClient | null> {
  if (organizationId) {
    try {
      const { client, source, isTestKey } = await getLobClient(organizationId);
      logger.info(`[Mail] Lob client resolved for org ${organizationId} (source: ${source})`);
      return { client, isTestKey };
    } catch (error) {
      logger.warn(
        `[Mail] Lob credential resolution failed for org ${organizationId} - trying legacy env fallback`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  const credentials = getDefaultCredentials();
  if (!credentials) return null;
  return {
    client: new Lob({ apiKey: credentials.apiKey }),
    isTestKey: credentials.isTestKey,
  };
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
  resolved: ResolvedLobClient,
  options: LetterOptions
): Promise<MailResult> {
  try {
    const lob = resolved.client;

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
      isTestMode: resolved.isTestKey,
      provider: MailProvider.LOB,
      cost: LOB_LETTER_COST,
    };
  } catch (error: any) {
    return {
      success: false,
      // Distinct, retryable signal when the Lob API stalls past LOB_TIMEOUT_MS.
      error: error instanceof LobTimeoutError ? 'lob timeout' : (error.message || String(error)),
      isTestMode: resolved.isTestKey,
      provider: MailProvider.LOB,
    };
  }
}

async function sendPostcardViaLob(
  resolved: ResolvedLobClient,
  options: PostcardOptions
): Promise<MailResult> {
  try {
    const lob = resolved.client;

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
      isTestMode: resolved.isTestKey,
      provider: MailProvider.LOB,
      cost: LOB_POSTCARD_COST,
    };
  } catch (error: any) {
    return {
      success: false,
      // Distinct, retryable signal when the Lob API stalls past LOB_TIMEOUT_MS.
      error: error instanceof LobTimeoutError ? 'lob timeout' : (error.message || String(error)),
      isTestMode: resolved.isTestKey,
      provider: MailProvider.LOB,
    };
  }
}

export async function sendLetter(options: LetterOptions): Promise<MailResult> {
  const resolved = await resolveLobClient(options.organizationId);

  if (!resolved) {
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

  logger.info(`[Mail] Sending letter via ${MailProvider.LOB} to ${options.to.name}`);
  return sendLetterViaLob(resolved, options);
}

export async function sendPostcard(options: PostcardOptions): Promise<MailResult> {
  const resolved = await resolveLobClient(options.organizationId);

  if (!resolved) {
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

  logger.info(`[Mail] Sending postcard via ${MailProvider.LOB} to ${options.to.name}`);
  return sendPostcardViaLob(resolved, options);
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

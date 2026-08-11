/**
 * mailProvider — the letter/postcard API the autopilot `send_letter` hand
 * uses. R-2 (founder ruling 2026-08-11): this file no longer resolves
 * credentials. It asks `mail/mailLanes.assertMailLane` — the single door —
 * exactly like every other mail path in the repo.
 *
 * Two defects died here:
 *   • `getOrgMailCredentials` read `integration.credentials.apiKey` in the
 *     CLEAR while every sibling resolver decrypted. An org whose Lob key was
 *     stored encrypted (the normal case) therefore looked "not connected" and
 *     fell through to the platform key — the exact re-fronting the founder
 *     ruled out.
 *   • `getDefaultCredentials()` was an unconditional platform fallback, so a
 *     counterparty letter with no org credential printed on AcreOS's account.
 *     It now refuses, naming the connect surface.
 */
import Lob from 'lob';
import { logger } from "../utils/logger";
import {
  assertMailLane,
  isMailLaneRefusal,
  isPlatformMailConfigured,
  type MailCredential,
  type MailPurpose,
} from './mail/mailLanes';

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
  /** REQUIRED — a letter is always sent on behalf of a specific customer org. */
  organizationId: number;
  /** Defaults to counterparty: everything this API mails today is deal mail. */
  purpose?: MailPurpose;
}

export interface PostcardOptions {
  to: MailAddress;
  from: MailAddress;
  front: string;
  back: string;
  size?: '4x6' | '6x9' | '6x11';
  description?: string;
  /** REQUIRED — see LetterOptions. */
  organizationId: number;
  purpose?: MailPurpose;
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
  credentials: MailCredential,
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
  credentials: MailCredential,
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
  return sendViaLane(options, 'letter', sendLetterViaLob);
}

export async function sendPostcard(options: PostcardOptions): Promise<MailResult> {
  return sendViaLane(options, 'postcard', sendPostcardViaLob);
}

/**
 * Shared lane → send. The lane check runs FIRST, before any credential is
 * held and before MAIL_MOCK — a simulation flag may stop paper from printing,
 * it may never grant an entitlement the org does not have.
 */
async function sendViaLane<T extends LetterOptions | PostcardOptions>(
  options: T,
  kind: 'letter' | 'postcard',
  send: (credentials: MailCredential, options: T) => Promise<MailResult>,
): Promise<MailResult> {
  let credentials: MailCredential;
  try {
    credentials = await assertMailLane({
      organizationId: options.organizationId,
      purpose: options.purpose ?? 'counterparty',
      pieceCount: 1,
    });
  } catch (err) {
    if (!isMailLaneRefusal(err)) throw err;
    logger.info(`[Mail] ${kind} refused by the mail lane`, {
      metadata: { organizationId: options.organizationId, reason: err.details.reason },
    });
    return {
      success: false,
      error: err.message,
      isTestMode: false,
      provider: MailProvider.LOB,
    };
  }

  // Dev-only simulation. Never a silent default: without the explicit flag a
  // missing provider refuses rather than fabricating a successful send.
  if (process.env.MAIL_MOCK === '1') {
    logger.info(`[Mail] MAIL_MOCK - simulating ${kind} to ${options.to.name}`);
    return {
      success: true,
      mailingId: `mock-${kind}-${Date.now()}`,
      isTestMode: true,
      provider: MailProvider.LOB,
    };
  }

  logger.info(
    `[Mail] Sending ${kind} to ${options.to.name} (credential: ${credentials.source}, testEnv: ${credentials.isTestKey})`,
  );
  return send(credentials, options);
}

export function getProviderInfo(): {
  available: MailProvider[];
  default: MailProvider | null;
  costs: Record<MailProvider, { letter: number; postcard: number }>;
} {
  // Platform-key presence only — an ORG's ability to send is org-scoped and
  // answered by mailLanes.mailLaneStatus(orgId), never by a process-wide read.
  const available: MailProvider[] = [];
  let defaultProvider: MailProvider | null = null;

  if (isPlatformMailConfigured()) {
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

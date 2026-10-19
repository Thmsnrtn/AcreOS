import Lob from 'lob';
import { logger } from "../utils/logger";
import { resolvePlatformLobKey, isLiveSendArmed } from './mail/liveSendInterlock';
import { getLobClientForLane } from './directMailService';
import {
  resolveMailLane,
  chargeHouseMailPiece,
  refundUnbilledHouseMail,
  providerDidNotBill,
  houseLetterFile,
  postcardSpec,
  letterSpec,
  type HouseMailCharge,
  type HouseMailSpec,
} from './mail/mailLane';
import { randomUUID } from 'node:crypto';
import { clock } from "../utils/clock";
import { assertOwnerContactAllowed } from "./trust/ownerSuppression";

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
  /** HTML or a PDF URL — or, internally for a house letter, the counted PDF upload. */
  file: string | ReturnType<typeof houseLetterFile>;
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
  /** Set on a failure: true only when Lob certainly did not accept (or bill) the piece. */
  providerNotBilled?: boolean;
}

interface ProviderCredentials {
  provider: MailProvider;
  apiKey: string;
  isTestKey: boolean;
}

/**
 * A resolved, ready-to-send Lob client. Credential RESOLUTION does not live in
 * this module — `directMailService.getOwnLobClient` / `getLobClientForLane` are the single authority (BYOK
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
 * Resolve how one piece is sent.
 *
 * WITH an organizationId the piece is the org's mail, and its lane is decided
 * by the one lane authority (mail/mailLane.ts, founder decision 2026-10-17):
 * the org's own Lob key (no credits), or AcreOS house mail — charged its
 * credit weight here, with the return address REPLACED by the org's verified
 * sender identity. A refused lane is returned as a refusal; nothing is sent.
 *
 * WITHOUT one it is AcreOS's own system mail on the platform key
 * (getDefaultCredentials), unchanged.
 */
type LobSendPlan =
  | {
      kind: 'send';
      resolved: ResolvedLobClient;
      from: MailAddress;
      charge: HouseMailCharge | null;
      /** House letter: the counted PDF Lob prints (decision 2026-10-18). */
      letterFile?: ReturnType<typeof houseLetterFile>;
    }
  | { kind: 'refused'; error: string }
  | { kind: 'unconfigured' };

async function planLobSend(
  spec: HouseMailSpec,
  organizationId: number | undefined,
  from: MailAddress,
): Promise<LobSendPlan> {
  if (organizationId) {
    try {
      const lane = await resolveMailLane(organizationId, spec, { via: 'lob' });
      if (lane.lane === 'refused') return { kind: 'refused', error: lane.message };
      const { client, source, isTestKey } = await getLobClientForLane(organizationId, lane);
      logger.info(`[Mail] Lob client resolved for org ${organizationId} (lane: ${lane.lane}, source: ${source})`);
      if (lane.lane === 'own_account') {
        return { kind: 'send', resolved: { client, isTestKey }, from, charge: null };
      }
      const identity = lane.senderIdentity;
      const charge = await chargeHouseMailPiece({
        organizationId,
        lane,
        externalEventId: `mail:house:${organizationId}:${lane.price.key}:autopilot:${randomUUID()}`,
      });
      return {
        kind: 'send',
        resolved: { client, isTestKey },
        from: {
          name: identity.companyName,
          addressLine1: identity.addressLine1,
          addressLine2: identity.addressLine2 || undefined,
          city: identity.city,
          state: identity.state,
          zip: identity.zipCode,
        },
        charge,
        ...(spec.kind === 'letter' ? { letterFile: houseLetterFile(lane) } : {}),
      };
    } catch (error) {
      // Never fall through to the platform key for an org's mail.
      return { kind: 'refused', error: error instanceof Error ? error.message : String(error) };
    }
  }

  const credentials = getDefaultCredentials();
  if (!credentials) return { kind: 'unconfigured' };
  return {
    kind: 'send',
    resolved: { client: new Lob({ apiKey: credentials.apiKey }), isTestKey: credentials.isTestKey },
    from,
    charge: null,
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
    // Platform-wide owner opt-out (W5a) — inside the try: {success:false}.
    await assertOwnerContactAllowed('mail', { addressLine1: options.to.addressLine1, zip: options.to.zip });

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
      // A timeout or network error is "unknown" — Lob may have printed it.
      providerNotBilled: !(error instanceof LobTimeoutError) && providerDidNotBill(error),
    };
  }
}

async function sendPostcardViaLob(
  resolved: ResolvedLobClient,
  options: PostcardOptions
): Promise<MailResult> {
  try {
    const lob = resolved.client;
    // Platform-wide owner opt-out (W5a) — inside the try: {success:false}.
    await assertOwnerContactAllowed('mail', { addressLine1: options.to.addressLine1, zip: options.to.zip });

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
      // A timeout or network error is "unknown" — Lob may have printed it.
      providerNotBilled: !(error instanceof LobTimeoutError) && providerDidNotBill(error),
    };
  }
}

/** A piece that was not sent — nothing reached Lob. */
function notSent(error: string): MailResult {
  return { success: false, error, isTestMode: false, provider: MailProvider.LOB };
}

export async function sendLetter(options: LetterOptions): Promise<MailResult> {
  const plan = await planLobSend(
    letterSpec({ color: options.color ?? false, file: typeof options.file === 'string' ? options.file : null }),
    options.organizationId,
    options.from,
  );

  if (plan.kind === 'refused') {
    logger.warn(`[Mail] Letter to ${options.to.name} refused: ${plan.error}`);
    return notSent(plan.error);
  }
  if (plan.kind === 'unconfigured') {
    // No mail credentials configured. Only produce a mock mailing id under an
    // explicit dev flag — never as the silent default, which would fabricate a
    // successful send and let a real letter no-op while reporting success.
    if (process.env.MAIL_MOCK === '1') {
      logger.info(`[Mail] MAIL_MOCK - simulating letter to ${options.to.name}`);
      return {
        success: true,
        mailingId: `mock-letter-${clock.nowMs()}`,
        isTestMode: true,
        provider: MailProvider.LOB,
      };
    }
    logger.warn(`[Mail] No provider configured - refusing to send letter to ${options.to.name}`);
    return notSent('mail provider not configured');
  }

  logger.info(`[Mail] Sending letter via ${MailProvider.LOB} to ${options.to.name}`);
  const result = await sendLetterViaLob(plan.resolved, { ...options, from: plan.from, file: plan.letterFile ?? options.file });
  if (!result.success && options.organizationId) {
    await refundUnbilledHouseMail(options.organizationId, plan.charge, { providerNotBilled: result.providerNotBilled === true }, 'Letter was rejected by Lob');
  }
  return result;
}

export async function sendPostcard(options: PostcardOptions): Promise<MailResult> {
  const plan = await planLobSend(postcardSpec(options.size || '4x6'), options.organizationId, options.from);

  if (plan.kind === 'refused') {
    logger.warn(`[Mail] Postcard to ${options.to.name} refused: ${plan.error}`);
    return notSent(plan.error);
  }
  if (plan.kind === 'unconfigured') {
    // No mail credentials configured. Only produce a mock mailing id under an
    // explicit dev flag — never as the silent default, which would fabricate a
    // successful send and let a real postcard no-op while reporting success.
    if (process.env.MAIL_MOCK === '1') {
      logger.info(`[Mail] MAIL_MOCK - simulating postcard to ${options.to.name}`);
      return {
        success: true,
        mailingId: `mock-postcard-${clock.nowMs()}`,
        isTestMode: true,
        provider: MailProvider.LOB,
      };
    }
    logger.warn(`[Mail] No provider configured - refusing to send postcard to ${options.to.name}`);
    return notSent('mail provider not configured');
  }

  logger.info(`[Mail] Sending postcard via ${MailProvider.LOB} to ${options.to.name}`);
  const result = await sendPostcardViaLob(plan.resolved, { ...options, from: plan.from });
  if (!result.success && options.organizationId) {
    await refundUnbilledHouseMail(options.organizationId, plan.charge, { providerNotBilled: result.providerNotBilled === true }, 'Postcard was rejected by Lob');
  }
  return result;
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

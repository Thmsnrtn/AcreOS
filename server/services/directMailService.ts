import Lob from 'lob';
import type { MailSenderIdentity } from '@shared/schema';
import { storage } from '../storage';
import { readIntegrationCredentials } from './integrationCredentials';
import { logger } from "../utils/logger";
import { resolvePlatformLobKey } from './mail/liveSendInterlock';
import { clock } from "../utils/clock";
import { assertOwnerContactAllowed } from "./trust/ownerSuppression";
import {
  resolveMailLane,
  assertSendableLane,
  chargeHouseMailPiece,
  refundUnbilledHouseMail,
  withBillingVerdict,
  houseMailProviderCostCents,
  postcardSpec,
  letterSpec,
  type HouseMailCharge,
  type HouseMailSpec,
  type SendableMailLane,
} from './mail/mailLane';
import { houseMailSpecKey } from '@shared/billing/house-mail-pricing';
import { randomUUID } from 'node:crypto';

interface RecipientAddress {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  zip: string;
}

interface SendPostcardOptions {
  organizationId: number;
  senderIdentity: MailSenderIdentity;
  recipientName: string;
  recipientAddress: RecipientAddress;
  frontHtml: string;
  backHtml: string;
  size?: '4x6' | '6x9' | '6x11';
  /**
   * The caller already charged this piece through its own ledger, so a house
   * piece is not charged again here. Only the outreach mail queue (via the
   * Lob router adapter) and the campaign send route may pass it —
   * tests/unit/physicalMailLanePopulation.test.ts holds that list.
   */
  housePrepaid?: boolean;
  // Lob requires use_type ("marketing" | "operational") unless an account
  // default is configured — omitting it makes every send fail. Default to
  // marketing (land-owner outreach is promotional); override for transactional.
  useType?: 'marketing' | 'operational';
}

interface SendLetterOptions {
  organizationId: number;
  senderIdentity: MailSenderIdentity;
  recipientName: string;
  recipientAddress: RecipientAddress;
  htmlContent: string;
  color?: boolean;
  doubleSided?: boolean;
  /**
   * The caller already charged this piece through its own ledger, so a house
   * piece is not charged again here. Only the outreach mail queue (via the
   * Lob router adapter) and the campaign send route may pass it —
   * tests/unit/physicalMailLanePopulation.test.ts holds that list.
   */
  housePrepaid?: boolean;
  useType?: 'marketing' | 'operational';
  /**
   * Stable key for THIS logical letter, derived from durable domain identity
   * (a campaign piece id, a note-payment notice id) — never a random value,
   * which would defeat the mechanism on the retry it exists to protect.
   *
   * When supplied, the credit deduction, the Lob call and the ledger posting
   * all happen at most once per key: a job that dies after Lob accepted the
   * letter cannot deduct credits again, post cost again, and print a SECOND
   * physical letter to a real seller. See
   * server/services/actions/outwardAction.ts.
   *
   * Optional so existing callers keep working unchanged. The count of send
   * sites that DON'T pass one is ratcheted down by
   * tests/unit/outwardActionCoverage.test.ts.
   */
  idempotencyKey?: string;
}

interface SendResult {
  lobId: string;
  url: string;
  expectedDeliveryDate: Date;
  credentialSource?: 'organization' | 'platform' | 'simulation';
  /**
   * True when the send ran against Lob's TEST environment — rendered and
   * validated, but NO physical mail was printed. Surfaced so callers/UI can
   * never present a test send as real mail. See mail/liveSendInterlock.ts.
   */
  testMode: boolean;
}

interface VerifyAddressResult {
  isValid: boolean;
  deliverability: string;
  details: {
    components?: {
      primaryNumber?: string;
      streetPredirection?: string;
      streetName?: string;
      streetSuffix?: string;
      city?: string;
      state?: string;
      zipCode?: string;
      zipCodePlus4?: string;
    };
    deliverabilityAnalysis?: {
      dpvConfirmation?: string;
      dpvCmra?: string;
      dpvVacant?: string;
      dpvFootnotes?: string[];
    };
    lobAddressId?: string;
  };
  errorMessage?: string;
}

interface LobClientResult {
  client: InstanceType<typeof Lob>;
  source: 'organization' | 'platform';
  /** True when the client is bound to Lob's test environment (no physical mail). */
  isTestKey: boolean;
}

/**
 * THE single Lob credential authority (founder-approved consolidation,
 * 2026-08-16; lanes per founder decision 2026-10-17).
 *
 * The ORG's own Lob key: BYOK vault first, then the legacy
 * organization_integrations row. Null when the org has none — this function
 * never falls back to AcreOS's key. tests/unit/lobCredentialAuthority.test.ts
 * pins the order and the absence of a second resolver.
 */
export async function getOwnLobClient(orgId: number): Promise<LobClientResult | null> {
  try {
    const { getByokCredential } = await import('./byok/key-vault');
    const byokKey = await getByokCredential({ organizationId: orgId, channel: 'lob' });
    if (byokKey) {
      logger.info(`[DirectMailService] Using BYOK Lob credential for org ${orgId}`);
      return {
        client: new Lob({ apiKey: byokKey }),
        source: 'organization',
        isTestKey: byokKey.startsWith('test_'),
      };
    }
  } catch (error) {
    logger.warn(`[DirectMailService] BYOK lookup failed for org ${orgId} — falling back to legacy`, error instanceof Error ? error : undefined);
  }

  try {
    const integration = await storage.getOrganizationIntegration(orgId, 'lob');

    const decrypted = readIntegrationCredentials<{ apiKey?: string }>(
      integration,
      orgId,
      'lob (directMailService)',
    );
    if (integration && integration.isEnabled && decrypted) {
      if (decrypted.apiKey) {
        logger.info(`[DirectMailService] Using organization Lob credentials for org ${orgId}`);
        return {
          client: new Lob({ apiKey: decrypted.apiKey }),
          source: 'organization',
          isTestKey: decrypted.apiKey.startsWith('test_'),
        };
      }
    }
  } catch (error) {
    logger.error(`[DirectMailService] Failed to get org Lob credentials for org ${orgId}`, error);
  }

  return null;
}

/**
 * The Lob client for a resolved mail lane (server/services/mail/mailLane.ts).
 *
 *   own_account → the org's own key (getOwnLobClient). The platform key is
 *                 never read on this lane.
 *   house       → AcreOS's own Lob account under the live-send interlock —
 *                 reachable ONLY with a house lane, which resolveMailLane
 *                 grants only with a verified sender identity, and whose
 *                 per-piece credit charge the send site takes.
 */
export async function getLobClientForLane(orgId: number, lane: SendableMailLane): Promise<LobClientResult> {
  if (lane.lane === 'own_account') {
    const own = await getOwnLobClient(orgId);
    if (!own) {
      const { ProviderNotContactedError } = await import('./actions/outwardAction');
      throw new ProviderNotContactedError(
        'Your own Lob key could not be read, so nothing was mailed. Reconnect it in Settings → Your provider keys.',
      );
    }
    return own;
  }

  // House lane: platform key under the live-send interlock — test env unless armed.
  const { apiKey, isTestKey } = resolvePlatformLobKey();
  logger.info(
    `[DirectMailService] AcreOS house mail for org ${orgId} (lobEnv: ${isTestKey ? "test" : "live"})`,
  );
  return {
    client: new Lob({ apiKey }),
    source: 'platform',
    isTestKey,
  };
}

function getPlatformLobClient(): InstanceType<typeof Lob> {
  // Platform key under the live-send interlock — test env unless armed.
  const { apiKey } = resolvePlatformLobKey();
  return new Lob({ apiKey });
}

function formatSenderAddress(identity: MailSenderIdentity) {
  return {
    name: identity.companyName,
    address_line1: identity.addressLine1,
    address_line2: identity.addressLine2 || undefined,
    address_city: identity.city,
    address_state: identity.state,
    address_zip: identity.zipCode,
  };
}

function formatRecipientAddress(name: string, address: RecipientAddress) {
  return {
    name,
    address_line1: address.line1,
    address_line2: address.line2 || undefined,
    address_city: address.city,
    address_state: address.state,
    address_zip: address.zip,
  };
}

function parseExpectedDeliveryDate(dateString: string): Date {
  const parsed = new Date(dateString);
  return isNaN(parsed.getTime()) ? clock.now() : parsed;
}

/**
 * Resolve the lane for one piece, the Lob client for that lane, and — on the
 * house lane — take the piece's credit charge. Everything here happens BEFORE
 * Lob is contacted, so every refusal is a ProviderNotContactedError: the
 * outward-action claim records `failed`, and a retry after the customer fixes
 * the cause (verifies the address, buys credits) works under the same key.
 *
 * `housePrepaid`: the caller already charged this piece through its own
 * ledger (the outreach mail queue debits the pool at queue time; the campaign
 * route debits its order). tests/unit/physicalMailLanePopulation.test.ts
 * restricts which callers may say so.
 */
async function prepareLobSend(args: {
  organizationId: number;
  spec: HouseMailSpec;
  senderIdentity: MailSenderIdentity;
  housePrepaid: boolean;
  idempotencyKey?: string;
  recipientName: string;
}): Promise<{ lane: SendableMailLane; client: InstanceType<typeof Lob>; source: 'organization' | 'platform'; isTestKey: boolean; charge: HouseMailCharge | null }> {
  const lane = await assertSendableLane(
    await resolveMailLane(args.organizationId, args.spec, { via: 'lob', senderIdentity: args.senderIdentity }),
  );
  const { client, source, isTestKey } = await getLobClientForLane(args.organizationId, lane);
  let charge: HouseMailCharge | null = null;
  if (lane.lane === 'house' && !args.housePrepaid) {
    // Pre-paid from PURCHASED credits before Lob is contacted. The key is per
    // attempt: a letter with an idempotencyKey runs inside the outward-action
    // boundary (at most one attempt reaches Lob), and an attempt Lob rejected
    // was refunded — replaying its key would mail a piece no one paid for.
    charge = await chargeHouseMailPiece({
      organizationId: args.organizationId,
      lane,
      externalEventId: `mail:house:${args.organizationId}:${lane.price.key}:${args.idempotencyKey ?? 'adhoc'}:${randomUUID()}`,
      notes: `AcreOS mail: ${lane.price.label} to ${args.recipientName}`,
    });
  }
  if (lane.lane === 'own_account') {
    logger.info(`[DirectMailService] Own Lob account for org ${args.organizationId} — no AcreOS credits`);
  }
  return { lane, client, source, isTestKey, charge };
}

// Pillar 1.6 — what a Lob piece cost AcreOS, for the opex ledger. Read from
// the ONE cost table (shared/billing/house-mail-pricing.ts via
// mailLane.houseMailProviderCostCents: founder setting → legacy env knob →
// compiled), the same figure the house charge is checked against. A spec the
// table does not price posts no figure rather than a guessed one.
async function lobPieceCostCents(spec: HouseMailSpec): Promise<number> {
  const key = houseMailSpecKey(spec);
  return key ? houseMailProviderCostCents(key) : 0;
}

async function postLobCostToLedger(
  organizationId: number,
  lobId: string,
  amountCents: number,
  pieceType: 'postcard' | 'letter',
): Promise<void> {
  if (amountCents <= 0 || !lobId) return;
  // Universal BYOK: when the org is using its own Lob key, the spend
  // was billed directly to the customer's Lob account — never our
  // opex bucket. Short-circuit before posting.
  try {
    const { isByokEnabled } = await import('./byok/toggle');
    if (await isByokEnabled(organizationId, 'lob')) {
      logger.info(`[DirectMailService] Skipping opex ledger post (BYOK lob active) for org ${organizationId}`);
      return;
    }
  } catch {
    /* fall through — best-effort BYOK check, never blocks the send */
  }
  try {
    const { postOpexSpent } = await import('./financial-ledger');
    await postOpexSpent({
      organizationId,
      amountCents,
      category: 'mail',
      feature: pieceType,
      providerName: 'lob',
      providerEventId: lobId,
      externalEventId: `lob:${pieceType}:${lobId}`,
    });
  } catch (err) {
    logger.warn('[DirectMailService] ledger postOpexSpent failed (non-fatal)', err instanceof Error ? err : undefined);
  }
}

export async function sendPostcard(options: SendPostcardOptions): Promise<SendResult> {
  const { organizationId, senderIdentity, recipientName, recipientAddress, frontHtml, backHtml, size = '4x6', useType = 'marketing' } = options;
  // Platform-wide owner opt-out (W5a) — before simulation, credits and Lob.
  await assertOwnerContactAllowed('mail', { addressLine1: recipientAddress.line1, zip: recipientAddress.zip });

  logger.info(`[DirectMailService] Sending postcard for org ${organizationId} to ${recipientName}`);

  // SIMULATION_MODE short-circuits every Lob postcard print. No paper
  // leaves the printer. Would-have-mailed payload goes to
  // simulated_actions so the test harness can verify "did the system
  // decide to mail this person?" without the postage.
  {
    const { shouldSimulate, recordSimulatedAction } = await import("../utils/simulationMode");
    const { storage } = await import("../storage");
    const org = await storage.getOrganization(organizationId).catch(() => null);
    if (shouldSimulate("lob", org)) {
      const rec = await recordSimulatedAction(
        "lob",
        "postcards.create",
        { recipientName, recipientAddress, size },
        org
      );
      return {
        lobId: rec.id,
        url: `https://sim.acreos.io/lob/${rec.id}`,
        expectedDeliveryDate: new Date(clock.nowMs() + 5 * 24 * 60 * 60 * 1000),
        credentialSource: "simulation",
        testMode: true,
      } as SendResult;
    }
  }

  const { client, source, isTestKey, charge } = await prepareLobSend({
    organizationId,
    spec: postcardSpec(size),
    senderIdentity,
    housePrepaid: options.housePrepaid === true,
    idempotencyKey: undefined,
    recipientName,
  });

  let accepted = false;
  try {
    const result = await client.postcards.create({
      to: formatRecipientAddress(recipientName, recipientAddress),
      from: formatSenderAddress(senderIdentity),
      front: frontHtml,
      back: backHtml,
      size,
      use_type: useType,
    });
    
    accepted = true;
    logger.info(`[DirectMailService] Postcard sent successfully: ${result.id} (source: ${source})`);

    // Pillar 1.6 — debit opex_available by Lob piece cost.
    await postLobCostToLedger(organizationId, result.id, await lobPieceCostCents(postcardSpec(size)), 'postcard');

    return {
      lobId: result.id,
      url: (result as any).url || '',
      expectedDeliveryDate: parseExpectedDeliveryDate(result.expected_delivery_date),
      credentialSource: source,
      testMode: isTestKey,
    };
  } catch (error: any) {
    // Refunded only when Lob certainly did not bill the piece (it rejected
    // it); a timeout or 5xx keeps the charge — Lob may have printed it.
    if (!accepted) await refundUnbilledHouseMail(organizationId, charge, error, 'Postcard was rejected by Lob');
    logger.error('[DirectMailService] Postcard send failed', error);
    throw withBillingVerdict(new Error(`Failed to send postcard: ${error.message || 'Unknown error'}`), accepted ? null : error);
  }
}

/**
 * Print and mail a physical letter.
 *
 * When `options.idempotencyKey` is present this runs through the outward-action
 * boundary, so the whole consequential body — credit deduction, the Lob call
 * and the ledger posting — happens at most once per key. On a replay it THROWS
 * `LetterAlreadySentError` carrying the real Lob id rather than returning a
 * fabricated SendResult: we do not know the original expected-delivery date at
 * replay time, and inventing one would be exactly the fabrication
 * scripts/check-no-fabrication.mjs exists to prevent.
 */
export async function sendLetter(options: SendLetterOptions): Promise<SendResult> {
  if (!options.idempotencyKey) return performLetterSend(options);

  const { withOutwardAction } = await import("./actions/outwardAction");
  return withOutwardAction<SendResult>(
    {
      organizationId: options.organizationId,
      actionKind: "physical_mail.letter",
      idempotencyKey: options.idempotencyKey,
      // Everything that materially defines the piece. Reusing the key with
      // different content must be caught, not silently suppressed.
      payload: {
        recipientName: options.recipientName,
        recipientAddress: options.recipientAddress,
        senderIdentity: options.senderIdentity,
        htmlContent: options.htmlContent,
        color: options.color ?? false,
        doubleSided: options.doubleSided ?? false,
        useType: options.useType ?? 'marketing',
      },
    },
    async () => {
      try {
        const result = await performLetterSend(options);
        return { status: "succeeded", externalId: result.lobId, result };
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        // performLetterSend throws from two materially different places, and the
        // difference decides whether this key is retryable ever again.
        //
        //  · BEFORE Lob is contacted — a credit refusal. That path now throws
        //    ProviderNotContactedError, which withOutwardAction records `failed`,
        //    so a retry after topping up succeeds under the same durable key.
        //  · FROM the Lob call itself — genuinely ambiguous. A network failure
        //    there may or may not have printed a letter, so it stays
        //    unclassified and is recorded AMBIGUOUS, refusing retry until
        //    someone reconciles.
        //
        // Rethrowing unchanged is what preserves that distinction: the type
        // carries it, so this handler must not flatten it into a plain Error.
        throw error;
      }
    },
    (externalId) => {
      throw new LetterAlreadySentError(options.idempotencyKey!, externalId);
    },
  );
}

/**
 * Raised when a letter for this idempotency key was already printed. Carries
 * the real Lob id so the caller can record the send instead of repeating it.
 */
export class LetterAlreadySentError extends Error {
  constructor(readonly idempotencyKey: string, readonly lobId: string | null) {
    super(
      `Letter for idempotency key "${idempotencyKey}" was already sent` +
        (lobId ? ` (Lob id ${lobId})` : "") +
        `. Not printing a second copy.`,
    );
  }
}

async function performLetterSend(options: SendLetterOptions): Promise<SendResult> {
  const { organizationId, senderIdentity, recipientName, recipientAddress, htmlContent, color = false, doubleSided = false, useType = 'marketing' } = options;
  // Platform-wide owner opt-out (W5a) — before simulation, credits and Lob.
  await assertOwnerContactAllowed('mail', { addressLine1: recipientAddress.line1, zip: recipientAddress.zip });

  logger.info(`[DirectMailService] Sending letter for org ${organizationId} to ${recipientName}`);

  // SIMULATION_MODE short-circuits every Lob letter print. See the
  // matching block in sendPostcard for the rationale.
  {
    const { shouldSimulate, recordSimulatedAction } = await import("../utils/simulationMode");
    const { storage } = await import("../storage");
    const org = await storage.getOrganization(organizationId).catch(() => null);
    if (shouldSimulate("lob", org)) {
      const rec = await recordSimulatedAction(
        "lob",
        "letters.create",
        { recipientName, recipientAddress, color, doubleSided },
        org
      );
      return {
        lobId: rec.id,
        url: `https://sim.acreos.io/lob/${rec.id}`,
        expectedDeliveryDate: new Date(clock.nowMs() + 5 * 24 * 60 * 60 * 1000),
        credentialSource: "simulation",
        testMode: true,
      } as SendResult;
    }
  }

  const { client, source, isTestKey, charge } = await prepareLobSend({
    organizationId,
    spec: letterSpec({ color }),
    senderIdentity,
    housePrepaid: options.housePrepaid === true,
    idempotencyKey: options.idempotencyKey,
    recipientName,
  });

  let accepted = false;
  try {
    const result = await client.letters.create({
      to: formatRecipientAddress(recipientName, recipientAddress),
      from: formatSenderAddress(senderIdentity),
      file: htmlContent,
      color,
      double_sided: doubleSided,
      use_type: useType,
    });
    
    accepted = true;
    logger.info(`[DirectMailService] Letter sent successfully: ${result.id} (source: ${source})`);

    // Pillar 1.6 — debit opex_available by Lob piece cost.
    await postLobCostToLedger(
      organizationId,
      result.id,
      await lobPieceCostCents(letterSpec({ color })),
      'letter',
    );

    return {
      lobId: result.id,
      url: (result as any).url || '',
      expectedDeliveryDate: parseExpectedDeliveryDate(result.expected_delivery_date),
      credentialSource: source,
      testMode: isTestKey,
    };
  } catch (error: any) {
    if (!accepted) await refundUnbilledHouseMail(organizationId, charge, error, 'Letter was rejected by Lob');
    logger.error('[DirectMailService] Letter send failed', error);
    throw withBillingVerdict(new Error(`Failed to send letter: ${error.message || 'Unknown error'}`), accepted ? null : error);
  }
}

/**
 * Cheap pre-flight reject before a PAID Lob verification call. Ported from the
 * deleted addressValidation.ts (unit 116) — it was that module's one capability
 * the live rival lacked: obviously-bad input (no street line, neither city+state
 * nor zip) fails here for free instead of costing a Lob API call.
 *
 * Lob rate limits, recorded here because the deleted module was the only place
 * they were written down: 150 req/s live keys, 5 req/s test keys — batch callers
 * should pace sequentially rather than fan out.
 */
export function isAddressMinimallyValid(address: { line1?: string; city?: string; state?: string; zip?: string }): boolean {
  const { line1, city, state, zip } = address;
  if (!line1 || line1.trim().length < 5) return false;
  // Need at least city+state OR zip
  if (!zip && (!city || !state)) return false;
  return true;
}

/**
 * Lob address verification, on the ORG's own Lob account when it has one —
 * a BYO org's verifications are its own Lob traffic, never AcreOS's. Only an
 * org with no own key verifies on AcreOS's account (the house lane, whose
 * pieces require a verified return address in the first place).
 */
export async function verifyAddress(address: RecipientAddress, organizationId: number): Promise<VerifyAddressResult> {
  logger.info(`[DirectMailService] Verifying address for org ${organizationId}: ${address.line1}, ${address.city}, ${address.state} ${address.zip}`);
  
  try {
    const own = await getOwnLobClient(organizationId);
    const client = (own ? own.client : getPlatformLobClient()) as any;
    
    const result = await client.usVerifications.verify({
      primary_line: address.line1,
      secondary_line: address.line2 || '',
      city: address.city,
      state: address.state,
      zip_code: address.zip,
    });
    
    const deliverability = result.deliverability || 'unknown';
    const isValid = deliverability === 'deliverable' || deliverability === 'deliverable_unnecessary_unit';
    
    logger.info(`[DirectMailService] Address verification result: ${deliverability}, isValid: ${isValid}`);
    
    return {
      isValid,
      deliverability,
      details: {
        components: result.components ? {
          primaryNumber: result.components.primary_number,
          streetPredirection: result.components.street_predirection,
          streetName: result.components.street_name,
          streetSuffix: result.components.street_suffix,
          city: result.components.city,
          state: result.components.state,
          zipCode: result.components.zip_code,
          zipCodePlus4: result.components.zip_code_plus_4,
        } : undefined,
        deliverabilityAnalysis: result.deliverability_analysis ? {
          dpvConfirmation: result.deliverability_analysis.dpv_confirmation,
          dpvCmra: result.deliverability_analysis.dpv_cmra,
          dpvVacant: result.deliverability_analysis.dpv_vacant,
          dpvFootnotes: result.deliverability_analysis.dpv_footnotes,
        } : undefined,
        lobAddressId: result.id,
      },
    };
  } catch (error: any) {
    logger.error('[DirectMailService] Address verification failed', error);
    
    const errorMessage = error.message || 'Address verification failed';
    
    return {
      isValid: false,
      deliverability: 'undeliverable',
      details: {},
      errorMessage,
    };
  }
}

import Lob from 'lob';
import type { MailSenderIdentity } from '@shared/schema';
import { creditService, usageMeteringService } from './credits';
import { storage } from '../storage';
import { readIntegrationCredentials } from './integrationCredentials';
import { logger } from "../utils/logger";
import { resolvePlatformLobKey } from './mail/liveSendInterlock';

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
  skipCredits?: boolean;
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
  skipCredits?: boolean;
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

export async function getLobClient(orgId: number): Promise<LobClientResult> {
  // Universal BYOK (2026-05-22) — preferred path. Falls back to the
  // legacy organization_integrations row, then platform env.
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
  
  // Platform key under the live-send interlock — test env unless armed.
  const { apiKey, isTestKey } = resolvePlatformLobKey();

  logger.info(
    `[DirectMailService] Using platform Lob credentials for org ${orgId} (lobEnv: ${isTestKey ? "test" : "live"})`,
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
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

async function checkCreditsAndRecord(organizationId: number, metadata?: Record<string, any>): Promise<{ hasCredits: boolean; costCents: number; errorMessage?: string }> {
  const costCents = await usageMeteringService.calculateCost('direct_mail', 1);
  const hasCredits = await creditService.hasEnoughCredits(organizationId, costCents);
  
  if (!hasCredits) {
    const balance = await creditService.getBalance(organizationId);
    return {
      hasCredits: false,
      costCents,
      errorMessage: `Insufficient credits. Required: $${(costCents / 100).toFixed(2)}, Balance: $${(balance / 100).toFixed(2)}`,
    };
  }
  
  return { hasCredits: true, costCents };
}

async function recordUsage(organizationId: number, metadata: Record<string, any>): Promise<void> {
  await usageMeteringService.recordUsage(organizationId, 'direct_mail', 1, metadata);
}

// Pillar 1.6 — Lob piece-cost table (cents). Numbers approximate Lob's
// public 2026 pricing; adjust if Lob repriced. Read once per call from
// env overrides so a founder can re-tune without redeploying.
function lobPieceCostCents(type: 'postcard' | 'letter', size?: string, color?: boolean): number {
  if (type === 'postcard') {
    if (size === '6x11') return Number(process.env.LOB_POSTCARD_6X11_CENTS ?? 110);
    if (size === '6x9') return Number(process.env.LOB_POSTCARD_6X9_CENTS ?? 85);
    return Number(process.env.LOB_POSTCARD_4X6_CENTS ?? 65);
  }
  // letter — color flips the rate up a notch
  return color
    ? Number(process.env.LOB_LETTER_COLOR_CENTS ?? 120)
    : Number(process.env.LOB_LETTER_BW_CENTS ?? 85);
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
        expectedDeliveryDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        credentialSource: "simulation",
        testMode: true,
      } as SendResult;
    }
  }

  const { client, source, isTestKey } = await getLobClient(organizationId);
  
  const skipCredits = options.skipCredits === true || source === 'organization';
  
  if (!skipCredits) {
    const creditCheck = await checkCreditsAndRecord(organizationId, { type: 'postcard', recipient: recipientName });
    if (!creditCheck.hasCredits) {
      // PROVABLY not sent: checkCreditsAndRecord only READS the balance (it
      // deducts nothing despite its name), and Lob has not been called. Typing
      // this as ProviderNotContactedError records the claim `failed` rather than
      // `ambiguous`, so topping up the balance and retrying under the SAME
      // durable key works. An unclassified throw here would poison the key
      // permanently and tell the operator to reconcile against a provider that
      // never heard of the request.
      const { ProviderNotContactedError } = await import('./actions/outwardAction');
      throw new ProviderNotContactedError(creditCheck.errorMessage!);
    }
  }
  
  if (source === 'organization') {
    logger.info(`[DirectMailService] Skipping credit usage for org ${organizationId} - using org credentials`);
  }
  
  try {
    const result = await client.postcards.create({
      to: formatRecipientAddress(recipientName, recipientAddress),
      from: formatSenderAddress(senderIdentity),
      front: frontHtml,
      back: backHtml,
      size,
      use_type: useType,
    });
    
    logger.info(`[DirectMailService] Postcard sent successfully: ${result.id} (source: ${source})`);

    if (!skipCredits) {
      await recordUsage(organizationId, { type: 'postcard', lobId: result.id, recipient: recipientName });
    }

    // Pillar 1.6 — debit opex_available by Lob piece cost.
    await postLobCostToLedger(organizationId, result.id, lobPieceCostCents('postcard', size), 'postcard');

    return {
      lobId: result.id,
      url: (result as any).url || '',
      expectedDeliveryDate: parseExpectedDeliveryDate(result.expected_delivery_date),
      credentialSource: source,
      testMode: isTestKey,
    };
  } catch (error: any) {
    logger.error('[DirectMailService] Postcard send failed', error);
    throw new Error(`Failed to send postcard: ${error.message || 'Unknown error'}`);
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
        expectedDeliveryDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        credentialSource: "simulation",
        testMode: true,
      } as SendResult;
    }
  }

  const { client, source, isTestKey } = await getLobClient(organizationId);
  
  const skipCredits = options.skipCredits === true || source === 'organization';
  
  if (!skipCredits) {
    const creditCheck = await checkCreditsAndRecord(organizationId, { type: 'letter', recipient: recipientName });
    if (!creditCheck.hasCredits) {
      // PROVABLY not sent: checkCreditsAndRecord only READS the balance (it
      // deducts nothing despite its name), and Lob has not been called. Typing
      // this as ProviderNotContactedError records the claim `failed` rather than
      // `ambiguous`, so topping up the balance and retrying under the SAME
      // durable key works. An unclassified throw here would poison the key
      // permanently and tell the operator to reconcile against a provider that
      // never heard of the request.
      const { ProviderNotContactedError } = await import('./actions/outwardAction');
      throw new ProviderNotContactedError(creditCheck.errorMessage!);
    }
  }
  
  if (source === 'organization') {
    logger.info(`[DirectMailService] Skipping credit usage for org ${organizationId} - using org credentials`);
  }
  
  try {
    const result = await client.letters.create({
      to: formatRecipientAddress(recipientName, recipientAddress),
      from: formatSenderAddress(senderIdentity),
      file: htmlContent,
      color,
      double_sided: doubleSided,
      use_type: useType,
    });
    
    logger.info(`[DirectMailService] Letter sent successfully: ${result.id} (source: ${source})`);

    if (!skipCredits) {
      await recordUsage(organizationId, { type: 'letter', lobId: result.id, recipient: recipientName });
    }

    // Pillar 1.6 — debit opex_available by Lob piece cost.
    await postLobCostToLedger(
      organizationId,
      result.id,
      lobPieceCostCents('letter', undefined, color),
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
    logger.error('[DirectMailService] Letter send failed', error);
    throw new Error(`Failed to send letter: ${error.message || 'Unknown error'}`);
  }
}

export async function verifyAddress(address: RecipientAddress): Promise<VerifyAddressResult> {
  logger.info(`[DirectMailService] Verifying address: ${address.line1}, ${address.city}, ${address.state} ${address.zip}`);
  
  try {
    const client = getPlatformLobClient() as any;
    
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

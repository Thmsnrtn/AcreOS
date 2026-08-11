import Lob from 'lob';
import type { MailSenderIdentity } from '@shared/schema';
import { creditService, usageMeteringService } from './credits';
import { storage } from '../storage';
import { logger } from "../utils/logger";
import { resolvePlatformLobKey } from './mail/liveSendInterlock';
import {
  assertMailLane,
  type MailCredential,
  type MailPurpose,
} from './mail/mailLanes';

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
  /** Purpose lane (mail/mailLanes.ts). Defaults to counterparty. */
  purpose?: MailPurpose;
  /**
   * A credential ALREADY cleared by assertMailLane for this batch — passed by
   * lobAdapter so a 500-piece shipment checks the lane once instead of 500
   * times. Only mailLanes can mint one, so this is not a bypass: without it
   * this function calls assertMailLane itself.
   */
  laneCredential?: MailCredential;
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
  /** Purpose lane (mail/mailLanes.ts). Defaults to counterparty. */
  purpose?: MailPurpose;
  /** See SendPostcardOptions.laneCredential. */
  laneCredential?: MailCredential;
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
 * R-2: credential resolution now lives behind the ONE door
 * (`mail/mailLanes.assertMailLane`). This used to run its own three-tier
 * cascade — BYOK vault → legacy integration → unconditional platform key —
 * which meant a counterparty letter for an org with no connected printer
 * account printed on AcreOS's Lob account. It now refuses instead.
 *
 * Throws MailLaneRefusal when the org may not send on this lane.
 */
export async function getLobClient(
  orgId: number,
  purpose: MailPurpose = 'counterparty',
  opts: { pieceCount?: number; laneCredential?: MailCredential } = {},
): Promise<LobClientResult> {
  const credential =
    opts.laneCredential ??
    (await assertMailLane({
      organizationId: orgId,
      purpose,
      pieceCount: opts.pieceCount ?? 1,
    }));

  logger.info(
    `[DirectMailService] Lob credential for org ${orgId}: source=${credential.source}, lobEnv=${credential.isTestKey ? 'test' : 'live'}`,
  );
  return {
    client: new Lob({ apiKey: credential.apiKey }),
    source: credential.source,
    isTestKey: credential.isTestKey,
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

  const { client, source, isTestKey } = await getLobClient(organizationId, options.purpose ?? 'counterparty', {
    laneCredential: options.laneCredential,
  });
  
  const skipCredits = options.skipCredits === true || source === 'organization';
  
  if (!skipCredits) {
    const creditCheck = await checkCreditsAndRecord(organizationId, { type: 'postcard', recipient: recipientName });
    if (!creditCheck.hasCredits) {
      throw new Error(creditCheck.errorMessage);
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

export async function sendLetter(options: SendLetterOptions): Promise<SendResult> {
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

  const { client, source, isTestKey } = await getLobClient(organizationId, options.purpose ?? 'counterparty', {
    laneCredential: options.laneCredential,
  });
  
  const skipCredits = options.skipCredits === true || source === 'organization';
  
  if (!skipCredits) {
    const creditCheck = await checkCreditsAndRecord(organizationId, { type: 'letter', recipient: recipientName });
    if (!creditCheck.hasCredits) {
      throw new Error(creditCheck.errorMessage);
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

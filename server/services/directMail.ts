import Lob from 'lob';
import { storage } from '../storage';
import { logger } from "../utils/logger";
import { shouldSimulate, recordSimulatedAction } from "../utils/simulationMode";
import { isLiveSendArmed } from './mail/liveSendInterlock';
import { getOwnLobClient } from './directMailService';
import {
  resolveMailLane,
  assertSendableLane,
  chargeHouseMailPiece,
  refundUnbilledHouseMail,
  houseLetterFile,
  postcardSpec,
  letterSpec,
  type HouseMailCharge,
  type HouseMailSpec,
  type SendableMailLane,
} from './mail/mailLane';
import { randomUUID } from 'node:crypto';
import { DIRECT_MAIL_COSTS, type MailPieceType } from "./sendPricing";
import { clock } from "../utils/clock";
import { assertOwnerContactAllowed } from "./trust/ownerSuppression";

async function logLobApiUsage(
  orgId: number | undefined,
  action: string,
  estimatedCostCents: number,
  metadata?: Record<string, any>
) {
  try {
    await storage.logApiUsage({
      organizationId: orgId || null,
      service: 'lob',
      action,
      count: 1,
      estimatedCostCents,
      metadata,
    });
  } catch (error) {
    logger.error('[DirectMail] Failed to log API usage', error);
  }
}

// Cost structure (in cents) - our pricing to users. Defined in
// ./sendPricing (the one home of every per-send price, read by Pax's quote
// tool too) and re-exported here for the existing importers.
export { DIRECT_MAIL_COSTS, type MailPieceType };
export type MailMode = 'test' | 'live';

export interface DirectMailRecipient {
  name: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  zip: string;
}

export interface PostcardOptions {
  size: '4x6' | '6x9' | '6x11';
  front: string; // HTML or URL
  back: string;  // HTML or URL
  to: DirectMailRecipient;
  from: DirectMailRecipient;
  /**
   * Stable key for THIS logical piece, derived from durable domain identity
   * (a mailing_order_pieces id, a campaign piece id) — never a random value,
   * which would defeat the mechanism on the retry it exists to protect.
   * Requires `orgId`, since the claim is tenant-scoped.
   * See server/services/actions/outwardAction.ts.
   */
  idempotencyKey?: string;
  /**
   * The caller already charged this piece (the campaign send route debits its
   * mailing order), so a house piece is not charged again here.
   * tests/unit/physicalMailLanePopulation.test.ts holds the callers allowed
   * to say so.
   */
  housePrepaid?: boolean;
}

export interface LetterOptions {
  file: string; // HTML or PDF URL
  to: DirectMailRecipient;
  from: DirectMailRecipient;
  color?: boolean;
  doubleSided?: boolean;
  pageCount?: number;
  /** See PostcardOptions.idempotencyKey. Requires `orgId`. */
  idempotencyKey?: string;
  /** See PostcardOptions.housePrepaid. */
  housePrepaid?: boolean;
}

/**
 * Raised when a mail piece for this idempotency key was already printed.
 * Carries the real Lob id so the caller can record the send rather than
 * repeating it.
 */
export class MailAlreadySentError extends Error {
  constructor(
    readonly actionKind: string,
    readonly idempotencyKey: string,
    readonly lobId: string | null,
  ) {
    super(
      `${actionKind} for idempotency key "${idempotencyKey}" was already sent` +
        (lobId ? ` (Lob id ${lobId})` : '') +
        `. Not printing a second copy.`,
    );
  }
}

export interface MailEstimate {
  perPieceCost: number;
  totalCost: number;
  recipientCount: number;
  pieceType: MailPieceType;
  expectedDeliveryDate?: string;
  isTestMode: boolean;
  validAddresses?: number;
  invalidAddresses?: number;
}

export interface SendResult {
  id: string;
  expectedDeliveryDate: string;
  isTestMode: boolean;
  credentialSource?: 'organization' | 'platform';
}

export class DirectMailService {
  private testLob: any = null;
  private liveLob: any = null;
  private hasTestKey: boolean = false;
  private hasLiveKey: boolean = false;

  constructor() {
    const apiKey = process.env.LOB_API_KEY;
    
    if (apiKey) {
      // Lob API keys are prefixed with 'test_' for test mode or 'live_' for production
      if (apiKey.startsWith('test_')) {
        this.testLob = new Lob({ apiKey });
        this.hasTestKey = true;
      } else if (apiKey.startsWith('live_')) {
        this.liveLob = new Lob({ apiKey });
        this.hasLiveKey = true;
      } else {
        // If no prefix, assume it's a live key
        this.liveLob = new Lob({ apiKey });
        this.hasLiveKey = true;
      }
    }
    
    // Also check for separate test/live keys
    const testKey = process.env.LOB_TEST_API_KEY;
    const liveKey = process.env.LOB_LIVE_API_KEY;
    
    if (testKey) {
      this.testLob = new Lob({ apiKey: testKey });
      this.hasTestKey = true;
    }
    
    if (liveKey) {
      this.liveLob = new Lob({ apiKey: liveKey });
      this.hasLiveKey = true;
    }
  }

  isAvailable(): boolean {
    return this.hasTestKey || this.hasLiveKey;
  }

  hasTestMode(): boolean {
    return this.hasTestKey;
  }

  hasLiveMode(): boolean {
    return this.hasLiveKey;
  }

  getAvailableModes(): MailMode[] {
    const modes: MailMode[] = [];
    if (this.hasTestKey) modes.push('test');
    if (this.hasLiveKey) modes.push('live');
    return modes;
  }

  /**
   * Degrade 'live' to 'test' while the platform live-send interlock is
   * disarmed (mail/liveSendInterlock.ts). org.settings.mailMode = 'live' is
   * a per-org preference; the interlock is the platform-wide launch gate
   * and always wins. Callers report the returned mode so isTestMode in
   * results never claims physical mail that didn't print.
   */
  private effectiveMode(requested: MailMode): MailMode {
    if (requested === 'live' && !isLiveSendArmed()) {
      logger.warn('[DirectMail] live mode requested while live sending is disarmed — using Lob test environment');
      return 'test';
    }
    return requested;
  }

  private getLobClient(mode: MailMode): any {
    if (mode === 'test') {
      if (!this.testLob) {
        throw new Error('Test mode Lob API key not configured');
      }
      return this.testLob;
    } else {
      if (!this.liveLob) {
        throw new Error('Live mode Lob API key not configured');
      }
      return this.liveLob;
    }
  }

  /**
   * The org's OWN Lob client, or null when the org has none.
   *
   * Resolution is DELEGATED to `directMailService.getOwnLobClient` — the single
   * credential authority (BYOK vault → legacy organization_integrations row),
   * per the 2026-08-16 consolidation. This method used to run
   * its own lookup that queried ONLY the legacy row, so an org whose Lob key
   * lives in the BYOK vault — the documented Universal-BYOK path — had its
   * campaign postcards and letters to LEADS printed on ACREOS's Lob account.
   * That is the identical defect the consolidation fixed in mailProvider.ts;
   * it survived here because the fix was applied to one file, not to the
   * behaviour.
   *
   * Returns NULL when the org has no own key: the house-lane branch of the
   * send carries the live-send interlock and the outreach stop-loss gate.
   */
  async getOrgLobClient(orgId: number): Promise<{ client: any; source: 'organization' | 'platform'; isTestKey: boolean } | null> {
    try {
      const own = await getOwnLobClient(orgId);
      if (own) {
        logger.info(`[DirectMail] Using organization Lob credentials for org ${orgId}`);
        return own;
      }
    } catch (error) {
      logger.error(`[DirectMail] Failed to get org Lob credentials for org ${orgId}`, error);
    }

    return null;
  }

  /**
   * The lane for one piece (founder decision 2026-10-17, mail/mailLane.ts),
   * decided before simulation, credits or Lob. Customer mail from this class
   * always belongs to an org: with no orgId there is no way to tell whose
   * account pays, so it refuses rather than defaulting to AcreOS's.
   *
   * On the house lane the return address is REPLACED by the org's verified
   * sender identity — a house piece never carries anything else. The credit
   * charge is taken by chargeHouse, immediately before Lob.
   */
  private async prepareLane(
    orgId: number | undefined,
    spec: HouseMailSpec,
    from: DirectMailRecipient,
    housePrepaid: boolean,
  ): Promise<{ orgClient: Awaited<ReturnType<DirectMailService['getOrgLobClient']>>; from: DirectMailRecipient; lane: SendableMailLane; housePrepaid: boolean }> {
    const { ProviderNotContactedError } = await import('./actions/outwardAction');
    if (!orgId) {
      throw new ProviderNotContactedError(
        'Customer direct mail requires an organization — without one there is no way to tell whose Lob account pays.',
      );
    }
    const lane = await assertSendableLane(await resolveMailLane(orgId, spec, { via: 'lob' }));
    if (lane.lane === 'own_account') {
      const orgClient = await this.getOrgLobClient(orgId);
      if (!orgClient) {
        throw new ProviderNotContactedError('Your own Lob key could not be read, so nothing was mailed. Reconnect it in Settings → Your provider keys.');
      }
      return { orgClient, from, lane, housePrepaid };
    }
    const identity = lane.senderIdentity;
    const houseFrom: DirectMailRecipient = {
      name: identity.companyName,
      addressLine1: identity.addressLine1,
      addressLine2: identity.addressLine2 || undefined,
      city: identity.city,
      state: identity.state,
      zip: identity.zipCode,
    };
    return { orgClient: null, from: houseFrom, lane, housePrepaid };
  }

  /**
   * Pre-pay one HOUSE piece from purchased credits, immediately before Lob is
   * called (after simulation and the stop-loss gate, which send nothing).
   * Own-key and prepaid pieces are never charged. Per-attempt key: see
   * directMailService.prepareLobSend.
   */
  private async chargeHouse(
    orgId: number,
    prepared: { lane: SendableMailLane; housePrepaid: boolean },
    idempotencyKey: string | undefined,
  ): Promise<HouseMailCharge | null> {
    if (prepared.lane.lane !== 'house' || prepared.housePrepaid) return null;
    return chargeHouseMailPiece({
      organizationId: orgId,
      lane: prepared.lane,
      externalEventId: `mail:house:${orgId}:${prepared.lane.price.key}:${idempotencyKey ?? 'adhoc'}:${randomUUID()}`,
    });
  }

  /** True when the ORG has its own Lob credential in any tier of the authority. */
  async hasOrgLobCredentials(orgId: number): Promise<boolean> {
    return (await this.getOrgLobClient(orgId)) !== null;
  }

  /**
   * Print and mail a postcard.
   *
   * When `options.idempotencyKey` and `orgId` are both present this runs
   * through the outward-action boundary, so a job retrying after a partial
   * success cannot print a second piece. See
   * server/services/actions/outwardAction.ts.
   */
  async sendPostcard(options: PostcardOptions, mode: MailMode = 'live', orgId?: number): Promise<SendResult> {
    if (options.idempotencyKey && orgId) {
      return this.guardedSend(
        orgId,
        'physical_mail.postcard',
        options.idempotencyKey,
        { to: options.to, from: options.from, size: options.size, front: options.front, back: options.back, mode },
        () => this.performSendPostcard(options, mode, orgId),
      );
    }
    return this.performSendPostcard(options, mode, orgId);
  }

  private async performSendPostcard(options: PostcardOptions, mode: MailMode = 'live', orgId?: number): Promise<SendResult> {
    // Platform-wide owner opt-out (W5a) — before simulation and Lob.
    await assertOwnerContactAllowed("mail", { addressLine1: options.to.addressLine1, zip: options.to.zip });
    const prepared = await this.prepareLane(orgId, postcardSpec(options.size), options.from, options.housePrepaid === true);
    options = { ...options, from: prepared.from };
    // Honor SIMULATION_MODE / SIMULATION_MODE_LOB / org.settings.simulationMode.
    // Previously this service relied only on Lob's own `test_*` key for safety,
    // which made the global kill-switch a lie for direct-mail. Caught 2026-05-10.
    const org = orgId ? await storage.getOrganization(orgId).catch(() => null) : null;
    if (shouldSimulate("lob", org)) {
      const sim = await recordSimulatedAction(
        "lob",
        "send_postcard",
        { to: options.to, from: options.from, size: options.size, mode },
        org as any
      );
      return {
        id: sim.id,
        expectedDeliveryDate: new Date(clock.nowMs() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        isTestMode: true,
        credentialSource: "platform",
      };
    }

    let lob: any;
    let credentialSource: 'organization' | 'platform' = 'platform';
    // Whether the send actually ran in Lob's test environment (no physical
    // mail) — org keys by prefix, platform keys by interlock-degraded mode.
    let usedTestEnv: boolean;

    const orgClient = prepared.orgClient;
    if (orgClient) {
      lob = orgClient.client;
      credentialSource = orgClient.source;
      usedTestEnv = orgClient.isTestKey;
    } else {
      const effective = this.effectiveMode(mode);
      // Outreach stop-loss gate (founder rulings #4/#5, 2026-07-28): a
      // platform-credential LIVE send spends the founder's mail budget, so
      // it's checked against the monthly mail+data line. Throws
      // OutreachPausedError when paused — nothing sends, nothing is
      // fabricated; the caller's queue item stays put. BYO-key (orgClient)
      // and test-env sends spend nothing and are not gated.
      if (effective === 'live') {
        const { assertOutreachNotPaused } = await import('./outreachStopLoss');
        await assertOutreachNotPaused('directMail.sendPostcard');
      }
      lob = this.getLobClient(effective);
      usedTestEnv = effective === 'test';
    }

    // Lob's test environment prints nothing: a house piece sent there is
    // never charged (the house lane already requires the armed interlock).
    const charge = usedTestEnv ? null : await this.chargeHouse(orgId!, prepared, options.idempotencyKey);
    let result: { id: string; expected_delivery_date: string };
    try {
    result = await lob.postcards.create({
      to: {
        name: options.to.name,
        address_line1: options.to.addressLine1,
        address_line2: options.to.addressLine2,
        address_city: options.to.city,
        address_state: options.to.state,
        address_zip: options.to.zip,
      },
      from: {
        name: options.from.name,
        address_line1: options.from.addressLine1,
        address_line2: options.from.addressLine2,
        address_city: options.from.city,
        address_state: options.from.state,
        address_zip: options.from.zip,
      },
      front: options.front,
      back: options.back,
      size: options.size,
    });
    } catch (err) {
      // Only a piece Lob certainly did not bill (rejected) is refunded.
      await refundUnbilledHouseMail(orgId!, charge, err, 'Postcard was rejected by Lob');
      throw err;
    }
    
    const costCents = options.size === '4x6' ? 80 : options.size === '6x9' ? 95 : 115;
    logLobApiUsage(orgId, 'send_postcard', costCents, { size: options.size, isTestMode: usedTestEnv });

    return {
      id: result.id,
      expectedDeliveryDate: result.expected_delivery_date,
      isTestMode: usedTestEnv,
      credentialSource,
    };
  }

  /** See sendPostcard — same outward-action boundary when a key is supplied. */
  async sendLetter(options: LetterOptions, mode: MailMode = 'live', orgId?: number): Promise<SendResult> {
    if (options.idempotencyKey && orgId) {
      return this.guardedSend(
        orgId,
        'physical_mail.letter',
        options.idempotencyKey,
        { to: options.to, from: options.from, file: options.file, color: options.color ?? false, doubleSided: options.doubleSided ?? false, mode },
        () => this.performSendLetter(options, mode, orgId),
      );
    }
    return this.performSendLetter(options, mode, orgId);
  }

  /**
   * Run one consequential mail send at most once per (org, kind, key).
   *
   * On REPLAY this throws rather than returning a SendResult: the original
   * expected-delivery date is not knowable at replay time, and inventing one is
   * exactly the fabrication scripts/check-no-fabrication.mjs exists to prevent.
   * The thrown error carries the real Lob id so the caller can record the send
   * instead of repeating it.
   */
  private async guardedSend(
    orgId: number,
    actionKind: string,
    idempotencyKey: string,
    payload: unknown,
    perform: () => Promise<SendResult>,
  ): Promise<SendResult> {
    const { withOutwardAction } = await import('./actions/outwardAction');
    return withOutwardAction<SendResult>(
      { organizationId: orgId, actionKind, idempotencyKey, payload },
      async () => {
        const result = await perform();
        return { status: 'succeeded', externalId: result.id, result };
      },
      (externalId) => {
        throw new MailAlreadySentError(actionKind, idempotencyKey, externalId);
      },
    );
  }

  private async performSendLetter(options: LetterOptions, mode: MailMode = 'live', orgId?: number): Promise<SendResult> {
    await assertOwnerContactAllowed("mail", { addressLine1: options.to.addressLine1, zip: options.to.zip });
    const prepared = await this.prepareLane(
      orgId,
      // The page count is CONFIRMED from the content (a caller's pageCount is
      // a claim, not a confirmation — founder decision 2026-10-18).
      letterSpec({ color: options.color ?? false, file: options.file }),
      options.from,
      options.housePrepaid === true,
    );
    options = { ...options, from: prepared.from };
    const org = orgId ? await storage.getOrganization(orgId).catch(() => null) : null;
    if (shouldSimulate("lob", org)) {
      const sim = await recordSimulatedAction(
        "lob",
        "send_letter",
        { to: options.to, from: options.from, pageCount: options.pageCount, mode },
        org as any
      );
      return {
        id: sim.id,
        expectedDeliveryDate: new Date(clock.nowMs() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        isTestMode: true,
        credentialSource: "platform",
      };
    }

    let lob: any;
    let credentialSource: 'organization' | 'platform' = 'platform';
    // See sendPostcard — honest test-environment tracking.
    let usedTestEnv: boolean;

    const orgClient = prepared.orgClient;
    if (orgClient) {
      lob = orgClient.client;
      credentialSource = orgClient.source;
      usedTestEnv = orgClient.isTestKey;
    } else {
      const effective = this.effectiveMode(mode);
      // Outreach stop-loss gate — see sendPostcard for the full rationale.
      if (effective === 'live') {
        const { assertOutreachNotPaused } = await import('./outreachStopLoss');
        await assertOutreachNotPaused('directMail.sendLetter');
      }
      lob = this.getLobClient(effective);
      usedTestEnv = effective === 'test';
    }

    // Lob's test environment prints nothing: a house piece sent there is
    // never charged (the house lane already requires the armed interlock).
    const charge = usedTestEnv ? null : await this.chargeHouse(orgId!, prepared, options.idempotencyKey);
    let result: { id: string; expected_delivery_date: string };
    try {
    result = await lob.letters.create({
      to: {
        name: options.to.name,
        address_line1: options.to.addressLine1,
        address_line2: options.to.addressLine2,
        address_city: options.to.city,
        address_state: options.to.state,
        address_zip: options.to.zip,
      },
      from: {
        name: options.from.name,
        address_line1: options.from.addressLine1,
        address_line2: options.from.addressLine2,
        address_city: options.from.city,
        address_state: options.from.state,
        address_zip: options.from.zip,
      },
      // House: the counted PDF itself (decision 2026-10-18).
      file: prepared.lane.lane === 'house' ? houseLetterFile(prepared.lane) : options.file,
      color: options.color ?? false,
      double_sided: options.doubleSided ?? false,
    });
    } catch (err) {
      await refundUnbilledHouseMail(orgId!, charge, err, 'Letter was rejected by Lob');
      throw err;
    }
    
    const costCents = (options.pageCount || 1) <= 1 ? 150 : 150 + ((options.pageCount || 1) - 1) * 15;
    logLobApiUsage(orgId, 'send_letter', costCents, { pageCount: options.pageCount || 1, isTestMode: usedTestEnv });

    return {
      id: result.id,
      expectedDeliveryDate: result.expected_delivery_date,
      isTestMode: usedTestEnv,
      credentialSource,
    };
  }

  calculateCost(type: MailPieceType, quantity: number = 1): number {
    return DIRECT_MAIL_COSTS[type] * quantity;
  }
  
  estimateBatchCost(
    pieceType: 'postcard_4x6' | 'postcard_6x9' | 'postcard_6x11' | 'letter_1_page',
    recipientCount: number,
    mode: MailMode = 'live'
  ): MailEstimate {
    const perPiece = DIRECT_MAIL_COSTS[pieceType];
    return {
      perPieceCost: perPiece,
      totalCost: perPiece * recipientCount,
      recipientCount,
      pieceType,
      // Reflect what a send would ACTUALLY do — while the interlock is
      // disarmed a 'live' request still runs in Lob's test environment.
      isTestMode: this.effectiveMode(mode) === 'test',
    };
  }

  // (A Lob address verifier on AcreOS's env keys used to live here with no
  // caller; it was deleted 2026-10-18. Address checks run only through
  // directMailService.verifyAddress, which applies the founder's lanes.)

  // Get estimated delivery date (works with test keys too)
  getEstimatedDeliveryDays(): { min: number; max: number } {
    // Lob's standard mail typically takes 3-10 business days
    return { min: 3, max: 10 };
  }
}

export const directMailService = new DirectMailService();

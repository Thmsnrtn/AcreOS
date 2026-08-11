/**
 * Campaign-blast direct mail. R-2 (founder ruling 2026-08-11): this file used
 * to build its OWN Lob clients from process.env in a constructor — a third
 * parallel credential story, and the one that made a campaign blast for an org
 * with no connected printer account print on AcreOS's Lob key. Credentials now
 * come from the ONE door (`mail/mailLanes.assertMailLane`); nothing here reads
 * a Lob env key.
 */
import Lob from 'lob';
import { storage } from '../storage';
import { logger } from "../utils/logger";
import { shouldSimulate, recordSimulatedAction } from "../utils/simulationMode";
import { isLiveSendArmed } from './mail/liveSendInterlock';
import {
  assertMailLane,
  mailLaneStatus,
  resolvePlatformMailCredential,
  type MailCredential,
  type MailLaneStatus,
  type MailPurpose,
} from './mail/mailLanes';

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

// Cost structure (in cents) - our pricing to users
export const DIRECT_MAIL_COSTS = {
  postcard_4x6: 75,    // $0.75 - small postcard
  postcard_6x9: 95,    // $0.95 - standard postcard
  postcard_6x11: 115,  // $1.15 - large postcard
  letter_1_page: 125,  // $1.25 - single page letter
  letter_2_page: 145,  // $1.45 - 2 page letter
  letter_extra_page: 15, // $0.15 per additional page
} as const;

export type MailPieceType = keyof typeof DIRECT_MAIL_COSTS;
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
}

export interface LetterOptions {
  file: string; // HTML or PDF URL
  to: DirectMailRecipient;
  from: DirectMailRecipient;
  color?: boolean;
  doubleSided?: boolean;
  pageCount?: number;
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

/**
 * The slice of the Lob SDK address verification uses. The `lob` package's
 * bundled types omit usVerifications, so we declare exactly what we call
 * rather than widening the client to `any`.
 */
interface LobVerificationClient {
  usVerifications: {
    verify(params: {
      primary_line: string;
      secondary_line: string;
      city: string;
      state: string;
      zip_code: string;
    }): Promise<{
      deliverability: string;
      primary_line: string;
      secondary_line?: string;
      components: { city: string; state: string; zip_code: string };
    }>;
  };
}

export class DirectMailService {
  /**
   * Degrade 'live' to 'test' while the platform live-send interlock is
   * disarmed (mail/liveSendInterlock.ts). org.settings.mailMode = 'live' is
   * a per-org preference; the interlock is the platform-wide launch gate
   * and always wins. Only meaningful for PLATFORM-credential sends — an org
   * on its own Lob key chose its own environment by its own key prefix.
   */
  private effectiveMode(requested: MailMode): MailMode {
    if (requested === 'live' && !isLiveSendArmed()) {
      logger.warn('[DirectMail] live mode requested while live sending is disarmed — using Lob test environment');
      return 'test';
    }
    return requested;
  }

  /**
   * Org-scoped honest status for the direct-mail settings surfaces. Replaces
   * the old process-wide isAvailable()/hasLiveMode()/getAvailableModes()
   * reads, which answered "does the PLATFORM hold a key" for a question that
   * is always about one specific org.
   */
  async laneStatus(orgId: number): Promise<MailLaneStatus> {
    return mailLaneStatus(orgId);
  }

  /** Does this org have its OWN connected Lob credential? */
  async hasOrgLobCredentials(orgId: number): Promise<boolean> {
    const status = await mailLaneStatus(orgId);
    return status.connected;
  }

  /**
   * Resolve the credential for a whole batch, ONCE, through the lane. Throws
   * MailLaneRefusal when this org may not send on this lane — the caller
   * renders the connect affordance from `err.details`.
   */
  async assertBatchLane(
    orgId: number,
    pieceCount: number,
    purpose: MailPurpose = 'counterparty',
  ): Promise<MailCredential> {
    return assertMailLane({ organizationId: orgId, purpose, pieceCount });
  }

  async sendPostcard(
    options: PostcardOptions,
    mode: MailMode = 'live',
    orgId?: number,
    lane?: { credential?: MailCredential; purpose?: MailPurpose },
  ): Promise<SendResult> {
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
        expectedDeliveryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        isTestMode: true,
        credentialSource: "platform",
      };
    }

    const credential = await this.resolveSendCredential(orgId, mode, lane, 'directMail.sendPostcard');
    const lob = new Lob({ apiKey: credential.apiKey });

    const result = await lob.postcards.create({
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
    
    const costCents = options.size === '4x6' ? 80 : options.size === '6x9' ? 95 : 115;
    logLobApiUsage(orgId, 'send_postcard', costCents, { size: options.size, isTestMode: credential.isTestKey });

    return {
      id: result.id,
      expectedDeliveryDate: result.expected_delivery_date,
      isTestMode: credential.isTestKey,
      credentialSource: credential.source,
    };
  }

  async sendLetter(
    options: LetterOptions,
    mode: MailMode = 'live',
    orgId?: number,
    lane?: { credential?: MailCredential; purpose?: MailPurpose },
  ): Promise<SendResult> {
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
        expectedDeliveryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        isTestMode: true,
        credentialSource: "platform",
      };
    }

    const credential = await this.resolveSendCredential(orgId, mode, lane, 'directMail.sendLetter');
    const lob = new Lob({ apiKey: credential.apiKey });

    const result = await lob.letters.create({
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
      file: options.file,
      color: options.color ?? false,
      double_sided: options.doubleSided ?? false,
    });
    
    const costCents = (options.pageCount || 1) <= 1 ? 150 : 150 + ((options.pageCount || 1) - 1) * 15;
    logLobApiUsage(orgId, 'send_letter', costCents, { pageCount: options.pageCount || 1, isTestMode: credential.isTestKey });

    return {
      id: result.id,
      expectedDeliveryDate: result.expected_delivery_date,
      isTestMode: credential.isTestKey,
      credentialSource: credential.source,
    };
  }

  /**
   * The ONE credential path for this service. `orgId` is not optional in
   * substance — assertMailLane refuses a send that cannot name its org — and
   * the platform-key branch still passes the outreach stop-loss gate, because
   * a platform-credential LIVE send spends the founder's mail budget.
   */
  private async resolveSendCredential(
    orgId: number | undefined,
    mode: MailMode,
    lane: { credential?: MailCredential; purpose?: MailPurpose } | undefined,
    site: string,
  ): Promise<MailCredential> {
    const credential =
      lane?.credential ??
      (await assertMailLane({
        organizationId: orgId,
        purpose: lane?.purpose ?? 'counterparty',
        pieceCount: 1,
      }));

    if (credential.source === 'platform') {
      // Outreach stop-loss gate (founder rulings #4/#5, 2026-07-28): a
      // platform-credential LIVE send spends the founder's mail budget, so
      // it's checked against the monthly mail+data line. Throws
      // OutreachPausedError when paused — nothing sends, nothing is
      // fabricated; the caller's queue item stays put. BYO-key and test-env
      // sends spend nothing and are not gated.
      // GATED ON THE KEY IN HAND, not on a requested mode.
      //
      // This previously also required `effectiveMode(mode) === 'live'`, which
      // stopped describing reality once the credential resolver started
      // returning whatever `resolvePlatformLobKey()` yields — the LIVE key
      // whenever the interlock is armed, regardless of the mode asked for. So
      // `mode: 'test'` skipped the stop-loss AND still got a live key: real
      // letters printed, postage billed to AcreOS, and the monthly mail budget
      // never consulted. A live platform key is a live platform key.
      if (!credential.isTestKey) {
        const { assertOutreachNotPaused } = await import('./outreachStopLoss');
        await assertOutreachNotPaused(site);
      }

      // REFUSE rather than silently upgrade a test send to a live one. The
      // caller asked for test mode; handing back a live platform key would
      // print real mail under a UI that says nothing is being sent. Refusing is
      // the only honest answer — the platform test key is the test lane, and if
      // it is unavailable there is no test lane to use.
      if (this.effectiveMode(mode) === 'test' && !credential.isTestKey) {
        throw new Error(
          'Test-mode mail was requested but only a LIVE platform credential is available. ' +
            'Nothing was sent. Configure the platform test credential, or send in live mode deliberately.',
        );
      }
    }
    return credential;
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
      // Reflect what a PLATFORM-credential send would ACTUALLY do — while the
      // interlock is disarmed a 'live' request still runs in Lob's test
      // environment. An org on its own key sets its own environment.
      isTestMode: this.effectiveMode(mode) === 'test',
    };
  }

  // Validate an address using Lob's address verification
  async verifyAddress(address: DirectMailRecipient, mode: MailMode = 'test'): Promise<{
    isValid: boolean;
    deliverability: string;
    normalizedAddress?: DirectMailRecipient;
  }> {
    // Address verification is a LOOKUP on AcreOS's own Lob account, not a
    // send — no paper, no counterparty, so it stays on the platform key under
    // the interlock (which pins it to Lob's test environment while disarmed).
    const platform = resolvePlatformMailCredential();
    if (!platform) {
      return { isValid: false, deliverability: 'error' };
    }
    const lob = new Lob({ apiKey: platform.apiKey }) as unknown as LobVerificationClient;
    
    try {
      const result = await lob.usVerifications.verify({
        primary_line: address.addressLine1,
        secondary_line: address.addressLine2 || '',
        city: address.city,
        state: address.state,
        zip_code: address.zip,
      });
      
      return {
        isValid: result.deliverability === 'deliverable',
        deliverability: result.deliverability,
        normalizedAddress: result.deliverability === 'deliverable' ? {
          name: address.name,
          addressLine1: result.primary_line,
          addressLine2: result.secondary_line || undefined,
          city: result.components.city,
          state: result.components.state,
          zip: result.components.zip_code,
        } : undefined,
      };
    } catch (error) {
      return {
        isValid: false,
        deliverability: 'error',
      };
    }
  }

  // Get estimated delivery date (works with test keys too)
  getEstimatedDeliveryDays(): { min: number; max: number } {
    // Lob's standard mail typically takes 3-10 business days
    return { min: 3, max: 10 };
  }
}

export const directMailService = new DirectMailService();

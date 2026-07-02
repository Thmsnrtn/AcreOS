import Lob from 'lob';
import { storage } from '../storage';
import { decryptJsonCredentials } from './fieldEncryption';
import { logger } from "../utils/logger";
import { shouldSimulate, recordSimulatedAction } from "../utils/simulationMode";
import { isLiveSendArmed } from './mail/liveSendInterlock';

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

  async getOrgLobClient(orgId: number): Promise<{ client: any; source: 'organization' | 'platform'; isTestKey: boolean } | null> {
    try {
      const integration = await storage.getOrganizationIntegration(orgId, 'lob');
      
      if (integration && integration.isEnabled && integration.credentials?.encrypted) {
        const decrypted = decryptJsonCredentials<{ apiKey: string }>(
          integration.credentials.encrypted,
          orgId
        );
        
        if (decrypted.apiKey) {
          logger.info(`[DirectMail] Using organization Lob credentials for org ${orgId}`);
          return {
            client: new Lob({ apiKey: decrypted.apiKey }),
            source: 'organization',
            isTestKey: decrypted.apiKey.startsWith('test_'),
          };
        }
      }
    } catch (error) {
      logger.error(`[DirectMail] Failed to get org Lob credentials for org ${orgId}`, error);
    }
    
    return null;
  }

  async hasOrgLobCredentials(orgId: number): Promise<boolean> {
    try {
      const integration = await storage.getOrganizationIntegration(orgId, 'lob');
      if (integration && integration.isEnabled && integration.credentials?.encrypted) {
        const decrypted = decryptJsonCredentials<{ apiKey: string }>(
          integration.credentials.encrypted,
          orgId
        );
        return !!decrypted.apiKey;
      }
    } catch (error) {
      logger.error(`[DirectMail] Failed to check org Lob credentials for org ${orgId}`, error);
    }
    return false;
  }

  async sendPostcard(options: PostcardOptions, mode: MailMode = 'live', orgId?: number): Promise<SendResult> {
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

    let lob: any;
    let credentialSource: 'organization' | 'platform' = 'platform';
    // Whether the send actually ran in Lob's test environment (no physical
    // mail) — org keys by prefix, platform keys by interlock-degraded mode.
    let usedTestEnv: boolean;

    const orgClient = orgId ? await this.getOrgLobClient(orgId) : null;
    if (orgClient) {
      lob = orgClient.client;
      credentialSource = orgClient.source;
      usedTestEnv = orgClient.isTestKey;
    } else {
      const effective = this.effectiveMode(mode);
      lob = this.getLobClient(effective);
      usedTestEnv = effective === 'test';
    }

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
    logLobApiUsage(orgId, 'send_postcard', costCents, { size: options.size, isTestMode: usedTestEnv });

    return {
      id: result.id,
      expectedDeliveryDate: result.expected_delivery_date,
      isTestMode: usedTestEnv,
      credentialSource,
    };
  }

  async sendLetter(options: LetterOptions, mode: MailMode = 'live', orgId?: number): Promise<SendResult> {
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

    let lob: any;
    let credentialSource: 'organization' | 'platform' = 'platform';
    // See sendPostcard — honest test-environment tracking.
    let usedTestEnv: boolean;

    const orgClient = orgId ? await this.getOrgLobClient(orgId) : null;
    if (orgClient) {
      lob = orgClient.client;
      credentialSource = orgClient.source;
      usedTestEnv = orgClient.isTestKey;
    } else {
      const effective = this.effectiveMode(mode);
      lob = this.getLobClient(effective);
      usedTestEnv = effective === 'test';
    }

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

  // Validate an address using Lob's address verification
  async verifyAddress(address: DirectMailRecipient, mode: MailMode = 'test'): Promise<{
    isValid: boolean;
    deliverability: string;
    normalizedAddress?: DirectMailRecipient;
  }> {
    // Use test mode by default for verification to save costs. The
    // interlock also applies: without a test key and while disarmed this
    // throws rather than silently using the live key.
    const lob = this.getLobClient(this.hasTestKey ? 'test' : this.effectiveMode(mode));
    
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

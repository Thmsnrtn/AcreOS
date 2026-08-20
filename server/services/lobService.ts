import Lob from 'lob';
import { logger } from "../utils/logger";
import { isLiveSendArmed } from "./mail/liveSendInterlock";
import { getLobClient } from "./directMailService";

/**
 * BYO send rails for PHYSICAL mail (founder decision 2026-07-17, extended to
 * Lob 2026-08-20).
 *
 * THE DEFECT THIS CLOSES. This class resolved its Lob client from
 * LOB_TEST_API_KEY / LOB_LIVE_API_KEY / LOB_API_KEY in its CONSTRUCTOR and
 * nowhere else — it never had an orgId and so could never consult the org's
 * own credentials. Its one production caller,
 * `CommunicationsService.sendDirectMail`, prints letters addressed to LEADS:
 * counterparty mail by any reading. So a customer whose Lob key sits in the
 * BYOK vault had their seller letters printed on ACREOS's Lob account, paid
 * for by AcreOS, carrying AcreOS's account identity — the very defect the
 * 2026-08-16 consolidation fixed in `mailProvider.ts` and left standing here.
 *
 * The fix is NOT a fourth copy of the resolution order. `directMailService.
 * getLobClient` is the single authority (BYOK vault → legacy
 * organization_integrations row → platform key under the live-send interlock);
 * this class now obtains its client THROUGH it whenever an organizationId is
 * in hand. The env-key clients below survive only for the org-less
 * PLATFORM/system path and for `isConfigured()`.
 *
 * NOTE the platform fallback inside the authority is deliberately kept — the
 * founder explicitly deferred the "kill the platform fallback for Lob"
 * question (see tests/unit/lobCredentialAuthority.test.ts). What is closed
 * here is that an org's OWN key is now consulted first on this path too.
 */
export type MailLane = 'system' | 'counterparty';

export type LobErrorType = 
  | 'address_invalid'
  | 'address_undeliverable'
  | 'insufficient_funds'
  | 'rate_limited'
  | 'unauthorized'
  | 'not_found'
  | 'validation_error'
  | 'server_error'
  | 'network_error'
  | 'unknown';

export interface LobAddress {
  name: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  zip: string;
}

/**
 * Lane + tenant context for a physical send. Mirrors `EmailOptions.purpose`
 * in emailService: "counterparty" is mail to the customer's sellers/buyers/
 * borrowers and MUST resolve the customer's own Lob account first.
 */
export interface LobSendContext {
  /** Whose account pays. Required for the counterparty lane. */
  organizationId?: number;
  purpose?: MailLane;
}

export interface LobLetterOptions {
  to: LobAddress;
  from: LobAddress;
  file: string;
  color?: boolean;
  doubleSided?: boolean;
  description?: string;
}

export interface LobPostcardOptions {
  to: LobAddress;
  from: LobAddress;
  front: string;
  back: string;
  size?: '4x6' | '6x9' | '6x11';
  description?: string;
}

export interface LobSendResult {
  success: boolean;
  lobMailingId?: string;
  expectedDeliveryDate?: string;
  trackingUrl?: string;
  carrier?: string;
  isTestMode: boolean;
  error?: string;
  errorType?: LobErrorType;
  rawError?: any;
}

function classifyLobError(error: any): { type: LobErrorType; message: string } {
  const errorMessage = error?.message || error?.error?.message || String(error);
  const statusCode = error?.statusCode || error?.status;
  
  if (statusCode === 401 || errorMessage.includes('unauthorized') || errorMessage.includes('Invalid API Key')) {
    return { type: 'unauthorized', message: 'Invalid Lob API key' };
  }
  
  if (statusCode === 403 || errorMessage.includes('insufficient_funds') || errorMessage.includes('insufficient funds')) {
    return { type: 'insufficient_funds', message: 'Insufficient funds in Lob account' };
  }
  
  if (statusCode === 429 || errorMessage.includes('rate') || errorMessage.includes('too many requests')) {
    return { type: 'rate_limited', message: 'Lob API rate limit exceeded' };
  }
  
  if (statusCode === 404 || errorMessage.includes('not found')) {
    return { type: 'not_found', message: 'Resource not found' };
  }
  
  if (errorMessage.includes('address') && (errorMessage.includes('invalid') || errorMessage.includes('undeliverable'))) {
    return { type: 'address_invalid', message: 'Invalid or undeliverable address' };
  }
  
  if (errorMessage.includes('undeliverable')) {
    return { type: 'address_undeliverable', message: 'Address is undeliverable' };
  }
  
  if (statusCode === 422 || errorMessage.includes('validation')) {
    return { type: 'validation_error', message: errorMessage };
  }
  
  if (statusCode >= 500) {
    return { type: 'server_error', message: 'Lob server error - please retry' };
  }
  
  if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ETIMEDOUT') || errorMessage.includes('network')) {
    return { type: 'network_error', message: 'Network error connecting to Lob' };
  }
  
  return { type: 'unknown', message: errorMessage };
}

export class LobService {
  private testLob: InstanceType<typeof Lob> | null = null;
  private liveLob: InstanceType<typeof Lob> | null = null;
  
  constructor() {
    const testKey = process.env.LOB_TEST_API_KEY;
    const liveKey = process.env.LOB_LIVE_API_KEY;
    const genericKey = process.env.LOB_API_KEY;
    
    if (testKey) {
      this.testLob = new Lob({ apiKey: testKey });
    } else if (genericKey?.startsWith('test_')) {
      this.testLob = new Lob({ apiKey: genericKey });
    }
    
    if (liveKey) {
      this.liveLob = new Lob({ apiKey: liveKey });
    } else if (genericKey && !genericKey.startsWith('test_')) {
      this.liveLob = new Lob({ apiKey: genericKey });
    }
  }
  
  /**
   * Platform-key availability. PLATFORM SCOPE ONLY — it cannot see an org's
   * own Lob credential, so callers holding an organizationId must use
   * `isConfiguredForOrg` instead. Using this as the precheck for a
   * counterparty send would refuse a BYOK org that is perfectly well
   * configured on its OWN account.
   */
  isConfigured(): boolean {
    return this.testLob !== null || this.liveLob !== null;
  }

  /**
   * Tenant-aware availability: true when ANY tier of the single credential
   * authority resolves for this org (BYOK vault → legacy row → platform key).
   */
  async isConfiguredForOrg(organizationId: number): Promise<boolean> {
    try {
      await getLobClient(organizationId);
      return true;
    } catch {
      return this.isConfigured();
    }
  }
  
  hasTestMode(): boolean {
    return this.testLob !== null;
  }
  
  hasLiveMode(): boolean {
    return this.liveLob !== null;
  }
  
  /**
   * Resolve the client for one send.
   *
   * With an organizationId we delegate to the single credential authority so
   * a BYOK-vault org's mail prints on the org's OWN account. Without one, a
   * COUNTERPARTY send refuses: we cannot tell whose account should pay, and
   * silently choosing AcreOS's is precisely the re-fronting the ruling bans.
   * Org-less SYSTEM mail keeps the env-key path unchanged.
   */
  private async resolveClient(
    mode: 'test' | 'live',
    ctx: LobSendContext | undefined,
  ): Promise<{ client: InstanceType<typeof Lob>; isTestMode: boolean }> {
    // Contract check FIRST, in every mode. "Counterparty mail with no tenant"
    // is a call-site bug whether or not this particular send would have
    // printed, and a lane rule that only applies sometimes is not a rule.
    if (ctx?.purpose === 'counterparty' && !ctx.organizationId) {
      throw new Error(
        'Counterparty direct mail requires an organizationId — deal mail always belongs to a customer org, ' +
          'and without one there is no way to resolve whose Lob account pays (founder decision 2026-07-17).',
      );
    }

    // THE CUSTOMER'S OWN dry-run switch — not the platform interlock.
    //
    // This read `this.effectiveMode(mode) === 'test'`, which folded two
    // unrelated switches into one and let the PLATFORM interlock decide for a
    // customer's own account. `isLiveSendArmed()` is false by default, so on
    // any deployment that has not explicitly armed production, an org sending a
    // LIVE counterparty letter on THEIR OWN Lob key silently resolved to the
    // platform sandbox and printed nothing. The org branch below already says
    // "the platform live-send interlock governs the PLATFORM key only — never a
    // customer's own account", and this ordering was what made that sentence
    // unreachable: a correct rule stated in a comment that the control flow
    // above it defeated.
    //
    // Nothing is weakened by narrowing it. Every PLATFORM path is still
    // interlocked, in both places it can be reached: `getClient()` applies
    // `effectiveMode` itself, and the platform tier of `getLobClient` applies it
    // inside `resolvePlatformLobKey`. What is restored is the customer's own
    // dry-run switch meaning THEIRS — `mode === 'test'` still short-circuits to
    // the sandbox, which is the safe direction the original comment defends: an
    // org whose vault holds a live key must not have their own dry-run print
    // real mail to a real person.
    if (mode === 'test') {
      // A test-mode send prints NOTHING and reaches no counterparty, so whose
      // account pays is moot (it costs $0). Two reasons to keep the platform
      // sandbox key here rather than resolving the org's own:
      //   1. It preserves the pre-existing behaviour of an explicit test run.
      //   2. It is the SAFE direction. An org whose vault holds a LIVE key
      //      would otherwise have `org.settings.mailMode = 'test'` — the
      //      customer's own dry-run switch — silently print real mail to a
      //      real person. Resolving BYO here would trade a billing nicety for
      //      an irreversible one.
      return { client: this.getClient('test'), isTestMode: true };
    }

    if (ctx?.organizationId) {
      const { client, source, isTestKey } = await getLobClient(ctx.organizationId);
      if (source === 'organization') {
        // The org's own key. The platform live-send interlock governs the
        // PLATFORM key only — never a customer's own account — so the mode
        // here is whatever their key actually is.
        return { client, isTestMode: isTestKey };
      }
      // Platform tier of the authority: the interlock already decided test vs
      // live inside resolvePlatformLobKey, so report what it actually chose
      // rather than what the caller asked for.
      logger.info(
        `[LobService] No org Lob credential for org ${ctx.organizationId} — using the platform key (lobEnv: ${isTestKey ? 'test' : 'live'})`,
      );
      return { client, isTestMode: isTestKey };
    }

    // Org-less LIVE system mail (AcreOS's own physical mail): platform key.
    return { client: this.getClient('live'), isTestMode: false };
  }

  /**
   * Degrade a 'live' request to 'test' while the platform live-send interlock
   * is disarmed. Applies to the PLATFORM env keys only.
   */
  private effectiveMode(mode: 'test' | 'live'): 'test' | 'live' {
    if (mode === 'live' && !isLiveSendArmed()) {
      logger.warn('[LobService] live send requested while interlock DISARMED — degrading to test mode');
      return 'test';
    }
    return mode;
  }

  private getClient(mode: 'test' | 'live'): InstanceType<typeof Lob> {
    // Roadmap W1.7 (2026-07 audit): this was the ONE mail path that ignored
    // the live-send interlock — sendLetter defaults to 'live' and handed out
    // the live client unconditionally, contradicting the platform guarantee
    // that no code path can arm itself. The interlock still gates every
    // platform-key send; it now lives in `effectiveMode` so BOTH the org-less
    // path and any future caller of getClient go through it, and so a
    // customer's OWN key (resolved in resolveClient) is never degraded by a
    // platform-scoped switch it has nothing to do with.
    mode = this.effectiveMode(mode);
    if (mode === 'test') {
      if (!this.testLob) {
        throw new Error('Lob test mode not configured - LOB_TEST_API_KEY required (live sends stay locked until the interlock arms)');
      }
      return this.testLob;
    }

    if (!this.liveLob) {
      throw new Error('Lob live mode not configured - LOB_LIVE_API_KEY required');
    }
    return this.liveLob;
  }
  
  async sendLetter(
    options: LobLetterOptions,
    mode: 'test' | 'live' = 'live',
    ctx?: LobSendContext,
  ): Promise<LobSendResult> {
    let isTestMode = mode === 'test';
    try {
      const resolved = await this.resolveClient(mode, ctx);
      const client = resolved.client;
      isTestMode = resolved.isTestMode;

      logger.info(`[LobService] Sending letter (${isTestMode ? 'test' : 'live'} env) to ${options.to.name}`);
      
      const result = await client.letters.create({
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
      
      logger.info(`[LobService] Letter sent successfully: ${result.id}, expected delivery: ${result.expected_delivery_date}`);
      
      return {
        success: true,
        lobMailingId: result.id,
        expectedDeliveryDate: result.expected_delivery_date,
        isTestMode,
      };
    } catch (error: any) {
      const classified = classifyLobError(error);
      
      logger.error(`[LobService] Letter send failed`, undefined, { metadata: { detail: {
        errorType: classified.type,
        message: classified.message,
        recipient: options.to.name,
        mode,
      } } });
      
      return {
        success: false,
        isTestMode,
        error: classified.message,
        errorType: classified.type,
        rawError: error,
      };
    }
  }
  
  async sendPostcard(
    options: LobPostcardOptions,
    mode: 'test' | 'live' = 'live',
    ctx?: LobSendContext,
  ): Promise<LobSendResult> {
    let isTestMode = mode === 'test';
    try {
      const resolved = await this.resolveClient(mode, ctx);
      const client = resolved.client;
      isTestMode = resolved.isTestMode;

      logger.info(`[LobService] Sending postcard (${isTestMode ? 'test' : 'live'} env) to ${options.to.name}`);
      
      const result = await client.postcards.create({
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
        size: options.size || '4x6',
      });
      
      logger.info(`[LobService] Postcard sent successfully: ${result.id}, expected delivery: ${result.expected_delivery_date}`);
      
      return {
        success: true,
        lobMailingId: result.id,
        expectedDeliveryDate: result.expected_delivery_date,
        isTestMode,
      };
    } catch (error: any) {
      const classified = classifyLobError(error);
      
      logger.error(`[LobService] Postcard send failed`, undefined, { metadata: { detail: {
        errorType: classified.type,
        message: classified.message,
        recipient: options.to.name,
        mode,
      } } });
      
      return {
        success: false,
        isTestMode,
        error: classified.message,
        errorType: classified.type,
        rawError: error,
      };
    }
  }
  
  isRetryableError(errorType: LobErrorType): boolean {
    return ['rate_limited', 'server_error', 'network_error'].includes(errorType);
  }
}

export const lobService = new LobService();

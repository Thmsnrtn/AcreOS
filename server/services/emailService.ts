import { SESClient, SendEmailCommand, SendRawEmailCommand, GetSendQuotaCommand } from '@aws-sdk/client-ses';
import { storage } from '../storage';
import { readIntegrationCredentials } from './integrationCredentials';
import { emailCircuitBreaker } from '../utils/circuitBreaker';
import { logger } from "../utils/logger";
import { filterSuppressed } from "./emailSuppressions";
import { issueToken, buildUnsubscribeUrl } from "./unsubscribeTokens";
import { reserveSend } from "./emailWarmup";

import { getIdentityForSend } from "./orgEmailIdentity";
import { raiseAlert } from "./alertSpine";
// Type-only: erased at runtime, so the resolver module is NOT loaded at import
// time. The value is pulled in dynamically inside the undeclared-lane guard so
// only the undeclared path pays for it. See that block for why this file — core
// mail — reaches into an autopilot-owned module rather than owning a second
// copy of the rule.
import type { CounterpartyHit } from "./autopilot/hands/counterpartyMatch";

/**
 * Eleonora deliverability — Phase 1 §10 / Week 7-8.
 *
 * Every outbound message now ships with a List-Unsubscribe header that
 * points to BOTH a mailto fallback and a tokenized one-click URL handler
 * (RFC 8058). The token is per-recipient + per-org and resolves through
 * `unsubscribe_tokens`. We use SendRawEmailCommand instead of SendEmail
 * because the v1 SES API doesn't expose arbitrary headers via SendEmail.
 *
 * Per-org IP warmup is enforced through reserveSend(orgId): if the org's
 * daily cap is reached the send is rejected with errorType="quota_exceeded".
 *
 * Per-org DKIM/SPF/DMARC identity (orgEmailIdentity) overrides the default
 * platform from-address when a verified identity exists for the org.
 */
const UNSUBSCRIBE_MAILTO = process.env.UNSUBSCRIBE_MAILTO || 'unsubscribe@acreos.io';

// CAN-SPAM §5(a)(5) requires a valid physical postal address in every
// commercial email. We read CAN_SPAM_MAILING_ADDRESS at module load. If it is
// unset we NEVER ship a literal placeholder to a recipient — instead the
// footer falls back to the sending org's own mailing address (taxAddress) when
// available, and otherwise omits the address line entirely. A single
// structured WARN is emitted once at startup so the founder knows the platform
// default is unset.
// Tom action item: set CAN_SPAM_MAILING_ADDRESS via `fly secrets set`.
const CAN_SPAM_MAILING_ADDRESS = process.env.CAN_SPAM_MAILING_ADDRESS?.trim() || null;

if (!CAN_SPAM_MAILING_ADDRESS) {
  logger.warn(
    '[EmailService] CAN_SPAM_MAILING_ADDRESS unset — campaign footers will use the sending org address as fallback, or omit the address line if none is on file. Set the Fly secret to ship a platform-wide postal address.',
    { source: 'email-config', metadata: { __pii_safe: true } },
  );
}

/**
 * Format an organization's stored tax/mailing address into a single CAN-SPAM
 * compliant address line, e.g. "123 Main St, Suite 4, Austin, TX 78701".
 * Returns null when there isn't enough on file to form a meaningful line.
 */
export function formatOrgMailingAddress(
  addr: { line1?: string; line2?: string; city?: string; state?: string; zip?: string; country?: string } | null | undefined,
): string | null {
  if (!addr) return null;
  const street = [addr.line1?.trim(), addr.line2?.trim()].filter(Boolean).join(', ');
  const cityStateZip = [
    [addr.city?.trim(), addr.state?.trim()].filter(Boolean).join(', '),
    addr.zip?.trim(),
  ]
    .filter(Boolean)
    .join(' ');
  const line = [street, cityStateZip, addr.country?.trim()].filter(Boolean).join(', ');
  return line.length > 0 ? line : null;
}

/**
 * Address equality for the counterparty From: chokepoint. Case- and
 * whitespace-insensitive, because "No-Reply@AcreOS.io " and
 * "no-reply@acreos.io" are the same mailbox and a check that missed one of
 * them would be decoration.
 */
function isSameEmailAddress(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * The send lane. See EmailOptions.purpose for the full contract.
 *
 * File-local on purpose: it was `export`ed with no consumer outside this
 * module, which is a public promise nobody asked for — the shape the
 * reachability ratchet exists to count.
 */
type SendLane = 'system' | 'counterparty';

/**
 * Resolve the CAN-SPAM postal address + brand to render in a footer, FOR A
 * GIVEN LANE (founder decision 2026-07-17 — "no re-fronting platform send
 * rails"; lane-awareness added 2026-08-20).
 *
 * THE DEFECT THIS CLOSES. This function used to take only an orgId, and its
 * first line returned the platform secret unconditionally:
 *
 *     if (CAN_SPAM_MAILING_ADDRESS) return { address: …, brandName: 'AcreOS' };
 *
 * That short-circuited BEFORE the org was ever looked at, so whenever the
 * platform secret is set — i.e. in production — EVERY footer carried ACREOS's
 * postal address under the literal brand 'AcreOS', including a customer's
 * counterparty campaign to a landowner. Two things wrong at once: it re-fronts
 * the platform identity onto the customer's deal mail, and it violates
 * CAN-SPAM §5(a)(5), which requires the SENDER's physical address — the sender
 * of counterparty mail is the CUSTOMER, not AcreOS. Naming the wrong entity is
 * not a cosmetic slip; it is an untrue statement about who sent the message.
 *
 * Lane contract:
 *   counterparty — the sending ORG's own address under the org's own name, or
 *     null. The platform secret and the literal 'AcreOS' are UNREACHABLE on
 *     this lane. Nothing on file ⇒ the caller omits the line entirely; this
 *     file's rule is "never a placeholder", and a substitute address is worse
 *     than an omitted one.
 *   system — AcreOS talking to its own users. Platform secret first, then the
 *     org's own address branded with the org's own name (2026-07 audit), then
 *     null.
 *
 * DELIBERATELY NOT EXPORTED. The rule is pinned through the surface that
 * actually renders it — tests/unit/sendRailBrandLane.test.ts drives the real
 * `sendEmail` and reads the real MIME message handed to SES. Exporting this
 * for a unit test would add a public promise nobody calls (the reachability
 * ratchet counts exactly that) AND would let the gate drift into testing a
 * projection the product does not consume, which is the failure mode
 * `publicMaturityOf()` demonstrated in this codebase.
 */
async function resolveCanSpamAddress(
  orgId: number | undefined,
  lane: SendLane,
): Promise<{ address: string; brandName: string | null } | null> {
  // The platform postal address belongs on AcreOS's OWN mail and nowhere else.
  if (lane !== 'counterparty' && CAN_SPAM_MAILING_ADDRESS) {
    return { address: CAN_SPAM_MAILING_ADDRESS, brandName: 'AcreOS' };
  }
  if (!orgId) return null;
  try {
    const org = await storage.getOrganization(orgId);
    const address = formatOrgMailingAddress(org?.taxAddress);
    if (!address) return null;
    const orgName = org?.name?.trim() || null;
    if (lane === 'counterparty') {
      // Brand STRICTLY the sending org. No 'AcreOS' default here: signing a
      // customer's letter to their own seller with OUR name is exactly the
      // re-fronting the 2026-07-17 ruling bans. An org with no name on file
      // renders the address alone.
      return { address, brandName: orgName };
    }
    // 2026-07 audit: when the address comes from the SENDING ORG's own
    // records, the footer must be branded with THAT org's name — the old
    // "AcreOS · {customer address}" form printed a customer's address as if
    // it were AcreOS's postal address (misleading and, for platform
    // lifecycle mail to that very customer, their own address labeled as
    // ours).
    return { address, brandName: orgName || 'AcreOS' };
  } catch (error) {
    logger.error('[EmailService] Failed to resolve org mailing address for CAN-SPAM footer', error, {
      source: 'email-config',
      metadata: { orgId },
    });
    return null;
  }
}

interface AWSCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  fromEmail: string;
  fromName?: string;
  source: 'organization' | 'platform';
}

export type EmailErrorType = 
  | 'sender_not_verified'
  | 'recipient_rejected'
  | 'rate_limit'
  | 'quota_exceeded'
  | 'configuration_error'
  | 'network_error'
  | 'unknown';

interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
};

const RETRYABLE_ERRORS = new Set([
  'Throttling',
  'ServiceUnavailable',
  'InternalFailure',
  'RequestTimeout',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
]);

function isRetryableError(error: any): boolean {
  if (!error) return false;
  const errorName = error.name || error.code || '';
  return RETRYABLE_ERRORS.has(errorName) || 
         errorName.includes('Throttl') || 
         errorName.includes('ServiceUnavailable') ||
         error.message?.includes('rate') ||
         error.message?.includes('throttl');
}

function categorizeError(error: any): EmailErrorType {
  const errorName = error.name || error.code || '';
  const errorMessage = (error.message || '').toLowerCase();
  
  if (errorName === 'MessageRejected' || errorMessage.includes('rejected')) {
    if (errorMessage.includes('not verified')) return 'sender_not_verified';
    return 'recipient_rejected';
  }
  if (errorName === 'MailFromDomainNotVerifiedException' || errorMessage.includes('not verified')) {
    return 'sender_not_verified';
  }
  if (errorName === 'Throttling' || errorMessage.includes('rate') || errorMessage.includes('throttl')) {
    return 'rate_limit';
  }
  if (errorName === 'LimitExceededException' || errorMessage.includes('quota') || errorMessage.includes('limit exceeded')) {
    return 'quota_exceeded';
  }
  if (
    errorName === 'ConfigurationSetDoesNotExistException' ||
    errorMessage.includes('configuration') ||
    errorMessage.includes('not configured') ||
    errorMessage.includes('credentials not')
  ) {
    return 'configuration_error';
  }
  if (errorName.includes('ECONNRESET') || errorName.includes('ETIMEDOUT') || errorName.includes('ENOTFOUND')) {
    return 'network_error';
  }
  return 'unknown';
}

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function calculateBackoff(attempt: number, config: RetryConfig): number {
  const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * 0.3 * exponentialDelay;
  return Math.min(exponentialDelay + jitter, config.maxDelayMs);
}

function getPlatformCredentials(): AWSCredentials {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const region = process.env.AWS_SES_REGION || process.env.AWS_REGION || 'us-east-1';
  const fromEmail = process.env.AWS_SES_FROM_EMAIL;

  if (!accessKeyId || !secretAccessKey) {
    throw new Error('AWS credentials not configured (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)');
  }

  if (!fromEmail) {
    throw new Error('AWS SES from email not configured (AWS_SES_FROM_EMAIL)');
  }

  return {
    accessKeyId,
    secretAccessKey,
    region,
    fromEmail,
    // PLATFORM LANE ONLY. This display name is AcreOS's own, and the
    // counterparty branch in performSend never reads it — see the
    // `fromNameFinal` assignment there.
    fromName: process.env.AWS_SES_FROM_NAME || 'AcreOS',
    source: 'platform',
  };
}

async function getOrgCredentials(orgId: number, lane: SendLane = 'system'): Promise<AWSCredentials | null> {
  try {
    const integration = await storage.getOrganizationIntegration(orgId, 'aws_ses');
    
    if (!integration || !integration.isEnabled) {
      return null;
    }

    const decrypted = readIntegrationCredentials<{
      accessKeyId?: string;
      secretAccessKey?: string;
      region?: string;
      fromEmail?: string;
      fromName?: string;
    }>(integration, orgId, 'aws_ses');
    if (!decrypted) {
      return null;
    }
    
    if (!decrypted.accessKeyId || !decrypted.secretAccessKey) {
      return null;
    }
    
    const domains = await storage.getVerifiedEmailDomains(orgId);
    const defaultDomain = domains.find(d => d.isDefault && d.status === 'verified') || 
                          domains.find(d => d.status === 'verified');
    
    let fromEmail = decrypted.fromEmail || defaultDomain?.fromEmail;
    let fromName = decrypted.fromName || defaultDomain?.fromName;
    
    if (!fromEmail) {
      // The platform from-address is a SYSTEM-lane convenience. Lending it to
      // a counterparty send would put @acreos.io on the customer's deal mail
      // while the customer's own AWS keys paid for the send — re-fronting by
      // another route (founder decision 2026-07-17). Returning null here makes
      // the counterparty guard fall through to the org's verified sending
      // domain, and refuse honestly if there isn't one.
      if (lane === 'counterparty') {
        logger.warn(
          '[EmailService] Org SES credentials carry no verified sender — refusing the platform from-address on the counterparty lane',
          { metadata: { organizationId: orgId, __pii_safe: true } },
        );
        return null;
      }
      try {
        const platformCreds = getPlatformCredentials();
        fromEmail = platformCreds.fromEmail;
        logger.info('[EmailService] Using platform from-email for org-specific AWS credentials');
      } catch {
        logger.warn('[EmailService] Org credentials have no verified sender and platform fallback unavailable');
        return null;
      }
    }
    
    return {
      accessKeyId: decrypted.accessKeyId,
      secretAccessKey: decrypted.secretAccessKey,
      region: decrypted.region || 'us-east-1',
      fromEmail,
      fromName: fromName || undefined,
      source: 'organization',
    };
  } catch (error) {
    logger.error('[EmailService] Failed to get org credentials', error);
    return null;
  }
}

/**
 * Resolve sending credentials: the org's OWN AWS SES keys when they carry a
 * verified sender, else the platform keys.
 *
 * NO LANE PARAMETER, DELIBERATELY (2026-08-20 audit). This function and
 * `getSESClient` used to take a `SendLane` and thread it down into
 * `getOrgCredentials`. That threading was INERT: deleting the argument at the
 * only non-default call site left every gate in this area green. It cannot be
 * otherwise — the counterparty guard in `performSend` already calls
 * `getOrgCredentials(orgId, 'counterparty')` ITSELF (that call IS load-bearing;
 * flip it to 'system' and sendRailBrandLane's "BYO SES credentials with no
 * verified sender" case goes red), and the single credential shape the lane
 * changed here — org keys with no verified sender — is unreachable past that
 * guard: either the send is refused, or an org identity exists and overrides
 * the From: address regardless of which keys were resolved.
 *
 * A parameter no test can detect reads to the next author as a guarantee while
 * guaranteeing nothing, so it is gone. The lane rule is enforced only where it
 * is OBSERVABLE on the wire: the counterparty guard above, and the counterparty
 * From: chokepoint in the send loop below. Both are pinned behaviourally in
 * tests/unit/sendRailBrandLane.test.ts.
 */
async function getCredentials(orgId?: number): Promise<AWSCredentials> {
  if (orgId) {
    const orgCreds = await getOrgCredentials(orgId, 'system');
    if (orgCreds) {
      return orgCreds;
    }
  }
  return getPlatformCredentials();
}

function createSESClient(creds: AWSCredentials): SESClient {
  return new SESClient({
    region: creds.region,
    credentials: {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
    },
  });
}

export async function getSESClient(orgId?: number) {
  const creds = await getCredentials(orgId);
  return {
    client: createSESClient(creds),
    fromEmail: creds.fromEmail,
    fromName: creds.fromName,
    source: creds.source,
    region: creds.region,
  };
}
export interface EmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  fromName?: string;
  replyTo?: string;
  organizationId?: number;
  tags?: Record<string, string>;
  retryConfig?: Partial<RetryConfig>;
  /** CAN-SPAM / GDPR compliance: URL for one-click unsubscribe link in campaign emails */
  unsubscribeUrl?: string;
  /** Whether this is a marketing/campaign email (appends unsubscribe footer if true) */
  isCampaignEmail?: boolean;
  transactional?: boolean; // CAN-SPAM §5 safe-default: footer on EVERY send UNLESS true. See shouldRenderCanSpamFooter().
  /**
   * Which lane this send belongs to (founder decision, 2026-07-17):
   *  - "counterparty" — deal mail to the customer's sellers/buyers/borrowers.
   *    REQUIRES the org's own identity (BYO SES creds or verified sending
   *    domain); refused honestly otherwise — never falls back to @acreos.io.
   *  - "system" (default) — AcreOS talking to its own users (trial, win-back,
   *    digests, receipt/dunning fallbacks). May use the platform identity.
   * Every NEW lead/buyer/borrower-facing call site MUST set "counterparty".
   */
  purpose?: 'system' | 'counterparty';
  /**
   * Stable key for THIS logical email, derived from durable domain identity
   * (a dunning-attempt id, a lifecycle-step id, a note-payment notice id) —
   * never a random value, which would defeat the mechanism on the retry it
   * exists to protect.
   *
   * When supplied ALONGSIDE `organizationId`, the send runs through the
   * outward-action boundary (server/services/actions/outwardAction.ts) and
   * happens at most once per key: a job that dies after SES accepted the
   * message cannot send it again. Requires `organizationId` because the claim
   * is tenant-scoped — a platform-scoped system mail has no org to scope to and
   * is left unprotected rather than silently claimed under a shared key.
   *
   * Optional so every existing call site keeps working unchanged. The count of
   * send sites that DON'T pass one is ratcheted down by
   * tests/unit/outwardActionCoverage.test.ts.
   */
  idempotencyKey?: string;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
  errorType?: EmailErrorType;
  attempts?: number;
  retryable?: boolean;
}

export interface EmailLogEntry {
  timestamp: Date;
  to: string;
  subject: string;
  status: 'sent' | 'failed';
  messageId?: string;
  error?: string;
  errorType?: EmailErrorType;
  attempts: number;
  organizationId?: number;
  durationMs: number;
}

/**
 * Build a multipart/alternative RFC 5322 message with the deliverability
 * headers Eleonora §10 mandates. Specifically:
 *   - List-Unsubscribe with both mailto: and https URL (RFC 2369)
 *   - List-Unsubscribe-Post: List-Unsubscribe=One-Click (RFC 8058)
 * The output is fed to SendRawEmailCommand so SES preserves the headers.
 */
export function buildRawMimeMessage(opts: {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  listUnsubscribeMailto: string;
  listUnsubscribeUrl: string;
}): string {
  const boundary = `=_acreos_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const headers = [
    `From: ${opts.from}`,
    `To: ${opts.to.join(", ")}`,
    `Subject: ${encodeMimeHeader(opts.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    `List-Unsubscribe: <mailto:${opts.listUnsubscribeMailto}>, <${opts.listUnsubscribeUrl}>`,
    "List-Unsubscribe-Post: List-Unsubscribe=One-Click",
  ];
  if (opts.replyTo) headers.push(`Reply-To: ${opts.replyTo}`);

  const body = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    opts.text,
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    opts.html,
    "",
    `--${boundary}--`,
    "",
  ];

  return headers.join("\r\n") + "\r\n\r\n" + body.join("\r\n");
}

/**
 * Minimal RFC 2047 encoder for non-ASCII subject lines. SES tolerates
 * raw UTF-8 in headers but several inboxes reject anything outside the
 * printable ASCII range, so we b-encode anything that looks unsafe.
 */
function encodeMimeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (!/[\x00-\x1f\x7f-￿]/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

export class EmailService {
  private recentLogs: EmailLogEntry[] = [];
  private maxLogEntries = 100;

  async isConfigured(orgId?: number): Promise<boolean> {
    try {
      await getCredentials(orgId);
      return true;
    } catch {
      return false;
    }
  }

  async getDefaultFromEmail(orgId?: number): Promise<string | null> {
    try {
      const creds = await getCredentials(orgId);
      return creds.fromEmail;
    } catch {
      return null;
    }
  }

  /**
   * Send one email.
   *
   * When `options.idempotencyKey` and `options.organizationId` are both present
   * this runs through the outward-action boundary, so a retried job cannot send
   * the same message twice. On a REPLAY it returns success carrying the
   * original provider message id rather than throwing — unlike physical mail,
   * an email caller almost always just wants to know the message went out, and
   * the id is the honest answer to that. Nothing is fabricated: the returned
   * messageId is the one SES issued the first time.
   */
  async sendEmail(options: EmailOptions): Promise<EmailResult> {
    if (options.idempotencyKey && options.organizationId) {
      const { withOutwardAction } = await import("./actions/outwardAction");
      return withOutwardAction<EmailResult>(
        {
          organizationId: options.organizationId,
          actionKind: `email.${options.purpose ?? 'system'}`,
          idempotencyKey: options.idempotencyKey,
          // Everything that materially defines the message. Reusing the key
          // with different content must be caught, not silently suppressed.
          payload: {
            to: options.to,
            subject: options.subject,
            html: options.html,
            text: options.text,
            from: options.from,
            replyTo: options.replyTo,
            purpose: options.purpose ?? 'system',
          },
        },
        async () => {
          const result = await this.performSend(options);
          if (result.success && result.messageId) {
            return { status: 'succeeded', externalId: result.messageId, result };
          }
          // A structured failure from the transport ran BEFORE anything left,
          // or the provider rejected it outright — safe to retry. A THROWN
          // error is different and withOutwardAction records it as ambiguous.
          return {
            status: 'failed',
            error: new Error(result.error ?? 'email send failed'),
          };
        },
        (externalId) => ({ success: true, messageId: externalId ?? undefined }),
      ).catch((err) => {
        // The boundary refuses (in-flight / ambiguous / key reused) by
        // throwing. Surface that as a structured non-retryable failure rather
        // than an exception, because every existing caller of sendEmail expects
        // an EmailResult and would otherwise crash on a safety refusal.
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
          retryable: false,
        } satisfies EmailResult;
      });
    }
    return this.performSend(options);
  }

  private async performSend(options: EmailOptions): Promise<EmailResult> {
    const startTime = Date.now();
    // ONE reading of the lane for the whole send. Everything downstream that
    // could put AcreOS's name or address on a customer's counterparty mail —
    // the From: display name and the CAN-SPAM footer — branches on THIS, not
    // on `options.purpose` re-read ad hoc, so the two can never disagree.
    // Undeclared stays 'system' by the documented default; the undeclared-lane
    // guard below is what stops an undeclared COUNTERPARTY send from getting
    // here at all.
    const lane: SendLane = options.purpose ?? 'system';
    // Display name for the counterparty lane, resolved once (below) while the
    // org's identity is being checked, so the retry loop makes no extra DB
    // calls. null = no honest display name available ⇒ send with a bare
    // address rather than signing the customer's mail "AcreOS".
    let counterpartyFromName: string | null = null;
    const config: RetryConfig = {
      ...DEFAULT_RETRY_CONFIG,
      ...options.retryConfig,
    };

    const toAddresses = Array.isArray(options.to) ? options.to : [options.to];

    // SIMULATION_MODE short-circuits every outbound email. SES is
    // never called, nothing leaves the server. The would-have-sent
    // payload is logged to simulated_actions so the founder-testing
    // suite can verify delivery decisions without real delivery.
    {
      const { shouldSimulate, recordSimulatedAction } = await import("../utils/simulationMode");
      const org = options.organizationId
        ? await (await import("../storage")).storage
            .getOrganization(options.organizationId)
            .catch(() => null)
        : null;
      if (shouldSimulate("email", org)) {
        const rec = await recordSimulatedAction(
          "email",
          "ses.sendEmail",
          {
            to: toAddresses,
            from: options.from,
            subject: options.subject,
            htmlPreview: typeof options.html === "string" ? options.html.slice(0, 200) : undefined,
          },
          org
        );
        return {
          success: true,
          messageId: rec.id,
          attempts: 1,
        } as EmailResult;
      }
    }

    // Validate email addresses before attempting to send
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalidAddresses = toAddresses.filter(addr => !emailRegex.test(addr));
    if (invalidAddresses.length > 0) {
      return {
        success: false,
        error: `Invalid email address(es): ${invalidAddresses.join(', ')}`,
        errorType: 'recipient_rejected',
        attempts: 0,
      };
    }

    // Hessam §2.3: short-circuit suppressed recipients before calling SES.
    // We block the whole message when EVERY recipient is suppressed; for
    // mixed-recipient messages we filter out the suppressed addresses and
    // proceed with the remainder. This prevents domain-reputation damage
    // from re-sending to known bouncers/spam-reporters/unsubscribers.
    const suppressionCheck = await filterSuppressed(toAddresses);
    if (suppressionCheck.suppressed.length > 0) {
      logger.info('[EmailService] suppressed recipients filtered', { metadata: {
        suppressed: suppressionCheck.suppressed,
        original: toAddresses.length,
      } });
    }
    if (suppressionCheck.allowed.length === 0) {
      return {
        success: false,
        error: `All recipient(s) are on the suppression list: ${suppressionCheck.suppressed.join(', ')}`,
        errorType: 'recipient_rejected',
        attempts: 0,
      };
    }
    // Replace toAddresses with the allowed subset for the rest of the send.
    toAddresses.length = 0;
    toAddresses.push(...suppressionCheck.allowed);

    // Eleonora §10: enforce per-org IP-warmup ramp before SES is touched.
    // Brand-new orgs are capped at 50/day on day 1, scaling up to 10k/day
    // by day 7. Hitting the cap returns quota_exceeded immediately (no SES
    // round-trip and no spend on a doomed send).
    if (options.organizationId) {
      const reservation = await reserveSend(options.organizationId);
      if (!reservation.ok) {
        logger.warn('[EmailService] warmup limit reached — send rejected', { metadata: {
          organizationId: options.organizationId,
          dailyLimit: reservation.dailyLimit,
          warmupDay: reservation.warmupDay,
          resetAt: reservation.resetAt,
        } });
        return {
          success: false,
          error: `Daily send limit reached for warmup day ${reservation.warmupDay} (limit: ${reservation.dailyLimit}). Resets at ${reservation.resetAt.toISOString()}.`,
          errorType: 'quota_exceeded',
          attempts: 0,
          retryable: false,
        };
      }
    }

    // ── Counterparty enforcement (founder decision, 2026-07-17) ──────────
    // Deal mail — anything sent to a customer's sellers/buyers/borrowers on
    // their behalf — must carry the CUSTOMER's identity: either their own
    // AWS SES credentials (aws_ses integration) or their verified sending
    // domain (org email identity). The platform @acreos.io identity is
    // reserved for SYSTEM mail (trial notices, win-back, receipt/dunning
    // fallbacks, digests to the customer themselves). Deal lanes mark their
    // sends with purpose: "counterparty"; there is deliberately NO silent
    // fallback to the platform identity on that path — the honest failure
    // tells the customer to connect their email.
    if (options.purpose === 'counterparty') {
      if (!options.organizationId) {
        return {
          success: false,
          error: 'Counterparty email requires an organizationId — deal mail always belongs to a customer org.',
          errorType: 'configuration_error',
          attempts: 0,
          retryable: false,
        };
      }
      const [orgCreds, orgIdentity] = await Promise.all([
        getOrgCredentials(options.organizationId, 'counterparty'),
        getIdentityForSend(options.organizationId).catch(() => null),
      ]);
      if (!orgCreds && !orgIdentity) {
        logger.info('[EmailService] Counterparty send refused — no connected email identity', {
          metadata: { organizationId: options.organizationId },
        });
        // FOUNDER ALERT, per-org (founder decision 2026-08-17, OD-2).
        //
        // The refusal itself is correct and is NOT weakened — the 2026-07-17
        // ruling stands. What was missing is that it was INVISIBLE: a
        // `logger.info` and an error string returned to a caller that, on the
        // job paths, has nobody reading it. Two of the five lanes behind this
        // guard are regulated correspondence (Reg Z §1026.41 periodic
        // statements, statutory disclosures), so an org that never connects an
        // identity silently stops sending mail it is legally obliged to send.
        // Nothing measured how many orgs that is, because no session has had a
        // DATABASE_URL — so the alert IS the measurement, arriving one org at a
        // time as each is actually affected.
        //
        // dedupeKey is per-ORG, not per-send: the condition is "this
        // organization cannot send counterparty mail at all", which is true
        // once no matter how many sends hit it. Keyed per send this would page
        // the founder once per dunning email.
        //
        // warning, not critical: a customer who has not finished onboarding is
        // a configuration gap, not an outage of ours, and paging at 3am for it
        // teaches the founder to ignore the pager. The detail names the
        // regulated exposure so the severity is not mistaken for triviality.
        //
        // FIRE-AND-FORGET, AND BOTH HALVES MATTER: `void` so the refusal is not
        // delayed by the alert spine, and `.catch` so a failing alert can never
        // propagate into this path. The refusal below is already decided —
        // observability must not become the thing that changes the decision.
        void raiseAlert({
          severity: 'warning',
          source: 'email_byo_identity',
          title: 'Organization cannot send counterparty mail — no connected email identity',
          detail:
            `Organization ${options.organizationId} attempted a counterparty send with neither ` +
            `BYO SES credentials nor a verified sending domain, so the send was refused ` +
            `(founder decision 2026-07-17: counterparty mail carries the customer's own identity, ` +
            `never the platform sender). Two of the lanes behind this guard are REGULATED ` +
            `correspondence — Reg Z §1026.41 periodic statements and statutory disclosures — so ` +
            `while this org has no identity connected, that mail is not going out. Resolve by ` +
            `having them connect an email account or verify a sending domain ` +
            `(Settings → Connections).`,
          dedupeKey: `byo-identity-missing:org:${options.organizationId}`,
          domain: 'compliance',
          citedReason:
            'Founder decision 2026-07-17 (BYO send rails) + Reg Z §1026.41 periodic statement delivery',
          subjectRef: `organization:${options.organizationId}`,
          metadata: { organizationId: options.organizationId, __pii_safe: true },
        }).catch((err: unknown) => {
          logger.warn('[EmailService] BYO-identity founder alert failed to raise', {
            metadata: {
              organizationId: options.organizationId,
              error: err instanceof Error ? err.message : String(err),
              __pii_safe: true,
            },
          });
        });
        return {
          success: false,
          error:
            'No connected email identity for this organization. Connect your email account or verify your sending domain (Settings → Connections) to email sellers and buyers — platform email is reserved for system notices.',
          errorType: 'configuration_error',
          attempts: 0,
          retryable: false,
        };
      }

      // The DISPLAY NAME is part of the identity too. `getSESClient` falls
      // back to `AWS_SES_FROM_NAME || 'AcreOS'` for the platform credentials,
      // so a counterparty send riding the customer's own verified DOMAIN
      // (orgIdentity, platform AWS creds) would otherwise go out as
      // "AcreOS <mail@customer-domain.com>" — our name on their deal mail,
      // which is the same re-fronting the address footer used to commit.
      counterpartyFromName =
        options.fromName?.trim() ||
        orgCreds?.fromName?.trim() ||
        (await storage.getOrganization(options.organizationId).catch(() => null))?.name?.trim() ||
        null;
    }

    // ── Undeclared-lane guard — "invert the default to refuse" ────────────
    //    (founder ruling, 2026-08-16; enforces the 2026-07-17 decision)
    //
    // `purpose` is OPTIONAL and this file reads it as `options.purpose ?? 'system'`,
    // so OMITTING the field silently selected the PLATFORM lane — exactly what
    // the 2026-07-17 decision forbids. At the time of the ruling 62 of 70 send
    // sites declared nothing.
    //
    // The founder REJECTED making `purpose` required. 62 call sites answering
    // the compiler in one pass would have stamped `system` across the codebase,
    // converting accidental violations into DECLARED ones that look reviewed
    // and are never re-examined. So the field stays optional and the DEFAULT is
    // inverted instead: an UNDECLARED send whose recipient resolves to a
    // counterparty record refuses, loudly, instead of quietly riding @acreos.io.
    //
    // WHEN `purpose` IS SET — either lane — this block does nothing. An explicit
    // declaration is a decision of record and the guard does not second-guess
    // it; `purpose: 'counterparty'` is already enforced immediately above.
    //
    // COST, and it is the gradient we want: the lookup runs ONLY on the
    // undeclared path. Every labelled site skips it entirely, so declaring the
    // lane is the CHEAP path and leaving it blank is the one that pays for a
    // database round-trip.
    if (options.purpose === undefined) {
      // SAME-ORG ONLY. `counterpartyMatch` is deliberately cross-org for its
      // other consumer (the autopilot hand, where the question is "is this
      // anybody's counterparty anywhere"). Here the opposite scoping is
      // correct, and the difference is not an oversight: one person can
      // legitimately be an AcreOS user AND appear in a DIFFERENT org's leads
      // table. A cross-org hit is not THIS send's counterparty, and refusing on
      // it would block mail to a real paying customer. The autopilot hand can
      // afford that false positive — it guards one founder-tapped action; this
      // sits on every send in the system and cannot.
      //
      // No `organizationId` on the send means a hit could never be attributed
      // to this send's tenant, so it could never produce a refusal. That is
      // TREATED AS NO MATCH, and the lookup is skipped rather than paid for and
      // discarded. It is a real hole in the guard — an undeclared, org-less
      // send to a counterparty still goes out — written down rather than
      // implied away. The rule remains separately enforced by the explicit
      // `purpose: 'counterparty'` labels at the known deal-mail sites.
      if (options.organizationId !== undefined) {
        let sameOrgHits: Array<{ address: string; hit: CounterpartyHit }> = [];
        try {
          // Dynamic import so the undeclared path pays for loading the resolver
          // and the labelled path does not. ONE resolver, shared with the
          // autopilot hand — a second implementation of this rule is how the
          // two copies drift apart.
          const { counterpartyMatch } = await import('./autopilot/hands/counterpartyMatch');
          // allSettled, NOT all: on a multi-recipient send one address's lookup
          // rejecting must not discard a GENUINE match on another address. With
          // Promise.all a single rejection aborts the batch, the catch below
          // fires, and the whole send fails open — which quietly widens
          // "infrastructure error" from one recipient to all of them.
          const settled = await Promise.allSettled(
            toAddresses.map(async (address) => ({ address, hit: await counterpartyMatch(address) })),
          );
          const resolved = settled
            .filter((s): s is PromiseFulfilledResult<{ address: string; hit: CounterpartyHit | null }> =>
              s.status === 'fulfilled')
            .map((s) => s.value);
          if (settled.length !== resolved.length) {
            // EVERY lookup failing is the total-failure case the outer catch
            // used to own before allSettled was introduced, so it keeps that
            // marker — the invariant "the guard went blind and the send
            // proceeded" is unchanged and stays greppable under one name.
            // A PARTIAL failure is a genuinely new state and gets its own
            // marker: some addresses were checked and some were not, which is
            // strictly more informative than pretending the whole batch failed.
            const total = resolved.length === 0;
            // Carry the ORIGINAL error, don't drop it. allSettled moves the
            // rejection out of the catch block, and the reason a fail-open is
            // acceptable at all is that it is loud — a marker with no cause
            // attached is half a signal.
            const firstReason = settled.find(
              (x): x is PromiseRejectedResult => x.status === 'rejected',
            )?.reason;
            logger.error(
              total
                ? '[EmailService] undeclared_lane_guard_fail_open — every recipient lookup failed, so the lane could not be checked. FAILING OPEN: the send proceeds on the platform identity. If this is sustained, undeclared counterparty mail is going out unchecked.'
                : '[EmailService] undeclared_lane_guard_partial — a recipient lookup failed and that address was not checked. FAILING OPEN for it; the checked addresses were still enforced.',
              firstReason instanceof Error ? firstReason : undefined,
              {
                metadata: {
                  // Structured marker, not a substring of the message: a
                  // greppable field survives message rewording, and the test
                  // pins THIS rather than the prose.
                  marker: total
                    ? 'undeclared_lane_guard_fail_open'
                    : 'undeclared_lane_guard_partial',
                  organizationId: options.organizationId,
                  checked: resolved.length,
                  total: settled.length,
                },
              },
            );
          }
          const candidates = resolved.filter(
            (r): r is { address: string; hit: CounterpartyHit } =>
              r.hit !== null && r.hit.organizationId === options.organizationId,
          );

          // ── AN ORG'S OWN PEOPLE ARE THE `system` LANE, BY DEFINITION ──────
          // The founder rule defines `system` as "AcreOS talking to its own
          // users". BEING A LEAD AND BEING A USER ARE NOT MUTUALLY EXCLUSIVE,
          // and the first cut of this guard treated them as if they were —
          // refusing on a same-org counterparty hit with no membership check at
          // all. That is a live false positive, not a theoretical one:
          //   * growthAutomation's six sends all target getOwnerEmail(org.id),
          //     which reads teamMembers.email WHERE role='owner';
          //   * routes-campaigns' TEST-SEND mails the logged-in user, and
          //     adding yourself as a lead is the ORDINARY way to test campaign
          //     rendering — so the guard would break the one feature whose
          //     entire job is "email this to me".
          // Refusing a customer's own mail to protect them from their own mail
          // is a worse outcome than the violation this guard exists to catch.
          if (candidates.length > 0) {
            const { orgMemberAddresses } = await import('./orgMemberAddresses');
            const members = await orgMemberAddresses(options.organizationId, candidates.map((c) => c.address));
            sameOrgHits = candidates.filter((c) => !members.has(c.address.toLowerCase()));
          }
        } catch (error) {
          // ── FAIL OPEN. DO NOT "FIX" THIS CLOSED. ──────────────────────────
          // This is deliberately the OPPOSITE of the autopilot hand's guard
          // (server/services/autopilot/hands/send-email.ts), which fails CLOSED
          // on the same lookup. The asymmetry is the point.
          //
          // The autopilot guard sits on ONE founder-tapped action: a false
          // block there defers a single send to founder review. THIS guard sits
          // on EVERY send in the product, including password resets, email
          // verification, payment receipts and dunning. Failing closed here
          // means a database blip stops all system mail — a large, certain,
          // self-inflicted outage.
          //
          // Failing open leaves us in exactly the state that shipped for
          // months: the pre-guard behaviour. That is a smaller, already-accepted
          // risk, and the rule stays separately enforced by the explicit
          // `purpose: 'counterparty'` labels at the known sites. A guard is a
          // net, not the floor.
          //
          // Only an INFRASTRUCTURE ERROR fails open. A positive match below
          // still fails CLOSED.
          logger.error(
            '[EmailService] undeclared-lane-guard lookup failed — FAILING OPEN, send proceeds on the platform lane',
            error,
            {
              source: 'email-lane-guard',
              metadata: {
                marker: 'undeclared_lane_guard_fail_open',
                organizationId: options.organizationId,
                recipients: toAddresses.length,
              },
            },
          );
        }

        const refusal = sameOrgHits[0];
        if (refusal) {
          logger.warn('[EmailService] undeclared send refused — recipient is this org\'s counterparty', {
            source: 'email-lane-guard',
            metadata: {
              marker: 'undeclared_lane_guard_refusal',
              organizationId: options.organizationId,
              matchedKind: refusal.hit.kind,
              matchedRecordId: refusal.hit.recordId,
              counterpartyOrganizationId: refusal.hit.organizationId,
            },
          });
          // Developer-facing on purpose: nobody but the author of the call site
          // can decide which lane this send belongs to, and this string is what
          // they will read in the failure.
          return {
            success: false,
            error:
              `Undeclared send lane. The recipient (${refusal.address}) resolves to a counterparty record of ` +
              `THIS org — ${refusal.hit.kind} #${refusal.hit.recordId} in org ${refusal.hit.organizationId}. ` +
              `Omitting \`purpose\` silently selects the platform @acreos.io sender, which is reserved for system ` +
              `mail (founder decision, 2026-07-17), so an undeclared counterparty send refuses instead of ` +
              `defaulting (founder ruling, 2026-08-16). Fix the CALL SITE: set \`purpose: 'counterparty'\` if this ` +
              `is deal mail — and connect the org's own email identity (Settings → Connections) so it can go out ` +
              `on their sender — or set \`purpose: 'system'\` if the match is wrong and this really is AcreOS ` +
              `talking to its own user. Nothing was sent.`,
            errorType: 'configuration_error',
            attempts: 0,
            retryable: false,
          };
        }
      }
    }

    let lastError: any = null;
    let attempts = 0;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      attempts = attempt + 1;

      try {
        const { client, fromEmail: defaultFromEmail, fromName: defaultFromName, source } =
          await getSESClient(options.organizationId);

        // Eleonora §10: prefer the org-specific verified DKIM identity over
        // the platform/SES default. We still use the platform's AWS creds
        // to actually send — SES authenticates the From: domain via the
        // identity records (DKIM/SPF/DMARC) the founder published.
        let fromAddress = options.from || defaultFromEmail;
        // Lane-aware display name. On the counterparty lane the platform
        // default ('AcreOS', or AWS_SES_FROM_NAME) is UNREACHABLE: we use the
        // customer's own name or NO display name at all. A bare address is
        // honest; "AcreOS" on a customer's letter to their seller is not.
        const fromNameFinal: string | null =
          lane === 'counterparty'
            ? counterpartyFromName
            : (options.fromName || defaultFromName || 'AcreOS');
        if (options.organizationId) {
          const orgIdentity = await getIdentityForSend(options.organizationId);
          if (orgIdentity) {
            fromAddress = options.from || orgIdentity.fromAddress;
          }
        }

        // ── Counterparty From: chokepoint (founder decision 2026-07-17) ────
        //
        // The guard near the top of this function decides WHETHER a
        // counterparty send may proceed, by asking the org for credentials or
        // an identity. This checks the thing that actually goes on the wire,
        // at the moment it is assembled, and the two are NOT the same check:
        // between them sit a second credential lookup and a second identity
        // lookup, either of which can come back empty when the first did not.
        // `getOrgCredentials` swallows a storage failure and returns null, and
        // `getCredentials` then falls back to the PLATFORM keys — so a
        // transient DB blip after a passing guard would have put
        // no-reply@acreos.io in the From: line of a customer's letter to their
        // seller, under the customer's own display name. That is precisely the
        // re-fronting the ruling bans, arriving by accident rather than by
        // design.
        //
        // The rule enforced here is the observable one: on the counterparty
        // lane the From: address must be the ORG's — their verified sending
        // identity, or a sender their own credentials carry — never the
        // address the PLATFORM credentials default to. `source === 'platform'`
        // with an org identity in hand stays allowed on purpose: platform AWS
        // keys sending FROM the customer's own verified domain is the
        // documented BYO-domain path, and the From: line is theirs.
        // Three conjuncts, each load-bearing, and deliberately no fourth.
        //
        // A `!fromAddressIsOrgIdentity` clause stood here until an audit deleted
        // it in an isolated tree and found every case still green — inert, and
        // worse than inert: it was the one clause that WEAKENED the refusal,
        // exempting exactly the state a reader would expect it to catch (an org
        // whose "own identity" resolved to the platform address would have
        // sailed straight through). The BYO-domain path it was meant to protect
        // is already protected by the address comparison: platform AWS keys
        // sending FROM the customer's verified domain do not match
        // `defaultFromEmail`, so they never reach this block at all.
        //
        // The lesson is the one this repo keeps paying for — an extra conjunct
        // reads as extra safety and can be the opposite. Each of the three below
        // is pinned by a case that fails when that conjunct alone is removed.
        if (
          lane === 'counterparty' &&
          source === 'platform' &&
          isSameEmailAddress(fromAddress, defaultFromEmail)
        ) {
          logger.error(
            '[EmailService] Counterparty send blocked at the From: chokepoint — the sender resolved to the platform identity',
            undefined,
            {
              metadata: {
                organizationId: options.organizationId,
                credentialSource: source,
                __pii_safe: true,
              },
            },
          );
          return {
            success: false,
            error:
              'Counterparty send blocked: the sending address resolved to the platform identity rather than this organization\'s. ' +
              'Deal mail carries the customer\'s own identity (founder decision 2026-07-17), so nothing was sent. ' +
              'If the organization has an email account or verified domain connected, this is a transient resolution failure — retry.',
            errorType: 'configuration_error',
            attempts,
            retryable: false,
          };
        }

        const fromFormatted = fromNameFinal ? `${fromNameFinal} <${fromAddress}>` : `<${fromAddress}>`;

        // Eleonora §10: every outbound message gets a per-recipient
        // List-Unsubscribe token. Reused across sends to the same
        // recipient (RFC 8058 stability requirement).
        const primaryRecipient = toAddresses[0];
        const unsubToken = await issueToken({
          email: primaryRecipient,
          organizationId: options.organizationId,
        });
        const unsubUrl = options.unsubscribeUrl || buildUnsubscribeUrl(unsubToken);

        // CAN-SPAM / GDPR compliance: append the visible opt-out + postal-address
        // footer. §5 requires both (a) a clear opt-out + (b) a valid physical
        // postal address in every COMMERCIAL message. We fail safe: the footer
        // renders on every send EXCEPT those explicitly marked
        // `transactional: true`. This closes the highest-volume marketing path
        // (growthAutomation lifecycle emails) that previously shipped with
        // neither isCampaignEmail nor unsubscribeUrl set. The List-Unsubscribe
        // header alone does not satisfy §5's visible-body requirement.
        let htmlBody = options.html;
        if (shouldRenderCanSpamFooter(options)) {
          // CAN-SPAM §5: render a real postal address when we have one, and
          // NEVER ship a literal placeholder. If nothing is resolvable, the
          // system lane still names AcreOS (it IS the sender there) while the
          // counterparty lane drops the line entirely — see below.
          const resolved = await resolveCanSpamAddress(options.organizationId, lane);
          // On the counterparty lane an unresolvable footer OMITS the line —
          // it must never degrade to the literal 'AcreOS', which is what the
          // old unconditional fallback did.
          const brandLine = resolved
            ? (resolved.brandName ? `${resolved.brandName} &middot; ${resolved.address}` : resolved.address)
            : lane === 'counterparty'
              ? null
              : 'AcreOS';
          const brandParagraph = brandLine ? `\n  <p style="margin-top:12px;">${brandLine}</p>` : '';
          htmlBody = `${htmlBody}
<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;text-align:center;">
  <p>You are receiving this email because you are a contact in our CRM system.</p>
  <p><a href="${unsubUrl}" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a> from marketing emails</p>${brandParagraph}
</div>`;
        }
        const textBody = options.text || this.htmlToText(htmlBody);

        // Eleonora §10: SendRawEmail with explicit List-Unsubscribe headers
        // (RFC 2369 + RFC 8058). The MIME message includes both a mailto:
        // fallback and the tokenized HTTPS one-click handler.
        const rawMessage = buildRawMimeMessage({
          from: fromFormatted,
          to: toAddresses,
          subject: options.subject,
          html: htmlBody,
          text: textBody,
          replyTo: options.replyTo,
          listUnsubscribeMailto: UNSUBSCRIBE_MAILTO,
          listUnsubscribeUrl: unsubUrl,
        });

        const command = new SendRawEmailCommand({
          Source: fromFormatted,
          Destinations: toAddresses,
          RawMessage: { Data: Buffer.from(rawMessage, 'utf8') },
        });

        const response = await emailCircuitBreaker.call(() => client.send(command));
        const messageId = response.MessageId || `ses-${Date.now()}`;
        const durationMs = Date.now() - startTime;
        
        this.log({
          timestamp: new Date(),
          to: toAddresses.join(', '),
          subject: options.subject,
          status: 'sent',
          messageId,
          attempts,
          organizationId: options.organizationId,
          durationMs,
        });
        
        logger.info(`[EmailService] Email sent via AWS SES (${source}) to ${toAddresses.join(', ')}, MessageId: ${messageId}, attempts: ${attempts}, duration: ${durationMs}ms`);
        
        return { success: true, messageId, attempts };
      } catch (error: any) {
        lastError = error;
        const errorType = categorizeError(error);
        const retryable = isRetryableError(error);
        
        logger.warn(`[EmailService] Send attempt ${attempts} failed`, { metadata: { detail: {
          error: error.message,
          errorType,
          retryable,
          to: toAddresses.join(', '),
        } } });
        
        if (!retryable || attempt >= config.maxRetries) {
          break;
        }
        
        const backoffMs = calculateBackoff(attempt, config);
        logger.info(`[EmailService] Retrying in ${backoffMs}ms (attempt ${attempt + 2}/${config.maxRetries + 1})`);
        await delay(backoffMs);
      }
    }
    
    const errorType = categorizeError(lastError);
    const errorMessage = this.formatErrorMessage(lastError, errorType);
    const durationMs = Date.now() - startTime;
    
    this.log({
      timestamp: new Date(),
      to: toAddresses.join(', '),
      subject: options.subject,
      status: 'failed',
      error: errorMessage,
      errorType,
      attempts,
      organizationId: options.organizationId,
      durationMs,
    });
    
    logger.error('[EmailService] Failed to send email after all attempts', undefined, { metadata: { detail: {
      error: errorMessage,
      errorType,
      attempts,
      to: toAddresses.join(', '),
      durationMs,
    } } });
    
    return { 
      success: false, 
      error: errorMessage, 
      errorType, 
      attempts,
      retryable: isRetryableError(lastError),
    };
  }

  async sendBulkEmails(
    emails: EmailOptions[], 
    orgId?: number, 
    options?: { 
      concurrency?: number;
      rateLimitDelayMs?: number;
    }
  ): Promise<{ results: EmailResult[]; summary: { sent: number; failed: number; total: number } }> {
    const concurrency = options?.concurrency || 5;
    const rateLimitDelayMs = options?.rateLimitDelayMs || 100;
    const results: EmailResult[] = [];
    let sent = 0;
    let failed = 0;
    
    for (let i = 0; i < emails.length; i += concurrency) {
      const batch = emails.slice(i, i + concurrency);
      const batchPromises = batch.map(email => 
        this.sendEmail({ ...email, organizationId: email.organizationId || orgId })
      );
      
      const batchResults = await Promise.allSettled(batchPromises).then(settled =>
        settled.map(r => r.status === 'fulfilled' ? r.value : { success: false, error: (r.reason as Error).message })
      );
      
      for (const result of batchResults) {
        results.push(result);
        if (result.success) sent++;
        else failed++;
      }
      
      if (i + concurrency < emails.length) {
        await delay(rateLimitDelayMs);
      }
    }
    
    logger.info(`[EmailService] Bulk send complete: ${sent} sent, ${failed} failed, ${emails.length} total`);
    
    return { 
      results, 
      summary: { sent, failed, total: emails.length } 
    };
  }

  async sendTransactionalEmail(
    type: 'verification' | 'password_reset' | 'notification' | 'welcome' | 'alert' | 'founder_briefing' | 'churn_rescue',
    options: {
      to: string;
      subject?: string;
      templateData: Record<string, any>;
      organizationId?: number;
      /**
       * Lane for the underlying send (founder decision, 2026-07-17). Forwarded
       * verbatim to sendEmail — this wrapper does NOT decide the lane, because
       * only the call site knows whether the recipient is one of AcreOS's own
       * users or one of the customer's counterparties. Omitted here means
       * omitted there, so the sendEmail default ("system") still applies and a
       * miswired lane stays visible as an absent field rather than an
       * unreviewable explicit "system".
       */
      purpose?: 'system' | 'counterparty';
    }
  ): Promise<EmailResult> {
    const templates: Record<string, { subject: string; html: string }> = {
      verification: {
        subject: 'Verify Your Email Address',
        html: this.buildVerificationTemplate(options.templateData),
      },
      password_reset: {
        subject: 'Reset Your Password',
        html: this.buildPasswordResetTemplate(options.templateData),
      },
      notification: {
        subject: options.templateData.subject || 'New Notification',
        html: this.buildNotificationTemplate(options.templateData),
      },
      welcome: {
        subject: 'Welcome to AcreOS',
        html: this.buildWelcomeTemplate(options.templateData),
        // CAN-SPAM safety: welcome emails carry marketing-ish CTAs (campaigns,
        // dashboard nudges) so we treat them as commercial and apply the
        // List-Unsubscribe header + visible-footer pattern via the
        // isCampaignEmail flag in sendEmail.
      },
      alert: {
        subject: options.templateData.alertTitle || 'Important Alert',
        html: this.buildAlertTemplate(options.templateData),
      },
      founder_briefing: {
        subject: options.templateData.subject || `AcreOS Daily Briefing — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
        html: this.buildFounderBriefingTemplate(options.templateData),
      },
      churn_rescue: {
        subject: options.templateData.subject || 'A note from AcreOS',
        html: this.buildChurnRescueTemplate(options.templateData),
      },
    };

    const template = templates[type];

    // CAN-SPAM compliance: welcome + churn_rescue + founder_briefing carry
    // marketing-shaped CTAs; they are commercial and get the footer by the
    // safe-default. verification + password_reset + notification + alert are
    // genuinely transactional (they facilitate an existing transaction), so we
    // mark them `transactional: true` to suppress the footer.
    const transactional =
      type === 'verification' ||
      type === 'password_reset' ||
      type === 'notification' ||
      type === 'alert';

    return this.sendEmail({
      to: options.to,
      subject: options.subject || template.subject,
      html: template.html,
      organizationId: options.organizationId,
      transactional,
      purpose: options.purpose,
    });
  }

  async getDeliveryStatus(messageId: string): Promise<'pending' | 'delivered' | 'failed' | 'unknown'> {
    return 'unknown';
  }
  
  async getCredentialSource(orgId: number): Promise<'organization' | 'platform' | null> {
    try {
      const creds = await getCredentials(orgId);
      return creds.source;
    } catch {
      return null;
    }
  }

  async getSendQuota(orgId?: number): Promise<{ max24HourSend: number; maxSendRate: number; sentLast24Hours: number } | null> {
    try {
      const { client } = await getSESClient(orgId);
      const command = new GetSendQuotaCommand({});
      const response = await client.send(command);
      return {
        max24HourSend: response.Max24HourSend || 0,
        maxSendRate: response.MaxSendRate || 0,
        sentLast24Hours: response.SentLast24Hours || 0,
      };
    } catch (error) {
      logger.error('[EmailService] Failed to get send quota', error);
      return null;
    }
  }

  getRecentLogs(limit: number = 50): EmailLogEntry[] {
    return this.recentLogs.slice(-limit);
  }

  getLogsByOrganization(orgId: number, limit: number = 50): EmailLogEntry[] {
    return this.recentLogs
      .filter(log => log.organizationId === orgId)
      .slice(-limit);
  }

  private log(entry: EmailLogEntry): void {
    this.recentLogs.push(entry);
    if (this.recentLogs.length > this.maxLogEntries) {
      this.recentLogs = this.recentLogs.slice(-this.maxLogEntries);
    }
  }

  private formatErrorMessage(error: any, errorType: EmailErrorType): string {
    const baseMessage = error?.message || 'Failed to send email';
    
    const friendlyMessages: Record<EmailErrorType, string> = {
      sender_not_verified: 'Sender email or domain not verified in AWS SES',
      recipient_rejected: 'Recipient email address was rejected',
      rate_limit: 'Email sending rate limit exceeded - please try again later',
      quota_exceeded: 'Daily email quota exceeded',
      configuration_error: 'Email service configuration error',
      network_error: 'Network error while sending email',
      unknown: baseMessage,
    };
    
    return friendlyMessages[errorType] || baseMessage;
  }

  private htmlToText(html: string): string {
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<li>/gi, '- ')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      .trim();
  }

  private buildVerificationTemplate(data: Record<string, any>): string {
    return `
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 24px;">Verify Your Email</h1>
        </div>
        <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
          <p>Hi ${data.name || 'there'},</p>
          <p>Please verify your email address by clicking the button below:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${data.verificationUrl}" style="background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">Verify Email</a>
          </div>
          <p style="color: #666; font-size: 14px;">If you didn't create an account, you can safely ignore this email.</p>
          <p style="color: #666; font-size: 14px;">This link expires in ${data.expiresIn || '24 hours'}.</p>
        </div>
      </body>
      </html>
    `;
  }

  private buildPasswordResetTemplate(data: Record<string, any>): string {
    return `
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); padding: 30px; border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 24px;">Reset Your Password</h1>
        </div>
        <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
          <p>Hi ${data.name || 'there'},</p>
          <p>We received a request to reset your password. Click the button below to create a new password:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${data.resetUrl}" style="background: #f5576c; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">Reset Password</a>
          </div>
          <p style="color: #666; font-size: 14px;">If you didn't request this, you can safely ignore this email.</p>
          <p style="color: #666; font-size: 14px;">This link expires in ${data.expiresIn || '1 hour'}.</p>
        </div>
      </body>
      </html>
    `;
  }

  private buildNotificationTemplate(data: Record<string, any>): string {
    return `
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #4a5568; padding: 30px; border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 24px;">${data.title || 'Notification'}</h1>
        </div>
        <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
          <p>${data.message || ''}</p>
          ${data.actionUrl ? `
            <div style="text-align: center; margin: 30px 0;">
              <a href="${data.actionUrl}" style="background: #4a5568; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">${data.actionText || 'View Details'}</a>
            </div>
          ` : ''}
        </div>
      </body>
      </html>
    `;
  }

  private buildWelcomeTemplate(data: Record<string, any>): string {
    return `
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); padding: 30px; border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 24px;">Welcome to AcreOS!</h1>
        </div>
        <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
          <p>Hi ${data.firstName || data.name || 'there'},</p>
          <p>Thank you for joining us! We're excited to help you manage your land investments.</p>
          <p>Here are some things you can do to get started:</p>
          <ul>
            <li>Complete your profile</li>
            <li>Import your first leads</li>
            <li>Set up your campaigns</li>
          </ul>
          ${data.dashboardUrl ? `
            <div style="text-align: center; margin: 30px 0;">
              <a href="${data.dashboardUrl}" style="background: #11998e; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">Go to Dashboard</a>
            </div>
          ` : ''}
        </div>
      </body>
      </html>
    `;
  }

  private buildAlertTemplate(data: Record<string, any>): string {
    const severityColors: Record<string, string> = {
      critical: '#dc2626',
      warning: '#f59e0b',
      info: '#3b82f6',
    };
    const color = severityColors[data.severity] || severityColors.info;
    
    return `
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: ${color}; padding: 30px; border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 24px;">${data.alertTitle || 'Alert'}</h1>
        </div>
        <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
          <p>${data.message || ''}</p>
          ${data.details ? `<p style="color: #666; font-size: 14px;">${data.details}</p>` : ''}
          ${data.actionUrl ? `
            <div style="text-align: center; margin: 30px 0;">
              <a href="${data.actionUrl}" style="background: ${color}; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">${data.actionText || 'Take Action'}</a>
            </div>
          ` : ''}
        </div>
      </body>
      </html>
    `;
  }

  private buildFounderBriefingTemplate(data: Record<string, any>): string {
    const date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const paragraphs = (data.briefingParagraphs as string[] | undefined) ?? [data.briefing ?? ''];
    const stats = data.stats as Record<string, any> | undefined;

    return `
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; color: #1a1a1a; max-width: 620px; margin: 0 auto; padding: 20px; background: #fff;">
        <div style="padding: 24px 0 16px; border-bottom: 2px solid #18181b;">
          <div style="display: inline-flex; align-items: center; gap: 8px;">
            <div style="width: 28px; height: 28px; background: linear-gradient(135deg, #16a34a, #0ea5e9); border-radius: 6px; display: inline-block;"></div>
            <span style="font-weight: 700; font-size: 18px;">AcreOS</span>
          </div>
          <p style="margin: 4px 0 0; color: #6b7280; font-size: 13px;">Daily Briefing · ${date}</p>
        </div>

        ${stats ? `
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 24px 0; padding: 20px; background: #f9fafb; border-radius: 8px;">
          ${Object.entries(stats).map(([k, v]) => `
            <div style="text-align: center;">
              <div style="font-size: 22px; font-weight: 700; color: #18181b;">${v}</div>
              <div style="font-size: 11px; color: #6b7280; margin-top: 2px;">${k}</div>
            </div>
          `).join('')}
        </div>
        ` : ''}

        <div style="margin: 24px 0; line-height: 1.7;">
          ${paragraphs.map((p: string) => `<p style="margin: 0 0 16px;">${p}</p>`).join('')}
        </div>

        <div style="text-align: center; margin: 32px 0;">
          <a href="${process.env.APP_URL ?? 'https://app.acreos.io'}/founder" style="background: #18181b; color: white; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 600; display: inline-block;">Open Founder Dashboard</a>
        </div>

        <p style="text-align: center; color: #9ca3af; font-size: 12px; margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
          AcreOS Autonomous System · No action required
        </p>
      </body>
      </html>
    `;
  }

  private buildChurnRescueTemplate(data: Record<string, any>): string {
    return `
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; color: #1a1a1a; max-width: 580px; margin: 0 auto; padding: 20px; background: #fff;">
        <div style="padding: 20px 0 16px; border-bottom: 1px solid #e5e7eb;">
          <div style="display: inline-block; width: 24px; height: 24px; background: linear-gradient(135deg, #16a34a, #0ea5e9); border-radius: 5px;"></div>
          <span style="font-weight: 700; font-size: 16px; vertical-align: middle; margin-left: 6px;">AcreOS</span>
        </div>
        <div style="padding: 28px 0;">
          <h2 style="font-size: 22px; font-weight: 700; margin: 0 0 16px;">${data.headline || 'A note from us'}</h2>
          ${(data.body as string || '').split('\n\n').map((p: string) => `<p style="margin: 0 0 16px; line-height: 1.7; color: #374151;">${p}</p>`).join('')}
          ${data.ctaUrl ? `
            <div style="margin: 28px 0;">
              <a href="${data.ctaUrl}" style="background: #16a34a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 600; display: inline-block;">${data.ctaText || 'Open AcreOS'}</a>
            </div>
          ` : ''}
        </div>
        <p style="color: #9ca3af; font-size: 12px; border-top: 1px solid #e5e7eb; padding-top: 16px;">AcreOS · You're receiving this because you have an active account</p>
      </body>
      </html>
    `;
  }
}

export const emailService = new EmailService();

/** Convenience alias for callers that import { sendEmail } */
export const sendEmail = emailService.sendEmail.bind(emailService);

export async function getEmailServiceStatus(): Promise<{
  isConfigured: boolean;
  defaultFromEmail?: string;
  provider: string;
  error?: string;
}> {
  try {
    const { fromEmail, region } = await getSESClient();
    return {
      isConfigured: true,
      defaultFromEmail: fromEmail,
      provider: `AWS SES (${region})`,
    };
  } catch (error: any) {
    return {
      isConfigured: false,
      provider: 'AWS SES',
      error: error.message,
    };
  }
}

export class AWSSESDomainService {
  async verifyEmailIdentity(email: string, orgId?: number): Promise<{ success: boolean; error?: string }> {
    try {
      const { client } = await getSESClient(orgId);
      const { VerifyEmailIdentityCommand } = await import('@aws-sdk/client-ses');
      const command = new VerifyEmailIdentityCommand({ EmailAddress: email });
      await client.send(command);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async verifyDomainIdentity(domain: string, orgId?: number): Promise<{ 
    success: boolean; 
    verificationToken?: string; 
    error?: string 
  }> {
    try {
      const { client } = await getSESClient(orgId);
      const { VerifyDomainIdentityCommand } = await import('@aws-sdk/client-ses');
      const command = new VerifyDomainIdentityCommand({ Domain: domain });
      const response = await client.send(command);
      return { 
        success: true, 
        verificationToken: response.VerificationToken 
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async listIdentities(orgId?: number): Promise<string[]> {
    try {
      const { client } = await getSESClient(orgId);
      const { ListIdentitiesCommand } = await import('@aws-sdk/client-ses');
      const command = new ListIdentitiesCommand({ IdentityType: 'EmailAddress' });
      const response = await client.send(command);
      return response.Identities || [];
    } catch (error) {
      logger.error('[AWSSESDomainService] Failed to list identities', error);
      return [];
    }
  }
}

export const awsSesDomainService = new AWSSESDomainService();

/**
 * CAN-SPAM §5 safe-default predicate. The visible postal-address + opt-out
 * footer renders on EVERY send unless the caller explicitly marks the message
 * `transactional: true`. Exported (pure, no I/O) so the fail-safe decision is
 * unit-testable without driving the full SES send path. The List-Unsubscribe
 * header alone does NOT satisfy §5's visible-body requirement.
 *
 * Placed at file end so it adds no lines above the no-fabrication-allowlisted
 * Math.random() jitter/boundary lines earlier in this file.
 */
export function shouldRenderCanSpamFooter(
  options: { transactional?: boolean },
): boolean {
  return !options.transactional;
}

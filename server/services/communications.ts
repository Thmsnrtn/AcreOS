import { emailService } from './emailService';
import { smsService } from './smsService';
import { storage } from '../storage';
import { checkTcpaConsentFromLead, canSendViaChannel, checkTcpaConsent } from './tcpaCompliance';
import { frequencyGateForLead, describeFrequencySkip } from './compliance/contactFrequency';
import { lobService, LobErrorType } from './lobService';
import { randomUUID } from 'node:crypto';
import { classifyExisting, requestHash, type ClaimVerdict } from './actions/outwardAction';
import type { OutwardActionStatus } from '@shared/schema';
import { logger } from "../utils/logger";

export interface CommunicationOptions {
  leadId: number;
  organizationId: number;
  subject?: string;
  message: string;
  channel?: 'email' | 'sms' | 'both';
}

export interface CommunicationResult {
  success: boolean;
  channel: string;
  messageId?: string;
  lobMailingId?: string;
  expectedDeliveryDate?: string;
  error?: string;
  errorType?: LobErrorType;
  tcpaBlocked?: boolean;
  /** True when the contact-frequency cap refused the send. */
  frequencyCapped?: boolean;
  retriesExhausted?: boolean;
}

export interface DirectMailContent {
  subject: string;
  body: string;
  htmlContent?: string;
}

const RETRY_DELAYS = [1000, 2000, 4000];
const MAX_RETRIES = 3;

// ── B5 interim — per-chain duplicate-send guard for direct mail ────────────
//
// SCOPE, STATED PLAINLY SO NOBODY MISREADS IT: this is NOT a
// durable idempotency boundary, and must never be described as one. It
// protects ONE in-process retry chain and nothing else. Nothing here survives
// a process restart, a second worker, or a job that re-drives the send later.
//
// That is deliberate, and it is exactly the scope of the bug it fixes (BLOCKERS
// B5): `lobService.sendLetter` swallows provider errors and reports
// `{ success: false, errorType }` with no way to tell "Lob never got it" from
// "Lob accepted the letter and then the connection died". The second case is
// classified `network_error` → retryable → the recursion below prints a SECOND
// real letter to a real person. The chain is where that happens, and process
// death ends the chain anyway, so an in-chain guard closes the live defect.
//
// The DURABLE boundary is `withOutwardAction` (server/services/actions/
// outwardAction.ts) and it is deliberately NOT used here. It needs two founder
// decisions this interim needs none of (BLOCKERS B5): whether the key is
// `lead:{id}` or `lead:{id}+contentHash`, and whether the boundary fails open or
// closed on its OWN database write. It also requires a key derived from durable
// domain identity — ours is random per chain ON PURPOSE, so it must never be
// written to `outward_actions`.
//
// What IS reused is that boundary's DECISION rather than a second copy of it:
// `classifyExisting` and `requestHash` are pure, exported and DB-free (they are
// exported precisely so the policy is testable without a database), so the
// execute/replay/refuse rule here is the same rule the durable boundary
// applies. Only the STORE differs — a Map that lives for one chain instead of a
// table that lives forever. When B5's two questions are answered, this block is
// replaced by a `withOutwardAction` call, not supplemented by one.

const DIRECT_MAIL_ACTION_KIND = 'physical_mail.letter';

type ChainClaim = {
  actionKind: string;
  idempotencyKey: string;
  requestHash: string;
  status: OutwardActionStatus;
  externalId: string | null;
};

/** Live chains only. Entries are released when the owning chain returns. */
const directMailChainClaims = new Map<string, ChainClaim>();

/**
 * Random ON PURPOSE. `OutwardActionSpec` requires a durable key derived from
 * domain identity; this one must be the opposite, because a deliberate second
 * mailing to the same lead months later has to start a fresh chain and actually
 * send. That is what keeps legitimate repeat mail working unchanged.
 */
function newDirectMailChainKey(organizationId: number, leadId: number): string {
  return `dm-chain:${organizationId}:${leadId}:${randomUUID()}`;
}

/** The durable boundary's own verdict, applied to this chain's in-memory row. */
function directMailChainVerdict(chainKey: string, hash: string): ClaimVerdict {
  const existing = directMailChainClaims.get(chainKey);
  if (!existing) {
    return { verdict: 'execute', reason: 'no prior send attempt in this chain' };
  }
  return classifyExisting(existing, hash);
}

/** Take the claim if the chain permits another send. Returns the verdict. */
function claimDirectMailChainSend(chainKey: string, hash: string): ClaimVerdict {
  const decision = directMailChainVerdict(chainKey, hash);
  if (decision.verdict === 'execute') {
    directMailChainClaims.set(chainKey, {
      actionKind: DIRECT_MAIL_ACTION_KIND,
      idempotencyKey: chainKey,
      requestHash: hash,
      status: 'in_flight',
      externalId: null,
    });
  }
  return decision;
}

function settleDirectMailChainClaim(
  chainKey: string,
  status: OutwardActionStatus,
  externalId: string | null,
): void {
  const existing = directMailChainClaims.get(chainKey);
  if (existing) {
    directMailChainClaims.set(chainKey, { ...existing, status, externalId });
  }
}

function releaseDirectMailChainClaim(chainKey: string): void {
  directMailChainClaims.delete(chainKey);
}

/** Test-only: prove the map does not leak across chains. */
export function __directMailChainClaimCountForTests(): number {
  return directMailChainClaims.size;
}

export class CommunicationsService {
  async getChannelStatus(): Promise<{ email: boolean; sms: boolean; directMail: boolean }> {
    return {
      email: await emailService.isConfigured(),
      sms: smsService.isConfigured(),
      directMail: !!process.env.LOB_API_KEY || !!process.env.LOB_TEST_API_KEY || !!process.env.LOB_LIVE_API_KEY,
    };
  }

  async sendToLead(options: CommunicationOptions): Promise<CommunicationResult> {
    const lead = await storage.getLead(options.organizationId, options.leadId);
    if (!lead) {
      return { success: false, channel: 'none', error: 'Lead not found' };
    }

    const tcpaCheck = checkTcpaConsentFromLead(lead);
    
    if (tcpaCheck.blocked) {
      logger.info(`[Communications] All communications blocked for lead ${options.leadId}: ${tcpaCheck.reason}`);
      return { 
        success: false, 
        channel: 'none', 
        error: tcpaCheck.reason,
        tcpaBlocked: true,
      };
    }

    // Contact-frequency cap (2026-07-29). Every send from this service is
    // outreach TO A LEAD — marketing class — so the fatigue detector's
    // `suppress` verdict applies here exactly as it does at the SMS choke
    // point. This is an ADDITIONAL refusal layered after the consent check
    // above; SMS re-evaluates the full consent → quiet-hours → DNC →
    // frequency chain inside sendOrgSMS, so nothing here can bypass it.
    const frequency = await frequencyGateForLead(options.organizationId, options.leadId);
    if (!frequency.allowed) {
      const reason = describeFrequencySkip(frequency);
      logger.warn('[Communications] Send refused by contact-frequency cap', {
        metadata: { leadId: options.leadId, organizationId: options.organizationId, reason },
      });
      return {
        success: false,
        channel: options.channel ?? 'none',
        error: reason,
        frequencyCapped: true,
      };
    }

    const channel = options.channel || this.determinePreferredChannel(lead);

    const channelCheck = canSendViaChannel(lead, channel === 'both' ? 'email' : channel);
    
    if (channel === 'sms') {
      const smsCheck = canSendViaChannel(lead, 'sms');
      if (!smsCheck.allowed) {
        logger.info(`[Communications] SMS blocked for lead ${options.leadId}: ${smsCheck.reason}`);
        return { 
          success: false, 
          channel: 'sms', 
          error: smsCheck.reason,
          tcpaBlocked: true,
        };
      }
    }

    let emailResult: CommunicationResult | null = null;
    let smsResult: CommunicationResult | null = null;

    if (channel === 'email' || channel === 'both') {
      const emailCheck = canSendViaChannel(lead, 'email');
      if (emailCheck.allowed && lead.email) {
        const result = await emailService.sendEmail({
          to: lead.email,
          subject: options.subject || 'Message from AcreOS',
          html: `<p>${options.message}</p>`,
          // Deal mail: must carry the org's own identity (this call previously
          // omitted organizationId entirely, so lead outreach silently went
          // out as platform @acreos.io — the exact leak the counterparty
          // enforcement closes).
          organizationId: options.organizationId,
          purpose: 'counterparty',
        });

        if (result.success) {
          await this.recordCommunication(options.leadId, options.organizationId, 'email', {
            subject: options.subject,
            messageId: result.messageId,
          });
        }

        emailResult = { 
          success: result.success, 
          channel: 'email', 
          messageId: result.messageId, 
          error: result.error 
        };

        if (channel === 'email') {
          return emailResult;
        }
      } else if (!emailCheck.allowed) {
        emailResult = { 
          success: false, 
          channel: 'email', 
          error: emailCheck.reason,
          tcpaBlocked: true,
        };
        if (channel === 'email') {
          return emailResult;
        }
      }
    }

    if (channel === 'sms' || channel === 'both') {
      const smsCheck = canSendViaChannel(lead, 'sms');
      if (!smsCheck.allowed) {
        logger.info(`[Communications] SMS blocked for lead ${options.leadId}: ${smsCheck.reason}`);
        smsResult = { 
          success: false, 
          channel: 'sms', 
          error: smsCheck.reason,
          tcpaBlocked: true,
        };
      } else if (lead.phone) {
        // Route through the ORG-SCOPED choke point rather than the raw
        // sender: sendOrgSMS applies consent → recipient-local quiet hours →
        // DNC → contact-frequency in that order, and records the contact
        // touch itself on success (which is why recordCommunication is not
        // called again here — one send must produce exactly one touch row).
        const { sendOrgSMS } = await import('./smsService');
        const result = await sendOrgSMS(options.organizationId, lead.phone, options.message);

        smsResult = {
          success: result.success, 
          channel: 'sms', 
          messageId: result.messageId, 
          error: result.error 
        };
      }
      
      if (smsResult) {
        return smsResult;
      }
    }

    if (emailResult) {
      return emailResult;
    }

    return { success: false, channel: 'none', error: 'No valid contact method available' };
  }

  private determinePreferredChannel(lead: { email?: string | null; phone?: string | null; tcpaConsent?: boolean | null }): 'email' | 'sms' {
    // Prefer email if available, SMS as fallback for TCPA-consented leads
    if (lead.email) return 'email';
    if (lead.phone && smsService.isConfigured() && lead.tcpaConsent) return 'sms';
    return 'email';
  }

  async recordCommunication(
    leadId: number,
    organizationId: number,
    type: string,
    metadata: Record<string, any>
  ): Promise<void> {
    try {
      await storage.createLeadActivity({
        organizationId,
        leadId,
        type: `communication_${type}`,
        description: `${type.toUpperCase()} sent`,
        metadata,
      });
    } catch (error) {
      logger.error('[Communications] Error recording activity', error);
    }
  }

  async sendCampaign(
    campaignId: number,
    organizationId: number,
    leadIds: number[],
    channel: 'email' | 'sms',
    content: { subject?: string; message: string }
  ): Promise<{ sent: number; failed: number; tcpaBlocked: number; frequencyCapped: number; errors: string[] }> {
    let sent = 0;
    let failed = 0;
    let tcpaBlocked = 0;
    // Counted separately from `failed`: nothing broke — the send was refused
    // because the lead has already been contacted too often.
    let frequencyCapped = 0;
    const errors: string[] = [];

    for (const leadId of leadIds) {
      const tcpaCheck = await checkTcpaConsent(leadId, organizationId);
      
      if (tcpaCheck.blocked) {
        tcpaBlocked++;
        errors.push(`Lead ${leadId}: ${tcpaCheck.reason}`);
        continue;
      }

      if (channel === 'sms' && !tcpaCheck.canSms) {
        tcpaBlocked++;
        errors.push(`Lead ${leadId}: TCPA consent required for SMS`);
        continue;
      }

      const result = await this.sendToLead({
        leadId,
        organizationId,
        channel,
        subject: content.subject,
        message: content.message,
      });

      if (result.success) {
        sent++;
      } else {
        if (result.tcpaBlocked) {
          tcpaBlocked++;
        } else if (result.frequencyCapped) {
          frequencyCapped++;
        } else {
          failed++;
        }
        if (result.error) {
          errors.push(`Lead ${leadId}: ${result.error}`);
        }
      }
    }

    return { sent, failed, tcpaBlocked, frequencyCapped, errors };
  }

  async sendDirectMailToLead(
    leadId: number,
    organizationId: number,
    content: DirectMailContent
  ): Promise<CommunicationResult> {
    const lead = await storage.getLead(organizationId, leadId);
    if (!lead) {
      return { success: false, channel: 'direct_mail', error: 'Lead not found' };
    }

    const channelCheck = canSendViaChannel(lead, 'direct_mail');
    if (!channelCheck.allowed) {
      logger.info(`[Communications] Direct mail blocked for lead ${leadId}: ${channelCheck.reason}`);
      return { 
        success: false, 
        channel: 'direct_mail', 
        error: channelCheck.reason,
        tcpaBlocked: true,
      };
    }

    if (!lead.address || !lead.city || !lead.state || !lead.zip) {
      return { 
        success: false, 
        channel: 'direct_mail', 
        error: 'Incomplete address for direct mail' 
      };
    }

    if (!lobService.isConfigured()) {
      logger.error('[Communications] Lob service not configured - LOB_TEST_API_KEY or LOB_LIVE_API_KEY required');
      return {
        success: false,
        channel: 'direct_mail',
        error: 'Direct mail service not configured',
      };
    }

    const result = await this.sendDirectMailWithRetry(leadId, organizationId, {
      firstName: lead.firstName,
      lastName: lead.lastName,
      address: lead.address,
      city: lead.city,
      state: lead.state,
      zip: lead.zip,
    }, content);
    return result;
  }

  async sendDirectMailWithRetry(
    leadId: number,
    organizationId: number,
    lead: { firstName: string; lastName: string; address: string; city: string; state: string; zip: string },
    content: DirectMailContent,
    attempt: number = 0,
    chainKey?: string
  ): Promise<CommunicationResult> {
    // B5 interim: ONE key per chain, minted before the first attempt and
    // threaded through every recursion below, so all retries of one logical
    // send share it. A caller entering without a key OWNS the chain and
    // releases it on the way out — the guard exists for the chain's lifetime
    // and not one instruction longer. A later deliberate re-send enters here
    // with no key again, mints a new one, and sends normally.
    if (chainKey === undefined) {
      const ownedKey = newDirectMailChainKey(organizationId, leadId);
      try {
        return await this.sendDirectMailWithRetry(leadId, organizationId, lead, content, attempt, ownedKey);
      } finally {
        releaseDirectMailChainClaim(ownedKey);
      }
    }

    const org = await storage.getOrganization(organizationId);
    const mailMode = org?.settings?.mailMode === 'live' ? 'live' : 'test';

    // Require real return address — never send mail with a fake fallback address
    const settings = org?.settings as any || {};
    if (!settings.companyAddress || !settings.companyCity || !settings.companyState || !settings.companyZip) {
      return { success: false, channel: 'mail', error: "Return address not configured. Set your company address in Settings before sending direct mail." };
    }
    const fromAddress = {
      name: org?.name || 'AcreOS',
      addressLine1: settings.companyAddress,
      city: settings.companyCity,
      state: settings.companyState,
      zip: settings.companyZip,
    };

    const toAddress = {
      name: `${lead.firstName} ${lead.lastName}`,
      addressLine1: lead.address,
      city: lead.city,
      state: lead.state,
      zip: lead.zip,
    };

    logger.info(`[Communications] Sending direct mail to ${toAddress.name} at ${toAddress.addressLine1} (attempt ${attempt + 1}/${MAX_RETRIES})`);

    const letterHtml = content.htmlContent || `
      <html>
        <body>
          <h1>${content.subject}</h1>
          <p>${content.body}</p>
        </body>
      </html>
    `;

    // Everything that materially defines the piece — the same fields the
    // durable boundary hashes for a letter. Within one chain this is identical
    // on every attempt, so the hash is stable; threading a key across DIFFERENT
    // content is a caller bug and `classifyExisting` refuses it.
    const sendPayload = {
      to: toAddress,
      from: fromAddress,
      file: letterHtml,
      color: false,
      doubleSided: false,
      mode: mailMode,
    };
    const sendHash = requestHash(sendPayload);

    // Claim BEFORE contacting the provider, exactly as the durable boundary
    // does. If this chain has already reached Lob, we cannot prove the letter
    // did not print, so we refuse rather than guess with the org's money.
    const claim = claimDirectMailChainSend(chainKey, sendHash);
    if (claim.verdict !== 'execute') {
      logger.error(`[Communications] Duplicate direct mail send suppressed for lead ${leadId}`, undefined, { metadata: { detail: {
        leadId,
        organizationId,
        chainKey,
        attempt: attempt + 1,
        reason: claim.reason,
      } } });
      return {
        success: false,
        channel: 'direct_mail',
        error: `Duplicate direct mail send suppressed: ${claim.reason}`,
      };
    }

    const lobResult = await lobService.sendLetter(
      {
        to: toAddress,
        from: fromAddress,
        file: letterHtml,
        color: false,
        doubleSided: false,
      },
      mailMode
    );

    if (lobResult.success) {
      settleDirectMailChainClaim(chainKey, 'succeeded', lobResult.lobMailingId ?? null);
      logger.info(`[Communications] Direct mail sent successfully to lead ${leadId}, lob_mailing_id: ${lobResult.lobMailingId}`);

      await this.recordCommunication(leadId, organizationId, 'direct_mail', {
        subject: content.subject,
        address: lead.address,
        lob_mailing_id: lobResult.lobMailingId,
        expected_delivery_date: lobResult.expectedDeliveryDate,
        is_test_mode: lobResult.isTestMode,
      });

      return {
        success: true,
        channel: 'direct_mail',
        lobMailingId: lobResult.lobMailingId,
        expectedDeliveryDate: lobResult.expectedDeliveryDate,
      };
    }

    // The call did not succeed and `lobService` cannot tell us whether the
    // request ever reached Lob — it catches the provider error internally and
    // hands back a classified string. AMBIGUOUS is therefore the only honest
    // record, and it is the same polarity the durable boundary uses: only code
    // that PROVES it never contacted the provider may claim `failed`
    // (`ProviderNotContactedError`), and nothing on this path can prove that.
    settleDirectMailChainClaim(chainKey, 'ambiguous', null);

    logger.error(`[Communications] Direct mail failed for lead ${leadId}`, undefined, { metadata: { detail: {
      attempt: attempt + 1,
      errorType: lobResult.errorType,
      error: lobResult.error,
    } } });

    const isRetryable = !!lobResult.errorType && lobService.isRetryableError(lobResult.errorType);
    const budgetRemains = attempt < MAX_RETRIES - 1;
    // `isRetryableError` answers "was this transient?", which is NOT the
    // question "did the letter already print?". A network timeout is both
    // transient and possibly post-acceptance — conflating the two is the whole
    // of B5. So the CLAIM, not the error type, decides whether we may send
    // again; the error type only decides whether it would be worth it.
    const chainPermitsAnotherSend = directMailChainVerdict(chainKey, sendHash).verdict === 'execute';

    if (isRetryable && budgetRemains && chainPermitsAnotherSend) {
      const delay = RETRY_DELAYS[attempt];
      logger.info(`[Communications] Retrying direct mail for lead ${leadId} in ${delay}ms (attempt ${attempt + 2}/${MAX_RETRIES})`);

      await new Promise(resolve => setTimeout(resolve, delay));
      return this.sendDirectMailWithRetry(leadId, organizationId, lead, content, attempt + 1, chainKey);
    }

    if (isRetryable && budgetRemains && !chainPermitsAnotherSend) {
      logger.warn(`[Communications] Direct mail retry suppressed for lead ${leadId} — a prior attempt in this chain may already have printed`, { metadata: {
        leadId,
        organizationId,
        chainKey,
        attemptsMade: attempt + 1,
        errorType: lobResult.errorType,
      } });
    }

    // We are not sending again on this chain — whatever the reason. Surface it
    // once, here. (The old condition could fall through both branches and end
    // the send with no alert at all when `errorType` was absent.)
    await this.handleDirectMailFailure(
      leadId,
      organizationId,
      lead,
      content,
      lobResult.errorType,
      lobResult.error,
      attempt + 1,
    );

    return {
      success: false,
      channel: 'direct_mail',
      error: lobResult.error,
      errorType: lobResult.errorType,
      retriesExhausted: attempt >= MAX_RETRIES - 1,
    };
  }

  private async handleDirectMailFailure(
    leadId: number,
    organizationId: number,
    lead: { firstName: string; lastName: string; address: string },
    content: DirectMailContent,
    errorType?: LobErrorType,
    errorMessage?: string,
    attemptsMade: number = MAX_RETRIES
  ): Promise<void> {
    logger.error(`[Communications] Direct mail send failed for lead ${leadId} after ${attemptsMade} attempt(s)`, undefined, { metadata: { detail: {
      leadId,
      organizationId,
      attemptsMade,
      errorType,
      errorMessage,
      recipient: `${lead.firstName} ${lead.lastName}`,
      address: lead.address,
    } } });

    // B6 (BLOCKERS): this path used to `apiQueueService.enqueue('lob',
    // 'sendLetter', …)`. `apiQueue.executeJob` implements only `sendPostcard`
    // for `type === 'lob'` and throws on anything else, so every one of those
    // jobs burned its retries and settled in `failed`, permanently. The enqueue
    // promised a recovery that could not happen; the system alert below was
    // doing all the real work. Removing it makes the failure no quieter — the
    // alert and the error log above are the surface, and they stay.
    //
    // REINSTATE ONLY IN THIS ORDER: (1) inspect the existing `api_jobs` backlog
    // for `type='lob'` rows and decide whether stale ones should still print —
    // implementing the operation first would make dormant jobs mail physical
    // letters on the next deploy; (2) implement the operation in
    // `apiQueue.executeJob` WITH the outward-action boundary keyed on `job.id`,
    // which is the natural durable key because the queue retries that exact
    // row; (3) only then enqueue from here again.

    try {
      await storage.createSystemAlert({
        type: 'direct_mail_failure',
        alertType: 'system_error',
        severity: errorType === 'insufficient_funds' ? 'critical' : 'warning',
        title: 'Direct Mail Send Failed',
        message: `Failed to send direct mail to ${lead.firstName} ${lead.lastName} after ${attemptsMade} attempt(s). Error: ${errorMessage || 'Unknown error'}`,
        organizationId,
        relatedEntityType: 'lead',
        relatedEntityId: leadId,
        status: 'new',
        metadata: {
          leadId,
          recipientName: `${lead.firstName} ${lead.lastName}`,
          recipientAddress: lead.address,
          errorType,
          errorMessage,
          subject: content.subject,
          // The real count, not the ceiling: the chain can stop before
          // MAX_RETRIES when a duplicate send is suppressed, and reporting
          // three attempts when one was made would be a fabricated number.
          attemptsMade,
        },
      });
      logger.info(`[Communications] System alert created for direct mail failure to lead ${leadId}`);
    } catch (alertError) {
      logger.error('[Communications] Failed to create system alert', undefined, { metadata: { detail: alertError } });
    }
  }
}

export const communicationsService = new CommunicationsService();

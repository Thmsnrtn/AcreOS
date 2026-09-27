/**
 * SMS service — THIN SHIM over the CommsRouter (Pillar 5).
 *
 * Original file (582 LOC) was a Twilio-only sender. Pillar 5 introduced a
 * provider-pluggable router (`server/services/comms/router.ts`) plus a
 * Twilio adapter. This file now exposes the same public surface every
 * existing caller relies on, but delegates the actual carrier work to
 * `commsRouter`.
 *
 * Preserved API:
 *   - `smsService` singleton: .isConfigured() / .sendSMS(...) /
 *     .sendBulkSMS(...) / .getDeliveryStatus(...)
 *   - sendOrgSMS / sendSMSToLead / handleIncomingSMS
 *   - checkTwilioConfiguration / saveTwilioCredentials
 *
 * Preserved behaviour:
 *   - Simulation mode still short-circuits sends (handled inside the
 *     Twilio adapter so all paths agree)
 *   - BYOK Twilio creds still resolved from organizationIntegrations
 *     when `organizationId` is supplied (handled inside the adapter)
 *   - Pillar 1.6 ledger post on successful send still fires per
 *     organization-scoped send
 *   - STOP-keyword TCPA handling unchanged
 *   - Twilio webhook-replay idempotency unchanged
 */
import { db } from "../db";
import { storage } from "../storage";
import {
  frequencyGateForLead,
  describeFrequencySkip,
  recordContactTouch,
} from "./compliance/contactFrequency";
import {
  messages,
  conversations,
  leads,
  organizationIntegrations,
  sequenceEnrollments,
  activityLog,
} from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { logger } from "../utils/logger";
import { wsServer } from "../websocket";
import { commsRouter, type CommsRouter } from "./comms/router";
import { twilioProvider } from "./comms/providers/twilio";
// Side-effect import: ensures the Telnyx adapter registers itself with
// the router even though no caller uses it directly today.
import "./comms/providers/telnyx";

const SMS_STOP_WORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit"]);

/**
 * Pillar 1.6 — per-segment Twilio SMS cost in cents.
 * Twilio currently bills ~$0.0079 per US outbound SMS segment; we round to
 * 1¢ to keep the ledger integer-clean. Override via env if Twilio repriced.
 */
const TWILIO_SMS_COST_CENTS = Number(process.env.TWILIO_SMS_COST_CENTS ?? 1);

/**
 * Best-effort ledger post for a successful Twilio send. Never throws —
 * a ledger-post failure must not break the SMS-send acknowledgement to
 * the caller. Idempotent on the Twilio message sid.
 */
async function postSmsCostToLedger(
  organizationId: number,
  sid: string,
  amountCents: number = TWILIO_SMS_COST_CENTS,
): Promise<void> {
  if (amountCents <= 0 || !sid || sid.startsWith("mock-")) return;
  // Universal BYOK: customer is billed directly by Twilio when they
  // bring their own SID/token. Don't debit our opex bucket.
  try {
    const { isByokEnabled } = await import("./byok/toggle");
    if (await isByokEnabled(organizationId, "twilio")) {
      return;
    }
  } catch {
    /* best-effort */
  }
  try {
    const { postOpexSpent } = await import("./financial-ledger");
    await postOpexSpent({
      organizationId,
      amountCents,
      category: "sms",
      feature: "sms",
      providerName: "twilio",
      providerEventId: sid,
      externalEventId: `twilio:sms:${sid}`,
    });
  } catch (err) {
    logger.warn(
      "[SMS] ledger postOpexSpent failed (non-fatal)",
      err instanceof Error ? err : undefined,
    );
  }
}

export interface SmsOptions {
  to: string;
  message: string;
  from?: string;
  // MMS: when non-empty, Twilio treats this as MMS rather than SMS.
  mediaUrls?: string[];
}

export interface SmsResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Class-style API preserved verbatim. Internally the work is delegated
 * to the router; tests can swap a custom CommsRouter into the
 * constructor.
 */
export class SmsService {
  constructor(private readonly router: CommsRouter = commsRouter) {}

  isConfigured(): boolean {
    // Historically derived from process.env Twilio creds. Now derived
    // from the Twilio adapter's same env check so semantics are unchanged.
    return twilioProvider.isConfigured();
  }

  async sendSMS(options: SmsOptions): Promise<SmsResult> {
    try {
      const result = await this.router.route({
        to: options.to,
        from: options.from,
        body: options.message,
        mediaUrls: options.mediaUrls,
        feature: "sms",
      });
      return { success: true, messageId: result.sid };
    } catch (err: any) {
      return { success: false, error: err?.message ?? "send failed" };
    }
  }

  async sendBulkSMS(messages: SmsOptions[]): Promise<SmsResult[]> {
    const results: SmsResult[] = [];
    for (const msg of messages) {
      results.push(await this.sendSMS(msg));
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return results;
  }

  /**
   * Twilio-specific status check kept here because no other provider
   * needs it yet. When Telnyx activates, this moves into a provider
   * method on the CommsProvider interface.
   */
  async getDeliveryStatus(
    messageId: string,
  ): Promise<"pending" | "delivered" | "failed" | "unknown"> {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) return "unknown";
    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages/${messageId}.json`;
      const auth = Buffer.from(`${sid}:${token}`).toString("base64");
      const response = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
      if (response.ok) {
        const data: any = await response.json();
        if (data.status === "delivered") return "delivered";
        if (data.status === "failed" || data.status === "undelivered") return "failed";
        return "pending";
      }
    } catch (error) {
      logger.error("[SMS] Error checking status", error);
    }
    return "unknown";
  }
}

export const smsService = new SmsService();

/**
 * SMS PURPOSE GATE (DEFECT-0104, founder decision 2026-09-27).
 *
 * The consent question this sender must answer depends on WHY the text is
 * being sent, so the caller declares a purpose and the gate asks the
 * question that purpose needs. The previous gate inferred the class from
 * whether the destination matched a lead: "no lead = transactional", so a
 * number with no CRM row skipped consent, quiet hours and the frequency cap
 * — the exact inversion of what a missing consent record means. Every
 * caller of this function texts a COUNTERPARTY (BYO identity is required
 * below); system SMS never comes through here, so the unmatched branch had
 * no legitimate user.
 *
 *   • prospecting — a solicitation. EVERY lead at this number must carry
 *     express TCPA consent and be outside its quiet hours (two leads sharing
 *     a number with contradictory consent used to resolve by row order);
 *     no lead record → REFUSED, consent cannot be shown. DNC scrub fails
 *     CLOSED on error. The contact-frequency cap applies, and the send is
 *     recorded as a touch after the carrier accepts it.
 *   • servicing — a notice bound to a NOTE. The destination must be the
 *     borrower of record's phone on that note; STOP / do-not-contact and the
 *     borrower's quiet hours still block; the borrower need not carry the
 *     marketing consent flag. DNC scrub fails OPEN on error — a payment
 *     notice is not stopped by a vendor outage. No frequency cap, no touch.
 *   • reply — an answer to a number that texted this organization in the
 *     last 24 hours (matched or unattached). Nothing to reply to → refused;
 *     a lead at the number who has STOPped → refused; quiet hours apply;
 *     DNC fails open. No frequency cap, no touch.
 *
 * Anything UNVERIFIABLE (storage error, missing note) → FAIL CLOSED with a
 * named reason. Refusal strings are prefixed `TCPA gate: ` by the caller's
 * result — sequenceProcessor treats that prefix as a deferral, not a
 * permanent failure.
 */
export type SmsPurpose = "prospecting" | "servicing" | "reply";

export interface SendOrgSmsInput {
  organizationId: number;
  to: string;
  message: string;
  mediaUrls?: string[];
  /** Why this text is being sent — decides which consent question is asked. */
  purpose: SmsPurpose;
  /** Prospecting: the lead the caller believes it is texting. Refused if that lead is not on file at `to`. */
  leadId?: number;
  /** Servicing: the note this notice services. Required for that purpose. */
  noteId?: number;
}

const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

interface PurposeGateVerdict {
  allowed: boolean;
  reason?: string;
  /** The lead a successful send is attributed to (touch ledger, logs). */
  leadId?: number;
  /** Only prospecting sends count toward the contact-frequency cap. */
  recordTouch: boolean;
}

function last10Of(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

async function smsPurposeGate(input: SendOrgSmsInput): Promise<PurposeGateVerdict> {
  const { organizationId, to, purpose } = input;
  const refuse = (reason: string, leadId?: number): PurposeGateVerdict => ({
    allowed: false,
    reason,
    leadId,
    recordTouch: false,
  });
  const last10 = last10Of(to);
  if (last10.length < 7) return refuse("destination is not a dialable phone number");
  try {
    const { dncGateForSms } = await import("./compliance/dncScrub");
    const { tcpaGateForSms, isWithinQuietHours } = await import("./tcpaCompliance");
    switch (purpose) {
      case "prospecting": {
        const matches = await storage.findLeadsByPhoneLast10(organizationId, to);
        if (matches.length === 0) {
          return refuse("no lead record at this number — consent cannot be shown, so a solicitation cannot be sent");
        }
        if (input.leadId !== undefined && !matches.some((l) => l.id === input.leadId)) {
          return refuse(`lead ${input.leadId} is not on file at this number`, input.leadId);
        }
        for (const lead of matches) {
          const consent = await tcpaGateForSms(lead.id, organizationId, to);
          if (!consent.allowed) return refuse(consent.reason ?? "no TCPA consent on record", lead.id);
        }
        // Every lead at the number has express consent, so a DNC listing is
        // lawfully overridden — the scrub's teeth here are the litigator list
        // and the fail-closed error posture.
        const dnc = await dncGateForSms(organizationId, to, { leadMatched: true, hasConsent: true });
        if (!dnc.allowed) return refuse(dnc.reason ?? "DNC gate refused");
        const leadId = input.leadId ?? matches[0].id;
        // LAST: contact-frequency cap — only ever an ADDITIONAL refusal.
        const frequency = await frequencyGateForLead(organizationId, leadId);
        if (!frequency.allowed) return refuse(describeFrequencySkip(frequency), leadId);
        return { allowed: true, leadId, recordTouch: true };
      }
      case "servicing": {
        if (input.noteId === undefined) return refuse("a servicing text must name the note it services");
        const note = await storage.getNote(organizationId, input.noteId);
        if (!note) return refuse(`note ${input.noteId} not found in this organization`);
        const borrower = note.borrowerId ? await storage.getLead(organizationId, note.borrowerId) : undefined;
        if (!borrower?.phone) return refuse(`note ${input.noteId} has no borrower phone on file`);
        if (last10Of(borrower.phone) !== last10) {
          return refuse(`destination is not the borrower of record on note ${input.noteId}`, borrower.id);
        }
        if (borrower.doNotContact) {
          return refuse("borrower has revoked contact (STOP / do-not-contact)", borrower.id);
        }
        const quiet = isWithinQuietHours(to, borrower.timezone ?? null);
        if (quiet.blocked) return refuse(quiet.reason ?? "recipient quiet hours", borrower.id);
        // The note relationship is the lawful basis for an informational
        // text to its borrower; a scrub outage does not stop a payment notice.
        const dnc = await dncGateForSms(organizationId, to, {
          leadMatched: true,
          hasConsent: true,
          scrubErrorPosture: "fail_open",
        });
        if (!dnc.allowed) return refuse(dnc.reason ?? "DNC gate refused", borrower.id);
        return { allowed: true, leadId: borrower.id, recordTouch: false };
      }
      case "reply": {
        const since = new Date(Date.now() - REPLY_WINDOW_MS);
        const inbound = await storage.hasRecentInboundSmsFrom(organizationId, to, since);
        if (!inbound) {
          return refuse("no inbound text from this number in the last 24 hours — a reply needs something to reply to");
        }
        const matches = await storage.findLeadsByPhoneLast10(organizationId, to);
        const stopped = matches.find((l) => l.doNotContact);
        if (stopped) return refuse("recipient has revoked contact (STOP / do-not-contact)", stopped.id);
        const quiet = isWithinQuietHours(to, matches[0]?.timezone ?? null);
        if (quiet.blocked) return refuse(quiet.reason ?? "recipient quiet hours", matches[0]?.id);
        // The recipient texted first — that inbound is the basis for one answer.
        const dnc = await dncGateForSms(organizationId, to, {
          leadMatched: matches.length > 0,
          hasConsent: true,
          scrubErrorPosture: "fail_open",
        });
        if (!dnc.allowed) return refuse(dnc.reason ?? "DNC gate refused");
        return { allowed: true, leadId: input.leadId ?? matches[0]?.id, recordTouch: false };
      }
      default: {
        const unreachable: never = purpose;
        return refuse(`unknown SMS purpose ${String(unreachable)}`);
      }
    }
  } catch (err) {
    logger.error(
      "[SMS] purpose gate could not verify the send — refusing (fail closed)",
      err instanceof Error ? err : undefined,
      { metadata: { organizationId, purpose, noteId: input.noteId } },
    );
    return refuse("consent state unverifiable — refusing to send");
  }
}

/**
 * Org-scoped SMS send. The Twilio adapter handles BYOK credential
 * resolution + sim-mode short-circuit; here we gate by PURPOSE (see above)
 * and post the cost to the financial ledger after a real send succeeds.
 *
 * Once the carrier has returned a SID the message is out; nothing that
 * happens after that line may turn the acknowledgement into a failure.
 */
export async function sendOrgSMS(input: SendOrgSmsInput): Promise<SmsResult> {
  const { organizationId, to, message, mediaUrls, purpose } = input;
  const gate = await smsPurposeGate(input);
  if (!gate.allowed) {
    logger.warn(`[SMS] ${purpose} send blocked by TCPA gate: ${gate.reason}`, {
      metadata: { organizationId, purpose, leadId: gate.leadId, noteId: input.noteId },
    });
    return { success: false, error: `TCPA gate: ${gate.reason}` };
  }
  let sid: string;
  try {
    const result = await commsRouter.route({
      to,
      body: message,
      mediaUrls,
      organizationId,
      feature: "sms",
      // Every sendOrgSMS caller messages a counterparty — this path carries
      // the purpose gate above. Require the org's OWN BYO identity at send
      // time; never fall back to AcreOS's platform Twilio account ("be the
      // rail, not the provider"). This is the real chokepoint the
      // campaign-level pre-loop gate only approximates.
      requireByoIdentity: true,
    });
    sid = result.sid;
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "send failed" };
  }
  // The carrier accepted the message. Bookkeeping below is best-effort:
  // Pillar 1.6 opex post, and — for prospecting only — the contact-frequency
  // touch, recorded ONLY now so a refused or failed send can never inflate a
  // lead's touch count.
  try {
    await postSmsCostToLedger(organizationId, sid);
    if (gate.recordTouch && gate.leadId) {
      await recordContactTouch({
        organizationId,
        leadId: gate.leadId,
        channel: "sms",
        messageId: sid,
      });
    }
  } catch (err) {
    logger.error(
      "[SMS] post-send bookkeeping failed after the carrier accepted the message — reporting the send as it happened",
      err instanceof Error ? err : undefined,
      { metadata: { organizationId, sid, purpose } },
    );
  }
  return { success: true, messageId: sid };
}

/**
 * Does the org have its OWN connected (BYO) SMS identity? Counterparty send
 * paths (campaign SMS) must refuse rather than fall back to AcreOS's platform
 * Twilio account — "be the rail, not the provider" (founder ruling 2026-07-29).
 * The platform account is system-mail only.
 */
export async function orgHasConnectedSmsIdentity(organizationId: number): Promise<boolean> {
  const { orgHasByoTwilio } = await import("./comms/providers/twilio");
  return orgHasByoTwilio(organizationId);
}

export async function sendSMSToLead(
  organizationId: number,
  leadId: number,
  messageContent: string,
  _userId: string,
  opts: { purpose: SmsPurpose; noteId?: number },
): Promise<SmsResult & { conversationId?: number; dbMessageId?: number }> {
  const [lead] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.organizationId, organizationId), eq(leads.id, leadId)))
    .limit(1);

  if (!lead) return { success: false, error: "Lead not found" };
  if (!lead.phone) return { success: false, error: "Lead has no phone number" };

  const smsResult = await sendOrgSMS({
    organizationId,
    to: lead.phone,
    message: messageContent,
    purpose: opts.purpose,
    leadId,
    noteId: opts.noteId,
  });
  if (!smsResult.success) return smsResult;

  let [existingConversation] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.organizationId, organizationId),
        eq(conversations.leadId, leadId),
        eq(conversations.channel, "sms"),
      ),
    )
    .orderBy(desc(conversations.lastMessageAt))
    .limit(1);

  if (!existingConversation) {
    const [newConversation] = await db
      .insert(conversations)
      .values({
        organizationId,
        leadId,
        channel: "sms",
        status: "active",
        lastMessageAt: new Date(),
      })
      .returning();
    existingConversation = newConversation;
  }

  const [newMessage] = await db
    .insert(messages)
    .values({
      organizationId,
      conversationId: existingConversation.id,
      direction: "outbound",
      sender: "human",
      content: messageContent,
      status: "sent",
      externalId: smsResult.messageId,
    })
    .returning();

  await db
    .update(conversations)
    .set({ lastMessageAt: new Date() })
    .where(eq(conversations.id, existingConversation.id));

  return {
    success: true,
    messageId: smsResult.messageId,
    conversationId: existingConversation.id,
    dbMessageId: newMessage.id,
  };
}

export async function handleIncomingSMS(
  organizationId: number,
  fromPhone: string,
  toPhone: string,
  body: string,
  messageSid: string,
): Promise<{
  success: boolean;
  conversationId?: number;
  dbMessageId?: number;
  leadId?: number;
  /** True when no lead matched — stored as an unattached reply for triage. */
  unmatched?: boolean;
  error?: string;
}> {
  const cleanPhone = fromPhone.replace(/\D/g, "");
  const last10Digits = cleanPhone.slice(-10);

  // ── TCPA opt-out: handle STOP keywords immediately ───────────────────────
  // CRITICAL: STOP revocation must (a) set doNotContact=true so ALL channels
  // (email/SMS/direct mail/phone) are suppressed, (b) record consentSource +
  // optOutReason for plaintiff-side discovery, (c) write an immutable
  // activity_log row with the *exact inbound text and MessageSid*. The prior
  // implementation only cleared tcpaConsent — email + direct-mail send paths
  // still saw consent=null & would have shipped. That's a $1500/violation
  // TCPA exposure per lead per mailing.
  const normalizedBody = body.trim().toLowerCase();
  if (SMS_STOP_WORDS.has(normalizedBody)) {
    // EVERY lead at this number, soft-deleted rows included — a revocation
    // must land on any row that could ever be restored (DEFECT-0104).
    const matchingLeads = await storage.findLeadsByPhoneLast10(organizationId, fromPhone, {
      includeDeleted: true,
    });
    const now = new Date();
    for (const lead of matchingLeads) {
      await db
        .update(leads)
        .set({
          tcpaConsent: false,
          doNotContact: true, // suppress ALL channels — TCPA revocation is global
          optOutDate: now,
          optOutReason: `SMS STOP keyword: "${body.trim()}" (MessageSid ${messageSid})`,
          updatedAt: now,
        })
        .where(and(eq(leads.id, lead.id), eq(leads.organizationId, organizationId)));
      await db
        .update(sequenceEnrollments)
        .set({ status: "cancelled", completedAt: now })
        .where(
          and(eq(sequenceEnrollments.leadId, lead.id), eq(sequenceEnrollments.status, "active")),
        );
      // Immutable revocation audit-trail row. This is the exhibit a plaintiff's
      // expert (i.e. me) will subpoena. Capture channel + verbatim inbound text
      // + Twilio SID + recipient + timestamp. Never edit/delete these rows.
      try {
        await db.insert(activityLog).values({
          organizationId,
          entityType: "lead",
          entityId: lead.id,
          action: "tcpa_opt_out",
          description: `Lead opted out via SMS STOP keyword "${body.trim()}"`,
          metadata: {
            channel: "sms",
            keyword: normalizedBody,
            inboundText: body, // verbatim — never sanitize
            messageSid,
            fromPhone,
            toPhone,
            receivedAt: now.toISOString(),
            revokedChannels: ["sms", "email", "direct_mail", "phone"],
          },
        });
      } catch (err: any) {
        // Audit log failure must surface — but the consent revocation itself
        // already landed in `leads`, which is what protects us in court.
        logger.error("[SMS] activity_log write failed for STOP revocation", err, {
          metadata: { leadId: lead.id, messageSid },
        });
      }
      // Append-only consent-event row in lead_consent_events. This is the
      // table sized for trial-grade discovery; activityLog above is the
      // operational mirror.
      try {
        const { recordConsentRevoked } = await import("./consentEvents");
        await recordConsentRevoked({
          organizationId,
          leadId: lead.id,
          channels: ["sms", "email", "phone", "direct_mail"],
          source: "inbound_stop",
          inboundMessageText: body,
          inboundMessageSid: messageSid,
          inboundFromPhone: fromPhone,
          recordedBy: "twilio_webhook",
          metadata: { toPhone, keyword: normalizedBody, receivedAt: now.toISOString() },
        });
      } catch {
        /* best-effort — activity_log above already captured the event */
      }
      try {
        const { handleDomainEvent } = await import("./paxNudges");
        await handleDomainEvent({
          organizationId,
          eventType: "lead.opted_out",
          payload: {
            leadId: lead.id,
            leadName: lead.firstName
              ? `${lead.firstName} ${lead.lastName ?? ""}`.trim()
              : lead.email ?? fromPhone,
          },
        });
      } catch {}
    }
    // Hands roadmap P0.2 — feed the autopilot perception bus so the brain
    // perceives outbound-suppression pressure (best-effort, non-PII: count + org).
    if (matchingLeads.length > 0) {
      try {
        const { recordSense } = await import("./autopilot/perception");
        void recordSense("sms_opt_out", matchingLeads.length, { organizationId });
      } catch {
        /* perception is best-effort */
      }
    }
    logger.info(
      `[SMS] STOP received from ${fromPhone} — opted out ${matchingLeads.length} lead(s) across all channels`,
    );
    return { success: true, leadId: matchingLeads[0]?.id };
  }
  // ─────────────────────────────────────────────────────────────────────────

  // Pillar 5: bump the tracking-number assignment's last-inbound timestamp
  // so the auto-release sweeper sees the number is still active.
  // Non-fatal — old hand-assigned numbers won't have a row here.
  try {
    const { attributeInbound } = await import("./comms/tracking-pool");
    await attributeInbound(toPhone, fromPhone, new Date());
  } catch (err: any) {
    logger.warn("[SMS] tracking-pool attribution failed (non-fatal)", {
      metadata: { error: err?.message },
    });
  }

  const allLeads = await db.select().from(leads).where(eq(leads.organizationId, organizationId));

  const matchedLead = allLeads.find((l) => {
    const leadPhone = l.phone?.replace(/\D/g, "") || "";
    if (leadPhone.length < 7) return false;
    const leadLast10 = leadPhone.slice(-10);
    return (
      leadLast10 === last10Digits ||
      leadPhone.includes(last10Digits) ||
      last10Digits.includes(leadLast10)
    );
  });

  const leadId = matchedLead?.id;

  let existingConversation: typeof conversations.$inferSelect | undefined;

  if (leadId) {
    const convos = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.organizationId, organizationId),
          eq(conversations.leadId, leadId),
          eq(conversations.channel, "sms"),
        ),
      )
      .orderBy(desc(conversations.lastMessageAt))
      .limit(1);
    existingConversation = convos[0];
  }

  if (!existingConversation && leadId) {
    const [newConversation] = await db
      .insert(conversations)
      .values({
        organizationId,
        leadId,
        channel: "sms",
        status: "active",
        lastMessageAt: new Date(),
      })
      .returning();
    existingConversation = newConversation;
  }

  if (!existingConversation) {
    // Roadmap W1.4: an unmatched inbound used to be logged and DISCARDED —
    // a seller replying from a spouse's phone or a number skip-tracing never
    // returned was a hot response, lost. Persist it for Inbox triage
    // (attach-to-lead / create-lead), replay-deduped on the MessageSid.
    try {
      const { unattachedInboundMessages } = await import("@shared/schema/unattached-inbound");
      await db
        .insert(unattachedInboundMessages)
        .values({
          organizationId,
          channel: "sms",
          fromAddress: fromPhone,
          toAddress: toPhone,
          body,
          externalId: messageSid,
        })
        // The dedup index is PARTIAL (… WHERE external_id IS NOT NULL,
        // migration 0190). Postgres only matches ON CONFLICT to a partial
        // index when the statement carries the same predicate — without it
        // this insert throws 42P10 and the hot unattached reply is DROPPED.
        // Caught by tests/e2e-mobile/wedge-journey.spec.ts, 2026-07-07.
        .onConflictDoNothing({
          target: unattachedInboundMessages.externalId,
          where: sql`external_id IS NOT NULL`,
        });
      logger.info(
        `[SMS] Inbound from ${fromPhone} matched no lead in org ${organizationId} — stored as unattached reply for triage.`,
      );
      return { success: true, unmatched: true };
    } catch (err) {
      logger.error(
        "[SMS] failed to store unattached inbound message",
        err instanceof Error ? err : undefined,
      );
      return {
        success: false,
        error: `No matching lead found for phone number ${fromPhone}, and the unattached-reply store failed.`,
      };
    }
  }

  // Webhook-replay defense: partial unique index on (external_id) makes
  // replayed Twilio webhooks idempotent. ON CONFLICT DO NOTHING +
  // .returning() yields an empty array on conflict.
  const insertedRows = await db
    .insert(messages)
    .values({
      organizationId,
      conversationId: existingConversation.id,
      direction: "inbound",
      sender: "lead",
      content: body,
      status: "received",
      externalId: messageSid,
    })
    // messages_external_id_unique is a PARTIAL index (… WHERE external_id
    // IS NOT NULL, migration 0034). ON CONFLICT must repeat the predicate or
    // Postgres rejects the statement (42P10) — which made EVERY matched
    // inbound seller SMS throw, get caught upstream, and vanish while the
    // webhook still returned 200 to Twilio. The dominant seller-reply
    // channel was silently dead. Caught by the wedge-journey E2E, 2026-07-07.
    .onConflictDoNothing({
      target: messages.externalId,
      where: sql`external_id IS NOT NULL`,
    })
    .returning();

  const newMessage = insertedRows[0];
  const isReplay = !newMessage;

  if (isReplay) {
    logger.warn(`[SMS] Duplicate Twilio MessageSid ${messageSid} — webhook replay ignored`);
    return { success: true, conversationId: existingConversation.id, leadId };
  }

  await db
    .update(conversations)
    .set({ lastMessageAt: new Date(), status: "active" })
    .where(eq(conversations.id, existingConversation.id));

  // Cohesion Wave-1: nudge the org's inbox to refetch live so an inbound
  // seller SMS surfaces in the unified inbox without waiting on the poll.
  // Org-scoped; fail-safe — the message is already persisted above.
  try {
    wsServer.broadcastToOrg(organizationId, "inbox.unread", { channel: "sms" });
  } catch (err) {
    logger.error(
      "[SMS] failed to publish inbox.unread over WebSocket (poll fallback remains)",
      err instanceof Error ? err : undefined,
    );
  }

  // Roadmap W1.4: the EMAIL inbound path flips the lead to "responded" (the
  // signal Today's priority queue and the funnel read) — SMS, the dominant
  // seller-reply channel, never did. Mirror it exactly.
  if (leadId) {
    try {
      await db
        .update(leads)
        .set({ status: "responded", updatedAt: new Date() })
        .where(and(eq(leads.id, leadId), eq(leads.organizationId, organizationId)));
    } catch (err) {
      logger.warn(
        "[SMS] failed to mark lead responded (message stored fine)",
        err instanceof Error ? err : undefined,
      );
    }
  }

  return {
    success: true,
    conversationId: existingConversation.id,
    dbMessageId: newMessage.id,
    leadId,
  };
}

export async function checkTwilioConfiguration(organizationId: number): Promise<{
  configured: boolean;
  phoneNumber?: string;
  error?: string;
}> {
  const [twilioIntegration] = await db
    .select()
    .from(organizationIntegrations)
    .where(
      and(
        eq(organizationIntegrations.organizationId, organizationId),
        eq(organizationIntegrations.provider, "twilio"),
        eq(organizationIntegrations.isEnabled, true),
      ),
    )
    .limit(1);

  if (!twilioIntegration || !twilioIntegration.credentials) {
    if (twilioProvider.isConfigured()) {
      return { configured: true, phoneNumber: process.env.TWILIO_PHONE_NUMBER };
    }
    return { configured: false, error: "Twilio credentials not configured" };
  }

  const creds = twilioIntegration.credentials as any;
  if (!creds.accountSid || !creds.authToken || !creds.fromPhoneNumber) {
    return { configured: false, error: "Twilio credentials incomplete" };
  }

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}.json`;
    const auth = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64");
    const response = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
    if (response.ok) return { configured: true, phoneNumber: creds.fromPhoneNumber };
    return { configured: false, error: "Invalid Twilio credentials" };
  } catch (error: any) {
    return { configured: false, error: error.message || "Failed to verify credentials" };
  }
}

export async function saveTwilioCredentials(
  organizationId: number,
  accountSid: string,
  authToken: string,
  fromPhoneNumber: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`;
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const response = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
    if (!response.ok) return { success: false, error: "Invalid Twilio credentials" };
  } catch (error: any) {
    return {
      success: false,
      error: "Failed to verify Twilio credentials: " + (error.message || ""),
    };
  }

  const [existing] = await db
    .select()
    .from(organizationIntegrations)
    .where(
      and(
        eq(organizationIntegrations.organizationId, organizationId),
        eq(organizationIntegrations.provider, "twilio"),
      ),
    )
    .limit(1);

  const credentials = { accountSid, authToken, fromPhoneNumber };

  if (existing) {
    await db
      .update(organizationIntegrations)
      .set({
        credentials,
        isEnabled: true,
        lastValidatedAt: new Date(),
        validationError: null,
        updatedAt: new Date(),
      })
      .where(eq(organizationIntegrations.id, existing.id));
  } else {
    await db.insert(organizationIntegrations).values({
      organizationId,
      provider: "twilio",
      isEnabled: true,
      credentials,
      lastValidatedAt: new Date(),
    });
  }

  return { success: true };
}

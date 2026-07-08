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
 * TCPA gate-by-construction (roadmap W1.5, 2026-07 audit). The consent +
 * quiet-hours checks used to live only in CALLERS (sequenceProcessor,
 * communications) — any path that reached this sender directly (manual
 * send, AI tools, the autopilot hand via sendSMSToLead) skipped them
 * entirely. The gate now lives in the sender itself:
 *   • recipient matches a LEAD in the org → full tcpaGateForSms (consent +
 *     recipient-local quiet hours). Blocked → refuse, named reason.
 *   • recipient matches no lead → allowed (customer/transactional traffic
 *     like billing notices isn't seller marketing).
 *   • consent state UNVERIFIABLE (db error) → FAIL CLOSED. A marketing SMS
 *     with unprovable consent is a TCPA violation waiting for a plaintiff;
 *     a delayed transactional SMS retries.
 *   • DNC/litigator scrub (mature-machine H0 §6.1) — layered AFTER the
 *     consent gate at this same choke point. INERT until the founder's
 *     vendor decision configures DNC_SCRUB_PROVIDER; once configured,
 *     litigator numbers block even with consent, DNC-listed numbers block
 *     without express consent, and both traffic classes (lead-matched and
 *     unmatched) get scrubbed. See services/compliance/dncScrub.ts.
 */
async function tcpaGateForRecipient(
  organizationId: number,
  to: string,
): Promise<{ allowed: boolean; reason?: string }> {
  const last10 = to.replace(/\D/g, "").slice(-10);
  if (last10.length < 7) return { allowed: true }; // short codes / malformed — carrier will reject
  try {
    const candidates = await db
      .select({ id: leads.id, phone: leads.phone })
      .from(leads)
      .where(eq(leads.organizationId, organizationId));
    const matched = candidates.find((l) => {
      const leadPhone = l.phone?.replace(/\D/g, "") || "";
      if (leadPhone.length < 7) return false;
      return leadPhone.slice(-10) === last10;
    });
    const { dncGateForSms } = await import("./compliance/dncScrub");
    if (!matched) {
      // Unmatched = transactional class. Scrub still applies when configured
      // (litigator numbers block; scrub errors fail OPEN so billing flows).
      const dnc = await dncGateForSms(organizationId, to, {
        leadMatched: false,
        hasConsent: false,
      });
      if (!dnc.allowed) return { allowed: false, reason: dnc.reason };
      return { allowed: true };
    }
    const { tcpaGateForSms } = await import("./tcpaCompliance");
    const consentGate = await tcpaGateForSms(matched.id, organizationId, to);
    if (!consentGate.allowed) return consentGate;
    // Reaching here means the lead has express consent (canSms requires it),
    // so a DNC listing is lawfully overridden — the scrub's teeth on this
    // path are the litigator list and the fail-closed error posture.
    const dnc = await dncGateForSms(organizationId, to, {
      leadMatched: true,
      hasConsent: true,
    });
    if (!dnc.allowed) return { allowed: false, reason: dnc.reason };
    return { allowed: true };
  } catch (err) {
    logger.error(
      "[SMS] TCPA gate could not verify consent — refusing send (fail closed)",
      err instanceof Error ? err : undefined,
    );
    return { allowed: false, reason: "consent state unverifiable — refusing to send" };
  }
}

/**
 * Org-scoped SMS send. The Twilio adapter handles BYOK credential
 * resolution + sim-mode short-circuit; here we gate for TCPA (see above)
 * and post the cost to the financial ledger after a real send succeeds.
 */
export async function sendOrgSMS(
  organizationId: number,
  to: string,
  message: string,
  mediaUrls?: string[],
): Promise<SmsResult> {
  const gate = await tcpaGateForRecipient(organizationId, to);
  if (!gate.allowed) {
    logger.warn(`[SMS] send to lead blocked by TCPA gate: ${gate.reason}`, {
      metadata: { organizationId },
    });
    return { success: false, error: `TCPA gate: ${gate.reason}` };
  }
  try {
    const result = await commsRouter.route({
      to,
      body: message,
      mediaUrls,
      organizationId,
      feature: "sms",
    });
    // Pillar 1.6 — record opex on successful real send.
    await postSmsCostToLedger(organizationId, result.sid);
    return { success: true, messageId: result.sid };
  } catch (err: any) {
    return { success: false, error: err?.message ?? "send failed" };
  }
}

export async function sendSMSToLead(
  organizationId: number,
  leadId: number,
  messageContent: string,
  _userId: string,
): Promise<SmsResult & { conversationId?: number; dbMessageId?: number }> {
  const [lead] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.organizationId, organizationId), eq(leads.id, leadId)))
    .limit(1);

  if (!lead) return { success: false, error: "Lead not found" };
  if (!lead.phone) return { success: false, error: "Lead has no phone number" };

  const smsResult = await sendOrgSMS(organizationId, lead.phone, messageContent);
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
    const allLeadsInOrg = await db
      .select()
      .from(leads)
      .where(eq(leads.organizationId, organizationId));
    const matchingLeads = allLeadsInOrg.filter((l) => {
      const p = l.phone?.replace(/\D/g, "") || "";
      return p.length >= 7 && (p.slice(-10) === last10Digits || p.includes(last10Digits));
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
        .where(eq(leads.id, lead.id));
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

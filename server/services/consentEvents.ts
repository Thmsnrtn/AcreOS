/**
 * TCPA / CAN-SPAM consent-event recorder.
 *
 * Append-only writes into `lead_consent_events`. Every grant or revocation
 * of consent on any channel calls one of these helpers. Plaintiff-side
 * experts will use this table as the primary evidence chain.
 *
 * Rules:
 *   - NEVER UPDATE or DELETE rows from this table at runtime.
 *   - Always pass through the verbatim disclosure text / inbound text —
 *     do NOT sanitize or truncate.
 *   - Best-effort: a failed insert MUST not break the user-facing flow.
 *     We log it loudly, but the consent state already lives on
 *     `leads.tcpaConsent` / `leads.doNotContact`, which is what protects
 *     the immediate send.
 */

import { db } from "../db";
import { leadConsentEvents, type NewLeadConsentEvent } from "@shared/schema";
import { logger } from "../utils/logger";

export type ConsentChannel = "sms" | "email" | "phone" | "direct_mail";
export type ConsentSource =
  | "website"
  | "phone_ivr"
  | "written"
  | "sms_double_optin"
  | "inbound_stop"
  | "admin_manual";

/**
 * The channels a TCPA consent grant (`leads.tcpaConsent = true`) covers:
 * consent to be TEXTED or CALLED (47 U.S.C. § 227). Email runs on the
 * CAN-SPAM opt-out model and direct mail needs no consent (founder decision
 * 2026-10-20 #2; `requiresTcpaConsent` in tcpaCompliance.ts, which this set
 * is pinned equal to by test). A writer whose only evidence is that one
 * boolean records a grant for these channels and no others: a grant row for
 * email or direct mail would claim consent that was never captured.
 */
export const TCPA_CONSENT_CHANNELS: readonly ConsentChannel[] = ["sms", "phone"];

export interface GrantConsentArgs {
  organizationId: number;
  leadId: number;
  /**
   * Every channel this grant actually covers. One `lead_consent_events` row
   * is written PER CHANNEL (founder decision 2026-10-29: per-channel grant
   * rows), all from the same args, so each row names exactly one channel
   * and the rows of one grant share their source and evidence.
   */
  channels: readonly ConsentChannel[];
  source: ConsentSource;
  consentText?: string | null;
  checkboxChecked?: boolean | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  pageUrl?: string | null;
  recordedBy?: string | null;
  importBatchId?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Grant rows are per channel: a grant naming N channels writes N rows in one
 * INSERT (one statement, so they share `created_at` and land or fail
 * together), each carrying `channels: [thatChannel]`. A bundled grant row —
 * one row claiming several channels — cannot be written through here.
 * Historical bundled rows are evidence and are never rewritten.
 */
function grantRowsFor(args: GrantConsentArgs): NewLeadConsentEvent[] {
  const channels = Array.from(new Set(args.channels));
  return channels.map((channel) => ({
    organizationId: args.organizationId,
    leadId: args.leadId,
    eventType: "granted",
    channels: [channel],
    source: args.source,
    consentText: args.consentText ?? null,
    checkboxChecked: args.checkboxChecked ?? null,
    ipAddress: args.ipAddress ?? null,
    userAgent: args.userAgent ?? null,
    pageUrl: args.pageUrl ?? null,
    recordedBy: args.recordedBy ?? null,
    importBatchId: args.importBatchId ?? null,
    metadata: (args.metadata as any) ?? null,
  }));
}

export async function recordConsentGranted(args: GrantConsentArgs): Promise<void> {
  const rows = grantRowsFor(args);
  if (rows.length === 0) {
    // A grant of no channel is no grant: nothing to evidence.
    logger.warn("[consentEvents] grant with no channels — nothing recorded", {
      metadata: { leadId: args.leadId, source: args.source },
    });
    return;
  }
  try {
    await db.insert(leadConsentEvents).values(rows);
  } catch (err: any) {
    logger.error("[consentEvents] grant insert failed", err, {
      metadata: { leadId: args.leadId, source: args.source },
    });
  }
}

export interface RevokeConsentArgs {
  organizationId: number;
  leadId: number;
  channels: ConsentChannel[]; // For SMS STOP this is ALL four channels.
  source: ConsentSource;
  inboundMessageText?: string | null;
  inboundMessageSid?: string | null;
  inboundFromPhone?: string | null;
  recordedBy?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function recordConsentRevoked(args: RevokeConsentArgs): Promise<void> {
  try {
    await db.insert(leadConsentEvents).values({
      organizationId: args.organizationId,
      leadId: args.leadId,
      eventType: "revoked",
      channels: args.channels,
      source: args.source,
      inboundMessageText: args.inboundMessageText ?? null,
      inboundMessageSid: args.inboundMessageSid ?? null,
      inboundFromPhone: args.inboundFromPhone ?? null,
      recordedBy: args.recordedBy ?? null,
      metadata: (args.metadata as any) ?? null,
    });
  } catch (err: any) {
    logger.error("[consentEvents] revoke insert failed", err, {
      metadata: { leadId: args.leadId, source: args.source },
    });
  }
}

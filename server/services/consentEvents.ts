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
import { leadConsentEvents } from "@shared/schema";
import { logger } from "../utils/logger";

export type ConsentChannel = "sms" | "email" | "phone" | "direct_mail";
export type ConsentSource =
  | "website"
  | "phone_ivr"
  | "written"
  | "sms_double_optin"
  | "imported"
  | "inbound_stop"
  | "admin_manual";

/**
 * Normalize a raw request-body checkbox value into the evidentiary record.
 *
 * The `lead_consent_events` table is the primary evidence chain a plaintiff's
 * expert will read, so this field must record ONLY what actually happened
 * (INV-TRUTH-1 / no-fabrication): a real boolean when the client sent one, and
 * `null` — "not captured" — when it did not. It must NEVER default an absent
 * value to `true`; inferring "tcpaConsent=true implies the box was checked"
 * manufactures an exhibit that no one observed.
 */
export function normalizeConsentCheckbox(raw: unknown): boolean | null {
  return typeof raw === "boolean" ? raw : null;
}

export interface GrantConsentArgs {
  organizationId: number;
  leadId: number;
  channels: ConsentChannel[];
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

export async function recordConsentGranted(args: GrantConsentArgs): Promise<void> {
  try {
    await db.insert(leadConsentEvents).values({
      organizationId: args.organizationId,
      leadId: args.leadId,
      eventType: "granted",
      channels: args.channels,
      source: args.source,
      consentText: args.consentText ?? null,
      checkboxChecked: args.checkboxChecked ?? null,
      ipAddress: args.ipAddress ?? null,
      userAgent: args.userAgent ?? null,
      pageUrl: args.pageUrl ?? null,
      recordedBy: args.recordedBy ?? null,
      importBatchId: args.importBatchId ?? null,
      metadata: (args.metadata as any) ?? null,
    });
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

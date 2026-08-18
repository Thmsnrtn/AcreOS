/**
 * Founder Autopilot — send_sms hand (Hands roadmap P1.2).
 *
 * Thin adapter over sendSMSToLead. The send itself goes through the comms
 * router (cost-routed Twilio/Telnyx) which posts to the financial ledger; the
 * inbound STOP path already enforces TCPA revocation. This hand adds two
 * defense-in-depth guards BEFORE sending:
 *   1. Consent: refuse if the lead is doNotContact or tcpaConsent=false.
 *   2. Quiet hours: refuse an autonomous SMS outside the recipient's local
 *      8am–9pm window when a timezone offset is known.
 *
 * Sending is keyed by lead_id (not a raw phone) precisely so consent is always
 * checkable. Customer-facing + approval-required → witnessed-send only.
 */
import { and, eq } from "drizzle-orm";
import { registerHand } from "./registry";
import { handError, type HandResult } from "./types";
import { db } from "../../../db";
import { leads } from "@shared/schema";
import { sendSMSToLead } from "../../smsService";
import { logger } from "../../../utils/logger";

const NAME = "send_sms";

/** Pure: is `hourLocal` (0–23) outside the 8am–9pm send window? Testable. */
export function isQuietHour(hourLocal: number): boolean {
  return hourLocal < 8 || hourLocal >= 21;
}

async function handler(input: Record<string, unknown>): Promise<HandResult> {
  const started = Date.now();
  try {
    const organizationId = typeof input.organization_id === "number" ? input.organization_id : NaN;
    const leadId = typeof input.lead_id === "number" ? input.lead_id : NaN;
    const message = String(input.message ?? "").trim();
    if (!Number.isFinite(organizationId) || !Number.isFinite(leadId) || !message) {
      return { success: false, output: "send_sms: 'organization_id', 'lead_id', and 'message' are required.", durationMs: Date.now() - started };
    }

    // Consent gate (defense in depth — the witnessed tap is the primary gate).
    const [lead] = await db
      .select({ doNotContact: leads.doNotContact, tcpaConsent: leads.tcpaConsent })
      .from(leads)
      .where(and(eq(leads.organizationId, organizationId), eq(leads.id, leadId)))
      .limit(1);
    if (!lead) {
      return { success: false, output: `send_sms: lead ${leadId} not found in org ${organizationId}.`, durationMs: Date.now() - started };
    }
    if (lead.doNotContact === true || lead.tcpaConsent === false) {
      logger.info(`[autopilot/hands] send_sms refused — no TCPA consent for lead ${leadId}`);
      return { success: false, output: `send_sms: lead ${leadId} has not consented to SMS (doNotContact / no TCPA consent); not sending.`, durationMs: Date.now() - started };
    }

    // Quiet-hours gate when a tz offset is supplied.
    if (typeof input.tz_offset_hours === "number") {
      const localHour = (((new Date().getUTCHours() + input.tz_offset_hours) % 24) + 24) % 24;
      if (isQuietHour(localHour)) {
        return { success: false, output: `send_sms: refused — ${localHour}:00 local is outside the 8am–9pm send window.`, durationMs: Date.now() - started };
      }
    }

    const result = await sendSMSToLead(organizationId, leadId, message, "autopilot");
    if (!result.success) {
      return { success: false, output: `send_sms failed: ${result.error ?? "unknown"}`, durationMs: Date.now() - started };
    }
    return { success: true, output: JSON.stringify({ messageId: result.messageId }), durationMs: Date.now() - started };
  } catch (err) {
    return handError(NAME, err, started);
  }
}

registerHand({
  name: NAME,
  schema: {
    name: NAME,
    description:
      "Send an SMS to a lead by lead_id (so consent is checkable). Refuses if the lead is doNotContact / lacks TCPA consent, and outside quiet hours. Cost is posted to the ledger automatically. REQUIRES a founder tap.",
    input_schema: {
      type: "object",
      properties: {
        organization_id: { type: "number" },
        lead_id: { type: "number" },
        message: { type: "string", description: "Plain, concise, opt-out-aware. No hype." },
        tz_offset_hours: { type: "number", description: "Optional recipient UTC offset for the quiet-hours guard." },
      },
      required: ["organization_id", "lead_id", "message"],
    },
  },
  domain: "support",
  isCustomerFacing: true,
  // Declared explicitly (required since 2026-08-18): One recipient. Carrier fee is our infrastructure cost.
  movesMoney: false,
  outwardClass: "none",
  requiresApproval: true,
  surface: "support",
  handler,
});

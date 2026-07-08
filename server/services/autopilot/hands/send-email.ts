/**
 * Founder Autopilot — send_email hand (Hands roadmap P1.1).
 *
 * A thin adapter over the production email service. It does NOT reimplement any
 * send/compliance logic — emailService.sendEmail already enforces the
 * suppression list, the CAN-SPAM footer, and the RFC-8058 unsubscribe header.
 * This hand's job is only to translate the model-facing input shape and add a
 * defense-in-depth suppression check before delegating.
 *
 * Governance: customer-facing + approval-required → the executor refuses any
 * direct model call; the only execution path is the founder-witnessed one
 * (executeHandWitnessed) after a human taps Approve.
 */
import { registerHand } from "./registry";
import { handError, type HandResult } from "./types";
import { sendEmail } from "../../emailService";
import { filterSuppressed } from "../../emailSuppressions";
import { logger } from "../../../utils/logger";

const NAME = "send_email";

async function handler(input: Record<string, unknown>): Promise<HandResult> {
  const started = Date.now();
  try {
    const to = String(input.to ?? "").trim();
    const subject = String(input.subject ?? "").trim();
    const html = String(input.html ?? "").trim();
    const organizationId =
      typeof input.organization_id === "number" ? input.organization_id : undefined;
    if (!to || !subject || !html) {
      return { success: false, output: "send_email: 'to', 'subject', and 'html' are all required.", durationMs: Date.now() - started };
    }

    // Defense in depth: refuse before sending if the recipient is suppressed.
    // (sendEmail filters internally too — this gives a clear, early refusal.)
    const { allowed } = await filterSuppressed([to]);
    if (allowed.length === 0) {
      logger.info(`[autopilot/hands] send_email refused — recipient suppressed`);
      return {
        success: false,
        output: `send_email: recipient is on the suppression list; not sending.`,
        durationMs: Date.now() - started,
      };
    }

    const result = await sendEmail({
      to,
      subject,
      html,
      organizationId,
      // Autopilot outward email is commercial (not a transactional system
      // notice) → keep the CAN-SPAM footer + unsubscribe by NOT marking it
      // transactional. This is the safe default.
      isCampaignEmail: true,
    });
    if (!result.success) {
      return { success: false, output: `send_email failed: ${result.error ?? result.errorType ?? "unknown"}`, durationMs: Date.now() - started };
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
      "Send a single email to a customer/lead. Routes through the platform email service (suppression list + CAN-SPAM footer + unsubscribe are enforced automatically). REQUIRES a founder tap — cannot be executed autonomously.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email address." },
        subject: { type: "string" },
        html: { type: "string", description: "HTML body. Plain, tasteful, land-investor-native — no hype." },
        organization_id: { type: "number", description: "Owning org (for sender identity + ledger)." },
      },
      required: ["to", "subject", "html"],
    },
  },
  domain: "support",
  isCustomerFacing: true,
  requiresApproval: true,
  surface: "support",
  handler,
});

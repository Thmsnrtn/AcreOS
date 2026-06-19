/**
 * Founder Autopilot — apply_refund hand (Hands roadmap P2.2).
 *
 * Issuing a refund moves real money OUT and cannot be un-done — irreversible
 * class. So beyond the standard witnessed-send tap (requiresApproval), this hand
 * enforces a HARD $50 ceiling that mirrors the platform's existing auto-approve
 * threshold: even a founder-approved call through THIS hand cannot exceed $50.
 * Larger refunds must go through the full manual refund flow in routes-billing —
 * deliberately not reachable from the autopilot.
 *
 * Thin adapter over stripe.refunds.create (partial amount supported).
 */
import { registerHand } from "./registry";
import { handError, type HandResult } from "./types";

const NAME = "apply_refund";
/** Hard ceiling (cents). Matches the platform auto-approve threshold. */
export const REFUND_CEILING_CENTS = 5000;

async function handler(input: Record<string, unknown>): Promise<HandResult> {
  const started = Date.now();
  try {
    const chargeId = String(input.charge_id ?? "").trim();
    const amountCents = typeof input.amount_cents === "number" ? Math.floor(input.amount_cents) : NaN;
    if (!chargeId || !Number.isFinite(amountCents) || amountCents <= 0) {
      return { success: false, output: "apply_refund: 'charge_id' and a positive 'amount_cents' are required.", durationMs: Date.now() - started };
    }
    if (amountCents > REFUND_CEILING_CENTS) {
      return {
        success: false,
        output: `apply_refund: $${(amountCents / 100).toFixed(2)} exceeds the $${(REFUND_CEILING_CENTS / 100).toFixed(2)} autopilot ceiling. Larger refunds must use the manual refund flow. Refusing.`,
        durationMs: Date.now() - started,
      };
    }
    const { getUncachableStripeClient } = await import("../../../stripeClient");
    const stripe = await getUncachableStripeClient();
    const refund = await stripe.refunds.create({ charge: chargeId, amount: amountCents });
    return { success: true, output: JSON.stringify({ refundId: refund.id, amountCents }), durationMs: Date.now() - started };
  } catch (err) {
    return handError(NAME, err, started);
  }
}

registerHand({
  name: NAME,
  schema: {
    name: NAME,
    description:
      "Issue a refund (partial allowed) against a Stripe charge, for a retention save. IRREVERSIBLE; hard-capped at $50 — larger refunds are not available to the autopilot. REQUIRES a founder tap.",
    input_schema: {
      type: "object",
      properties: {
        charge_id: { type: "string", description: "The Stripe charge id (ch_...)." },
        amount_cents: { type: "number", description: "Amount to refund in cents (≤ 5000)." },
        reason: { type: "string", description: "Why — for the audit trail." },
      },
      required: ["charge_id", "amount_cents"],
    },
  },
  domain: "finance",
  isCustomerFacing: true,
  movesMoney: true,
  requiresApproval: true,
  surface: "generic",
  handler,
});

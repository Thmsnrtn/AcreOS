/**
 * Founder Autopilot — send_email hand (Hands roadmap P1.1).
 *
 * A thin adapter over the production email service. It does NOT reimplement any
 * send/compliance logic — emailService.sendEmail already enforces the
 * suppression list, the CAN-SPAM footer, and the RFC-8058 unsubscribe header.
 * This hand's job is only to translate the model-facing input shape, enforce the
 * system-only ruling below, and add a defense-in-depth suppression check before
 * delegating.
 *
 * Governance: customer-facing + approval-required → the executor refuses any
 * direct model call; the only execution path is the founder-witnessed one
 * (executeHandWitnessed) after a human taps Approve.
 *
 * ── THE AUTOPILOT IS SYSTEM-ONLY (founder ruling, 2026-08-16) ───────────────
 * This hand takes a free-form recipient address, so nothing in its shape stopped
 * it being pointed at a customer org's seller, buyer or borrower. That would be
 * a re-fronting of the platform send rail, which the 2026-07-17 decision forbids:
 * counterparty mail requires the org's OWN connected identity (BYO), and the
 * @acreos.io identity is reserved for system mail. The founder has now closed the
 * question in the narrowing direction: THE AUTOPILOT MAY ONLY EVER MAIL ACREOS'S
 * OWN USERS (trial, activation, win-back, churn — AcreOS talking to its own
 * customers about AcreOS).
 *
 * Three things follow, and they are load-bearing together:
 *   1. The send is labelled `purpose: "system"` — a decision of record, not the
 *      silent default the field's `?? 'system'` would otherwise have supplied.
 *   2. `organization_id` is LEDGER ATTRIBUTION ONLY. It is deliberately NOT
 *      forwarded to sendEmail, because sendEmail treats organizationId as a
 *      SENDER-IDENTITY selector (org BYO SES credentials via getSESClient, and
 *      the org verified-domain From override) — exactly the capability this
 *      ruling removes. Autopilot mail goes out on the AcreOS platform identity.
 *      Attribution is unaffected: the proof-receipt scope (`org:N`) is derived by
 *      executeHandWitnessed from the raw `input.organization_id`, not from what
 *      this adapter hands to the email service.
 *   3. A recipient that resolves to a lead / borrower / buyer / seller record is
 *      REFUSED — loudly, with the ruling named. See counterpartyMatch below.
 *
 * A `system` label is only honest if something makes it true. #3 is that
 * something; without the guard, the label would merely be a compiler-satisfying
 * stamp that laundered an open question into a settled-looking one.
 */
import { registerHand } from "./registry";
import { handError, type HandResult } from "./types";
import { sendEmail } from "../../emailService";
import { filterSuppressed } from "../../emailSuppressions";
import { logger } from "../../../utils/logger";
import { counterpartyMatch, type CounterpartyHit } from "./counterpartyMatch";

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

    // ── Hard stop: system-only (founder ruling, 2026-08-16) ──────────────────
    // Runs BEFORE the suppression check on purpose. Suppression here is
    // explicitly defense-in-depth (sendEmail filters internally too), whereas
    // this is the ONLY place the ruling is enforced for this hand. A convenience
    // check must not be able to short-circuit the sole enforcement point and
    // hide the governance signal — "the autopilot aimed at a customer's
    // borrower" is something the founder needs to see in order to fix the play.
    let hit: CounterpartyHit | null;
    try {
      hit = await counterpartyMatch(to);
    } catch (err) {
      // FAIL CLOSED. This is a hard stop enforcing a standing founder decision,
      // and the repo's bias for hard stops is to err closed: a false block
      // defers one send to founder review, a false pass silently violates the
      // decision and is invisible afterwards. A lookup that errored has told us
      // nothing about the recipient — that is not permission to send.
      logger.error(
        `[autopilot/hands] send_email refused — counterparty lookup failed, failing CLOSED`,
        err,
        { metadata: { hand: NAME, organizationId } },
      );
      return {
        success: false,
        output:
          `send_email refused: could not verify that the recipient is an AcreOS user. ` +
          `The autopilot is system-only (founder ruling, 2026-08-16), so it may only send once the ` +
          `recipient is proven NOT to be a customer's lead/seller/buyer/borrower. The check failed ` +
          `(${err instanceof Error ? err.message : String(err)}), so this send fails closed. Retry once the ` +
          `database is reachable, or send counterparty mail from the org's own connected identity.`,
        durationMs: Date.now() - started,
      };
    }
    if (hit) {
      logger.warn(`[autopilot/hands] send_email refused — recipient is a customer counterparty`, {
        metadata: {
          hand: NAME,
          matchedKind: hit.kind,
          matchedRecordId: hit.recordId,
          counterpartyOrganizationId: hit.organizationId,
          callerOrganizationId: organizationId,
        },
      });
      return {
        success: false,
        output:
          `send_email refused: the recipient resolves to a customer counterparty — ${hit.kind} #${hit.recordId}` +
          `${hit.organizationId != null ? ` in org ${hit.organizationId}` : ""}. ` +
          `The autopilot is system-only (founder ruling, 2026-08-16): it may only mail AcreOS's own users. ` +
          `Mail to a customer's sellers, buyers or borrowers must go out on that org's OWN connected email ` +
          `identity (founder decision, 2026-07-17 — no re-fronting the platform send rail). Nothing was sent.`,
        durationMs: Date.now() - started,
      };
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
      // NOTE: organizationId is deliberately NOT forwarded — see #2 in the
      // header. In sendEmail it selects the SENDER IDENTITY (org BYO SES creds +
      // org verified-domain From override), which is precisely the capability
      // the system-only ruling removes. It stays in scope here for attribution
      // and logging; the proof-receipt scope is derived upstream from the raw
      // input by executeHandWitnessed.
      //
      // The lane, stated rather than defaulted (founder decision, 2026-07-17).
      // This is TRUE BY CONSTRUCTION: the counterparty guard above has already
      // refused every recipient that belongs to a customer's deal, so what is
      // left is AcreOS mailing its own users on the AcreOS identity — the
      // definition of the system lane.
      purpose: "system",
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
      "Send a single email to an ACREOS USER (trial, activation, win-back, churn — AcreOS talking to its own customers about AcreOS). SYSTEM MAIL ONLY: a recipient that resolves to a customer's lead, seller, buyer or borrower is refused, because counterparty mail must go out on that org's own connected email identity (founder ruling, 2026-08-16). Routes through the platform email service on the AcreOS identity (suppression list + CAN-SPAM footer + unsubscribe are enforced automatically). REQUIRES a founder tap — cannot be executed autonomously.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email address. Must be an AcreOS user — NOT a customer's seller, buyer, or borrower." },
        subject: { type: "string" },
        html: { type: "string", description: "HTML body. Plain, tasteful, land-investor-native — no hype." },
        organization_id: {
          type: "number",
          description:
            "Owning org, for LEDGER ATTRIBUTION ONLY (proof-receipt scope + cost attribution). It does NOT select a sender identity: autopilot mail always goes out on the AcreOS platform identity (founder ruling, 2026-08-16 — autopilot is system-only). Passing it does not authorize mailing that org's counterparties.",
        },
      },
      required: ["to", "subject", "html"],
    },
  },
  domain: "support",
  isCustomerFacing: true,
  // Declared explicitly (required since 2026-08-18): One recipient. Not a money decision: the per-send cost is our infrastructure, not the customer's money moving.
  movesMoney: false,
  outwardClass: "none",
  requiresApproval: true,
  surface: "support",
  handler,
});

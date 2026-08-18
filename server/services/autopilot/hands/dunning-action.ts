/**
 * Founder Autopilot — dunning_action hand (Hands roadmap P2.1).
 *
 * The safest money hand and the natural FIRST money domain to earn autonomy:
 * retrying a failed invoice is non-destructive (the card is charged or it
 * isn't) and the outcome is self-verifying (a later invoice.payment_succeeded
 * closes the loop → perception bus → outcome ledger). Because the retry itself
 * is internal + reversible, it is NOT approval-required — it can graduate to
 * autonomous-gated, still bounded by the per-domain Trust Ledger + budget gate +
 * the dispatch master switch. (The customer-facing dunning EMAIL is separate and
 * goes through the approval-required send_email hand.)
 *
 * Thin adapter over the existing 5-stage dunningService — no new recovery logic.
 */
import { registerHand } from "./registry";
import { handError, type HandResult } from "./types";
import { dunningService } from "../../dunning";
import { logger } from "../../../utils/logger";

const NAME = "dunning_action";
const ACTIONS = new Set(["retry", "resolve", "cancel"]);

async function handler(input: Record<string, unknown>): Promise<HandResult> {
  const started = Date.now();
  try {
    const eventId = typeof input.event_id === "number" ? input.event_id : NaN;
    const action = String(input.action ?? "").trim();
    if (!Number.isFinite(eventId) || !ACTIONS.has(action)) {
      return { success: false, output: "dunning_action: 'event_id' (number) and 'action' (retry|resolve|cancel) are required.", durationMs: Date.now() - started };
    }
    let result: { success: boolean; message: string };
    if (action === "retry") result = await dunningService.retryPayment(eventId);
    else if (action === "cancel") result = await dunningService.cancelCase(eventId);
    else result = await dunningService.resolveCase(eventId, typeof input.notes === "string" ? input.notes : undefined);
    if (result.success) {
      // CP3 of Jarvis Phase 1 (Verified Act-and-Confirm) — after the witnessed
      // hand acts, enqueue an independent READ-ONLY verification of the
      // event's post-action state (status transition, org dunning stage,
      // ledger untouched). Fire-and-forget: a verify hiccup never fails the
      // hand; verification only observes — the act-and-confirm coupling is
      // the Trust Ledger, not blocking.
      void import("../../solene/verifyQueue")
        .then(({ enqueueDunningEventVerify }) =>
          enqueueDunningEventVerify(eventId, action as "retry" | "resolve" | "cancel"),
        )
        .catch((err) =>
          logger.warn(
            `[autopilot/hands] dunning verify enqueue failed for event ${eventId} (action unaffected): ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        );
    }
    return { success: result.success, output: result.message, durationMs: Date.now() - started };
  } catch (err) {
    return handError(NAME, err, started);
  }
}

registerHand({
  name: NAME,
  schema: {
    name: NAME,
    description:
      "Act on a failed-payment dunning case: retry the charge, resolve, or cancel the case. Non-destructive + self-verifying (the safest money action). Does NOT send the customer email (use send_email for that). Gated by finance-domain autonomy + budget.",
    input_schema: {
      type: "object",
      properties: {
        event_id: { type: "number", description: "The dunning event id." },
        action: { type: "string", enum: ["retry", "resolve", "cancel"] },
        notes: { type: "string", description: "Optional note for resolve." },
      },
      required: ["event_id", "action"],
    },
  },
  domain: "finance",
  isCustomerFacing: false,
  movesMoney: true,
  // SECURITY (elite-audit P0): a retry re-charges a customer's card — a money
  // action. It now requires the founder's tap so it flows through the audited
  // witnessed path (autopilot_sends), satisfying the "finance hand ⇒ witnessed"
  // invariant. (It can earn back autonomy later behind a real audit + daily
  // spend envelope; until then, money never moves without a tap.)
  outwardClass: "none",
  requiresApproval: true,
  surface: "generic",
  handler,
});

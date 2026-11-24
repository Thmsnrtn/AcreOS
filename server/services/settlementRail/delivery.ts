/**
 * Settlement & Documents Rail — delivery lanes.
 *
 * A generated document reaches its recipient through exactly one lane
 * (shared/settlement-rail.ts RAIL_DELIVERY_LANES):
 *
 *   download       — no function here: the route serves the artifact's PDF.
 *   mail           — a physical First-Class letter through the platform's
 *                    ONE mail lane (directMailService.sendLetter, which
 *                    resolves own-key vs house, charges purchased credits
 *                    before any provider is contacted, and refunds only a
 *                    certainly-unbilled piece).
 *   certified_mail — the same letter with USPS Certified Mail added
 *                    (sweep S-1): tracking + proof of mailing for the
 *                    documents whose whole point is proving they were sent
 *                    (payoff letters to escrow, statutory notices).
 *
 * A send is only ever reported from the provider's acceptance (the Lob id
 * sendLetter returns). A refusal — no verified return address, no recorded
 * price, credits short — arrives as ProviderNotContactedError and nothing
 * was mailed; callers must say so, never "sent".
 *
 * ERROR TAXONOMY (T-DEF-2): the mail lane speaks in lane errors, and this
 * module is the ONE place they are translated into the rail's own shapes
 * before any caller sees them:
 *
 *   ProviderNotContactedError → RailDeliveryRefusedError (422 at the route):
 *     the lane refused BEFORE any provider contact — nothing was mailed,
 *     nothing was charged beyond a refunded pre-pay — and the refusal's
 *     reason (sender identity unverified, credits short, …) travels with
 *     it so the operator is told what to fix, in the refusal's own words.
 *   ActionInFlight / ActionAmbiguous / ActionKeyReused →
 *   RailDeliveryConflictError (409 at the route): the piece's durable
 *     claim is in a state that forbids this call — another worker is
 *     sending it, a prior attempt's outcome is unknown (the provider MAY
 *     have accepted it — never presented as "nothing was sent"), or the
 *     key was reused for different content.
 *   Anything else passes through untouched: a genuine fault, which the
 *     route's 500 handler owns.
 *
 * Before this translation existed, the redemption-notice route mapped only
 * RailDeliveryRefusedError, so every lane refusal above fell through to a
 * bare 500 INTERNAL_ERROR — a fixable configuration refusal mislabelled
 * as a server crash (journey-walk-tax-2026-11.md, T-DEF-2).
 */

import { sendLetter, LetterAlreadySentError } from "../directMailService";
import {
  ActionAmbiguousError,
  ActionInFlightError,
  ActionKeyReusedError,
  ProviderNotContactedError,
} from "../actions/outwardAction";
import type { MailLaneRefusalReason } from "../mail/mailLane";
import { storage } from "../../storage";
import type { RailDeliveryLane } from "@shared/settlement-rail";

export interface RailMailRecipient {
  name: string;
  address: { line1: string; line2?: string; city: string; state: string; zip: string };
}

export interface RailDeliveryReceipt {
  lane: Exclude<RailDeliveryLane, "download">;
  /** The provider's own id for the piece (Lob letter id). */
  providerId: string | null;
  /** True when the provider's environment was TEST — rendered, not printed. */
  testMode: boolean;
  /** True when this exact letter had already been accepted under its idempotency key. */
  alreadySent: boolean;
  expectedDeliveryDate: string | null;
}

/**
 * Why the rail refused a mail send BEFORE any provider was contacted.
 * The mail lane's own refusal reasons travel verbatim (mailLane.ts);
 * `insufficient_purchased_credits` is the lane's charge refusal;
 * `provider_not_contacted` is the honest remainder — the send provably
 * never reached the provider, but the lane named no narrower reason
 * (an unreadable own key, an uncountable letter file, an owner opt-out).
 */
export type RailDeliveryRefusalReason =
  | MailLaneRefusalReason
  | "insufficient_purchased_credits"
  | "provider_not_contacted";

/** Raised before any provider contact: nothing was mailed. The message is written for the operator. */
export class RailDeliveryRefusedError extends Error {
  constructor(
    readonly reason: RailDeliveryRefusalReason,
    message: string,
  ) {
    super(message);
    this.name = "RailDeliveryRefusedError";
  }
}

/** Why a rail send conflicts with its own durable outward-action claim. */
export type RailDeliveryConflictReason = "send_in_flight" | "send_outcome_unknown" | "idempotency_key_reused";

/**
 * The piece's idempotency claim forbids this call. NOT a "nothing was
 * sent" refusal: on `send_outcome_unknown` the provider may already have
 * accepted the piece, and the message says to reconcile rather than retry.
 */
export class RailDeliveryConflictError extends Error {
  constructor(
    readonly reason: RailDeliveryConflictReason,
    message: string,
  ) {
    super(message);
    this.name = "RailDeliveryConflictError";
  }
}

const KNOWN_REFUSAL_REASONS: ReadonlySet<string> = new Set<RailDeliveryRefusalReason>([
  "no_sender_identity",
  "sender_identity_unverified",
  "house_mail_unavailable",
  "unknown_spec",
  "letter_pages_unconfirmed",
  "letter_over_max",
  "letter_render_failed",
  "insufficient_purchased_credits",
]);

/**
 * The lane's own reason for a pre-contact refusal, read off the error's
 * cause chain (assertSendableLane / chargeHouseMailPiece wrap the lane's
 * MailLaneRefusedError as the cause of their ProviderNotContactedError).
 * An unrecognised or absent reason degrades to `provider_not_contacted`,
 * never to a guessed narrower one.
 */
function refusalReasonOf(err: ProviderNotContactedError): RailDeliveryRefusalReason {
  let cause: unknown = err.cause;
  for (let depth = 0; depth < 4 && cause != null && typeof cause === "object"; depth++) {
    const reason = (cause as { reason?: unknown }).reason;
    if (typeof reason === "string" && KNOWN_REFUSAL_REASONS.has(reason)) {
      return reason as RailDeliveryRefusalReason;
    }
    cause = (cause as { cause?: unknown }).cause;
  }
  return "provider_not_contacted";
}

/**
 * Translate a mail-lane error into the rail's taxonomy (see the header).
 * Rail errors and genuine faults pass through unchanged — identity is
 * preserved so a route's 500 handler sees the original error.
 */
export function translateRailDeliveryError(err: unknown): unknown {
  if (err instanceof RailDeliveryRefusedError || err instanceof RailDeliveryConflictError) return err;
  if (err instanceof ProviderNotContactedError) {
    return new RailDeliveryRefusedError(refusalReasonOf(err), err.message);
  }
  if (err instanceof ActionInFlightError) return new RailDeliveryConflictError("send_in_flight", err.message);
  if (err instanceof ActionAmbiguousError) return new RailDeliveryConflictError("send_outcome_unknown", err.message);
  if (err instanceof ActionKeyReusedError) return new RailDeliveryConflictError("idempotency_key_reused", err.message);
  return err;
}

/** The HTTP shape a rail route answers for a translated delivery error. */
export interface RailDeliveryHttpError {
  status: 422 | 409;
  /** The ApiErrorResponse `error` code (mirrors Errors.unprocessable / the 409 code). */
  code: "UNPROCESSABLE" | "CONFLICT";
  message: string;
  reason: RailDeliveryRefusalReason | RailDeliveryConflictReason;
}

/**
 * Map a delivery error onto its route response, or null when it is not a
 * rail delivery refusal/conflict (the caller then owns it — a genuine
 * fault stays a 500). Both rail-letter routes answer through this one
 * mapping so a lane refusal reads identically on every rail surface.
 */
export function railDeliveryHttpError(err: unknown): RailDeliveryHttpError | null {
  if (err instanceof RailDeliveryRefusedError) {
    return { status: 422, code: "UNPROCESSABLE", message: err.message, reason: err.reason };
  }
  if (err instanceof RailDeliveryConflictError) {
    return { status: 409, code: "CONFLICT", message: err.message, reason: err.reason };
  }
  return null;
}

/**
 * Mail one rail document (its letter HTML) on the `mail` or `certified_mail`
 * lane. `idempotencyKey` is the letter's durable identity (quote id, offer
 * letter id, …): a retry after a crash replays to the provider's recorded
 * acceptance instead of printing a second copy.
 */
export async function deliverRailLetterByMail(args: {
  organizationId: number;
  html: string;
  recipient: RailMailRecipient;
  lane: Exclude<RailDeliveryLane, "download">;
  idempotencyKey: string;
}): Promise<RailDeliveryReceipt> {
  const senderIdentity = await storage.getDefaultMailSenderIdentity(args.organizationId).catch(() => undefined);
  if (!senderIdentity) {
    throw new RailDeliveryRefusedError(
      "no_sender_identity",
      "AcreOS mail needs your own return address. Add one in Mail Settings and verify it before mailing from the rail.",
    );
  }
  try {
    const result = await sendLetter({
      organizationId: args.organizationId,
      senderIdentity,
      recipientName: args.recipient.name,
      recipientAddress: args.recipient.address,
      htmlContent: args.html,
      useType: "operational",
      ...(args.lane === "certified_mail" ? { extraServices: ["certified"] as Array<"certified"> } : {}),
      idempotencyKey: args.idempotencyKey,
    });
    return {
      lane: args.lane,
      providerId: result.lobId,
      testMode: result.testMode,
      alreadySent: false,
      expectedDeliveryDate: result.expectedDeliveryDate ? result.expectedDeliveryDate.toISOString() : null,
    };
  } catch (err) {
    if (err instanceof LetterAlreadySentError) {
      return { lane: args.lane, providerId: err.lobId, testMode: false, alreadySent: true, expectedDeliveryDate: null };
    }
    // Lane refusals and claim conflicts leave here in the rail's own
    // taxonomy; genuine faults pass through untouched (see the header).
    throw translateRailDeliveryError(err);
  }
}

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
 */

import { sendLetter, LetterAlreadySentError } from "../directMailService";
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

/** Raised before any provider contact when the org has no usable return address. */
export class RailDeliveryRefusedError extends Error {
  constructor(
    readonly reason: "no_sender_identity",
    message: string,
  ) {
    super(message);
    this.name = "RailDeliveryRefusedError";
  }
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
    throw err;
  }
}

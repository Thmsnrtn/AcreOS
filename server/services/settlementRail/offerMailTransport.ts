/**
 * Settlement & Documents Rail — the offer-mail transport (Land S-01's shape,
 * built as a rail delivery lane; the Land transplant package consumes it).
 *
 * THE DEFECT THIS CLOSES. `POST /api/offer-letters/:id/send` sets an offer
 * letter's status to `queued` under the comment "in real implementation,
 * this would integrate with Lob" — and nothing consumed the queue. The
 * letter was never mailed, while the UI toasted success behind a
 * "written commitment" dialog: a false confirmation, the worst of the
 * starvation sweep's 28 instances. This transport is the missing consumer:
 *
 *   queued → (this drain) → sent, with the provider's letter id recorded,
 *   or back to draft with the failure reason on the letter — never a
 *   success nobody can point at.
 *
 * HOW IT SENDS. Through the rail's mail lane (deliverRailLetterByMail →
 * directMailService.sendLetter): lane resolution, purchased-credit charge
 * before provider contact, refund on a certainly-unbilled rejection — all
 * inherited, none re-implemented. The send carries the idempotency key
 * `offer-letter:<id>`, so a crashed cycle replays to the provider's
 * recorded acceptance instead of printing a second letter. The letter's
 * copy is merged with ITS OWN parcel's price ({offerPrice}) — the merge
 * the working mail lane could not do when the sweep found it
 * (mergeMailCopy merges name/city/state only, unless a price is passed).
 *
 * SCOPE. Letters whose deliveryMethod is direct_mail (or both — this is
 * their mail leg). Email-only letters are not this lane's; they are counted
 * as skipped and left queued for an email lane, never silently consumed.
 * A recipient who opted out, was deleted, or has no usable address is a
 * per-letter failure recorded on the letter, not a cycle failure.
 */

import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { leads, offerLetters, type OfferLetter } from "@shared/schema";
import { mergeMailCopy } from "@shared/parcel/ownerName";
import { leadNotOptedOutSql } from "../leadContactability";
import { deliverRailLetterByMail, type RailMailRecipient } from "./delivery";
import { logger } from "../../utils/logger";
import { clock } from "../../utils/clock";

export interface OfferMailTransportSummary {
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
}

const formatPrice = (amount: string): string => {
  const n = Number(amount);
  return Number.isFinite(n) ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : amount;
};

/** Send one claimed letter. Returns the outcome; never throws for a per-letter failure. */
async function sendOne(letter: OfferLetter): Promise<"sent" | "failed" | "skipped"> {
  if (letter.deliveryMethod === "email") return "skipped";

  const fail = async (reason: string): Promise<"failed"> => {
    await db
      .update(offerLetters)
      .set({
        status: "draft",
        responseNotes: `Mail send failed (${clock.now().toISOString().slice(0, 10)}): ${reason}`.slice(0, 500),
        updatedAt: clock.now(),
      })
      .where(and(eq(offerLetters.id, letter.id), eq(offerLetters.organizationId, letter.organizationId)));
    logger.warn(`[offerMailTransport] offer letter ${letter.id} returned to draft: ${reason}`);
    return "failed";
  };

  if (!letter.leadId) return fail("the letter has no recipient lead");
  const [lead] = await db
    .select({
      id: leads.id,
      firstName: leads.firstName,
      lastName: leads.lastName,
      address: leads.address,
      city: leads.city,
      state: leads.state,
      zip: leads.zip,
    })
    .from(leads)
    .where(
      and(
        eq(leads.id, letter.leadId),
        eq(leads.organizationId, letter.organizationId),
        sql`${leads.deletedAt} IS NULL`,
        leadNotOptedOutSql(),
      ),
    )
    .limit(1);
  if (!lead) return fail("the recipient opted out, was removed, or no longer exists");
  if (!lead.address || !lead.city || !lead.state || !lead.zip) {
    return fail("the recipient has no complete mailing address on their lead record");
  }
  const recipientName = `${lead.firstName} ${lead.lastName}`.trim();
  const merged = mergeMailCopy((letter.letterContent ?? "").trim(), {
    name: recipientName,
    city: lead.city,
    state: lead.state,
    price: formatPrice(letter.offerAmount),
  }, { html: true });
  if (!merged) return fail("the letter has no content to mail");

  const recipient: RailMailRecipient = {
    name: recipientName,
    address: { line1: lead.address, city: lead.city, state: lead.state, zip: lead.zip },
  };
  try {
    const receipt = await deliverRailLetterByMail({
      organizationId: letter.organizationId,
      html: `<div style="font-family: Georgia, serif; line-height: 1.5;">${merged}</div>`,
      recipient,
      lane: "mail",
      idempotencyKey: `offer-letter:${letter.id}`,
    });
    await db
      .update(offerLetters)
      .set({ status: "sent", lobMailingId: receipt.providerId, sentAt: clock.now(), updatedAt: clock.now() })
      .where(and(eq(offerLetters.id, letter.id), eq(offerLetters.organizationId, letter.organizationId)));
    logger.info(`[offerMailTransport] offer letter ${letter.id} mailed (provider ${receipt.providerId ?? "?"})`);
    return "sent";
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Drain the queued offer letters, oldest first, bounded per cycle. Safe to
 * run on every worker under the caller's job lock; the per-letter
 * idempotency key makes an overlapping cycle harmless.
 */
export async function drainQueuedOfferLetters(limit = 25): Promise<OfferMailTransportSummary> {
  const queued = await db
    .select()
    .from(offerLetters)
    .where(eq(offerLetters.status, "queued"))
    .orderBy(asc(offerLetters.createdAt))
    .limit(limit);
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const letter of queued) {
    try {
      const outcome = await sendOne(letter);
      if (outcome === "sent") sent++;
      else if (outcome === "failed") failed++;
      else skipped++;
    } catch (err) {
      failed++;
      logger.error(
        `[offerMailTransport] offer letter ${letter.id} threw outside its send`,
        err instanceof Error ? err : undefined,
      );
    }
  }
  if (queued.length > 0) {
    logger.info(`[offerMailTransport] cycle: claimed=${queued.length} sent=${sent} failed=${failed} skipped=${skipped}`);
  }
  return { claimed: queued.length, sent, failed, skipped };
}

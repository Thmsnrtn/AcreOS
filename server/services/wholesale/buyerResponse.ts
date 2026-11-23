/**
 * Record a buyer's reply to a blast — the operator's own log of what a buyer
 * said by reply email or phone. ONE implementation for both doors (REST
 * PATCH /api/buyer-blasts/recipients/:id and the Pax `record_buyer_blast_response`
 * tool). A record only: it changes no delivery state, sends nothing, and
 * offers nothing to anyone.
 */
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { buyerBlastRecipients, buyerBlasts, BUYER_BLAST_RECIPIENT_STATUSES } from "@shared/schema";
import { clock } from "../../utils/clock";

export const recipientResponseSchema = z.object({
  status: z.enum(BUYER_BLAST_RECIPIENT_STATUSES).optional(),
  responseNotes: z.string().max(4_000).optional(),
});

type RecipientResponseInput = z.infer<typeof recipientResponseSchema>;

/**
 * Apply a validated response to one recipient of THIS org's blast. Returns the
 * updated row, or null when no such recipient exists in this org.
 */
export async function recordBlastRecipientResponse(organizationId: number, recipientId: string, input: RecipientResponseInput) {
  const update: Partial<typeof buyerBlastRecipients.$inferInsert> = { ...input };
  if (input.status === "replied_interested" || input.status === "replied_not_interested") {
    update.respondedAt = clock.now();
  }
  const [row] = await db
    .update(buyerBlastRecipients)
    .set(update)
    .where(and(eq(buyerBlastRecipients.id, recipientId), eq(buyerBlastRecipients.organizationId, organizationId)))
    .returning();
  if (!row) return null;

  // Bump the parent blast's repliedCount when this is a reply transition.
  if (input.status === "replied_interested" || input.status === "replied_not_interested") {
    await db
      .update(buyerBlasts)
      .set({ repliedCount: sql`${buyerBlasts.repliedCount} + 1`, status: "completed" })
      .where(and(eq(buyerBlasts.id, row.blastId), eq(buyerBlasts.organizationId, organizationId)));
  }
  return row;
}

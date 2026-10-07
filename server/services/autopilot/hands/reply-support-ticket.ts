/**
 * Founder Autopilot — reply_support_ticket hand (Stage 2, the Support role
 * worker's only customer-facing effect).
 *
 * Answers a ticket an AcreOS customer opened: the reply is written on the
 * ticket thread (what the customer sees in-app) and the customer is told by
 * SYSTEM mail on the AcreOS identity. The recipient is never model-chosen — it
 * is the user who opened the ticket, read from the ticket row — so this hand
 * cannot be pointed at a customer's seller, buyer or borrower (founder rulings
 * 2026-07-17 / 2026-08-16: the autopilot only ever mails AcreOS's own users).
 *
 * Governance: customer-facing → requiresApproval (the registry refuses it
 * otherwise). A model call FREEZES it as a pending action; it runs only on a
 * founder tap or a founder-issued WitnessGrant covering the support domain
 * (autoWitness.ts) — the bounded delegation the founder grants once instead of
 * tapping every reply.
 */
import { and, eq, or } from "drizzle-orm";
import { registerHand } from "./registry";
import { handError, type HandResult } from "./types";
import { unscopedForPlatformOps } from "../../../utils/orgScopedDb";
import { supportTickets, supportTicketMessages } from "@shared/schema";
import { users } from "@shared/models/auth";
import { sendEmail } from "../../emailService";
import { filterSuppressed } from "../../emailSuppressions";
import { logger } from "../../../utils/logger";

const NAME = "reply_support_ticket";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Plain-text reply → minimal HTML paragraphs. Pure. */
function replyToHtml(message: string): string {
  return message
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

async function handler(input: Record<string, unknown>): Promise<HandResult> {
  const started = Date.now();
  try {
    const ticketId = typeof input.ticket_id === "number" ? Math.floor(input.ticket_id) : NaN;
    const message = String(input.message ?? "").trim();
    const resolve = input.resolve === true;
    const organizationId = typeof input.organization_id === "number" ? Math.floor(input.organization_id) : NaN;
    if (!Number.isFinite(ticketId) || ticketId <= 0 || !message || !Number.isFinite(organizationId)) {
      return { success: false, output: "reply_support_ticket: 'ticket_id', 'organization_id' and a non-empty 'message' are required.", durationMs: Date.now() - started };
    }
    // Platform-scope read by ticket id: the Support worker serves every
    // customer of AcreOS (the business's own support desk).
    const db = unscopedForPlatformOps("Solene support reply hand: AcreOS's own support desk answers the ticket an AcreOS customer opened (witnessed send)");
    const [ticket] = await db.select().from(supportTickets).where(and(eq(supportTickets.id, ticketId), eq(supportTickets.organizationId, organizationId))).limit(1);
    if (!ticket) {
      return { success: false, output: `reply_support_ticket: ticket #${ticketId} not found in org ${organizationId}.`, durationMs: Date.now() - started };
    }
    if (ticket.status === "resolved" || ticket.status === "closed") {
      return { success: false, output: `reply_support_ticket: ticket #${ticketId} is already ${ticket.status}; not replying twice.`, durationMs: Date.now() - started };
    }

    await db.insert(supportTicketMessages).values({
      ticketId,
      role: "agent",
      content: message,
      agentName: "Solene (support)",
    });
    await db
      .update(supportTickets)
      .set({
        status: resolve ? "resolved" : "waiting_on_customer",
        ...(resolve ? { resolvedAt: new Date(), resolvedBy: "solene-support", resolution: message.slice(0, 2000), resolutionType: "manual" } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(supportTickets.id, ticketId), eq(supportTickets.organizationId, ticket.organizationId)));

    // Tell the customer by SYSTEM mail. The recipient is the ticket opener.
    const [u] = await db
      .select({ email: users.email, firstName: users.firstName })
      .from(users)
      .where(or(eq(users.id, ticket.userId), eq(users.clerkUserId, ticket.userId)))
      .limit(1);
    let emailed = false;
    let emailNote = "no email on file for the ticket opener";
    if (u?.email) {
      const { allowed } = await filterSuppressed([u.email]);
      if (allowed.length === 0) {
        emailNote = "ticket opener has unsubscribed/suppressed; reply left in-app only";
      } else {
        const r = await sendEmail({
          to: u.email,
          subject: `Re: ${ticket.subject} [ticket #${ticketId}]`,
          html: `${replyToHtml(message)}\n<p>You can reply on the ticket in AcreOS → Settings → Support.</p>`,
          // AcreOS answering its own customer about AcreOS: the system lane, stated.
          purpose: "system",
          isCampaignEmail: false,
        });
        emailed = r.success;
        emailNote = r.success ? "emailed" : `email failed: ${r.error ?? r.errorType ?? "unknown"}`;
      }
    }
    logger.info("[autopilot/hands] reply_support_ticket", { metadata: { ticketId, resolve, emailed } });
    return {
      success: true,
      output: JSON.stringify({ ticketId, replied: true, resolved: resolve, emailed, emailNote }),
      durationMs: Date.now() - started,
    };
  } catch (err) {
    return handError(NAME, err, started);
  }
}

registerHand({
  name: NAME,
  schema: {
    name: NAME,
    description:
      "Reply to a support ticket an AcreOS customer opened: the reply is posted on the ticket and the customer is notified by AcreOS system mail (the recipient is always the ticket opener — never a free-form address). Set resolve=true only when the reply fully answers the request. REQUIRES a founder tap or a founder-issued support grant.",
    input_schema: {
      type: "object",
      properties: {
        ticket_id: { type: "number" },
        organization_id: { type: "number", description: "The org that opened the ticket (the ticket is read only within it)." },
        message: { type: "string", description: "The reply, plain text. Accurate; never promise what has not happened." },
        resolve: { type: "boolean", description: "True when this reply fully answers the request." },
      },
      required: ["ticket_id", "organization_id", "message"],
    },
  },
  domain: "support",
  isCustomerFacing: true,
  // A reply moves no money.
  movesMoney: false,
  outwardClass: "none",
  requiresApproval: true,
  surface: "support",
  handler,
});

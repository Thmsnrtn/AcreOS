/**
 * THE canonical agent support-reply writer (stage-4 turn 10,
 * docs/autonomous/BRAIN_CONSOLIDATION_STAGE4.md §1b).
 *
 * Found on the way in: the two agent-autonomous writers this consolidates
 * (autonomousDecisionExecutor.executeSupportEscalationApproval and
 * agentActionExecutors' resolve_stale_ticket) inserted
 * {senderId, senderName, messageType, isInternal} behind `as any` — columns
 * support_ticket_messages does NOT have. Drizzle silently dropped the
 * unknown keys, the NOT NULL `role` column went unfilled, and every insert
 * threw at the database: NEITHER PATH HAS EVER SUCCESSFULLY POSTED A
 * MESSAGE. The `as any` was the whole defect; this writer uses the real
 * schema shape (role/agentName/content — the same shape the cascade-gated
 * resolver already uses) with no cast, so a schema drift is a compile
 * error, not a runtime surprise.
 *
 * supportReplyChokepoint.test.ts pins this as the ONLY agent-autonomous
 * insert site; the callers keep their own gates (the decisions-inbox
 * approval flow, the executor's cadence) — this is the mechanism, not the
 * authority.
 */
import { db } from "../../db";
import { and, eq } from "drizzle-orm";
import { supportTicketMessages, supportTickets } from "@shared/schema";
import { logger } from "../../utils/logger";

export interface AgentSupportReply {
  ticketId: number;
  /**
   * The org the ticket must belong to. The platform cadences that call this
   * operate across orgs by design, but each REPLY is scoped: a wrong or
   * foreign pairing posts nothing (rule-1 tenancy gate, 2026-08-29).
   */
  organizationId: number;
  /** The visible reply body. Required, non-empty. */
  content: string;
  /** Which agent speaks — recorded in agent_name for telemetry and the UI. */
  agentName: string;
  /** Also mark the ticket resolved (the escalation-approval flow does). */
  resolveTicket?: boolean;
}

export async function postAgentSupportReply(
  reply: AgentSupportReply,
): Promise<{ posted: boolean; detail: string }> {
  const content = reply.content?.trim();
  if (!reply.ticketId || !reply.organizationId || !content) {
    return { posted: false, detail: "supportReply: ticketId, organizationId and non-empty content are required" };
  }
  try {
    // Scoped existence check: the (ticketId, organizationId) pairing is
    // verified in the query itself — a foreign ticket id posts nothing.
    const [ticket] = await db
      .select({ id: supportTickets.id })
      .from(supportTickets)
      .where(and(eq(supportTickets.id, reply.ticketId), eq(supportTickets.organizationId, reply.organizationId)));
    if (!ticket) {
      return { posted: false, detail: `supportReply: ticket #${reply.ticketId} not found in org ${reply.organizationId}` };
    }
    await db.insert(supportTicketMessages).values({
      ticketId: reply.ticketId,
      role: "agent",
      agentName: reply.agentName,
      content,
    });
    if (reply.resolveTicket) {
      await db
        .update(supportTickets)
        .set({ status: "resolved", resolvedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(supportTickets.id, reply.ticketId), eq(supportTickets.organizationId, reply.organizationId)));
    }
    return {
      posted: true,
      detail: `Reply posted to ticket #${reply.ticketId} as ${reply.agentName}${reply.resolveTicket ? " (resolved)" : ""}`,
    };
  } catch (err) {
    logger.error("[supportReply] insert failed", err, {
      metadata: { ticketId: reply.ticketId, agentName: reply.agentName },
    });
    return {
      posted: false,
      detail: `supportReply: insert failed — ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

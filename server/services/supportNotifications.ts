/**
 * supportNotifications — RAFE (Tahoe Wave-2)
 * ==========================================
 *
 * First-response SLA (< 15 min) is only possible if a human actually finds out
 * a customer needs help — in real time, not by polling a dashboard. Before
 * customer #1 we have two inbound paths that must surface to the founder:
 *
 *   1. A customer files a ticket  (POST /api/support/tickets)
 *   2. Pax escalates a case       (supportBrain.escalateCase)
 *
 * Both now drop a founder-visible `system_alerts` row with alertType
 * "escalation". That table is the canonical founder-notification surface —
 * /founder/escalations, the founder pulse, and the alert-policy router all read
 * it — so this guarantees a HUMAN-VISIBLE QUEUE ENTRY, not just a status flag
 * on the case. Escalation previously only set status="escalated" + an activity
 * log line, neither of which pages the founder.
 *
 * These helpers are intentionally best-effort and self-contained: they never
 * throw into the caller (a notification failure must never block ticket
 * creation or a customer-facing escalation response).
 */

import { db } from "../db";
import { systemAlerts } from "@shared/schema";
import { logger } from "../utils/logger";

export type SupportNotifyReason = "created" | "escalated";

interface NotifyFounderOfTicketArgs {
  orgId: number;
  orgName?: string | null;
  ticketId: number | string;
  subject?: string | null;
  priority?: string | null;
  /** "created" = new inbound ticket; "escalated" = Pax handed off to a human. */
  reason: SupportNotifyReason;
  /** Optional escalation reason (Pax → human handoff context). */
  escalationReason?: string | null;
}

/**
 * Maps ticket priority + reason to the system_alerts severity ladder.
 * Escalations are always at least "warning" (a human MUST pick them up);
 * urgent/critical tickets escalate to "critical".
 */
function severityFor(reason: SupportNotifyReason, priority?: string | null): "info" | "warning" | "critical" {
  const p = (priority || "").toLowerCase();
  if (p === "urgent" || p === "critical" || p === "high") return "critical";
  if (reason === "escalated") return "warning";
  return "info";
}

/**
 * Create a founder-visible alert for a support ticket event. Best-effort:
 * logs and swallows on failure so the caller's primary flow is never blocked.
 */
export async function notifyFounderOfTicket(args: NotifyFounderOfTicketArgs): Promise<void> {
  const { orgId, orgName, ticketId, subject, priority, reason, escalationReason } = args;
  try {
    const severity = severityFor(reason, priority);
    const who = orgName ? `${orgName}` : `org #${orgId}`;
    const title =
      reason === "escalated"
        ? `Support escalation — ${who}`
        : `New support ticket — ${who}`;
    const message =
      reason === "escalated"
        ? `Pax escalated ticket #${ticketId}${subject ? ` ("${subject}")` : ""} to a human${escalationReason ? `: ${escalationReason}` : ""}. First response within SLA.`
        : `${who} filed ticket #${ticketId}${subject ? `: "${subject}"` : ""}. First response within SLA.`;

    await db.insert(systemAlerts).values({
      type: reason === "escalated" ? "support_escalation" : "support_ticket_created",
      alertType: "escalation",
      severity,
      organizationId: orgId,
      title,
      message,
      relatedEntityType: "support_case",
      relatedEntityId: typeof ticketId === "number" ? ticketId : Number(ticketId) || null,
      status: "new",
      metadata: {
        reason,
        priority: priority || "normal",
        subject: subject || null,
        escalationReason: escalationReason || null,
      },
    });

    logger.info("[support-notify] founder alert created", {
      metadata: { orgId, ticketId, reason, severity },
    });
  } catch (err) {
    logger.warn("[support-notify] failed to create founder alert", {
      metadata: { orgId, ticketId, reason, error: (err as Error).message },
    });
  }
}

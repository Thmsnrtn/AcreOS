/**
 * Send guardrails — the post-tap envelope every Pax send honours.
 *
 * Enforces the daily send envelope (50 emails / 20 texts, from real rows)
 * and TCPA consent before a send goes out, and keeps the audit trail of
 * sends in agentMemory so the rate limiter and the daily briefing count them.
 *
 * WHAT THIS MODULE NO LONGER HOLDS (customer autonomy clarity program,
 * 2026-09-02, docs/autonomous/AUTONOMY_SPEC.md §3d / §4.3): the
 * `AutonomyLevel` type, `getOrgAutonomyLevel`, `unattendedSendPermitted`,
 * the graduated ramp (`getAutonomyEligibility`) and the circuit breaker
 * (`checkCircuitBreaker`). Whether Pax may send without a tap is not a level
 * any more — every Pax-written message waits for a tap at every stance
 * (founder decision 1), and the ONE lever is OFFERED_STANCES in
 * shared/pax-controls.ts. The send cases in server/ai/tools.ts run only
 * after the approval kernel's tap, so the per-tool level branches were dead
 * and are gone; `organizations.pax_autonomy_level` is dropped by a later
 * migration once the zero-reader ratchet is green.
 */

import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { agentMemory } from "@shared/schema";
import { logger } from "../utils/logger";

// ── Constants ──────────────────────────────────────────────────────────────────

const EMAIL_DAILY_LIMIT = 50;
const SMS_DAILY_LIMIT   = 20;

// ── Core Guardrail Functions ───────────────────────────────────────────────────

/**
 * Check whether a send is within the daily envelope for the given org and
 * channel. Runs AFTER the human tap — the kernel gate decides whether a send
 * may happen at all; this decides whether today still has room for it.
 *
 * Counts sends recorded via recordAutonomousSend() in agentMemory for today.
 */
export async function checkSendRateLimit(
  orgId: number,
  channelType: "email" | "sms"
): Promise<{ allowed: boolean; reason?: string }> {
  try {
    const todayKey = `autonomous_send_log_${new Date().toISOString().slice(0, 10)}`;

    const rows = await db
      .select({ value: agentMemory.value })
      .from(agentMemory)
      .where(
        and(
          eq(agentMemory.organizationId, orgId),
          eq(agentMemory.agentType, "pax"),
          eq(agentMemory.memoryType, "fact"),
          eq(agentMemory.key, todayKey)
        )
      )
      .limit(1);

    const existingSends: Array<Record<string, any>> = Array.isArray(
      (rows[0]?.value as any)?.sends
    )
      ? (rows[0].value as any).sends
      : [];

    const channelSends = existingSends.filter(
      (s) => s.channelType === channelType
    ).length;

    const limit = channelType === "email" ? EMAIL_DAILY_LIMIT : SMS_DAILY_LIMIT;

    if (channelSends >= limit) {
      return {
        allowed: false,
        reason: `Daily send limit reached (${channelSends}/${limit} ${channelType}s today)`,
      };
    }

    return { allowed: true };
  } catch (err: any) {
    logger.error("[autonomyGuardrails] checkSendRateLimit error", err);
    // Fail safe on error
    return { allowed: false, reason: "Daily send limit check failed — the send was not made" };
  }
}

/**
 * Check TCPA compliance for a lead before a send goes out.
 *
 * 2026-06-10 (T0-5, elevation blueprint): this used to look the lead up by
 * bare id across ALL orgs — a latent cross-tenant read on the send path (an
 * attacker-influenced lead_id could probe another org's consent state, and a
 * wrong id could pass a check against someone else's lead). orgId is now a
 * REQUIRED first parameter so the compiler forces every caller to scope it.
 */
export async function checkTcpaBeforeSend(
  orgId: number,
  leadId: number
): Promise<{ allowed: boolean; reason?: string }> {
  try {
    const { leads } = await import("@shared/schema");
    const rows = await db
      .select({
        tcpaConsent: leads.tcpaConsent,
        doNotContact: leads.doNotContact,
        optOutDate: leads.optOutDate,
        status: leads.status,
      })
      .from(leads)
      .where(and(eq(leads.id, leadId), eq(leads.organizationId, orgId)))
      .limit(1);

    const lead = rows[0];
    if (!lead) {
      return { allowed: false, reason: `Lead ${leadId} not found in this organization` };
    }

    // Hard DNC flag
    if (lead.doNotContact) {
      return { allowed: false, reason: "Lead is marked do-not-contact" };
    }

    // Opted out
    if (lead.optOutDate) {
      return { allowed: false, reason: "Lead has opted out of communications" };
    }

    // TCPA consent required for SMS
    if (!lead.tcpaConsent) {
      return { allowed: false, reason: "No TCPA consent on record for this lead" };
    }

    // Dead/closed leads — never contact autonomously
    if (["dead", "closed", "lost"].includes(lead.status ?? "")) {
      return {
        allowed: false,
        reason: `Lead status is "${lead.status}" — Pax will not contact them`,
      };
    }

    return { allowed: true };
  } catch (err: any) {
    logger.error("[autonomyGuardrails] checkTcpaBeforeSend error", err);
    return { allowed: false, reason: "TCPA check failed — the send was not made" };
  }
}

/**
 * Records that an autonomous send occurred.
 * Appends to the daily send log in agentMemory.
 * This is the source of truth for checkSendRateLimit().
 */
export async function recordAutonomousSend(
  orgId: number,
  channelType: "email" | "sms",
  leadId: number,
  content: string
): Promise<void> {
  try {
    const todayKey = `autonomous_send_log_${new Date().toISOString().slice(0, 10)}`;

    // Fetch existing log for today
    const rows = await db
      .select({ value: agentMemory.value })
      .from(agentMemory)
      .where(
        and(
          eq(agentMemory.organizationId, orgId),
          eq(agentMemory.agentType, "pax"),
          eq(agentMemory.memoryType, "fact"),
          eq(agentMemory.key, todayKey)
        )
      )
      .limit(1);

    const existing = Array.isArray((rows[0]?.value as any)?.sends)
      ? (rows[0].value as any).sends
      : [];

    const newEntry = {
      channelType,
      leadId,
      content: content.slice(0, 100),
      timestamp: new Date().toISOString(),
    };

    const updatedSends = [...existing, newEntry];

    if (rows.length > 0) {
      // Update in place
      await db
        .delete(agentMemory)
        .where(
          and(
            eq(agentMemory.organizationId, orgId),
            eq(agentMemory.agentType, "pax"),
            eq(agentMemory.memoryType, "fact"),
            eq(agentMemory.key, todayKey)
          )
        );
    }

    await db.insert(agentMemory).values({
      organizationId: orgId,
      agentType: "pax",
      memoryType: "fact",
      key: todayKey,
      value: { sends: updatedSends },
      confidence: "1.0",
    });

    logger.info(`[autonomyGuardrails] Recorded autonomous ${channelType} send for org ${orgId}, lead ${leadId}`);
  } catch (err: any) {
    logger.error("[autonomyGuardrails] recordAutonomousSend error", err);
    // Non-blocking — don't throw; the send already happened
  }
}

/**
 * Generates a human-readable markdown summary of all autonomous actions taken
 * in the last N hours. Used for the daily digest email / Pax morning briefing.
 */
export async function generateAutonomousAuditSummary(
  orgId: number,
  hours: number = 24
): Promise<string> {
  try {
    const now = new Date();
    const cutoff = new Date(now.getTime() - hours * 60 * 60 * 1000);

    // Gather all daily log keys within the window
    // Keys are formatted: autonomous_send_log_YYYY-MM-DD
    // We need to check today and potentially yesterday
    const datesToCheck: string[] = [];
    const cursor = new Date(cutoff);
    while (cursor <= now) {
      datesToCheck.push(cursor.toISOString().slice(0, 10));
      cursor.setDate(cursor.getDate() + 1);
    }

    const allSends: Array<{
      channelType: "email" | "sms";
      leadId: number;
      content: string;
      timestamp: string;
    }> = [];

    for (const date of datesToCheck) {
      const key = `autonomous_send_log_${date}`;
      const rows = await db
        .select({ value: agentMemory.value })
        .from(agentMemory)
        .where(
          and(
            eq(agentMemory.organizationId, orgId),
            eq(agentMemory.agentType, "pax"),
            eq(agentMemory.memoryType, "fact"),
            eq(agentMemory.key, key)
          )
        )
        .limit(1);

      if (!rows[0]) continue;
      const sends = Array.isArray((rows[0].value as any)?.sends)
        ? (rows[0].value as any).sends
        : [];

      for (const s of sends) {
        const ts = new Date(s.timestamp ?? 0);
        if (ts >= cutoff && ts <= now) {
          allSends.push(s);
        }
      }
    }

    if (allSends.length === 0) {
      return `**Pax Autonomous Activity (last ${hours}h):** No autonomous actions taken.`;
    }

    const emails = allSends.filter((s) => s.channelType === "email");
    const smsList = allSends.filter((s) => s.channelType === "sms");
    const uniqueLeads = new Set(allSends.map((s) => s.leadId)).size;

    // Simple content classification based on snippet
    const classify = (content: string): string => {
      const lower = content.toLowerCase();
      if (lower.includes("follow") || lower.includes("checking in")) return "follow-up sequences";
      if (lower.includes("offer") || lower.includes("price"))        return "offer outreach";
      if (lower.includes("hello") || lower.includes("introduce"))    return "new lead outreach";
      return "general outreach";
    };

    const actionCounts: Record<string, number> = {};
    for (const s of allSends) {
      const label = classify(s.content ?? "");
      actionCounts[label] = (actionCounts[label] ?? 0) + 1;
    }

    const topActions = Object.entries(actionCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([label, n]) => `${label} (${n})`)
      .join(", ");

    const parts: string[] = [
      `**Pax Autonomous Activity (last ${hours}h):**`,
      `Sent ${emails.length} email${emails.length !== 1 ? "s" : ""},`,
      `${smsList.length} SMS message${smsList.length !== 1 ? "s" : ""}`,
      `to ${uniqueLeads} lead${uniqueLeads !== 1 ? "s" : ""}.`,
    ];

    if (topActions) {
      parts.push(`Top actions: ${topActions}.`);
    }

    return parts.join(" ");
  } catch (err: any) {
    logger.error("[autonomyGuardrails] generateAutonomousAuditSummary error", err);
    return `**Pax Autonomous Activity (last ${hours}h):** Summary unavailable due to an internal error.`;
  }
}

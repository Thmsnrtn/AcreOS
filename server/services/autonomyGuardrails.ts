/**
 * Autonomy Guardrails — Safety limits for Pax autonomous operation.
 *
 * Enforces rate limits and TCPA compliance before any autonomous send action.
 * Provides an audit trail of autonomous actions via agentMemory.
 *
 * Autonomy levels (planned):
 *   'assisted'   — current default; all sends require human approval
 *   'supervised' — Pax can send within daily limits with consent checks
 *   'autonomous' — Pax can send freely within guardrails (future)
 *
 * When organizations.paxAutonomyLevel is added to the schema, getOrgAutonomyLevel()
 * will read from it. Until then it always returns 'assisted'.
 */

import { db } from "../db";
import { eq, and, gte, sql } from "drizzle-orm";
import { agentMemory, organizations } from "@shared/schema";
import { storage } from "../storage";

// ── Constants ──────────────────────────────────────────────────────────────────

const EMAIL_DAILY_LIMIT = 50;
const SMS_DAILY_LIMIT   = 20;

// ── Exported Types ─────────────────────────────────────────────────────────────

export type AutonomyLevel = "assisted" | "supervised" | "autonomous";

// ── Core Guardrail Functions ───────────────────────────────────────────────────

/**
 * Check whether an autonomous send is within the daily rate limit for the
 * given org and channel.
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
        reason: `Daily autonomous send limit reached (${channelSends}/${limit} ${channelType}s)`,
      };
    }

    return { allowed: true };
  } catch (err: any) {
    console.error("[autonomyGuardrails] checkSendRateLimit error:", err.message);
    // Fail safe on error
    return { allowed: false, reason: "Rate limit check failed — blocking autonomous send" };
  }
}

/**
 * Check TCPA compliance for a lead before an autonomous SMS send.
 * Uses storage.getLead() to retrieve the lead and inspect consent fields.
 */
export async function checkTcpaBeforeSend(
  leadId: number
): Promise<{ allowed: boolean; reason?: string }> {
  try {
    // getLead requires orgId — we search by leadId across storage
    // storage.getLead(orgId, id) — we need the lead's org first
    // Use a raw db query to get the lead without knowing orgId up front
    const { leads } = await import("@shared/schema");
    const rows = await db
      .select({
        tcpaConsent: leads.tcpaConsent,
        doNotContact: leads.doNotContact,
        optOutDate: leads.optOutDate,
        status: leads.status,
      })
      .from(leads)
      .where(eq(leads.id, leadId))
      .limit(1);

    const lead = rows[0];
    if (!lead) {
      return { allowed: false, reason: `Lead ${leadId} not found` };
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
        reason: `Lead status is "${lead.status}" — Pax will not contact them autonomously`,
      };
    }

    return { allowed: true };
  } catch (err: any) {
    console.error("[autonomyGuardrails] checkTcpaBeforeSend error:", err.message);
    return { allowed: false, reason: "TCPA check failed — blocking autonomous send" };
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

    console.log(
      `[autonomyGuardrails] Recorded autonomous ${channelType} send for org ${orgId}, lead ${leadId}`
    );
  } catch (err: any) {
    console.error("[autonomyGuardrails] recordAutonomousSend error:", err.message);
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
    console.error("[autonomyGuardrails] generateAutonomousAuditSummary error:", err.message);
    return `**Pax Autonomous Activity (last ${hours}h):** Summary unavailable due to an internal error.`;
  }
}

/**
 * Returns the autonomy level for an org.
 *
 * TODO: When organizations.paxAutonomyLevel is added to the schema, replace the
 * hardcoded return with:
 *   const org = await storage.getOrganization(orgId);
 *   return ((org as any).paxAutonomyLevel as AutonomyLevel) ?? "assisted";
 */
export async function getOrgAutonomyLevel(
  orgId: number
): Promise<AutonomyLevel> {
  // TODO: Read paxAutonomyLevel from organizations table once the column is added.
  return "assisted";
}

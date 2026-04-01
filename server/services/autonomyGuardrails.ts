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
import { logger } from "../utils/logger";

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
    logger.error("[autonomyGuardrails] checkSendRateLimit error", err);
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
    logger.error("[autonomyGuardrails] checkTcpaBeforeSend error", err);
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

// ── Graduated Autonomy Ramp ──────────────────────────────────────────────────

const RAMP_MIN_DAYS_FOR_SUPERVISED = 7;
const RAMP_MIN_MANUAL_REVIEWS_FOR_SUPERVISED = 20;
const RAMP_MIN_DAYS_SUPERVISED = 30;
const RAMP_MAX_OVERRIDE_RATE_FOR_AUTONOMOUS = 0.05; // 5%

export interface AutonomyEligibility {
  currentLevel: AutonomyLevel;
  upgradeAvailable: boolean;
  nextLevel: AutonomyLevel | null;
  reason: string;
  metrics: {
    orgAgeDays: number;
    manualReviews: number;
    daysSupervisedStarted: number | null;
    overrideRate: number | null;
  };
}

/**
 * Checks the current autonomy level for an org and whether an upgrade is available.
 *
 * Graduation path:
 *   1. New orgs start "assisted"
 *   2. After 7 days + 20 manual reviews → eligible for "supervised"
 *   3. After 30 days supervised + <5% override rate → eligible for "autonomous"
 */
export async function getAutonomyEligibility(
  organizationId: number
): Promise<AutonomyEligibility> {
  try {
    const currentLevel = await getOrgAutonomyLevel(organizationId);

    // Fetch the org to get creation date
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, organizationId),
    });

    const orgCreatedAt = org?.createdAt ? new Date(org.createdAt) : new Date();
    const orgAgeDays = Math.floor(
      (Date.now() - orgCreatedAt.getTime()) / (1000 * 60 * 60 * 24)
    );

    // Count manual reviews (agent memory entries where founder took action)
    const reviewRows = await db
      .select({ count: sql<number>`count(*)` })
      .from(agentMemory)
      .where(
        and(
          eq(agentMemory.organizationId, organizationId),
          eq(agentMemory.agentType, "pax"),
          eq(agentMemory.memoryType, "fact"),
          sql`${agentMemory.key} LIKE 'founder_review_%'`
        )
      );
    const manualReviews = Number(reviewRows[0]?.count ?? 0);

    // Check for supervised start date (stored in agent memory)
    const supervisedStartRows = await db
      .select({ value: agentMemory.value })
      .from(agentMemory)
      .where(
        and(
          eq(agentMemory.organizationId, organizationId),
          eq(agentMemory.agentType, "pax"),
          eq(agentMemory.memoryType, "fact"),
          eq(agentMemory.key, "autonomy_supervised_started_at")
        )
      )
      .limit(1);

    const supervisedStartedAt = supervisedStartRows[0]
      ? new Date((supervisedStartRows[0].value as any)?.date ?? 0)
      : null;
    const daysSupervisedStarted = supervisedStartedAt
      ? Math.floor((Date.now() - supervisedStartedAt.getTime()) / (1000 * 60 * 60 * 24))
      : null;

    // Count overrides (founder overrode an autonomous decision)
    let overrideRate: number | null = null;
    if (currentLevel === "supervised" && daysSupervisedStarted !== null) {
      const overrideRows = await db
        .select({ count: sql<number>`count(*)` })
        .from(agentMemory)
        .where(
          and(
            eq(agentMemory.organizationId, organizationId),
            eq(agentMemory.agentType, "pax"),
            eq(agentMemory.memoryType, "fact"),
            sql`${agentMemory.key} LIKE 'autonomy_override_%'`
          )
        );
      const totalOverrides = Number(overrideRows[0]?.count ?? 0);

      const totalDecisionRows = await db
        .select({ count: sql<number>`count(*)` })
        .from(agentMemory)
        .where(
          and(
            eq(agentMemory.organizationId, organizationId),
            eq(agentMemory.agentType, "pax"),
            eq(agentMemory.memoryType, "fact"),
            sql`${agentMemory.key} LIKE 'autonomy_decision_%'`
          )
        );
      const totalDecisions = Number(totalDecisionRows[0]?.count ?? 0);

      overrideRate = totalDecisions > 0 ? totalOverrides / totalDecisions : null;
    }

    const metrics = {
      orgAgeDays,
      manualReviews,
      daysSupervisedStarted,
      overrideRate,
    };

    // Evaluate eligibility based on current level
    if (currentLevel === "assisted") {
      if (
        orgAgeDays >= RAMP_MIN_DAYS_FOR_SUPERVISED &&
        manualReviews >= RAMP_MIN_MANUAL_REVIEWS_FOR_SUPERVISED
      ) {
        return {
          currentLevel,
          upgradeAvailable: true,
          nextLevel: "supervised",
          reason: `Org has been active ${orgAgeDays} days with ${manualReviews} manual reviews. Eligible for supervised autonomy.`,
          metrics,
        };
      }
      return {
        currentLevel,
        upgradeAvailable: false,
        nextLevel: null,
        reason: `Needs ${Math.max(0, RAMP_MIN_DAYS_FOR_SUPERVISED - orgAgeDays)} more days and ${Math.max(0, RAMP_MIN_MANUAL_REVIEWS_FOR_SUPERVISED - manualReviews)} more manual reviews before supervised is available.`,
        metrics,
      };
    }

    if (currentLevel === "supervised") {
      if (
        daysSupervisedStarted !== null &&
        daysSupervisedStarted >= RAMP_MIN_DAYS_SUPERVISED &&
        overrideRate !== null &&
        overrideRate < RAMP_MAX_OVERRIDE_RATE_FOR_AUTONOMOUS
      ) {
        return {
          currentLevel,
          upgradeAvailable: true,
          nextLevel: "autonomous",
          reason: `Supervised for ${daysSupervisedStarted} days with ${(overrideRate * 100).toFixed(1)}% override rate. Eligible for full autonomy.`,
          metrics,
        };
      }
      const reasons: string[] = [];
      if (daysSupervisedStarted === null || daysSupervisedStarted < RAMP_MIN_DAYS_SUPERVISED) {
        reasons.push(
          `${Math.max(0, RAMP_MIN_DAYS_SUPERVISED - (daysSupervisedStarted ?? 0))} more days in supervised mode`
        );
      }
      if (overrideRate === null || overrideRate >= RAMP_MAX_OVERRIDE_RATE_FOR_AUTONOMOUS) {
        reasons.push(
          `override rate must drop below ${RAMP_MAX_OVERRIDE_RATE_FOR_AUTONOMOUS * 100}% (currently ${overrideRate !== null ? (overrideRate * 100).toFixed(1) + "%" : "N/A"})`
        );
      }
      return {
        currentLevel,
        upgradeAvailable: false,
        nextLevel: null,
        reason: `Needs: ${reasons.join("; ")}.`,
        metrics,
      };
    }

    // Already autonomous
    return {
      currentLevel,
      upgradeAvailable: false,
      nextLevel: null,
      reason: "Already at maximum autonomy level.",
      metrics,
    };
  } catch (err: any) {
    logger.error("[autonomyGuardrails] getAutonomyEligibility error", err);
    return {
      currentLevel: "assisted",
      upgradeAvailable: false,
      nextLevel: null,
      reason: `Error evaluating eligibility: ${err.message}`,
      metrics: { orgAgeDays: 0, manualReviews: 0, daysSupervisedStarted: null, overrideRate: null },
    };
  }
}

// ── Circuit Breaker ──────────────────────────────────────────────────────────

const CIRCUIT_BREAKER_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const CIRCUIT_BREAKER_OVERRIDE_THRESHOLD = 3;

export interface CircuitBreakerResult {
  tripped: boolean;
  overridesInWindow: number;
  downgraded: boolean;
  reason: string;
}

/**
 * Circuit breaker: if 3+ overrides happen within 1 hour, auto-downgrade to
 * "assisted" and notify the founder.
 *
 * Call this after every founder override of an autonomous decision.
 */
export async function checkCircuitBreaker(
  organizationId: number
): Promise<CircuitBreakerResult> {
  try {
    const windowStart = new Date(Date.now() - CIRCUIT_BREAKER_WINDOW_MS);

    // Count overrides within the last hour
    const overrideRows = await db
      .select({ value: agentMemory.value, createdAt: agentMemory.createdAt })
      .from(agentMemory)
      .where(
        and(
          eq(agentMemory.organizationId, organizationId),
          eq(agentMemory.agentType, "pax"),
          eq(agentMemory.memoryType, "fact"),
          sql`${agentMemory.key} LIKE 'autonomy_override_%'`,
          gte(agentMemory.createdAt, windowStart)
        )
      );

    const overridesInWindow = overrideRows.length;

    if (overridesInWindow < CIRCUIT_BREAKER_OVERRIDE_THRESHOLD) {
      return {
        tripped: false,
        overridesInWindow,
        downgraded: false,
        reason: `${overridesInWindow}/${CIRCUIT_BREAKER_OVERRIDE_THRESHOLD} overrides in the last hour. No action needed.`,
      };
    }

    // Circuit breaker tripped — downgrade to assisted
    // Record the downgrade event
    await db.insert(agentMemory).values({
      organizationId,
      agentType: "pax",
      memoryType: "fact",
      key: `circuit_breaker_trip_${new Date().toISOString()}`,
      value: {
        trippedAt: new Date().toISOString(),
        overridesInWindow,
        previousOverrides: overrideRows.map((r) => r.value),
        action: "downgraded_to_assisted",
      },
      confidence: "1.0",
    });

    // TODO: When organizations.paxAutonomyLevel column exists, update it here:
    // await db.update(organizations)
    //   .set({ paxAutonomyLevel: "assisted", updatedAt: new Date() })
    //   .where(eq(organizations.id, organizationId));

    // Notify founder via email
    const { emailService } = await import("./emailService");
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, organizationId),
    });
    const founderEmail =
      (org as any)?.contactEmail ||
      (org as any)?.ownerEmail ||
      process.env.FOUNDER_EMAIL;

    if (founderEmail) {
      await emailService.sendEmail({
        to: founderEmail,
        subject: `[AcreOS] Autonomy circuit breaker tripped for ${org?.name ?? `Org #${organizationId}`}`,
        html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;">
          <h2 style="color:#c0392b;">Autonomy Circuit Breaker Tripped</h2>
          <p><strong>${overridesInWindow} founder overrides</strong> detected within the last hour for <strong>${org?.name ?? `Org #${organizationId}`}</strong>.</p>
          <p>The organization has been automatically downgraded to <strong>assisted</strong> mode. All autonomous decisions now require manual approval.</p>
          <p>Review recent decisions at <a href="${process.env.APP_URL || "https://app.acreos.com"}/founder/autonomy-log">the autonomy log</a> and re-enable when ready.</p>
          <p style="color:#7f8c8d;font-size:12px;">This is an automated safety notification from the AcreOS autonomy system.</p>
        </div>`,
        text: `Autonomy Circuit Breaker Tripped\n\n${overridesInWindow} founder overrides detected within the last hour for ${org?.name ?? `Org #${organizationId}`}.\n\nThe organization has been automatically downgraded to "assisted" mode. All autonomous decisions now require manual approval.\n\nReview recent decisions at the autonomy log and re-enable when ready.`,
      });
    }

    logger.warn(`[autonomyGuardrails] CIRCUIT BREAKER TRIPPED for org ${organizationId}: ` +
      `${overridesInWindow} overrides in 1h. Downgraded to assisted.`);

    return {
      tripped: true,
      overridesInWindow,
      downgraded: true,
      reason: `Circuit breaker tripped: ${overridesInWindow} overrides in the last hour. Org downgraded to assisted mode. Founder notified.`,
    };
  } catch (err: any) {
    logger.error("[autonomyGuardrails] checkCircuitBreaker error", err);
    // Fail safe — report as tripped so caller can take defensive action
    return {
      tripped: true,
      overridesInWindow: -1,
      downgraded: false,
      reason: `Circuit breaker check failed: ${err.message}. Treating as tripped for safety.`,
    };
  }
}

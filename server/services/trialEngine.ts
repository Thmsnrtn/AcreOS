/**
 * Pillar E / E1 — Trial-to-paid conversion automation.
 *
 * Runs daily. For each org with a trial in the conversion window:
 *
 *   - 24h before trial end: send "trial ending tomorrow" nudge
 *   - At trial end (within last 6h):     send "trial ended" follow-up
 *
 * Each touch is idempotent via subscriptionHistory rows so we never
 * double-send. The actual email goes through the existing
 * subscriptionEmails service; this module is just the trigger + dedup
 * logic.
 *
 * Conversion-rate measurement: subscriptionHistory.eventType already
 * captures upgrade events. The cohort of orgs we touched divided by
 * the cohort that converted within 14 days = trial→paid rate.
 */

import { db } from "../db";
import { organizations, subscriptionHistory } from "@shared/schema";
import { and, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { logger } from "../utils/logger";

const REMINDER_EVENT = "trial_ending_reminder_sent";
const EXPIRED_EVENT = "trial_ended_followup_sent";

export interface TrialEngineResult {
  remindersSent: number;
  followupsSent: number;
  skipped: number;
}

/**
 * Has the org already received a given lifecycle email in the last 7 days?
 * Prevents double-sending if the cron retries or runs twice in a day.
 */
async function alreadyTouched(orgId: number, eventType: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({ id: subscriptionHistory.id })
    .from(subscriptionHistory)
    .where(
      and(
        eq(subscriptionHistory.organizationId, orgId),
        eq(subscriptionHistory.eventType, eventType),
        gte(subscriptionHistory.eventAt, cutoff),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Records that we sent a given lifecycle email. Uses subscriptionHistory
 * as the dedup ledger so the trial engine doesn't need its own table.
 */
async function recordTouch(
  orgId: number,
  eventType: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await db.insert(subscriptionHistory).values({
    organizationId: orgId,
    eventType,
    eventAt: new Date(),
    metadata,
  });
}

/**
 * Pulls the email-render helper lazily — keeps the trial engine
 * independent of which mail provider is wired and prevents a circular
 * import with the growth-automation engine.
 */
async function sendTrialEmail(
  orgId: number,
  kind: "ending_soon" | "ended",
  ctx: { trialEndsAt: Date | null },
): Promise<{ sent: boolean; reason?: string }> {
  try {
    const grow = (await import("../jobs/growthAutomation").catch(() => null)) as
      | (Record<string, unknown> & { queueGrowthEmail?: (input: unknown) => Promise<unknown> })
      | null;
    if (grow && typeof grow.queueGrowthEmail === "function") {
      await grow.queueGrowthEmail({
        organizationId: orgId,
        emailType: kind === "ending_soon" ? "trial_ending_soon" : "trial_ended",
        context: { trialEndsAt: ctx.trialEndsAt?.toISOString() ?? null },
      });
      return { sent: true };
    }
    return { sent: false, reason: "no email backend available — trial engine logged the event only" };
  } catch (err) {
    return { sent: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Main entrypoint. Scans active trials, sends the appropriate touch,
 * records each in subscriptionHistory.
 */
export async function runTrialExpiryCycle(): Promise<TrialEngineResult> {
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);

  let remindersSent = 0;
  let followupsSent = 0;
  let skipped = 0;

  // ── Reminder cohort: trial ends in [now, now+24h] ────────────────────────
  const reminderRows = await db
    .select({
      id: organizations.id,
      trialEndsAt: organizations.trialEndsAt,
      subscriptionStatus: organizations.subscriptionStatus,
    })
    .from(organizations)
    .where(
      and(
        isNotNull(organizations.trialEndsAt),
        gte(organizations.trialEndsAt, now),
        lte(organizations.trialEndsAt, in24h),
        sql`COALESCE(${organizations.subscriptionStatus}, '') IN ('trialing', 'trial', '')`,
      ),
    );

  for (const org of reminderRows) {
    if (await alreadyTouched(org.id, REMINDER_EVENT)) {
      skipped++;
      continue;
    }
    const result = await sendTrialEmail(org.id, "ending_soon", { trialEndsAt: org.trialEndsAt });
    await recordTouch(org.id, REMINDER_EVENT, {
      sent: result.sent,
      reason: result.reason ?? null,
      trialEndsAt: org.trialEndsAt?.toISOString() ?? null,
    });
    if (result.sent) {
      remindersSent++;
      logger.info("[trial-engine] reminder sent", {
        source: "trial-engine",
        metadata: { orgId: org.id, trialEndsAt: org.trialEndsAt?.toISOString() ?? null },
      });
    } else {
      logger.warn("[trial-engine] reminder send failed", {
        source: "trial-engine",
        metadata: { orgId: org.id, reason: result.reason ?? "unknown" },
      });
    }
  }

  // ── Followup cohort: trial ended in last 6h ──────────────────────────────
  const followupRows = await db
    .select({
      id: organizations.id,
      trialEndsAt: organizations.trialEndsAt,
      subscriptionStatus: organizations.subscriptionStatus,
    })
    .from(organizations)
    .where(
      and(
        isNotNull(organizations.trialEndsAt),
        lte(organizations.trialEndsAt, now),
        gte(organizations.trialEndsAt, sixHoursAgo),
        sql`COALESCE(${organizations.subscriptionStatus}, '') NOT IN ('active', 'past_due')`,
      ),
    );

  for (const org of followupRows) {
    if (await alreadyTouched(org.id, EXPIRED_EVENT)) {
      skipped++;
      continue;
    }
    const result = await sendTrialEmail(org.id, "ended", { trialEndsAt: org.trialEndsAt });
    await recordTouch(org.id, EXPIRED_EVENT, {
      sent: result.sent,
      reason: result.reason ?? null,
      trialEndsAt: org.trialEndsAt?.toISOString() ?? null,
    });
    if (result.sent) {
      followupsSent++;
      logger.info("[trial-engine] followup sent", {
        source: "trial-engine",
        metadata: { orgId: org.id, trialEndsAt: org.trialEndsAt?.toISOString() ?? null },
      });
    }
  }

  logger.info("[trial-engine] cycle complete", {
    source: "trial-engine",
    metadata: { remindersSent, followupsSent, skipped },
  });

  return { remindersSent, followupsSent, skipped };
}

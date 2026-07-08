import { db } from "../db";
import {
  organizations, activityLog, supportTickets, churnRiskScores,
  revenueProtectionInterventions, users,
} from "@shared/schema";
import { eq, and, desc, gte, count, sql, max } from "drizzle-orm";
import { emailService } from "./emailService";
import { decisionsInboxService } from "./decisionsInbox";
import { routeAITask, TaskComplexity } from "./aiRouter";
import { logger } from "../utils/logger";

/**
 * Resolve a contact email for an organization. organizations has no email
 * column — the canonical address is settings.companyEmail, falling back to the
 * owner user's email (same convention as dunning.ts).
 */
async function resolveOrgEmail(org: typeof organizations.$inferSelect): Promise<string> {
  const settings = org.settings as Record<string, unknown> | null;
  if (settings?.companyEmail && typeof settings.companyEmail === "string") {
    return settings.companyEmail;
  }
  try {
    const [owner] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.clerkUserId, org.ownerId))
      .limit(1);
    return owner?.email ?? "";
  } catch {
    return "";
  }
}

/** Compute a 0-100 churn risk score for a single org. Returns score + component breakdown. */
async function scoreOrganization(orgId: number) {
  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, orgId) });
  if (!org) return null;

  const now = new Date();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fourteenToSevenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  // 1. Login frequency (0-25): high activity = low score = low risk
  const loginsLast14d = await db.select({ c: count() })
    .from(activityLog)
    .where(and(eq(activityLog.organizationId, orgId), gte(activityLog.createdAt, fourteenDaysAgo)));
  const loginCount = Number(loginsLast14d[0]?.c ?? 0);
  const loginFrequencyScore = Math.max(0, 25 - Math.min(25, Math.round((loginCount / 14) * 25)));

  // 2. Feature usage trend (0-25): compare last 7d vs prior 7d
  const last7dActivity = await db.select({ c: count() })
    .from(activityLog)
    .where(and(eq(activityLog.organizationId, orgId), gte(activityLog.createdAt, sevenDaysAgo)));
  const prior7dActivity = await db.select({ c: count() })
    .from(activityLog)
    .where(and(
      eq(activityLog.organizationId, orgId),
      gte(activityLog.createdAt, fourteenToSevenDaysAgo),
      sql`${activityLog.createdAt} < ${sevenDaysAgo}`,
    ));
  const last7d = Number(last7dActivity[0]?.c ?? 0);
  const prior7d = Number(prior7dActivity[0]?.c ?? 1); // avoid div by 0
  const trendRatio = last7d / prior7d;
  let featureUsageScore = 0;
  let featureUsageTrend: "increasing" | "stable" | "declining" = "stable";
  if (trendRatio < 0.7) {
    featureUsageScore = trendRatio < 0.4 ? 25 : 20;
    featureUsageTrend = "declining";
  } else if (trendRatio > 1.2) {
    featureUsageTrend = "increasing";
  }

  // 3. Support ticket frequency (0-20)
  const ticketsLast30d = await db.select({ c: count() })
    .from(supportTickets)
    .where(and(eq(supportTickets.organizationId, orgId), gte(supportTickets.createdAt, thirtyDaysAgo)));
  const ticketCount = Number(ticketsLast30d[0]?.c ?? 0);
  const supportTicketScore = ticketCount === 0 ? 0 : ticketCount <= 2 ? 5 : ticketCount <= 4 ? 10 : 20;

  // 4. Dunning state (0-20)
  const dunningMap: Record<string, number> = { none: 0, grace_period: 3, warning: 10, restricted: 15, suspended: 20 };
  const dunningStateScore = dunningMap[org.dunningStage ?? "none"] ?? 0;
  const dunningStage = org.dunningStage ?? "none";

  // 5. Days since last active (0-10)
  // organizations has no lastActiveAt column; derive it from the most recent
  // activity-log entry for the org.
  const lastActiveRow = await db
    .select({ lastActiveAt: max(activityLog.createdAt) })
    .from(activityLog)
    .where(eq(activityLog.organizationId, orgId));
  const lastActiveAt = lastActiveRow[0]?.lastActiveAt ?? null;
  const lastActive = lastActiveAt ? new Date(lastActiveAt) : null;
  const daysSinceLastActive = lastActive
    ? Math.floor((now.getTime() - lastActive.getTime()) / (1000 * 60 * 60 * 24))
    : 999;
  let engagementTrendScore = 0;
  if (daysSinceLastActive >= 22) engagementTrendScore = 10;
  else if (daysSinceLastActive >= 15) engagementTrendScore = 6;
  else if (daysSinceLastActive >= 8) engagementTrendScore = 3;

  const riskScore = loginFrequencyScore + featureUsageScore + supportTicketScore + dunningStateScore + engagementTrendScore;
  const riskBand = riskScore >= 90 ? "critical" : riskScore >= 70 ? "red" : riskScore >= 40 ? "yellow" : "green";

  return {
    organizationId: orgId,
    riskScore,
    riskBand,
    loginFrequencyScore,
    featureUsageScore,
    supportTicketScore,
    dunningStateScore,
    engagementTrendScore,
    daysSinceLastActive,
    loginsLast14d: loginCount,
    ticketsLast30d: ticketCount,
    dunningStage,
    featureUsageTrend,
    scoredAt: now,
    org,
  };
}

/**
 * Generate a personalized retention email via the canonical AI router.
 * Migrated from direct requireOpenAIClient() — panel-300 90-15 / gap E.
 *
 * The router consults the per-org cost ceiling (FW-THEO-1), runs prompt-
 * caching where available, and respects the AI_HAIKU_DEFAULT_ENABLED
 * kill-switch. taskTier=standard → Haiku 4.5 by default (60-80% cheaper
 * than direct gpt-4o-mini for the same task class).
 */
async function generateRetentionEmail(
  orgName: string,
  riskBand: string,
  context: { daysSinceLastActive: number; dunningStage: string; ticketsLast30d: number },
  orgId?: number,
): Promise<{ subject: string; html: string }> {
  const response = await routeAITask({
    taskType: "retention_email",
    complexity: TaskComplexity.SIMPLE,
    taskTier: "standard",
    responseFormat: "json",
    messages: [{
      role: "system",
      content: "You are Pax, the AcreOS assistant. Write personalized, empathetic retention emails for Land Investors. Do not refer to yourself by any other name. Return JSON with subject and html fields.",
    }, {
      role: "user",
      content: JSON.stringify({
        orgName,
        riskBand,
        daysSinceLastActive: context.daysSinceLastActive,
        dunningStage: context.dunningStage,
        ticketsLast30d: context.ticketsLast30d,
        instruction: "Write a 3-paragraph retention email. Paragraph 1: acknowledge their business. Paragraph 2: offer specific help. Paragraph 3: clear CTA. Keep it under 200 words. Return { subject, html }",
      }),
    }],
  }, { orgId });

  try {
    const parsed = JSON.parse(response.content ?? "{}");
    return {
      subject: parsed.subject ?? `Quick check-in from your AcreOS team, ${orgName}`,
      html: parsed.html ?? `<p>Hi ${orgName} team,</p><p>We noticed you haven't logged in recently. Can we help with anything?</p>`,
    };
  } catch {
    return {
      subject: `Quick check-in from your AcreOS team, ${orgName}`,
      html: `<p>Hi ${orgName} team,</p><p>We noticed you haven't been active recently. Our team is here to help — reply to this email or log in to get started.</p>`,
    };
  }
}

/** Check if we already sent an intervention to this org recently. */
async function hasRecentIntervention(orgId: number, dayThreshold = 14): Promise<boolean> {
  const cutoff = new Date(Date.now() - dayThreshold * 24 * 60 * 60 * 1000);
  const recent = await db.select({ c: count() })
    .from(revenueProtectionInterventions)
    .where(and(
      eq(revenueProtectionInterventions.organizationId, orgId),
      gte(revenueProtectionInterventions.createdAt, cutoff),
    ));
  return Number(recent[0]?.c ?? 0) > 0;
}

/** Process a single org: score it, upsert score, and run intervention logic. */
async function processOrganization(orgId: number): Promise<void> {
  const scored = await scoreOrganization(orgId);
  if (!scored) return;

  const { riskScore, riskBand, featureUsageTrend, dunningStage, org } = scored;

  // Upsert churn risk score
  const existingScore = await db.query.churnRiskScores.findFirst({
    where: eq(churnRiskScores.organizationId, orgId),
  });
  if (existingScore) {
    await db.update(churnRiskScores)
      .set({ ...scored, scoredAt: new Date() })
      .where(eq(churnRiskScores.id, existingScore.id));
  } else {
    await db.insert(churnRiskScores).values({ ...scored });
  }

  // --- Intervention Logic ---

  // Dunning restricted: always auto-send recovery email regardless of score
  if (dunningStage === "restricted") {
    const alreadySent = await hasRecentIntervention(orgId, 7);
    if (!alreadySent) {
      const stripePortalUrl = process.env.STRIPE_BILLING_PORTAL_URL ?? "https://billing.stripe.com/";
      const emailContent = {
        subject: `Action required: Update your payment method for ${org.name}`,
        html: `<p>Hi ${org.name} team,</p><p>Your AcreOS account has been temporarily restricted due to a payment issue. Please update your payment method to restore full access.</p><p><a href="${stripePortalUrl}">Update Payment Method →</a></p><p>If you have any questions, reply to this email.</p>`,
      };
      const emailResult = await emailService.sendEmail({
        to: await resolveOrgEmail(org),
        subject: emailContent.subject,
        html: emailContent.html,
        organizationId: undefined, // platform-level SES credentials
      });
      await db.insert(revenueProtectionInterventions).values({
        organizationId: orgId,
        interventionType: "dunning_recovery",
        triggerRiskScore: riskScore,
        triggerRiskBand: riskBand,
        executedBy: "sophie",
        sophieMessageSubject: emailContent.subject,
        sophieMessageBody: emailContent.html,
        emailSentAt: new Date(),
        emailDeliveryStatus: emailResult.success ? "sent" : "failed",
        outcome: "pending",
      });
    }
    return;
  }

  // Score 90+ (critical): Create Decisions Inbox item — do NOT auto-send
  if (riskScore >= 90) {
    await decisionsInboxService.createFromChurnRisk(orgId, riskScore);
    return;
  }

  // Score 70-89 (red): Sophie sends retention offer email
  if (riskScore >= 70) {
    const alreadySent = await hasRecentIntervention(orgId, 14);
    if (!alreadySent) {
      const emailContent = await generateRetentionEmail(org.name, riskBand, {
        daysSinceLastActive: scored.daysSinceLastActive,
        dunningStage: scored.dunningStage,
        ticketsLast30d: scored.ticketsLast30d,
      }, orgId);
      const emailResult = await emailService.sendEmail({
        to: await resolveOrgEmail(org),
        subject: emailContent.subject,
        html: emailContent.html,
        organizationId: undefined,
      });
      const [intervention] = await db.insert(revenueProtectionInterventions).values({
        organizationId: orgId,
        interventionType: "retention_offer",
        triggerRiskScore: riskScore,
        triggerRiskBand: riskBand,
        executedBy: "sophie",
        sophieMessageSubject: emailContent.subject,
        sophieMessageBody: emailContent.html,
        emailSentAt: new Date(),
        emailDeliveryStatus: emailResult.success ? "sent" : "failed",
        outcome: "pending",
      }).returning();

      // Create follow-up task in tasks table for 7 days out
      // (non-blocking)
      const followUpDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      db.execute(sql`
        INSERT INTO tasks (organization_id, title, description, due_date, status, created_at, updated_at)
        VALUES (${orgId}, ${'Follow up: retention offer sent'}, ${`Check if ${org.name} responded to retention offer (intervention #${intervention.id})`}, ${followUpDate.toISOString()}, 'pending', NOW(), NOW())
      `).catch(() => {/* best effort */});
    }
    return;
  }

  // Score 40-69 (yellow): Sophie sends check-in email
  if (riskScore >= 40) {
    const alreadySent = await hasRecentIntervention(orgId, 14);
    if (!alreadySent) {
      const emailContent = await generateRetentionEmail(org.name, riskBand, {
        daysSinceLastActive: scored.daysSinceLastActive,
        dunningStage: scored.dunningStage,
        ticketsLast30d: scored.ticketsLast30d,
      }, orgId);
      const emailResult = await emailService.sendEmail({
        to: await resolveOrgEmail(org),
        subject: emailContent.subject,
        html: emailContent.html,
        organizationId: undefined,
      });
      await db.insert(revenueProtectionInterventions).values({
        organizationId: orgId,
        interventionType: "checkin_email",
        triggerRiskScore: riskScore,
        triggerRiskBand: riskBand,
        executedBy: "sophie",
        sophieMessageSubject: emailContent.subject,
        sophieMessageBody: emailContent.html,
        emailSentAt: new Date(),
        emailDeliveryStatus: emailResult.success ? "sent" : "failed",
        outcome: "pending",
      });
    }
  }
}

export const revenueProtectionService = {
  scoreOrganization,

  /** Run a full scoring pass across all active orgs. Called every 6 hours via job lock. */
  async runScoringPass(): Promise<{ processed: number; interventions: number }> {
    const activeOrgs = await db.select({ id: organizations.id })
      .from(organizations)
      .where(sql`${organizations.subscriptionStatus} NOT IN ('cancelled', 'deleted')`);

    let processed = 0;
    let interventions = 0;

    for (const { id } of activeOrgs) {
      try {
        await processOrganization(id);
        processed++;
      } catch (err) {
        logger.error(`[revenueProtection] Error processing org ${id}`, err);
      }
    }

    return { processed, interventions };
  },
};

// P0 #4 — Revenue protection scoring pass migrated to
// scheduleSelfRescheduling (Phase 3 Week 7-8). Previously a bare setInterval
// that fired regardless of whether the previous scoring pass had completed,
// risking double-charged retention offers when a pass took longer than 6h.
export async function startRevenueProtectionJob(
  // Typed against the real helper — this parameter was `Function`, which is
  // how a 2-arg call (`withJobLock(name, fn)`) compiled clean while the fn
  // landed in `ttlSeconds`: acquireJobLock computed `Date.now() + fn * 1000`
  // = NaN → Invalid Date → drizzle mapToDriverValue → RangeError("Invalid
  // time value") on EVERY run since the P0 #4 migration. The job never
  // scored a single org in that window.
  withJobLock: typeof import("../utils/jobRuntime").withJobLock,
): Promise<void> {
  const INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
  const STARTUP_DELAY_MS = 3 * 60 * 1000; // 3 minutes
  // Just under the 6h interval — at-most-once per window (founderDigest's
  // 23h/24h convention). A crashed holder can't block the next scheduled
  // pass, and a second process can't double-send retention emails inside
  // the same window.
  const LOCK_TTL_SECONDS = 5.5 * 60 * 60;

  const { scheduleSelfRescheduling } = await import("../jobs/scheduler");

  scheduleSelfRescheduling({
    name: "revenue_protection",
    intervalMs: INTERVAL_MS,
    initialDelayMs: STARTUP_DELAY_MS,
    run: async () => {
      await withJobLock("revenue_protection", LOCK_TTL_SECONDS, async () => {
        logger.info("[revenueProtection] Starting scoring pass...");
        const result = await revenueProtectionService.runScoringPass();
        logger.info(`[revenueProtection] Completed: ${result.processed} orgs scored`);
      });
    },
  });
}

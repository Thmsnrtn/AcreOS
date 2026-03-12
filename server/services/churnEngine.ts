/**
 * churnEngine.ts
 *
 * Scores every paying organization on a 0–100 churn risk scale and
 * automatically triggers Sophie re-engagement for high-risk orgs.
 *
 * Scoring signals (weighted):
 *   30pts — Days since last org activity (login / entity creation)
 *   25pts — Feature breadth: how many modules have data (leads/notes/props/campaigns)
 *   20pts — Data depth: total records (invested users don't churn)
 *   15pts — Payment health: dunning stage
 *   10pts — Open support load
 *
 * Run daily from server/index.ts at 6am.
 */

import { db } from "../db";
import {
  organizations,
  leads,
  notes,
  properties,
  campaigns,
  supportCases,
  teamMembers,
  activityLog,
  systemAlerts,
} from "@shared/schema";
import { eq, count, sql, and, isNull, gt } from "drizzle-orm";
import { logActivity } from "./systemActivityLogger";
import { emailService } from "./emailService";
import { isFounderEmail } from "./founder";

const RESCUE_RISK_THRESHOLD = 85;  // auto-send rescue email
const ALERT_RISK_THRESHOLD = 80;   // create systemAlert

// Milestone keys (stored as string[] in organizations.milestonesReached)
export const MILESTONES = {
  FIRST_LEAD: "first_lead",
  LEADS_50: "leads_50",
  FIRST_NOTE: "first_note",
  NOTES_10: "notes_10",
  FIRST_DEAL_CLOSED: "first_deal_closed",
  FIRST_CAMPAIGN_SENT: "first_campaign_sent",
} as const;

type MilestoneKey = (typeof MILESTONES)[keyof typeof MILESTONES];

async function countRecords(
  table: any,
  orgId: number
): Promise<number> {
  try {
    const [row] = await db
      .select({ n: count() })
      .from(table)
      .where(eq(table.organizationId, orgId));
    return Number(row?.n ?? 0);
  } catch {
    return 0;
  }
}

async function getDaysSinceLastActivity(orgId: number): Promise<number> {
  try {
    // Check activityLog for most recent entry for this org
    const [row] = await db
      .select({ createdAt: activityLog.createdAt })
      .from(activityLog)
      .where(eq(activityLog.organizationId, orgId))
      .orderBy(sql`${activityLog.createdAt} DESC`)
      .limit(1);

    if (!row?.createdAt) return 60; // no activity — assume 60 days
    const ms = Date.now() - new Date(row.createdAt).getTime();
    return Math.floor(ms / (1000 * 60 * 60 * 24));
  } catch {
    return 30;
  }
}

async function getOpenSupportCount(orgId: number): Promise<number> {
  try {
    const [row] = await db
      .select({ n: count() })
      .from(supportCases)
      .where(
        and(
          eq(supportCases.organizationId, orgId),
          isNull(supportCases.resolvedAt)
        )
      );
    return Number(row?.n ?? 0);
  } catch {
    return 0;
  }
}

export async function scoreOrg(orgId: number, org: { dunningStage?: string | null }): Promise<number> {
  const [
    daysSince,
    leadCount,
    noteCount,
    propCount,
    campaignCount,
    openTickets,
  ] = await Promise.all([
    getDaysSinceLastActivity(orgId),
    countRecords(leads, orgId),
    countRecords(notes, orgId),
    countRecords(properties, orgId),
    countRecords(campaigns, orgId),
    getOpenSupportCount(orgId),
  ]);

  // 1. Inactivity score (0–30)
  const inactivityScore = Math.min(30, Math.round((daysSince / 30) * 30));

  // 2. Feature breadth score (0–25, inverted — more breadth = lower risk)
  const modulesUsed = [leadCount, noteCount, propCount, campaignCount].filter((n) => n > 0).length;
  const breadthScore = Math.round(((4 - modulesUsed) / 4) * 25);

  // 3. Data depth score (0–20, inverted — more records = lower risk)
  const totalRecords = leadCount + noteCount + propCount + campaignCount;
  const depthScore = totalRecords === 0 ? 20 : Math.max(0, Math.round(20 - Math.min(20, totalRecords / 5)));

  // 4. Payment health score (0–15)
  const dunningMap: Record<string, number> = {
    none: 0,
    grace_period: 4,
    warning: 8,
    restricted: 12,
    suspended: 15,
    cancelled: 15,
  };
  const paymentScore = dunningMap[org.dunningStage ?? "none"] ?? 0;

  // 5. Support load score (0–10, inverted)
  const supportScore = Math.min(10, openTickets * 3);

  const total = inactivityScore + breadthScore + depthScore + paymentScore + supportScore;
  return Math.min(100, Math.max(0, total));
}

export async function detectMilestones(
  orgId: number,
  currentMilestones: string[]
): Promise<MilestoneKey[]> {
  const newMilestones: MilestoneKey[] = [];
  const existing = new Set(currentMilestones);

  const [lc, nc, pc, campaignCount] = await Promise.all([
    countRecords(leads, orgId),
    countRecords(notes, orgId),
    countRecords(properties, orgId),
    countRecords(campaigns, orgId),
  ]);

  const checks: Array<[MilestoneKey, boolean]> = [
    [MILESTONES.FIRST_LEAD, lc >= 1],
    [MILESTONES.LEADS_50, lc >= 50],
    [MILESTONES.FIRST_NOTE, nc >= 1],
    [MILESTONES.NOTES_10, nc >= 10],
    [MILESTONES.FIRST_CAMPAIGN_SENT, campaignCount >= 1],
  ];

  for (const [key, achieved] of checks) {
    if (achieved && !existing.has(key)) {
      newMilestones.push(key);
    }
  }

  return newMilestones;
}

const MILESTONE_LABELS: Record<MilestoneKey, string> = {
  first_lead: "your first lead",
  leads_50: "50 leads",
  first_note: "your first seller-financed note",
  notes_10: "10 active notes",
  first_deal_closed: "your first closed deal",
  first_campaign_sent: "your first campaign",
};

async function sendMilestoneReferralNudge(
  orgId: number,
  ownerId: string,
  orgName: string,
  milestone: MilestoneKey
): Promise<void> {
  // Get owner email via teamMembers
  const [member] = await db
    .select({ email: teamMembers.email })
    .from(teamMembers)
    .where(and(eq(teamMembers.organizationId, orgId), eq(teamMembers.userId, ownerId)))
    .limit(1);

  const email = member?.email;
  if (!email || isFounderEmail(email)) return;

  const label = MILESTONE_LABELS[milestone] ?? milestone;

  await emailService.sendTransactionalEmail("churn_rescue", {
    to: email,
    templateData: {
      subject: `🎉 Congrats on reaching ${label} with AcreOS!`,
      preheader: "You're building something real.",
      headline: `You just hit a milestone: ${label}!`,
      body: `That's a big deal. It means your land business is actually moving forward with AcreOS.\n\nIf you know another land investor who could use this kind of traction — share AcreOS with them. You'll both benefit.\n\nHere's how to find your referral link: Settings → Refer & Earn.`,
      ctaText: "Get your referral link",
      ctaUrl: `${process.env.APP_URL ?? "https://app.acreos.io"}/settings#referral`,
    },
  });

  await logActivity({
    orgId,
    job: "churn_engine",
    action: "milestone_referral_nudge_sent",
    summary: `Sent milestone referral nudge to ${orgName} for reaching: ${label}`,
    metadata: { milestone },
  });
}

async function triggerRescue(
  orgId: number,
  ownerId: string,
  orgName: string,
  riskScore: number
): Promise<void> {
  const [member] = await db
    .select({ email: teamMembers.email })
    .from(teamMembers)
    .where(and(eq(teamMembers.organizationId, orgId), eq(teamMembers.userId, ownerId)))
    .limit(1);

  const email = member?.email;
  if (!email || isFounderEmail(email)) return;

  await emailService.sendTransactionalEmail("churn_rescue", {
    to: email,
    templateData: {
      subject: "We noticed you haven't been around lately",
      preheader: "Let's see if we can help.",
      headline: "Haven't seen you in a while",
      body: `We noticed you haven't logged into AcreOS recently. We want to make sure you're getting value from the platform.\n\nIs there something you're struggling with? A feature you wish existed? We'd love to hear from you — just reply to this email.\n\nOr log in now to pick up where you left off.`,
      ctaText: "Log back in",
      ctaUrl: `${process.env.APP_URL ?? "https://app.acreos.io"}/today`,
    },
  });

  await db
    .update(organizations)
    .set({ churnRescueSentAt: new Date() })
    .where(eq(organizations.id, orgId));

  await logActivity({
    orgId,
    job: "churn_engine",
    action: "rescue_email_sent",
    summary: `Sophie sent re-engagement email to ${orgName} (churn risk score: ${riskScore})`,
    metadata: { riskScore },
  });
}

export const churnEngine = {
  async runForAllOrgs(): Promise<void> {
    const payingOrgs = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        ownerId: organizations.ownerId,
        dunningStage: organizations.dunningStage,
        churnRescueSentAt: organizations.churnRescueSentAt,
        milestonesReached: organizations.milestonesReached,
        referralNudgeSentAt: organizations.referralNudgeSentAt,
      })
      .from(organizations)
      .where(
        and(
          sql`${organizations.subscriptionStatus} = 'active'`,
          sql`${organizations.subscriptionTier} != 'free'`
        )
      )
      .limit(500);

    let scored = 0, rescued = 0, alerted = 0;

    for (const org of payingOrgs) {
      try {
        const risk = await scoreOrg(org.id, { dunningStage: org.dunningStage });

        await db
          .update(organizations)
          .set({
            churnRiskScore: risk,
            churnRiskUpdatedAt: new Date(),
          })
          .where(eq(organizations.id, org.id));

        scored++;

        // Create systemAlert for high-risk orgs
        if (risk >= ALERT_RISK_THRESHOLD) {
          const [existing] = await db
            .select({ id: systemAlerts.id })
            .from(systemAlerts)
            .where(
              and(
                eq(systemAlerts.organizationId, org.id),
                eq(systemAlerts.type, "churn_risk" as any),
                isNull(systemAlerts.resolvedAt)
              )
            )
            .limit(1);

          if (!existing) {
            await db.insert(systemAlerts).values({
              organizationId: org.id,
              type: "churn_risk" as any,
              severity: risk >= 90 ? "critical" : "warning",
              title: `Churn risk: ${org.name}`,
              message: `Org "${org.name}" has a churn risk score of ${risk}/100. Automated re-engagement${risk >= RESCUE_RISK_THRESHOLD ? " has been sent" : " may be needed"}.`,
              metadata: { riskScore: risk },
            });
            alerted++;
          }
        }

        // Auto-rescue at threshold, but only if not already sent
        if (risk >= RESCUE_RISK_THRESHOLD && !org.churnRescueSentAt) {
          await triggerRescue(org.id, org.ownerId, org.name, risk).catch(() => {});
          rescued++;
        }

        // Milestone detection + referral nudge
        const currentMilestones: string[] = Array.isArray(org.milestonesReached)
          ? org.milestonesReached
          : [];
        const newMilestones = await detectMilestones(org.id, currentMilestones);

        if (newMilestones.length > 0) {
          await db
            .update(organizations)
            .set({ milestonesReached: [...currentMilestones, ...newMilestones] as any })
            .where(eq(organizations.id, org.id));

          // Nudge for first new milestone (if healthy/engaged user and no prior nudge)
          if (risk < 40 && !org.referralNudgeSentAt) {
            await sendMilestoneReferralNudge(
              org.id,
              org.ownerId,
              org.name,
              newMilestones[0]
            ).catch(() => {});
            await db
              .update(organizations)
              .set({ referralNudgeSentAt: new Date() })
              .where(eq(organizations.id, org.id));
          }
        }
      } catch (err) {
        console.error(`[ChurnEngine] Error scoring org ${org.id}:`, err);
      }
    }

    console.log(`[ChurnEngine] Scored ${scored} orgs. ${alerted} new risk alerts. ${rescued} rescue emails sent.`);
    logActivity({
      job: "churn_engine",
      action: "scoring_complete",
      summary: `Churn engine scored ${scored} paying orgs — ${alerted} new risk alert(s), ${rescued} rescue email(s) sent`,
      metadata: { scored, alerted, rescued },
    }).catch(() => {});
  },

  scoreOrg,
};

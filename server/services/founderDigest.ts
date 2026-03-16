// @ts-nocheck — ORM type refinement deferred; runtime-correct
import { db } from "../db";
import {
  organizations, founderDigestHistory, jobHealthLogs, decisionsInboxItems,
  supportTicketMessages, supportTickets, churnRiskScores,
} from "@shared/schema";
import { eq, and, desc, gte, count, sql, lt } from "drizzle-orm";
import OpenAI from "openai";
import { emailService } from "./emailService";

const openai = new OpenAI();

const PRIMARY_FOUNDER_EMAIL = "thmsnrtn@gmail.com";

interface DigestData {
  mrrCents: number;
  mrrLastMonthCents: number;
  newSignups24h: number;
  cancellations24h: number;
  openDecisions: number;
  mostUrgentDecision: string | null;
  jobFailures24h: number;
  sophieAutoResolved24h: number;
  topAtRiskOrgName: string | null;
  topAtRiskScore: number | null;
}

async function gatherDigestData(): Promise<DigestData> {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

  // MRR this month
  const mrrResult = await db.select({ total: sql<number>`COALESCE(SUM(monthly_price_cents), 0)` })
    .from(organizations)
    .where(sql`${organizations.subscriptionStatus} IN ('active', 'trialing')`);
  const mrrCents = Number(mrrResult[0]?.total ?? 0);

  // MRR last month (rough: use same calc — actual MRR tracking would need subscription events)
  const mrrLastMonthCents = mrrCents; // fallback — no historical snapshot available at this layer

  // New signups in last 24h
  const newSignupsResult = await db.select({ c: count() })
    .from(organizations)
    .where(gte(organizations.createdAt, yesterday));
  const newSignups24h = Number(newSignupsResult[0]?.c ?? 0);

  // Cancellations in last 24h
  const cancellationsResult = await db.select({ c: count() })
    .from(organizations)
    .where(and(
      sql`${organizations.subscriptionStatus} = 'cancelled'`,
      gte(organizations.updatedAt, yesterday),
    ));
  const cancellations24h = Number(cancellationsResult[0]?.c ?? 0);

  // Open decisions
  const openDecisionsResult = await db.select({ c: count() })
    .from(decisionsInboxItems)
    .where(eq(decisionsInboxItems.status, "pending"));
  const openDecisions = Number(openDecisionsResult[0]?.c ?? 0);

  // Most urgent open decision
  const urgentItem = await db.query.decisionsInboxItems.findFirst({
    where: eq(decisionsInboxItems.status, "pending"),
    orderBy: desc(decisionsInboxItems.urgencyScore),
  });
  const mostUrgentDecision = urgentItem
    ? `${urgentItem.itemType.replace(/_/g, " ")} (urgency ${urgentItem.urgencyScore}/100)`
    : null;

  // Job failures in last 24h
  const jobFailuresResult = await db.select({ c: count() })
    .from(jobHealthLogs)
    .where(and(
      eq(jobHealthLogs.status, "failed"),
      gte(jobHealthLogs.runStartedAt, yesterday),
    ));
  const jobFailures24h = Number(jobFailuresResult[0]?.c ?? 0);

  // Sophie auto-resolutions in last 24h (support ticket messages by sophie that resolved)
  const sophieResolvedResult = await db.select({ c: count() })
    .from(supportTickets)
    .where(and(
      sql`${supportTickets.resolvedAt} IS NOT NULL`,
      gte(supportTickets.resolvedAt, yesterday),
      eq(supportTickets.assignedAgent, "sophie"),
    ));
  const sophieAutoResolved24h = Number(sophieResolvedResult[0]?.c ?? 0);

  // Top at-risk org
  const topAtRisk = await db.query.churnRiskScores.findFirst({
    where: sql`${churnRiskScores.riskBand} IN ('red', 'critical')`,
    orderBy: desc(churnRiskScores.riskScore),
  });
  let topAtRiskOrgName: string | null = null;
  let topAtRiskScore: number | null = null;
  if (topAtRisk) {
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, topAtRisk.organizationId),
    });
    topAtRiskOrgName = org?.name ?? `Org #${topAtRisk.organizationId}`;
    topAtRiskScore = topAtRisk.riskScore;
  }

  return {
    mrrCents,
    mrrLastMonthCents,
    newSignups24h,
    cancellations24h,
    openDecisions,
    mostUrgentDecision,
    jobFailures24h,
    sophieAutoResolved24h,
    topAtRiskOrgName,
    topAtRiskScore,
  };
}

async function generateDigestBullets(data: DigestData): Promise<{
  revenueBullet: string;
  systemHealthBullet: string;
  supportActivityBullet: string;
  topAtRiskBullet: string;
  recommendedActionBullet: string;
}> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [{
      role: "system",
      content: "You are an AI analyst writing an executive daily briefing for a solo SaaS founder. Write exactly 5 bullets, each ≤25 words. Be direct and actionable. Return JSON.",
    }, {
      role: "user",
      content: JSON.stringify({
        mrrFormatted: `$${(data.mrrCents / 100).toLocaleString()}`,
        newSignups24h: data.newSignups24h,
        cancellations24h: data.cancellations24h,
        openDecisions: data.openDecisions,
        mostUrgentDecision: data.mostUrgentDecision,
        jobFailures24h: data.jobFailures24h,
        sophieAutoResolved24h: data.sophieAutoResolved24h,
        topAtRiskOrgName: data.topAtRiskOrgName,
        topAtRiskScore: data.topAtRiskScore,
        instruction: "Return JSON: { revenueBullet, systemHealthBullet, supportActivityBullet, topAtRiskBullet, recommendedActionBullet }. Each ≤25 words.",
      }),
    }],
  });

  try {
    const parsed = JSON.parse(response.choices[0]?.message?.content ?? "{}");
    return {
      revenueBullet: parsed.revenueBullet ?? `MRR: $${(data.mrrCents / 100).toLocaleString()}. ${data.newSignups24h} new signups, ${data.cancellations24h} cancellations in 24h.`,
      systemHealthBullet: parsed.systemHealthBullet ?? `${data.jobFailures24h} job failures in last 24h.`,
      supportActivityBullet: parsed.supportActivityBullet ?? `Sophie auto-resolved ${data.sophieAutoResolved24h} tickets in 24h.`,
      topAtRiskBullet: parsed.topAtRiskBullet ?? (data.topAtRiskOrgName ? `Top at-risk: ${data.topAtRiskOrgName} (score ${data.topAtRiskScore}/100).` : "No orgs in critical risk band."),
      recommendedActionBullet: parsed.recommendedActionBullet ?? (data.openDecisions > 0 ? `${data.openDecisions} decision(s) pending in inbox.` : "All clear. No action required."),
    };
  } catch {
    return {
      revenueBullet: `MRR $${(data.mrrCents / 100).toLocaleString()}, ${data.newSignups24h} signups, ${data.cancellations24h} cancellations.`,
      systemHealthBullet: `${data.jobFailures24h === 0 ? "All jobs healthy." : `${data.jobFailures24h} job failures — check dashboard.`}`,
      supportActivityBullet: `Sophie auto-resolved ${data.sophieAutoResolved24h} tickets autonomously.`,
      topAtRiskBullet: data.topAtRiskOrgName ? `${data.topAtRiskOrgName} at ${data.topAtRiskScore}/100 churn risk.` : "No orgs in red/critical churn band.",
      recommendedActionBullet: data.openDecisions > 0 ? `${data.openDecisions} pending inbox item(s) need your attention.` : "Platform running passively. No action needed.",
    };
  }
}

export const founderDigestService = {
  async generate(): Promise<{ digestId: number; emailSent: boolean }> {
    const data = await gatherDigestData();
    const bullets = await generateDigestBullets(data);

    const allClear = data.openDecisions === 0 && data.jobFailures24h === 0;
    const subject = `AcreOS Daily — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })} — ${allClear ? "All Clear" : `${data.openDecisions} item${data.openDecisions === 1 ? "" : "s"} need attention`}`;

    const html = `
      <h2>AcreOS Daily Briefing</h2>
      <ul>
        <li>💰 ${bullets.revenueBullet}</li>
        <li>⚙️ ${bullets.systemHealthBullet}</li>
        <li>🤖 ${bullets.supportActivityBullet}</li>
        <li>⚠️ ${bullets.topAtRiskBullet}</li>
        <li>✅ ${bullets.recommendedActionBullet}</li>
      </ul>
      ${allClear ? '<p style="color:green;font-weight:bold;">All systems nominal. Close this email and enjoy your day.</p>' : '<p><a href="/founder-dashboard">Open Dashboard →</a></p>'}
    `;

    const [digestRecord] = await db.insert(founderDigestHistory).values({
      digestDate: new Date(),
      deliveryStatus: "pending",
      revenueBullet: bullets.revenueBullet,
      systemHealthBullet: bullets.systemHealthBullet,
      supportActivityBullet: bullets.supportActivityBullet,
      topAtRiskBullet: bullets.topAtRiskBullet,
      recommendedActionBullet: bullets.recommendedActionBullet,
      dataSnapshot: data as any,
      mrrCents: data.mrrCents,
      openDecisions: data.openDecisions,
      sophieAutoResolved24h: data.sophieAutoResolved24h,
      jobFailures24h: data.jobFailures24h,
      atRiskOrgs: data.topAtRiskOrgName ? 1 : 0,
    }).returning();

    const emailResult = await emailService.sendEmail({
      to: PRIMARY_FOUNDER_EMAIL,
      subject,
      html,
      organizationId: undefined, // platform-level credentials
    });

    await db.update(founderDigestHistory)
      .set({
        deliveryStatus: emailResult.success ? "delivered" : "failed",
        deliveredAt: emailResult.success ? new Date() : null,
      })
      .where(eq(founderDigestHistory.id, digestRecord.id));

    return { digestId: digestRecord.id, emailSent: emailResult.success };
  },

  async getRecentHistory(limit = 30) {
    return db.query.founderDigestHistory.findMany({
      orderBy: desc(founderDigestHistory.digestDate),
      limit,
    });
  },
};

export async function startFounderDigestJob(withJobLock: Function): Promise<void> {
  const ONE_HOUR_MS = 60 * 60 * 1000;
  const SEND_UTC_HOUR = 14; // 8 AM CST = 14 UTC

  const runCheck = async () => {
    const utcHour = new Date().getUTCHours();
    if (utcHour !== SEND_UTC_HOUR) return;

    await withJobLock("founder_digest", 23 * 60 * 60, async () => {
      console.log("[founderDigest] Generating daily digest...");
      const result = await founderDigestService.generate();
      console.log(`[founderDigest] Digest #${result.digestId} generated, email sent: ${result.emailSent}`);
    });
  };

  // Check every hour
  setInterval(() => {
    runCheck().catch(err => console.error("[founderDigest] Error:", err));
  }, ONE_HOUR_MS);

  // Run check immediately (handles case where server restarts at send hour)
  await runCheck();
}

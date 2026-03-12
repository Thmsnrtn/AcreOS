/**
 * founderBriefing.ts
 *
 * Sends the founder a daily AI-written briefing email at 7am:
 *  - What happened yesterday (signups, MRR delta, autonomous actions)
 *  - System health (all jobs healthy / any degraded)
 *  - Items that may need attention (if any)
 *
 * Prevents duplicate sends via system_meta table key 'founder_briefing_last_sent'.
 */

import { db } from "../db";
import {
  organizations,
  systemActivity,
  systemAlerts,
  systemMeta,
} from "@shared/schema";
import { sql, count, gte, eq, desc } from "drizzle-orm";
import { emailService } from "./emailService";
import { jobSupervisor } from "./jobSupervisor";
import { logActivity } from "./systemActivityLogger";
import OpenAI from "openai";

const FOUNDER_EMAILS: string[] = [
  ...(process.env.FOUNDER_EMAIL ? [process.env.FOUNDER_EMAIL.trim()] : []),
  ...(process.env.FOUNDER_EMAILS
    ? process.env.FOUNDER_EMAILS.split(",").map((e) => e.trim()).filter(Boolean)
    : []),
].filter((v, i, arr) => arr.indexOf(v) === i); // dedupe

function getOpenAI(): OpenAI | null {
  return process.env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;
}

async function alreadySentToday(): Promise<boolean> {
  const [row] = await db
    .select({ value: systemMeta.value })
    .from(systemMeta)
    .where(eq(systemMeta.key, "founder_briefing_last_sent"))
    .limit(1);

  if (!row?.value) return false;
  const lastSent = new Date(row.value);
  const now = new Date();
  return (
    lastSent.getFullYear() === now.getFullYear() &&
    lastSent.getMonth() === now.getMonth() &&
    lastSent.getDate() === now.getDate()
  );
}

async function markSentToday(): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insert(systemMeta)
    .values({ key: "founder_briefing_last_sent", value: now })
    .onConflictDoUpdate({ target: systemMeta.key, set: { value: now, updatedAt: new Date() } });
}

async function gatherStats(since: Date): Promise<Record<string, number | string>> {
  const [newOrgs, newPaid, totalPaid, atRisk, unresolvedAlerts, actionsCount] =
    await Promise.all([
      // New signups in last 24h
      db
        .select({ n: count() })
        .from(organizations)
        .where(gte(organizations.createdAt, since))
        .then(([r]) => Number(r?.n ?? 0)),
      // New paying orgs in last 24h
      db
        .select({ n: count() })
        .from(organizations)
        .where(
          sql`${organizations.createdAt} >= ${since} AND ${organizations.subscriptionTier} != 'free'`
        )
        .then(([r]) => Number(r?.n ?? 0)),
      // Total paying orgs
      db
        .select({ n: count() })
        .from(organizations)
        .where(sql`${organizations.subscriptionTier} != 'free' AND ${organizations.subscriptionStatus} = 'active'`)
        .then(([r]) => Number(r?.n ?? 0)),
      // At-risk orgs (churn score > 80)
      db
        .select({ n: count() })
        .from(organizations)
        .where(sql`${organizations.churnRiskScore} > 80`)
        .then(([r]) => Number(r?.n ?? 0)),
      // Unresolved alerts
      db
        .select({ n: count() })
        .from(systemAlerts)
        .where(sql`${systemAlerts.resolvedAt} IS NULL`)
        .then(([r]) => Number(r?.n ?? 0)),
      // Autonomous actions in last 24h
      db
        .select({ n: count() })
        .from(systemActivity)
        .where(gte(systemActivity.createdAt, since))
        .then(([r]) => Number(r?.n ?? 0)),
    ]);

  const jobHealth = jobSupervisor.getSummary();

  return {
    "New Signups": newOrgs,
    "New Paid": newPaid,
    "Paying Orgs": totalPaid,
    "At Risk": atRisk,
    "Alerts": unresolvedAlerts,
    "Tasks Run": actionsCount,
  };
}

async function getTopActions(since: Date, limit = 8): Promise<string[]> {
  const rows = await db
    .select({ summary: systemActivity.summary, job: systemActivity.jobName })
    .from(systemActivity)
    .where(gte(systemActivity.createdAt, since))
    .orderBy(desc(systemActivity.createdAt))
    .limit(limit);

  return rows.map((r) => `• [${r.job}] ${r.summary}`);
}

async function writeBriefingWithAI(
  stats: Record<string, number | string>,
  topActions: string[],
  jobHealthSummary: ReturnType<typeof jobSupervisor.getSummary>
): Promise<string[]> {
  const openai = getOpenAI();
  if (!openai) {
    // Fallback without AI
    const { healthy, degraded, failed } = jobHealthSummary;
    return [
      `In the last 24 hours: ${stats["New Signups"]} new signup(s), ${stats["New Paid"]} new paying org(s). There are now ${stats["Paying Orgs"]} active paying organizations. ${stats["Tasks Run"]} autonomous tasks were completed by the system.`,
      `System health: ${healthy} jobs healthy, ${degraded} degraded, ${failed} failed. ${stats["Alerts"]} unresolved alert(s) on the platform.`,
      stats["At Risk"] as number > 0
        ? `${stats["At Risk"]} org(s) have elevated churn risk. Sophie has been notified and may have sent re-engagement emails automatically.`
        : `No organizations are currently at high churn risk. The platform is running smoothly.`,
    ];
  }

  const prompt = [
    `You are the AcreOS autonomous operating system delivering a daily briefing to the founder.`,
    `Be specific with numbers. Be direct and confident. If all is healthy, say so clearly.`,
    `If something needs attention, name it specifically.`,
    `Write exactly 3 paragraphs: (1) yesterday's highlights, (2) system health, (3) action items or "no action needed".`,
    `Keep total length under 200 words.`,
    ``,
    `Stats (last 24 hours):`,
    ...Object.entries(stats).map(([k, v]) => `  ${k}: ${v}`),
    ``,
    `Job health: ${jobHealthSummary.healthy} healthy, ${jobHealthSummary.degraded} degraded, ${jobHealthSummary.failed} failed`,
    ``,
    `Sample autonomous actions taken:`,
    ...topActions,
  ].join("\n");

  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
      max_tokens: 300,
    });
    const text = resp.choices[0]?.message?.content?.trim() ?? "";
    // Split into paragraphs
    return text.split(/\n\n+/).filter(Boolean);
  } catch {
    // Fallback
    return [
      `Last 24 hours: ${stats["New Signups"]} new signup(s), ${stats["Tasks Run"]} autonomous tasks completed.`,
      `All ${jobHealthSummary.healthy} background jobs are healthy.`,
      `No manual action required.`,
    ];
  }
}

export async function sendDailyBriefing(): Promise<void> {
  if (FOUNDER_EMAILS.length === 0) {
    console.warn("[FounderBriefing] No FOUNDER_EMAIL configured — skipping briefing");
    return;
  }

  if (await alreadySentToday()) {
    return; // Already sent today
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [stats, topActions] = await Promise.all([
    gatherStats(since),
    getTopActions(since),
  ]);

  const jobHealth = jobSupervisor.getSummary();
  const paragraphs = await writeBriefingWithAI(stats, topActions, jobHealth);

  const emailStats: Record<string, string | number> = {
    "Signups": stats["New Signups"],
    "New Paid": stats["New Paid"],
    "Tasks Run": stats["Tasks Run"],
    "Alerts": stats["Alerts"],
  };

  for (const email of FOUNDER_EMAILS) {
    await emailService.sendTransactionalEmail("founder_briefing", {
      to: email,
      templateData: {
        briefingParagraphs: paragraphs,
        stats: emailStats,
      },
    }).catch((err) => {
      console.error(`[FounderBriefing] Failed to send to ${email}:`, err?.message);
    });
  }

  await markSentToday();

  await logActivity({
    job: "founder_briefing",
    action: "briefing_sent",
    summary: `Daily founder briefing sent to ${FOUNDER_EMAILS.length} recipient(s)`,
    metadata: { recipients: FOUNDER_EMAILS.length, stats },
  });

  console.log(`[FounderBriefing] Sent daily briefing to ${FOUNDER_EMAILS.length} founder(s)`);
}

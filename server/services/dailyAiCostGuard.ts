/**
 * Daily AI cost guard.
 *
 * Fires at the top of each UTC day (00:00–00:29) from the worker cron in
 * runScheduledJobs.ts. Sums `ai_telemetry_events.estimated_cost_cents`
 * for the prior 24h. Logs a `[ai-cost-summary]` line either way; emails
 * the founder when the rolling-24h total crosses
 * `AI_COST_ALERT_USD_THRESHOLD` (default $5). Without this, the only
 * signal a runaway loop sent Tom was a $30 OpenRouter receipt at month
 * end — the 2026-06-05 cost audit found that mechanism is what forced
 * him to disable auto-reload.
 *
 * Env:
 *   AI_COST_ALERT_USD_THRESHOLD  — float, default 5. Email fires when
 *                                  prior 24h spend ≥ this value.
 *   FOUNDER_ALERT_EMAIL          — string. If unset, the alert is
 *                                  logged but no email is sent.
 *   AI_COST_ALERT_FROM           — string, default "alerts@acreos.io".
 */

import { db } from "../db";
import { aiTelemetryEvents } from "@shared/schema";
import { and, gte, sql } from "drizzle-orm";
import { logger } from "../utils/logger";
import { emailService } from "./emailService";

export interface DailyCostSummary {
  windowHours: number;
  totalCostUsd: number;
  byProvider: Array<{ provider: string; costUsd: number; calls: number }>;
  bySurface: Array<{ taskType: string; costUsd: number; calls: number }>;
  topModels: Array<{ model: string; costUsd: number; calls: number }>;
}

function getAlertThresholdUsd(): number {
  const fromEnv = process.env.AI_COST_ALERT_USD_THRESHOLD;
  if (fromEnv) {
    const n = Number(fromEnv);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 5;
}

export async function summarizeAiCostLast24h(): Promise<DailyCostSummary> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [totalRow] = await db
    .select({
      cents: sql<string>`COALESCE(SUM(${aiTelemetryEvents.estimatedCostCents}), 0)`,
    })
    .from(aiTelemetryEvents)
    .where(gte(aiTelemetryEvents.createdAt, since));

  const totalCostUsd = Number(totalRow?.cents ?? 0) / 100;

  const byProvider = await db
    .select({
      provider: aiTelemetryEvents.provider,
      cents: sql<string>`COALESCE(SUM(${aiTelemetryEvents.estimatedCostCents}), 0)`,
      calls: sql<string>`COUNT(*)`,
    })
    .from(aiTelemetryEvents)
    .where(gte(aiTelemetryEvents.createdAt, since))
    .groupBy(aiTelemetryEvents.provider);

  const bySurface = await db
    .select({
      taskType: aiTelemetryEvents.taskType,
      cents: sql<string>`COALESCE(SUM(${aiTelemetryEvents.estimatedCostCents}), 0)`,
      calls: sql<string>`COUNT(*)`,
    })
    .from(aiTelemetryEvents)
    .where(gte(aiTelemetryEvents.createdAt, since))
    .groupBy(aiTelemetryEvents.taskType);

  const topModels = await db
    .select({
      model: aiTelemetryEvents.model,
      cents: sql<string>`COALESCE(SUM(${aiTelemetryEvents.estimatedCostCents}), 0)`,
      calls: sql<string>`COUNT(*)`,
    })
    .from(aiTelemetryEvents)
    .where(
      and(
        gte(aiTelemetryEvents.createdAt, since),
        sql`${aiTelemetryEvents.estimatedCostCents} > 0`,
      ),
    )
    .groupBy(aiTelemetryEvents.model)
    .orderBy(sql`COALESCE(SUM(${aiTelemetryEvents.estimatedCostCents}), 0) DESC`)
    .limit(5);

  return {
    windowHours: 24,
    totalCostUsd,
    byProvider: byProvider.map((r) => ({
      provider: r.provider,
      costUsd: Number(r.cents) / 100,
      calls: Number(r.calls),
    })),
    bySurface: bySurface
      .map((r) => ({
        taskType: r.taskType,
        costUsd: Number(r.cents) / 100,
        calls: Number(r.calls),
      }))
      .filter((r) => r.costUsd > 0)
      .sort((a, b) => b.costUsd - a.costUsd),
    topModels: topModels.map((r) => ({
      model: r.model,
      costUsd: Number(r.cents) / 100,
      calls: Number(r.calls),
    })),
  };
}

function renderEmailHtml(summary: DailyCostSummary, thresholdUsd: number): string {
  const fmt = (n: number) => `$${n.toFixed(4)}`;
  const rows = (xs: Array<{ label: string; costUsd: number; calls: number }>) =>
    xs
      .map(
        (r) =>
          `<tr><td>${r.label}</td><td style="text-align:right">${fmt(r.costUsd)}</td><td style="text-align:right">${r.calls}</td></tr>`,
      )
      .join("");

  return `
<p><strong>AcreOS AI spend in last 24h: ${fmt(summary.totalCostUsd)}</strong>
  (threshold: ${fmt(thresholdUsd)}).</p>
<h3>By provider</h3>
<table border="1" cellpadding="6" cellspacing="0">
  <tr><th>Provider</th><th>Cost</th><th>Calls</th></tr>
  ${rows(summary.byProvider.map((r) => ({ label: r.provider, costUsd: r.costUsd, calls: r.calls })))}
</table>
<h3>By surface</h3>
<table border="1" cellpadding="6" cellspacing="0">
  <tr><th>Task type</th><th>Cost</th><th>Calls</th></tr>
  ${rows(summary.bySurface.map((r) => ({ label: r.taskType, costUsd: r.costUsd, calls: r.calls })))}
</table>
<h3>Top models</h3>
<table border="1" cellpadding="6" cellspacing="0">
  <tr><th>Model</th><th>Cost</th><th>Calls</th></tr>
  ${rows(summary.topModels.map((r) => ({ label: r.model, costUsd: r.costUsd, calls: r.calls })))}
</table>
<p style="color:#888;font-size:12px">
  Lower the platform ceiling via AI_PLATFORM_DAILY_CEILING_CENTS.
  Disable a specific cron via *_DISABLED=1 env (see runScheduledJobs.ts
  kill-switch comments). The platform ceiling already fires per-call;
  this email is the after-the-fact summary.
</p>`.trim();
}

/**
 * Run once. Compute the prior-24h summary, log it, email if over threshold.
 */
export async function runDailyAiCostGuard(): Promise<void> {
  const summary = await summarizeAiCostLast24h();
  const thresholdUsd = getAlertThresholdUsd();

  logger.info("[ai-cost-summary]", {
    metadata: {
      windowHours: summary.windowHours,
      totalCostUsd: Number(summary.totalCostUsd.toFixed(4)),
      thresholdUsd,
      overThreshold: summary.totalCostUsd >= thresholdUsd,
      byProvider: summary.byProvider,
      bySurface: summary.bySurface,
      topModels: summary.topModels,
    },
  });

  if (summary.totalCostUsd < thresholdUsd) return;

  const to = process.env.FOUNDER_ALERT_EMAIL;
  if (!to) {
    logger.warn(
      "[dailyAiCostGuard] over threshold but FOUNDER_ALERT_EMAIL is unset; alert not emailed",
      { metadata: { totalCostUsd: summary.totalCostUsd, thresholdUsd } },
    );
    return;
  }

  const from = process.env.AI_COST_ALERT_FROM ?? "alerts@acreos.io";
  const result = await emailService.sendEmail({
    to,
    from,
    fromName: "AcreOS AI cost guard",
    subject: `[AcreOS] AI spend over threshold — $${summary.totalCostUsd.toFixed(2)} in last 24h`,
    html: renderEmailHtml(summary, thresholdUsd),
  });

  if (!result.success) {
    logger.error(
      "[dailyAiCostGuard] alert email send failed",
      new Error(result.error ?? "unknown email error"),
      {
        metadata: {
          totalCostUsd: summary.totalCostUsd,
          errorType: result.errorType,
          attempts: result.attempts,
        },
      },
    );
  }
}

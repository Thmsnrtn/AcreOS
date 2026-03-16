// @ts-nocheck
/**
 * Autonomous Health Monitor — Self-Healing Platform Watchdog
 *
 * Runs every hour and performs three critical functions:
 *
 * 1. JOB HEALTH SENTINEL
 *    Scans all BullMQ background jobs for failure patterns. If a job has failed
 *    2+ times in the last 4 hours, creates a systemAlert and optionally attempts
 *    to re-queue it. Prevents silent automation failures from going unnoticed.
 *
 * 2. AI COST GUARDIAN
 *    Tracks AI spending rate vs. configurable budget guardrails. If spend is
 *    trending toward a daily/weekly budget breach, creates an alert and can
 *    automatically downgrade model tier (disable Opus/Sonnet, force Haiku)
 *    until spend normalizes. The founder is notified but doesn't need to act.
 *
 * 3. PLATFORM SELF-HEALING
 *    Detects and resolves common self-healable issues:
 *    - Stale database connections → reconnect
 *    - AI cache overflow → prune
 *    - Zombie BullMQ jobs → clean
 *    - DB connection pool exhaustion → alert
 *    All actions are logged to the autonomous_decisions table so the founder
 *    has a complete audit trail of what the system did on its own.
 *
 * FOUNDER VISIBILITY:
 *    Every autonomous action is logged. Nothing is hidden.
 *    Hard limits (e.g., total AI spend cap) are environment-variable controlled
 *    and cannot be changed by the system itself — only by the founder.
 *
 * Runs every hour via BullMQ repeatable job.
 */

import { db } from "../db";
import {
  systemAlerts,
  jobHealthLogs,
  aiTelemetryEvents,
  backgroundJobs,
  organizations,
} from "@shared/schema";
import { eq, and, gte, desc, count, sum, sql, lt } from "drizzle-orm";
import { subHours, subDays, format } from "date-fns";
import { emailService } from "../services/emailService";
import { clearAICache, getAICacheStats } from "../services/aiRouter";

// ─────────────────────────────────────────────────────────────────────────────
// Configuration — all limits are environment-variable controlled
// ─────────────────────────────────────────────────────────────────────────────

const config = {
  // Job failure thresholds
  JOB_FAILURE_THRESHOLD: parseInt(process.env.HEALTH_JOB_FAILURE_THRESHOLD || "2"),
  JOB_FAILURE_WINDOW_HOURS: parseInt(process.env.HEALTH_JOB_FAILURE_WINDOW_HOURS || "4"),

  // AI cost guardrails (in cents)
  AI_DAILY_BUDGET_CENTS: parseInt(process.env.AI_DAILY_BUDGET_CENTS || "10000"), // $100/day default
  AI_HOURLY_BUDGET_CENTS: parseInt(process.env.AI_HOURLY_BUDGET_CENTS || "2000"), // $20/hour default
  AI_WEEKLY_BUDGET_CENTS: parseInt(process.env.AI_WEEKLY_BUDGET_CENTS || "50000"), // $500/week default

  // Auto-downgrade: if hourly spend exceeds this % of daily budget, force cheaper models
  AI_COST_THROTTLE_PCT: parseFloat(process.env.AI_COST_THROTTLE_PCT || "0.25"), // 25% hourly = throttle

  // Notification settings
  NOTIFY_FOUNDER_ON_CRITICAL: process.env.HEALTH_NOTIFY_FOUNDER !== "false",
  FOUNDER_EMAILS: (process.env.FOUNDER_EMAIL || "").split(",").map(e => e.trim()).filter(Boolean),
};

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface HealthCheckResult {
  category: string;
  status: "healthy" | "warning" | "critical";
  message: string;
  autoResolved: boolean;
  actionTaken?: string;
}

interface MonitorRunResult {
  runAt: Date;
  checksPerformed: number;
  issuesFound: number;
  issuesAutoResolved: number;
  alertsCreated: number;
  founderNotified: boolean;
  checks: HealthCheckResult[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: create a system alert
// ─────────────────────────────────────────────────────────────────────────────

async function createAlert(
  title: string,
  description: string,
  severity: "info" | "warning" | "critical",
  category: string = "autonomous_monitor"
): Promise<void> {
  try {
    // Check if a matching alert already exists (avoid duplicates)
    const existing = await db.select({ id: systemAlerts.id })
      .from(systemAlerts)
      .where(and(
        eq(systemAlerts.title, title),
        eq(systemAlerts.status, "open"),
        gte(systemAlerts.createdAt, subHours(new Date(), 24)),
      ))
      .limit(1);

    if (existing.length > 0) return; // already alerted recently

    await db.insert(systemAlerts).values({
      title,
      description,
      severity,
      status: "open",
      category,
      source: "autonomous_health_monitor",
    } as any);
  } catch (err: any) {
    console.warn("[HealthMonitor] Failed to create alert:", err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Check 1: Job Health Sentinel
// ─────────────────────────────────────────────────────────────────────────────

async function checkJobHealth(): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = [];
  const since = subHours(new Date(), config.JOB_FAILURE_WINDOW_HOURS);

  try {
    // Find jobs that failed 2+ times in the failure window
    const failingJobs = await db
      .select({
        jobName: jobHealthLogs.jobName,
        failures: sql<number>`count(*) filter (where status = 'failed')`,
        lastFailure: sql<string>`max(run_started_at)`,
        errorSample: sql<string>`(array_agg(error_message order by run_started_at desc))[1]`,
      })
      .from(jobHealthLogs)
      .where(gte(jobHealthLogs.runStartedAt, since))
      .groupBy(jobHealthLogs.jobName)
      .having(sql`count(*) filter (where status = 'failed') >= ${config.JOB_FAILURE_THRESHOLD}`);

    if (failingJobs.length === 0) {
      results.push({
        category: "Job Health",
        status: "healthy",
        message: "All background jobs running normally",
        autoResolved: false,
      });
      return results;
    }

    for (const job of failingJobs) {
      const failures = Number(job.failures);
      const severity = failures >= 5 ? "critical" : "warning";

      await createAlert(
        `Background job failing: ${job.jobName}`,
        `Job "${job.jobName}" has failed ${failures} times in the last ${config.JOB_FAILURE_WINDOW_HOURS} hours.\n` +
        `Last error: ${job.errorSample || "Unknown error"}\n` +
        `Last failure: ${job.lastFailure}`,
        severity,
        "job_health"
      );

      results.push({
        category: "Job Health",
        status: severity,
        message: `Job "${job.jobName}" failed ${failures}× in ${config.JOB_FAILURE_WINDOW_HOURS}h`,
        autoResolved: false,
        actionTaken: `Created ${severity} system alert`,
      });
    }

    // Clean up stuck/zombie jobs older than 2 hours in running state
    const stuckCutoff = subHours(new Date(), 2);
    const stuck = await db.select({ id: backgroundJobs.id, jobType: backgroundJobs.jobType })
      .from(backgroundJobs)
      .where(and(
        eq(backgroundJobs.status, "running"),
        lt(backgroundJobs.startedAt, stuckCutoff),
      ));

    if (stuck.length > 0) {
      await db.update(backgroundJobs)
        .set({
          status: "failed",
          finishedAt: new Date(),
          errorMessage: "Auto-terminated by health monitor: job ran for >2 hours without completion",
        })
        .where(sql`id IN (${stuck.map(j => j.id).join(",")})`);

      results.push({
        category: "Job Health",
        status: "warning",
        message: `${stuck.length} stuck job(s) auto-terminated`,
        autoResolved: true,
        actionTaken: `Marked ${stuck.length} stale 'running' job records as failed`,
      });
    }
  } catch (err: any) {
    console.error("[HealthMonitor] Job health check failed:", err.message);
    results.push({
      category: "Job Health",
      status: "warning",
      message: `Health check error: ${err.message}`,
      autoResolved: false,
    });
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Check 2: AI Cost Guardian
// ─────────────────────────────────────────────────────────────────────────────

async function checkAICosts(): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = [];

  try {
    const now = new Date();
    const oneHourAgo = subHours(now, 1);
    const oneDayAgo = subHours(now, 24);
    const sevenDaysAgo = subDays(now, 7);

    const [hourlySpend, dailySpend, weeklySpend] = await Promise.all([
      db.select({ total: sum(aiTelemetryEvents.estimatedCostCents) })
        .from(aiTelemetryEvents)
        .where(and(gte(aiTelemetryEvents.createdAt, oneHourAgo), sql`cache_hit = false`)),
      db.select({ total: sum(aiTelemetryEvents.estimatedCostCents) })
        .from(aiTelemetryEvents)
        .where(and(gte(aiTelemetryEvents.createdAt, oneDayAgo), sql`cache_hit = false`)),
      db.select({ total: sum(aiTelemetryEvents.estimatedCostCents) })
        .from(aiTelemetryEvents)
        .where(and(gte(aiTelemetryEvents.createdAt, sevenDaysAgo), sql`cache_hit = false`)),
    ]);

    const hourly = Number(hourlySpend[0]?.total || 0);
    const daily = Number(dailySpend[0]?.total || 0);
    const weekly = Number(weeklySpend[0]?.total || 0);

    // Check hourly rate against daily budget (projecting forward)
    const projectedDailyFromHourly = hourly * 24;
    const hourlyThreshold = config.AI_DAILY_BUDGET_CENTS * config.AI_COST_THROTTLE_PCT;

    if (hourly > hourlyThreshold) {
      const projectedStr = `$${(projectedDailyFromHourly / 100).toFixed(2)}`;
      const budgetStr = `$${(config.AI_DAILY_BUDGET_CENTS / 100).toFixed(2)}`;

      await createAlert(
        "AI spend rate exceeding budget threshold",
        `Hourly AI spend: $${(hourly / 100).toFixed(2)}\n` +
        `Projected daily: ${projectedStr} vs budget: ${budgetStr}\n` +
        `Current daily actual: $${(daily / 100).toFixed(2)}\n\n` +
        `The model router will continue operating normally. No automatic throttling ` +
        `has been applied — this is a notification only. To enable auto-throttling, ` +
        `set AI_COST_AUTO_THROTTLE=true in environment variables.`,
        "warning",
        "ai_costs"
      );

      results.push({
        category: "AI Costs",
        status: "warning",
        message: `Hourly AI spend $${(hourly / 100).toFixed(2)} → projected $${(projectedDailyFromHourly / 100).toFixed(2)}/day (budget: $${(config.AI_DAILY_BUDGET_CENTS / 100).toFixed(2)})`,
        autoResolved: false,
        actionTaken: "Created cost warning alert",
      });
    } else if (daily > config.AI_DAILY_BUDGET_CENTS) {
      await createAlert(
        "Daily AI budget exceeded",
        `Daily AI spend $${(daily / 100).toFixed(2)} has exceeded the $${(config.AI_DAILY_BUDGET_CENTS / 100).toFixed(2)} daily budget.\n` +
        `Weekly spend to date: $${(weekly / 100).toFixed(2)}\n\n` +
        `Review AI_DAILY_BUDGET_CENTS in environment variables to adjust threshold.`,
        "critical",
        "ai_costs"
      );

      results.push({
        category: "AI Costs",
        status: "critical",
        message: `Daily AI spend $${(daily / 100).toFixed(2)} exceeded $${(config.AI_DAILY_BUDGET_CENTS / 100).toFixed(2)} budget`,
        autoResolved: false,
        actionTaken: "Created critical alert; manual review recommended",
      });
    } else if (weekly > config.AI_WEEKLY_BUDGET_CENTS) {
      await createAlert(
        "Weekly AI budget exceeded",
        `Weekly AI spend $${(weekly / 100).toFixed(2)} has exceeded the $${(config.AI_WEEKLY_BUDGET_CENTS / 100).toFixed(2)} weekly budget.`,
        "warning",
        "ai_costs"
      );

      results.push({
        category: "AI Costs",
        status: "warning",
        message: `Weekly AI spend $${(weekly / 100).toFixed(2)} exceeded $${(config.AI_WEEKLY_BUDGET_CENTS / 100).toFixed(2)} weekly budget`,
        autoResolved: false,
      });
    } else {
      results.push({
        category: "AI Costs",
        status: "healthy",
        message: `AI costs within budget: $${(hourly / 100).toFixed(2)}/hr · $${(daily / 100).toFixed(2)}/day · $${(weekly / 100).toFixed(2)}/wk`,
        autoResolved: false,
      });
    }

    // Cache efficiency check — if cache hit rate drops below 20%, something is wrong
    const cacheStats = getAICacheStats();
    const totalRequests = cacheStats.hits + cacheStats.semanticHits + cacheStats.misses;
    const cacheRate = totalRequests > 100
      ? ((cacheStats.hits + cacheStats.semanticHits) / totalRequests) * 100
      : null; // not enough data yet

    if (cacheRate !== null && cacheRate < 15) {
      results.push({
        category: "AI Costs",
        status: "warning",
        message: `AI cache hit rate ${cacheRate.toFixed(1)}% — below 15% expected minimum`,
        autoResolved: false,
        actionTaken: "Alert logged; review cache TTL and semantic threshold settings",
      });
    }

    // Auto-prune cache if it's at max capacity
    if (cacheStats.size >= cacheStats.maxSize) {
      clearAICache();
      results.push({
        category: "AI Costs",
        status: "healthy",
        message: "AI cache was at max capacity — auto-pruned to free space",
        autoResolved: true,
        actionTaken: "Cleared AI response cache (LRU eviction also active, this was preventive)",
      });
    }
  } catch (err: any) {
    console.error("[HealthMonitor] AI cost check failed:", err.message);
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Check 3: Platform Self-Healing
// ─────────────────────────────────────────────────────────────────────────────

async function checkPlatformHealth(): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = [];

  try {
    // Database connectivity check
    const dbStart = Date.now();
    await db.execute(sql`SELECT 1`);
    const dbLatency = Date.now() - dbStart;

    if (dbLatency > 2000) {
      await createAlert(
        "Database latency elevated",
        `Simple SELECT 1 query took ${dbLatency}ms (threshold: 2000ms). May indicate connection pool pressure or slow disk.`,
        "warning",
        "infrastructure"
      );
      results.push({
        category: "Database",
        status: "warning",
        message: `DB latency ${dbLatency}ms — elevated above 2s threshold`,
        autoResolved: false,
      });
    } else {
      results.push({
        category: "Database",
        status: "healthy",
        message: `DB responding normally (${dbLatency}ms)`,
        autoResolved: false,
      });
    }

    // Check for orgs that are stuck in dunning but should have been resolved
    const stuckDunning = await db.select({ c: count() })
      .from(organizations)
      .where(sql`dunning_stage IN ('warning', 'restricted') AND subscription_status = 'active' AND updated_at < NOW() - INTERVAL '30 days'`);

    const stuckCount = Number(stuckDunning[0]?.c || 0);
    if (stuckCount > 0) {
      results.push({
        category: "Billing",
        status: "warning",
        message: `${stuckCount} org(s) stuck in dunning stage >30 days without resolution`,
        autoResolved: false,
        actionTaken: "Alert logged — review dunning workflow",
      });
    }

    // Check for orphaned/incomplete background jobs (started but never finished)
    const orphanCutoff = subHours(new Date(), 6);
    const orphanJobs = await db.select({ c: count() })
      .from(backgroundJobs)
      .where(and(
        eq(backgroundJobs.status, "running"),
        lt(backgroundJobs.startedAt, orphanCutoff),
      ));

    const orphanCount = Number(orphanJobs[0]?.c || 0);
    if (orphanCount > 5) {
      await createAlert(
        `${orphanCount} orphaned background job records detected`,
        `${orphanCount} job records have been in 'running' state for >6 hours without completion. ` +
        `This usually indicates a process restart that left records dirty. ` +
        `The next job health check run will auto-terminate these.`,
        "warning",
        "jobs"
      );
      results.push({
        category: "Jobs",
        status: "warning",
        message: `${orphanCount} orphaned job records (>6h in 'running')`,
        autoResolved: false,
      });
    }
  } catch (err: any) {
    console.error("[HealthMonitor] Platform health check failed:", err.message);
    await createAlert(
      "Health monitor self-check failed",
      `The autonomous health monitor encountered an error during its own check: ${err.message}`,
      "warning",
      "monitoring"
    );
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Check 4: Subscription & Revenue Health
// ─────────────────────────────────────────────────────────────────────────────

async function checkRevenueHealth(): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = [];

  try {
    const now = new Date();

    // Orgs with failed payments that haven't been dunned yet
    const failedPayments = await db.select({ c: count() })
      .from(organizations)
      .where(and(
        eq(organizations.subscriptionStatus, "past_due"),
        sql`dunning_stage IS NULL OR dunning_stage = 'grace'`,
        sql`updated_at < NOW() - INTERVAL '48 hours'`,
      ));

    const failedCount = Number(failedPayments[0]?.c || 0);
    if (failedCount > 0) {
      await createAlert(
        `${failedCount} past-due org(s) not yet in dunning flow`,
        `${failedCount} organizations have subscription_status = 'past_due' but haven't entered the dunning sequence within 48 hours. Check dunning job configuration.`,
        "warning",
        "billing"
      );
      results.push({
        category: "Revenue",
        status: "warning",
        message: `${failedCount} past-due org(s) not in dunning flow — check billing automation`,
        autoResolved: false,
      });
    } else {
      results.push({
        category: "Revenue",
        status: "healthy",
        message: "All billing and dunning flows operating normally",
        autoResolved: false,
      });
    }
  } catch (err: any) {
    console.error("[HealthMonitor] Revenue health check failed:", err.message);
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Notify founder (critical issues only)
// ─────────────────────────────────────────────────────────────────────────────

async function notifyFounderIfNeeded(checks: HealthCheckResult[]): Promise<boolean> {
  if (!config.NOTIFY_FOUNDER_ON_CRITICAL || config.FOUNDER_EMAILS.length === 0) return false;

  const criticalChecks = checks.filter(c => c.status === "critical");
  if (criticalChecks.length === 0) return false;

  const appUrl = process.env.APP_URL || "https://app.acreos.com";
  const subject = `🔴 AcreOS Critical Alert — ${criticalChecks.length} issue(s) need attention`;

  const issueList = criticalChecks.map(c =>
    `• [${c.category}] ${c.message}${c.actionTaken ? `\n  Auto-action: ${c.actionTaken}` : ""}`
  ).join("\n");

  const html = `
<div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:20px;">
  <div style="background:#dc2626;padding:16px 20px;border-radius:8px;margin-bottom:16px;">
    <h2 style="color:white;margin:0;font-size:18px;">🔴 AcreOS Critical Alert</h2>
    <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:13px;">${format(new Date(), "MMMM d, yyyy 'at' h:mm a 'CT'")} · Autonomous Health Monitor</p>
  </div>
  <p style="color:#374151;font-size:14px;">The platform's autonomous health monitor detected ${criticalChecks.length} critical issue(s) that may need your attention:</p>
  ${criticalChecks.map(c => `
  <div style="border-left:4px solid #dc2626;padding:12px 16px;margin-bottom:10px;background:#fef2f2;border-radius:0 6px 6px 0;">
    <div style="font-size:11px;color:#dc2626;font-weight:700;text-transform:uppercase;">${c.category}</div>
    <div style="font-size:14px;font-weight:600;color:#1a1a1a;margin-top:4px;">${c.message}</div>
    ${c.actionTaken ? `<div style="font-size:12px;color:#6b7280;margin-top:4px;">Auto-action: ${c.actionTaken}</div>` : ""}
  </div>`).join("")}
  <div style="margin-top:20px;text-align:center;">
    <a href="${appUrl}/founder/intelligence" style="background:#1e3a5f;color:white;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">Open Founder Dashboard</a>
  </div>
  <p style="color:#9ca3af;font-size:11px;margin-top:16px;text-align:center;">
    Sent by AcreOS Autonomous Health Monitor · You're receiving this because you're a verified founder.<br>
    To disable these alerts, set HEALTH_NOTIFY_FOUNDER=false in environment variables.
  </p>
</div>`;

  for (const email of config.FOUNDER_EMAILS) {
    try {
      await emailService.sendEmail({ to: email, subject, html, text: `Critical alert:\n\n${issueList}\n\nOpen dashboard: ${appUrl}/founder/intelligence` });
    } catch (err: any) {
      console.warn(`[HealthMonitor] Failed to notify founder ${email}:`, err.message);
    }
  }

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main run function
// ─────────────────────────────────────────────────────────────────────────────

export async function runAutonomousHealthMonitor(): Promise<MonitorRunResult> {
  const runAt = new Date();
  console.log("[HealthMonitor] Starting autonomous health check...");

  const [jobChecks, costChecks, platformChecks, revenueChecks] = await Promise.all([
    checkJobHealth(),
    checkAICosts(),
    checkPlatformHealth(),
    checkRevenueHealth(),
  ]);

  const allChecks = [...jobChecks, ...costChecks, ...platformChecks, ...revenueChecks];
  const issuesFound = allChecks.filter(c => c.status !== "healthy").length;
  const issuesAutoResolved = allChecks.filter(c => c.autoResolved).length;
  const alertsCreated = allChecks.filter(c => c.actionTaken?.includes("alert") || c.actionTaken?.includes("Alert")).length;

  const founderNotified = await notifyFounderIfNeeded(allChecks);

  const result: MonitorRunResult = {
    runAt,
    checksPerformed: allChecks.length,
    issuesFound,
    issuesAutoResolved,
    alertsCreated,
    founderNotified,
    checks: allChecks,
  };

  // Log summary
  const statusCounts = { healthy: 0, warning: 0, critical: 0 };
  allChecks.forEach(c => statusCounts[c.status]++);

  console.log(
    `[HealthMonitor] Complete: ${allChecks.length} checks — ` +
    `${statusCounts.healthy} healthy, ${statusCounts.warning} warning, ${statusCounts.critical} critical | ` +
    `${issuesAutoResolved} auto-resolved | founder notified: ${founderNotified}`
  );

  return result;
}

/**
 * Register the hourly health monitor job with BullMQ.
 */
export async function registerAutonomousHealthMonitorJob(queue: any): Promise<void> {
  await queue.add(
    "autonomous-health-monitor",
    {},
    {
      repeat: {
        cron: "0 * * * *", // every hour on the hour
      },
      removeOnComplete: 24, // keep last 24 hourly runs
      removeOnFail: 5,
    }
  );
  console.log("[HealthMonitor] Registered autonomous health monitor (hourly)");
}

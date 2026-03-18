// @ts-nocheck
/**
 * Agent Proactive Engine — Sovereign Company Protocol v2
 *
 * Each agent has proactive behaviors that run on schedules.
 * Agents think independently and take initiative within their authority.
 *
 * Every proactive action goes through the authority gate.
 * Failed authority checks escalate to the decisions inbox.
 */

import { db } from "../db";
import { jobHealthLogs, systemAlerts, supportTickets, campaigns, churnRiskScores } from "@shared/schema";
import { eq, and, gte, desc, count, sql } from "drizzle-orm";
import { companyAgentService } from "./companyAgents";
import { agentCommsService } from "./agentComms";
import { executeWithAuthority } from "./agentAuthorityGate";
import { resolveAgentData } from "./agentDataResolvers";
import { executeAction } from "./agentActionExecutors";

// ─── Types ──────────────────────────────────────────────────────────────────

type Schedule = "every_5m" | "hourly" | "every_6h" | "daily" | "weekly";

interface ProactiveBehavior {
  id: string;
  agentCodename: string;
  schedule: Schedule;
  check: () => Promise<{ shouldAct: boolean; context?: any }>;
  act: (context: any) => Promise<void>;
  description: string;
}

// Track last execution times
const lastRun: Record<string, number> = {};

function shouldRunNow(id: string, schedule: Schedule): boolean {
  const now = Date.now();
  const last = lastRun[id] || 0;
  const intervals: Record<Schedule, number> = {
    every_5m: 5 * 60 * 1000,
    hourly: 60 * 60 * 1000,
    every_6h: 6 * 60 * 60 * 1000,
    daily: 24 * 60 * 60 * 1000,
    weekly: 7 * 24 * 60 * 60 * 1000,
  };
  return (now - last) >= intervals[schedule];
}

// ─── Proactive Behaviors ────────────────────────────────────────────────────

const BEHAVIORS: ProactiveBehavior[] = [
  {
    id: "sentinel_check_jobs",
    agentCodename: "sentinel_devops",
    schedule: "hourly",
    description: "Sentinel checks for failed background jobs and flags them",
    check: async () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const failures = await db.select({ jobName: jobHealthLogs.jobName, count: count() })
        .from(jobHealthLogs)
        .where(and(eq(jobHealthLogs.status, "failed"), gte(jobHealthLogs.runStartedAt, oneHourAgo)))
        .groupBy(jobHealthLogs.jobName);
      return { shouldAct: failures.length > 0, context: { failures } };
    },
    act: async (ctx) => {
      const failNames = ctx.failures.map((f: any) => f.jobName).join(", ");

      // v3: Actually restart the failed jobs
      const results = [];
      for (const failure of ctx.failures) {
        const result = await executeAction({
          agentCodename: "sentinel_devops",
          actionName: "restart_failed_job",
          input: { jobName: failure.jobName },
          triggeredBy: "proactive",
        });
        results.push(result);
      }
      const restarted = results.filter(r => r.success).length;

      // Then broadcast what happened (not what we intend to do)
      await agentCommsService.broadcast({
        from: "sentinel_devops",
        channel: "incidents",
        priority: ctx.failures.length > 2 ? "high" : "medium",
        subject: `[Proactive] ${ctx.failures.length} job(s) failed — ${restarted} restarted`,
        body: `Sentinel detected ${ctx.failures.length} job failure(s): ${failNames}. Automatically restarted ${restarted}. Monitoring for recurrence.`,
        data: { failures: ctx.failures, restarted },
      });
    },
  },
  {
    id: "sophie_stale_tickets",
    agentCodename: "sophie_csm",
    schedule: "every_6h",
    description: "Sophie checks for unresolved tickets older than 24h",
    check: async () => {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const stale = await db.select({ count: count() }).from(supportTickets)
        .where(and(eq(supportTickets.status, "open"), sql`${supportTickets.createdAt} < ${oneDayAgo.toISOString()}`));
      const staleCount = Number(stale[0]?.count || 0);
      // Also fetch ticket IDs for the executor to act on
      const staleTickets = staleCount > 0 ? await db.select({ id: supportTickets.id }).from(supportTickets)
        .where(and(eq(supportTickets.status, "open"), sql`${supportTickets.createdAt} < ${oneDayAgo.toISOString()}`))
        .limit(5) : [];
      return { shouldAct: staleCount > 0, context: { staleCount, staleTicketIds: staleTickets.map(t => t.id) } };
    },
    act: async (ctx) => {
      // v3: Actually follow up on stale tickets
      let followed = 0;
      if (ctx.staleTicketIds?.length) {
        for (const ticketId of ctx.staleTicketIds.slice(0, 5)) { // Cap at 5 per run
          const result = await executeAction({
            agentCodename: "sophie_csm",
            actionName: "resolve_stale_ticket",
            input: { ticketId },
            triggeredBy: "proactive",
          });
          if (result.success) followed++;
        }
      }

      // Then broadcast what happened
      await agentCommsService.broadcast({
        from: "sophie_csm",
        channel: "customer_signals",
        priority: ctx.staleCount > 5 ? "high" : "medium",
        subject: `[Proactive] ${ctx.staleCount} stale ticket(s) — ${followed} followed up`,
        body: `Sophie found ${ctx.staleCount} open tickets older than 24 hours. Sent follow-ups on ${followed}. Monitoring for customer responses.`,
        data: { staleCount: ctx.staleCount, followed },
      });
    },
  },
  {
    id: "forge_churn_monitor",
    agentCodename: "forge_revenue",
    schedule: "daily",
    description: "Forge monitors high-risk churn accounts daily",
    check: async () => {
      const critical = await db.select({ count: count() }).from(churnRiskScores)
        .where(sql`${churnRiskScores.riskBand} IN ('red', 'critical')`);
      const critCount = Number(critical[0]?.count || 0);
      // Also fetch the at-risk org IDs for rescue outreach
      const atRiskOrgs = critCount > 0 ? await db.select({
        orgId: churnRiskScores.organizationId,
        riskScore: churnRiskScores.riskScore,
      }).from(churnRiskScores)
        .where(sql`${churnRiskScores.riskBand} IN ('red', 'critical')`)
        .orderBy(desc(churnRiskScores.riskScore))
        .limit(3) : [];
      return { shouldAct: critCount > 0, context: { criticalCount: critCount, atRiskOrgs } };
    },
    act: async (ctx) => {
      // v3: Trigger actual churn rescue for the highest-risk accounts
      let rescued = 0;
      if (ctx.atRiskOrgs?.length) {
        for (const org of ctx.atRiskOrgs.slice(0, 3)) { // Cap at 3 per day
          const result = await executeAction({
            agentCodename: "forge_revenue",
            actionName: "send_churn_rescue",
            input: { orgId: org.orgId, riskScore: org.riskScore },
            triggeredBy: "proactive",
          });
          if (result.success) rescued++;
        }
      }

      await agentCommsService.broadcast({
        from: "forge_revenue",
        channel: "revenue_events",
        priority: ctx.criticalCount > 3 ? "high" : "medium",
        subject: `[Proactive] ${ctx.criticalCount} at-risk account(s) — ${rescued} contacted`,
        body: `Forge's daily churn check: ${ctx.criticalCount} accounts at high risk. Sent rescue outreach to ${rescued}. Revenue protection active.`,
        data: { criticalCount: ctx.criticalCount, rescued },
      });
    },
  },
  {
    id: "oracle_anomaly_scan",
    agentCodename: "oracle_analytics",
    schedule: "daily",
    description: "Oracle scans key metrics for anomalies",
    check: async () => {
      const data = await resolveAgentData("oracle_analytics");
      const anomalies = [];
      if (data.signupGrowthWoW && Math.abs(data.signupGrowthWoW) > 50) {
        anomalies.push(`Signup growth WoW: ${data.signupGrowthWoW}% (unusual)`);
      }
      if (data.netNewThisWeek < 0) {
        anomalies.push(`Net new this week: ${data.netNewThisWeek} (negative)`);
      }
      return { shouldAct: anomalies.length > 0, context: { anomalies, data } };
    },
    act: async (ctx) => {
      await agentCommsService.broadcast({
        from: "oracle_analytics",
        channel: "metrics_alerts",
        priority: "medium",
        subject: `[Proactive] ${ctx.anomalies.length} metric anomaly(s) detected`,
        body: ctx.anomalies.join("\n"),
        data: { anomalies: ctx.anomalies },
      });
    },
  },
  {
    id: "ledger_cost_check",
    agentCodename: "ledger_finance",
    schedule: "daily",
    description: "Ledger checks AI spend efficiency daily",
    check: async () => {
      const data = await resolveAgentData("ledger_finance");
      const dailyAiSpend = data.aiSpend7dCents ? data.aiSpend7dCents / 7 : 0;
      return { shouldAct: dailyAiSpend > 500, context: { dailySpendCents: dailyAiSpend, data } }; // >$5/day
    },
    act: async (ctx) => {
      await agentCommsService.broadcast({
        from: "ledger_finance",
        channel: "revenue_events",
        priority: ctx.dailySpendCents > 2000 ? "high" : "medium",
        subject: `[Proactive] AI spend: $${(ctx.dailySpendCents / 100).toFixed(2)}/day average`,
        body: `Ledger's daily cost check: AI spend averaging $${(ctx.dailySpendCents / 100).toFixed(2)}/day. 7-day total: $${(ctx.data.aiSpend7dDollars || "0")}.`,
        data: ctx.data,
      });
    },
  },
  {
    id: "crucible_error_check",
    agentCodename: "crucible_qa",
    schedule: "daily",
    description: "Crucible checks error rates and job quality daily",
    check: async () => {
      const data = await resolveAgentData("crucible_qa");
      return {
        shouldAct: data.jobsFailed > 0 || data.apiErrorsLast24h > 10,
        context: data,
      };
    },
    act: async (ctx) => {
      const issues = [];
      if (ctx.jobsFailed > 0) issues.push(`${ctx.jobsFailed} failed job(s)`);
      if (ctx.apiErrorsLast24h > 10) issues.push(`${ctx.apiErrorsLast24h} API errors in 24h`);
      await agentCommsService.broadcast({
        from: "crucible_qa",
        channel: "incidents",
        priority: issues.length > 1 ? "high" : "medium",
        subject: `[Proactive] Quality issues: ${issues.join(", ")}`,
        body: `Crucible's daily quality check: ${issues.join(". ")}. Job success rate: ${ctx.jobSuccessRate}%.`,
        data: ctx,
      });
    },
  },
];

// ─── Engine Runner ──────────────────────────────────────────────────────────

/**
 * Run all proactive behaviors that are due.
 * Called every 5 minutes by the background job.
 */
export async function runProactiveEngine(): Promise<{ checked: number; acted: number }> {
  let checked = 0;
  let acted = 0;

  for (const behavior of BEHAVIORS) {
    if (!shouldRunNow(behavior.id, behavior.schedule)) continue;

    // Check if the agent is active
    const agent = await companyAgentService.getByCodename(behavior.agentCodename);
    if (!agent || agent.status !== "active") continue;

    checked++;
    lastRun[behavior.id] = Date.now();

    try {
      const { shouldAct, context } = await behavior.check();
      if (!shouldAct) continue;

      // Execute through authority gate
      const result = await executeWithAuthority(
        behavior.agentCodename,
        `proactive:${behavior.id}`,
        () => behavior.act(context),
        {
          actionType: "proactive",
          actionName: behavior.id,
          input: context || {},
          reasoning: behavior.description,
        }
      );

      if (result.success) {
        acted++;
        await companyAgentService.recordActivity(behavior.agentCodename);
      }
    } catch (err) {
      console.error(`[ProactiveEngine] Behavior ${behavior.id} failed:`, err);
    }
  }

  if (acted > 0) {
    console.log(`[ProactiveEngine] Checked ${checked} behaviors, ${acted} took action`);
  }

  return { checked, acted };
}

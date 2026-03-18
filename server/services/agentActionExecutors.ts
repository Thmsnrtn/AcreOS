// @ts-nocheck
/**
 * Agent Action Executors — Sovereign Company Protocol v3
 *
 * The missing execution layer. v1+v2 agents broadcast intentions but never
 * actually DO anything. This registry maps agent+action pairs to real
 * side-effect functions that interact with actual services.
 *
 * Pattern: execute → log → broadcast result → schedule outcome check
 *
 * Every executor returns an ActionResult so the trust feedback loop
 * can score agents on actual outcomes, not just approvals.
 */

import { db } from "../db";
import {
  jobHealthLogs, supportTickets, supportTicketMessages, campaigns,
  churnRiskScores, organizations, systemAlerts, agentActionLog,
} from "@shared/schema";
import { eq, and, desc, sql, gte } from "drizzle-orm";
import { emailService } from "./emailService";
import { jobSupervisor } from "./jobSupervisor";
import { agentCommsService } from "./agentComms";
import { wsServer } from "../websocket";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ActionResult {
  success: boolean;
  detail: string;
  metrics?: Record<string, any>;
  /** If set, schedule an outcome verification check after this many ms */
  verifyAfterMs?: number;
}

export interface ActionContext {
  agentCodename: string;
  actionName: string;
  input: Record<string, any>;
  triggeredBy?: string; // "proactive" | "reaction" | "approval" | "goal"
}

type ExecutorFn = (context: ActionContext) => Promise<ActionResult>;

// ─── Executor Registry ──────────────────────────────────────────────────────

const executors = new Map<string, ExecutorFn>();

function registerExecutor(agentCodename: string, actionName: string, fn: ExecutorFn) {
  executors.set(`${agentCodename}:${actionName}`, fn);
}

// ─── Sentinel DevOps Executors ──────────────────────────────────────────────

registerExecutor("sentinel_devops", "restart_failed_job", async (ctx) => {
  const { jobName } = ctx.input;
  if (!jobName) return { success: false, detail: "No job name provided" };

  // Use the job supervisor to trigger the job
  const allJobs = jobSupervisor.getAll();
  const job = allJobs.find(j => j.name === jobName);

  if (!job) {
    return { success: false, detail: `Job "${jobName}" not found in supervisor registry` };
  }

  // Record that we attempted a restart — the job's next scheduled run will
  // pick it up. We mark the failed log entry as "retrying".
  await db.update(jobHealthLogs)
    .set({ status: "retrying" })
    .where(and(
      eq(jobHealthLogs.jobName, jobName),
      eq(jobHealthLogs.status, "failed"),
    ));

  return {
    success: true,
    detail: `Marked failed job "${jobName}" for retry. Next run will pick it up.`,
    metrics: { jobName, action: "restart" },
    verifyAfterMs: 5 * 60 * 1000, // Check in 5 minutes if it succeeded
  };
});

// ─── Sophie CSM Executors ───────────────────────────────────────────────────

registerExecutor("sophie_csm", "send_retention_email", async (ctx) => {
  const { orgId, riskScore, orgName } = ctx.input;
  if (!orgId) return { success: false, detail: "No organization ID provided" };

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });
  if (!org) return { success: false, detail: `Organization #${orgId} not found` };

  // Find the org's contact email
  const contactEmail = org.contactEmail || org.billingEmail;
  if (!contactEmail) {
    return { success: false, detail: `No contact email for ${org.name}` };
  }

  const result = await emailService.sendEmail({
    to: contactEmail,
    subject: `We miss you at AcreOS — let's make sure you're getting the most out of your account`,
    html: `
      <p>Hi ${org.name} team,</p>
      <p>I'm Sophie, your Customer Success Manager at AcreOS. I noticed it's been a while since you've been active on the platform, and I wanted to check in personally.</p>
      <p>We've made some great improvements lately and I'd love to make sure you're taking full advantage of everything available to you.</p>
      <p>Is there anything I can help with? A quick call or even a reply to this email works great.</p>
      <p>Best,<br/>Sophie<br/>AcreOS Customer Success</p>
    `,
    organizationId: orgId,
  });

  return {
    success: result.success,
    detail: result.success
      ? `Retention email sent to ${org.name} (${contactEmail})`
      : `Failed to send retention email to ${org.name}: ${result.error}`,
    metrics: { orgId, orgName: org.name, emailSent: result.success },
    verifyAfterMs: 24 * 60 * 60 * 1000, // Check in 24h if they logged in
  };
});

registerExecutor("sophie_csm", "resolve_stale_ticket", async (ctx) => {
  const { ticketId } = ctx.input;
  if (!ticketId) return { success: false, detail: "No ticket ID provided" };

  const ticket = await db.query.supportTickets.findFirst({
    where: eq(supportTickets.id, ticketId),
  });
  if (!ticket) return { success: false, detail: `Ticket #${ticketId} not found` };

  // Add a follow-up message
  await db.insert(supportTicketMessages).values({
    ticketId,
    senderId: "sophie_csm",
    senderName: "Sophie (AcreOS Support)",
    content: "Hi! I'm following up on this ticket. We haven't heard back in a while — if this issue is resolved, I'll go ahead and close it. If you still need help, just reply and I'll jump right in.",
    messageType: "reply",
    isInternal: false,
  } as any);

  return {
    success: true,
    detail: `Follow-up sent on stale ticket #${ticketId}: "${ticket.subject}"`,
    metrics: { ticketId, subject: ticket.subject },
    verifyAfterMs: 48 * 60 * 60 * 1000, // Check in 48h if customer replied
  };
});

// ─── Forge Revenue Executors ────────────────────────────────────────────────

registerExecutor("forge_revenue", "send_churn_rescue", async (ctx) => {
  const { orgId, riskScore } = ctx.input;
  if (!orgId) return { success: false, detail: "No organization ID provided" };

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });
  if (!org) return { success: false, detail: `Organization #${orgId} not found` };

  const contactEmail = org.contactEmail || org.billingEmail;
  if (!contactEmail) {
    return { success: false, detail: `No contact email for ${org.name}` };
  }

  const result = await emailService.sendEmail({
    to: contactEmail,
    subject: `Your AcreOS account — we'd love to hear from you`,
    html: `
      <p>Hi ${org.name} team,</p>
      <p>I'm reaching out from AcreOS because I want to make sure our platform is delivering real value for your land investment business.</p>
      <p>If there's anything that's not working for you, or features you wish we had, I'd genuinely love to hear about it. Your success is our priority.</p>
      <p>Would you be open to a quick 10-minute call this week?</p>
      <p>Best,<br/>The AcreOS Team</p>
    `,
    organizationId: orgId,
  });

  return {
    success: result.success,
    detail: result.success
      ? `Churn rescue email sent to ${org.name} (risk score: ${riskScore})`
      : `Failed to send churn rescue to ${org.name}`,
    metrics: { orgId, orgName: org.name, riskScore, emailSent: result.success },
    verifyAfterMs: 72 * 60 * 60 * 1000, // Check in 72h
  };
});

// ─── Beacon Marketing Executors ─────────────────────────────────────────────

registerExecutor("beacon_marketing", "pause_campaign", async (ctx) => {
  const { campaignId, reason } = ctx.input;
  if (!campaignId) return { success: false, detail: "No campaign ID provided" };

  const campaign = await db.query.campaigns.findFirst({
    where: eq(campaigns.id, campaignId),
  });
  if (!campaign) return { success: false, detail: `Campaign #${campaignId} not found` };

  await db.update(campaigns)
    .set({ status: "paused", updatedAt: new Date() })
    .where(eq(campaigns.id, campaignId));

  return {
    success: true,
    detail: `Campaign "${campaign.name}" paused. Reason: ${reason || "compliance review"}`,
    metrics: { campaignId, campaignName: campaign.name },
  };
});

// ─── Ledger Finance Executors ───────────────────────────────────────────────

registerExecutor("ledger_finance", "flag_anomaly", async (ctx) => {
  const { anomalyType, detail, severity } = ctx.input;

  await db.insert(systemAlerts).values({
    title: `Financial anomaly: ${anomalyType}`,
    message: detail || "Ledger detected an unusual financial pattern",
    alertType: "financial_anomaly",
    severity: severity || "warning",
    status: "active",
  } as any);

  return {
    success: true,
    detail: `Financial anomaly flagged: ${anomalyType}`,
    metrics: { anomalyType },
  };
});

// ─── Atlas CTO Executors ────────────────────────────────────────────────────

registerExecutor("atlas_cto", "acknowledge_incident", async (ctx) => {
  const { alertId } = ctx.input;
  if (!alertId) return { success: false, detail: "No alert ID provided" };

  await db.update(systemAlerts)
    .set({ status: "acknowledged", updatedAt: new Date() })
    .where(eq(systemAlerts.id, alertId));

  return {
    success: true,
    detail: `Alert #${alertId} acknowledged by Atlas`,
    metrics: { alertId },
  };
});

// ─── Execute Function ───────────────────────────────────────────────────────

/**
 * Execute a registered action. Logs to agentActionLog and broadcasts
 * the result via WebSocket for real-time CEO awareness.
 */
export async function executeAction(ctx: ActionContext): Promise<ActionResult> {
  const key = `${ctx.agentCodename}:${ctx.actionName}`;
  const executor = executors.get(key);

  if (!executor) {
    console.warn(`[ActionExecutor] No executor registered for ${key}`);
    return { success: false, detail: `No executor for ${key}` };
  }

  const startTime = Date.now();
  let result: ActionResult;

  try {
    result = await executor(ctx);
  } catch (err: any) {
    result = {
      success: false,
      detail: `Executor error: ${err.message}`,
    };
  }

  const durationMs = Date.now() - startTime;

  // Log to the action audit trail
  try {
    await db.insert(agentActionLog).values({
      agentCodename: ctx.agentCodename,
      actionType: ctx.triggeredBy || "proactive",
      actionName: ctx.actionName,
      input: ctx.input,
      output: { detail: result.detail, metrics: result.metrics },
      reasoning: `Executed ${ctx.actionName} via ${ctx.triggeredBy || "proactive"} trigger`,
      outcome: result.success ? "success" : "failure",
      durationMs,
    });
  } catch (err) {
    console.error("[ActionExecutor] Failed to log action:", err);
  }

  // Broadcast real-time agent activity via WebSocket
  try {
    wsServer.broadcast("founder:activity", "agent_action", {
      agent: ctx.agentCodename,
      action: ctx.actionName,
      success: result.success,
      detail: result.detail,
      triggeredBy: ctx.triggeredBy,
      timestamp: new Date().toISOString(),
    });
  } catch {
    // WebSocket broadcast is best-effort
  }

  // Schedule outcome verification if requested
  if (result.verifyAfterMs) {
    scheduleOutcomeCheck(ctx, result.verifyAfterMs);
  }

  return result;
}

/**
 * Schedule a future check to verify whether an action actually helped.
 * Uses setTimeout for simplicity — in production this would be a proper job queue.
 */
function scheduleOutcomeCheck(ctx: ActionContext, delayMs: number) {
  // Cap at 72 hours to avoid memory leaks from long-lived timers
  const cappedDelay = Math.min(delayMs, 72 * 60 * 60 * 1000);

  setTimeout(async () => {
    try {
      const key = `${ctx.agentCodename}:${ctx.actionName}`;
      console.log(`[ActionExecutor] Outcome check for ${key}`, ctx.input);

      // For now, log that verification was attempted.
      // Future: implement per-action outcome checkers.
      await db.insert(agentActionLog).values({
        agentCodename: ctx.agentCodename,
        actionType: "outcome_check",
        actionName: `verify:${ctx.actionName}`,
        input: ctx.input,
        output: { checked: true },
        reasoning: `Scheduled outcome verification for ${ctx.actionName}`,
        outcome: "success",
        durationMs: 0,
      });
    } catch (err) {
      console.error("[ActionExecutor] Outcome check failed:", err);
    }
  }, cappedDelay);
}

/**
 * Check if an executor exists for a given agent+action pair.
 */
export function hasExecutor(agentCodename: string, actionName: string): boolean {
  return executors.has(`${agentCodename}:${actionName}`);
}

/**
 * Get all registered executor keys for debugging/admin.
 */
export function listExecutors(): string[] {
  return Array.from(executors.keys());
}

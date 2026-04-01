/**
 * Outcome Verifiers — Sovereign Company Protocol v4
 *
 * Real outcome verification for agent actions. Instead of setTimeout
 * logging { checked: true }, each action type has a verifier that
 * checks actual database state to determine if the action helped.
 *
 * Feeds verified outcomes back into trust evolution so agents earn
 * trust from REAL results, not just approvals.
 */

import { db } from "../db";
import {
  organizations, supportTickets, supportTicketMessages, jobHealthLogs,
  churnRiskScores, campaigns, agentActionLog, outcomeVerificationQueue,
} from "@shared/schema";
import { eq, and, gte, count, desc } from "drizzle-orm";
import { logger } from "../utils/logger";

// Types
interface VerificationResult {
  success: boolean;
  detail: string;
  metrics?: Record<string, any>;
}

type VerifierFn = (input: Record<string, any>, actionLogId: number) => Promise<VerificationResult>;

// Registry
const verifiers = new Map<string, VerifierFn>();

function registerVerifier(agentCodename: string, actionName: string, fn: VerifierFn) {
  verifiers.set(`${agentCodename}:${actionName}`, fn);
}

// --- Sophie CSM Verifiers ---

// Check if org logged in after retention email
registerVerifier("sophie_csm", "send_retention_email", async (input) => {
  const { orgId } = input;
  if (!orgId) return { success: false, detail: "No orgId to verify" };

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });
  if (!org) return { success: false, detail: "Organization not found" };

  // Check if they logged in since the email was sent (within last 24h)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const loggedInRecently = org.lastLoginAt && new Date(org.lastLoginAt) > oneDayAgo;

  return {
    success: !!loggedInRecently,
    detail: loggedInRecently
      ? `${org.name} logged in after retention email — email likely helped`
      : `${org.name} has not logged in since retention email was sent`,
    metrics: { orgId, orgName: org.name, loggedIn: !!loggedInRecently },
  };
});

// Check if customer replied to stale ticket follow-up
registerVerifier("sophie_csm", "resolve_stale_ticket", async (input) => {
  const { ticketId } = input;
  if (!ticketId) return { success: false, detail: "No ticketId to verify" };

  // Count messages added since the follow-up
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const recentMessages = await db.select({ c: count() })
    .from(supportTicketMessages)
    .where(and(
      eq(supportTicketMessages.ticketId, ticketId),
      gte(supportTicketMessages.createdAt, twoDaysAgo),
    ));

  const messageCount = Number(recentMessages[0]?.c || 0);
  // More than 1 message means customer replied (1 = our follow-up only)
  const customerReplied = messageCount > 1;

  return {
    success: customerReplied,
    detail: customerReplied
      ? `Customer replied to ticket #${ticketId} — follow-up worked`
      : `No reply on ticket #${ticketId} after follow-up`,
    metrics: { ticketId, messageCount, customerReplied },
  };
});

// --- Sentinel DevOps Verifiers ---

// Check if restarted job succeeded
registerVerifier("sentinel_devops", "restart_failed_job", async (input) => {
  const { jobName } = input;
  if (!jobName) return { success: false, detail: "No jobName to verify" };

  const latestLog = await db.select()
    .from(jobHealthLogs)
    .where(eq(jobHealthLogs.jobName, jobName))
    .orderBy(desc(jobHealthLogs.lastRun))
    .limit(1);

  const log = latestLog[0];
  if (!log) return { success: false, detail: `No health log for job "${jobName}"` };

  const succeeded = log.status === "success" || log.status === "healthy";

  return {
    success: succeeded,
    detail: succeeded
      ? `Job "${jobName}" is now running successfully after restart`
      : `Job "${jobName}" is still in ${log.status} state after restart`,
    metrics: { jobName, currentStatus: log.status },
  };
});

// --- Forge Revenue Verifiers ---

// Check if churn rescue email helped (risk score decreased or org logged in)
registerVerifier("forge_revenue", "send_churn_rescue", async (input) => {
  const { orgId, riskScore: originalRisk } = input;
  if (!orgId) return { success: false, detail: "No orgId to verify" };

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });
  if (!org) return { success: false, detail: "Organization not found" };

  // Check if risk score decreased
  const latestRisk = await db.select()
    .from(churnRiskScores)
    .where(eq(churnRiskScores.orgId, orgId))
    .orderBy(desc(churnRiskScores.calculatedAt))
    .limit(1);

  const currentRisk = latestRisk[0]?.riskScore || originalRisk;
  const riskDecreased = Number(currentRisk) < Number(originalRisk);

  // Also check login activity
  const threeDaysAgo = new Date(Date.now() - 72 * 60 * 60 * 1000);
  const loggedIn = org.lastLoginAt && new Date(org.lastLoginAt) > threeDaysAgo;

  const success = riskDecreased || !!loggedIn;

  return {
    success,
    detail: success
      ? `Churn rescue for ${org.name} showing positive signs${riskDecreased ? ` (risk: ${originalRisk} → ${currentRisk})` : ""}${loggedIn ? " — they logged in" : ""}`
      : `No improvement for ${org.name} after churn rescue (risk still ${currentRisk})`,
    metrics: { orgId, orgName: org.name, originalRisk, currentRisk: Number(currentRisk), loggedIn: !!loggedIn },
  };
});

// --- Beacon Marketing Verifiers ---

// Campaign pause doesn't need verification (it's a state change, not an outcome)
// But we register one for completeness
registerVerifier("beacon_marketing", "pause_campaign", async (input) => {
  const { campaignId } = input;
  if (!campaignId) return { success: true, detail: "No campaignId — action was advisory" };

  const campaign = await db.query.campaigns.findFirst({
    where: eq(campaigns.id, campaignId),
  });

  return {
    success: campaign?.status === "paused",
    detail: campaign?.status === "paused"
      ? `Campaign "${campaign.name}" confirmed paused`
      : `Campaign status is "${campaign?.status}" — expected "paused"`,
    metrics: { campaignId, currentStatus: campaign?.status },
  };
});

// --- Queue Management ---

/**
 * Schedule an outcome verification check. Inserts into the persistent queue
 * instead of using setTimeout (which is lost on restart).
 */
export async function scheduleVerification(
  actionLogId: number,
  agentCodename: string,
  actionName: string,
  input: Record<string, any>,
  delayMs: number
): Promise<void> {
  const scheduledFor = new Date(Date.now() + delayMs);

  try {
    await db.insert(outcomeVerificationQueue).values({
      actionLogId,
      agentCodename,
      actionName,
      input,
      scheduledFor,
      status: "pending",
    });
  } catch (err) {
    logger.error("[OutcomeVerifier] Failed to schedule verification", err);
  }
}

/**
 * Process pending verifications. Called by a background job every 15 minutes.
 * Checks if scheduled time has passed, runs the verifier, updates results.
 */
export async function processVerificationQueue(): Promise<{
  processed: number;
  verified: number;
  failed: number;
}> {
  const now = new Date();
  let processed = 0, verified = 0, failed = 0;

  // Get pending verifications that are due
  const pending = await db.select()
    .from(outcomeVerificationQueue)
    .where(and(
      eq(outcomeVerificationQueue.status, "pending"),
      gte(now, outcomeVerificationQueue.scheduledFor),
    ))
    .limit(50);

  for (const item of pending) {
    processed++;
    const key = `${item.agentCodename}:${item.actionName}`;
    const verifier = verifiers.get(key);

    if (!verifier) {
      // No verifier registered — mark as checked (no verification possible)
      await db.update(outcomeVerificationQueue)
        .set({ status: "checked", verifiedAt: now, verificationResult: { success: true, detail: "No verifier registered — assumed OK" } })
        .where(eq(outcomeVerificationQueue.id, item.id));
      continue;
    }

    try {
      const result = await verifier(item.input as Record<string, any>, item.actionLogId || 0);

      await db.update(outcomeVerificationQueue)
        .set({
          status: result.success ? "verified" : "failed",
          verifiedAt: now,
          verificationResult: result,
        })
        .where(eq(outcomeVerificationQueue.id, item.id));

      // Update the original action log with verification results
      if (item.actionLogId) {
        await db.update(agentActionLog)
          .set({
            output: {
              verified: true,
              verificationResult: result,
              verifiedAt: now.toISOString(),
            },
          })
          .where(eq(agentActionLog.id, item.actionLogId));
      }

      if (result.success) verified++;
      else failed++;

    } catch (err: any) {
      await db.update(outcomeVerificationQueue)
        .set({
          status: "failed",
          verifiedAt: now,
          verificationResult: { success: false, detail: `Verifier error: ${err.message}` },
        })
        .where(eq(outcomeVerificationQueue.id, item.id));
      failed++;
    }
  }

  if (processed > 0) {
    logger.info(`[OutcomeVerifier] Processed ${processed}: ${verified} verified, ${failed} failed`);
  }

  return { processed, verified, failed };
}

/**
 * Check if a verifier exists for a given action.
 */
export function hasVerifier(agentCodename: string, actionName: string): boolean {
  return verifiers.has(`${agentCodename}:${actionName}`);
}

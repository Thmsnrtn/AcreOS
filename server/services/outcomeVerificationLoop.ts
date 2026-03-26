// @ts-nocheck
/**
 * Outcome Verification Loop
 *
 * Closes the gap where decisions are made but never verified.
 * Runs daily to check if autonomous decisions actually helped:
 *
 * 1. Query recent autonomous actions (last 7 days)
 * 2. For each action, check if the expected outcome materialized
 * 3. Score: positive (helped), negative (hurt), neutral (no effect)
 * 4. Feed scores into trust evolution
 * 5. Update autonomy score with QUALITY metric
 */

import { db } from "../db";
import { agentEvents, leads, deals, tasks } from "@shared/schema";
import { eq, and, sql, desc, gte, inArray } from "drizzle-orm";

interface VerificationResult {
  agentCodename: string;
  action: string;
  outcome: "positive" | "negative" | "neutral" | "pending";
  reason: string;
  createdAt: Date;
}

class OutcomeVerificationLoop {
  /**
   * Verify outcomes of recent autonomous actions.
   */
  async verify(orgId: number): Promise<{
    verified: number;
    positive: number;
    negative: number;
    neutral: number;
    qualityScore: number;
  }> {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const results: VerificationResult[] = [];

    // Get recent auto-executed actions
    const actions = await db.select()
      .from(agentEvents)
      .where(and(
        gte(agentEvents.createdAt, weekAgo),
        inArray(agentEvents.eventType, [
          "action_succeeded", "initiative_auto_executed",
        ]),
      ))
      .orderBy(desc(agentEvents.createdAt))
      .limit(100);

    for (const action of actions) {
      const payload = action.payload as Record<string, any>;
      const actionType = payload?.action;

      try {
        let result: VerificationResult | null = null;

        switch (actionType) {
          case "send_follow_up": {
            result = await this.verifyFollowUp(action, payload, orgId);
            break;
          }
          case "update_lead_status": {
            result = await this.verifyLeadStatusChange(action, payload, orgId);
            break;
          }
          case "flag_deal_risk": {
            result = await this.verifyDealRiskFlag(action, payload, orgId);
            break;
          }
          case "restart_failed_job": {
            result = await this.verifyJobRestart(action, payload);
            break;
          }
          default: {
            // For unknown action types, check if the action log recorded success/failure
            try {
              const { agentActionLog } = await import("@shared/schema");
              const [logEntry] = await db.select()
                .from(agentActionLog)
                .where(and(
                  eq(agentActionLog.agentCodename, action.agentCodename),
                  eq(agentActionLog.actionName, actionType ?? ""),
                  sql`${agentActionLog.createdAt} >= ${action.createdAt}`,
                ))
                .orderBy(desc(agentActionLog.createdAt))
                .limit(1);

              if (logEntry) {
                const actionOutcome = logEntry.outcome === "success" ? "positive" : "negative";
                result = {
                  agentCodename: action.agentCodename,
                  action: actionType ?? "unknown",
                  outcome: actionOutcome,
                  reason: `Verified via action log: ${logEntry.outcome}`,
                  createdAt: action.createdAt,
                };
              } else {
                result = {
                  agentCodename: action.agentCodename,
                  action: actionType ?? "unknown",
                  outcome: "neutral",
                  reason: `No action log entry found for ${actionType} — cannot verify outcome`,
                  createdAt: action.createdAt,
                };
              }
            } catch {
              result = {
                agentCodename: action.agentCodename,
                action: actionType ?? "unknown",
                outcome: "neutral",
                reason: "Verification query failed for this action type",
                createdAt: action.createdAt,
              };
            }
          }
        }

        if (result) results.push(result);
      } catch {}
    }

    // Count outcomes
    const positive = results.filter((r) => r.outcome === "positive").length;
    const negative = results.filter((r) => r.outcome === "negative").length;
    const neutral = results.filter((r) => r.outcome === "neutral").length;
    const verified = results.length;

    // Quality score: (positive - negative) / total * 100
    const qualityScore = verified > 0
      ? Math.round(((positive - negative) / verified) * 100 + 50) // 0-100 centered at 50
      : 50;

    // Record verification results for trust evolution to query
    for (const result of results) {
      try {
        await db.insert(agentEvents).values({
          agentCodename: result.agentCodename,
          eventType: "outcome_verified",
          payload: {
            action: result.action,
            outcome: result.outcome,
            reason: result.reason,
            orgId,
          },
        });
      } catch {}
    }

    console.log(
      `[outcome-verification] Verified ${verified} actions: ${positive} positive, ${negative} negative, ${neutral} neutral. Quality score: ${qualityScore}`,
    );

    return { verified, positive, negative, neutral, qualityScore };
  }

  // ── Verification Methods ───────────────────────────────────────────────

  private async verifyFollowUp(action: any, payload: any, orgId: number): Promise<VerificationResult> {
    const leadId = payload?.actionInput?.leadId ?? payload?.leadId;
    if (!leadId) return { agentCodename: action.agentCodename, action: "send_follow_up", outcome: "neutral", reason: "No leadId to verify", createdAt: action.createdAt };

    try {
      const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
      if (lead) {
        // Positive if lead status progressed or was contacted
        const positiveStatuses = ["contacted", "qualified", "offer_sent", "under_contract"];
        if (positiveStatuses.includes(lead.status)) {
          return { agentCodename: action.agentCodename, action: "send_follow_up", outcome: "positive", reason: `Lead progressed to "${lead.status}" after follow-up`, createdAt: action.createdAt };
        }
        if (lead.status === "dead" || lead.status === "unsubscribed") {
          return { agentCodename: action.agentCodename, action: "send_follow_up", outcome: "negative", reason: `Lead went to "${lead.status}" after follow-up`, createdAt: action.createdAt };
        }
      }
    } catch {}

    return { agentCodename: action.agentCodename, action: "send_follow_up", outcome: "neutral", reason: "Lead status unchanged", createdAt: action.createdAt };
  }

  private async verifyLeadStatusChange(action: any, payload: any, orgId: number): Promise<VerificationResult> {
    // If lead was moved to a specific status, check if a deal was created
    const leadId = payload?.actionInput?.leadId ?? payload?.leadId;
    if (!leadId) return { agentCodename: action.agentCodename, action: "update_lead_status", outcome: "neutral", reason: "No leadId", createdAt: action.createdAt };

    try {
      const dealCount = await db.select({ count: sql<number>`count(*)::int` })
        .from(deals)
        .where(and(eq(deals.leadId, leadId), gte(deals.createdAt, action.createdAt)));

      if (dealCount[0]?.count > 0) {
        return { agentCodename: action.agentCodename, action: "update_lead_status", outcome: "positive", reason: "Deal created after status change", createdAt: action.createdAt };
      }
    } catch {}

    return { agentCodename: action.agentCodename, action: "update_lead_status", outcome: "neutral", reason: "No downstream deal yet", createdAt: action.createdAt };
  }

  private async verifyDealRiskFlag(action: any, payload: any, orgId: number): Promise<VerificationResult> {
    const dealId = payload?.actionInput?.dealId ?? payload?.dealId;
    if (!dealId) return { agentCodename: action.agentCodename, action: "flag_deal_risk", outcome: "neutral", reason: "No dealId", createdAt: action.createdAt };

    try {
      const [deal] = await db.select().from(deals).where(eq(deals.id, dealId)).limit(1);
      if (deal) {
        if (deal.status === "closed_won") {
          return { agentCodename: action.agentCodename, action: "flag_deal_risk", outcome: "negative", reason: "Deal closed won — risk flag was premature", createdAt: action.createdAt };
        }
        if (deal.status === "closed_lost" || deal.status === "cancelled") {
          return { agentCodename: action.agentCodename, action: "flag_deal_risk", outcome: "positive", reason: "Deal lost/cancelled — risk flag was accurate", createdAt: action.createdAt };
        }
      }
    } catch {}

    return { agentCodename: action.agentCodename, action: "flag_deal_risk", outcome: "neutral", reason: "Deal still active", createdAt: action.createdAt };
  }

  private async verifyJobRestart(action: any, payload: any): Promise<VerificationResult> {
    const jobName = payload?.actionInput?.jobName ?? payload?.jobName;
    if (!jobName) return { agentCodename: action.agentCodename, action: "restart_failed_job", outcome: "neutral", reason: "No jobName", createdAt: action.createdAt };

    try {
      const { jobHealthLogs } = await import("@shared/schema");
      // Check if job succeeded after restart
      const successAfter = await db.select({ count: sql<number>`count(*)::int` })
        .from(jobHealthLogs)
        .where(and(
          eq(jobHealthLogs.jobName, jobName),
          eq(jobHealthLogs.status, "success"),
          gte(jobHealthLogs.createdAt, action.createdAt),
        ));

      if (successAfter[0]?.count > 0) {
        return { agentCodename: action.agentCodename, action: "restart_failed_job", outcome: "positive", reason: "Job succeeded after restart", createdAt: action.createdAt };
      }

      // Check if job failed again
      const failAfter = await db.select({ count: sql<number>`count(*)::int` })
        .from(jobHealthLogs)
        .where(and(
          eq(jobHealthLogs.jobName, jobName),
          eq(jobHealthLogs.status, "failed"),
          gte(jobHealthLogs.createdAt, action.createdAt),
        ));

      if (failAfter[0]?.count > 0) {
        return { agentCodename: action.agentCodename, action: "restart_failed_job", outcome: "negative", reason: "Job failed again after restart", createdAt: action.createdAt };
      }
    } catch {}

    return { agentCodename: action.agentCodename, action: "restart_failed_job", outcome: "neutral", reason: "No subsequent job run data", createdAt: action.createdAt };
  }
}

export const outcomeVerificationLoop = new OutcomeVerificationLoop();

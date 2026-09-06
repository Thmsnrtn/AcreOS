/**
 * Agent Initiative Engine
 *
 * Closes the gap where agents are passive — can only respond, never propose.
 * This engine allows agents to:
 * 1. Scan business data for opportunities/problems
 * 2. Generate proposals (not just execute pre-defined actions)
 * 3. Submit proposals to the founder queue OR auto-execute if trust allows
 * 4. Learn from proposal acceptance/rejection
 *
 * Runs as a background job every 30 minutes.
 */

import { db } from "../db";
import {
  leads, deals, tasks, agentEvents, decisionsInboxItems,
} from "@shared/schema";
import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { wsServer } from "../websocket";
import { trustAuthorityEscalation } from "./trustAuthorityEscalation";
import { logger } from "../utils/logger";

import { ACTIVE_DEAL_STATUSES } from "@shared/lifecycle/pipeline-status";
// ─── Types ───────────────────────────────────────────────────────────────────

interface Proposal {
  agentCodename: string;
  type: "opportunity" | "risk" | "optimization" | "automation";
  title: string;
  description: string;
  action: string;
  actionInput: Record<string, any>;
  confidence: number;
  reasoning: string;
  estimatedImpact: string;
}

// ─── Initiative Scanners ─────────────────────────────────────────────────────

type Scanner = (orgId: number) => Promise<Proposal[]>;

const scanners: Record<string, Scanner> = {
  /**
   * Sophie: Find stale leads that need follow-up
   */
  stale_lead_scanner: async (orgId) => {
    const proposals: Proposal[] = [];
    try {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const staleLeads = await db.select({ id: leads.id, firstName: leads.firstName, lastName: leads.lastName })
        .from(leads)
        .where(and(
          eq(leads.organizationId, orgId),
          eq(leads.status, "new"),
          lt(leads.createdAt, weekAgo),
        ))
        .limit(10);

      for (const lead of staleLeads) {
        proposals.push({
          agentCodename: "sophie",
          type: "opportunity",
          title: `Follow up with stale lead: ${lead.firstName ?? ""} ${lead.lastName ?? ""}`,
          description: `Lead ${lead.id} has been in "new" status for 7+ days without contact.`,
          action: "send_follow_up",
          actionInput: { leadId: lead.id, channel: "email" },
          confidence: 0.85,
          reasoning: "Leads contacted within first week have 60% higher conversion rate.",
          estimatedImpact: "Potential deal recovery",
        });
      }
    } catch {}
    return proposals;
  },

  /**
   * Forge: Find deals at risk of going cold
   */
  deal_risk_scanner: async (orgId) => {
    const proposals: Proposal[] = [];
    try {
      const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      const staleDeals = await db.select({ id: deals.id, status: deals.status })
        .from(deals)
        .where(and(
          eq(deals.organizationId, orgId),
          // WAS `NOT IN ('closed_won','closed_lost','cancelled')`. Neither
          // closed_* value is a deal status, so the filter excluded only
          // `cancelled` and this scanner proposed "deal going cold" on deals
          // that had CLOSED a fortnight earlier. Stated positively and
          // derived, so a new status joins the pipeline automatically.
          inArray(deals.status, ACTIVE_DEAL_STATUSES),
          lt(deals.updatedAt, twoWeeksAgo),
        ))
        .limit(5);

      for (const deal of staleDeals) {
        proposals.push({
          agentCodename: "forge",
          type: "risk",
          title: `Deal ${deal.id} going cold — no activity for 14+ days`,
          description: `Deal in "${deal.status}" stage hasn't been updated in over 2 weeks.`,
          action: "flag_deal_risk",
          actionInput: { dealId: deal.id, riskLevel: "high", reason: "Stale for 14+ days" },
          confidence: 0.8,
          reasoning: "Deals inactive for 14+ days have 70% chance of going cold.",
          estimatedImpact: "Risk mitigation",
        });
      }
    } catch {}
    return proposals;
  },

  /**
   * Sentinel: Find recurring job failures
   */
  job_failure_scanner: async () => {
    const proposals: Proposal[] = [];
    try {
      const { jobHealthLogs } = await import("@shared/schema");
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const failures = await db
        .select({
          jobName: jobHealthLogs.jobName,
          count: sql<number>`count(*)::int`,
        })
        .from(jobHealthLogs)
        .where(and(
          eq(jobHealthLogs.status, "failed"),
          gte(jobHealthLogs.createdAt, dayAgo),
        ))
        .groupBy(jobHealthLogs.jobName)
        .having(sql`count(*) >= 3`);

      for (const failure of failures) {
        proposals.push({
          agentCodename: "sentinel",
          type: "risk",
          title: `Job "${failure.jobName}" failed ${failure.count} times in 24h`,
          description: `Recurring failure indicates a systemic issue that needs investigation.`,
          action: "restart_failed_job",
          actionInput: { jobName: failure.jobName },
          confidence: 0.9,
          reasoning: "3+ failures in 24h indicates a persistent issue rather than transient error.",
          estimatedImpact: "System reliability",
        });
      }
    } catch {}
    return proposals;
  },

  /**
   * Oracle: Find incomplete tasks past due
   */
  overdue_task_scanner: async (orgId) => {
    const proposals: Proposal[] = [];
    try {
      const now = new Date();
      const overdueTasks = await db.select({ id: tasks.id, title: tasks.title })
        .from(tasks)
        .where(and(
          eq(tasks.organizationId, orgId),
          eq(tasks.status, "pending"),
          lt(tasks.dueDate, now),
        ))
        .limit(5);

      if (overdueTasks.length >= 3) {
        proposals.push({
          agentCodename: "oracle",
          type: "optimization",
          title: `${overdueTasks.length} overdue tasks need attention`,
          description: `Multiple tasks past their due dates may indicate workflow bottleneck.`,
          action: "send_alert",
          actionInput: { severity: "warning", title: "Overdue Task Alert", message: `${overdueTasks.length} tasks are past due` },
          confidence: 0.95,
          reasoning: "Overdue task accumulation degrades operational efficiency.",
          estimatedImpact: "Operational efficiency",
        });
      }
    } catch {}
    return proposals;
  },
};

// ─── Initiative Engine ───────────────────────────────────────────────────────

class AgentInitiativeEngine {
  /**
   * Run all scanners and collect proposals.
   * Auto-execute proposals where agent trust allows; escalate the rest.
   */
  async runInitiativeCycle(orgId: number): Promise<{
    proposals: number;
    autoExecuted: number;
    escalated: number;
  }> {
    let totalProposals = 0;
    let autoExecuted = 0;
    let escalated = 0;

    for (const [scannerName, scanner] of Object.entries(scanners)) {
      try {
        const proposals = await scanner(orgId);
        totalProposals += proposals.length;

        for (const proposal of proposals) {
          // Get agent trust score
          let trustScore = 50;
          try {
            const { companyAgentService } = await import("./companyAgents");
            // Effective, not stored — see companyAgentService.effectiveTrustScore.
            trustScore = await companyAgentService.effectiveTrustScore(proposal.agentCodename);
          } catch {}

          // Check if agent can auto-execute this action
          const allowed = trustAuthorityEscalation.isActionAllowed(trustScore, proposal.action);

          if (allowed && proposal.confidence >= 0.75) {
            // Auto-execute
            try {
              const { executionEngine } = await import("./executionEngine");
              await executionEngine.execute({
                orgId,
                agentCodename: proposal.agentCodename,
                action: proposal.action,
                input: proposal.actionInput,
              });
              autoExecuted++;

              // Record the auto-executed proposal. agent_events requires
              // organizationId + eventSource (notNull); agentCodename is
              // not a column — fold it into the payload. The prior shape
              // caused "null value in column 'organization_id'" 500s
              // every initiative-engine cycle.
              await db.insert(agentEvents).values({
                organizationId: orgId,
                eventType: "initiative_auto_executed",
                eventSource: "agent",
                payload: {
                  agentCodename: proposal.agentCodename,
                  title: proposal.title,
                  action: proposal.action,
                  confidence: proposal.confidence,
                  reasoning: proposal.reasoning,
                  estimatedImpact: proposal.estimatedImpact,
                },
              });
            } catch {}
          } else {
            // Escalate to founder
            escalated++;
            await db.insert(agentEvents).values({
              organizationId: orgId,
              eventType: "initiative_proposal",
              eventSource: "agent",
              payload: {
                agentCodename: proposal.agentCodename,
                type: proposal.type,
                title: proposal.title,
                description: proposal.description,
                action: proposal.action,
                actionInput: proposal.actionInput,
                confidence: proposal.confidence,
                reasoning: proposal.reasoning,
                estimatedImpact: proposal.estimatedImpact,
                trustScore,
                autoExecuteBlocked: !allowed ? "insufficient_trust" : "low_confidence",
              },
            });

            // Mirror into decisionsInboxItems so the founder agent-queue UI
            // shows initiative-engine proposals next to codebase-monitor
            // proposals. agentEvents stays as the firehose; this row is
            // the actionable queue entry.
            try {
              await db.insert(decisionsInboxItems).values({
                itemType: "agent_initiative",
                riskLevel: proposal.type === "risk" ? "high" : "medium",
                urgencyScore: Math.round(proposal.confidence * 100),
                sophieAnalysis: proposal.description,
                sophieConfidenceScore: Math.round(proposal.confidence * 100),
                recommendedAction: proposal.action,
                recommendedActionLabel: proposal.title,
                actionPayload: {
                  action: proposal.action,
                  actionInput: proposal.actionInput,
                  proposalType: proposal.type,
                  estimatedImpact: proposal.estimatedImpact,
                },
                organizationId: orgId,
                ownerAgentCodename: proposal.agentCodename,
                status: "pending",
                contextBundle: {
                  reasoning: proposal.reasoning,
                  estimatedImpact: proposal.estimatedImpact,
                  trustScore,
                  autoExecuteBlocked: !allowed ? "insufficient_trust" : "low_confidence",
                },
              });
            } catch (inboxErr) {
              // Inbox mirror is advisory — never let it block the agentEvents
              // write or the founder broadcast.
              logger.warn("[initiative] inbox mirror failed", {
                source: "initiative",
                metadata: {
                  agent: proposal.agentCodename,
                  error: inboxErr instanceof Error ? inboxErr.message : String(inboxErr),
                },
              });
            }

            // Notify founder
            wsServer.broadcastFounderEvent("agent_proposal", {
              agent: proposal.agentCodename,
              type: proposal.type,
              title: proposal.title,
              confidence: proposal.confidence,
              reasoning: proposal.reasoning,
            });
          }
        }
      } catch (err: any) {
        logger.error(`[initiative] Scanner ${scannerName} failed`, err);
      }
    }

    if (totalProposals > 0) {
      logger.info(`[initiative] Cycle complete: ${totalProposals} proposals, ${autoExecuted} auto-executed, ${escalated} escalated`);
    }

    return { proposals: totalProposals, autoExecuted, escalated };
  }
}

export const agentInitiativeEngine = new AgentInitiativeEngine();

/**
 * Graduated Financial Authority Gate — Sovereign Company Protocol
 *
 * Replaces the flat $500 cap in autonomousDecisionExecutor.ts with a
 * tiered multi-agent consensus spending authority. Each tier demands
 * progressively stricter trust scores, more approvers, and longer
 * cooling periods before funds are released.
 *
 * Tier 1:  $0 – $500        Single agent, trust >= 70
 * Tier 2:  $500 – $2,500    Owner agent + Ledger consensus, trust >= 80
 * Tier 3:  $2,500 – $10K    Owner + Ledger + Shield, trust >= 85, 4hr cooling
 * Tier 4:  $10K – $50K      5+ agent quorum, trust >= 90, 24hr cooling, Founder Twin
 * Tier 5:  $50K+            Founder approval required (hard stop)
 */

import { db } from "../db";
import {
  financialApprovals,
  agentBudgetEnvelopes,
  spendAnomalies,
  companyAgents,
} from "@shared/schema";
import { eq, and, sql, desc, avg } from "drizzle-orm";
import crypto from "crypto";

// ─── Tier Definitions ────────────────────────────────────────────────────────

interface SpendingTier {
  tier: number;
  minCents: number;
  maxCents: number;
  minTrust: number;
  requiredApprovers: number;
  approverRoles: string[];
  coolingPeriodHours: number;
  founderTwinRequired: boolean;
  founderApprovalRequired: boolean;
}

const SPENDING_TIERS: SpendingTier[] = [
  {
    tier: 1,
    minCents: 0,
    maxCents: 50_000,          // $500
    minTrust: 70,
    requiredApprovers: 1,
    approverRoles: ["self"],
    coolingPeriodHours: 0,
    founderTwinRequired: false,
    founderApprovalRequired: false,
  },
  {
    tier: 2,
    minCents: 50_000,
    maxCents: 250_000,         // $2,500
    minTrust: 80,
    requiredApprovers: 2,
    approverRoles: ["owner", "ledger"],
    coolingPeriodHours: 0,
    founderTwinRequired: false,
    founderApprovalRequired: false,
  },
  {
    tier: 3,
    minCents: 250_000,
    maxCents: 1_000_000,       // $10,000
    minTrust: 85,
    requiredApprovers: 3,
    approverRoles: ["owner", "ledger", "shield"],
    coolingPeriodHours: 4,
    founderTwinRequired: false,
    founderApprovalRequired: false,
  },
  {
    tier: 4,
    minCents: 1_000_000,
    maxCents: 5_000_000,       // $50,000
    minTrust: 90,
    requiredApprovers: 5,
    approverRoles: ["owner", "ledger", "shield", "quorum", "founder_twin"],
    coolingPeriodHours: 24,
    founderTwinRequired: true,
    founderApprovalRequired: false,
  },
  {
    tier: 5,
    minCents: 5_000_000,
    maxCents: Infinity,
    minTrust: 90,
    requiredApprovers: 1,
    approverRoles: ["founder"],
    coolingPeriodHours: 0,
    founderTwinRequired: false,
    founderApprovalRequired: true,
  },
];

// ─── Default Monthly Budgets (in cents) ──────────────────────────────────────

const DEFAULT_MONTHLY_BUDGETS: Record<string, number> = {
  beacon: 500_000,     // $5,000
  forge: 300_000,      // $3,000
  sophie: 200_000,     // $2,000
  atlas: 100_000,      // $1,000
};

const DEFAULT_BUDGET_CENTS = 50_000; // $500 for any agent not explicitly listed

// ─── Service ─────────────────────────────────────────────────────────────────

class FinancialAuthorityGateService {

  /**
   * Determine which spending tier an amount falls into.
   */
  private getTier(amountCents: number): SpendingTier {
    const tier = SPENDING_TIERS.find(
      (t) => amountCents >= t.minCents && amountCents < t.maxCents,
    );
    if (!tier) {
      // Fallback: anything beyond all tiers requires founder approval
      return SPENDING_TIERS[SPENDING_TIERS.length - 1];
    }
    return tier;
  }

  /**
   * Fetch an agent row by codename, returning null if not found.
   */
  private async getAgent(codename: string) {
    const [agent] = await db
      .select()
      .from(companyAgents)
      .where(eq(companyAgents.codename, codename))
      .limit(1);
    return agent ?? null;
  }

  /**
   * Request a spend. Determines the tier, validates trust scores,
   * creates an approval record, and auto-approves tier-1 if eligible.
   */
  async requestSpend(
    agentCodename: string,
    amountCents: number,
    purpose: string,
    category: string,
  ): Promise<{
    requestId: string;
    tier: number;
    status: string;
    message: string;
    coolingPeriodEnds?: Date;
  }> {
    const tier = this.getTier(amountCents);

    // ── Hard stop: Tier 5 requires founder approval ──
    if (tier.founderApprovalRequired) {
      const requestId = crypto.randomUUID();
      await db.insert(financialApprovals).values({
        requestId,
        requestedBy: agentCodename,
        amount: amountCents,
        tier: tier.tier,
        purpose,
        category,
        approvers: [],
        approvalStatus: {},
        requiredApprovers: 1,
        status: "awaiting_founder",
        reasoning: `Tier 5 hard stop — amount $${(amountCents / 100).toLocaleString()} requires founder approval.`,
      });

      return {
        requestId,
        tier: tier.tier,
        status: "awaiting_founder",
        message: `Spend of $${(amountCents / 100).toLocaleString()} exceeds $50K threshold. Founder approval required.`,
      };
    }

    // ── Validate requesting agent trust ──
    const requestingAgent = await this.getAgent(agentCodename);
    if (!requestingAgent) {
      throw new Error(`Agent "${agentCodename}" not found in company_agents.`);
    }
    if (requestingAgent.trustScore < tier.minTrust) {
      throw new Error(
        `Agent "${agentCodename}" trust score ${requestingAgent.trustScore} is below the required ${tier.minTrust} for tier ${tier.tier} spending.`,
      );
    }

    // ── Anomaly detection ──
    const anomaly = await this.detectAnomaly(agentCodename, amountCents);
    if (anomaly.isAnomaly) {
      // Log the anomaly and escalate the tier
      await db.insert(spendAnomalies).values({
        agentCodename,
        amountCents,
        expectedCents: anomaly.expectedCents,
        deviationSigma: anomaly.sigma,
        peerReviewStatus: "pending",
        reviewingAgents: [],
      });
    }

    // ── Build the approval record ──
    const requestId = crypto.randomUUID();
    const coolingPeriodEnds =
      tier.coolingPeriodHours > 0
        ? new Date(Date.now() + tier.coolingPeriodHours * 60 * 60 * 1000)
        : null;

    // Determine which specific agent codenames need to approve
    const requiredApproverCodenames = await this.resolveApprovers(
      tier,
      agentCodename,
    );

    await db.insert(financialApprovals).values({
      requestId,
      requestedBy: agentCodename,
      amount: amountCents,
      tier: tier.tier,
      purpose,
      category,
      approvers: requiredApproverCodenames,
      approvalStatus: {},
      requiredApprovers: tier.requiredApprovers,
      coolingPeriodEnds,
      status: "pending",
      reasoning: null,
    });

    // ── Tier 1 auto-approval: single agent, no consensus needed ──
    if (tier.tier === 1) {
      await this.approveSpend(requestId, agentCodename, "Tier 1 auto-approval — within single-agent authority.");
      const result = await this.checkApprovalStatus(requestId);
      return {
        requestId,
        tier: tier.tier,
        status: result.status,
        message: `Tier 1 spend of $${(amountCents / 100).toFixed(2)} auto-approved for ${agentCodename}.`,
      };
    }

    return {
      requestId,
      tier: tier.tier,
      status: "pending",
      message: `Tier ${tier.tier} spend of $${(amountCents / 100).toLocaleString()} requires ${tier.requiredApprovers} approvals from: ${requiredApproverCodenames.join(", ")}.`,
      coolingPeriodEnds: coolingPeriodEnds ?? undefined,
    };
  }

  /**
   * Resolve the specific agent codenames required to approve a request
   * based on the tier's role requirements.
   */
  private async resolveApprovers(
    tier: SpendingTier,
    requestingAgent: string,
  ): Promise<string[]> {
    const approvers: string[] = [];

    for (const role of tier.approverRoles) {
      switch (role) {
        case "self":
        case "owner":
          approvers.push(requestingAgent);
          break;
        case "ledger": {
          // Find an agent with "ledger" or "cfo" in their codename
          const [ledger] = await db
            .select()
            .from(companyAgents)
            .where(
              and(
                sql`(${companyAgents.codename} ILIKE '%ledger%' OR ${companyAgents.codename} ILIKE '%cfo%' OR ${companyAgents.codename} ILIKE '%beacon%')`,
                eq(companyAgents.status, "active"),
              ),
            )
            .limit(1);
          if (ledger) approvers.push(ledger.codename);
          break;
        }
        case "shield": {
          // Find a security/compliance agent
          const [shield] = await db
            .select()
            .from(companyAgents)
            .where(
              and(
                sql`(${companyAgents.codename} ILIKE '%shield%' OR ${companyAgents.codename} ILIKE '%sentinel%' OR ${companyAgents.codename} ILIKE '%compliance%')`,
                eq(companyAgents.status, "active"),
              ),
            )
            .limit(1);
          if (shield) approvers.push(shield.codename);
          break;
        }
        case "quorum": {
          // Pull additional active agents with sufficient trust to fill the quorum
          const existing = new Set(approvers);
          const candidates = await db
            .select()
            .from(companyAgents)
            .where(
              and(
                eq(companyAgents.status, "active"),
                sql`${companyAgents.trustScore} >= ${tier.minTrust}`,
              ),
            )
            .orderBy(desc(companyAgents.trustScore))
            .limit(10);

          for (const c of candidates) {
            if (approvers.length >= tier.requiredApprovers) break;
            if (!existing.has(c.codename)) {
              approvers.push(c.codename);
              existing.add(c.codename);
            }
          }
          break;
        }
        case "founder_twin": {
          const [twin] = await db
            .select()
            .from(companyAgents)
            .where(
              and(
                sql`(${companyAgents.codename} ILIKE '%founder%' OR ${companyAgents.codename} ILIKE '%twin%' OR ${companyAgents.codename} ILIKE '%ceo%')`,
                eq(companyAgents.status, "active"),
              ),
            )
            .limit(1);
          if (twin) approvers.push(twin.codename);
          break;
        }
        // "founder" role for tier 5 is handled by the hard stop above
        default:
          break;
      }
    }

    // De-duplicate while preserving order
    return [...new Set(approvers)];
  }

  /**
   * Record an agent's approval vote on a pending spend request.
   */
  async approveSpend(
    requestId: string,
    approverCodename: string,
    reasoning: string,
  ): Promise<{ success: boolean; message: string }> {
    // Fetch the existing request
    const [request] = await db
      .select()
      .from(financialApprovals)
      .where(eq(financialApprovals.requestId, requestId))
      .limit(1);

    if (!request) {
      throw new Error(`Financial approval request "${requestId}" not found.`);
    }

    if (request.status !== "pending" && request.status !== "awaiting_founder") {
      return {
        success: false,
        message: `Request is already "${request.status}" — cannot approve.`,
      };
    }

    // Validate approver trust score against the tier
    const tier = SPENDING_TIERS.find((t) => t.tier === request.tier);
    if (tier) {
      const approverAgent = await this.getAgent(approverCodename);
      if (approverAgent && approverAgent.trustScore < tier.minTrust) {
        return {
          success: false,
          message: `Approver "${approverCodename}" trust score ${approverAgent.trustScore} is below the required ${tier.minTrust} for tier ${tier.tier}.`,
        };
      }
    }

    // Merge the new approval into the existing approval_status JSONB
    const updatedStatus = {
      ...(request.approvalStatus as Record<string, { approved: boolean; timestamp: string; reasoning: string }>),
      [approverCodename]: {
        approved: true,
        timestamp: new Date().toISOString(),
        reasoning,
      },
    };

    await db
      .update(financialApprovals)
      .set({
        approvalStatus: updatedStatus,
        updatedAt: new Date(),
      })
      .where(eq(financialApprovals.requestId, requestId));

    return {
      success: true,
      message: `Approval from "${approverCodename}" recorded for request ${requestId}.`,
    };
  }

  /**
   * Check whether a request has gathered all required approvals and
   * whether any cooling period has elapsed. If ready, mark as executed.
   */
  async checkApprovalStatus(
    requestId: string,
  ): Promise<{
    status: string;
    approvalsReceived: number;
    approvalsRequired: number;
    coolingComplete: boolean;
    readyToExecute: boolean;
  }> {
    const [request] = await db
      .select()
      .from(financialApprovals)
      .where(eq(financialApprovals.requestId, requestId))
      .limit(1);

    if (!request) {
      throw new Error(`Financial approval request "${requestId}" not found.`);
    }

    const approvalEntries = Object.values(
      (request.approvalStatus ?? {}) as Record<string, { approved: boolean; timestamp: string; reasoning: string }>,
    );
    const approvalsReceived = approvalEntries.filter((a) => a.approved).length;
    const approvalsRequired = request.requiredApprovers;

    const coolingComplete =
      !request.coolingPeriodEnds ||
      new Date() >= new Date(request.coolingPeriodEnds);

    const hasEnoughApprovals = approvalsReceived >= approvalsRequired;
    const readyToExecute =
      hasEnoughApprovals &&
      coolingComplete &&
      request.status === "pending";

    // If all conditions are met, transition to "approved" and record execution
    if (readyToExecute) {
      await db
        .update(financialApprovals)
        .set({
          status: "approved",
          executedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(financialApprovals.requestId, requestId));

      // Deduct from the requester's budget envelope
      await this.recordSpend(
        request.requestedBy,
        request.amount,
        request.category,
      );

      return {
        status: "approved",
        approvalsReceived,
        approvalsRequired,
        coolingComplete,
        readyToExecute: true,
      };
    }

    return {
      status: request.status,
      approvalsReceived,
      approvalsRequired,
      coolingComplete,
      readyToExecute: false,
    };
  }

  /**
   * Return the current budget envelope status for an agent.
   */
  async getAgentBudget(
    agentCodename: string,
    monthKey?: string,
  ): Promise<{
    agentCodename: string;
    monthKey: string;
    budgetCents: number;
    spentCents: number;
    remainingCents: number;
    utilizationPct: number;
  } | null> {
    const key = monthKey ?? this.getMonthKey();

    const [envelope] = await db
      .select()
      .from(agentBudgetEnvelopes)
      .where(
        and(
          eq(agentBudgetEnvelopes.agentCodename, agentCodename),
          eq(agentBudgetEnvelopes.monthKey, key),
        ),
      )
      .limit(1);

    if (!envelope) return null;

    const remainingCents = envelope.budgetCents - envelope.spentCents;
    const utilizationPct =
      envelope.budgetCents > 0
        ? Math.round((envelope.spentCents / envelope.budgetCents) * 10000) / 100
        : 0;

    return {
      agentCodename: envelope.agentCodename,
      monthKey: envelope.monthKey,
      budgetCents: envelope.budgetCents,
      spentCents: envelope.spentCents,
      remainingCents,
      utilizationPct,
    };
  }

  /**
   * Deduct a spend from an agent's monthly budget envelope.
   * Creates the envelope if it doesn't yet exist for this month.
   */
  async recordSpend(
    agentCodename: string,
    amountCents: number,
    category: string,
  ): Promise<void> {
    const monthKey = this.getMonthKey();

    // Ensure the envelope exists
    const existing = await this.getAgentBudget(agentCodename, monthKey);
    if (!existing) {
      const budgetCents =
        DEFAULT_MONTHLY_BUDGETS[agentCodename.toLowerCase()] ?? DEFAULT_BUDGET_CENTS;

      await db.insert(agentBudgetEnvelopes).values({
        agentCodename,
        monthKey,
        budgetCents,
        spentCents: 0,
        category: "general",
      });
    }

    // Atomically increment spent_cents
    await db
      .update(agentBudgetEnvelopes)
      .set({
        spentCents: sql`${agentBudgetEnvelopes.spentCents} + ${amountCents}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(agentBudgetEnvelopes.agentCodename, agentCodename),
          eq(agentBudgetEnvelopes.monthKey, monthKey),
        ),
      );
  }

  /**
   * Detect whether a proposed spend is anomalous relative to the agent's
   * historical spending pattern. An anomaly is flagged when the amount
   * deviates more than 2 standard deviations from the agent's average.
   */
  async detectAnomaly(
    agentCodename: string,
    amountCents: number,
  ): Promise<{
    isAnomaly: boolean;
    sigma: number;
    expectedCents: number;
    message: string;
  }> {
    // Pull historical approved spends for this agent
    const history = await db
      .select({
        amount: financialApprovals.amount,
      })
      .from(financialApprovals)
      .where(
        and(
          eq(financialApprovals.requestedBy, agentCodename),
          eq(financialApprovals.status, "approved"),
        ),
      )
      .orderBy(desc(financialApprovals.createdAt))
      .limit(50);

    // Not enough data to establish a baseline
    if (history.length < 3) {
      return {
        isAnomaly: false,
        sigma: 0,
        expectedCents: amountCents,
        message: "Insufficient history for anomaly detection.",
      };
    }

    const amounts = history.map((h) => h.amount);
    const mean = amounts.reduce((sum, a) => sum + a, 0) / amounts.length;
    const variance =
      amounts.reduce((sum, a) => sum + Math.pow(a - mean, 2), 0) /
      amounts.length;
    const stdDev = Math.sqrt(variance);

    // Avoid division by zero when all historical amounts are identical
    if (stdDev === 0) {
      const isAnomaly = amountCents !== mean;
      return {
        isAnomaly,
        sigma: isAnomaly ? Infinity : 0,
        expectedCents: Math.round(mean),
        message: isAnomaly
          ? `All prior spends were $${(mean / 100).toFixed(2)}; this deviates.`
          : "Amount matches historical pattern.",
      };
    }

    const sigma = Math.abs(amountCents - mean) / stdDev;
    const isAnomaly = sigma > 2;

    return {
      isAnomaly,
      sigma: Math.round(sigma * 100) / 100,
      expectedCents: Math.round(mean),
      message: isAnomaly
        ? `Spend deviates ${sigma.toFixed(1)} sigma from average $${(mean / 100).toFixed(2)}. Anomaly flagged.`
        : `Spend within normal range (${sigma.toFixed(1)} sigma from mean).`,
    };
  }

  /**
   * Return the current month key in YYYY-MM format.
   */
  getMonthKey(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}`;
  }

  /**
   * Seed default monthly budget envelopes for all active agents.
   * Skips agents that already have an envelope for the current month.
   */
  async initializeBudgets(): Promise<{ created: number; skipped: number }> {
    const monthKey = this.getMonthKey();
    let created = 0;
    let skipped = 0;

    // Fetch all active agents
    const agents = await db
      .select()
      .from(companyAgents)
      .where(eq(companyAgents.status, "active"));

    for (const agent of agents) {
      // Check if an envelope already exists for this month
      const existing = await this.getAgentBudget(agent.codename, monthKey);
      if (existing) {
        skipped++;
        continue;
      }

      const budgetCents =
        DEFAULT_MONTHLY_BUDGETS[agent.codename.toLowerCase()] ?? DEFAULT_BUDGET_CENTS;

      await db.insert(agentBudgetEnvelopes).values({
        agentCodename: agent.codename,
        monthKey,
        budgetCents,
        spentCents: 0,
        category: "general",
      });

      created++;
    }

    return { created, skipped };
  }
}

export const financialAuthorityGate = new FinancialAuthorityGateService();

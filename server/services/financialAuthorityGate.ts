/**
 * Graduated Financial Authority Gate — Sovereign Company Protocol
 *
 * Tiered spending authority on top of the flat $500 cap in
 * autonomousDecisionExecutor.ts.
 *
 * CONSTITUTIONAL HARD STOP (CLAUDE.md, founder-confirmed this session):
 * "spends >$500 stay founder-only forever." Only Tier 1 ($0–$500) may be
 * granted autonomously. EVERY tier above $500 sets founderApprovalRequired
 * and routes to the founder — the multi-agent-consensus machinery (trust
 * scores, approver roles, cooling periods) is retained for the record and
 * for the day the founder explicitly rescinds the >$500 hard stop, but it
 * does NOT release funds on its own while the hard stop stands.
 *
 * Tier 1:  $0 – $500        Single agent, trust >= 70 — AUTONOMOUS
 * Tier 2:  $500 – $2,500    Founder approval required (>$500 hard stop)
 * Tier 3:  $2,500 – $10K    Founder approval required (>$500 hard stop)
 * Tier 4:  $10K – $50K      Founder approval required (>$500 hard stop)
 * Tier 5:  $50K+            Founder approval required (>$500 hard stop)
 *
 * Layered on top (Phase A.2 hardening):
 *
 *   FINANCIAL_HARD_CAP_CENTS (default $25,000) — an absolute ceiling
 *     above which the gate refuses to create an approval record at
 *     all, regardless of tier. Non-bypassable even if every approver
 *     trust score is gamed. The insurance against "all safeguards
 *     failed" failure modes. Raise it deliberately via env var when
 *     you know you're going to be in the room for the decision.
 *
 *   Anomaly → Tier escalation — a spend flagged >2σ anomalous bumps
 *     the required tier by 1. A tier 1 spend that's 3× the agent's
 *     historical average now needs tier-2 consensus, not just the
 *     agent's self-approval.
 *
 *   Approval TTL (default 72 hours) — pending requests that don't
 *     gather enough approvals within the window auto-expire. Prevents
 *     the pending queue from growing unbounded and keeps stale
 *     consensus from being rubber-stamped days later.
 */

import { db } from "../db";
import {
  financialApprovals,
  agentBudgetEnvelopes,
  spendAnomalies,
  companyAgents,
} from "@shared/schema";
import { eq, and, sql, desc, lt, avg } from "drizzle-orm";
import crypto from "crypto";
import { logger } from "../utils/logger";
// The >$500 spend ceiling has ONE source of truth: the pure hard-stops data
// module. Deriving the cents value here (rather than re-hardcoding 50_000)
// makes it structurally impossible for the executor lane and the autopilot
// lane to disagree about the constitutional limit. See autopilot/hardStops.ts.
import { HARD_STOP_SPEND_LIMIT_CENTS } from "./autopilot/hardStops";

// ─── Hard global cap ─────────────────────────────────────────────────────────
// Absolute ceiling. Any request above this amount fails immediately, even if
// every Tier 5 approver rubber-stamps it. Default is $25K — tuned low so the
// system has to ask *the human founder* for anything that could meaningfully
// dent runway. Raise via FINANCIAL_HARD_CAP_CENTS when you know a large
// spend is coming. Now resolved through founderSettings so the founder
// can adjust live from /founder/settings.
async function getHardCapCents(): Promise<number> {
  try {
    const { getNumberSetting } = await import("./founderSettings");
    return await getNumberSetting("FINANCIAL_HARD_CAP_CENTS", 2_500_000);
  } catch {
    const raw = process.env.FINANCIAL_HARD_CAP_CENTS;
    const parsed = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 2_500_000;
  }
}

// ─── Approval TTL ────────────────────────────────────────────────────────────
// Pending approvals that don't gather consensus within this window get
// auto-expired on the next checkApprovalStatus() / sweep.
async function getApprovalTtlHours(): Promise<number> {
  try {
    const { getNumberSetting } = await import("./founderSettings");
    return await getNumberSetting("FINANCIAL_APPROVAL_TTL_HOURS", 72);
  } catch {
    const raw = process.env.FINANCIAL_APPROVAL_TTL_HOURS;
    const parsed = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 72;
  }
}

// ─── Tier Definitions ────────────────────────────────────────────────────────

/**
 * The >$500 constitutional hard stop, as ONE number.
 *
 * Tier 1's ceiling below IS this constant rather than a repeated `50_000`, so
 * the boundary the rule is stated in and the boundary the table enforces cannot
 * drift apart. spendHardStop.test.ts imports it for the same reason: a test
 * that retypes the literal agrees with a drifted table instead of catching it.
 */
export const AUTONOMOUS_SPEND_CEILING_CENTS = HARD_STOP_SPEND_LIMIT_CENTS; // $500, from the one source


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

const SPENDING_TIERS: readonly SpendingTier[] = [
  {
    tier: 1,
    minCents: 0,
    maxCents: AUTONOMOUS_SPEND_CEILING_CENTS, // $500
    minTrust: 70,
    requiredApprovers: 1,
    approverRoles: ["self"],
    coolingPeriodHours: 0,
    founderTwinRequired: false,
    founderApprovalRequired: false,
  },
  {
    tier: 2,
    minCents: AUTONOMOUS_SPEND_CEILING_CENTS,
    maxCents: 250_000,         // $2,500
    minTrust: 80,
    requiredApprovers: 2,
    approverRoles: ["owner", "ledger"],
    coolingPeriodHours: 0,
    founderTwinRequired: false,
    // >$500 constitutional hard stop: founder-only, not agent consensus.
    founderApprovalRequired: true,
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
    // >$500 constitutional hard stop: founder-only, not agent consensus.
    founderApprovalRequired: true,
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
    // >$500 constitutional hard stop: founder-only, not agent consensus.
    founderApprovalRequired: true,
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

/**
 * THE tier resolver. Anything beyond all tiers falls to the last (which
 * requires founder approval), so an amount can never fall out of the table
 * into autonomy.
 *
 * This was described in its own comment as a "public mirror of the service's
 * private getTier — kept in sync", and that phrasing WAS the defect. The
 * private `getTier` is what the live path called (requestSpend → getTier →
 * tier.founderApprovalRequired, reached from
 * autonomousDecisionExecutor.ts:1010); this function was a second, byte-
 * equivalent copy whose only consumer was `spendIsAutonomous`, whose only
 * consumer was spendHardStop.test.ts. So the regression test that exists to
 * "lock the hard stop against drift" was pinning a function no production path
 * could reach.
 *
 * That was not theoretical. Mutation-tested before the fix: adding a single
 * early return to `getTier` so $0–$2,500 resolved to the autonomous Tier 1 —
 * i.e. restoring the exact autonomous $500–$50K regression this hard stop
 * exists to prevent — left spendHardStop.test.ts passing 2/2.
 *
 * The private method is now DELETED and its one call site resolves here. Not
 * "delegates to" — deleted, because a delegating wrapper is still a place a
 * drift can be written, and this file's whole lesson is that a second copy
 * costs nothing until the day it costs everything.
 *
 * Deliberately NOT exported. The test pins the hard stop through
 * `spendIsAutonomous` and through this file's source shape, so exporting the
 * resolver would only add a symbol with no consumer outside this module — the
 * "exists only for its test" shape that produced the original mirror.
 *
 * Found because the reachability gate could NOT see it: shared/governance/
 * constitution.ts names `spendIsAutonomous()` in the prose of the very entry
 * that records this hard stop, and that linter counted a name in a comment as a
 * use. The registry describing the enforcement is what concealed its absence.
 *
 * UPDATED 2026-08-20 (ledger 45), and the update is the interesting half. The
 * linter no longer reads comments — and this symbol is STILL certified reached,
 * by the same registry entry, because that entry is a `note:` STRING, not a
 * comment. Prose in a string literal is prose. The identifier pass tokenises
 * string contents, so a registry of sentences ABOUT the code counts as code
 * using it; the concealment survived its own fix in an equivalent
 * representation, which is precisely the failure mode CLAUDE.md's first law
 * warns about. Recorded on the frontier: closing it needs a real tokeniser, not
 * a regex, because a string-stripping regex trips on the first apostrophe
 * inside a double-quoted sentence.
 */
function tierForAmount(amountCents: number): SpendingTier {
  return (
    SPENDING_TIERS.find((t) => amountCents >= t.minCents && amountCents < t.maxCents) ??
    SPENDING_TIERS[SPENDING_TIERS.length - 1]
  );
}

/**
 * True when a spend of this many cents may be granted WITHOUT founder
 * approval. Per the >$500 constitutional hard stop (CLAUDE.md), ONLY Tier 1
 * ($0–$500) is autonomous — every larger spend routes to the founder.
 * Exported so the regression test can lock the hard stop against drift; it now
 * resolves through the same function the live path does.
 */
export function spendIsAutonomous(amountCents: number): boolean {
  return !tierForAmount(amountCents).founderApprovalRequired;
}

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
    // ── Absolute hard cap (Phase A.2 insurance layer) ──
    // Non-bypassable. Fail immediately. Do not even create an
    // approval record — a rejected record could theoretically be
    // re-opened by a compromised agent, so we refuse to persist.
    const hardCap = await getHardCapCents();
    if (amountCents > hardCap) {
      logger.warn("[financialAuthorityGate] spend blocked by hard cap", {
        metadata: {
          agentCodename,
          amountCents,
          hardCapCents: hardCap,
          purpose,
          category,
        },
      });
      return {
        requestId: "hard-cap-block",
        tier: 0,
        status: "blocked",
        message: `Spend of $${(amountCents / 100).toLocaleString()} exceeds the absolute hard cap of $${(hardCap / 100).toLocaleString()}. No approval flow will run. Raise FINANCIAL_HARD_CAP_CENTS only if you're certain you want the system able to move this much money autonomously.`,
      };
    }

    // Resolved through the module-level tierForAmount — the ONE tier resolver.
    // A private copy used to live here; see tierForAmount's header for what
    // that cost and why spendHardStop.test.ts could not see it.
    let tier = tierForAmount(amountCents);

    // ── Anomaly → tier escalation ──
    // A spend that's more than 2σ off the agent's historical pattern
    // requires one level higher of approval than its dollar amount
    // would normally need. This catches "agent's trust was gamed into
    // approving a sudden 10× spend" failure modes even if the spend
    // is technically within its trust tier.
    const anomaly = await this.detectAnomaly(agentCodename, amountCents);
    if (anomaly.isAnomaly) {
      const escalatedTierNumber = Math.min(tier.tier + 1, SPENDING_TIERS.length);
      const escalatedTier = SPENDING_TIERS.find((t) => t.tier === escalatedTierNumber) ?? tier;
      if (escalatedTier.tier !== tier.tier) {
        logger.info("[financialAuthorityGate] anomaly escalated tier", {
          metadata: {
            agentCodename,
            amountCents,
            sigma: anomaly.sigma,
            fromTier: tier.tier,
            toTier: escalatedTier.tier,
          },
        });
        tier = escalatedTier;
      }
    }

    // ── Hard stop: any spend >$500 requires founder approval ──
    // Per CLAUDE.md, "spends >$500 stay founder-only forever." Every tier
    // above Tier 1 sets founderApprovalRequired, so this routes all of them
    // to the founder rather than to autonomous multi-agent consensus.
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
        reasoning: `Tier ${tier.tier} hard stop — amount $${(amountCents / 100).toLocaleString()} is over the $500 autonomous cap and requires founder approval.`,
      });

      return {
        requestId,
        tier: tier.tier,
        status: "awaiting_founder",
        message: `Spend of $${(amountCents / 100).toLocaleString()} is over the $500 autonomous cap. Founder approval required.`,
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

    // ── Anomaly persistence ──
    // We've already computed `anomaly` at the top of requestSpend and
    // used it to escalate the tier. Now persist the anomaly record
    // itself so spendAnomalies keeps a full history for post-hoc audit.
    if (anomaly.isAnomaly) {
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

    // ── Approval TTL: expire stale pending requests ──
    // Anything still in "pending" after the TTL window is transitioned
    // to "expired" so the queue can't grow unbounded and stale
    // consensus can't be rubber-stamped days later.
    const ttlHours = await getApprovalTtlHours();
    const createdAt = request.createdAt instanceof Date ? request.createdAt : new Date(request.createdAt ?? Date.now());
    const ttlDeadline = new Date(createdAt.getTime() + ttlHours * 60 * 60 * 1000);
    if (request.status === "pending" && new Date() > ttlDeadline) {
      await db
        .update(financialApprovals)
        .set({
          status: "expired",
          updatedAt: new Date(),
        })
        .where(eq(financialApprovals.requestId, requestId));
      return {
        status: "expired",
        approvalsReceived: 0,
        approvalsRequired: request.requiredApprovers,
        coolingComplete: false,
        readyToExecute: false,
      };
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
   * Sweep stale pending approvals. Marks anything older than the TTL
   * window as expired in a single query. Safe to call from a cron job
   * or on-demand before the founder loads the approvals queue.
   */
  async sweepStaleApprovals(): Promise<{ expired: number }> {
    const ttlHours = await getApprovalTtlHours();
    const cutoff = new Date(Date.now() - ttlHours * 60 * 60 * 1000);
    const updated = await db
      .update(financialApprovals)
      .set({
        status: "expired",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(financialApprovals.status, "pending"),
          lt(financialApprovals.createdAt, cutoff),
        ),
      )
      .returning({ id: financialApprovals.id });
    if (updated.length > 0) {
      logger.info("[financialAuthorityGate] swept stale approvals", {
        metadata: { count: updated.length, cutoff: cutoff.toISOString() },
      });
    }
    return { expired: updated.length };
  }

  /**
   * Founder-facing roll-up: every agent's current-month envelope plus
   * utilization pct + any spend anomalies flagged this month. Drives
   * the "how much has each agent spent this month" summary on the
   * founder briefing and the /founder/decisions page.
   */
  async getBudgetSummary(monthKey?: string): Promise<{
    monthKey: string;
    envelopes: Array<{
      agentCodename: string;
      budgetCents: number;
      spentCents: number;
      remainingCents: number;
      utilizationPct: number;
      warningLevel: "ok" | "warn" | "critical";
    }>;
    pendingAnomalies: number;
    hardCapCents: number;
    approvalTtlHours: number;
  }> {
    const key = monthKey ?? this.getMonthKey();
    const envelopes = await db
      .select()
      .from(agentBudgetEnvelopes)
      .where(eq(agentBudgetEnvelopes.monthKey, key));

    const rolled = envelopes.map((envelope) => {
      const remainingCents = envelope.budgetCents - envelope.spentCents;
      const utilizationPct =
        envelope.budgetCents > 0
          ? Math.round((envelope.spentCents / envelope.budgetCents) * 10000) / 100
          : 0;
      const warningLevel: "ok" | "warn" | "critical" =
        utilizationPct >= 100 ? "critical" : utilizationPct >= 80 ? "warn" : "ok";
      return {
        agentCodename: envelope.agentCodename,
        budgetCents: envelope.budgetCents,
        spentCents: envelope.spentCents,
        remainingCents,
        utilizationPct,
        warningLevel,
      };
    });

    const anomalies = await db
      .select()
      .from(spendAnomalies)
      .where(eq(spendAnomalies.peerReviewStatus, "pending"));

    return {
      monthKey: key,
      envelopes: rolled,
      pendingAnomalies: anomalies.length,
      hardCapCents: await getHardCapCents(),
      approvalTtlHours: await getApprovalTtlHours(),
    };
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

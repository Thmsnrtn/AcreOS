// @ts-nocheck
/**
 * Outcome Verification Pipeline — Sovereign Company Protocol v12
 *
 * Actions are verified against real-world outcomes. Each action creates a
 * verification contract with stages (immediate/short_term/long_term). The
 * pipeline periodically checks contracts that are due, runs the appropriate
 * verification method, and flags discrepancies between claimed and actual results.
 */

import { db } from "../db";
import {
  outcomeVerificationContracts,
  type OutcomeVerificationContract,
} from "@shared/schema";
import { eq, desc, and, lte, sql, isNull } from "drizzle-orm";

// ─── Verification Method Registry ─────────────────────────────────────────────

type VerificationMethod =
  | "email_delivery"
  | "customer_login"
  | "payment_status"
  | "metric_change"
  | "api_response";

interface CreateContractParams {
  actionId: string;
  agentCodename: string;
  actionType: string;
  actionDescription: string;
  claimedOutcome: string;
  claimedSuccess: boolean;
  verificationMethod: VerificationMethod;
  verificationConfig?: Record<string, any>;
  verifyAfterMinutes?: number;
  verifyStages?: Array<{ stage: string; minutes: number }>;
  orgId?: number;
}

interface VerificationResult {
  verified: boolean;
  outcome: string;
  details?: string;
}

// ─── Simulated Verification Methods ───────────────────────────────────────────

async function verifyEmailDelivery(config: Record<string, any>): Promise<VerificationResult> {
  // Simulated: check if email status field updated in the system
  const emailId = config.emailId ?? "unknown";
  const expectedStatus = config.expectedStatus ?? "delivered";
  // In production, would query email service or webhook data
  const simulatedStatus = Math.random() > 0.15 ? expectedStatus : "bounced";
  return {
    verified: simulatedStatus === expectedStatus,
    outcome: `Email ${emailId} status: ${simulatedStatus}`,
    details: simulatedStatus !== expectedStatus
      ? `Expected ${expectedStatus}, got ${simulatedStatus}`
      : undefined,
  };
}

async function verifyCustomerLogin(config: Record<string, any>): Promise<VerificationResult> {
  // Simulated: check if user logged in since the action was taken
  const userId = config.userId ?? "unknown";
  const actionTimestamp = config.actionTimestamp ?? new Date().toISOString();
  const simulatedLoggedIn = Math.random() > 0.3;
  return {
    verified: simulatedLoggedIn,
    outcome: simulatedLoggedIn
      ? `User ${userId} logged in after ${actionTimestamp}`
      : `User ${userId} has not logged in since ${actionTimestamp}`,
  };
}

async function verifyPaymentStatus(config: Record<string, any>): Promise<VerificationResult> {
  // Simulated: check payment records for expected status
  const paymentId = config.paymentId ?? "unknown";
  const expectedStatus = config.expectedStatus ?? "completed";
  const simulatedStatus = Math.random() > 0.1 ? expectedStatus : "failed";
  return {
    verified: simulatedStatus === expectedStatus,
    outcome: `Payment ${paymentId} status: ${simulatedStatus}`,
    details: simulatedStatus !== expectedStatus
      ? `Expected ${expectedStatus}, got ${simulatedStatus}`
      : undefined,
  };
}

async function verifyMetricChange(config: Record<string, any>): Promise<VerificationResult> {
  // Simulated: check if a KPI moved in the expected direction
  const metric = config.metric ?? "unknown_metric";
  const expectedDirection = config.expectedDirection ?? "increase";
  const threshold = config.threshold ?? 0;
  const simulatedChange = (Math.random() - 0.3) * 100; // biased positive
  const directionMatch =
    (expectedDirection === "increase" && simulatedChange > threshold) ||
    (expectedDirection === "decrease" && simulatedChange < -threshold);
  return {
    verified: directionMatch,
    outcome: `Metric ${metric} changed by ${simulatedChange.toFixed(2)} (expected ${expectedDirection})`,
    details: !directionMatch
      ? `Change ${simulatedChange.toFixed(2)} did not meet ${expectedDirection} threshold ${threshold}`
      : undefined,
  };
}

async function verifyApiResponse(config: Record<string, any>): Promise<VerificationResult> {
  // Simulated: check external API response cache
  const endpoint = config.endpoint ?? "unknown";
  const expectedStatus = config.expectedStatus ?? 200;
  const simulatedStatus = Math.random() > 0.1 ? expectedStatus : 500;
  return {
    verified: simulatedStatus === expectedStatus,
    outcome: `API ${endpoint} returned ${simulatedStatus}`,
    details: simulatedStatus !== expectedStatus
      ? `Expected ${expectedStatus}, got ${simulatedStatus}`
      : undefined,
  };
}

const VERIFICATION_HANDLERS: Record<VerificationMethod, (config: Record<string, any>) => Promise<VerificationResult>> = {
  email_delivery: verifyEmailDelivery,
  customer_login: verifyCustomerLogin,
  payment_status: verifyPaymentStatus,
  metric_change: verifyMetricChange,
  api_response: verifyApiResponse,
};

// ─── Service ──────────────────────────────────────────────────────────────────

class OutcomeVerificationService {
  /**
   * Register a new verification contract for an action.
   */
  async createContract(params: CreateContractParams): Promise<OutcomeVerificationContract> {
    const stages = params.verifyStages ?? [
      { stage: "immediate", minutes: 5 },
      { stage: "short_term", minutes: 60 },
      { stage: "long_term", minutes: 1440 },
    ];

    const verifyAfterMinutes = params.verifyAfterMinutes ?? stages[0]?.minutes ?? 60;
    const nextVerificationAt = new Date(Date.now() + verifyAfterMinutes * 60 * 1000);

    const [contract] = await db
      .insert(outcomeVerificationContracts)
      .values({
        actionId: params.actionId,
        agentCodename: params.agentCodename,
        actionType: params.actionType,
        actionDescription: params.actionDescription,
        claimedOutcome: params.claimedOutcome,
        claimedSuccess: params.claimedSuccess,
        verificationMethod: params.verificationMethod,
        verificationConfig: params.verificationConfig ?? {},
        verifyAfterMinutes,
        verifyStages: stages,
        currentStage: "pending",
        orgId: params.orgId ?? null,
        nextVerificationAt,
      })
      .returning();

    console.log(
      `[outcome-verify] Contract created for ${params.agentCodename}/${params.actionType} — ` +
        `next check at ${nextVerificationAt.toISOString()}`,
    );
    return contract;
  }

  /**
   * Process all contracts due for verification.
   * Finds contracts whose nextVerificationAt has passed and runs their verification.
   */
  async processVerifications(): Promise<{
    processed: number;
    passed: number;
    discrepancies: number;
    errors: number;
  }> {
    const now = new Date();
    const dueContracts = await db
      .select()
      .from(outcomeVerificationContracts)
      .where(
        and(
          lte(outcomeVerificationContracts.nextVerificationAt, now),
          isNull(outcomeVerificationContracts.completedAt),
        ),
      )
      .orderBy(outcomeVerificationContracts.nextVerificationAt);

    let processed = 0;
    let passed = 0;
    let discrepancies = 0;
    let errors = 0;

    for (const contract of dueContracts) {
      try {
        const result = await this.verify(contract.id);
        processed++;
        if (result.discrepancyDetected) {
          discrepancies++;
        } else {
          passed++;
        }
      } catch (err) {
        errors++;
        console.error(
          `[outcome-verify] Error verifying contract ${contract.id}:`,
          (err as Error).message,
        );
      }
    }

    console.log(
      `[outcome-verify] Processed ${processed} contracts: ${passed} passed, ` +
        `${discrepancies} discrepancies, ${errors} errors`,
    );
    return { processed, passed, discrepancies, errors };
  }

  /**
   * Run verification for a specific contract.
   */
  async verify(contractId: number): Promise<OutcomeVerificationContract> {
    const [contract] = await db
      .select()
      .from(outcomeVerificationContracts)
      .where(eq(outcomeVerificationContracts.id, contractId))
      .limit(1);

    if (!contract) throw new Error(`Verification contract not found: ${contractId}`);

    const method = contract.verificationMethod as VerificationMethod;
    const handler = VERIFICATION_HANDLERS[method];
    if (!handler) {
      throw new Error(`Unknown verification method: ${method}`);
    }

    const result = await handler(contract.verificationConfig);
    return this.recordVerification(contractId, result.outcome, result.verified);
  }

  /**
   * Record the verification result and detect discrepancy.
   */
  async recordVerification(
    contractId: number,
    verifiedOutcome: string,
    verifiedSuccess: boolean,
  ): Promise<OutcomeVerificationContract> {
    const [contract] = await db
      .select()
      .from(outcomeVerificationContracts)
      .where(eq(outcomeVerificationContracts.id, contractId))
      .limit(1);

    if (!contract) throw new Error(`Verification contract not found: ${contractId}`);

    const discrepancyDetected = contract.claimedSuccess !== verifiedSuccess;
    const discrepancyDetails = discrepancyDetected
      ? `Claimed: ${contract.claimedOutcome} (success=${contract.claimedSuccess}). ` +
        `Verified: ${verifiedOutcome} (success=${verifiedSuccess}).`
      : null;

    // Determine next stage
    const stages = contract.verifyStages as Array<{ stage: string; minutes: number }>;
    const currentStageIndex = stages.findIndex((s) => s.stage === contract.currentStage);
    const nextStageIndex = currentStageIndex + 1;
    const hasNextStage = nextStageIndex < stages.length;

    const updates: Record<string, any> = {
      verifiedOutcome,
      verifiedSuccess,
      discrepancyDetected,
      discrepancyDetails,
      currentStage: hasNextStage ? stages[nextStageIndex].stage : "completed",
    };

    if (hasNextStage) {
      updates.nextVerificationAt = new Date(
        Date.now() + stages[nextStageIndex].minutes * 60 * 1000,
      );
    } else {
      updates.completedAt = new Date();
      updates.nextVerificationAt = null;
    }

    const [updated] = await db
      .update(outcomeVerificationContracts)
      .set(updates)
      .where(eq(outcomeVerificationContracts.id, contractId))
      .returning();

    if (discrepancyDetected) {
      console.warn(
        `[outcome-verify] DISCREPANCY for contract ${contractId} ` +
          `(${contract.agentCodename}/${contract.actionType}): ${discrepancyDetails}`,
      );
    }

    return updated;
  }

  /**
   * Get contracts where claimed outcome differs from verified outcome.
   */
  async getDiscrepancies(): Promise<OutcomeVerificationContract[]> {
    return db
      .select()
      .from(outcomeVerificationContracts)
      .where(eq(outcomeVerificationContracts.discrepancyDetected, true))
      .orderBy(desc(outcomeVerificationContracts.createdAt));
  }

  /**
   * Get verification stats for a specific agent.
   */
  async getAgentVerificationStats(agentCodename: string): Promise<{
    totalActions: number;
    verified: number;
    discrepancies: number;
    accuracyRate: number;
  }> {
    const contracts = await db
      .select()
      .from(outcomeVerificationContracts)
      .where(eq(outcomeVerificationContracts.agentCodename, agentCodename));

    const total = contracts.length;
    const verified = contracts.filter((c) => c.verifiedOutcome !== null).length;
    const discrepancies = contracts.filter((c) => c.discrepancyDetected).length;
    const accuracyRate = verified > 0 ? ((verified - discrepancies) / verified) * 100 : 100;

    return {
      totalActions: total,
      verified,
      discrepancies,
      accuracyRate: Math.round(accuracyRate * 100) / 100,
    };
  }

  /**
   * Get system-wide verification stats.
   */
  async getAllVerificationStats(): Promise<{
    totalContracts: number;
    pending: number;
    completed: number;
    verified: number;
    discrepancies: number;
    overallAccuracyRate: number;
    byAgent: Record<string, { total: number; discrepancies: number; accuracy: number }>;
    byMethod: Record<string, { total: number; discrepancies: number }>;
  }> {
    const allContracts = await db
      .select()
      .from(outcomeVerificationContracts)
      .orderBy(desc(outcomeVerificationContracts.createdAt));

    const pending = allContracts.filter((c) => c.completedAt === null).length;
    const completed = allContracts.filter((c) => c.completedAt !== null).length;
    const verified = allContracts.filter((c) => c.verifiedOutcome !== null).length;
    const discrepancies = allContracts.filter((c) => c.discrepancyDetected).length;
    const overallAccuracyRate =
      verified > 0 ? Math.round(((verified - discrepancies) / verified) * 10000) / 100 : 100;

    // Group by agent
    const byAgent: Record<string, { total: number; discrepancies: number; accuracy: number }> = {};
    for (const c of allContracts) {
      if (!byAgent[c.agentCodename]) {
        byAgent[c.agentCodename] = { total: 0, discrepancies: 0, accuracy: 100 };
      }
      byAgent[c.agentCodename].total++;
      if (c.discrepancyDetected) byAgent[c.agentCodename].discrepancies++;
    }
    for (const agent of Object.keys(byAgent)) {
      const a = byAgent[agent];
      a.accuracy = a.total > 0
        ? Math.round(((a.total - a.discrepancies) / a.total) * 10000) / 100
        : 100;
    }

    // Group by method
    const byMethod: Record<string, { total: number; discrepancies: number }> = {};
    for (const c of allContracts) {
      if (!byMethod[c.verificationMethod]) {
        byMethod[c.verificationMethod] = { total: 0, discrepancies: 0 };
      }
      byMethod[c.verificationMethod].total++;
      if (c.discrepancyDetected) byMethod[c.verificationMethod].discrepancies++;
    }

    return {
      totalContracts: allContracts.length,
      pending,
      completed,
      verified,
      discrepancies,
      overallAccuracyRate,
      byAgent,
      byMethod,
    };
  }

  /**
   * Get contracts awaiting verification (pending with future nextVerificationAt).
   */
  async getPendingVerifications(): Promise<OutcomeVerificationContract[]> {
    return db
      .select()
      .from(outcomeVerificationContracts)
      .where(isNull(outcomeVerificationContracts.completedAt))
      .orderBy(outcomeVerificationContracts.nextVerificationAt);
  }

  /**
   * Get contracts by agent codename.
   */
  async getByAgent(
    agentCodename: string,
    limit: number = 50,
  ): Promise<OutcomeVerificationContract[]> {
    return db
      .select()
      .from(outcomeVerificationContracts)
      .where(eq(outcomeVerificationContracts.agentCodename, agentCodename))
      .orderBy(desc(outcomeVerificationContracts.createdAt))
      .limit(limit);
  }

  /**
   * Get the most recent verification contracts.
   */
  async getRecent(limit: number = 50): Promise<OutcomeVerificationContract[]> {
    return db
      .select()
      .from(outcomeVerificationContracts)
      .orderBy(desc(outcomeVerificationContracts.createdAt))
      .limit(limit);
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

export const outcomeVerificationService = new OutcomeVerificationService();

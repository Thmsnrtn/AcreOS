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

// ─── Real Verification Methods (DB-Backed) ──────────────────────────────────

async function verifyEmailDelivery(config: Record<string, any>): Promise<VerificationResult> {
  const emailId = config.emailId ?? "unknown";
  const expectedStatus = config.expectedStatus ?? "delivered";

  try {
    // Check agent action log for email send outcome
    const { agentActionLog } = await import("@shared/schema");
    const [action] = await db.select()
      .from(agentActionLog)
      .where(and(
        sql`${agentActionLog.actionInput}->>'emailId' = ${emailId}`,
        sql`${agentActionLog.actionName} ILIKE '%email%'`,
      ))
      .orderBy(desc(agentActionLog.createdAt))
      .limit(1);

    if (action) {
      const outcome = action.outcome ?? "unknown";
      const actualStatus = outcome === "success" ? "delivered" : "failed";
      return {
        verified: actualStatus === expectedStatus,
        outcome: `Email ${emailId} status: ${actualStatus} (from action log)`,
        details: actualStatus !== expectedStatus
          ? `Expected ${expectedStatus}, got ${actualStatus}` : undefined,
      };
    }

    // Check agent events for email delivery confirmation
    const { agentEvents } = await import("@shared/schema");
    const [event] = await db.select()
      .from(agentEvents)
      .where(and(
        sql`${agentEvents.payload}->>'emailId' = ${emailId}`,
        eq(agentEvents.eventType, "action_succeeded"),
      ))
      .orderBy(desc(agentEvents.createdAt))
      .limit(1);

    if (event) {
      return { verified: true, outcome: `Email ${emailId} status: delivered (confirmed via event)` };
    }

    return { verified: false, outcome: `Email ${emailId} status: unconfirmed — no delivery record found` };
  } catch {
    return { verified: false, outcome: `Email ${emailId} verification failed — could not query records` };
  }
}

async function verifyCustomerLogin(config: Record<string, any>): Promise<VerificationResult> {
  const userId = config.userId ?? config.orgId ?? "unknown";
  const actionTimestamp = config.actionTimestamp ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  try {
    // Check if organization had any activity since action timestamp
    const { organizations } = await import("@shared/schema");
    if (config.orgId) {
      const [org] = await db.select({ updatedAt: organizations.updatedAt })
        .from(organizations)
        .where(eq(organizations.id, parseInt(String(config.orgId), 10)))
        .limit(1);

      if (org?.updatedAt && new Date(org.updatedAt) > new Date(actionTimestamp)) {
        return { verified: true, outcome: `Org ${config.orgId} had activity after ${actionTimestamp}` };
      }
    }

    // Check for any agent events tied to this user/org since action
    const { agentEvents } = await import("@shared/schema");
    const [event] = await db.select({ count: sql<number>`count(*)::int` })
      .from(agentEvents)
      .where(and(
        sql`${agentEvents.payload}->>'orgId' = ${String(userId)}`,
        sql`${agentEvents.createdAt} > ${actionTimestamp}`,
      ));

    const hasActivity = (event?.count ?? 0) > 0;
    return {
      verified: hasActivity,
      outcome: hasActivity
        ? `User/org ${userId} had ${event?.count} activity events after ${actionTimestamp}`
        : `User/org ${userId} has not had activity since ${actionTimestamp}`,
    };
  } catch {
    return { verified: false, outcome: `Customer login verification failed for ${userId}` };
  }
}

async function verifyPaymentStatus(config: Record<string, any>): Promise<VerificationResult> {
  const paymentId = config.paymentId ?? config.dealId ?? "unknown";
  const expectedStatus = config.expectedStatus ?? "completed";

  try {
    // Check deals table for payment/deal status
    const { deals } = await import("@shared/schema");
    if (config.dealId) {
      const [deal] = await db.select({ stage: deals.stage, status: deals.status })
        .from(deals)
        .where(eq(deals.id, parseInt(String(config.dealId), 10)))
        .limit(1);

      if (deal) {
        const actualStatus = deal.status ?? deal.stage ?? "unknown";
        const isExpected = actualStatus.toLowerCase().includes(expectedStatus.toLowerCase());
        return {
          verified: isExpected,
          outcome: `Deal/payment ${paymentId} status: ${actualStatus}`,
          details: !isExpected ? `Expected ${expectedStatus}, got ${actualStatus}` : undefined,
        };
      }
    }

    // Check agent action log for payment-related actions
    const { agentActionLog } = await import("@shared/schema");
    const [action] = await db.select()
      .from(agentActionLog)
      .where(and(
        sql`${agentActionLog.actionInput}->>'paymentId' = ${String(paymentId)}`,
        eq(agentActionLog.outcome, "success"),
      ))
      .orderBy(desc(agentActionLog.createdAt))
      .limit(1);

    return {
      verified: !!action,
      outcome: action
        ? `Payment ${paymentId} verified via action log (success)`
        : `Payment ${paymentId} status unconfirmed — no matching record`,
    };
  } catch {
    return { verified: false, outcome: `Payment verification failed for ${paymentId}` };
  }
}

async function verifyMetricChange(config: Record<string, any>): Promise<VerificationResult> {
  const metric = config.metric ?? "unknown_metric";
  const expectedDirection = config.expectedDirection ?? "increase";
  const threshold = config.threshold ?? 0;
  const baselineValue = config.baselineValue ?? 0;
  const baselineTimestamp = config.baselineTimestamp ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  try {
    // Query actual metric from agent events or action log
    const { agentEvents } = await import("@shared/schema");
    const recentCount = await db.select({ count: sql<number>`count(*)::int` })
      .from(agentEvents)
      .where(and(
        eq(agentEvents.eventType, "action_succeeded"),
        sql`${agentEvents.payload}->>'metric' = ${metric}`,
        sql`${agentEvents.createdAt} > ${baselineTimestamp}`,
      ));

    // Also check action log for the metric
    const { agentActionLog } = await import("@shared/schema");
    const successCount = await db.select({ count: sql<number>`count(*)::int` })
      .from(agentActionLog)
      .where(and(
        eq(agentActionLog.outcome, "success"),
        sql`${agentActionLog.actionName} ILIKE ${'%' + metric + '%'}`,
        gte(agentActionLog.createdAt, new Date(baselineTimestamp)),
      ));

    const actualChange = (recentCount[0]?.count ?? 0) + (successCount[0]?.count ?? 0) - baselineValue;
    const directionMatch =
      (expectedDirection === "increase" && actualChange > threshold) ||
      (expectedDirection === "decrease" && actualChange < -threshold);

    return {
      verified: directionMatch,
      outcome: `Metric ${metric} changed by ${actualChange} (expected ${expectedDirection}, threshold ${threshold})`,
      details: !directionMatch
        ? `Change ${actualChange} did not meet ${expectedDirection} threshold ${threshold}` : undefined,
    };
  } catch {
    return { verified: false, outcome: `Metric verification failed for ${metric}` };
  }
}

async function verifyApiResponse(config: Record<string, any>): Promise<VerificationResult> {
  const endpoint = config.endpoint ?? "unknown";
  const expectedStatus = config.expectedStatus ?? 200;

  try {
    // Check integration execution log for real API response
    const { integrationExecutionLog } = await import("@shared/schema");
    const [execution] = await db.select()
      .from(integrationExecutionLog)
      .where(sql`${integrationExecutionLog.endpoint} = ${endpoint}`)
      .orderBy(desc(integrationExecutionLog.executedAt))
      .limit(1);

    if (execution) {
      const actualStatus = execution.responseStatus ?? 0;
      return {
        verified: actualStatus === expectedStatus,
        outcome: `API ${endpoint} returned ${actualStatus} (latency: ${execution.latencyMs}ms)`,
        details: actualStatus !== expectedStatus
          ? `Expected ${expectedStatus}, got ${actualStatus}` : undefined,
      };
    }

    return {
      verified: false,
      outcome: `API ${endpoint} — no execution record found`,
      details: "No recent API call recorded in integration log",
    };
  } catch {
    return { verified: false, outcome: `API verification failed for ${endpoint}` };
  }
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

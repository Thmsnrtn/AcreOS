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
import { eq, desc, and, lte, gte, sql, isNull } from "drizzle-orm";
import { logger } from "../utils/logger";
import { unscopedForPlatformOps } from "../utils/orgScopedDb";

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
        sql`${agentActionLog.input}->>'emailId' = ${emailId}`,
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

/**
 * `orgId` is the CONTRACT's org (`outcome_verification_contracts.org_id`),
 * threaded in by `verify()` — never taken from `config`.
 *
 * That distinction is the whole fix. `config` is the stored
 * `verificationConfig` blob, which arrives unvalidated from the request body
 * of `POST /api/founder/v12/verification/contracts`; a `dealId` written into
 * it used to reach `where(eq(deals.id, …))` with no tenant predicate, so a
 * stored config could read ANY org's deal status. Trusting an org id from the
 * same untrusted blob would fix nothing, so the org comes from the contract
 * row instead. A contract with no org does not get to read a deal at all —
 * see the refusal below.
 */
async function verifyPaymentStatus(
  config: Record<string, any>,
  orgId: number | null,
): Promise<VerificationResult> {
  const paymentId = config.paymentId ?? config.dealId ?? "unknown";
  const expectedStatus = config.expectedStatus ?? "completed";

  try {
    // Check deals table for payment/deal status
    const { deals } = await import("@shared/schema");
    if (config.dealId && orgId == null) {
      // Refuse rather than read unscoped. `deals.organization_id` is NOT NULL,
      // so an unscoped read here is always SOME tenant's deal — just not one
      // this contract can prove it owns.
      logger.warn(
        `[outcome-verify] payment_status contract references deal ${config.dealId} but carries no orgId — ` +
          `refusing to resolve the deal across tenants`,
      );
      return {
        verified: false,
        outcome: `Payment ${paymentId} status unconfirmed — verification contract has no organization`,
        details: `Deal ${config.dealId} was not read: an org-scoped lookup requires the contract's org_id, which is null.`,
      };
    }
    if (config.dealId) {
      const [deal] = await db.select({ status: deals.status })
        .from(deals)
        .where(and(
          eq(deals.id, parseInt(String(config.dealId), 10)),
          eq(deals.organizationId, orgId as number),
        ))
        .limit(1);

      if (deal) {
        const actualStatus = deal.status ?? "unknown";
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
        sql`${agentActionLog.input}->>'paymentId' = ${String(paymentId)}`,
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
    // Deliberately UNSCOPED, and the reason is not convenience.
    //
    // An agent's integration call is a PLATFORM action: `execute` logs it with
    // `orgId: params?.orgId`, which is normally absent, so the row lands in the
    // platform lane. Pinning this read to the contract's org would make every
    // platform-lane execution invisible to a contract that carries one, and
    // this function would then answer "no execution record found" for calls
    // that demonstrably succeeded — a FABRICATED verification failure, which
    // the no-fabrication rule forbids outright.
    //
    // The honest caveat, recorded rather than hidden: matching on endpoint
    // alone with newest-wins means a contract in one lane can be marked
    // verified on the strength of another lane's execution row. That is an
    // ATTRIBUTION weakness in what this check proves, not a data leak — only
    // `responseStatus` and `latencyMs` reach the returned string.
    const [execution] = await unscopedForPlatformOps(
      "outcome verification reads the integration execution log, which records PLATFORM-lane agent calls; scoping it to the contract's org would report succeeded calls as missing",
    ).select()
      .from(integrationExecutionLog)
      .where(sql`${integrationExecutionLog.endpoint} = ${endpoint}`)
      .orderBy(desc(integrationExecutionLog.createdAt))
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

/**
 * Handlers receive the contract's own `orgId` as a second argument so a
 * handler that touches an org-scoped table can pin its query to the tenant
 * that owns the contract. Handlers with no org-scoped read simply declare one
 * parameter and ignore it (a 1-arg function is assignable to this 2-arg type).
 *
 * CORRECTION (2026-09-05): this used to end "only `payment_status` needs it
 * today", and that was wrong. `verifyApiResponse` also reads an org-TAGGED
 * table (`integration_execution_log`), declares one parameter, and therefore
 * silently discards the `orgId` the dispatch site is already handing it. It
 * stays unscoped on purpose — see the reason at its own call — but "needs it"
 * and "reads an org-tagged table" are different questions, and conflating them
 * is how a handler that should have been scoped gets written next to one that
 * should not.
 */
const VERIFICATION_HANDLERS: Record<
  VerificationMethod,
  (config: Record<string, any>, orgId: number | null) => Promise<VerificationResult>
> = {
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

    logger.info(`[outcome-verify] Contract created for ${params.agentCodename}/${params.actionType} — ` +
        `next check at ${nextVerificationAt.toISOString()}`);
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
    // A SCHEDULED SWEEP: every due contract in the business, whoever owns it.
    // Per-org scoping here would mean one tenant's verifications ran and the
    // rest silently never did.
    const dueContracts = await unscopedForPlatformOps(
      "scheduled outcome-verification sweep processes every due contract across the whole business; a per-org predicate would leave other tenants' verifications unrun",
    )
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
        logger.error(`[outcome-verify] Error verifying contract ${contract.id}`, undefined, { metadata: { detail: (err as Error).message } });
      }
    }

    logger.info(`[outcome-verify] Processed ${processed} contracts: ${passed} passed, ` +
        `${discrepancies} discrepancies, ${errors} errors`);
    return { processed, passed, discrepancies, errors };
  }

  /**
   * Run verification for a specific contract.
   */
  async verify(contractId: number): Promise<OutcomeVerificationContract> {
    // `contractId` comes from the platform sweep above or a founder route; the
    // contract IS the unit of work and carries its own lane, so there is no
    // caller org to scope to.
    const [contract] = await unscopedForPlatformOps(
      "a verification contract is resolved by its own id from the platform sweep; the contract carries the lane rather than the caller",
    )
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

    // The contract row is the ONLY trusted source of tenancy here — never
    // `verificationConfig`, which is caller-supplied and unvalidated.
    const result = await handler(contract.verificationConfig, contract.orgId ?? null);
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
      logger.warn(`[outcome-verify] DISCREPANCY for contract ${contractId} ` +
          `(${contract.agentCodename}/${contract.actionType}): ${discrepancyDetails}`);
    }

    return updated;
  }

  /**
   * Get contracts where claimed outcome differs from verified outcome.
   */
  async getDiscrepancies(): Promise<OutcomeVerificationContract[]> {
    return unscopedForPlatformOps(
      "founder discrepancy feed: every agent claim that did not hold, across the business; the founder's verification plane is company-level by construction: agent codenames are GLOBAL platform identities and there is no caller org, so a per-org predicate would return nothing",
    )
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
    const contracts = await unscopedForPlatformOps(
      "per-agent accuracy across the whole fleet; the founder's verification plane is company-level by construction: agent codenames are GLOBAL platform identities and there is no caller org, so a per-org predicate would return nothing",
    )
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
    const allContracts = await unscopedForPlatformOps(
      "system-wide verification statistics; the founder's verification plane is company-level by construction: agent codenames are GLOBAL platform identities and there is no caller org, so a per-org predicate would return nothing",
    )
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
    return unscopedForPlatformOps(
      "founder pending-verification feed across the whole agent fleet; the founder's verification plane is company-level by construction: agent codenames are GLOBAL platform identities and there is no caller org, so a per-org predicate would return nothing",
    )
      .select()
      .from(outcomeVerificationContracts)
      .where(isNull(outcomeVerificationContracts.completedAt))
      .orderBy(outcomeVerificationContracts.nextVerificationAt);
  }

  /**
   * Get contracts by agent codename.
   */
  /**
   * `orgId` is REQUIRED, and `null` means the platform lane — never "any org".
   *
   * Agent codenames are GLOBAL platform identities, so filtering on the
   * codename alone sweeps every tenant's verification contracts for that agent
   * and returns whole rows. Zero callers today; scoped rather than deleted for
   * the same reason as its sibling in integrationFrameworkV12 — the shape is
   * the hazard, and it survives being wired up later.
   */
  async getByAgent(
    agentCodename: string,
    orgId: number | null,
    limit: number = 50,
  ): Promise<OutcomeVerificationContract[]> {
    return db
      .select()
      .from(outcomeVerificationContracts)
      .where(and(
        eq(outcomeVerificationContracts.agentCodename, agentCodename),
        orgId == null
          ? isNull(outcomeVerificationContracts.orgId)
          : eq(outcomeVerificationContracts.orgId, orgId),
      ))
      .orderBy(desc(outcomeVerificationContracts.createdAt))
      .limit(limit);
  }

  /**
   * Get the most recent verification contracts.
   */
  async getRecent(limit: number = 50): Promise<OutcomeVerificationContract[]> {
    // `limit` reaches here as `parseInt(req.query.limit)`, so `?limit=abc`
    // arrives as NaN and `.limit(NaN)` fails the request with a 500 where a
    // sane default was the obvious answer.
    const take = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 500) : 50;
    return unscopedForPlatformOps(
      "founder verification timeline — what the agent fleet recently claimed and whether it held; the founder's verification plane is company-level by construction: agent codenames are GLOBAL platform identities and there is no caller org, so a per-org predicate would return nothing",
    )
      .select()
      .from(outcomeVerificationContracts)
      .orderBy(desc(outcomeVerificationContracts.createdAt))
      .limit(take);
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

export const outcomeVerificationService = new OutcomeVerificationService();

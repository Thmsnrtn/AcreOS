import { db } from "../db";
import {
  governancePolicies,
  policyEvaluations,
  auditExplanations,
  complianceSnapshots,
  regulatorySandboxRuns,
  GovernancePolicyEntry,
  PolicyEvaluationEntry,
  AuditExplanationEntry,
  ComplianceSnapshotEntry,
  RegulatorySandboxRunEntry,
} from "@shared/schema";
import { eq, and, desc, sql, ilike, inArray } from "drizzle-orm";
import crypto from "crypto";

// ─── Governance & Compliance Brain — Sovereign Company Protocol v13 ───────────
// The compliance gate for every high-stakes action in the system.
// Evaluates agent actions against governance policies, generates audit trails,
// runs regulatory sandboxes, and tracks compliance health over time.

interface PolicyCheckResult {
  policyId: string;
  result: "pass" | "warning" | "blocked";
  details?: string;
}

interface ParsedRule {
  whenConditions: Record<string, any>;
  thenRequirements: string[];
}

class GovernanceBrainService {
  // ─── 1. Create Policy ────────────────────────────────────────────────────────
  async createPolicy(data: {
    name: string;
    category: string;
    jurisdiction?: string;
    ruleDsl: string;
    ruleConfig?: Record<string, any>;
    severity?: string;
    effectiveDate?: Date;
    sunsetDate?: Date;
  }) {
    const policyId = crypto.randomUUID();

    const [policy] = await db
      .insert(governancePolicies)
      .values({
        policyId,
        name: data.name,
        category: data.category,
        jurisdiction: data.jurisdiction ?? null,
        ruleDsl: data.ruleDsl,
        ruleConfig: data.ruleConfig ?? {},
        severity: data.severity ?? "warning",
        effectiveDate: data.effectiveDate ?? new Date(),
        sunsetDate: data.sunsetDate ?? null,
        isActive: true,
      })
      .returning();

    return policy;
  }

  // ─── 2. Evaluate Action — THE COMPLIANCE GATE ────────────────────────────────
  async evaluateAction(data: {
    actionId: string;
    agentCodename: string;
    actionType: string;
    actionContext: Record<string, any>;
    orgId?: number;
  }) {
    // Fetch all active policies whose effective date has passed and sunset hasn't
    const now = new Date();
    const activePolicies = await db
      .select()
      .from(governancePolicies)
      .where(
        and(
          eq(governancePolicies.isActive, true),
          sql`${governancePolicies.effectiveDate} <= ${now}`,
          sql`(${governancePolicies.sunsetDate} IS NULL OR ${governancePolicies.sunsetDate} > ${now})`
        )
      );

    const policiesChecked: PolicyCheckResult[] = [];
    let hasBlock = false;
    let hasWarning = false;
    const failedPolicies: string[] = [];

    for (const policy of activePolicies) {
      const checkResult = this.evaluatePolicyAgainstAction(
        policy,
        data.actionType,
        data.actionContext
      );
      policiesChecked.push(checkResult);

      if (checkResult.result === "blocked") {
        hasBlock = true;
        failedPolicies.push(`${policy.name} (BLOCK)`);
      } else if (checkResult.result === "warning") {
        hasWarning = true;
        failedPolicies.push(`${policy.name} (WARNING)`);
      }
    }

    const overallResult = hasBlock ? "blocked" : hasWarning ? "warning" : "pass";

    // Build human-readable explanation
    let explanation: string;
    if (overallResult === "pass") {
      explanation = `Action ${data.actionId} by ${data.agentCodename} passed all ${policiesChecked.length} governance checks.`;
    } else {
      explanation = `Action ${data.actionId} by ${data.agentCodename} resulted in ${overallResult}. ` +
        `Failed policies: ${failedPolicies.join(", ")}. ` +
        `${policiesChecked.length} total policies evaluated.`;
    }

    const evaluationId = crypto.randomUUID();

    const [evaluation] = await db
      .insert(policyEvaluations)
      .values({
        evaluationId,
        actionId: data.actionId,
        agentCodename: data.agentCodename,
        policiesChecked,
        overallResult,
        explanation,
        orgId: data.orgId ?? null,
      })
      .returning();

    return evaluation;
  }

  // ─── Rule Engine: Parse and evaluate WHEN/THEN DSL ───────────────────────────
  private parseRuleDsl(ruleDsl: string): ParsedRule {
    const whenConditions: Record<string, any> = {};
    const thenRequirements: string[] = [];

    // Parse WHEN conditions: WHEN actionType=outbound_call AND jurisdiction=TX
    const whenMatch = ruleDsl.match(/WHEN\s+(.+?)(?:\s+THEN|\s*$)/i);
    if (whenMatch) {
      const conditions = whenMatch[1].split(/\s+AND\s+/i);
      for (const cond of conditions) {
        const [key, value] = cond.split("=").map((s) => s.trim());
        if (key && value) {
          whenConditions[key] = value;
        }
      }
    }

    // Parse THEN requirements: THEN REQUIRE consent_obtained REQUIRE disclosure_sent
    const thenMatch = ruleDsl.match(/THEN\s+(.+)/i);
    if (thenMatch) {
      const requires = thenMatch[1].match(/REQUIRE\s+(\S+)/gi);
      if (requires) {
        for (const req of requires) {
          const field = req.replace(/^REQUIRE\s+/i, "").trim();
          thenRequirements.push(field);
        }
      }
    }

    return { whenConditions, thenRequirements };
  }

  private evaluatePolicyAgainstAction(
    policy: GovernancePolicyEntry,
    actionType: string,
    actionContext: Record<string, any>
  ): PolicyCheckResult {
    const parsed = this.parseRuleDsl(policy.ruleDsl);

    // Check if this policy applies to the current action
    let policyApplies = true;

    for (const [key, value] of Object.entries(parsed.whenConditions)) {
      if (key === "actionType") {
        if (value !== "*" && value !== actionType) {
          policyApplies = false;
          break;
        }
      } else if (key === "jurisdiction") {
        const contextJurisdiction = actionContext.jurisdiction ?? actionContext.state;
        if (value !== "*" && contextJurisdiction && contextJurisdiction !== value) {
          policyApplies = false;
          break;
        }
      } else {
        // Generic context match
        if (value !== "*" && actionContext[key] !== value) {
          policyApplies = false;
          break;
        }
      }
    }

    // If the policy doesn't apply, it's a pass
    if (!policyApplies) {
      return { policyId: policy.policyId, result: "pass", details: "Policy conditions do not match this action" };
    }

    // Check THEN requirements against context
    const missingRequirements: string[] = [];
    for (const req of parsed.thenRequirements) {
      if (!actionContext[req]) {
        missingRequirements.push(req);
      }
    }

    if (missingRequirements.length === 0) {
      return { policyId: policy.policyId, result: "pass", details: "All requirements satisfied" };
    }

    // Determine result based on policy severity
    const result = policy.severity === "block" ? "blocked" : "warning";
    return {
      policyId: policy.policyId,
      result,
      details: `Missing requirements: ${missingRequirements.join(", ")}`,
    };
  }

  // ─── 3. Explain Action — Audit Trail ─────────────────────────────────────────
  async explainAction(data: {
    actionId: string;
    agentCodename: string;
    actionType: string;
    humanReadable: string;
    machineReadable: Record<string, any>;
    evidenceChain: Array<{ source: string; fact: string; weight: number }>;
    modelVersion?: string;
    orgId?: number;
  }) {
    const [explanation] = await db
      .insert(auditExplanations)
      .values({
        actionId: data.actionId,
        agentCodename: data.agentCodename,
        actionType: data.actionType,
        humanReadable: data.humanReadable,
        machineReadable: data.machineReadable,
        evidenceChain: data.evidenceChain,
        modelVersion: data.modelVersion ?? null,
        orgId: data.orgId ?? null,
      })
      .returning();

    return explanation;
  }

  // ─── 4. Get Explanation ──────────────────────────────────────────────────────
  async getExplanation(actionId: string) {
    const [explanation] = await db
      .select()
      .from(auditExplanations)
      .where(eq(auditExplanations.actionId, actionId))
      .limit(1);

    return explanation ?? null;
  }

  // ─── 5. Generate Compliance Snapshot ─────────────────────────────────────────
  async generateComplianceSnapshot(orgId: number, period: string) {
    // Get all evaluations for this org in the period
    const evaluations = await db
      .select()
      .from(policyEvaluations)
      .where(
        and(
          eq(policyEvaluations.orgId, orgId),
          sql`to_char(${policyEvaluations.createdAt}, 'YYYY-MM') = ${period}`
        )
      );

    // Aggregate metrics by category using checked policies
    const metricsByCategory: Record<string, { total: number; passed: number; violations: number }> = {};
    const violations: Array<{ policyId: string; actionId: string; severity: string; date: string }> = [];

    for (const evaluation of evaluations) {
      const checks = (evaluation.policiesChecked ?? []) as PolicyCheckResult[];
      for (const check of checks) {
        // Look up the policy to get its category
        const [policy] = await db
          .select()
          .from(governancePolicies)
          .where(eq(governancePolicies.policyId, check.policyId))
          .limit(1);

        const category = policy?.category ?? "unknown";

        if (!metricsByCategory[category]) {
          metricsByCategory[category] = { total: 0, passed: 0, violations: 0 };
        }
        metricsByCategory[category].total++;

        if (check.result === "pass") {
          metricsByCategory[category].passed++;
        } else {
          metricsByCategory[category].violations++;
          violations.push({
            policyId: check.policyId,
            actionId: evaluation.actionId,
            severity: check.result === "blocked" ? "block" : "warning",
            date: evaluation.createdAt?.toISOString() ?? new Date().toISOString(),
          });
        }
      }
    }

    // Calculate overall score: 100 - (violation_percentage * 100)
    let totalChecks = 0;
    let totalViolations = 0;
    for (const m of Object.values(metricsByCategory)) {
      totalChecks += m.total;
      totalViolations += m.violations;
    }
    const violationPercentage = totalChecks > 0 ? totalViolations / totalChecks : 0;
    const overallScore = Math.round(100 - violationPercentage * 100);

    const [snapshot] = await db
      .insert(complianceSnapshots)
      .values({
        orgId,
        period,
        metricsByCategory,
        violations,
        overallScore,
      })
      .returning();

    return snapshot;
  }

  // ─── 6. Get Compliance History ───────────────────────────────────────────────
  async getComplianceHistory(orgId: number, limit = 12) {
    const snapshots = await db
      .select()
      .from(complianceSnapshots)
      .where(eq(complianceSnapshots.orgId, orgId))
      .orderBy(desc(complianceSnapshots.period))
      .limit(limit);

    return snapshots;
  }

  // ─── 7. Run Sandbox ─────────────────────────────────────────────────────────
  async runSandbox(data: {
    strategyId?: string;
    agentCodename?: string;
    simulatedActions: Array<{ action: string; context: Record<string, any> }>;
    orgId?: number;
  }) {
    const sandboxId = crypto.randomUUID();
    const now = new Date();

    // Get all active policies
    const activePolicies = await db
      .select()
      .from(governancePolicies)
      .where(
        and(
          eq(governancePolicies.isActive, true),
          sql`${governancePolicies.effectiveDate} <= ${now}`,
          sql`(${governancePolicies.sunsetDate} IS NULL OR ${governancePolicies.sunsetDate} > ${now})`
        )
      );

    const policyViolationsFound: Array<{ policyId: string; action: string; details: string }> = [];

    // Evaluate each simulated action against all policies
    for (const simAction of data.simulatedActions) {
      for (const policy of activePolicies) {
        const result = this.evaluatePolicyAgainstAction(
          policy,
          simAction.action,
          simAction.context
        );
        if (result.result !== "pass") {
          policyViolationsFound.push({
            policyId: result.policyId,
            action: simAction.action,
            details: result.details ?? `${result.result} on policy ${policy.name}`,
          });
        }
      }
    }

    const totalSimulated = data.simulatedActions.length;
    const totalViolations = policyViolationsFound.length;

    // Generate recommendation based on violation density
    let recommendation: string;
    if (totalViolations === 0) {
      recommendation = "All simulated actions passed governance checks. Strategy is safe to deploy.";
    } else if (totalViolations <= totalSimulated * 0.1) {
      recommendation = `Low violation rate (${totalViolations}/${totalSimulated}). Minor adjustments recommended before deployment.`;
    } else if (totalViolations <= totalSimulated * 0.3) {
      recommendation = `Moderate violation rate (${totalViolations}/${totalSimulated}). Review flagged actions and update strategy before deployment.`;
    } else {
      recommendation = `High violation rate (${totalViolations}/${totalSimulated}). Strategy requires significant revision. Do NOT deploy.`;
    }

    const [run] = await db
      .insert(regulatorySandboxRuns)
      .values({
        sandboxId,
        strategyId: data.strategyId ?? null,
        agentCodename: data.agentCodename ?? null,
        simulatedActions: data.simulatedActions,
        policyViolationsFound,
        totalSimulated,
        totalViolations,
        recommendation,
        orgId: data.orgId ?? null,
      })
      .returning();

    return run;
  }

  // ─── 8. Get Policies ────────────────────────────────────────────────────────
  async getPolicies(category?: string, jurisdiction?: string, activeOnly?: boolean) {
    const conditions = [];

    if (category) {
      conditions.push(eq(governancePolicies.category, category));
    }
    if (jurisdiction) {
      conditions.push(eq(governancePolicies.jurisdiction, jurisdiction));
    }
    if (activeOnly) {
      conditions.push(eq(governancePolicies.isActive, true));
    }

    const policies = await db
      .select()
      .from(governancePolicies)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(governancePolicies.createdAt));

    return policies;
  }

  // ─── 9. Update Policy ───────────────────────────────────────────────────────
  async updatePolicy(
    policyId: string,
    updates: {
      name?: string;
      ruleDsl?: string;
      ruleConfig?: Record<string, any>;
      severity?: string;
      isActive?: boolean;
      sunsetDate?: Date;
    }
  ) {
    const updateData: Record<string, any> = {};
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.ruleDsl !== undefined) updateData.ruleDsl = updates.ruleDsl;
    if (updates.ruleConfig !== undefined) updateData.ruleConfig = updates.ruleConfig;
    if (updates.severity !== undefined) updateData.severity = updates.severity;
    if (updates.isActive !== undefined) updateData.isActive = updates.isActive;
    if (updates.sunsetDate !== undefined) updateData.sunsetDate = updates.sunsetDate;

    const [policy] = await db
      .update(governancePolicies)
      .set(updateData)
      .where(eq(governancePolicies.policyId, policyId))
      .returning();

    return policy ?? null;
  }

  // ─── 10. Get Violation Trends ───────────────────────────────────────────────
  async getViolationTrends(orgId: number, periods = 6) {
    const snapshots = await db
      .select()
      .from(complianceSnapshots)
      .where(eq(complianceSnapshots.orgId, orgId))
      .orderBy(desc(complianceSnapshots.period))
      .limit(periods);

    // Reverse to chronological order
    const chronological = snapshots.reverse();

    const trends = chronological.map((snapshot, idx) => {
      const violationCount = (snapshot.violations as any[])?.length ?? 0;
      const prevViolationCount =
        idx > 0 ? ((chronological[idx - 1].violations as any[])?.length ?? 0) : null;

      let direction: "up" | "down" | "flat" | "initial" = "initial";
      if (prevViolationCount !== null) {
        if (violationCount > prevViolationCount) direction = "up";
        else if (violationCount < prevViolationCount) direction = "down";
        else direction = "flat";
      }

      return {
        period: snapshot.period,
        violations: violationCount,
        score: snapshot.overallScore,
        direction,
      };
    });

    return trends;
  }

  // ─── 11. Get Stats ──────────────────────────────────────────────────────────
  async getStats(orgId?: number) {
    // Total and active policies
    const allPolicies = await db.select().from(governancePolicies);
    const totalPolicies = allPolicies.length;
    const activePolicies = allPolicies.filter((p) => p.isActive).length;

    // Evaluations with result breakdown
    const evalConditions = orgId ? eq(policyEvaluations.orgId, orgId) : undefined;
    const evaluations = await db
      .select()
      .from(policyEvaluations)
      .where(evalConditions);

    const evalCounts = { pass: 0, warning: 0, blocked: 0 };
    for (const ev of evaluations) {
      if (ev.overallResult === "pass") evalCounts.pass++;
      else if (ev.overallResult === "warning") evalCounts.warning++;
      else if (ev.overallResult === "blocked") evalCounts.blocked++;
    }

    // Latest compliance score
    const snapshotConditions = orgId ? eq(complianceSnapshots.orgId, orgId) : undefined;
    const [latestSnapshot] = await db
      .select()
      .from(complianceSnapshots)
      .where(snapshotConditions)
      .orderBy(desc(complianceSnapshots.period))
      .limit(1);

    const complianceScore = latestSnapshot?.overallScore ?? null;

    // Sandbox runs
    const sandboxConditions = orgId ? eq(regulatorySandboxRuns.orgId, orgId) : undefined;
    const sandboxRuns = await db
      .select()
      .from(regulatorySandboxRuns)
      .where(sandboxConditions);

    // Average compliance score across all snapshots
    const allSnapshots = await db
      .select()
      .from(complianceSnapshots)
      .where(snapshotConditions);

    const avgScore =
      allSnapshots.length > 0
        ? Math.round(allSnapshots.reduce((sum, s) => sum + s.overallScore, 0) / allSnapshots.length)
        : null;

    return {
      totalPolicies,
      activePolicies,
      evaluations: {
        total: evaluations.length,
        ...evalCounts,
      },
      complianceScore,
      sandboxRuns: sandboxRuns.length,
      avgScore,
    };
  }
}

export const governanceBrainService = new GovernanceBrainService();

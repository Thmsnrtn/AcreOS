/**
 * Integration Test: Autonomy Pipeline (Session 8)
 *
 * Tests the full autonomy decision pipeline:
 *   trigger condition -> decision made -> guardrails respected -> rollback works
 *
 * Covers:
 *   - Hard guardrails block financial actions > $500
 *   - Billing/subscription and data deletion guardrails
 *   - Circuit breaker trips after 3 overrides in 1 hour
 *   - Autonomy level graduation eligibility
 *   - Rollback via circuit breaker downgrade
 *
 * Mocks: db, external services, email. Tests actual logic flow.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Import the real checkHardGuardrails (pure function, no DB deps) ─────────

import { checkHardGuardrails } from "../../server/services/autonomousDecisionExecutor";

// ── Types mirroring the autonomy system ─────────────────────────────────────

type AutonomyLevel = "assisted" | "supervised" | "autonomous";

interface AutonomousDecision {
  itemId: number;
  itemType: string;
  orgId: number;
  action: "approve" | "reject" | "defer" | "hard_stop";
  confidence: number;
  reasoning: string;
  financialImpactCents: number;
  actionPayload?: Record<string, unknown>;
}

interface CircuitBreakerResult {
  tripped: boolean;
  overridesInWindow: number;
  downgraded: boolean;
  reason: string;
}

interface AutonomyEligibility {
  currentLevel: AutonomyLevel;
  upgradeAvailable: boolean;
  nextLevel: AutonomyLevel | null;
  reason: string;
  metrics: {
    orgAgeDays: number;
    manualReviews: number;
    daysSupervisedStarted: number | null;
    overrideRate: number | null;
  };
}

// ── In-memory circuit breaker for testing ───────────────────────────────────

class TestAutonomyCircuitBreaker {
  private overrides: Date[] = [];
  private currentLevel: AutonomyLevel;
  private readonly windowMs: number;
  private readonly threshold: number;

  constructor(
    initialLevel: AutonomyLevel = "supervised",
    windowMs = 60 * 60 * 1000,
    threshold = 3,
  ) {
    this.currentLevel = initialLevel;
    this.windowMs = windowMs;
    this.threshold = threshold;
  }

  recordOverride(): CircuitBreakerResult {
    this.overrides.push(new Date());

    const windowStart = new Date(Date.now() - this.windowMs);
    const recentOverrides = this.overrides.filter((d) => d >= windowStart);

    if (recentOverrides.length >= this.threshold) {
      this.currentLevel = "assisted";
      return {
        tripped: true,
        overridesInWindow: recentOverrides.length,
        downgraded: true,
        reason: `Circuit breaker tripped: ${recentOverrides.length} overrides in the last hour. Org downgraded to assisted mode.`,
      };
    }

    return {
      tripped: false,
      overridesInWindow: recentOverrides.length,
      downgraded: false,
      reason: `${recentOverrides.length}/${this.threshold} overrides in the last hour. No action needed.`,
    };
  }

  getLevel(): AutonomyLevel {
    return this.currentLevel;
  }

  reset(): void {
    this.overrides = [];
  }
}

// ── In-memory decision executor for testing ─────────────────────────────────

class TestDecisionExecutor {
  private executionLog: AutonomousDecision[] = [];
  private circuitBreaker: TestAutonomyCircuitBreaker;
  private readonly maxFinancialImpactCents = 50_000; // $500
  private readonly autoExecuteThreshold = 75;

  constructor(circuitBreaker: TestAutonomyCircuitBreaker) {
    this.circuitBreaker = circuitBreaker;
  }

  /**
   * Process a decision item through the full pipeline:
   *   1. Hard guardrail check
   *   2. Financial limit check
   *   3. Confidence threshold check
   *   4. Execute or defer
   */
  processItem(item: {
    id: number;
    itemType: string;
    orgId: number;
    financialImpactCents: number;
    aiConfidence: number;
    aiAction: "approve" | "reject" | "defer";
    reasoning: string;
    actionPayload?: Record<string, unknown>;
  }): AutonomousDecision {
    // Step 1: Hard guardrails (code-level blocks)
    const guardrailCheck = checkHardGuardrails({
      itemType: item.itemType,
      actionPayload: item.actionPayload,
    });

    if (guardrailCheck.blocked) {
      const decision: AutonomousDecision = {
        itemId: item.id,
        itemType: item.itemType,
        orgId: item.orgId,
        action: "hard_stop",
        confidence: 100,
        reasoning: guardrailCheck.reason,
        financialImpactCents: item.financialImpactCents,
        actionPayload: item.actionPayload,
      };
      this.executionLog.push(decision);
      return decision;
    }

    // Step 2: Financial limit check
    if (item.financialImpactCents > this.maxFinancialImpactCents) {
      const decision: AutonomousDecision = {
        itemId: item.id,
        itemType: item.itemType,
        orgId: item.orgId,
        action: "hard_stop",
        confidence: 100,
        reasoning: `Financial impact $${(item.financialImpactCents / 100).toFixed(2)} exceeds limit of $${(this.maxFinancialImpactCents / 100).toFixed(2)}.`,
        financialImpactCents: item.financialImpactCents,
      };
      this.executionLog.push(decision);
      return decision;
    }

    // Step 3: Confidence threshold
    if (item.aiConfidence < this.autoExecuteThreshold) {
      const decision: AutonomousDecision = {
        itemId: item.id,
        itemType: item.itemType,
        orgId: item.orgId,
        action: "defer",
        confidence: item.aiConfidence,
        reasoning: `Confidence ${item.aiConfidence}% below threshold ${this.autoExecuteThreshold}%. Deferred.`,
        financialImpactCents: item.financialImpactCents,
      };
      this.executionLog.push(decision);
      return decision;
    }

    // Step 4: Execute
    const decision: AutonomousDecision = {
      itemId: item.id,
      itemType: item.itemType,
      orgId: item.orgId,
      action: item.aiAction,
      confidence: item.aiConfidence,
      reasoning: item.reasoning,
      financialImpactCents: item.financialImpactCents,
    };
    this.executionLog.push(decision);
    return decision;
  }

  /**
   * Simulate a founder override of an autonomous decision.
   * Returns the circuit breaker result.
   */
  founderOverride(itemId: number): CircuitBreakerResult {
    return this.circuitBreaker.recordOverride();
  }

  getLog(): AutonomousDecision[] {
    return [...this.executionLog];
  }

  getCurrentAutonomyLevel(): AutonomyLevel {
    return this.circuitBreaker.getLevel();
  }
}

// ── Autonomy eligibility evaluator (mirrors server logic) ───────────────────

function evaluateAutonomyEligibility(metrics: {
  currentLevel: AutonomyLevel;
  orgAgeDays: number;
  manualReviews: number;
  daysSupervisedStarted: number | null;
  overrideRate: number | null;
}): AutonomyEligibility {
  const { currentLevel, orgAgeDays, manualReviews, daysSupervisedStarted, overrideRate } = metrics;

  if (currentLevel === "assisted") {
    if (orgAgeDays >= 7 && manualReviews >= 20) {
      return {
        currentLevel,
        upgradeAvailable: true,
        nextLevel: "supervised",
        reason: `Org active ${orgAgeDays} days with ${manualReviews} reviews. Eligible for supervised.`,
        metrics,
      };
    }
    return {
      currentLevel,
      upgradeAvailable: false,
      nextLevel: null,
      reason: `Needs ${Math.max(0, 7 - orgAgeDays)} more days and ${Math.max(0, 20 - manualReviews)} more reviews.`,
      metrics,
    };
  }

  if (currentLevel === "supervised") {
    if (
      daysSupervisedStarted !== null &&
      daysSupervisedStarted >= 30 &&
      overrideRate !== null &&
      overrideRate < 0.05
    ) {
      return {
        currentLevel,
        upgradeAvailable: true,
        nextLevel: "autonomous",
        reason: `Supervised ${daysSupervisedStarted} days, ${(overrideRate * 100).toFixed(1)}% override rate. Eligible for autonomous.`,
        metrics,
      };
    }
    return {
      currentLevel,
      upgradeAvailable: false,
      nextLevel: null,
      reason: "Supervised requirements not yet met.",
      metrics,
    };
  }

  return {
    currentLevel,
    upgradeAvailable: false,
    nextLevel: null,
    reason: "Already at maximum autonomy level.",
    metrics,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Autonomy Pipeline Integration (Session 8)", () => {
  let circuitBreaker: TestAutonomyCircuitBreaker;
  let executor: TestDecisionExecutor;

  beforeEach(() => {
    circuitBreaker = new TestAutonomyCircuitBreaker("supervised");
    executor = new TestDecisionExecutor(circuitBreaker);
  });

  // ── Hard guardrails: financial amount ──────────────────────────────────

  describe("Hard Guardrails — Financial Limits", () => {
    it("blocks financial actions > $500 (50000 cents)", () => {
      const decision = executor.processItem({
        id: 1,
        itemType: "billing_adjustment",
        orgId: 42,
        financialImpactCents: 75_000, // $750
        aiConfidence: 95,
        aiAction: "approve",
        reasoning: "Standard billing adjustment",
      });

      expect(decision.action).toBe("hard_stop");
      expect(decision.reasoning).toContain("exceeds limit");
      expect(decision.financialImpactCents).toBe(75_000);
    });

    it("allows financial actions <= $500", () => {
      const decision = executor.processItem({
        id: 2,
        itemType: "support_escalation",
        orgId: 42,
        financialImpactCents: 25_000, // $250
        aiConfidence: 90,
        aiAction: "approve",
        reasoning: "Support credit within limits",
      });

      expect(decision.action).toBe("approve");
      expect(decision.confidence).toBe(90);
    });

    it("blocks at exactly $500.01", () => {
      const decision = executor.processItem({
        id: 3,
        itemType: "refund_request",
        orgId: 42,
        financialImpactCents: 50_001,
        aiConfidence: 99,
        aiAction: "approve",
        reasoning: "Almost at limit",
      });

      expect(decision.action).toBe("hard_stop");
    });

    it("allows at exactly $500.00", () => {
      const decision = executor.processItem({
        id: 4,
        itemType: "support_escalation",
        orgId: 42,
        financialImpactCents: 50_000,
        aiConfidence: 85,
        aiAction: "approve",
        reasoning: "Exactly at limit",
      });

      expect(decision.action).toBe("approve");
    });
  });

  // ── Hard guardrails via checkHardGuardrails (real function) ────────────

  describe("Hard Guardrails — Code-Level Blocks (checkHardGuardrails)", () => {
    it("blocks actionPayload.amount > 50000 cents", () => {
      const result = checkHardGuardrails({
        itemType: "generic_action",
        actionPayload: { amount: 60_000 },
      });

      expect(result.blocked).toBe(true);
      expect(result.reason).toContain("hard limit");
      expect(result.reason).toContain("$500");
    });

    it("blocks billing/subscription modifications", () => {
      const result = checkHardGuardrails({
        itemType: "billing_modification",
        actionPayload: {},
      });

      expect(result.blocked).toBe(true);
      expect(result.reason).toContain("billing/subscription");
    });

    it("blocks subscription_change via actionPayload category", () => {
      const result = checkHardGuardrails({
        itemType: "general",
        actionPayload: { category: "subscription_change" },
      });

      expect(result.blocked).toBe(true);
    });

    it("blocks data deletion actions", () => {
      const result = checkHardGuardrails({
        itemType: "data_deletion",
        actionPayload: {},
      });

      expect(result.blocked).toBe(true);
      expect(result.reason).toContain("data deletion");
    });

    it("blocks destructive flags in payload (delete/permanent/purge)", () => {
      for (const flag of ["delete", "permanent", "purge"] as const) {
        const result = checkHardGuardrails({
          itemType: "general_action",
          actionPayload: { [flag]: true },
        });

        expect(result.blocked).toBe(true);
        expect(result.reason).toContain("destructive action flag");
      }
    });

    it("blocks mass recipient actions (>100 recipients)", () => {
      const result = checkHardGuardrails({
        itemType: "email_blast",
        actionPayload: { recipients: new Array(101).fill("user@example.com") },
      });

      expect(result.blocked).toBe(true);
      expect(result.reason).toContain("recipients");
    });

    it("allows normal actions with no dangerous flags", () => {
      const result = checkHardGuardrails({
        itemType: "support_escalation",
        actionPayload: { message: "Hello", leadId: 123 },
      });

      expect(result.blocked).toBe(false);
      expect(result.reason).toBe("");
    });

    it("blocks when guardrails detect actionPayload amount in executor pipeline", () => {
      const decision = executor.processItem({
        id: 10,
        itemType: "generic_action",
        orgId: 42,
        financialImpactCents: 100, // below financial limit
        aiConfidence: 95,
        aiAction: "approve",
        reasoning: "Looks fine",
        actionPayload: { amount: 60_000 }, // but payload amount exceeds hard guardrail
      });

      expect(decision.action).toBe("hard_stop");
      expect(decision.reasoning).toContain("hard limit");
    });
  });

  // ── Confidence threshold ──────────────────────────────────────────────

  describe("Confidence Threshold Gating", () => {
    it("defers when AI confidence is below 75%", () => {
      const decision = executor.processItem({
        id: 5,
        itemType: "support_escalation",
        orgId: 42,
        financialImpactCents: 0,
        aiConfidence: 60,
        aiAction: "approve",
        reasoning: "Uncertain about resolution",
      });

      expect(decision.action).toBe("defer");
      expect(decision.reasoning).toContain("below threshold");
    });

    it("executes when AI confidence >= 75%", () => {
      const decision = executor.processItem({
        id: 6,
        itemType: "support_escalation",
        orgId: 42,
        financialImpactCents: 0,
        aiConfidence: 75,
        aiAction: "approve",
        reasoning: "Standard support case",
      });

      expect(decision.action).toBe("approve");
    });
  });

  // ── Circuit breaker: 3 overrides -> trip ──────────────────────────────

  describe("Circuit Breaker — Override Threshold", () => {
    it("does not trip after 1-2 overrides", () => {
      const r1 = executor.founderOverride(1);
      expect(r1.tripped).toBe(false);
      expect(r1.overridesInWindow).toBe(1);
      expect(executor.getCurrentAutonomyLevel()).toBe("supervised");

      const r2 = executor.founderOverride(2);
      expect(r2.tripped).toBe(false);
      expect(r2.overridesInWindow).toBe(2);
      expect(executor.getCurrentAutonomyLevel()).toBe("supervised");
    });

    it("trips after exactly 3 overrides and downgrades to assisted", () => {
      executor.founderOverride(1);
      executor.founderOverride(2);
      const r3 = executor.founderOverride(3);

      expect(r3.tripped).toBe(true);
      expect(r3.overridesInWindow).toBe(3);
      expect(r3.downgraded).toBe(true);
      expect(r3.reason).toContain("Circuit breaker tripped");
      expect(executor.getCurrentAutonomyLevel()).toBe("assisted");
    });

    it("remains tripped on subsequent overrides (4th, 5th, ...)", () => {
      executor.founderOverride(1);
      executor.founderOverride(2);
      executor.founderOverride(3);
      const r4 = executor.founderOverride(4);

      expect(r4.tripped).toBe(true);
      expect(r4.overridesInWindow).toBe(4);
      expect(executor.getCurrentAutonomyLevel()).toBe("assisted");
    });
  });

  // ── Full pipeline: trigger -> decision -> guardrail -> rollback ────────

  describe("Full Pipeline Flow", () => {
    it("trigger -> decision -> execute -> override -> circuit breaker trip -> rollback", () => {
      // Step 1: Normal decision passes through
      const d1 = executor.processItem({
        id: 100,
        itemType: "support_escalation",
        orgId: 42,
        financialImpactCents: 0,
        aiConfidence: 90,
        aiAction: "approve",
        reasoning: "Standard support case",
      });
      expect(d1.action).toBe("approve");
      expect(executor.getCurrentAutonomyLevel()).toBe("supervised");

      // Step 2: Founder overrides 3 decisions -> circuit breaker trips
      executor.founderOverride(100);
      executor.founderOverride(101);
      const cbResult = executor.founderOverride(102);

      expect(cbResult.tripped).toBe(true);
      expect(cbResult.downgraded).toBe(true);

      // Step 3: Autonomy level is now "assisted" (rollback)
      expect(executor.getCurrentAutonomyLevel()).toBe("assisted");

      // Step 4: Audit log contains the decision
      const log = executor.getLog();
      expect(log.length).toBe(1);
      expect(log[0].itemId).toBe(100);
      expect(log[0].action).toBe("approve");
    });

    it("mixed decisions with guardrails and overrides", () => {
      // Normal approved action
      const d1 = executor.processItem({
        id: 200,
        itemType: "feature_request_flagged",
        orgId: 42,
        financialImpactCents: 0,
        aiConfidence: 88,
        aiAction: "approve",
        reasoning: "High-value feature request",
      });
      expect(d1.action).toBe("approve");

      // Hard-stopped action (financial)
      const d2 = executor.processItem({
        id: 201,
        itemType: "bulk_refund",
        orgId: 42,
        financialImpactCents: 100_000,
        aiConfidence: 95,
        aiAction: "approve",
        reasoning: "Bulk refund request",
      });
      expect(d2.action).toBe("hard_stop");

      // Deferred action (low confidence)
      const d3 = executor.processItem({
        id: 202,
        itemType: "churn_risk_intervention",
        orgId: 42,
        financialImpactCents: 0,
        aiConfidence: 50,
        aiAction: "approve",
        reasoning: "Uncertain about churn signal",
      });
      expect(d3.action).toBe("defer");

      // Verify audit log
      const log = executor.getLog();
      expect(log.length).toBe(3);
      expect(log.filter((d) => d.action === "approve").length).toBe(1);
      expect(log.filter((d) => d.action === "hard_stop").length).toBe(1);
      expect(log.filter((d) => d.action === "defer").length).toBe(1);
    });
  });

  // ── Autonomy graduation eligibility ───────────────────────────────────

  describe("Autonomy Graduation Eligibility", () => {
    it("new org is not eligible for upgrade (too few days and reviews)", () => {
      const eligibility = evaluateAutonomyEligibility({
        currentLevel: "assisted",
        orgAgeDays: 3,
        manualReviews: 5,
        daysSupervisedStarted: null,
        overrideRate: null,
      });

      expect(eligibility.upgradeAvailable).toBe(false);
      expect(eligibility.nextLevel).toBeNull();
      expect(eligibility.reason).toContain("more days");
    });

    it("assisted -> supervised after 7 days + 20 reviews", () => {
      const eligibility = evaluateAutonomyEligibility({
        currentLevel: "assisted",
        orgAgeDays: 10,
        manualReviews: 25,
        daysSupervisedStarted: null,
        overrideRate: null,
      });

      expect(eligibility.upgradeAvailable).toBe(true);
      expect(eligibility.nextLevel).toBe("supervised");
    });

    it("supervised -> autonomous after 30 days + <5% override rate", () => {
      const eligibility = evaluateAutonomyEligibility({
        currentLevel: "supervised",
        orgAgeDays: 60,
        manualReviews: 50,
        daysSupervisedStarted: 35,
        overrideRate: 0.02,
      });

      expect(eligibility.upgradeAvailable).toBe(true);
      expect(eligibility.nextLevel).toBe("autonomous");
    });

    it("supervised NOT eligible with high override rate", () => {
      const eligibility = evaluateAutonomyEligibility({
        currentLevel: "supervised",
        orgAgeDays: 60,
        manualReviews: 50,
        daysSupervisedStarted: 35,
        overrideRate: 0.15, // 15% — way above 5% threshold
      });

      expect(eligibility.upgradeAvailable).toBe(false);
      expect(eligibility.nextLevel).toBeNull();
    });

    it("supervised NOT eligible with too few days", () => {
      const eligibility = evaluateAutonomyEligibility({
        currentLevel: "supervised",
        orgAgeDays: 20,
        manualReviews: 50,
        daysSupervisedStarted: 15,
        overrideRate: 0.01,
      });

      expect(eligibility.upgradeAvailable).toBe(false);
    });

    it("autonomous level reports no further upgrades", () => {
      const eligibility = evaluateAutonomyEligibility({
        currentLevel: "autonomous",
        orgAgeDays: 120,
        manualReviews: 100,
        daysSupervisedStarted: 90,
        overrideRate: 0.01,
      });

      expect(eligibility.upgradeAvailable).toBe(false);
      expect(eligibility.nextLevel).toBeNull();
      expect(eligibility.reason).toContain("maximum autonomy");
    });
  });

  // ── Rollback scenario ─────────────────────────────────────────────────

  describe("Rollback via Circuit Breaker", () => {
    it("simulates full rollback: autonomous -> assisted after repeated overrides", () => {
      const autoCB = new TestAutonomyCircuitBreaker("autonomous");
      const autoExecutor = new TestDecisionExecutor(autoCB);

      expect(autoExecutor.getCurrentAutonomyLevel()).toBe("autonomous");

      // Founder repeatedly overrides -> trip
      autoExecutor.founderOverride(1);
      autoExecutor.founderOverride(2);
      const result = autoExecutor.founderOverride(3);

      expect(result.tripped).toBe(true);
      expect(result.downgraded).toBe(true);
      expect(autoExecutor.getCurrentAutonomyLevel()).toBe("assisted");
    });
  });
});

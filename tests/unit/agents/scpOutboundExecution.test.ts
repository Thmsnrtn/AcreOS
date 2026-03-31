import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../server/db", () => ({
  db: { execute: vi.fn().mockResolvedValue({ rows: [] }) },
}));

vi.mock("../../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  submitExecution,
  approveExecution,
  rejectExecution,
  recordOutcome,
  rollbackExecution,
  setAgentTrust,
  getAgentTrust,
  requiresConfirmation,
  getPendingConfirmations,
  getAgentExecutionHistory,
  getExecutionStats,
  getRecentOutcomes,
} from "../../../server/services/scpOutboundExecution";

describe("SCP v3 Outbound Execution Framework", () => {
  describe("Trust & Authority", () => {
    it("defaults to 0.5 trust for unknown agents", () => {
      expect(getAgentTrust("unknown_agent")).toBe(0.5);
    });

    it("sets and retrieves trust scores", () => {
      setAgentTrust("forge_revenue", 0.9);
      expect(getAgentTrust("forge_revenue")).toBe(0.9);
    });

    it("clamps trust to 0-1 range", () => {
      setAgentTrust("test_agent", 1.5);
      expect(getAgentTrust("test_agent")).toBe(1);
      setAgentTrust("test_agent", -0.5);
      expect(getAgentTrust("test_agent")).toBe(0);
    });

    it("level 0 never requires confirmation", () => {
      expect(requiresConfirmation(0, "any_agent")).toBe(false);
    });

    it("level 3 always requires confirmation", () => {
      setAgentTrust("high_trust_agent", 0.99);
      expect(requiresConfirmation(3, "high_trust_agent")).toBe(true);
    });

    it("level 1 requires confirmation only for low-trust agents", () => {
      setAgentTrust("trusted_agent", 0.5);
      expect(requiresConfirmation(1, "trusted_agent")).toBe(false);

      setAgentTrust("untrusted_agent", 0.2);
      expect(requiresConfirmation(1, "untrusted_agent")).toBe(true);
    });

    it("level 2 requires confirmation unless high trust", () => {
      setAgentTrust("moderate_agent", 0.6);
      expect(requiresConfirmation(2, "moderate_agent")).toBe(true);

      setAgentTrust("very_trusted_agent", 0.85);
      expect(requiresConfirmation(2, "very_trusted_agent")).toBe(false);
    });
  });

  describe("Execution Submission", () => {
    it("submits a read-only action without confirmation", () => {
      setAgentTrust("forge_revenue", 0.7);
      const result = submitExecution({
        agent: "forge_revenue",
        integration_id: "stripe",
        action: "read_subscription",
        parameters: { subscription_id: "sub_123" },
        reason: "Check subscription status",
        session_id: "s-test-1",
      });

      expect(result.success).toBe(true);
      expect(result.execution_id).toBeTruthy();
      expect(result.status).toBe("approved");
      expect(result.confirmation_required).toBe(false);
    });

    it("queues high-authority actions for confirmation", () => {
      setAgentTrust("forge_revenue", 0.5); // Moderate trust, level 2 needs confirmation
      const result = submitExecution({
        agent: "forge_revenue",
        integration_id: "stripe",
        action: "create_coupon",
        parameters: { percent_off: 20 },
        reason: "Retention coupon for churning customer",
        session_id: "s-test-2",
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe("pending_confirmation");
      expect(result.confirmation_required).toBe(true);
    });

    it("rejects unauthorized agent/integration combos", () => {
      const result = submitExecution({
        agent: "harbor_csm",
        integration_id: "stripe",
        action: "create_coupon",
        parameters: {},
        reason: "Test",
        session_id: "s-test-3",
      });

      expect(result.success).toBe(false);
      expect(result.rejection_reason).toContain("not authorized");
    });

    it("rejects unknown integrations", () => {
      const result = submitExecution({
        agent: "forge_revenue",
        integration_id: "nonexistent",
        action: "something",
        parameters: {},
        reason: "Test",
        session_id: "s-test-4",
      });

      expect(result.success).toBe(false);
    });
  });

  describe("Confirmation Flow", () => {
    it("approves a pending execution", () => {
      setAgentTrust("forge_revenue", 0.5);
      const submission = submitExecution({
        agent: "forge_revenue",
        integration_id: "stripe",
        action: "create_coupon",
        parameters: { percent_off: 10 },
        reason: "Test approval",
        session_id: "s-test-5",
      });

      const approval = approveExecution(submission.execution_id!);
      expect(approval.success).toBe(true);
    });

    it("rejects a pending execution", () => {
      setAgentTrust("forge_revenue", 0.5);
      const submission = submitExecution({
        agent: "forge_revenue",
        integration_id: "stripe",
        action: "create_coupon",
        parameters: { percent_off: 50 },
        reason: "Test rejection",
        session_id: "s-test-6",
      });

      const rejection = rejectExecution(submission.execution_id!);
      expect(rejection.success).toBe(true);
    });

    it("cannot approve non-existent execution", () => {
      const result = approveExecution("nonexistent-id");
      expect(result.success).toBe(false);
    });

    it("cannot approve already-approved execution", () => {
      setAgentTrust("forge_revenue", 0.5);
      const submission = submitExecution({
        agent: "forge_revenue",
        integration_id: "stripe",
        action: "create_coupon",
        parameters: {},
        reason: "Test double approve",
        session_id: "s-test-7",
      });

      approveExecution(submission.execution_id!);
      const secondApproval = approveExecution(submission.execution_id!);
      expect(secondApproval.success).toBe(false);
      expect(secondApproval.reason).toContain("Cannot approve");
    });

    it("lists pending confirmations", () => {
      const pending = getPendingConfirmations();
      // All pending should have future expiry
      for (const p of pending) {
        expect(new Date(p.expires_at).getTime()).toBeGreaterThan(Date.now());
      }
    });
  });

  describe("Outcome Recording", () => {
    it("records successful outcomes", () => {
      setAgentTrust("forge_revenue", 0.9);
      const submission = submitExecution({
        agent: "forge_revenue",
        integration_id: "stripe",
        action: "read_subscription",
        parameters: { id: "sub_123" },
        reason: "Check status",
        session_id: "s-test-8",
      });

      const outcome = recordOutcome({
        request_id: submission.execution_id!,
        success: true,
        output: { status: "active", plan: "pro" },
        duration_ms: 150,
        side_effects: [],
      });

      expect(outcome.success).toBe(true);
      expect(outcome.duration_ms).toBe(150);
      expect(outcome.rollback_available).toBe(false);
    });

    it("records failed outcomes", () => {
      setAgentTrust("forge_revenue", 0.9);
      const submission = submitExecution({
        agent: "forge_revenue",
        integration_id: "stripe",
        action: "read_subscription",
        parameters: { id: "sub_bad" },
        reason: "Check status",
        session_id: "s-test-9",
      });

      const outcome = recordOutcome({
        request_id: submission.execution_id!,
        success: false,
        output: {},
        duration_ms: 50,
        error: "Subscription not found",
        side_effects: [],
      });

      expect(outcome.success).toBe(false);
      expect(outcome.error).toContain("not found");
    });

    it("registers rollback functions", () => {
      setAgentTrust("forge_revenue", 0.9);
      const submission = submitExecution({
        agent: "forge_revenue",
        integration_id: "stripe",
        action: "read_subscription",
        parameters: {},
        reason: "Test rollback",
        session_id: "s-test-10",
      });

      const outcome = recordOutcome({
        request_id: submission.execution_id!,
        success: true,
        output: { coupon_id: "cpn_123" },
        duration_ms: 200,
        side_effects: ["Created coupon cpn_123"],
        rollback_fn: async () => { /* delete coupon */ },
      });

      expect(outcome.rollback_available).toBe(true);
    });
  });

  describe("Rollback", () => {
    it("executes rollback for available actions", async () => {
      let rolledBack = false;
      setAgentTrust("forge_revenue", 0.9);
      const submission = submitExecution({
        agent: "forge_revenue",
        integration_id: "stripe",
        action: "read_subscription",
        parameters: {},
        reason: "Test rollback exec",
        session_id: "s-test-11",
      });

      recordOutcome({
        request_id: submission.execution_id!,
        success: true,
        output: {},
        duration_ms: 100,
        side_effects: [],
        rollback_fn: async () => { rolledBack = true; },
      });

      const result = await rollbackExecution(submission.execution_id!);
      expect(result.success).toBe(true);
      expect(rolledBack).toBe(true);
    });

    it("fails gracefully when no rollback available", async () => {
      const result = await rollbackExecution("nonexistent-id");
      expect(result.success).toBe(false);
      expect(result.reason).toContain("No rollback");
    });
  });

  describe("Stats & History", () => {
    it("returns execution stats", () => {
      const stats = getExecutionStats();
      expect(stats.total_requests).toBeGreaterThan(0);
      expect(stats.by_status).toBeDefined();
      expect(stats.by_agent).toBeDefined();
    });

    it("returns agent execution history", () => {
      const history = getAgentExecutionHistory("forge_revenue");
      expect(history.length).toBeGreaterThan(0);
      expect(history.every((r) => r.agent === "forge_revenue")).toBe(true);
    });

    it("returns recent outcomes for evolution feedback", () => {
      const outcomes = getRecentOutcomes("forge_revenue");
      expect(outcomes.length).toBeGreaterThan(0);
      expect(outcomes[0]).toHaveProperty("action");
      expect(outcomes[0]).toHaveProperty("integration_id");
    });
  });
});

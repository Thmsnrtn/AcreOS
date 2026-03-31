import { describe, it, expect, vi } from "vitest";

vi.mock("../../../server/db", () => ({
  db: { execute: vi.fn().mockResolvedValue({ rows: [] }) },
}));

vi.mock("../../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  createCustomerProfile,
  getCustomerProfile,
  getCustomerByExternalId,
  updateCustomerProfile,
  calculateHealthScore,
  refreshHealthScore,
  transitionStage,
  addCustomerSignal,
  createAutomationRule,
  listAutomationRules,
  toggleAutomationRule,
  evaluateAutomationRules,
  recordRuleExecution,
  getLifecycleFunnel,
  getCustomersByStage,
  getAtRiskCustomers,
  getExpansionCandidates,
  getAutomationStats,
} from "../../../server/services/scpCustomerLifecycle";

describe("SCP v3 Customer Lifecycle Engine", () => {
  describe("Customer Profiles", () => {
    it("creates a customer profile with defaults", () => {
      const profile = createCustomerProfile({
        external_id: "cus_stripe_1",
        name: "Acme Corp",
        email: "admin@acme.com",
      });

      expect(profile.id).toBeTruthy();
      expect(profile.stage).toBe("acquisition");
      expect(profile.health_score).toBe(50);
      expect(profile.churn_risk).toBe(0.1);
      expect(profile.plan).toBe("free");
    });

    it("creates a profile with custom plan and MRR", () => {
      const profile = createCustomerProfile({
        external_id: "cus_stripe_2",
        name: "Big Co",
        email: "admin@bigco.com",
        plan: "pro",
        mrr_usd: 99,
      });

      expect(profile.plan).toBe("pro");
      expect(profile.mrr_usd).toBe(99);
    });

    it("retrieves profile by ID", () => {
      const created = createCustomerProfile({
        external_id: "cus_stripe_3",
        name: "Test Co",
        email: "test@test.com",
      });

      const retrieved = getCustomerProfile(created.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.name).toBe("Test Co");
    });

    it("retrieves profile by external ID", () => {
      createCustomerProfile({
        external_id: "cus_ext_lookup",
        name: "Lookup Co",
        email: "lookup@co.com",
      });

      const found = getCustomerByExternalId("cus_ext_lookup");
      expect(found).toBeDefined();
      expect(found!.name).toBe("Lookup Co");
    });

    it("updates profile fields", () => {
      const profile = createCustomerProfile({
        external_id: "cus_update",
        name: "Update Co",
        email: "update@co.com",
      });

      const updated = updateCustomerProfile(profile.id, {
        plan: "enterprise",
        mrr_usd: 499,
        nps_score: 9,
      });

      expect(updated!.plan).toBe("enterprise");
      expect(updated!.mrr_usd).toBe(499);
      expect(updated!.nps_score).toBe(9);
    });
  });

  describe("Health Score", () => {
    it("calculates base health score", () => {
      const score = calculateHealthScore({
        activity_recency_days: 1,
        feature_adoption_pct: 60,
        support_tickets_open: 0,
        nps_score: 9,
        payment_failures: 0,
        login_frequency_weekly: 5,
      });

      // 50 base + 20 (adoption>50) + 15 (nps>=9) + 10 (login>=5) = 95
      expect(score).toBe(95);
    });

    it("penalizes inactivity", () => {
      const score = calculateHealthScore({
        activity_recency_days: 28,
        feature_adoption_pct: 30,
        support_tickets_open: 0,
        nps_score: null,
        payment_failures: 0,
        login_frequency_weekly: 0,
      });

      // 50 base + 10 (adoption>25) - 30 (3 weeks of inactivity penalty) = 30
      expect(score).toBe(30);
    });

    it("penalizes payment failures heavily", () => {
      const score = calculateHealthScore({
        activity_recency_days: 1,
        feature_adoption_pct: 60,
        support_tickets_open: 0,
        nps_score: null,
        payment_failures: 2,
        login_frequency_weekly: 5,
      });

      // 50 + 20 - 40 + 10 = 40
      expect(score).toBe(40);
    });

    it("clamps score to 0-100", () => {
      const low = calculateHealthScore({
        activity_recency_days: 60,
        feature_adoption_pct: 0,
        support_tickets_open: 5,
        nps_score: 1,
        payment_failures: 3,
        login_frequency_weekly: 0,
      });
      expect(low).toBe(0);
    });

    it("refreshes health and derives churn risk", () => {
      const profile = createCustomerProfile({
        external_id: "cus_health",
        name: "Health Co",
        email: "health@co.com",
      });

      const updated = refreshHealthScore(profile.id, {
        activity_recency_days: 1,
        feature_adoption_pct: 70,
        support_tickets_open: 0,
        nps_score: 10,
        payment_failures: 0,
        login_frequency_weekly: 7,
      });

      expect(updated!.health_score).toBeGreaterThan(80);
      expect(updated!.churn_risk).toBe(0.05);
    });
  });

  describe("Stage Transitions", () => {
    it("transitions customer to new stage", () => {
      const profile = createCustomerProfile({
        external_id: "cus_transition",
        name: "Stage Co",
        email: "stage@co.com",
      });

      const result = transitionStage(profile.id, "activation", "Completed onboarding", "harbor_csm");
      expect(result.success).toBe(true);
      expect(result.previous_stage).toBe("acquisition");

      const updated = getCustomerProfile(profile.id);
      expect(updated!.stage).toBe("activation");
    });

    it("marks activation completed on revenue transition", () => {
      const profile = createCustomerProfile({
        external_id: "cus_activate",
        name: "Activate Co",
        email: "activate@co.com",
      });

      transitionStage(profile.id, "revenue", "First payment", "forge_revenue");
      const updated = getCustomerProfile(profile.id);
      expect(updated!.activation_completed).toBe(true);
    });

    it("records transition signal", () => {
      const profile = createCustomerProfile({
        external_id: "cus_signal",
        name: "Signal Co",
        email: "signal@co.com",
      });

      transitionStage(profile.id, "retention", "Renewed", "harbor_csm");
      const updated = getCustomerProfile(profile.id);
      expect(updated!.signals.some((s) => s.type === "stage_transition")).toBe(true);
    });

    it("fails for non-existent customer", () => {
      const result = transitionStage("nonexistent", "activation", "Test", "oracle");
      expect(result.success).toBe(false);
    });
  });

  describe("Customer Signals", () => {
    it("adds signal to customer", () => {
      const profile = createCustomerProfile({
        external_id: "cus_signals",
        name: "Signals Co",
        email: "signals@co.com",
      });

      const added = addCustomerSignal(profile.id, {
        type: "feature_request",
        value: "API access",
        source: "support_ticket",
        agent: "harbor_csm",
      });

      expect(added).toBe(true);
      const updated = getCustomerProfile(profile.id);
      expect(updated!.signals.some((s) => s.type === "feature_request")).toBe(true);
    });
  });

  describe("Automation Rules", () => {
    it("creates an automation rule", () => {
      const rule = createAutomationRule({
        name: "Churn risk alert",
        stage: "retention",
        trigger: { type: "churn_risk", conditions: { threshold: 0.6 } },
        actions: [{ type: "notify_agent", parameters: { agent: "harbor_csm" } }],
        assigned_agents: ["harbor_csm"],
      });

      expect(rule.id).toBeTruthy();
      expect(rule.enabled).toBe(true);
      expect(rule.version).toBe(1);
    });

    it("lists rules by stage", () => {
      createAutomationRule({
        name: "Activation nudge",
        stage: "activation",
        trigger: { type: "inactivity", conditions: { days: 3 } },
        actions: [{ type: "send_email", parameters: { template: "activation_nudge" } }],
        assigned_agents: ["beacon_marketing"],
      });

      const activationRules = listAutomationRules("activation");
      expect(activationRules.some((r) => r.name === "Activation nudge")).toBe(true);
    });

    it("toggles rule enabled/disabled", () => {
      const rule = createAutomationRule({
        name: "Toggle test",
        stage: "revenue",
        trigger: { type: "expansion_signal", conditions: { threshold: 0.7 } },
        actions: [{ type: "notify_agent", parameters: {} }],
        assigned_agents: ["forge_revenue"],
      });

      expect(toggleAutomationRule(rule.id, false)).toBe(true);
      const updated = listAutomationRules("revenue").find((r) => r.id === rule.id);
      expect(updated!.enabled).toBe(false);
    });

    it("evaluates health_score_drop trigger", () => {
      const profile = createCustomerProfile({
        external_id: "cus_auto_eval",
        name: "AutoEval Co",
        email: "auto@eval.com",
      });

      // Set low health and retention stage
      transitionStage(profile.id, "retention", "Test", "harbor_csm");
      refreshHealthScore(profile.id, {
        activity_recency_days: 30,
        feature_adoption_pct: 10,
        support_tickets_open: 3,
        nps_score: 3,
        payment_failures: 1,
        login_frequency_weekly: 0,
      });

      createAutomationRule({
        name: "Health alert",
        stage: "retention",
        trigger: { type: "health_score_drop", conditions: { threshold: 40 } },
        actions: [{ type: "escalate", parameters: {} }],
        assigned_agents: ["harbor_csm"],
      });

      const results = evaluateAutomationRules(profile.id);
      const healthRule = results.find((r) => r.rule.name === "Health alert");
      expect(healthRule).toBeDefined();
      expect(healthRule!.matched).toBe(true);
    });

    it("records rule execution for evolution", () => {
      const rule = createAutomationRule({
        name: "Exec tracking test",
        stage: "acquisition",
        trigger: { type: "inactivity", conditions: { days: 7 } },
        actions: [{ type: "send_email", parameters: {} }],
        assigned_agents: ["beacon_marketing"],
      });

      recordRuleExecution(rule.id, "cus_123", true);
      recordRuleExecution(rule.id, "cus_456", false);

      const allRules = listAutomationRules();
      const tracked = allRules.find((r) => r.id === rule.id);
      expect(tracked!.execution_count).toBe(2);
      expect(tracked!.success_count).toBe(1);
    });
  });

  describe("Lifecycle Analytics", () => {
    it("returns lifecycle funnel", () => {
      const funnel = getLifecycleFunnel();
      expect(funnel.total_customers).toBeGreaterThan(0);
      expect(funnel.by_stage).toHaveProperty("acquisition");
      expect(funnel.by_stage).toHaveProperty("retention");
    });

    it("returns customers by stage", () => {
      const acqCustomers = getCustomersByStage("acquisition");
      expect(acqCustomers.every((c) => c.stage === "acquisition")).toBe(true);
    });

    it("returns at-risk customers", () => {
      const atRisk = getAtRiskCustomers(0.5);
      expect(atRisk.every((c) => c.churn_risk >= 0.5)).toBe(true);
    });

    it("returns automation stats", () => {
      const stats = getAutomationStats();
      expect(stats.total_rules).toBeGreaterThan(0);
      expect(stats.enabled_rules).toBeGreaterThan(0);
    });
  });
});

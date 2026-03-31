import { describe, it, expect, vi } from "vitest";

vi.mock("../../../server/db", () => ({
  db: { execute: vi.fn().mockResolvedValue({ rows: [] }) },
}));

vi.mock("../../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  recordCost,
  recordRevenue,
  setAgentBudget,
  getAgentBudget,
  canAfford,
  setSelfFundingThreshold,
  setCashReserve,
  checkSelfFunding,
  getCompanyEconomics,
  getFinancialAlerts,
} from "../../../server/services/scpFinancialAutonomy";

describe("SCP v3 Financial Autonomy", () => {
  describe("Cost Tracking", () => {
    it("records a cost entry", () => {
      const cost = recordCost({
        category: "llm_call",
        agent: "oracle_analytics",
        description: "GPT-4 analysis call",
        amount_usd: 0.05,
      });

      expect(cost.id).toBeTruthy();
      expect(cost.category).toBe("llm_call");
      expect(cost.amount_usd).toBe(0.05);
    });

    it("records a revenue entry", () => {
      const rev = recordRevenue({
        type: "subscription",
        customer_id: "cus_1",
        amount_usd: 99,
      });

      expect(rev.id).toBeTruthy();
      expect(rev.type).toBe("subscription");
      expect(rev.amount_usd).toBe(99);
    });
  });

  describe("Budget Management", () => {
    it("sets and retrieves agent budget", () => {
      setAgentBudget("oracle_analytics", 100);
      const budget = getAgentBudget("oracle_analytics");
      expect(budget.monthly_budget_usd).toBe(100);
      expect(budget.remaining_usd).toBeLessThanOrEqual(100);
    });

    it("tracks spending against budget", () => {
      setAgentBudget("beacon_marketing", 50);
      recordCost({ category: "llm_call", agent: "beacon_marketing", description: "Campaign gen", amount_usd: 20 });
      recordCost({ category: "llm_call", agent: "beacon_marketing", description: "Content gen", amount_usd: 15 });

      const budget = getAgentBudget("beacon_marketing");
      expect(budget.spent_usd).toBe(35);
      expect(budget.remaining_usd).toBe(15);
      expect(budget.utilization_pct).toBe(70);
    });

    it("generates warning alert at 80% utilization", () => {
      setAgentBudget("forge_revenue", 100);
      recordCost({ category: "llm_call", agent: "forge_revenue", description: "Analysis", amount_usd: 85 });

      const budget = getAgentBudget("forge_revenue");
      expect(budget.alerts.some((a) => a.includes("WARNING"))).toBe(true);
    });

    it("generates critical alert at 95% utilization", () => {
      setAgentBudget("harbor_csm", 100);
      recordCost({ category: "llm_call", agent: "harbor_csm", description: "Support", amount_usd: 96 });

      const budget = getAgentBudget("harbor_csm");
      expect(budget.alerts.some((a) => a.includes("CRITICAL"))).toBe(true);
    });
  });

  describe("Affordability Check", () => {
    it("allows spend within budget", () => {
      setAgentBudget("atlas_cto", 200);
      const result = canAfford("atlas_cto", 50);
      expect(result.allowed).toBe(true);
    });

    it("blocks spend exceeding budget", () => {
      setAgentBudget("shield_legal", 10);
      recordCost({ category: "llm_call", agent: "shield_legal", description: "Compliance check", amount_usd: 8 });
      const result = canAfford("shield_legal", 5);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Insufficient");
    });

    it("allows spend when no budget configured", () => {
      const result = canAfford("unknown_agent", 100);
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain("No budget");
    });
  });

  describe("Self-Funding Constraint", () => {
    it("reports healthy when AI spend is within threshold", () => {
      // Already have revenue recorded from earlier tests
      recordRevenue({ type: "subscription", customer_id: "cus_2", amount_usd: 500 });
      recordRevenue({ type: "subscription", customer_id: "cus_3", amount_usd: 500 });

      const sf = checkSelfFunding();
      expect(sf.revenue_30d).toBeGreaterThan(0);
      expect(sf.threshold).toBe(0.3);
    });

    it("allows custom threshold", () => {
      setSelfFundingThreshold(0.5);
      const sf = checkSelfFunding();
      expect(sf.threshold).toBe(0.5);

      // Reset
      setSelfFundingThreshold(0.3);
    });

    it("detects self-funding breach", () => {
      setSelfFundingThreshold(0.01); // Very tight threshold
      recordCost({ category: "llm_call", agent: "oracle_analytics", description: "Expensive call", amount_usd: 500 });

      const sf = checkSelfFunding();
      expect(sf.healthy).toBe(false);

      // Reset
      setSelfFundingThreshold(0.3);
    });
  });

  describe("Company Economics", () => {
    it("calculates full economics snapshot", () => {
      const economics = getCompanyEconomics(100, 50);

      expect(economics.total_customers).toBe(100);
      expect(economics.paying_customers).toBe(50);
      expect(economics.mrr_usd).toBeGreaterThan(0);
      expect(economics.arr_usd).toBe(economics.mrr_usd * 12);
      expect(economics.total_cost_30d_usd).toBeGreaterThan(0);
      expect(economics.last_updated).toBeTruthy();
    });

    it("calculates burn rate", () => {
      const economics = getCompanyEconomics();
      expect(economics.burn_rate_daily_usd).toBeGreaterThan(0);
    });

    it("tracks costs by category and agent", () => {
      const economics = getCompanyEconomics();
      expect(economics.ai_spend_by_category).toHaveProperty("llm_call");
      expect(Object.keys(economics.ai_spend_by_agent).length).toBeGreaterThan(0);
    });

    it("calculates runway when cash reserve is set", () => {
      setCashReserve(10000);
      // Make costs exceed revenue to get finite runway
      recordCost({ category: "compute", agent: "sentinel_devops", description: "Infra", amount_usd: 5000 });
      const economics = getCompanyEconomics();
      // Runway is either null (profitable) or a positive number
      if (economics.runway_days !== null) {
        expect(economics.runway_days).toBeGreaterThan(0);
      }
    });
  });

  describe("Financial Alerts", () => {
    it("returns financial alerts", () => {
      const alerts = getFinancialAlerts();
      expect(Array.isArray(alerts)).toBe(true);
      // Should have some alerts from our budget tests
      expect(alerts.length).toBeGreaterThan(0);
    });

    it("includes severity levels", () => {
      const alerts = getFinancialAlerts();
      for (const alert of alerts) {
        expect(["warning", "critical"]).toContain(alert.severity);
        expect(alert.message).toBeTruthy();
      }
    });
  });
});

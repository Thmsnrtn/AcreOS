import { describe, it, expect, vi } from "vitest";

vi.mock("../../../server/db", () => ({
  db: { execute: vi.fn().mockResolvedValue({ rows: [] }) },
}));

vi.mock("../../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  createExperiment,
  getExperiment,
  listExperiments,
  startExperiment,
  pauseExperiment,
  haltExperiment,
  completeExperiment,
  graduateExperiment,
  recordVariantData,
  updateGuardrails,
  analyzeResults,
  getExperimentPortfolio,
  getExperimentsForAgent,
} from "../../../server/services/scpExperimentEngine";

function makeExperiment(overrides: Record<string, unknown> = {}) {
  return createExperiment({
    name: `exp_${Date.now()}_${Math.random()}`,
    description: "Test experiment",
    hypothesis: {
      statement: "If we change CTA color, conversion improves",
      metric: "conversion_rate",
      expected_lift_pct: 10,
      confidence_threshold: 0.95,
      min_sample_size: 100,
    },
    owner_agent: "beacon_marketing",
    variants: [
      { name: "Control", description: "Current CTA", traffic_pct: 50 },
      { name: "Treatment", description: "New CTA", traffic_pct: 50 },
    ],
    ...overrides,
  });
}

describe("SCP v3 Experimentation Engine", () => {
  describe("Experiment Creation", () => {
    it("creates a valid experiment", () => {
      const result = makeExperiment();
      expect(result.success).toBe(true);
      expect(result.experiment!.status).toBe("draft");
      expect(result.experiment!.variants.length).toBe(2);
    });

    it("rejects if traffic doesn't sum to 100", () => {
      const result = createExperiment({
        name: "bad_traffic",
        description: "Test",
        hypothesis: { statement: "test", metric: "m", expected_lift_pct: 5, confidence_threshold: 0.95, min_sample_size: 50 },
        owner_agent: "beacon_marketing",
        variants: [
          { name: "A", description: "a", traffic_pct: 30 },
          { name: "B", description: "b", traffic_pct: 30 },
        ],
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("100%");
    });

    it("rejects with fewer than 2 variants", () => {
      const result = createExperiment({
        name: "one_variant",
        description: "Test",
        hypothesis: { statement: "test", metric: "m", expected_lift_pct: 5, confidence_threshold: 0.95, min_sample_size: 50 },
        owner_agent: "beacon_marketing",
        variants: [{ name: "Only", description: "one", traffic_pct: 100 }],
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("2 variants");
    });
  });

  describe("Experiment Lifecycle", () => {
    it("starts a draft experiment", () => {
      const { experiment } = makeExperiment();
      const result = startExperiment(experiment!.id);
      expect(result.success).toBe(true);
      expect(getExperiment(experiment!.id)!.status).toBe("running");
    });

    it("pauses a running experiment", () => {
      const { experiment } = makeExperiment();
      startExperiment(experiment!.id);
      const result = pauseExperiment(experiment!.id);
      expect(result.success).toBe(true);
      expect(getExperiment(experiment!.id)!.status).toBe("paused");
    });

    it("halts a running experiment with reason", () => {
      const { experiment } = makeExperiment();
      startExperiment(experiment!.id);
      const result = haltExperiment(experiment!.id, "Revenue dropped");
      expect(result.success).toBe(true);
      expect(getExperiment(experiment!.id)!.status).toBe("halted");
      expect(getExperiment(experiment!.id)!.results_summary).toContain("Revenue dropped");
    });

    it("completes and graduates an experiment", () => {
      const { experiment } = makeExperiment();
      startExperiment(experiment!.id);
      const winnerId = experiment!.variants[1].id;

      completeExperiment(experiment!.id, winnerId);
      expect(getExperiment(experiment!.id)!.status).toBe("completed");
      expect(getExperiment(experiment!.id)!.winner_variant_id).toBe(winnerId);

      graduateExperiment(experiment!.id);
      expect(getExperiment(experiment!.id)!.status).toBe("graduated");
    });

    it("cannot start a completed experiment", () => {
      const { experiment } = makeExperiment();
      startExperiment(experiment!.id);
      completeExperiment(experiment!.id);
      const result = startExperiment(experiment!.id);
      expect(result.success).toBe(false);
    });

    it("cannot graduate a non-completed experiment", () => {
      const { experiment } = makeExperiment();
      startExperiment(experiment!.id);
      const result = graduateExperiment(experiment!.id);
      expect(result.success).toBe(false);
    });
  });

  describe("Data Collection", () => {
    it("records variant data", () => {
      const { experiment } = makeExperiment();
      startExperiment(experiment!.id);
      const variantId = experiment!.variants[0].id;

      const result = recordVariantData(experiment!.id, variantId, { converted: true, metric_value: 1.5 });
      expect(result.success).toBe(true);

      const updated = getExperiment(experiment!.id);
      const variant = updated!.variants.find((v) => v.id === variantId);
      expect(variant!.sample_size).toBe(1);
      expect(variant!.conversions).toBe(1);
    });

    it("rejects data for non-running experiments", () => {
      const { experiment } = makeExperiment();
      const result = recordVariantData(experiment!.id, experiment!.variants[0].id, { converted: true });
      expect(result.success).toBe(false);
    });
  });

  describe("Guardrails", () => {
    it("halts experiment on guardrail violation", () => {
      const { experiment } = createExperiment({
        name: `guardrail_test_${Date.now()}`,
        description: "Test guardrails",
        hypothesis: { statement: "test", metric: "m", expected_lift_pct: 5, confidence_threshold: 0.95, min_sample_size: 50 },
        owner_agent: "beacon_marketing",
        variants: [
          { name: "Control", description: "ctrl", traffic_pct: 50 },
          { name: "Treatment", description: "treat", traffic_pct: 50 },
        ],
        guardrails: [
          { name: "revenue_per_user", threshold: 5.0, direction: "below", current_value: null },
          { name: "error_rate", threshold: 0.05, direction: "above", current_value: null },
        ],
      });

      startExperiment(experiment!.id);

      const result = updateGuardrails(experiment!.id, { revenue_per_user: 3.0, error_rate: 0.02 });
      expect(result.violations.length).toBe(1);
      expect(result.halted).toBe(true);
      expect(getExperiment(experiment!.id)!.status).toBe("halted");
    });

    it("allows experiment to continue when guardrails pass", () => {
      const { experiment } = createExperiment({
        name: `guardrail_pass_${Date.now()}`,
        description: "Test pass",
        hypothesis: { statement: "test", metric: "m", expected_lift_pct: 5, confidence_threshold: 0.95, min_sample_size: 50 },
        owner_agent: "beacon_marketing",
        variants: [
          { name: "Control", description: "ctrl", traffic_pct: 50 },
          { name: "Treatment", description: "treat", traffic_pct: 50 },
        ],
        guardrails: [
          { name: "revenue_per_user", threshold: 5.0, direction: "below", current_value: null },
        ],
      });

      startExperiment(experiment!.id);
      const result = updateGuardrails(experiment!.id, { revenue_per_user: 8.0 });
      expect(result.violations.length).toBe(0);
      expect(result.halted).toBe(false);
    });
  });

  describe("Statistical Analysis", () => {
    it("recommends need_more_data with insufficient samples", () => {
      const { experiment } = makeExperiment();
      startExperiment(experiment!.id);

      // Record a few data points (below min_sample_size of 100)
      for (let i = 0; i < 10; i++) {
        recordVariantData(experiment!.id, experiment!.variants[0].id, { converted: i < 3 });
        recordVariantData(experiment!.id, experiment!.variants[1].id, { converted: i < 5 });
      }

      const results = analyzeResults(experiment!.id);
      expect(results).not.toBeNull();
      expect(results!.has_enough_data).toBe(false);
      expect(results!.recommendation).toBe("need_more_data");
    });

    it("calculates lift and conversion rates", () => {
      const { experiment } = makeExperiment({
        hypothesis: {
          statement: "test",
          metric: "conversion_rate",
          expected_lift_pct: 10,
          confidence_threshold: 0.95,
          min_sample_size: 10,
        },
      });
      startExperiment(experiment!.id);

      // Control: 30% conversion
      for (let i = 0; i < 100; i++) {
        recordVariantData(experiment!.id, experiment!.variants[0].id, { converted: i < 30 });
      }
      // Treatment: 45% conversion (50% lift)
      for (let i = 0; i < 100; i++) {
        recordVariantData(experiment!.id, experiment!.variants[1].id, { converted: i < 45 });
      }

      const results = analyzeResults(experiment!.id);
      expect(results!.has_enough_data).toBe(true);
      expect(results!.lift_pct).toBeGreaterThan(0);
      expect(results!.variants[0].conversion_rate).toBeCloseTo(0.3, 1);
      expect(results!.variants[1].conversion_rate).toBeCloseTo(0.45, 1);
    });
  });

  describe("Portfolio Management", () => {
    it("returns portfolio summary", () => {
      const portfolio = getExperimentPortfolio();
      expect(portfolio.total).toBeGreaterThan(0);
      expect(portfolio.by_status).toBeDefined();
      expect(portfolio.by_agent).toBeDefined();
    });

    it("returns experiments for an agent", () => {
      const agentExps = getExperimentsForAgent("beacon_marketing");
      expect(agentExps.length).toBeGreaterThan(0);
      expect(agentExps.every(
        (e) => e.owner_agent === "beacon_marketing" || e.collaborating_agents.includes("beacon_marketing")
      )).toBe(true);
    });

    it("lists experiments by status", () => {
      const drafts = listExperiments("draft");
      expect(drafts.every((e) => e.status === "draft")).toBe(true);
    });
  });
});

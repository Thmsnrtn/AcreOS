import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../server/services/aiRouter", () => ({
  routeAITask: vi.fn().mockResolvedValue({
    content: JSON.stringify({
      safe: true,
      violations: [],
      reasoning: "No violations detected",
      compliant: true,
      contradicts_any: false,
      contradicted_lessons: [],
      confidence: 0.95,
      observations: [
        { type: "preference", content: "CEO prefers shorter reports", confidence: 0.85, implicit: false },
      ],
      consolidated_content: "# Consolidated\n- Principle 1\n- Principle 2",
      principles_extracted: 2,
      quality_score: 80,
      suggestions: ["Be more specific"],
    }),
  }),
  TaskComplexity: {
    SIMPLE: "simple",
    MODERATE: "moderate",
    COMPLEX: "complex",
    CRITICAL: "critical",
  },
}));

vi.mock("../../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("fs", () => ({
  readFileSync: vi.fn((path: string) => {
    if (path.includes("constitution.md")) return "# Constitution\n1. HONESTY\n2. SAFETY";
    throw new Error(`ENOENT: ${path}`);
  }),
  writeFileSync: vi.fn(),
  appendFileSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  existsSync: vi.fn(() => true),
  default: {
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    appendFileSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    existsSync: vi.fn(() => true),
  },
}));

import {
  getJudgeCosts,
  resetCostTracking,
  judgeObservationExtraction,
  judgeSafety,
  judgeConstitution,
  judgeRegression,
  judgeConsolidation,
  judgeQuality,
} from "../../../server/services/scpLLMJudges";
import { routeAITask } from "../../../server/services/aiRouter";
import type { ConfigDelta } from "../../../server/services/constitutionChecker";

const makeDelta = (overrides: Partial<ConfigDelta> = {}): ConfigDelta => ({
  agent: "atlas",
  file: "domain-knowledge.md",
  type: "append",
  content: "Learned deployment pattern.",
  rationale: "CEO corrected deployment order.",
  session_ids: ["session-1"],
  confidence: 0.9,
  ...overrides,
});

const defaultResponse = {
  content: JSON.stringify({
    safe: true,
    violations: [],
    reasoning: "No violations detected",
    compliant: true,
    contradicts_any: false,
    contradicted_lessons: [],
    confidence: 0.95,
    observations: [
      { type: "preference", content: "CEO prefers shorter reports", confidence: 0.85, implicit: false },
    ],
    consolidated_content: "# Consolidated\n- Principle 1\n- Principle 2",
    principles_extracted: 2,
    quality_score: 80,
    suggestions: ["Be more specific"],
  }),
};

describe("SCP LLM Judges", () => {
  beforeEach(() => {
    resetCostTracking();
    vi.clearAllMocks();
    (routeAITask as any).mockResolvedValue(defaultResponse);
  });

  describe("judgeObservationExtraction", () => {
    it("extracts observations from interactions", async () => {
      const obs = await judgeObservationExtraction(
        "atlas",
        [{ role: "user", content: "I prefer shorter reports." }],
        "success"
      );

      expect(obs.length).toBeGreaterThan(0);
      expect(obs[0].type).toBe("preference");
      expect(routeAITask).toHaveBeenCalledTimes(1);
    });

    it("returns empty array on error (graceful degradation)", async () => {
      (routeAITask as any).mockRejectedValueOnce(new Error("API error"));

      const obs = await judgeObservationExtraction("atlas", [], "failure");
      expect(obs).toHaveLength(0);
    });
  });

  describe("judgeSafety (triple judge, minority veto)", () => {
    it("passes when all three judges agree it's safe", async () => {
      const result = await judgeSafety("atlas", makeDelta());

      expect(result.passed).toBe(true);
      expect(result.judgments).toHaveLength(3);
      expect(result.unanimous).toBe(true);
      // Triple judge = 3 API calls
      expect(routeAITask).toHaveBeenCalledTimes(3);
    });

    it("rejects when even one judge flags unsafe (minority veto)", async () => {
      (routeAITask as any)
        .mockResolvedValueOnce({ content: JSON.stringify({ safe: true, violations: [], reasoning: "OK" }) })
        .mockResolvedValueOnce({ content: JSON.stringify({ safe: false, violations: [{ principle_ids: [2], category: "safety", description: "Unsafe", severity: "critical" }], reasoning: "Unsafe pattern" }) })
        .mockResolvedValueOnce({ content: JSON.stringify({ safe: true, violations: [], reasoning: "OK" }) });

      const result = await judgeSafety("atlas", makeDelta());

      expect(result.passed).toBe(false);
      expect(result.unanimous).toBe(false);
    });

    it("fails closed on API error", async () => {
      (routeAITask as any).mockRejectedValue(new Error("API down"));

      const result = await judgeSafety("atlas", makeDelta());

      expect(result.passed).toBe(false);
    });
  });

  describe("judgeConstitution (triple judge, minority veto)", () => {
    it("passes when all judges find compliance", async () => {
      const result = await judgeConstitution("atlas", makeDelta());

      expect(result.passed).toBe(true);
      expect(routeAITask).toHaveBeenCalledTimes(3);
    });

    it("fails closed on error", async () => {
      (routeAITask as any).mockRejectedValue(new Error("API error"));

      const result = await judgeConstitution("atlas", makeDelta());
      expect(result.passed).toBe(false);
    });
  });

  describe("judgeRegression (cascaded)", () => {
    it("passes when no golden cases exist", async () => {
      const result = await judgeRegression("atlas", makeDelta(), []);
      expect(result.passed).toBe(true);
      expect(routeAITask).not.toHaveBeenCalled();
    });

    it("uses fast screening first (SIMPLE complexity)", async () => {
      await judgeRegression("atlas", makeDelta(), [
        { lesson: "Always run migrations first", description: "CEO correction" },
      ]);

      expect(routeAITask).toHaveBeenCalledWith(
        expect.objectContaining({ complexity: "simple" })
      );
    });

    it("escalates to Sonnet when uncertain", async () => {
      (routeAITask as any).mockResolvedValueOnce({
        content: JSON.stringify({
          contradicts_any: false,
          contradicted_lessons: [],
          confidence: 0.3, // Low confidence = uncertain
        }),
      });

      await judgeRegression("atlas", makeDelta(), [
        { lesson: "Always run migrations first", description: "CEO correction" },
      ]);

      // Should have made 2 calls: Haiku screen + Sonnet deep
      expect(routeAITask).toHaveBeenCalledTimes(2);
    });
  });

  describe("judgeConsolidation", () => {
    it("returns consolidated content", async () => {
      const result = await judgeConsolidation(
        "atlas",
        "# Current config\n- Entry 1\n- Entry 2",
        ["New observation 1", "New observation 2"]
      );

      expect(result.consolidated).toContain("Consolidated");
      expect(result.principles_extracted).toBe(2);
    });

    it("returns original config on error", async () => {
      (routeAITask as any).mockRejectedValueOnce(new Error("API error"));

      const original = "# Original config";
      const result = await judgeConsolidation("atlas", original, ["obs"]);

      expect(result.consolidated).toBe(original);
    });
  });

  describe("judgeQuality", () => {
    it("returns quality score and suggestions", async () => {
      const result = await judgeQuality("atlas", makeDelta());

      expect(result.quality_score).toBe(80);
      expect(result.suggestions).toContain("Be more specific");
    });
  });

  describe("Cost Tracking", () => {
    it("tracks costs across judge calls", async () => {
      await judgeObservationExtraction("atlas", [{ role: "user", content: "test" }], "success");

      const costs = getJudgeCosts();
      expect(costs.total_usd).toBeGreaterThan(0);
      expect(costs.by_agent["atlas"]).toBeGreaterThan(0);
      expect(costs.by_judge["observation_extraction"]).toBeGreaterThan(0);
    });

    it("resets costs correctly", async () => {
      await judgeObservationExtraction("atlas", [{ role: "user", content: "test" }], "success");
      resetCostTracking();

      const costs = getJudgeCosts();
      expect(costs.total_usd).toBe(0);
      expect(costs.recent).toHaveLength(0);
    });
  });
});

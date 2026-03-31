import { describe, it, expect, vi } from "vitest";

vi.mock("../../../server/db", () => ({
  db: {
    query: {
      scpGoldenCases: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      companyAgents: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    },
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue({}) }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue({}) }),
    }),
  },
}));

vi.mock("../../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("fs", () => ({
  readFileSync: vi.fn((path: string) => {
    if (path.includes("version.json")) {
      return JSON.stringify({
        agent: "atlas",
        version: 5,
        parent: 4,
        timestamp: "2026-03-30T14:30:00Z",
        session_id: "s-100",
        changes: ["domain-knowledge.md"],
        metrics_snapshot: {
          total_sessions: 50,
          success_rate: 0.94,
          correction_rate: 0.05,
          ceo_override_rate: 0.08,
        },
      });
    }
    if (path.includes("metrics.json")) {
      return JSON.stringify({
        agent: "atlas",
        total_sessions: 55,
        success_rate: 0.82,
        correction_rate: 0.15,
        ceo_override_rate: 0.1,
        escalation_accuracy: 0.9,
        golden_suite_size: 5,
        last_evolution_at: "2026-03-30T14:30:00Z",
        evolution_count: 10,
      });
    }
    if (path.includes("golden-suite.jsonl")) return "";
    if (path.includes("evolution-log.jsonl")) return "";
    throw new Error(`ENOENT: ${path}`);
  }),
  writeFileSync: vi.fn(),
  appendFileSync: vi.fn(),
  readdirSync: vi.fn(() => ["persona.md", "domain-knowledge.md"]),
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
  shouldPromoteGoldenCase,
  recordSessionMetrics,
  checkAutoRollback,
  getEvolutionSummary,
} from "../../../server/services/scpGoldenSuite";

describe("SCP Golden Suite & Auto-Rollback", () => {
  describe("shouldPromoteGoldenCase", () => {
    it("promotes when CEO corrected and session succeeded", () => {
      expect(shouldPromoteGoldenCase({
        outcome: "success",
        ceo_corrections: ["Always run migrations first"],
      })).toBe(true);
    });

    it("does not promote when session failed", () => {
      expect(shouldPromoteGoldenCase({
        outcome: "failure",
        ceo_corrections: ["Try this approach instead"],
      })).toBe(false);
    });

    it("does not promote when no corrections were made", () => {
      expect(shouldPromoteGoldenCase({
        outcome: "success",
        ceo_corrections: [],
      })).toBe(false);
    });

    it("does not promote when corrections are undefined", () => {
      expect(shouldPromoteGoldenCase({
        outcome: "success",
      })).toBe(false);
    });
  });

  describe("recordSessionMetrics", () => {
    it("increments total sessions", () => {
      const snapshot = recordSessionMetrics("atlas", {
        outcome: "success",
        had_corrections: false,
        had_overrides: false,
      });

      expect(snapshot.total_sessions).toBeGreaterThan(0);
    });

    it("records corrections", () => {
      const snapshot = recordSessionMetrics("atlas", {
        outcome: "success",
        had_corrections: true,
        had_overrides: false,
      });

      expect(snapshot.correction_rate).toBeGreaterThan(0);
    });
  });

  describe("checkAutoRollback", () => {
    it("detects success rate degradation", () => {
      // Metrics mock shows success_rate dropped from 0.94 to 0.82 (12% drop)
      const result = checkAutoRollback("atlas", { threshold: 10, window: 5 });

      expect(result).not.toBeNull();
      expect(result!.rolled_back).toBe(true);
      expect(result!.reason).toContain("Success rate dropped");
    });

    it("respects threshold configuration", () => {
      // With a 20% threshold, the 12% drop shouldn't trigger
      const result = checkAutoRollback("atlas", { threshold: 20, window: 5 });

      // correction_rate increase is 15-5=10%, also below 20
      expect(result).toBeNull();
    });
  });

  describe("getEvolutionSummary", () => {
    it("returns summary for all 12 agents", () => {
      const summary = getEvolutionSummary();
      expect(summary).toHaveLength(12);
      expect(summary[0].agent).toBeTruthy();
      expect(summary[0]).toHaveProperty("version");
      expect(summary[0]).toHaveProperty("cadence");
      expect(summary[0]).toHaveProperty("total_sessions");
      expect(summary[0]).toHaveProperty("golden_suite_size");
    });
  });
});

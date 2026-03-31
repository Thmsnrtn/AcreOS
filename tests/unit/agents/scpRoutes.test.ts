import { describe, it, expect, vi } from "vitest";

vi.mock("../../../server/db", () => ({
  db: {
    query: {
      scpGoldenCases: { findMany: vi.fn().mockResolvedValue([]) },
      companyAgents: { findFirst: vi.fn().mockResolvedValue(null) },
    },
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue({}) }),
  },
}));

vi.mock("../../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../../server/services/aiRouter", () => ({
  routeAITask: vi.fn().mockResolvedValue({ content: "{}" }),
  TaskComplexity: { SIMPLE: "simple", MODERATE: "moderate" },
}));

vi.mock("fs", () => {
  const versionJson = JSON.stringify({
    agent: "atlas",
    version: 5,
    parent: 4,
    timestamp: "2026-03-30T14:30:00Z",
    session_id: "s-100",
    changes: ["domain-knowledge.md"],
    metrics_snapshot: { total_sessions: 50, success_rate: 0.94, correction_rate: 0.05, ceo_override_rate: 0.08 },
  });
  const metricsJson = JSON.stringify({
    agent: "atlas",
    total_sessions: 55,
    success_rate: 0.94,
    correction_rate: 0.05,
    ceo_override_rate: 0.08,
    escalation_accuracy: 0.9,
    golden_suite_size: 3,
    last_evolution_at: "2026-03-30T14:30:00Z",
    evolution_count: 10,
  });
  return {
    readFileSync: vi.fn((path: string) => {
      if (path.includes("version.json")) return versionJson;
      if (path.includes("metrics.json")) return metricsJson;
      if (path.includes("constitution.md")) return "# Constitution\n1. HONESTY";
      if (path.includes("shared-knowledge.md")) return "# Shared Knowledge";
      if (path.includes("golden-suite.jsonl")) return '{"id":"1","agent":"atlas","description":"test","lesson":"Always run migrations","session_id":"s1","created_at":"2026-03-30T14:30:00Z"}\n';
      if (path.includes("evolution-log.jsonl")) return '{"timestamp":"2026-03-30T14:30:00Z","version":5,"session_id":"s-100","changes":["domain-knowledge.md"],"deltas":[{"file":"domain-knowledge.md","type":"append","rationale":"test","confidence":0.9}],"gates_passed":["constitution"],"gates_failed":[]}\n';
      if (path.endsWith(".md")) return "# Stub content";
      throw new Error(`ENOENT: ${path}`);
    }),
    writeFileSync: vi.fn(),
    appendFileSync: vi.fn(),
    readdirSync: vi.fn(() => ["persona.md", "domain-knowledge.md", "task-patterns.md"]),
    existsSync: vi.fn(() => true),
    default: {
      readFileSync: vi.fn(),
      writeFileSync: vi.fn(),
      appendFileSync: vi.fn(),
      readdirSync: vi.fn(() => []),
      existsSync: vi.fn(() => true),
    },
  };
});

import { handleTalkQuery } from "../../../server/routes-scp-v2";

describe("SCP v2 CEO Interface", () => {
  describe("handleTalkQuery", () => {
    it("handles 'what has atlas learned' query", async () => {
      const result = await handleTalkQuery("What has atlas learned this week?");
      expect(result.type).toBe("evolution_history");
      expect(result.response).toContain("atlas");
      expect(result.data.agent).toBe("atlas");
    });

    it("handles 'show golden suite' query", async () => {
      const result = await handleTalkQuery("Show me atlas's golden suite");
      expect(result.type).toBe("golden_suite");
      expect(result.response).toContain("atlas");
      expect(result.data.golden_suite.length).toBeGreaterThan(0);
    });

    it("handles 'roll back' query", async () => {
      const result = await handleTalkQuery("Roll back atlas");
      expect(result.type).toBe("rollback_confirm");
      expect(result.response).toContain("v5");
    });

    it("handles 'pause evolution' query", async () => {
      const result = await handleTalkQuery("Pause evolution for all agents");
      expect(result.type).toBe("pause_confirm");
    });

    it("handles 'resume evolution' query", async () => {
      const result = await handleTalkQuery("Resume evolution");
      expect(result.type).toBe("resume_confirm");
    });

    it("handles general agent query", async () => {
      const result = await handleTalkQuery("How is sentinel doing?");
      expect(result.type).toBe("agent_status");
      expect(result.response).toContain("sentinel");
    });

    it("handles unknown queries gracefully", async () => {
      const result = await handleTalkQuery("What is the meaning of life?");
      expect(result.type).toBe("unknown");
      expect(result.response).toContain("didn't understand");
    });
  });
});

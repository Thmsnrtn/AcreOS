import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the database and logger before imports
vi.mock("../../../server/db", () => ({
  db: { execute: vi.fn().mockResolvedValue({ rows: [] }) },
}));

vi.mock("../../../server/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock fs for config file operations
vi.mock("fs", () => {
  const store = new Map<string, string>();
  return {
    readFileSync: vi.fn((path: string) => {
      if (store.has(path)) return store.get(path);
      throw new Error(`ENOENT: ${path}`);
    }),
    writeFileSync: vi.fn((path: string, content: string) => {
      store.set(path, content);
    }),
    appendFileSync: vi.fn((path: string, content: string) => {
      const existing = store.get(path) || "";
      store.set(path, existing + content);
    }),
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

import {
  extractObservations,
  selfCritique,
  generateDeltas,
  getEvolutionCadence,
  shouldEvolve,
  applyDelta,
  consolidateConfig,
} from "../../../server/services/scpEvolutionEngine";

describe("SCP Evolution Engine", () => {
  describe("getEvolutionCadence", () => {
    it("returns aggressive for first 10 sessions", () => {
      expect(getEvolutionCadence(0)).toBe("aggressive");
      expect(getEvolutionCadence(5)).toBe("aggressive");
      expect(getEvolutionCadence(9)).toBe("aggressive");
    });

    it("returns moderate for sessions 10-49", () => {
      expect(getEvolutionCadence(10)).toBe("moderate");
      expect(getEvolutionCadence(30)).toBe("moderate");
      expect(getEvolutionCadence(49)).toBe("moderate");
    });

    it("returns conservative for sessions 50+", () => {
      expect(getEvolutionCadence(50)).toBe("conservative");
      expect(getEvolutionCadence(100)).toBe("conservative");
    });
  });

  describe("shouldEvolve", () => {
    it("always evolves in aggressive cadence", () => {
      expect(shouldEvolve(5, false, false, false)).toBe(true);
    });

    it("evolves in moderate cadence only with observations", () => {
      expect(shouldEvolve(20, false, false, false)).toBe(false);
      expect(shouldEvolve(20, true, false, false)).toBe(true);
      expect(shouldEvolve(20, false, true, false)).toBe(true);
      expect(shouldEvolve(20, false, false, true)).toBe(true);
    });

    it("evolves in conservative cadence only on significant events", () => {
      expect(shouldEvolve(60, false, false, false)).toBe(false);
      expect(shouldEvolve(60, false, false, true)).toBe(false); // domain facts not enough
      expect(shouldEvolve(60, true, false, false)).toBe(true); // corrections trigger
      expect(shouldEvolve(60, false, true, false)).toBe(true); // errors trigger
    });
  });

  describe("extractObservations", () => {
    it("extracts corrections from CEO overrides", () => {
      const obs = extractObservations({
        agent: "atlas",
        session_id: "s1",
        messages: [],
        outcome: "success",
        ceo_corrections: ["Always run migrations before restart"],
      });

      const corrections = obs.filter((o) => o.type === "correction");
      expect(corrections).toHaveLength(1);
      expect(corrections[0].confidence).toBe(0.95);
      expect(corrections[0].content).toBe("Always run migrations before restart");
    });

    it("extracts error observations", () => {
      const obs = extractObservations({
        agent: "sentinel",
        session_id: "s2",
        messages: [],
        outcome: "failure",
        error_messages: ["Deployment timeout after 300s"],
      });

      const errors = obs.filter((o) => o.type === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0].content).toBe("Deployment timeout after 300s");
    });

    it("extracts success patterns", () => {
      const obs = extractObservations({
        agent: "forge",
        session_id: "s3",
        messages: [],
        outcome: "success",
      });

      const successes = obs.filter((o) => o.type === "success_pattern");
      expect(successes).toHaveLength(1);
    });

    it("extracts tool patterns", () => {
      const obs = extractObservations({
        agent: "oracle",
        session_id: "s4",
        messages: [],
        outcome: "success",
        tools_used: ["query_conversion_funnel", "cohort_analysis"],
      });

      const tools = obs.filter((o) => o.type === "tool_pattern");
      expect(tools).toHaveLength(1);
      expect(tools[0].content).toContain("query_conversion_funnel");
    });

    it("detects CEO preferences from messages", () => {
      const obs = extractObservations({
        agent: "beacon",
        session_id: "s5",
        messages: [
          { role: "user", content: "I prefer shorter blog posts under 1000 words." },
        ],
        outcome: "success",
      });

      const prefs = obs.filter((o) => o.type === "preference");
      expect(prefs.length).toBeGreaterThan(0);
    });

    it("detects domain facts from CEO messages", () => {
      const obs = extractObservations({
        agent: "shield",
        session_id: "s6",
        messages: [
          { role: "user", content: "Actually the correct approach is to file quarterly." },
        ],
        outcome: "success",
      });

      const facts = obs.filter((o) => o.type === "domain_fact");
      expect(facts.length).toBeGreaterThan(0);
    });
  });

  describe("selfCritique", () => {
    it("returns no changes for empty observations", () => {
      const result = selfCritique("atlas", []);
      expect(result.suggested_changes).toHaveLength(0);
      expect(result.no_change_reason).toBe("No observations to process");
    });

    it("maps corrections to domain-knowledge.md", () => {
      const result = selfCritique("atlas", [
        {
          type: "correction",
          content: "Always run migrations before restart",
          source: "ceo_correction",
          session_id: "s1",
          confidence: 0.95,
          timestamp: new Date().toISOString(),
        },
      ]);

      expect(result.suggested_changes.length).toBeGreaterThan(0);
      expect(result.suggested_changes[0].file).toBe("domain-knowledge.md");
    });

    it("maps errors to task-patterns.md", () => {
      const result = selfCritique("sentinel", [
        {
          type: "error",
          content: "Connection timeout",
          source: "error_log",
          session_id: "s2",
          confidence: 0.9,
          timestamp: new Date().toISOString(),
        },
      ]);

      expect(result.suggested_changes[0].file).toBe("task-patterns.md");
    });

    it("filters out low-confidence observations", () => {
      const result = selfCritique("forge", [
        {
          type: "tool_pattern",
          content: "Some tool used",
          source: "tool_usage",
          session_id: "s3",
          confidence: 0.3, // Below 0.7 threshold
          timestamp: new Date().toISOString(),
        },
      ]);

      expect(result.suggested_changes).toHaveLength(0);
    });
  });

  describe("generateDeltas", () => {
    it("converts critique suggestions to ConfigDeltas", () => {
      const critique = selfCritique("atlas", [
        {
          type: "correction",
          content: "Run migrations first",
          source: "ceo_correction",
          session_id: "s1",
          confidence: 0.95,
          timestamp: new Date().toISOString(),
        },
      ]);

      const deltas = generateDeltas(critique);
      expect(deltas.length).toBeGreaterThan(0);
      expect(deltas[0].agent).toBe("atlas");
      expect(deltas[0].session_ids).toContain("s1");
      expect(deltas[0].confidence).toBeGreaterThan(0);
    });
  });
});

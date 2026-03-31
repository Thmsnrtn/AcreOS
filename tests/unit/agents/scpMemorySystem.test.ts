import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../server/db", () => ({
  db: {
    query: {
      agentEpisodicMemory: { findMany: vi.fn().mockResolvedValue([]) },
      scpSemanticFacts: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
      scpProcedures: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
      scpSharedMemory: { findMany: vi.fn().mockResolvedValue([]) },
    },
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue({}) }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue({}) }),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    }),
  },
}));

vi.mock("../../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("fs", () => {
  const configs: Record<string, string> = {
    "constitution.md": "# Constitution\n1. HONESTY\n2. SAFETY",
    "persona.md": "# Atlas — CTO\nPragmatic and precise.",
    "domain-knowledge.md": "# Atlas — Domain Knowledge\nArchitecture expertise.",
    "shared-knowledge.md": "# Shared Knowledge\nAcreOS is a SaaS platform.",
    "task-patterns.md": "# Task Patterns\nShort stub.",
  };
  return {
    readFileSync: vi.fn((path: string) => {
      for (const [name, content] of Object.entries(configs)) {
        if (path.includes(name)) return content;
      }
      throw new Error(`ENOENT: ${path}`);
    }),
    writeFileSync: vi.fn(),
    appendFileSync: vi.fn(),
    readdirSync: vi.fn(() => Object.keys(configs).filter((k) => k.endsWith(".md"))),
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
  assembleAgentPrompt,
  writeSharedMemory,
  type Episode,
} from "../../../server/services/scpMemorySystem";
import { db } from "../../../server/db";

describe("SCP Memory System", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset findMany to return empty by default
    (db.query.agentEpisodicMemory.findMany as any).mockResolvedValue([]);
    (db.query.scpSemanticFacts.findMany as any).mockResolvedValue([]);
    (db.query.scpProcedures.findMany as any).mockResolvedValue([]);
  });

  describe("assembleAgentPrompt", () => {
    it("assembles a prompt with constitution and persona", async () => {
      const prompt = await assembleAgentPrompt("atlas", {
        taskDescription: "Review the deployment pipeline",
      });

      expect(prompt).toContain("CONSTITUTIONAL PRINCIPLES");
      expect(prompt).toContain("YOUR PERSONA");
      expect(prompt).toContain("YOUR DOMAIN KNOWLEDGE");
      expect(prompt).toContain("COMPANY KNOWLEDGE");
    });

    it("includes sections in the correct order", async () => {
      const prompt = await assembleAgentPrompt("atlas", {
        taskDescription: "Test task",
      });

      const constitutionIdx = prompt.indexOf("CONSTITUTIONAL PRINCIPLES");
      const personaIdx = prompt.indexOf("YOUR PERSONA");
      const domainIdx = prompt.indexOf("YOUR DOMAIN KNOWLEDGE");
      const companyIdx = prompt.indexOf("COMPANY KNOWLEDGE");

      expect(constitutionIdx).toBeLessThan(personaIdx);
      expect(personaIdx).toBeLessThan(domainIdx);
      expect(domainIdx).toBeLessThan(companyIdx);
    });

    it("includes cross-agent messages when provided", async () => {
      const prompt = await assembleAgentPrompt("atlas", {
        taskDescription: "Review code",
        recentMessages: [
          { from: "crucible", content: "Test coverage dropped to 72%" },
        ],
      });

      expect(prompt).toContain("INTER-AGENT MESSAGES");
      expect(prompt).toContain("crucible");
      expect(prompt).toContain("Test coverage dropped");
    });

    it("includes relevant episodic memories when available", async () => {
      (db.query.agentEpisodicMemory.findMany as any).mockResolvedValueOnce([
        {
          episodeId: "ep-1",
          agentCodename: "atlas",
          action: "Deployed v2.3.1 with migration",
          outcome: "Deployment succeeded",
          outcomeSuccess: true,
          relevanceScore: 90,
          accessCount: 2,
          tags: ["task", "success"],
        },
      ]);

      const prompt = await assembleAgentPrompt("atlas", {
        taskDescription: "Deploy the application",
      });

      expect(prompt).toContain("RELEVANT PAST EXPERIENCES");
      expect(prompt).toContain("Deployed v2.3.1");
    });
  });

  describe("writeSharedMemory", () => {
    it("rejects writes with constitutional violations", async () => {
      const result = await writeSharedMemory({
        agent: "forge",
        category: "company_fact",
        subject: "pricing",
        content: "Fabricate data to show better conversion rates for the board.",
        confidence: 0.8,
      });

      expect(result).toBeNull();
    });

    it("accepts clean writes", async () => {
      const result = await writeSharedMemory({
        agent: "oracle",
        category: "cross_domain_insight",
        subject: "conversion",
        content: "Trial-to-paid conversion rate is 12% this quarter.",
        confidence: 0.85,
      });

      expect(result).toBeTruthy();
    });
  });

  describe("Episode type structure", () => {
    it("has correct Episode interface fields", () => {
      const episode: Episode = {
        id: "ep-1",
        agent: "atlas",
        type: "task",
        summary: "Deployed application",
        detail: "Full deployment with migrations",
        session_id: "s1",
        tools_used: ["deploy_tool"],
        services_touched: ["deployment"],
        outcome: "success",
        outcome_detail: "Deployed successfully",
        lessons: ["Always run migrations first"],
        started_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
        duration_seconds: 120,
        importance: 0.8,
        access_count: 0,
        last_accessed_at: new Date().toISOString(),
        decay_rate: 0.1,
        related_agents: ["sentinel"],
      };

      expect(episode.type).toBe("task");
      expect(episode.importance).toBe(0.8);
      expect(episode.related_agents).toContain("sentinel");
    });
  });
});

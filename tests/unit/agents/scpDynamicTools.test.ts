import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../server/db", () => ({
  db: { execute: vi.fn().mockResolvedValue({ rows: [] }) },
}));

vi.mock("../../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  createTool,
  listToolsForAgent,
  getToolByName,
  searchTools,
  recordToolUsage,
  updateTool,
  shareTool,
  getRegistryStats,
  recordCollaborationInsight,
  getPendingInsights,
  markInsightApplied,
  getInsightGraph,
} from "../../../server/services/scpDynamicTools";

describe("SCP Dynamic Tools & Cross-Agent Learning", () => {
  describe("createTool", () => {
    it("creates a valid tool", () => {
      const result = createTool({
        agent: "oracle",
        name: `test_query_funnel_${Date.now()}`,
        description: "Query the conversion funnel data",
        input_schema: { date_range: { type: "string" } },
        implementation: "SELECT * FROM conversion_events WHERE date >= $1",
        category: "analytics",
        tags: ["conversion", "funnel"],
      });

      expect(result.success).toBe(true);
      expect(result.tool).toBeDefined();
      expect(result.tool!.created_by_agent).toBe("oracle");
      expect(result.tool!.version).toBe(1);
    });

    it("rejects tools with short names", () => {
      const result = createTool({
        agent: "oracle",
        name: "ab",
        description: "Too short",
        input_schema: {},
        implementation: "SELECT 1",
      });

      expect(result.success).toBe(false);
      expect(result.rejection_reason).toContain("3-64 characters");
    });

    it("rejects duplicate tool names", () => {
      const name = `unique_tool_${Date.now()}`;
      createTool({
        agent: "oracle",
        name,
        description: "First",
        input_schema: {},
        implementation: "SELECT 1",
      });

      const result = createTool({
        agent: "forge",
        name,
        description: "Duplicate",
        input_schema: {},
        implementation: "SELECT 2",
      });

      expect(result.success).toBe(false);
      expect(result.rejection_reason).toContain("already exists");
    });

    it("rejects tools with dangerous implementations", () => {
      const result = createTool({
        agent: "atlas",
        name: `danger_tool_${Date.now()}`,
        description: "Dangerous tool",
        input_schema: {},
        implementation: "eval(userInput)",
      });

      expect(result.success).toBe(false);
      expect(result.rejection_reason).toContain("dangerous pattern");
    });

    it("rejects tools with constitutional violations", () => {
      const result = createTool({
        agent: "atlas",
        name: `violation_tool_${Date.now()}`,
        description: "A tool to bypass the authority gate",
        input_schema: {},
        implementation: "return true",
      });

      expect(result.success).toBe(false);
      expect(result.rejection_reason).toContain("Safety violation");
    });
  });

  describe("listToolsForAgent", () => {
    it("returns tools available to all agents", () => {
      const name = `shared_tool_${Date.now()}`;
      createTool({
        agent: "oracle",
        name,
        description: "Available to all",
        input_schema: {},
        implementation: "SELECT 1",
        available_to: ["all"],
      });

      const tools = listToolsForAgent("forge");
      expect(tools.some((t) => t.name === name)).toBe(true);
    });

    it("returns tools specifically shared with the agent", () => {
      const name = `specific_tool_${Date.now()}`;
      createTool({
        agent: "oracle",
        name,
        description: "Shared with forge",
        input_schema: {},
        implementation: "SELECT 1",
        available_to: ["forge"],
      });

      expect(listToolsForAgent("forge").some((t) => t.name === name)).toBe(true);
      expect(listToolsForAgent("beacon").some((t) => t.name === name)).toBe(false);
    });
  });

  describe("searchTools", () => {
    it("finds tools by keyword", () => {
      const name = `searchable_conversion_${Date.now()}`;
      createTool({
        agent: "oracle",
        name,
        description: "Analyzes conversion metrics",
        input_schema: {},
        implementation: "SELECT 1",
        tags: ["conversion", "analytics"],
      });

      const results = searchTools("conversion analytics");
      expect(results.some((t) => t.name === name)).toBe(true);
    });
  });

  describe("recordToolUsage", () => {
    it("tracks success and failure counts", () => {
      const result = createTool({
        agent: "oracle",
        name: `usage_tracked_${Date.now()}`,
        description: "Tracked tool",
        input_schema: {},
        implementation: "SELECT 1",
      });

      const id = result.tool!.id;
      recordToolUsage(id, true, 100);
      recordToolUsage(id, true, 150);
      recordToolUsage(id, false, 200);

      const tool = getToolByName(result.tool!.name);
      expect(tool!.usage_count).toBe(3);
      expect(tool!.success_count).toBe(2);
      expect(tool!.failure_count).toBe(1);
    });
  });

  describe("updateTool", () => {
    it("bumps version on update", () => {
      const result = createTool({
        agent: "oracle",
        name: `updatable_${Date.now()}`,
        description: "Will be updated",
        input_schema: {},
        implementation: "SELECT 1",
      });

      const updated = updateTool(result.tool!.id, {
        description: "Updated description",
      });

      expect(updated.success).toBe(true);
      expect(updated.tool!.version).toBe(2);
      expect(updated.tool!.description).toBe("Updated description");
    });

    it("rejects unsafe implementation updates", () => {
      const result = createTool({
        agent: "oracle",
        name: `safe_update_${Date.now()}`,
        description: "Safe tool",
        input_schema: {},
        implementation: "SELECT 1",
      });

      const updated = updateTool(result.tool!.id, {
        implementation: "process.exit(1)",
      });

      expect(updated.success).toBe(false);
    });
  });

  describe("shareTool", () => {
    it("shares a tool with additional agents", () => {
      const result = createTool({
        agent: "oracle",
        name: `shareable_${Date.now()}`,
        description: "Will be shared",
        input_schema: {},
        implementation: "SELECT 1",
        available_to: ["oracle"],
      });

      const shared = shareTool(result.tool!.id, ["forge", "beacon"]);
      expect(shared).toBe(true);

      const tools = listToolsForAgent("forge");
      expect(tools.some((t) => t.id === result.tool!.id)).toBe(true);
    });
  });

  describe("Cross-Agent Learning", () => {
    it("records collaboration insights", () => {
      const insight = recordCollaborationInsight({
        from_agent: "oracle",
        to_agents: ["forge"],
        insight_type: "collaboration_outcome",
        content: "Cohort analysis data improved revenue predictions by 15%",
        confidence: 0.85,
        session_id: "s-collab-1",
      });

      expect(insight.id).toBeTruthy();
      expect(insight.from_agent).toBe("oracle");
      expect(insight.applied_by).toHaveLength(0);
    });

    it("tracks pending insights for agents", () => {
      recordCollaborationInsight({
        from_agent: "oracle",
        to_agents: ["sentinel"],
        insight_type: "domain_crossover",
        content: "Memory usage correlates with query complexity",
        confidence: 0.7,
        session_id: "s-collab-2",
      });

      const pending = getPendingInsights("sentinel");
      expect(pending.length).toBeGreaterThan(0);
    });

    it("marks insights as applied", () => {
      const insight = recordCollaborationInsight({
        from_agent: "harbor",
        to_agents: ["compass"],
        insight_type: "tool_effectiveness",
        content: "Customer feedback tool identified 5 feature requests",
        confidence: 0.9,
        session_id: "s-collab-3",
      });

      markInsightApplied(insight.id, "compass");

      const pending = getPendingInsights("compass");
      expect(pending.some((i) => i.id === insight.id)).toBe(false);
    });

    it("builds insight graph", () => {
      const graph = getInsightGraph();
      expect(graph.total_insights).toBeGreaterThan(0);
      expect(graph.edges.length).toBeGreaterThan(0);
      expect(graph.edges[0]).toHaveProperty("from");
      expect(graph.edges[0]).toHaveProperty("to");
      expect(graph.edges[0]).toHaveProperty("count");
    });
  });

  describe("getRegistryStats", () => {
    it("returns registry statistics", () => {
      const stats = getRegistryStats();
      expect(stats.total_tools).toBeGreaterThan(0);
      expect(stats.by_agent).toBeDefined();
      expect(stats.by_category).toBeDefined();
    });
  });
});

/**
 * SCP Dynamic Tool Registry — Sovereign Company Protocol v2
 *
 * Multi-agent dynamic tool system where:
 *   - Any agent can create tools that persist across sessions
 *   - Tools are registered in a shared registry available to all agents
 *   - Tool creation goes through safety pattern checking
 *   - Tools evolve based on usage (success/failure tracking)
 *   - Cross-agent tool sharing with access controls
 */

import { db } from "../db";
import { logger } from "../utils/logger";
import crypto from "crypto";
import { checkPatterns } from "./constitutionChecker";
import type { AgentCodename } from "./scpConfigVersioning";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface DynamicTool {
  id: string;
  created_by_agent: string;
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  implementation: string; // The actual code/query/logic
  created_at: string;
  last_used_at: string | null;
  usage_count: number;
  success_count: number;
  failure_count: number;
  available_to: string[]; // ["all"] or specific agent names
  version: number;
  tags: string[];
  category: string;
}

export interface ToolCreationRequest {
  agent: string;
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  implementation: string;
  available_to?: string[];
  tags?: string[];
  category?: string;
}

export interface ToolExecutionResult {
  tool_id: string;
  success: boolean;
  output: unknown;
  duration_ms: number;
  error?: string;
}

// ─── In-Memory Tool Registry ───────────────────────────────────────────────

const toolRegistry = new Map<string, DynamicTool>();

// ─── Tool Creation with Validation ─────────────────────────────────────────

/**
 * Create a new dynamic tool.
 * Validates against constitutional patterns before registration.
 */
export function createTool(request: ToolCreationRequest): {
  success: boolean;
  tool?: DynamicTool;
  rejection_reason?: string;
} {
  // Validate tool name
  if (!request.name || request.name.length < 3 || request.name.length > 64) {
    return { success: false, rejection_reason: "Tool name must be 3-64 characters" };
  }

  // Check for duplicate names
  for (const [, tool] of toolRegistry) {
    if (tool.name === request.name) {
      return { success: false, rejection_reason: `Tool "${request.name}" already exists (created by ${tool.created_by_agent})` };
    }
  }

  // Safety pattern check on implementation and description
  const contentToCheck = `${request.implementation} ${request.description}`;
  const patternResult = checkPatterns(contentToCheck);
  if (!patternResult.passed) {
    logger.warn("Dynamic tool creation rejected by pattern check", {
      agent: request.agent,
      tool: request.name,
      violations: patternResult.violations,
    });
    return {
      success: false,
      rejection_reason: `Safety violation: ${patternResult.violations.map((v) => v.description).join("; ")}`,
    };
  }

  // Validate implementation doesn't contain dangerous patterns
  const dangerousImplPatterns = [
    /\beval\s*\(/,
    /\bnew\s+Function\s*\(/,
    /\bprocess\.exit/,
    /\brequire\s*\(\s*['"]child_process/,
    /\bexecSync\b/,
    /\bexec\s*\(/,
    /\bDROP\s+TABLE/i,
    /\bDELETE\s+FROM/i,
    /\brm\s+-rf/,
  ];

  for (const pattern of dangerousImplPatterns) {
    if (pattern.test(request.implementation)) {
      return {
        success: false,
        rejection_reason: `Implementation contains dangerous pattern: ${pattern.source}`,
      };
    }
  }

  const tool: DynamicTool = {
    id: crypto.randomUUID(),
    created_by_agent: request.agent,
    name: request.name,
    description: request.description,
    input_schema: request.input_schema,
    implementation: request.implementation,
    created_at: new Date().toISOString(),
    last_used_at: null,
    usage_count: 0,
    success_count: 0,
    failure_count: 0,
    available_to: request.available_to ?? ["all"],
    version: 1,
    tags: request.tags ?? [],
    category: request.category ?? "general",
  };

  toolRegistry.set(tool.id, tool);

  logger.info("Dynamic tool created", {
    agent: request.agent,
    tool: tool.name,
    id: tool.id,
    available_to: tool.available_to,
  });

  return { success: true, tool };
}

// ─── Tool Discovery ────────────────────────────────────────────────────────

/**
 * List all tools available to a specific agent.
 */
export function listToolsForAgent(agent: string): DynamicTool[] {
  const tools: DynamicTool[] = [];

  for (const [, tool] of toolRegistry) {
    if (tool.available_to.includes("all") || tool.available_to.includes(agent)) {
      tools.push(tool);
    }
  }

  return tools.sort((a, b) => b.usage_count - a.usage_count);
}

/**
 * Get a tool by name.
 */
export function getToolByName(name: string): DynamicTool | undefined {
  for (const [, tool] of toolRegistry) {
    if (tool.name === name) return tool;
  }
  return undefined;
}

/**
 * Get a tool by ID.
 */
export function getToolById(id: string): DynamicTool | undefined {
  return toolRegistry.get(id);
}

/**
 * Search tools by keyword.
 */
export function searchTools(query: string): DynamicTool[] {
  const keywords = query.toLowerCase().split(/\s+/);
  const results: Array<DynamicTool & { matchScore: number }> = [];

  for (const [, tool] of toolRegistry) {
    const text = `${tool.name} ${tool.description} ${tool.tags.join(" ")} ${tool.category}`.toLowerCase();
    const matchCount = keywords.filter((kw) => text.includes(kw)).length;
    if (matchCount > 0) {
      results.push({ ...tool, matchScore: matchCount / keywords.length });
    }
  }

  return results.sort((a, b) => b.matchScore - a.matchScore);
}

// ─── Tool Execution Tracking ───────────────────────────────────────────────

/**
 * Record a tool usage outcome.
 */
export function recordToolUsage(
  toolId: string,
  success: boolean,
  durationMs: number
): void {
  const tool = toolRegistry.get(toolId);
  if (!tool) return;

  tool.usage_count++;
  if (success) tool.success_count++;
  else tool.failure_count++;
  tool.last_used_at = new Date().toISOString();

  toolRegistry.set(toolId, tool);
}

/**
 * Update a tool's implementation (version bump).
 */
export function updateTool(
  toolId: string,
  updates: {
    description?: string;
    implementation?: string;
    input_schema?: Record<string, unknown>;
    available_to?: string[];
  }
): { success: boolean; tool?: DynamicTool; rejection_reason?: string } {
  const tool = toolRegistry.get(toolId);
  if (!tool) {
    return { success: false, rejection_reason: "Tool not found" };
  }

  // Safety check on new implementation if provided
  if (updates.implementation) {
    const patternResult = checkPatterns(updates.implementation);
    if (!patternResult.passed) {
      return {
        success: false,
        rejection_reason: `Safety violation: ${patternResult.violations.map((v) => v.description).join("; ")}`,
      };
    }

    // Check dangerous implementation patterns
    const dangerousImplPatterns = [
      /\beval\s*\(/, /\bnew\s+Function\s*\(/, /\bprocess\.exit/,
      /\brequire\s*\(\s*['"]child_process/, /\bexecSync\b/, /\bexec\s*\(/,
      /\bDROP\s+TABLE/i, /\bDELETE\s+FROM/i, /\brm\s+-rf/,
    ];
    for (const pattern of dangerousImplPatterns) {
      if (pattern.test(updates.implementation)) {
        return { success: false, rejection_reason: `Implementation contains dangerous pattern: ${pattern.source}` };
      }
    }
  }

  const updated: DynamicTool = {
    ...tool,
    ...(updates.description && { description: updates.description }),
    ...(updates.implementation && { implementation: updates.implementation }),
    ...(updates.input_schema && { input_schema: updates.input_schema }),
    ...(updates.available_to && { available_to: updates.available_to }),
    version: tool.version + 1,
  };

  toolRegistry.set(toolId, updated);

  logger.info("Dynamic tool updated", {
    tool: tool.name,
    id: toolId,
    version: updated.version,
  });

  return { success: true, tool: updated };
}

// ─── Cross-Agent Tool Sharing ──────────────────────────────────────────────

/**
 * Share a tool with additional agents.
 */
export function shareTool(toolId: string, withAgents: string[]): boolean {
  const tool = toolRegistry.get(toolId);
  if (!tool) return false;

  const newAvailable = new Set([...tool.available_to, ...withAgents]);
  tool.available_to = Array.from(newAvailable);
  toolRegistry.set(toolId, tool);

  logger.info("Tool shared with agents", {
    tool: tool.name,
    shared_with: withAgents,
  });

  return true;
}

// ─── Tool Registry Stats ──────────────────────────────────────────────────

/**
 * Get registry-wide statistics.
 */
export function getRegistryStats(): {
  total_tools: number;
  by_agent: Record<string, number>;
  by_category: Record<string, number>;
  most_used: Array<{ name: string; usage_count: number; success_rate: number }>;
} {
  const byAgent: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const allTools: DynamicTool[] = [];

  for (const [, tool] of toolRegistry) {
    byAgent[tool.created_by_agent] = (byAgent[tool.created_by_agent] ?? 0) + 1;
    byCategory[tool.category] = (byCategory[tool.category] ?? 0) + 1;
    allTools.push(tool);
  }

  const mostUsed = allTools
    .filter((t) => t.usage_count > 0)
    .sort((a, b) => b.usage_count - a.usage_count)
    .slice(0, 10)
    .map((t) => ({
      name: t.name,
      usage_count: t.usage_count,
      success_rate: t.usage_count > 0 ? t.success_count / t.usage_count : 0,
    }));

  return {
    total_tools: toolRegistry.size,
    by_agent: byAgent,
    by_category: byCategory,
    most_used: mostUsed,
  };
}

// ─── Cross-Agent Evolution ─────────────────────────────────────────────────

export interface CrossAgentInsight {
  id: string;
  from_agent: string;
  to_agents: string[];
  insight_type: "collaboration_outcome" | "tool_effectiveness" | "domain_crossover";
  content: string;
  confidence: number;
  session_id: string;
  created_at: string;
  applied_by: string[];
}

const insightLog: CrossAgentInsight[] = [];

/**
 * Record a cross-agent collaboration insight.
 * When agents collaborate on a task, both agents' evolution loops should fire.
 */
export function recordCollaborationInsight(insight: {
  from_agent: string;
  to_agents: string[];
  insight_type: CrossAgentInsight["insight_type"];
  content: string;
  confidence: number;
  session_id: string;
}): CrossAgentInsight {
  const entry: CrossAgentInsight = {
    id: crypto.randomUUID(),
    ...insight,
    created_at: new Date().toISOString(),
    applied_by: [],
  };

  insightLog.push(entry);

  logger.info("Cross-agent insight recorded", {
    from: insight.from_agent,
    to: insight.to_agents,
    type: insight.insight_type,
  });

  return entry;
}

/**
 * Get pending insights for an agent (insights directed at it that haven't been applied).
 */
export function getPendingInsights(agent: string): CrossAgentInsight[] {
  return insightLog.filter(
    (i) => i.to_agents.includes(agent) && !i.applied_by.includes(agent)
  );
}

/**
 * Mark an insight as applied by an agent.
 */
export function markInsightApplied(insightId: string, agent: string): void {
  const insight = insightLog.find((i) => i.id === insightId);
  if (insight && !insight.applied_by.includes(agent)) {
    insight.applied_by.push(agent);
  }
}

/**
 * Get the cross-agent insight graph (which agents learn from each other).
 */
export function getInsightGraph(): {
  edges: Array<{ from: string; to: string; count: number; types: string[] }>;
  total_insights: number;
} {
  const edgeMap = new Map<string, { count: number; types: Set<string> }>();

  for (const insight of insightLog) {
    for (const to of insight.to_agents) {
      const key = `${insight.from_agent}→${to}`;
      const existing = edgeMap.get(key) || { count: 0, types: new Set() };
      existing.count++;
      existing.types.add(insight.insight_type);
      edgeMap.set(key, existing);
    }
  }

  const edges = Array.from(edgeMap.entries()).map(([key, value]) => {
    const [from, to] = key.split("→");
    return { from, to, count: value.count, types: Array.from(value.types) };
  });

  return {
    edges: edges.sort((a, b) => b.count - a.count),
    total_insights: insightLog.length,
  };
}

// ─── Exported Service ──────────────────────────────────────────────────────

export const scpDynamicTools = {
  // Tool CRUD
  createTool,
  getToolByName,
  getToolById,
  searchTools,
  updateTool,
  // Discovery
  listToolsForAgent,
  // Usage
  recordToolUsage,
  // Sharing
  shareTool,
  // Stats
  getRegistryStats,
  // Cross-agent
  recordCollaborationInsight,
  getPendingInsights,
  markInsightApplied,
  getInsightGraph,
};

/**
 * SCP v3 Self-Provisioning — Sovereign Company Protocol
 *
 * Capability gap detection and solution scoping pipeline:
 *   - CapabilityGap detection (what can't the company do yet?)
 *   - Solution proposals with cost/benefit analysis
 *   - Integration provisioning pipeline
 *   - Agent capability expansion tracking
 *   - Self-improvement roadmap
 */

import { logger } from "../utils/logger";
import crypto from "crypto";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface CapabilityGap {
  id: string;
  title: string;
  description: string;
  detected_by: string; // Agent that identified the gap
  category: "integration" | "automation" | "intelligence" | "communication" | "infrastructure";
  severity: "low" | "medium" | "high" | "critical";
  frequency: number; // How often this gap is encountered
  impact_description: string;
  blocked_workflows: string[];
  detected_at: string;
  status: "detected" | "scoping" | "proposed" | "approved" | "implementing" | "resolved" | "wont_fix";
  solution_id: string | null;
}

export interface SolutionProposal {
  id: string;
  gap_id: string;
  title: string;
  description: string;
  approach: "build" | "buy" | "integrate" | "extend";
  proposed_by: string;
  estimated_effort_hours: number;
  estimated_cost_usd: number;
  expected_benefit: string;
  risk_assessment: string;
  dependencies: string[];
  implementation_steps: string[];
  status: "draft" | "reviewed" | "approved" | "rejected";
  created_at: string;
  score: number; // Benefit/cost score (higher = better)
}

export interface ProvisioningTask {
  id: string;
  solution_id: string;
  title: string;
  description: string;
  assigned_agent: string;
  status: "pending" | "in_progress" | "completed" | "blocked";
  order: number;
  started_at: string | null;
  completed_at: string | null;
}

// ─── In-Memory Stores ─────────────────────────────────────────────────────

const capabilityGaps = new Map<string, CapabilityGap>();
const solutions = new Map<string, SolutionProposal>();
const provisioningTasks = new Map<string, ProvisioningTask>();

// ─── Capability Gap Detection ─────────────────────────────────────────────

/**
 * Report a capability gap detected by an agent.
 */
export function reportCapabilityGap(input: {
  title: string;
  description: string;
  detected_by: string;
  category: CapabilityGap["category"];
  severity: CapabilityGap["severity"];
  impact_description: string;
  blocked_workflows?: string[];
}): CapabilityGap {
  // Check for duplicate/similar gaps
  for (const [, gap] of capabilityGaps) {
    if (gap.title.toLowerCase() === input.title.toLowerCase() && gap.status !== "resolved" && gap.status !== "wont_fix") {
      gap.frequency++;
      return gap;
    }
  }

  const gap: CapabilityGap = {
    id: crypto.randomUUID(),
    title: input.title,
    description: input.description,
    detected_by: input.detected_by,
    category: input.category,
    severity: input.severity,
    frequency: 1,
    impact_description: input.impact_description,
    blocked_workflows: input.blocked_workflows ?? [],
    detected_at: new Date().toISOString(),
    status: "detected",
    solution_id: null,
  };

  capabilityGaps.set(gap.id, gap);

  logger.info("Capability gap detected", {
    title: input.title,
    severity: input.severity,
    detected_by: input.detected_by,
  });

  return gap;
}

export function getCapabilityGap(id: string): CapabilityGap | undefined {
  return capabilityGaps.get(id);
}

export function listCapabilityGaps(filters?: {
  category?: CapabilityGap["category"];
  severity?: CapabilityGap["severity"];
  status?: CapabilityGap["status"];
}): CapabilityGap[] {
  let result = Array.from(capabilityGaps.values());
  if (filters?.category) result = result.filter((g) => g.category === filters.category);
  if (filters?.severity) result = result.filter((g) => g.severity === filters.severity);
  if (filters?.status) result = result.filter((g) => g.status === filters.status);
  return result.sort((a, b) => {
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return (severityOrder[a.severity] - severityOrder[b.severity]) || (b.frequency - a.frequency);
  });
}

export function updateGapStatus(id: string, status: CapabilityGap["status"]): boolean {
  const gap = capabilityGaps.get(id);
  if (!gap) return false;
  gap.status = status;
  return true;
}

// ─── Solution Proposals ───────────────────────────────────────────────────

/**
 * Propose a solution for a capability gap.
 */
export function proposeSolution(input: {
  gap_id: string;
  title: string;
  description: string;
  approach: SolutionProposal["approach"];
  proposed_by: string;
  estimated_effort_hours: number;
  estimated_cost_usd: number;
  expected_benefit: string;
  risk_assessment: string;
  dependencies?: string[];
  implementation_steps: string[];
}): { success: boolean; solution?: SolutionProposal; error?: string } {
  const gap = capabilityGaps.get(input.gap_id);
  if (!gap) return { success: false, error: "Capability gap not found" };

  // Calculate benefit/cost score
  const severityMultiplier = { critical: 4, high: 3, medium: 2, low: 1 }[gap.severity];
  const frequencyBonus = Math.min(gap.frequency, 10);
  const benefit = severityMultiplier * frequencyBonus;
  const cost = Math.max(1, input.estimated_effort_hours / 10 + input.estimated_cost_usd / 100);
  const score = benefit / cost;

  const solution: SolutionProposal = {
    id: crypto.randomUUID(),
    gap_id: input.gap_id,
    title: input.title,
    description: input.description,
    approach: input.approach,
    proposed_by: input.proposed_by,
    estimated_effort_hours: input.estimated_effort_hours,
    estimated_cost_usd: input.estimated_cost_usd,
    expected_benefit: input.expected_benefit,
    risk_assessment: input.risk_assessment,
    dependencies: input.dependencies ?? [],
    implementation_steps: input.implementation_steps,
    status: "draft",
    created_at: new Date().toISOString(),
    score,
  };

  solutions.set(solution.id, solution);
  gap.status = "proposed";
  gap.solution_id = solution.id;

  return { success: true, solution };
}

export function getSolution(id: string): SolutionProposal | undefined {
  return solutions.get(id);
}

export function listSolutions(gapId?: string): SolutionProposal[] {
  const all = Array.from(solutions.values());
  if (gapId) return all.filter((s) => s.gap_id === gapId);
  return all.sort((a, b) => b.score - a.score);
}

export function approveSolution(id: string): boolean {
  const solution = solutions.get(id);
  if (!solution || solution.status !== "draft" && solution.status !== "reviewed") return false;
  solution.status = "approved";

  const gap = capabilityGaps.get(solution.gap_id);
  if (gap) gap.status = "approved";

  return true;
}

export function rejectSolution(id: string): boolean {
  const solution = solutions.get(id);
  if (!solution) return false;
  solution.status = "rejected";
  return true;
}

// ─── Provisioning Pipeline ────────────────────────────────────────────────

/**
 * Create provisioning tasks from an approved solution's implementation steps.
 */
export function createProvisioningTasks(solutionId: string, assignments: Array<{
  step_index: number;
  assigned_agent: string;
}>): ProvisioningTask[] {
  const solution = solutions.get(solutionId);
  if (!solution || solution.status !== "approved") return [];

  const tasks: ProvisioningTask[] = [];

  for (let i = 0; i < solution.implementation_steps.length; i++) {
    const assignment = assignments.find((a) => a.step_index === i);
    const task: ProvisioningTask = {
      id: crypto.randomUUID(),
      solution_id: solutionId,
      title: `Step ${i + 1}: ${solution.implementation_steps[i]}`,
      description: solution.implementation_steps[i],
      assigned_agent: assignment?.assigned_agent ?? solution.proposed_by,
      status: "pending",
      order: i,
      started_at: null,
      completed_at: null,
    };

    provisioningTasks.set(task.id, task);
    tasks.push(task);
  }

  const gap = capabilityGaps.get(solution.gap_id);
  if (gap) gap.status = "implementing";

  return tasks;
}

export function getProvisioningTasks(solutionId: string): ProvisioningTask[] {
  return Array.from(provisioningTasks.values())
    .filter((t) => t.solution_id === solutionId)
    .sort((a, b) => a.order - b.order);
}

export function updateTaskStatus(
  taskId: string,
  status: ProvisioningTask["status"]
): boolean {
  const task = provisioningTasks.get(taskId);
  if (!task) return false;

  task.status = status;
  if (status === "in_progress" && !task.started_at) {
    task.started_at = new Date().toISOString();
  }
  if (status === "completed") {
    task.completed_at = new Date().toISOString();
  }

  // Check if all tasks for this solution are complete
  const solutionTasks = getProvisioningTasks(task.solution_id);
  if (solutionTasks.every((t) => t.status === "completed")) {
    const solution = solutions.get(task.solution_id);
    if (solution) {
      const gap = capabilityGaps.get(solution.gap_id);
      if (gap) gap.status = "resolved";
    }
  }

  return true;
}

// ─── Self-Improvement Dashboard ───────────────────────────────────────────

export interface SelfProvisioningSummary {
  total_gaps: number;
  by_severity: Record<string, number>;
  by_category: Record<string, number>;
  by_status: Record<string, number>;
  total_solutions: number;
  approved_solutions: number;
  active_provisioning_tasks: number;
  resolved_gaps: number;
  avg_solution_score: number;
}

export function getSelfProvisioningSummary(): SelfProvisioningSummary {
  const gaps = Array.from(capabilityGaps.values());
  const sols = Array.from(solutions.values());
  const tasks = Array.from(provisioningTasks.values());

  const bySeverity: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const byStatus: Record<string, number> = {};

  for (const g of gaps) {
    bySeverity[g.severity] = (bySeverity[g.severity] ?? 0) + 1;
    byCategory[g.category] = (byCategory[g.category] ?? 0) + 1;
    byStatus[g.status] = (byStatus[g.status] ?? 0) + 1;
  }

  const totalScore = sols.reduce((s, sol) => s + sol.score, 0);

  return {
    total_gaps: gaps.length,
    by_severity: bySeverity,
    by_category: byCategory,
    by_status: byStatus,
    total_solutions: sols.length,
    approved_solutions: sols.filter((s) => s.status === "approved").length,
    active_provisioning_tasks: tasks.filter((t) => t.status === "in_progress").length,
    resolved_gaps: gaps.filter((g) => g.status === "resolved").length,
    avg_solution_score: sols.length > 0 ? totalScore / sols.length : 0,
  };
}

// ─── Exported Service ──────────────────────────────────────────────────────

export const scpSelfProvisioning = {
  // Gaps
  reportCapabilityGap,
  getCapabilityGap,
  listCapabilityGaps,
  updateGapStatus,
  // Solutions
  proposeSolution,
  getSolution,
  listSolutions,
  approveSolution,
  rejectSolution,
  // Provisioning
  createProvisioningTasks,
  getProvisioningTasks,
  updateTaskStatus,
  // Dashboard
  getSelfProvisioningSummary,
};

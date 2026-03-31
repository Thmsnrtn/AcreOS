// @ts-nocheck
/**
 * SCP v3 Experimentation Engine — Sovereign Company Protocol
 *
 * Formal hypothesis-driven experimentation with:
 *   - Structured Hypothesis interface
 *   - Experiment portfolio management
 *   - Guardrail metrics (automatic halt on violations)
 *   - Statistical significance tracking
 *   - Cross-agent experiment coordination
 *   - Evolution integration (learnings feed back to agents)
 */

import { logger } from "../utils/logger";
import crypto from "crypto";

// ─── Types ─────────────────────────────────────────────────────────────────

export type ExperimentStatus =
  | "draft"
  | "running"
  | "paused"
  | "completed"
  | "halted"
  | "graduated";

export interface Hypothesis {
  statement: string; // "If we X, then Y because Z"
  metric: string; // Primary metric to track
  expected_lift_pct: number; // Expected improvement %
  confidence_threshold: number; // Required statistical confidence (0-1)
  min_sample_size: number;
}

export interface GuardrailMetric {
  name: string;
  threshold: number; // If metric drops below this, halt experiment
  direction: "above" | "below"; // "above" = halt if above threshold, "below" = halt if below
  current_value: number | null;
}

export interface ExperimentVariant {
  id: string;
  name: string;
  description: string;
  traffic_pct: number; // 0-100
  sample_size: number;
  conversions: number;
  primary_metric_value: number;
}

export interface Experiment {
  id: string;
  name: string;
  description: string;
  hypothesis: Hypothesis;
  owner_agent: string;
  collaborating_agents: string[];
  status: ExperimentStatus;
  variants: ExperimentVariant[];
  guardrails: GuardrailMetric[];
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  tags: string[];
  category: string;
  results_summary: string | null;
  winner_variant_id: string | null;
}

// ─── In-Memory Store ──────────────────────────────────────────────────────

const experiments = new Map<string, Experiment>();

// ─── Experiment CRUD ──────────────────────────────────────────────────────

export function createExperiment(input: {
  name: string;
  description: string;
  hypothesis: Hypothesis;
  owner_agent: string;
  collaborating_agents?: string[];
  variants: Array<{ name: string; description: string; traffic_pct: number }>;
  guardrails?: GuardrailMetric[];
  tags?: string[];
  category?: string;
}): { success: boolean; experiment?: Experiment; error?: string } {
  // Validate variant traffic allocation sums to 100
  const totalTraffic = input.variants.reduce((s, v) => s + v.traffic_pct, 0);
  if (totalTraffic !== 100) {
    return { success: false, error: `Variant traffic must sum to 100%, got ${totalTraffic}%` };
  }

  // Need at least 2 variants (control + treatment)
  if (input.variants.length < 2) {
    return { success: false, error: "Experiments need at least 2 variants (control + treatment)" };
  }

  const experiment: Experiment = {
    id: crypto.randomUUID(),
    name: input.name,
    description: input.description,
    hypothesis: input.hypothesis,
    owner_agent: input.owner_agent,
    collaborating_agents: input.collaborating_agents ?? [],
    status: "draft",
    variants: input.variants.map((v) => ({
      id: crypto.randomUUID(),
      name: v.name,
      description: v.description,
      traffic_pct: v.traffic_pct,
      sample_size: 0,
      conversions: 0,
      primary_metric_value: 0,
    })),
    guardrails: input.guardrails ?? [],
    started_at: null,
    ended_at: null,
    created_at: new Date().toISOString(),
    tags: input.tags ?? [],
    category: input.category ?? "general",
    results_summary: null,
    winner_variant_id: null,
  };

  experiments.set(experiment.id, experiment);

  logger.info("Experiment created", {
    id: experiment.id,
    name: input.name,
    owner: input.owner_agent,
  });

  return { success: true, experiment };
}

export function getExperiment(id: string): Experiment | undefined {
  return experiments.get(id);
}

export function listExperiments(status?: ExperimentStatus): Experiment[] {
  const all = Array.from(experiments.values());
  if (status) return all.filter((e) => e.status === status);
  return all;
}

// ─── Experiment Lifecycle ─────────────────────────────────────────────────

export function startExperiment(id: string): { success: boolean; error?: string } {
  const exp = experiments.get(id);
  if (!exp) return { success: false, error: "Experiment not found" };
  if (exp.status !== "draft" && exp.status !== "paused") {
    return { success: false, error: `Cannot start experiment in status: ${exp.status}` };
  }

  exp.status = "running";
  exp.started_at = exp.started_at ?? new Date().toISOString();

  logger.info("Experiment started", { id, name: exp.name });
  return { success: true };
}

export function pauseExperiment(id: string): { success: boolean; error?: string } {
  const exp = experiments.get(id);
  if (!exp) return { success: false, error: "Experiment not found" };
  if (exp.status !== "running") {
    return { success: false, error: `Cannot pause experiment in status: ${exp.status}` };
  }

  exp.status = "paused";
  return { success: true };
}

export function haltExperiment(id: string, reason: string): { success: boolean; error?: string } {
  const exp = experiments.get(id);
  if (!exp) return { success: false, error: "Experiment not found" };
  if (exp.status !== "running" && exp.status !== "paused") {
    return { success: false, error: `Cannot halt experiment in status: ${exp.status}` };
  }

  exp.status = "halted";
  exp.ended_at = new Date().toISOString();
  exp.results_summary = `Halted: ${reason}`;

  logger.warn("Experiment halted", { id, name: exp.name, reason });
  return { success: true };
}

export function completeExperiment(id: string, winnerVariantId?: string): {
  success: boolean;
  error?: string;
} {
  const exp = experiments.get(id);
  if (!exp) return { success: false, error: "Experiment not found" };
  if (exp.status !== "running" && exp.status !== "paused") {
    return { success: false, error: `Cannot complete experiment in status: ${exp.status}` };
  }

  exp.status = "completed";
  exp.ended_at = new Date().toISOString();
  if (winnerVariantId) {
    exp.winner_variant_id = winnerVariantId;
  }

  return { success: true };
}

export function graduateExperiment(id: string): { success: boolean; error?: string } {
  const exp = experiments.get(id);
  if (!exp) return { success: false, error: "Experiment not found" };
  if (exp.status !== "completed") {
    return { success: false, error: "Only completed experiments can be graduated" };
  }

  exp.status = "graduated";
  logger.info("Experiment graduated", { id, name: exp.name, winner: exp.winner_variant_id });
  return { success: true };
}

// ─── Data Collection ──────────────────────────────────────────────────────

/**
 * Record a data point for a specific variant.
 */
export function recordVariantData(
  experimentId: string,
  variantId: string,
  data: { converted: boolean; metric_value?: number }
): { success: boolean; error?: string } {
  const exp = experiments.get(experimentId);
  if (!exp) return { success: false, error: "Experiment not found" };
  if (exp.status !== "running") return { success: false, error: "Experiment not running" };

  const variant = exp.variants.find((v) => v.id === variantId);
  if (!variant) return { success: false, error: "Variant not found" };

  variant.sample_size++;
  if (data.converted) variant.conversions++;
  if (data.metric_value !== undefined) {
    // Running average
    variant.primary_metric_value =
      (variant.primary_metric_value * (variant.sample_size - 1) + data.metric_value) / variant.sample_size;
  }

  return { success: true };
}

/**
 * Update guardrail metric values and check for violations.
 */
export function updateGuardrails(
  experimentId: string,
  metrics: Record<string, number>
): { violations: string[]; halted: boolean } {
  const exp = experiments.get(experimentId);
  if (!exp) return { violations: [], halted: false };

  const violations: string[] = [];

  for (const guardrail of exp.guardrails) {
    if (metrics[guardrail.name] !== undefined) {
      guardrail.current_value = metrics[guardrail.name];

      const violated =
        guardrail.direction === "below"
          ? guardrail.current_value < guardrail.threshold
          : guardrail.current_value > guardrail.threshold;

      if (violated) {
        violations.push(
          `${guardrail.name}: ${guardrail.current_value} ${guardrail.direction === "below" ? "<" : ">"} ${guardrail.threshold}`
        );
      }
    }
  }

  if (violations.length > 0 && exp.status === "running") {
    haltExperiment(experimentId, `Guardrail violations: ${violations.join("; ")}`);
    return { violations, halted: true };
  }

  return { violations, halted: false };
}

// ─── Statistical Analysis ─────────────────────────────────────────────────

export interface ExperimentResults {
  experiment_id: string;
  has_enough_data: boolean;
  variants: Array<{
    id: string;
    name: string;
    sample_size: number;
    conversion_rate: number;
    primary_metric_value: number;
  }>;
  lift_pct: number | null;
  is_significant: boolean;
  confidence: number;
  recommendation: "continue" | "stop_winner" | "stop_no_effect" | "need_more_data";
}

/**
 * Calculate experiment results and statistical significance.
 * Uses a simplified z-test approximation for conversion rate comparison.
 */
export function analyzeResults(experimentId: string): ExperimentResults | null {
  const exp = experiments.get(experimentId);
  if (!exp || exp.variants.length < 2) return null;

  const control = exp.variants[0];
  const treatment = exp.variants[1]; // Primary treatment variant

  const hasEnoughData =
    control.sample_size >= exp.hypothesis.min_sample_size &&
    treatment.sample_size >= exp.hypothesis.min_sample_size;

  const controlRate = control.sample_size > 0 ? control.conversions / control.sample_size : 0;
  const treatmentRate = treatment.sample_size > 0 ? treatment.conversions / treatment.sample_size : 0;

  let liftPct: number | null = null;
  let confidence = 0;
  let isSignificant = false;

  if (control.sample_size > 0 && treatment.sample_size > 0) {
    liftPct = controlRate > 0 ? ((treatmentRate - controlRate) / controlRate) * 100 : 0;

    // Simplified z-test for two proportions
    const pooledRate =
      (control.conversions + treatment.conversions) /
      (control.sample_size + treatment.sample_size);
    const se = Math.sqrt(
      pooledRate * (1 - pooledRate) * (1 / control.sample_size + 1 / treatment.sample_size)
    );

    if (se > 0) {
      const z = Math.abs(treatmentRate - controlRate) / se;
      // Approximate p-value from z-score (simplified)
      confidence = Math.min(0.99, 1 - Math.exp(-0.5 * z * z));
      isSignificant = confidence >= exp.hypothesis.confidence_threshold;
    }
  }

  let recommendation: ExperimentResults["recommendation"];
  if (!hasEnoughData) {
    recommendation = "need_more_data";
  } else if (isSignificant && liftPct !== null && liftPct > 0) {
    recommendation = "stop_winner";
  } else if (isSignificant && liftPct !== null && liftPct <= 0) {
    recommendation = "stop_no_effect";
  } else {
    recommendation = "continue";
  }

  return {
    experiment_id: experimentId,
    has_enough_data: hasEnoughData,
    variants: exp.variants.map((v) => ({
      id: v.id,
      name: v.name,
      sample_size: v.sample_size,
      conversion_rate: v.sample_size > 0 ? v.conversions / v.sample_size : 0,
      primary_metric_value: v.primary_metric_value,
    })),
    lift_pct: liftPct,
    is_significant: isSignificant,
    confidence,
    recommendation,
  };
}

// ─── Portfolio Management ─────────────────────────────────────────────────

export interface ExperimentPortfolio {
  total: number;
  by_status: Record<ExperimentStatus, number>;
  by_agent: Record<string, number>;
  by_category: Record<string, number>;
  active_traffic_allocation: number; // Total % of traffic in running experiments
  graduated_learnings: number;
}

export function getExperimentPortfolio(): ExperimentPortfolio {
  const all = Array.from(experiments.values());
  const byStatus: Record<string, number> = {};
  const byAgent: Record<string, number> = {};
  const byCategory: Record<string, number> = {};

  for (const exp of all) {
    byStatus[exp.status] = (byStatus[exp.status] ?? 0) + 1;
    byAgent[exp.owner_agent] = (byAgent[exp.owner_agent] ?? 0) + 1;
    byCategory[exp.category] = (byCategory[exp.category] ?? 0) + 1;
  }

  // Active traffic = sum of all running experiment variants
  const activeTraffic = all
    .filter((e) => e.status === "running")
    .reduce((sum, e) => sum + e.variants.reduce((s, v) => s + v.traffic_pct, 0), 0);

  return {
    total: all.length,
    by_status: byStatus as Record<ExperimentStatus, number>,
    by_agent: byAgent,
    by_category: byCategory,
    active_traffic_allocation: activeTraffic,
    graduated_learnings: all.filter((e) => e.status === "graduated").length,
  };
}

/**
 * Get experiments owned by or collaborating with a specific agent.
 */
export function getExperimentsForAgent(agent: string): Experiment[] {
  return Array.from(experiments.values()).filter(
    (e) => e.owner_agent === agent || e.collaborating_agents.includes(agent)
  );
}

// ─── Exported Service ──────────────────────────────────────────────────────

export const scpExperimentEngine = {
  // CRUD
  createExperiment,
  getExperiment,
  listExperiments,
  // Lifecycle
  startExperiment,
  pauseExperiment,
  haltExperiment,
  completeExperiment,
  graduateExperiment,
  // Data
  recordVariantData,
  updateGuardrails,
  // Analysis
  analyzeResults,
  // Portfolio
  getExperimentPortfolio,
  getExperimentsForAgent,
};

// @ts-nocheck
/**
 * SCP v3 Customer Lifecycle Engine — Sovereign Company Protocol
 *
 * AARRR pipeline (Acquisition → Activation → Revenue → Retention → Referral)
 * with composite customer intelligence, lifecycle stage tracking,
 * evolvable automation rules, and cross-agent coordination.
 *
 * Each lifecycle stage has:
 *   - Stage-specific metrics and health scores
 *   - Automated triggers with agent assignments
 *   - Escalation rules
 *   - Evolution feedback loops
 */

import { logger } from "../utils/logger";
import crypto from "crypto";

// ─── AARRR Lifecycle Stages ───────────────────────────────────────────────

export type LifecycleStage =
  | "acquisition"
  | "activation"
  | "revenue"
  | "retention"
  | "referral";

export const LIFECYCLE_ORDER: LifecycleStage[] = [
  "acquisition",
  "activation",
  "revenue",
  "retention",
  "referral",
];

// ─── Customer Intelligence ────────────────────────────────────────────────

export interface CustomerProfile {
  id: string;
  external_id: string; // Stripe customer ID, etc.
  name: string;
  email: string;
  stage: LifecycleStage;
  health_score: number; // 0-100
  mrr_usd: number;
  plan: string;
  signup_date: string;
  last_active_at: string | null;
  activation_completed: boolean;
  churn_risk: number; // 0-1
  expansion_potential: number; // 0-1
  nps_score: number | null;
  tags: string[];
  signals: CustomerSignal[];
  created_at: string;
  updated_at: string;
}

export interface CustomerSignal {
  type: string;
  value: string | number;
  source: string;
  timestamp: string;
  agent: string;
}

// ─── Automation Rules ─────────────────────────────────────────────────────

export interface AutomationRule {
  id: string;
  name: string;
  stage: LifecycleStage;
  trigger: AutomationTrigger;
  actions: AutomationAction[];
  assigned_agents: string[];
  enabled: boolean;
  priority: number;
  cooldown_hours: number;
  execution_count: number;
  success_count: number;
  last_executed_at: string | null;
  created_at: string;
  version: number;
}

export interface AutomationTrigger {
  type: "health_score_drop" | "inactivity" | "stage_transition" | "signal_match" | "churn_risk" | "expansion_signal" | "nps_response";
  conditions: Record<string, unknown>;
}

export interface AutomationAction {
  type: "send_email" | "create_task" | "escalate" | "update_stage" | "add_tag" | "notify_agent" | "schedule_call";
  parameters: Record<string, unknown>;
}

// ─── In-Memory Stores ─────────────────────────────────────────────────────

const customers = new Map<string, CustomerProfile>();
const automationRules = new Map<string, AutomationRule>();
const ruleExecutionLog: Array<{
  rule_id: string;
  customer_id: string;
  success: boolean;
  timestamp: string;
}> = [];

// ─── Customer Management ──────────────────────────────────────────────────

export function createCustomerProfile(input: {
  external_id: string;
  name: string;
  email: string;
  plan?: string;
  mrr_usd?: number;
}): CustomerProfile {
  const profile: CustomerProfile = {
    id: crypto.randomUUID(),
    external_id: input.external_id,
    name: input.name,
    email: input.email,
    stage: "acquisition",
    health_score: 50,
    mrr_usd: input.mrr_usd ?? 0,
    plan: input.plan ?? "free",
    signup_date: new Date().toISOString(),
    last_active_at: null,
    activation_completed: false,
    churn_risk: 0.1,
    expansion_potential: 0.5,
    nps_score: null,
    tags: [],
    signals: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  customers.set(profile.id, profile);
  logger.info("Customer profile created", { id: profile.id, name: input.name });
  return profile;
}

export function getCustomerProfile(id: string): CustomerProfile | undefined {
  return customers.get(id);
}

export function getCustomerByExternalId(externalId: string): CustomerProfile | undefined {
  for (const [, profile] of customers) {
    if (profile.external_id === externalId) return profile;
  }
  return undefined;
}

export function updateCustomerProfile(
  id: string,
  updates: Partial<Pick<CustomerProfile, "name" | "email" | "plan" | "mrr_usd" | "nps_score" | "tags" | "last_active_at">>
): CustomerProfile | undefined {
  const profile = customers.get(id);
  if (!profile) return undefined;

  Object.assign(profile, updates, { updated_at: new Date().toISOString() });
  return profile;
}

// ─── Health Score Calculation ─────────────────────────────────────────────

export interface HealthFactors {
  activity_recency_days: number;
  feature_adoption_pct: number;
  support_tickets_open: number;
  nps_score: number | null;
  payment_failures: number;
  login_frequency_weekly: number;
}

/**
 * Calculate a customer health score (0-100) from multiple signals.
 */
export function calculateHealthScore(factors: HealthFactors): number {
  let score = 50; // Base

  // Activity recency: -10 per week of inactivity, max -30
  if (factors.activity_recency_days > 7) {
    score -= Math.min(30, Math.floor((factors.activity_recency_days - 7) / 7) * 10);
  }

  // Feature adoption: +20 for >50%, +10 for >25%
  if (factors.feature_adoption_pct > 50) score += 20;
  else if (factors.feature_adoption_pct > 25) score += 10;

  // Support tickets: -5 per open ticket, max -15
  score -= Math.min(15, factors.support_tickets_open * 5);

  // NPS: +15 for promoter (9-10), -10 for detractor (0-6)
  if (factors.nps_score !== null) {
    if (factors.nps_score >= 9) score += 15;
    else if (factors.nps_score <= 6) score -= 10;
  }

  // Payment failures: -20 per failure, max -40
  score -= Math.min(40, factors.payment_failures * 20);

  // Login frequency: +10 for daily+, +5 for 3+/week
  if (factors.login_frequency_weekly >= 5) score += 10;
  else if (factors.login_frequency_weekly >= 3) score += 5;

  return Math.max(0, Math.min(100, score));
}

/**
 * Update a customer's health score and derived risk metrics.
 */
export function refreshHealthScore(customerId: string, factors: HealthFactors): CustomerProfile | undefined {
  const profile = customers.get(customerId);
  if (!profile) return undefined;

  profile.health_score = calculateHealthScore(factors);

  // Derive churn risk from health score (inverse relationship)
  if (profile.health_score < 30) profile.churn_risk = 0.8;
  else if (profile.health_score < 50) profile.churn_risk = 0.5;
  else if (profile.health_score < 70) profile.churn_risk = 0.2;
  else profile.churn_risk = 0.05;

  // Derive expansion potential
  if (profile.health_score > 80 && profile.plan !== "enterprise") {
    profile.expansion_potential = 0.7;
  } else if (profile.health_score > 60) {
    profile.expansion_potential = 0.3;
  } else {
    profile.expansion_potential = 0.1;
  }

  profile.updated_at = new Date().toISOString();
  return profile;
}

// ─── Stage Transitions ────────────────────────────────────────────────────

/**
 * Transition a customer to a new lifecycle stage.
 * Returns the signal that triggered the transition.
 */
export function transitionStage(
  customerId: string,
  newStage: LifecycleStage,
  reason: string,
  agent: string
): { success: boolean; previous_stage?: LifecycleStage; reason?: string } {
  const profile = customers.get(customerId);
  if (!profile) return { success: false, reason: "Customer not found" };

  const previousStage = profile.stage;
  profile.stage = newStage;
  profile.updated_at = new Date().toISOString();

  // Record signal
  profile.signals.push({
    type: "stage_transition",
    value: `${previousStage}→${newStage}`,
    source: "lifecycle_engine",
    timestamp: new Date().toISOString(),
    agent,
  });

  // Mark activation
  if (newStage === "revenue" && !profile.activation_completed) {
    profile.activation_completed = true;
  }

  logger.info("Customer stage transition", {
    customer: customerId,
    from: previousStage,
    to: newStage,
    agent,
    reason,
  });

  return { success: true, previous_stage: previousStage };
}

/**
 * Add a signal to a customer profile.
 */
export function addCustomerSignal(
  customerId: string,
  signal: Omit<CustomerSignal, "timestamp">
): boolean {
  const profile = customers.get(customerId);
  if (!profile) return false;

  profile.signals.push({
    ...signal,
    timestamp: new Date().toISOString(),
  });

  // Keep only last 100 signals
  if (profile.signals.length > 100) {
    profile.signals = profile.signals.slice(-100);
  }

  return true;
}

// ─── Automation Rules ─────────────────────────────────────────────────────

export function createAutomationRule(input: {
  name: string;
  stage: LifecycleStage;
  trigger: AutomationTrigger;
  actions: AutomationAction[];
  assigned_agents: string[];
  priority?: number;
  cooldown_hours?: number;
}): AutomationRule {
  const rule: AutomationRule = {
    id: crypto.randomUUID(),
    name: input.name,
    stage: input.stage,
    trigger: input.trigger,
    actions: input.actions,
    assigned_agents: input.assigned_agents,
    enabled: true,
    priority: input.priority ?? 5,
    cooldown_hours: input.cooldown_hours ?? 24,
    execution_count: 0,
    success_count: 0,
    last_executed_at: null,
    created_at: new Date().toISOString(),
    version: 1,
  };

  automationRules.set(rule.id, rule);
  return rule;
}

export function getAutomationRule(id: string): AutomationRule | undefined {
  return automationRules.get(id);
}

export function listAutomationRules(stage?: LifecycleStage): AutomationRule[] {
  const all = Array.from(automationRules.values());
  if (stage) return all.filter((r) => r.stage === stage);
  return all.sort((a, b) => a.priority - b.priority);
}

export function toggleAutomationRule(id: string, enabled: boolean): boolean {
  const rule = automationRules.get(id);
  if (!rule) return false;
  rule.enabled = enabled;
  return true;
}

/**
 * Evaluate which automation rules should fire for a given customer.
 */
export function evaluateAutomationRules(customerId: string): Array<{
  rule: AutomationRule;
  matched: boolean;
  reason: string;
}> {
  const profile = customers.get(customerId);
  if (!profile) return [];

  const results: Array<{ rule: AutomationRule; matched: boolean; reason: string }> = [];

  for (const [, rule] of automationRules) {
    if (!rule.enabled) continue;
    if (rule.stage !== profile.stage) continue;

    // Check cooldown
    if (rule.last_executed_at) {
      const cooldownMs = rule.cooldown_hours * 60 * 60 * 1000;
      if (Date.now() - new Date(rule.last_executed_at).getTime() < cooldownMs) {
        continue; // Still in cooldown
      }
    }

    const matched = evaluateTrigger(rule.trigger, profile);
    results.push({
      rule,
      matched: matched.triggered,
      reason: matched.reason,
    });
  }

  return results.sort((a, b) => a.rule.priority - b.rule.priority);
}

function evaluateTrigger(
  trigger: AutomationTrigger,
  profile: CustomerProfile
): { triggered: boolean; reason: string } {
  switch (trigger.type) {
    case "health_score_drop": {
      const threshold = (trigger.conditions.threshold as number) ?? 40;
      if (profile.health_score < threshold) {
        return { triggered: true, reason: `Health score ${profile.health_score} < ${threshold}` };
      }
      return { triggered: false, reason: `Health score ${profile.health_score} >= ${threshold}` };
    }

    case "churn_risk": {
      const threshold = (trigger.conditions.threshold as number) ?? 0.5;
      if (profile.churn_risk >= threshold) {
        return { triggered: true, reason: `Churn risk ${profile.churn_risk} >= ${threshold}` };
      }
      return { triggered: false, reason: `Churn risk ${profile.churn_risk} < ${threshold}` };
    }

    case "inactivity": {
      const days = (trigger.conditions.days as number) ?? 14;
      if (!profile.last_active_at) {
        return { triggered: true, reason: "Never active" };
      }
      const inactiveDays = (Date.now() - new Date(profile.last_active_at).getTime()) / (1000 * 60 * 60 * 24);
      if (inactiveDays >= days) {
        return { triggered: true, reason: `Inactive ${Math.floor(inactiveDays)} days >= ${days}` };
      }
      return { triggered: false, reason: `Active ${Math.floor(inactiveDays)} days ago` };
    }

    case "expansion_signal": {
      const threshold = (trigger.conditions.threshold as number) ?? 0.5;
      if (profile.expansion_potential >= threshold) {
        return { triggered: true, reason: `Expansion potential ${profile.expansion_potential} >= ${threshold}` };
      }
      return { triggered: false, reason: `Expansion potential ${profile.expansion_potential} < ${threshold}` };
    }

    case "nps_response": {
      if (profile.nps_score === null) {
        return { triggered: false, reason: "No NPS score" };
      }
      const maxScore = (trigger.conditions.max_score as number) ?? 6;
      if (profile.nps_score <= maxScore) {
        return { triggered: true, reason: `NPS ${profile.nps_score} <= ${maxScore} (detractor)` };
      }
      return { triggered: false, reason: `NPS ${profile.nps_score} > ${maxScore}` };
    }

    case "signal_match": {
      const signalType = trigger.conditions.signal_type as string;
      const hasSignal = profile.signals.some((s) => s.type === signalType);
      return {
        triggered: hasSignal,
        reason: hasSignal ? `Signal "${signalType}" found` : `No signal "${signalType}"`,
      };
    }

    default:
      return { triggered: false, reason: "Unknown trigger type" };
  }
}

/**
 * Record execution of an automation rule (for tracking & evolution).
 */
export function recordRuleExecution(ruleId: string, customerId: string, success: boolean): void {
  const rule = automationRules.get(ruleId);
  if (!rule) return;

  rule.execution_count++;
  if (success) rule.success_count++;
  rule.last_executed_at = new Date().toISOString();

  ruleExecutionLog.push({
    rule_id: ruleId,
    customer_id: customerId,
    success,
    timestamp: new Date().toISOString(),
  });
}

// ─── Lifecycle Analytics ──────────────────────────────────────────────────

export interface LifecycleFunnel {
  total_customers: number;
  by_stage: Record<LifecycleStage, number>;
  avg_health_score: number;
  at_risk_count: number;
  expansion_candidates: number;
  avg_mrr_usd: number;
  total_mrr_usd: number;
}

export function getLifecycleFunnel(): LifecycleFunnel {
  const all = Array.from(customers.values());
  const byStage: Record<LifecycleStage, number> = {
    acquisition: 0,
    activation: 0,
    revenue: 0,
    retention: 0,
    referral: 0,
  };

  let totalHealth = 0;
  let atRisk = 0;
  let expansionCandidates = 0;
  let totalMrr = 0;

  for (const c of all) {
    byStage[c.stage]++;
    totalHealth += c.health_score;
    if (c.churn_risk >= 0.5) atRisk++;
    if (c.expansion_potential >= 0.5) expansionCandidates++;
    totalMrr += c.mrr_usd;
  }

  return {
    total_customers: all.length,
    by_stage: byStage,
    avg_health_score: all.length > 0 ? totalHealth / all.length : 0,
    at_risk_count: atRisk,
    expansion_candidates: expansionCandidates,
    avg_mrr_usd: all.length > 0 ? totalMrr / all.length : 0,
    total_mrr_usd: totalMrr,
  };
}

/**
 * Get customers in a specific lifecycle stage.
 */
export function getCustomersByStage(stage: LifecycleStage): CustomerProfile[] {
  return Array.from(customers.values())
    .filter((c) => c.stage === stage)
    .sort((a, b) => b.health_score - a.health_score);
}

/**
 * Get at-risk customers (churn_risk >= threshold).
 */
export function getAtRiskCustomers(threshold: number = 0.5): CustomerProfile[] {
  return Array.from(customers.values())
    .filter((c) => c.churn_risk >= threshold)
    .sort((a, b) => b.churn_risk - a.churn_risk);
}

/**
 * Get expansion candidates (high health, expansion_potential >= threshold).
 */
export function getExpansionCandidates(threshold: number = 0.5): CustomerProfile[] {
  return Array.from(customers.values())
    .filter((c) => c.expansion_potential >= threshold)
    .sort((a, b) => b.expansion_potential - a.expansion_potential);
}

/**
 * Get automation rule effectiveness stats.
 */
export function getAutomationStats(): {
  total_rules: number;
  enabled_rules: number;
  total_executions: number;
  overall_success_rate: number;
  by_stage: Record<LifecycleStage, { rules: number; executions: number; success_rate: number }>;
} {
  const rules = Array.from(automationRules.values());
  const byStage: Record<string, { rules: number; executions: number; successes: number }> = {};

  let totalExecutions = 0;
  let totalSuccesses = 0;

  for (const rule of rules) {
    if (!byStage[rule.stage]) byStage[rule.stage] = { rules: 0, executions: 0, successes: 0 };
    byStage[rule.stage].rules++;
    byStage[rule.stage].executions += rule.execution_count;
    byStage[rule.stage].successes += rule.success_count;
    totalExecutions += rule.execution_count;
    totalSuccesses += rule.success_count;
  }

  const stageStats: Record<string, { rules: number; executions: number; success_rate: number }> = {};
  for (const [stage, data] of Object.entries(byStage)) {
    stageStats[stage] = {
      rules: data.rules,
      executions: data.executions,
      success_rate: data.executions > 0 ? data.successes / data.executions : 0,
    };
  }

  return {
    total_rules: rules.length,
    enabled_rules: rules.filter((r) => r.enabled).length,
    total_executions: totalExecutions,
    overall_success_rate: totalExecutions > 0 ? totalSuccesses / totalExecutions : 0,
    by_stage: stageStats as Record<LifecycleStage, { rules: number; executions: number; success_rate: number }>,
  };
}

// ─── Exported Service ──────────────────────────────────────────────────────

export const scpCustomerLifecycle = {
  // Customer CRUD
  createCustomerProfile,
  getCustomerProfile,
  getCustomerByExternalId,
  updateCustomerProfile,
  // Health
  calculateHealthScore,
  refreshHealthScore,
  // Lifecycle
  transitionStage,
  addCustomerSignal,
  // Automation
  createAutomationRule,
  getAutomationRule,
  listAutomationRules,
  toggleAutomationRule,
  evaluateAutomationRules,
  recordRuleExecution,
  // Analytics
  getLifecycleFunnel,
  getCustomersByStage,
  getAtRiskCustomers,
  getExpansionCandidates,
  getAutomationStats,
};

// @ts-nocheck
/**
 * SCP v3 Financial Autonomy — Sovereign Company Protocol
 *
 * Unified financial model for AI-run company economics:
 *   - CompanyEconomics: single source of truth for P&L
 *   - AI operations cost tracking (LLM calls, integrations, compute)
 *   - Revenue tracking with MRR/ARR projections
 *   - Self-funding constraint (AI spend ≤ revenue × threshold)
 *   - Budget allocation per agent/category
 *   - Financial health monitoring with alerts
 */

import { logger } from "../utils/logger";
import crypto from "crypto";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface CompanyEconomics {
  // Revenue
  mrr_usd: number;
  arr_usd: number;
  total_customers: number;
  paying_customers: number;
  avg_revenue_per_customer_usd: number;

  // AI Operations Cost
  ai_spend_trailing_30d_usd: number;
  ai_spend_by_category: Record<string, number>;
  ai_spend_by_agent: Record<string, number>;

  // Other Costs
  infrastructure_cost_30d_usd: number;
  integration_cost_30d_usd: number;
  total_cost_30d_usd: number;

  // P&L
  gross_margin_pct: number;
  net_revenue_30d_usd: number;

  // Self-funding constraint
  ai_spend_ratio: number; // ai_spend / revenue — must stay below threshold
  self_funding_healthy: boolean;
  self_funding_threshold: number;

  // Projections
  burn_rate_daily_usd: number;
  runway_days: number | null; // null = profitable

  last_updated: string;
}

export interface CostEntry {
  id: string;
  category: "llm_call" | "integration" | "compute" | "storage" | "bandwidth" | "third_party";
  agent: string;
  description: string;
  amount_usd: number;
  timestamp: string;
  metadata: Record<string, unknown>;
}

export interface RevenueEntry {
  id: string;
  type: "subscription" | "one_time" | "usage" | "expansion" | "refund";
  customer_id: string;
  amount_usd: number;
  timestamp: string;
  metadata: Record<string, unknown>;
}

export interface BudgetAllocation {
  agent: string;
  monthly_budget_usd: number;
  spent_usd: number;
  remaining_usd: number;
  utilization_pct: number;
  alerts: string[];
}

// ─── Configuration ────────────────────────────────────────────────────────

const DEFAULT_SELF_FUNDING_THRESHOLD = 0.3; // AI spend must be ≤ 30% of revenue
const BUDGET_WARNING_THRESHOLD = 0.8; // Alert at 80% budget usage
const BUDGET_CRITICAL_THRESHOLD = 0.95; // Critical at 95%

// ─── In-Memory Ledger ─────────────────────────────────────────────────────

const costLedger: CostEntry[] = [];
const revenueLedger: RevenueEntry[] = [];
const agentBudgets = new Map<string, { monthly_budget_usd: number }>();
let selfFundingThreshold = DEFAULT_SELF_FUNDING_THRESHOLD;
let cashReserve = 0;

// ─── Cost Tracking ────────────────────────────────────────────────────────

/**
 * Record an AI operations cost.
 */
export function recordCost(entry: {
  category: CostEntry["category"];
  agent: string;
  description: string;
  amount_usd: number;
  metadata?: Record<string, unknown>;
}): CostEntry {
  const cost: CostEntry = {
    id: crypto.randomUUID(),
    category: entry.category,
    agent: entry.agent,
    description: entry.description,
    amount_usd: entry.amount_usd,
    timestamp: new Date().toISOString(),
    metadata: entry.metadata ?? {},
  };

  costLedger.push(cost);
  return cost;
}

/**
 * Record a revenue event.
 */
export function recordRevenue(entry: {
  type: RevenueEntry["type"];
  customer_id: string;
  amount_usd: number;
  metadata?: Record<string, unknown>;
}): RevenueEntry {
  const revenue: RevenueEntry = {
    id: crypto.randomUUID(),
    type: entry.type,
    customer_id: entry.customer_id,
    amount_usd: entry.amount_usd,
    timestamp: new Date().toISOString(),
    metadata: entry.metadata ?? {},
  };

  revenueLedger.push(revenue);
  return revenue;
}

// ─── Budget Management ────────────────────────────────────────────────────

/**
 * Set monthly budget for an agent.
 */
export function setAgentBudget(agent: string, monthlyBudgetUsd: number): void {
  agentBudgets.set(agent, { monthly_budget_usd: monthlyBudgetUsd });
}

/**
 * Get budget allocation for an agent.
 */
export function getAgentBudget(agent: string): BudgetAllocation {
  const budget = agentBudgets.get(agent);
  const monthlyBudget = budget?.monthly_budget_usd ?? 0;

  // Calculate spend in current 30-day window
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const spent = costLedger
    .filter((c) => c.agent === agent && new Date(c.timestamp).getTime() > thirtyDaysAgo)
    .reduce((s, c) => s + c.amount_usd, 0);

  const remaining = Math.max(0, monthlyBudget - spent);
  const utilization = monthlyBudget > 0 ? spent / monthlyBudget : 0;

  const alerts: string[] = [];
  if (utilization >= BUDGET_CRITICAL_THRESHOLD) {
    alerts.push("CRITICAL: Budget nearly exhausted");
  } else if (utilization >= BUDGET_WARNING_THRESHOLD) {
    alerts.push("WARNING: Budget usage high");
  }

  return {
    agent,
    monthly_budget_usd: monthlyBudget,
    spent_usd: spent,
    remaining_usd: remaining,
    utilization_pct: utilization * 100,
    alerts,
  };
}

/**
 * Check if an agent can afford a specific cost.
 */
export function canAfford(agent: string, amountUsd: number): {
  allowed: boolean;
  remaining_budget: number;
  reason?: string;
} {
  const budget = getAgentBudget(agent);

  if (budget.monthly_budget_usd === 0) {
    // No budget set — allow but warn
    return { allowed: true, remaining_budget: 0, reason: "No budget configured" };
  }

  if (budget.remaining_usd < amountUsd) {
    return {
      allowed: false,
      remaining_budget: budget.remaining_usd,
      reason: `Insufficient budget: need $${amountUsd.toFixed(2)}, have $${budget.remaining_usd.toFixed(2)}`,
    };
  }

  return { allowed: true, remaining_budget: budget.remaining_usd - amountUsd };
}

// ─── Self-Funding Constraint ──────────────────────────────────────────────

/**
 * Set the self-funding threshold (AI spend / revenue ratio).
 */
export function setSelfFundingThreshold(threshold: number): void {
  selfFundingThreshold = Math.max(0.01, Math.min(1.0, threshold));
}

/**
 * Set cash reserve for runway calculations.
 */
export function setCashReserve(amountUsd: number): void {
  cashReserve = Math.max(0, amountUsd);
}

/**
 * Check if the self-funding constraint is satisfied.
 */
export function checkSelfFunding(): {
  healthy: boolean;
  ai_spend_ratio: number;
  threshold: number;
  ai_spend_30d: number;
  revenue_30d: number;
} {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

  const aiSpend = costLedger
    .filter((c) => new Date(c.timestamp).getTime() > thirtyDaysAgo)
    .reduce((s, c) => s + c.amount_usd, 0);

  const revenue = revenueLedger
    .filter((r) => new Date(r.timestamp).getTime() > thirtyDaysAgo && r.type !== "refund")
    .reduce((s, r) => s + r.amount_usd, 0);

  const ratio = revenue > 0 ? aiSpend / revenue : (aiSpend > 0 ? Infinity : 0);

  return {
    healthy: ratio <= selfFundingThreshold,
    ai_spend_ratio: ratio,
    threshold: selfFundingThreshold,
    ai_spend_30d: aiSpend,
    revenue_30d: revenue,
  };
}

// ─── Company Economics ────────────────────────────────────────────────────

/**
 * Calculate the full CompanyEconomics snapshot.
 */
export function getCompanyEconomics(customerCount: number = 0, payingCount: number = 0): CompanyEconomics {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

  // Revenue
  const recentRevenue = revenueLedger.filter(
    (r) => new Date(r.timestamp).getTime() > thirtyDaysAgo
  );
  const grossRevenue = recentRevenue
    .filter((r) => r.type !== "refund")
    .reduce((s, r) => s + r.amount_usd, 0);
  const refunds = recentRevenue
    .filter((r) => r.type === "refund")
    .reduce((s, r) => s + Math.abs(r.amount_usd), 0);
  const netRevenue = grossRevenue - refunds;

  // MRR = subscription revenue in last 30 days
  const mrr = recentRevenue
    .filter((r) => r.type === "subscription")
    .reduce((s, r) => s + r.amount_usd, 0);

  // Costs
  const recentCosts = costLedger.filter(
    (c) => new Date(c.timestamp).getTime() > thirtyDaysAgo
  );
  const totalCosts = recentCosts.reduce((s, c) => s + c.amount_usd, 0);

  const byCategory: Record<string, number> = {};
  const byAgent: Record<string, number> = {};
  for (const c of recentCosts) {
    byCategory[c.category] = (byCategory[c.category] ?? 0) + c.amount_usd;
    byAgent[c.agent] = (byAgent[c.agent] ?? 0) + c.amount_usd;
  }

  const aiSpend = byCategory["llm_call"] ?? 0;
  const infraCost = (byCategory["compute"] ?? 0) + (byCategory["storage"] ?? 0) + (byCategory["bandwidth"] ?? 0);
  const integrationCost = byCategory["integration"] ?? 0;

  const grossMargin = netRevenue > 0 ? ((netRevenue - totalCosts) / netRevenue) * 100 : 0;
  const aiSpendRatio = netRevenue > 0 ? aiSpend / netRevenue : (aiSpend > 0 ? Infinity : 0);

  const burnRateDaily = totalCosts / 30;
  const dailyNet = netRevenue / 30 - burnRateDaily;
  const runway = dailyNet >= 0 ? null : cashReserve / Math.abs(dailyNet);

  return {
    mrr_usd: mrr,
    arr_usd: mrr * 12,
    total_customers: customerCount,
    paying_customers: payingCount,
    avg_revenue_per_customer_usd: payingCount > 0 ? mrr / payingCount : 0,

    ai_spend_trailing_30d_usd: aiSpend,
    ai_spend_by_category: byCategory,
    ai_spend_by_agent: byAgent,

    infrastructure_cost_30d_usd: infraCost,
    integration_cost_30d_usd: integrationCost,
    total_cost_30d_usd: totalCosts,

    gross_margin_pct: grossMargin,
    net_revenue_30d_usd: netRevenue,

    ai_spend_ratio: aiSpendRatio,
    self_funding_healthy: aiSpendRatio <= selfFundingThreshold,
    self_funding_threshold: selfFundingThreshold,

    burn_rate_daily_usd: burnRateDaily,
    runway_days: runway,

    last_updated: new Date().toISOString(),
  };
}

// ─── Financial Alerts ─────────────────────────────────────────────────────

export interface FinancialAlert {
  type: "budget_warning" | "budget_critical" | "self_funding_breach" | "cost_spike" | "revenue_drop";
  severity: "warning" | "critical";
  message: string;
  agent?: string;
  value: number;
  threshold: number;
}

/**
 * Check all financial health conditions and return alerts.
 */
export function getFinancialAlerts(): FinancialAlert[] {
  const alerts: FinancialAlert[] = [];

  // Check self-funding constraint
  const sf = checkSelfFunding();
  if (!sf.healthy && sf.ai_spend_30d > 0) {
    alerts.push({
      type: "self_funding_breach",
      severity: "critical",
      message: `AI spend ratio ${(sf.ai_spend_ratio * 100).toFixed(1)}% exceeds ${(sf.threshold * 100)}% threshold`,
      value: sf.ai_spend_ratio,
      threshold: sf.threshold,
    });
  }

  // Check per-agent budgets
  for (const [agent] of agentBudgets) {
    const budget = getAgentBudget(agent);
    if (budget.utilization_pct >= BUDGET_CRITICAL_THRESHOLD * 100) {
      alerts.push({
        type: "budget_critical",
        severity: "critical",
        message: `${agent} budget ${budget.utilization_pct.toFixed(0)}% utilized`,
        agent,
        value: budget.utilization_pct,
        threshold: BUDGET_CRITICAL_THRESHOLD * 100,
      });
    } else if (budget.utilization_pct >= BUDGET_WARNING_THRESHOLD * 100) {
      alerts.push({
        type: "budget_warning",
        severity: "warning",
        message: `${agent} budget ${budget.utilization_pct.toFixed(0)}% utilized`,
        agent,
        value: budget.utilization_pct,
        threshold: BUDGET_WARNING_THRESHOLD * 100,
      });
    }
  }

  return alerts;
}

// ─── Exported Service ──────────────────────────────────────────────────────

export const scpFinancialAutonomy = {
  // Cost & Revenue
  recordCost,
  recordRevenue,
  // Budgets
  setAgentBudget,
  getAgentBudget,
  canAfford,
  // Self-funding
  setSelfFundingThreshold,
  setCashReserve,
  checkSelfFunding,
  // Economics
  getCompanyEconomics,
  // Alerts
  getFinancialAlerts,
};

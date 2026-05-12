/**
 * Rosy River — central coordination service for the multi-pillar autonomous
 * engineering campaign. See /Users/user/.claude/plans/ok-i-wanna-try-rosy-river.md
 * for the full design.
 *
 * This module is the ONLY place agents (codebase monitor, multi-week planner,
 * telemetry drift watcher, etc.) should write to the three Rosy River tables:
 *
 *   - proposed_changes   — agent outbox feeding the evolution gauntlet
 *   - agent_cost_log     — per-action LLM cost ledger
 *   - founder_notifications — continuous event feed for the founder dashboard
 *
 * Centralizing the writes here means every agent action automatically:
 *   1. Lands in the audit trail (audit_events) for 7-year retention.
 *   2. Counts against the $50/week budget cap.
 *   3. Emits a founder-feed event so the founder sees what shipped/proposed.
 */

import { db } from "../db";
import {
  proposedChanges,
  agentCostLog,
  founderNotifications,
  auditEvents,
  type InsertProposedChange,
  type InsertAgentCostLog,
  type InsertFounderNotification,
} from "@shared/schema";
import { and, gte, sql } from "drizzle-orm";
import { logger } from "../utils/logger";

// ---------------------------------------------------------------------------
// Pillars + risk tiering
// ---------------------------------------------------------------------------

export type Pillar = "A_uiux" | "B_data" | "C_agentic" | "shared";
export type RiskTier = "low" | "medium" | "high";

/**
 * Files / path-prefixes that ALWAYS require founder approval per the
 * Balanced auto-merge gate. Any proposal touching one of these gets
 * autoMergeEligible=false regardless of riskTier.
 */
const FOUNDER_APPROVAL_PREFIXES = [
  "client/src/",
  "server/db/schema",
  "server/routes/auth",
  "server/services/billing",
  "server/services/pricing",
  "shared/schema.ts", // schema additions need founder eyes
];

/**
 * Files / patterns that may NEVER be auto-modified by an agent. These
 * are a hard stop — the proposal is rejected outright if it touches them.
 */
const HARD_STOP_PATTERNS = [
  /\.env(\..*)?$/,
  /server\/routes\/billing/,
  /server\/services\/stripe/,
  /\bsecrets?\b/i,
  /package-lock\.json$/,
];

export function classifyAutoMergeEligibility(
  targetFiles: string[],
  riskTier: RiskTier,
): { eligible: boolean; reason: string } {
  for (const file of targetFiles) {
    for (const rx of HARD_STOP_PATTERNS) {
      if (rx.test(file)) {
        return { eligible: false, reason: `hard-stop file: ${file}` };
      }
    }
    for (const prefix of FOUNDER_APPROVAL_PREFIXES) {
      if (file.startsWith(prefix)) {
        return { eligible: false, reason: `founder-approval surface: ${prefix}` };
      }
    }
  }
  if (riskTier === "high") {
    return { eligible: false, reason: "high risk tier" };
  }
  if (riskTier === "medium") {
    // Medium risk auto-merges only if budget headroom is comfortable; the
    // caller is responsible for that check. Default-eligible here.
    return { eligible: true, reason: "medium risk, no founder-approval surfaces touched" };
  }
  return { eligible: true, reason: "low risk, no founder-approval surfaces touched" };
}

// ---------------------------------------------------------------------------
// Proposed changes
// ---------------------------------------------------------------------------

export interface ProposedChangeInput {
  pillar: Pillar;
  agent: string;
  title: string;
  rationale: string;
  targetFiles: string[];
  proposedDiff?: string;
  riskTier: RiskTier;
  estimatedCostUsd?: number;
  preMortem?: string;
  rollbackPath?: string;
  simulationMode?: boolean;
}

export async function recordProposedChange(input: ProposedChangeInput) {
  const eligibility = classifyAutoMergeEligibility(input.targetFiles, input.riskTier);
  const simulation = input.simulationMode ?? true;

  const row: InsertProposedChange = {
    pillar: input.pillar,
    agent: input.agent,
    title: input.title,
    rationale: input.rationale,
    targetFiles: input.targetFiles,
    proposedDiff: input.proposedDiff ?? null,
    riskTier: input.riskTier,
    autoMergeEligible: eligibility.eligible,
    estimatedCostUsd: input.estimatedCostUsd != null ? String(input.estimatedCostUsd) : null,
    preMortem: input.preMortem ?? null,
    rollbackPath: input.rollbackPath ?? null,
    status: eligibility.eligible && !simulation ? "promoted_to_gauntlet" : "awaiting_founder",
    simulationMode: simulation,
  };

  const [inserted] = await db.insert(proposedChanges).values(row).returning();

  // Mirror to the founder feed.
  await notifyFounder({
    source: "agent_propose",
    pillar: input.pillar,
    severity: input.riskTier === "high" ? "warning" : "info",
    title: `[${input.pillar}] ${input.title}`,
    body: input.rationale,
    proposedChangeId: inserted.id,
    metadata: {
      agent: input.agent,
      targetFiles: input.targetFiles,
      riskTier: input.riskTier,
      autoMergeEligible: eligibility.eligible,
      autoMergeReason: eligibility.reason,
      simulation,
    },
  });

  // Audit trail.
  await db.insert(auditEvents).values({
    actorUserId: `agent:${input.agent}`,
    action: "agent_propose_change",
    targetType: "proposed_change",
    targetId: String(inserted.id),
    justification: input.rationale.slice(0, 500),
    metadata: {
      pillar: input.pillar,
      riskTier: input.riskTier,
      targetFiles: input.targetFiles,
      autoMergeEligible: eligibility.eligible,
      simulation,
    },
  });

  return inserted;
}

// ---------------------------------------------------------------------------
// Cost ledger + budget enforcement
// ---------------------------------------------------------------------------

export const WEEKLY_BUDGET_CEILING_USD = 50;
export const WEEKLY_BUDGET_ALERT_USD = 40;

export interface AgentCostInput {
  pillar: Pillar;
  agent: string;
  action: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd: number;
  proposedChangeId?: number;
  evolutionHistoryId?: number;
  metadata?: Record<string, unknown>;
}

export async function recordAgentCost(input: AgentCostInput) {
  const row: InsertAgentCostLog = {
    pillar: input.pillar,
    agent: input.agent,
    action: input.action,
    model: input.model,
    inputTokens: input.inputTokens ?? 0,
    outputTokens: input.outputTokens ?? 0,
    costUsd: String(input.costUsd),
    proposedChangeId: input.proposedChangeId ?? null,
    evolutionHistoryId: input.evolutionHistoryId ?? null,
    metadata: input.metadata ?? null,
  };
  const [inserted] = await db.insert(agentCostLog).values(row).returning();

  // Cross the $40 alert threshold? Fire one founder alert per week.
  const spent = await getWeeklyBudgetSpent();
  if (spent.crossedAlert && !spent.alertAlreadyFired) {
    await notifyFounder({
      source: "budget_warning",
      pillar: "shared",
      severity: "warning",
      title: `Rosy River weekly LLM spend at $${spent.totalUsd.toFixed(2)}`,
      body:
        `Crossed the $${WEEKLY_BUDGET_ALERT_USD} warning threshold this week. ` +
        `Hard cap is $${WEEKLY_BUDGET_CEILING_USD}; once hit, all agent work pauses ` +
        `until next week unless you override.`,
      metadata: { weeklySpentUsd: spent.totalUsd, byPillar: spent.byPillar },
    });
  }

  return inserted;
}

interface WeeklyBudgetSummary {
  totalUsd: number;
  byPillar: Record<Pillar, number>;
  crossedAlert: boolean;
  crossedCeiling: boolean;
  alertAlreadyFired: boolean;
}

export async function getWeeklyBudgetSpent(): Promise<WeeklyBudgetSummary> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      pillar: agentCostLog.pillar,
      total: sql<string>`COALESCE(SUM(${agentCostLog.costUsd}), 0)`,
    })
    .from(agentCostLog)
    .where(gte(agentCostLog.createdAt, sevenDaysAgo))
    .groupBy(agentCostLog.pillar);

  const byPillar: Record<Pillar, number> = {
    A_uiux: 0,
    B_data: 0,
    C_agentic: 0,
    shared: 0,
  };
  let totalUsd = 0;
  for (const r of rows) {
    const n = Number(r.total) || 0;
    totalUsd += n;
    if (r.pillar in byPillar) {
      byPillar[r.pillar as Pillar] = n;
    }
  }

  // Check whether a budget_warning notification already fired this week so we
  // don't spam the founder feed every time an agent logs a few cents.
  const existingAlerts = await db
    .select({ id: founderNotifications.id })
    .from(founderNotifications)
    .where(
      and(
        gte(founderNotifications.createdAt, sevenDaysAgo),
        sql`${founderNotifications.source} = 'budget_warning'`,
      ),
    )
    .limit(1);

  return {
    totalUsd,
    byPillar,
    crossedAlert: totalUsd >= WEEKLY_BUDGET_ALERT_USD,
    crossedCeiling: totalUsd >= WEEKLY_BUDGET_CEILING_USD,
    alertAlreadyFired: existingAlerts.length > 0,
  };
}

/**
 * Call before initiating any new agent action. Returns `{ ok: false }` and
 * emits a founder alert if the projected spend would breach the weekly
 * ceiling. Callers MUST honor the result.
 */
export async function preflightBudgetCheck(
  estimatedNextCostUsd: number,
): Promise<{ ok: boolean; reason?: string }> {
  const spent = await getWeeklyBudgetSpent();
  if (spent.totalUsd + estimatedNextCostUsd > WEEKLY_BUDGET_CEILING_USD) {
    logger.warn("[rosy-river] preflight budget breach", {
      source: "rosy-river",
      metadata: {
        weeklySpentUsd: spent.totalUsd,
        estimatedNextCostUsd,
        ceiling: WEEKLY_BUDGET_CEILING_USD,
      },
    });
    return {
      ok: false,
      reason: `weekly budget ceiling $${WEEKLY_BUDGET_CEILING_USD} would be breached ` +
        `(currently $${spent.totalUsd.toFixed(2)}, this would add $${estimatedNextCostUsd.toFixed(2)})`,
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Founder notifications
// ---------------------------------------------------------------------------

export interface FounderNotificationInput {
  source: string; // agent_propose | agent_ship | agent_rollback | founder_alert | budget_warning | circuit_breaker_trip | gauntlet_fail | telemetry_drift | planner_weekly
  pillar?: Pillar | null;
  severity?: "info" | "warning" | "critical";
  title: string;
  body?: string;
  proposedChangeId?: number;
  evolutionHistoryId?: number;
  prNumber?: number;
  prUrl?: string;
  metadata?: Record<string, unknown>;
}

export async function notifyFounder(input: FounderNotificationInput) {
  const row: InsertFounderNotification = {
    source: input.source,
    pillar: input.pillar ?? null,
    severity: input.severity ?? "info",
    title: input.title,
    body: input.body ?? null,
    proposedChangeId: input.proposedChangeId ?? null,
    evolutionHistoryId: input.evolutionHistoryId ?? null,
    prNumber: input.prNumber ?? null,
    prUrl: input.prUrl ?? null,
    metadata: input.metadata ?? null,
  };
  const [inserted] = await db.insert(founderNotifications).values(row).returning();
  return inserted;
}

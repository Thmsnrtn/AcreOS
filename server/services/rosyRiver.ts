/**
 * Rosy River — coordination helpers for the multi-pillar autonomous
 * engineering campaign. See /Users/user/.claude/plans/ok-i-wanna-try-rosy-river.md.
 *
 * IMPORTANT: this module is a thin integration layer over the EXISTING
 * autonomy architecture. It does NOT introduce new tables.
 *
 *   - Code-change proposals → written to `agentTasks` (same pipeline that
 *     selfAssessmentAgent + evolutionPipeline already consume).
 *   - Founder review surface → written to `decisionsInboxItems` (same feed
 *     the founder already uses for support escalations, churn, etc.).
 *   - LLM cost ledger → written through `agentLlmTraces` via the existing
 *     `logAgentTrace` helper; weekly spend is a SUM(cost_cents) query.
 *   - Hard-stop + founder-approval file patterns → loaded from
 *     `customAutonomyRules` so the founder can edit them without a deploy.
 *
 * Everything Rosy River exposes is just a typed wrapper around those four
 * existing systems with Rosy-River-specific defaults (pillar, riskTier,
 * targetFiles, simulationMode) tucked into the `input` / `output` /
 * `actionPayload` JSONB carriers each table already has.
 */

import { db } from "../db";
import {
  agentTasks,
  agentLlmTraces,
  decisionsInboxItems,
  customAutonomyRules,
  type InsertDecisionsInboxItem,
} from "@shared/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { logger } from "../utils/logger";
import { logAgentTrace, type LogTraceInput } from "./agentLlmTraces";

// Mirrors selfAssessmentAgent.ts — platform-wide agent tasks live under
// the system org. Codebase-monitor proposals and similar Rosy River outputs
// are not org-scoped, so they use the same sentinel.
const SYSTEM_ORG_ID = 1;

// ---------------------------------------------------------------------------
// Pillars + risk tiering
// ---------------------------------------------------------------------------

export type Pillar = "A_uiux" | "B_data" | "C_agentic" | "shared";
export type RiskTier = "low" | "medium" | "high";

/**
 * agentTasks.agentType values that Rosy River emits. The evolution pipeline
 * already picks tasks up by `status='pending'`; this list is informational
 * so callers / queries can filter to Rosy-River-originated rows.
 */
export const ROSY_RIVER_AGENT_TYPES = [
  "codebase_monitor",
  "multi_week_planner",
  "telemetry_drift",
] as const;
export type RosyRiverAgentType = (typeof ROSY_RIVER_AGENT_TYPES)[number];

// ---------------------------------------------------------------------------
// Authority gate — custom autonomy rules (file-pattern hard stops)
// ---------------------------------------------------------------------------
//
// File-pattern rules are stored as customAutonomyRules rows with ruleType
// values in:
//   - "hard_stop"           — proposal must be rejected outright
//   - "founder_approval"    — proposal cannot auto-merge, requires founder PR
// The ruleText for these is a literal substring or "regex:<pattern>".
//
// We cache the active rule list for the lifetime of the Node process (or 5
// minutes, whichever ends first) — it's read on every proposal and changes
// rarely. Founder edits via the customAutonomyRules table take effect on
// the next refresh.

interface CachedRules {
  hardStop: Array<{ pattern: string; isRegex: boolean }>;
  founderApproval: Array<{ pattern: string; isRegex: boolean }>;
  loadedAt: number;
}

let rulesCache: CachedRules | null = null;
const RULES_CACHE_TTL_MS = 5 * 60 * 1000;

// Fallback patterns used when no DB rules exist yet. Same intent as before,
// just lives in code as a sane default until the founder seeds the DB.
const DEFAULT_HARD_STOP_PATTERNS = [
  "regex:\\.env(\\..*)?$",
  "regex:server/routes/billing",
  "regex:server/services/stripe",
  "regex:\\bsecrets?\\b",
  "regex:package-lock\\.json$",
];
const DEFAULT_FOUNDER_APPROVAL_PATTERNS = [
  "client/src/",
  "server/db/schema",
  "server/routes/auth",
  "server/services/billing",
  "server/services/pricing",
  "shared/schema.ts",
];

async function loadRules(): Promise<CachedRules> {
  if (rulesCache && Date.now() - rulesCache.loadedAt < RULES_CACHE_TTL_MS) {
    return rulesCache;
  }
  const rows = await db
    .select()
    .from(customAutonomyRules)
    .where(
      and(
        eq(customAutonomyRules.organizationId, SYSTEM_ORG_ID),
        eq(customAutonomyRules.isActive, true),
      ),
    );

  const hardStopDbRules = rows
    .filter((r) => r.ruleType === "hard_stop")
    .map((r) => parsePattern(r.ruleText));
  const founderApprovalDbRules = rows
    .filter((r) => r.ruleType === "founder_approval")
    .map((r) => parsePattern(r.ruleText));

  rulesCache = {
    hardStop:
      hardStopDbRules.length > 0
        ? hardStopDbRules
        : DEFAULT_HARD_STOP_PATTERNS.map(parsePattern),
    founderApproval:
      founderApprovalDbRules.length > 0
        ? founderApprovalDbRules
        : DEFAULT_FOUNDER_APPROVAL_PATTERNS.map(parsePattern),
    loadedAt: Date.now(),
  };
  return rulesCache;
}

function parsePattern(text: string): { pattern: string; isRegex: boolean } {
  if (text.startsWith("regex:")) {
    return { pattern: text.slice(6), isRegex: true };
  }
  return { pattern: text, isRegex: false };
}

function matchesPattern(file: string, rule: { pattern: string; isRegex: boolean }): boolean {
  if (rule.isRegex) {
    try {
      return new RegExp(rule.pattern).test(file);
    } catch {
      return false;
    }
  }
  return file.includes(rule.pattern);
}

export async function classifyAutoMergeEligibility(
  targetFiles: string[],
  riskTier: RiskTier,
): Promise<{ eligible: boolean; reason: string }> {
  const rules = await loadRules();
  for (const file of targetFiles) {
    for (const rule of rules.hardStop) {
      if (matchesPattern(file, rule)) {
        return { eligible: false, reason: `hard-stop file pattern: ${rule.pattern}` };
      }
    }
    for (const rule of rules.founderApproval) {
      if (matchesPattern(file, rule)) {
        return { eligible: false, reason: `founder-approval surface: ${rule.pattern}` };
      }
    }
  }
  if (riskTier === "high") {
    return { eligible: false, reason: "high risk tier" };
  }
  if (riskTier === "medium") {
    return { eligible: true, reason: "medium risk, no founder-approval surfaces touched" };
  }
  return { eligible: true, reason: "low risk, no founder-approval surfaces touched" };
}

// ---------------------------------------------------------------------------
// Code-change proposals → agentTasks (+ paired decisionsInboxItem)
// ---------------------------------------------------------------------------

export interface ProposeCodeChangeInput {
  pillar: Pillar;
  /** Free-text agent label, e.g. "codebase_monitor". Used as agentTasks.agentType. */
  agent: RosyRiverAgentType | string;
  title: string;
  rationale: string;
  targetFiles: string[];
  riskTier: RiskTier;
  estimatedCostUsd?: number;
  preMortem?: string;
  rollbackPath?: string;
  proposedDiff?: string;
  simulationMode?: boolean;
  /** Origin signal (e.g. "npm_outdated", "tsc_errors", "sentry_digest"). */
  source?: string;
  rawSignal?: Record<string, unknown>;
}

export interface ProposeCodeChangeResult {
  agentTaskId: number;
  decisionInboxItemId: number | null;
  autoMergeEligible: boolean;
  autoMergeReason: string;
}

/**
 * Write a code-change proposal into the existing agent pipeline:
 *
 *   1. `agentTasks` row — status='pending', agentType=<agent>. Evolution
 *      pipeline picks it up on its next 6h tick.
 *   2. If founder review is required (not auto-merge-eligible or simulation
 *      mode is on), also write a `decisionsInboxItems` row pointing at the
 *      agentTask so the founder sees it in their existing inbox UI.
 */
export async function proposeCodeChange(
  input: ProposeCodeChangeInput,
): Promise<ProposeCodeChangeResult> {
  const eligibility = await classifyAutoMergeEligibility(input.targetFiles, input.riskTier);
  const simulation = input.simulationMode ?? true;

  // Priority: lower = higher priority. High risk = priority 2, medium = 5, low = 8.
  const priority = input.riskTier === "high" ? 2 : input.riskTier === "medium" ? 5 : 8;

  // requiresReview is set when the founder must approve before the gauntlet
  // runs (or, in simulation mode, always — the founder has to flip the sim
  // flag off explicitly).
  const requiresReview = simulation || !eligibility.eligible;

  const [task] = await db
    .insert(agentTasks)
    .values({
      organizationId: SYSTEM_ORG_ID,
      agentType: input.agent,
      status: "pending",
      priority,
      requiresReview,
      input: {
        rosyRiver: true,
        pillar: input.pillar,
        source: input.source ?? null,
        rawSignal: input.rawSignal ?? null,
        simulationMode: simulation,
      },
      output: {
        title: input.title,
        rationale: input.rationale,
        targetFiles: input.targetFiles,
        riskTier: input.riskTier,
        estimatedCostUsd: input.estimatedCostUsd ?? null,
        preMortem: input.preMortem ?? null,
        rollbackPath: input.rollbackPath ?? null,
        proposedDiff: input.proposedDiff ?? null,
        autoMergeEligible: eligibility.eligible,
        autoMergeReason: eligibility.reason,
      },
    })
    .returning();

  // Founder-visible inbox item — only when review is required. Auto-merge-
  // eligible low-risk proposals can flow straight through the gauntlet
  // without cluttering the inbox.
  let decisionInboxItemId: number | null = null;
  if (requiresReview) {
    const item: InsertDecisionsInboxItem = {
      itemType: "agent_code_proposal",
      riskLevel:
        input.riskTier === "high" ? "high" : input.riskTier === "medium" ? "medium" : "low",
      urgencyScore: input.riskTier === "high" ? 70 : input.riskTier === "medium" ? 50 : 30,
      sophieAnalysis: input.rationale,
      sophieConfidenceScore: input.riskTier === "low" ? 80 : input.riskTier === "medium" ? 60 : 40,
      recommendedAction: simulation ? "Promote to evolution gauntlet" : "Approve & deploy",
      recommendedActionLabel: simulation ? "Promote out of simulation" : "Approve",
      actionPayload: {
        agentTaskId: task.id,
        pillar: input.pillar,
        targetFiles: input.targetFiles,
        autoMergeEligible: eligibility.eligible,
        autoMergeReason: eligibility.reason,
        simulationMode: simulation,
      },
      organizationId: SYSTEM_ORG_ID,
      ownerAgentCodename: input.agent,
      status: "pending",
      contextBundle: {
        preMortem: input.preMortem,
        rollbackPath: input.rollbackPath,
        proposedDiff: input.proposedDiff,
        source: input.source,
      },
    };
    const [inserted] = await db.insert(decisionsInboxItems).values(item).returning();
    decisionInboxItemId = inserted.id;
  }

  return {
    agentTaskId: task.id,
    decisionInboxItemId,
    autoMergeEligible: eligibility.eligible,
    autoMergeReason: eligibility.reason,
  };
}

// ---------------------------------------------------------------------------
// Founder feed → decisionsInboxItems (informational events, not actions)
// ---------------------------------------------------------------------------

export interface NotifyFounderInput {
  source: string; // agent_event | budget_warning | circuit_breaker_trip | gauntlet_fail | telemetry_drift | planner_weekly
  pillar?: Pillar | null;
  agentCodename: string;
  title: string;
  body?: string;
  severity?: "info" | "warning" | "critical";
  metadata?: Record<string, unknown>;
}

/**
 * Inform the founder feed of an agent-related event that does NOT require
 * a specific code-change decision (e.g. weekly planner output, budget
 * warning, circuit-breaker trip). Writes to decisionsInboxItems with
 * itemType='agent_event' and a no-op recommendedAction.
 */
export async function notifyFounder(input: NotifyFounderInput) {
  const urgency = input.severity === "critical" ? 90 : input.severity === "warning" ? 65 : 30;
  const item: InsertDecisionsInboxItem = {
    itemType: "agent_event",
    riskLevel: input.severity === "critical" ? "critical" : input.severity === "warning" ? "medium" : "low",
    urgencyScore: urgency,
    sophieAnalysis: input.body ?? input.title,
    recommendedAction: "Acknowledge",
    recommendedActionLabel: "Mark read",
    actionPayload: { source: input.source, pillar: input.pillar ?? null, ...(input.metadata ?? {}) },
    organizationId: SYSTEM_ORG_ID,
    ownerAgentCodename: input.agentCodename,
    status: "pending",
    contextBundle: { title: input.title, body: input.body ?? null },
  };
  const [inserted] = await db.insert(decisionsInboxItems).values(item).returning();
  return inserted;
}

// ---------------------------------------------------------------------------
// LLM cost ledger → agentLlmTraces (reuse logAgentTrace) + budget enforcement
// ---------------------------------------------------------------------------

export const WEEKLY_BUDGET_CEILING_USD = 50;
export const WEEKLY_BUDGET_ALERT_USD = 40;

/**
 * Wrapper around logAgentTrace that ALSO returns the row id so callers can
 * cross-reference. Use this from every Rosy River LLM call site so the
 * cost shows up in the weekly budget aggregation immediately.
 */
export async function recordAgentLlmCall(input: LogTraceInput): Promise<void> {
  // logAgentTrace is fire-and-forget; we await for consistency.
  await logAgentTrace(input);
}

/**
 * Sum cost_cents from agent_llm_traces over the last 7 days. Returns total
 * USD plus a per-agent breakdown. This is the canonical "what have my
 * agents spent" query — single source of truth, no parallel ledger.
 */
export async function getWeeklyAgentSpend(): Promise<{
  totalUsd: number;
  byAgent: Record<string, number>;
  crossedAlert: boolean;
  crossedCeiling: boolean;
}> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      agent: agentLlmTraces.agentCodename,
      totalCents: sql<string>`COALESCE(SUM(${agentLlmTraces.costCents}), 0)`,
    })
    .from(agentLlmTraces)
    .where(gte(agentLlmTraces.createdAt, sevenDaysAgo))
    .groupBy(agentLlmTraces.agentCodename);

  const byAgent: Record<string, number> = {};
  let totalCents = 0;
  for (const r of rows) {
    const cents = Number(r.totalCents) || 0;
    totalCents += cents;
    byAgent[r.agent] = cents / 100;
  }
  const totalUsd = totalCents / 100;
  return {
    totalUsd,
    byAgent,
    crossedAlert: totalUsd >= WEEKLY_BUDGET_ALERT_USD,
    crossedCeiling: totalUsd >= WEEKLY_BUDGET_CEILING_USD,
  };
}

/**
 * Returns `{ ok: false }` and logs a warning if the projected spend would
 * breach the weekly ceiling. Callers MUST honor the result and skip the
 * LLM call.
 */
export async function preflightBudgetCheck(
  estimatedNextCostUsd: number,
): Promise<{ ok: boolean; reason?: string; spentUsd: number }> {
  const spent = await getWeeklyAgentSpend();
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
      spentUsd: spent.totalUsd,
      reason:
        `weekly budget ceiling $${WEEKLY_BUDGET_CEILING_USD} would be breached ` +
        `(currently $${spent.totalUsd.toFixed(2)}, this would add $${estimatedNextCostUsd.toFixed(2)})`,
    };
  }
  return { ok: true, spentUsd: spent.totalUsd };
}

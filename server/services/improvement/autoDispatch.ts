/**
 * IMPROVEMENT — auto-dispatch guardrails for detector-surfaced opportunities.
 *
 * The detector layer (./detector.ts) persists every improvement opportunity
 * it finds. evaluateForAutoDispatch checks five guardrails and, when all
 * pass, enqueues a real dispatch on the solene_dispatch_queue (the worker
 * loop in server/services/solene/dispatchRunner.ts drains the queue and
 * invokes the agent). When ANY guardrail fails — or when the enqueue
 * itself throws — the opportunity row is left with auto_dispatched=false
 * so it surfaces in /api/founder/team-improvement/pending for
 * Solene-in-the-loop review.
 *
 * Guardrails (all must pass — fail-loud, not fail-quiet):
 *
 *   G1. Per-member 24h ceiling — max 1 auto-dispatched improvement per
 *       team_member per rolling 24h. Prevents a flapping detector from
 *       chewing the envelope.
 *
 *   G2. Confidence floor — confidence ≥ 0.85. Ambiguous opportunities
 *       (≤ 0.84) go to Solene-in-the-loop, never auto.
 *
 *   G3. Cost cap — estimated_cost_usd ≤ $50 AND month-to-date capital
 *       envelope has room for this charge (queries capitalTracker for the
 *       current envelope status). Both conditions must be satisfied.
 *
 *   G4. Severity gate — severity ∈ {opportunity, urgent}. 'info'-level
 *       opportunities (volume-threshold tier crossings) never auto-fire;
 *       they're informational only.
 *
 *   G5. Core-architecture-change block — opportunities whose description
 *       mentions a schema-changing / migration / constitutional surface go
 *       straight to founder approval. Belt-and-suspenders on top of cost.
 *
 * Wiring (Phase 2 — landed):
 *
 *   - All five guardrails fire BEFORE enqueueDispatch is called.
 *   - On pass, enqueueDispatch from ../solene/dispatchQueue persists a
 *     queued row; the production worker drains via dispatchRunner.
 *   - The opportunity row is then marked auto_dispatched=true with
 *     dispatched_agent_id='dispatch:<id>' linking back to the queue row.
 *   - If enqueueDispatch throws (DB unreachable, cost-cap violation at
 *     the queue layer, etc.) the error is logged and the opportunity row
 *     is NOT marked dispatched — it surfaces in the founder pending queue
 *     just like a guardrail failure.
 *
 * team_member -> agent_role mapping:
 *   iris/soren/beatrice/krieger pass through verbatim. 'solene' maps to
 *   'general-purpose' — Solene orchestrates the team but isn't herself a
 *   worker role on the dispatch queue (by design). Anything unrecognized
 *   also falls back to 'general-purpose'.
 */

import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  teamImprovementOpportunities,
  type TeamImprovementOpportunity,
  type TeamImprovementMember,
} from "@shared/schema/team-improvement";
import { getMonthlyEnvelopeStatus } from "../solene/capitalTracker";
import { enqueueDispatch } from "../solene/dispatchQueue";
import type { SoleneDispatchAgentRole } from "@shared/schema/solene-dispatch";
import { logger } from "../../utils/logger";

// ============================================================================
// CONSTANTS — guardrail thresholds. Exposed for test injection.
// ============================================================================

export const AUTO_DISPATCH_CONFIDENCE_FLOOR = 0.85;
export const AUTO_DISPATCH_COST_CEILING_USD = 50;
export const AUTO_DISPATCH_PER_MEMBER_24H_CEILING = 1;

// Core-architecture-change phrases — when description matches any, route
// to founder approval rather than auto-dispatching.
const CORE_ARCHITECTURE_BLOCK_PATTERNS: RegExp[] = [
  /\bschema[-_ ]?chang(e|ing)\b/i,
  /\bmigration\b/i,
  /\bdrop\s+(table|column|index)\b/i,
  /\bconstitution(al)?\b/i,
  /\bcharter\b/i,
  /\bkill\s+switch\b/i,
  /\bpricing\s+tier\b/i,
  /\bpartnership\b/i,
  /\b\$5,?000\b/i, // per-transaction cap surface
];

// ============================================================================
// PUBLIC TYPES
// ============================================================================

export type GuardrailName =
  | "per_member_24h_ceiling"
  | "confidence_floor"
  | "cost_cap"
  | "envelope_room"
  | "severity_gate"
  | "core_architecture_block";

export interface GuardrailEvaluation {
  passed: boolean;
  failed: GuardrailName[];
  details: Partial<Record<GuardrailName, string>>;
}

export interface AutoDispatchResult {
  opportunityId: number;
  dispatched: boolean;
  /**
   * Retained on the response shape for backwards-compat with any caller
   * still keying off it. Always false now that the real queue is wired.
   */
  simulated: boolean;
  agentId: string | null;
  dispatchId: number | null;
  evaluation: GuardrailEvaluation;
  promptSummary?: string;
  enqueueError?: string;
}

// ============================================================================
// evaluateForAutoDispatch — guardrail check + real enqueueDispatch.
// ============================================================================

export async function evaluateForAutoDispatch(
  opportunity: TeamImprovementOpportunity,
  opts: {
    /** Inject a fixed clock for tests. */
    now?: Date;
    /** Inject an envelope reader for tests. */
    getEnvelopeStatus?: () => Promise<{
      envelopeUsd: number;
      monthToDateUsd: number;
      percentUsed: number;
    }>;
    /** Inject a per-member 24h counter for tests. */
    countMemberDispatchesLast24h?: (
      member: TeamImprovementMember,
      cutoff: Date,
    ) => Promise<number>;
    /** Inject the queue enqueuer for tests. Defaults to the real enqueueDispatch. */
    enqueue?: typeof enqueueDispatch;
    /** Bypass the side effect of persisting the dispatch (test-only). */
    dryRun?: boolean;
  } = {},
): Promise<AutoDispatchResult> {
  const now = opts.now ?? new Date();
  const evaluation = await runGuardrails(opportunity, now, opts);

  if (!evaluation.passed) {
    logger.info(
      `[autoDispatch] opportunity ${opportunity.id} guardrails-failed; queued for Solene review (failed=${evaluation.failed.join(",")})`,
    );
    return {
      opportunityId: opportunity.id,
      dispatched: false,
      simulated: false,
      agentId: null,
      dispatchId: null,
      evaluation,
    };
  }

  const promptText = buildDispatchPrompt(opportunity);
  const agentRole = mapTeamMemberToAgentRole(opportunity.teamMember);
  const maxCostUsd =
    opportunity.estimatedCostUsd !== null
      ? Number(opportunity.estimatedCostUsd)
      : 25;
  const priority = opportunity.severity === "urgent" ? 2.0 : 1.0;

  if (opts.dryRun) {
    return {
      opportunityId: opportunity.id,
      dispatched: true,
      simulated: false,
      agentId: null,
      dispatchId: null,
      evaluation,
      promptSummary: promptText,
    };
  }

  const enqueueFn = opts.enqueue ?? enqueueDispatch;
  let dispatchId: number;
  try {
    dispatchId = await enqueueFn({
      sourceType: "auto_dispatch",
      sourceId: `improvement:${opportunity.id}`,
      agentRole,
      promptText,
      maxCostUsd: maxCostUsd > 0 ? maxCostUsd : 25,
      timeoutMs: 10 * 60 * 1000,
      priority,
      enqueuedBy: "autoDispatch",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      `[autoDispatch] enqueueDispatch failed for opportunity ${opportunity.id} member=${opportunity.teamMember} role=${agentRole}: ${message}`,
      err instanceof Error ? err : undefined,
    );
    return {
      opportunityId: opportunity.id,
      dispatched: false,
      simulated: false,
      agentId: null,
      dispatchId: null,
      evaluation,
      promptSummary: promptText,
      enqueueError: message,
    };
  }

  const agentId = `dispatch:${dispatchId}`;

  logger.info(
    `[autoDispatch] AUTO-DISPATCHED opportunity ${opportunity.id} member=${opportunity.teamMember} role=${agentRole} pattern=${opportunity.signalPattern} dispatch_id=${dispatchId} prompt_chars=${promptText.length}`,
    {
      metadata: {
        opportunityId: opportunity.id,
        teamMember: opportunity.teamMember,
        agentRole,
        signalPattern: opportunity.signalPattern,
        confidence: opportunity.confidence,
        estimatedCostUsd: opportunity.estimatedCostUsd,
        severity: opportunity.severity,
        dispatchId,
        agentId,
        priority,
      },
    },
  );

  try {
    await db
      .update(teamImprovementOpportunities)
      .set({
        autoDispatched: true,
        dispatchedAt: now,
        dispatchedAgentId: agentId,
      })
      .where(eq(teamImprovementOpportunities.id, opportunity.id));
  } catch (err) {
    logger.warn(
      `[autoDispatch] failed to persist auto-dispatch row update for opportunity ${opportunity.id} (dispatch_id=${dispatchId} is live regardless)`,
      err instanceof Error ? err : undefined,
    );
  }

  return {
    opportunityId: opportunity.id,
    dispatched: true,
    simulated: false,
    agentId,
    dispatchId,
    evaluation,
    promptSummary: promptText,
  };
}

// ============================================================================
// team_member -> agent_role mapping. 'solene' orchestrates, doesn't get
// dispatched as a worker; she maps to 'general-purpose'.
// ============================================================================

export function mapTeamMemberToAgentRole(
  member: string,
): SoleneDispatchAgentRole {
  switch (member) {
    case "iris":
    case "soren":
    case "beatrice":
    case "krieger":
      return member;
    case "solene":
    default:
      return "general-purpose";
  }
}

// ============================================================================
// GUARDRAILS
// ============================================================================

async function runGuardrails(
  opportunity: TeamImprovementOpportunity,
  now: Date,
  opts: {
    getEnvelopeStatus?: () => Promise<{
      envelopeUsd: number;
      monthToDateUsd: number;
      percentUsed: number;
    }>;
    countMemberDispatchesLast24h?: (
      member: TeamImprovementMember,
      cutoff: Date,
    ) => Promise<number>;
  },
): Promise<GuardrailEvaluation> {
  const failed: GuardrailName[] = [];
  const details: Partial<Record<GuardrailName, string>> = {};

  // G4 — severity gate
  if (!checkSeverityGate(opportunity)) {
    failed.push("severity_gate");
    details.severity_gate = `severity=${opportunity.severity} (only 'opportunity' or 'urgent' may auto-dispatch)`;
  }

  // G2 — confidence floor
  const conf = Number(opportunity.confidence);
  if (!Number.isFinite(conf) || conf < AUTO_DISPATCH_CONFIDENCE_FLOOR) {
    failed.push("confidence_floor");
    details.confidence_floor = `confidence=${conf} < ${AUTO_DISPATCH_CONFIDENCE_FLOOR}`;
  }

  // G5 — core-architecture-change block
  if (matchesCoreArchitectureBlock(opportunity.description)) {
    failed.push("core_architecture_block");
    details.core_architecture_block = `description matches core-architecture-change pattern (founder approval required)`;
  }

  // G3a — per-dispatch cost cap
  const cost =
    opportunity.estimatedCostUsd !== null
      ? Number(opportunity.estimatedCostUsd)
      : 0;
  if (cost > AUTO_DISPATCH_COST_CEILING_USD) {
    failed.push("cost_cap");
    details.cost_cap = `estimated_cost_usd=${cost} > ${AUTO_DISPATCH_COST_CEILING_USD}`;
  }

  // G3b — month-to-date envelope room (only when cost > 0)
  if (cost > 0) {
    try {
      const getEnv = opts.getEnvelopeStatus ?? getMonthlyEnvelopeStatus;
      const env = await getEnv();
      const remaining = env.envelopeUsd - env.monthToDateUsd;
      if (remaining < cost) {
        failed.push("envelope_room");
        details.envelope_room = `MTD spend $${env.monthToDateUsd.toFixed(2)} on $${env.envelopeUsd} envelope leaves $${remaining.toFixed(2)} — insufficient for $${cost.toFixed(2)} dispatch`;
      }
    } catch (err) {
      // Fail-closed: when we can't read the envelope, don't auto-dispatch.
      failed.push("envelope_room");
      details.envelope_room = `envelope read failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // G1 — per-member 24h ceiling
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const countFn =
    opts.countMemberDispatchesLast24h ?? defaultCountMemberDispatchesLast24h;
  try {
    const count = await countFn(
      opportunity.teamMember as TeamImprovementMember,
      cutoff,
    );
    if (count >= AUTO_DISPATCH_PER_MEMBER_24H_CEILING) {
      failed.push("per_member_24h_ceiling");
      details.per_member_24h_ceiling = `member=${opportunity.teamMember} already has ${count} auto-dispatch(es) in 24h (ceiling=${AUTO_DISPATCH_PER_MEMBER_24H_CEILING})`;
    }
  } catch (err) {
    // Fail-closed.
    failed.push("per_member_24h_ceiling");
    details.per_member_24h_ceiling = `24h count read failed: ${err instanceof Error ? err.message : String(err)}`;
  }

  return { passed: failed.length === 0, failed, details };
}

function checkSeverityGate(o: TeamImprovementOpportunity): boolean {
  return o.severity === "opportunity" || o.severity === "urgent";
}

function matchesCoreArchitectureBlock(description: string): boolean {
  return CORE_ARCHITECTURE_BLOCK_PATTERNS.some((re) => re.test(description));
}

async function defaultCountMemberDispatchesLast24h(
  member: TeamImprovementMember,
  cutoff: Date,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(teamImprovementOpportunities)
    .where(
      and(
        eq(teamImprovementOpportunities.teamMember, member),
        eq(teamImprovementOpportunities.autoDispatched, true),
        gte(teamImprovementOpportunities.dispatchedAt, cutoff),
      ),
    );
  return Number(row?.n ?? 0);
}

// ============================================================================
// PROMPT COMPOSITION — payload sent to enqueueDispatch.
// ============================================================================

function buildDispatchPrompt(o: TeamImprovementOpportunity): string {
  return [
    `[Team-improvement auto-dispatch]`,
    `Member: ${o.teamMember}`,
    `Signal pattern: ${o.signalPattern}`,
    `Severity: ${o.severity}`,
    `Confidence: ${o.confidence}`,
    `Estimated cost: $${o.estimatedCostUsd ?? "n/a"}`,
    ``,
    `Gap description:`,
    o.description,
    ``,
    `Evidence:`,
    JSON.stringify(o.evidence ?? {}, null, 2),
    ``,
    `Task: build the improvement that closes this gap. Honor AcreOS engineering`,
    `standards (AuthenticatedRequest, Errors.*, structured logger, migrations`,
    `mirrored). Return a single report under 1000 words with file:line + commit`,
    `SHA + the test count. Honest about any constraint that prevents completing`,
    `the work this dispatch.`,
  ].join("\n");
}

// ============================================================================
// PUBLIC HELPER — drive a batch of opportunities (used by the cron).
// ============================================================================

export async function evaluateBatchForAutoDispatch(
  opportunities: TeamImprovementOpportunity[],
): Promise<{
  dispatched: number;
  queued: number;
  results: AutoDispatchResult[];
}> {
  const results: AutoDispatchResult[] = [];
  let dispatched = 0;
  let queued = 0;
  for (const o of opportunities) {
    const r = await evaluateForAutoDispatch(o);
    results.push(r);
    if (r.dispatched) dispatched += 1;
    else queued += 1;
  }
  return { dispatched, queued, results };
}

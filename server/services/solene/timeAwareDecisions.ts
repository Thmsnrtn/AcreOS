/**
 * SOLENE — time-aware decisions (Layer 4 capability L4.19).
 *
 * Extends the persistent-agent-identity ledger (L1.4) with a *horizon* tag and
 * a *revisit_due_at* timestamp so decisions are revisited at the right cadence:
 *
 *   immediate → ~7d revisit window (current-week tactical work)
 *   quarter   → ~90d window (roadmap / commitment-level decisions)
 *   year      → ~365d window (architecture / positioning)
 *
 * Five entrypoints:
 *
 *   setDecisionHorizon(input)
 *     Stamps a decision row with a horizon + computes the default
 *     revisit_due_at (or accepts an override). Idempotent — re-setting a
 *     horizon simply updates both columns.
 *
 *   listDueForRevisit(opts?)
 *     Returns rows whose revisit_due_at <= cutoff (default now()) AND whose
 *     revisit_due_at is not null. Optional agentRole + limit filters.
 *
 *   markRevisited(decisionId, opts)
 *     Records a follow-up decision via recordAgentDecision (kind='revisit'),
 *     clears the original's revisit_due_at, and (if a new horizon is supplied)
 *     applies that horizon to the *follow-up* row, not the original — the
 *     original stays as historical record; the follow-up carries the
 *     forward-looking revisit schedule.
 *
 *   computeRevisitDueAt(horizon, fromDate?)
 *     Pure helper. Exported for testability + so callers can compute the
 *     date themselves before calling setDecisionHorizon with a custom value.
 *
 *   scanOverdueRevisits()
 *     Daily cron entrypoint. Scans for overdue revisits, logs structured
 *     warnings, returns counts. Never throws — the cron loop tolerates a
 *     swallowed error and moves on. Wire-in to runScheduledJobs deferred to
 *     a follow-up commit (that file is frozen this wave).
 *
 * All time math goes through `new Date()` — no raw millisecond literals
 * leak into the call sites, matching the project's logger discipline.
 */

import { and, asc, eq, isNotNull, lte } from "drizzle-orm";
import { db } from "../../db";
import {
  soleneAgentIdentityDecisions,
  DECISION_HORIZONS,
  type DecisionHorizon,
  type SoleneAgentIdentityDecision,
} from "@shared/schema/solene-agent-identity";
import type { SoleneDispatchAgentRole } from "@shared/schema/solene-dispatch";
import { logger } from "../../utils/logger";
import { recordAgentDecision } from "./agentIdentity";

// ============================================================================
// Types
// ============================================================================

export interface SetDecisionHorizonInput {
  decisionId: number;
  horizon: DecisionHorizon;
  /** Optional override of the auto-computed revisit_due_at. */
  customRevisitDueAt?: Date;
}

export interface ListDueForRevisitOpts {
  agentRole?: SoleneDispatchAgentRole;
  /** Defaults to `new Date()` — i.e. anything overdue as of now. */
  cutoff?: Date;
  /** Cap on number of rows returned. */
  limit?: number;
}

export interface MarkRevisitedOpts {
  followUpSummary: string;
  followUpRationale: string;
  /**
   * If the revisit produced a new horizon (the next checkpoint), it lands
   * on the follow-up row, not the original. The original is now a closed
   * audit-trail entry.
   */
  newHorizon?: DecisionHorizon;
}

export interface ScanOverdueRevisitsResult {
  scanned: number;
  overdue: number;
  byAgent: Record<string, number>;
}

// ============================================================================
// Internal helpers
// ============================================================================

const DAY_MS = 24 * 60 * 60 * 1000;

const HORIZON_DAYS: Record<DecisionHorizon, number> = {
  immediate: 7,
  quarter: 90,
  year: 365,
};

function isKnownHorizon(h: string): h is DecisionHorizon {
  return (DECISION_HORIZONS as readonly string[]).includes(h);
}

/**
 * Trim the rendered summary for log lines so we never leak a 500-char wall
 * into structured log output. Mirrors the capital-tracker truncation
 * discipline.
 */
function snippetForLog(s: string): string {
  if (typeof s !== "string") return "";
  const collapsed = s.replace(/\s+/g, " ").trim();
  return collapsed.length > 120 ? collapsed.slice(0, 117) + "..." : collapsed;
}

// ============================================================================
// computeRevisitDueAt — pure helper, exported for tests + direct use.
// ============================================================================

export function computeRevisitDueAt(
  horizon: DecisionHorizon,
  fromDate: Date = new Date(),
): Date {
  const days = HORIZON_DAYS[horizon];
  // Date arithmetic via a new Date instance to avoid mutating the caller's
  // fromDate reference.
  return new Date(fromDate.getTime() + days * DAY_MS);
}

// ============================================================================
// setDecisionHorizon — stamp a row with a horizon + revisit date.
// ============================================================================

export async function setDecisionHorizon(
  input: SetDecisionHorizonInput,
): Promise<void> {
  if (!isKnownHorizon(input.horizon)) {
    logger.warn(
      `[timeAwareDecisions] setDecisionHorizon: unknown horizon=${input.horizon}; skipping`,
    );
    return;
  }
  const revisitDueAt =
    input.customRevisitDueAt ?? computeRevisitDueAt(input.horizon);

  try {
    await db
      .update(soleneAgentIdentityDecisions)
      .set({
        decisionHorizon: input.horizon,
        revisitDueAt,
      })
      .where(eq(soleneAgentIdentityDecisions.id, input.decisionId));
  } catch (err) {
    logger.warn(
      `[timeAwareDecisions] setDecisionHorizon failed for id=${input.decisionId}`,
      err instanceof Error ? err : undefined,
    );
  }
}

// ============================================================================
// listDueForRevisit — find decisions whose revisit window has elapsed.
// ============================================================================

export async function listDueForRevisit(
  opts: ListDueForRevisitOpts = {},
): Promise<SoleneAgentIdentityDecision[]> {
  const cutoff = opts.cutoff ?? new Date();
  const limit =
    typeof opts.limit === "number" && opts.limit > 0
      ? Math.min(500, Math.floor(opts.limit))
      : 100;

  const conditions = [
    isNotNull(soleneAgentIdentityDecisions.revisitDueAt),
    lte(soleneAgentIdentityDecisions.revisitDueAt, cutoff),
  ];
  if (opts.agentRole) {
    conditions.push(eq(soleneAgentIdentityDecisions.agentRole, opts.agentRole));
  }

  try {
    const rows = await db
      .select()
      .from(soleneAgentIdentityDecisions)
      .where(and(...conditions))
      .orderBy(asc(soleneAgentIdentityDecisions.revisitDueAt))
      .limit(limit);
    return rows;
  } catch (err) {
    logger.warn(
      "[timeAwareDecisions] listDueForRevisit query failed",
      err instanceof Error ? err : undefined,
    );
    return [];
  }
}

// ============================================================================
// markRevisited — record follow-up decision + clear original's revisit_due_at.
// ============================================================================

export async function markRevisited(
  decisionId: number,
  opts: MarkRevisitedOpts,
): Promise<{ followUpDecisionId: number }> {
  // 1) Read the original row so we can carry forward the agentRole (and
  //    any dispatch context) onto the follow-up decision.
  let original: SoleneAgentIdentityDecision | undefined;
  try {
    const rows = await db
      .select()
      .from(soleneAgentIdentityDecisions)
      .where(eq(soleneAgentIdentityDecisions.id, decisionId))
      .limit(1);
    original = rows[0];
  } catch (err) {
    logger.warn(
      `[timeAwareDecisions] markRevisited: failed to load original id=${decisionId}`,
      err instanceof Error ? err : undefined,
    );
  }

  if (!original) {
    logger.warn(
      `[timeAwareDecisions] markRevisited: no original row for id=${decisionId}`,
    );
    return { followUpDecisionId: 0 };
  }

  // 2) Insert the follow-up via the existing append-only entrypoint so the
  //    audit shape stays consistent. Cast through the const type — original
  //    rows store agentRole as a free-form string, but in practice the
  //    column is constrained to SoleneDispatchAgentRole at write time.
  const followUpDecisionId = await recordAgentDecision({
    agentRole: original.agentRole as SoleneDispatchAgentRole,
    decisionKind: "other",
    summary: opts.followUpSummary,
    rationale: opts.followUpRationale,
    referencedFiles: [],
    dispatchId: original.dispatchId ?? null,
    sessionToken: original.sessionToken ?? null,
  });

  // 3) Clear the original's revisit_due_at — the partial index now stops
  //    matching it, and the row stays as historical record.
  try {
    await db
      .update(soleneAgentIdentityDecisions)
      .set({ revisitDueAt: null })
      .where(eq(soleneAgentIdentityDecisions.id, decisionId));
  } catch (err) {
    logger.warn(
      `[timeAwareDecisions] markRevisited: failed to clear revisit on id=${decisionId}`,
      err instanceof Error ? err : undefined,
    );
  }

  // 4) If the revisit produced a new horizon, apply it to the *follow-up*
  //    so the cycle continues from there — never the original.
  if (opts.newHorizon && followUpDecisionId > 0) {
    await setDecisionHorizon({
      decisionId: followUpDecisionId,
      horizon: opts.newHorizon,
    });
  }

  // We intentionally also annotate the follow-up's decision_kind via a
  // small post-write update so the kind reads as "revisit" in the ledger.
  // recordAgentDecision doesn't accept "revisit" as a valid kind (it would
  // be coerced to "other"), so we patch the row directly.
  if (followUpDecisionId > 0) {
    try {
      await db
        .update(soleneAgentIdentityDecisions)
        .set({ decisionKind: "revisit" })
        .where(eq(soleneAgentIdentityDecisions.id, followUpDecisionId));
    } catch (err) {
      logger.warn(
        `[timeAwareDecisions] markRevisited: failed to tag follow-up kind id=${followUpDecisionId}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  return { followUpDecisionId };
}

// ============================================================================
// scanOverdueRevisits — daily cron entrypoint, never throws.
// ============================================================================

export async function scanOverdueRevisits(): Promise<ScanOverdueRevisitsResult> {
  const result: ScanOverdueRevisitsResult = {
    scanned: 0,
    overdue: 0,
    byAgent: {},
  };

  try {
    const overdue = await listDueForRevisit({ limit: 500 });
    result.scanned = overdue.length;
    result.overdue = overdue.length;
    for (const row of overdue) {
      result.byAgent[row.agentRole] = (result.byAgent[row.agentRole] ?? 0) + 1;
      logger.warn(
        `[timeAwareDecisions] overdue revisit role=${row.agentRole} id=${row.id} horizon=${row.decisionHorizon ?? "unknown"} dueAt=${row.revisitDueAt?.toISOString() ?? "unknown"} summary="${snippetForLog(row.summary)}"`,
      );
    }
  } catch (err) {
    // Never throw — cron tolerates a swallowed error and runs again tomorrow.
    logger.warn(
      "[timeAwareDecisions] scanOverdueRevisits swallow",
      err instanceof Error ? err : undefined,
    );
  }

  return result;
}

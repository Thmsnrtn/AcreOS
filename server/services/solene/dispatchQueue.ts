/**
 * SOLENE — real agent-dispatch queue.
 *
 * Layer 1 capability #1 of the agentic-evolution architecture
 * (feedback_agentic_evolution_north_star.md). The queue is the seam
 * between detectors / guardrails (producers) and the worker loop
 * (consumer). It is the ONLY surface that decides what runs next.
 *
 * Three public entrypoints:
 *
 *   enqueueDispatch(opts)
 *     Validates cost cap (max $100 unless founder-override), writes a
 *     queued row, returns the dispatch id. Never silently drops; callers
 *     get either an id or a thrown error.
 *
 *   claimNextDispatch()
 *     Atomic single-row claim via Postgres FOR UPDATE SKIP LOCKED. Two
 *     workers calling this concurrently will never receive the same row.
 *     Returns the claimed row in status='in_progress' with started_at set,
 *     or null if the queue is empty.
 *
 *   completeDispatch(id, result) / failDispatch(id, error)
 *     Terminal-state writers. Both also persist a solene_dispatch_results
 *     row so the founder visibility endpoints + capital tracker have a
 *     uniform shape regardless of outcome.
 *
 * HONEST CONSTRAINTS:
 *  - The cost cap is enforced at enqueue time on the requested max_cost_usd
 *    but cannot bound the ACTUAL spend; the worker's per-turn cost-cap
 *    enforcement is the runtime guard. Both layers are required.
 *  - SKIP LOCKED requires Postgres >= 9.5; AcreOS runs 16, so this is safe.
 */

import { eq, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  soleneDispatchQueue,
  soleneDispatchResults,
  DISPATCH_MAX_COST_USD,
  DISPATCH_DEFAULT_COST_USD,
  DISPATCH_DEFAULT_TIMEOUT_MS,
  type SoleneDispatchAgentRole,
  type SoleneDispatchQueueRow,
  type SoleneDispatchSourceType,
} from "@shared/schema/solene-dispatch";
import { logger } from "../../utils/logger";

export interface EnqueueDispatchOpts {
  sourceType: SoleneDispatchSourceType;
  sourceId: string;
  agentRole: SoleneDispatchAgentRole;
  promptText: string;
  /** Per-dispatch hard cap. Defaults to $25; cannot exceed $100 without founderOverride. */
  maxCostUsd?: number;
  /** Default 10 minutes. */
  timeoutMs?: number;
  /** Default 1.0; higher numbers claim first. */
  priority?: number;
  enqueuedBy?: string;
  /** Bypass the $100 ceiling. Required for any cap above DISPATCH_MAX_COST_USD. */
  founderOverride?: boolean;
}

export interface DispatchResultInput {
  costUsd: number;
  durationMs: number;
  tokenInput: number;
  tokenOutput: number;
  resultSummary: string;
  resultFullPath: string | null;
  commitsReferenced?: string[];
  filesModified?: string[];
  followUpOpportunities?: Record<string, unknown>;
}

export interface DispatchFailureInput {
  errorMessage: string;
  costUsd?: number;
  durationMs?: number;
  tokenInput?: number;
  tokenOutput?: number;
  resultFullPath?: string | null;
  commitsReferenced?: string[];
  filesModified?: string[];
}

// ----------------------------------------------------------------------------
// enqueueDispatch
// ----------------------------------------------------------------------------

export async function enqueueDispatch(
  opts: EnqueueDispatchOpts,
): Promise<number> {
  const maxCostUsd = opts.maxCostUsd ?? DISPATCH_DEFAULT_COST_USD;
  const timeoutMs = opts.timeoutMs ?? DISPATCH_DEFAULT_TIMEOUT_MS;
  const priority = opts.priority ?? 1.0;

  if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0) {
    throw new Error(
      `enqueueDispatch: invalid maxCostUsd=${maxCostUsd} (must be > 0)`,
    );
  }
  if (maxCostUsd > DISPATCH_MAX_COST_USD && !opts.founderOverride) {
    throw new Error(
      `enqueueDispatch: maxCostUsd=$${maxCostUsd} exceeds ceiling $${DISPATCH_MAX_COST_USD} — founderOverride required`,
    );
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(
      `enqueueDispatch: invalid timeoutMs=${timeoutMs} (must be > 0)`,
    );
  }
  if (!opts.promptText || opts.promptText.trim().length === 0) {
    throw new Error("enqueueDispatch: promptText must be non-empty");
  }

  const [inserted] = await db
    .insert(soleneDispatchQueue)
    .values({
      status: "queued",
      priority: priority.toFixed(3),
      sourceType: opts.sourceType,
      sourceId: opts.sourceId,
      agentRole: opts.agentRole,
      promptText: opts.promptText,
      maxCostUsd: maxCostUsd.toFixed(2),
      timeoutMs,
      enqueuedBy: opts.enqueuedBy ?? null,
    })
    .returning({ id: soleneDispatchQueue.id });

  if (!inserted) {
    throw new Error("enqueueDispatch: insert returned no id");
  }

  logger.info(
    `[dispatchQueue] enqueued id=${inserted.id} role=${opts.agentRole} source=${opts.sourceType}:${opts.sourceId} maxCost=$${maxCostUsd} timeoutMs=${timeoutMs}`,
  );

  return inserted.id;
}

// ----------------------------------------------------------------------------
// claimNextDispatch — atomic single-row pull via FOR UPDATE SKIP LOCKED.
// ----------------------------------------------------------------------------

/**
 * Pull the highest-priority queued dispatch + atomically flip it to
 * in_progress. Returns null when the queue is empty.
 *
 * The CTE form (UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED))
 * is the canonical Postgres pattern for "competing consumers" without an
 * external queue (RabbitMQ / Redis). Two workers calling this concurrently
 * will receive different rows or one will receive null.
 */
export async function claimNextDispatch(): Promise<SoleneDispatchQueueRow | null> {
  const rows = await db.execute<{
    id: number;
    queued_at: Date;
    status: string;
    priority: string;
    source_type: string;
    source_id: string;
    agent_role: string;
    prompt_text: string;
    max_cost_usd: string;
    timeout_ms: number;
    started_at: Date | null;
    completed_at: Date | null;
    result_summary: string | null;
    result_full_path: string | null;
    enqueued_by: string | null;
  }>(sql`
    UPDATE solene_dispatch_queue
    SET status = 'in_progress', started_at = now()
    WHERE id = (
      SELECT id FROM solene_dispatch_queue
      WHERE status = 'queued'
      ORDER BY priority DESC, queued_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING
      id, queued_at, status, priority, source_type, source_id,
      agent_role, prompt_text, max_cost_usd, timeout_ms,
      started_at, completed_at, result_summary, result_full_path,
      enqueued_by
  `);

  // drizzle's `execute` returns slightly different shapes across drivers.
  // Normalize to an array.
  const list: any[] = Array.isArray(rows)
    ? (rows as any[])
    : ((rows as any)?.rows ?? []);
  if (list.length === 0) return null;
  const r = list[0];

  return {
    id: r.id,
    queuedAt: r.queued_at,
    status: r.status,
    priority: r.priority,
    sourceType: r.source_type,
    sourceId: r.source_id,
    agentRole: r.agent_role,
    promptText: r.prompt_text,
    maxCostUsd: r.max_cost_usd,
    timeoutMs: r.timeout_ms,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    resultSummary: r.result_summary,
    resultFullPath: r.result_full_path,
    enqueuedBy: r.enqueued_by,
  };
}

// ----------------------------------------------------------------------------
// completeDispatch
// ----------------------------------------------------------------------------

export async function completeDispatch(
  id: number,
  result: DispatchResultInput,
): Promise<void> {
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(soleneDispatchQueue)
      .set({
        status: "completed",
        completedAt: now,
        resultSummary: result.resultSummary.slice(0, 4000),
        resultFullPath: result.resultFullPath,
      })
      .where(eq(soleneDispatchQueue.id, id));

    await tx.insert(soleneDispatchResults).values({
      dispatchId: id,
      success: true,
      costUsd: result.costUsd.toFixed(4),
      durationMs: Math.max(0, Math.floor(result.durationMs)),
      tokenInput: Math.max(0, Math.floor(result.tokenInput)),
      tokenOutput: Math.max(0, Math.floor(result.tokenOutput)),
      errorMessage: null,
      commitsReferenced: result.commitsReferenced ?? null,
      filesModified: result.filesModified ?? null,
      followUpOpportunities: result.followUpOpportunities ?? {},
    });
  });
}

// ----------------------------------------------------------------------------
// failDispatch
// ----------------------------------------------------------------------------

export async function failDispatch(
  id: number,
  error: DispatchFailureInput,
  opts: { status?: "failed" | "cancelled" } = {},
): Promise<void> {
  const status = opts.status ?? "failed";
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(soleneDispatchQueue)
      .set({
        status,
        completedAt: now,
        resultSummary: error.errorMessage.slice(0, 4000),
        resultFullPath: error.resultFullPath ?? null,
      })
      .where(eq(soleneDispatchQueue.id, id));

    await tx.insert(soleneDispatchResults).values({
      dispatchId: id,
      success: false,
      costUsd: (error.costUsd ?? 0).toFixed(4),
      durationMs: Math.max(0, Math.floor(error.durationMs ?? 0)),
      tokenInput: Math.max(0, Math.floor(error.tokenInput ?? 0)),
      tokenOutput: Math.max(0, Math.floor(error.tokenOutput ?? 0)),
      errorMessage: error.errorMessage.slice(0, 4000),
      commitsReferenced: error.commitsReferenced ?? null,
      filesModified: error.filesModified ?? null,
      followUpOpportunities: {},
    });
  });
}

// ----------------------------------------------------------------------------
// cancelDispatch — founder kill switch.
// ----------------------------------------------------------------------------

/**
 * Mark a dispatch as cancelled. If it's still queued, just flip status.
 * If it's in_progress, set a cancellation flag the worker loop will pick up
 * on its next per-turn tick (cooperative cancellation; the worker can't
 * preempt a streaming Anthropic call mid-flight).
 *
 * Returns the prior status so callers can report what happened.
 */
export async function cancelDispatch(
  id: number,
  reason: string,
): Promise<{ priorStatus: string | null; cancelled: boolean }> {
  const [existing] = await db
    .select({
      id: soleneDispatchQueue.id,
      status: soleneDispatchQueue.status,
    })
    .from(soleneDispatchQueue)
    .where(eq(soleneDispatchQueue.id, id))
    .limit(1);

  if (!existing) return { priorStatus: null, cancelled: false };

  if (existing.status === "completed" || existing.status === "failed" || existing.status === "cancelled") {
    return { priorStatus: existing.status, cancelled: false };
  }

  await failDispatch(
    id,
    { errorMessage: `cancelled by founder: ${reason}`.slice(0, 4000) },
    { status: "cancelled" },
  );
  return { priorStatus: existing.status, cancelled: true };
}

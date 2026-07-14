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

import { createHash } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  soleneDispatchQueue,
  soleneDispatchResults,
  DISPATCH_MAX_COST_USD,
  DISPATCH_DEFAULT_COST_USD,
  DISPATCH_DEFAULT_TIMEOUT_MS,
  DISPATCH_MAX_ATTEMPTS,
  type DispatchSuccessCriteria,
  type SoleneDispatchAgentRole,
  type SoleneDispatchQueueRow,
  type SoleneDispatchResultRow,
  type SoleneDispatchSourceType,
  type SoleneDispatchStatus,
} from "@shared/schema/solene-dispatch";
import { logger } from "../../utils/logger";
import { assertWithinEnsembleCap } from "./capitalTracker";

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
  /**
   * Exactly-once seal (panel #2). When set, the SAME key inserts ONCE — a second
   * enqueue with the same key returns the FIRST row's id without creating a
   * duplicate (the concurrent-tick / retry double-fire). NULL/omitted = legacy
   * behavior (always insert). Use computeEffectKey() to build it.
   */
  idempotencyKey?: string | null;
  /**
   * CP2 of Jarvis Phase 1 (Verified Act-and-Confirm). Explicit success
   * criteria an independent `verify` dispatch can later evaluate the OUTCOME
   * against. Omitted/null = no criteria attached (legacy behavior). On a
   * sourceType='verify' enqueue this holds the criteria BEING verified.
   */
  successCriteria?: DispatchSuccessCriteria | null;
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

/** Default exactly-once window: an effect repeated within this span dedups.
 *  Sized ≥ the loop's lock TTL so a concurrent tick (the documented double-fire
 *  cause) lands in the same window; legitimate cadence runs are further apart. */
export const DEFAULT_EFFECT_WINDOW_MS = 30 * 60_000;

/**
 * Compute a deterministic exactly-once effect-key for an autopilot dispatch
 * (panel #2). The SAME concrete effect (domain + move + play + target) inside
 * the SAME time window hashes identically, so a concurrent tick / retry dedups;
 * a different target or a later window hashes differently, so legitimately
 * distinct effects each run. Pure + total — `nowMs` injected (no clock here).
 */
export function computeEffectKey(parts: {
  domain: string;
  moveKind: string;
  playId?: string | null;
  targetId?: string | null;
  nowMs: number;
  windowMs?: number;
}): string {
  const w = parts.windowMs && parts.windowMs > 0 ? parts.windowMs : DEFAULT_EFFECT_WINDOW_MS;
  const bucket = Math.floor(parts.nowMs / w);
  const raw = `${parts.domain}|${parts.moveKind}|${parts.playId ?? "-"}|${parts.targetId ?? "-"}|${bucket}`;
  return createHash("sha256").update(raw, "utf8").digest("hex");
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

  // Pre-dispatch ensemble cap — the binding pre-call bound on agent-dispatch
  // spend (the single largest cash cost). Throws EnsembleCapExceededError once
  // month-to-date agent_dispatch spend crosses the RED threshold of
  // ENSEMBLE_MONTHLY_CAP_USD (default = the $50 Solene envelope). The founder
  // can override a single dispatch via founderOverride. Fails CLOSED on DB
  // error so a hiccup can never quietly unbound the ensemble.
  await assertWithinEnsembleCap({ founderOverride: opts.founderOverride });

  const key = opts.idempotencyKey?.trim() || null;
  const values = {
    status: "queued" as const,
    priority: priority.toFixed(3),
    sourceType: opts.sourceType,
    sourceId: opts.sourceId,
    agentRole: opts.agentRole,
    promptText: opts.promptText,
    maxCostUsd: maxCostUsd.toFixed(2),
    timeoutMs,
    enqueuedBy: opts.enqueuedBy ?? null,
    idempotencyKey: key,
    successCriteria: opts.successCriteria ?? null,
  };

  // Exactly-once (panel #2): a keyed enqueue inserts ON CONFLICT DO NOTHING
  // against the partial unique index. On conflict (a concurrent tick / retry
  // already enqueued this exact effect) the insert returns nothing — we then
  // fetch and return the FIRST row's id so the caller gets at-most-once
  // semantics without a duplicate dispatch. An unkeyed enqueue is unchanged.
  let inserted: { id: number } | undefined;
  if (key) {
    [inserted] = await db
      .insert(soleneDispatchQueue)
      .values(values)
      .onConflictDoNothing({ target: soleneDispatchQueue.idempotencyKey })
      .returning({ id: soleneDispatchQueue.id });
    if (!inserted) {
      const [existing] = await db
        .select({ id: soleneDispatchQueue.id })
        .from(soleneDispatchQueue)
        .where(eq(soleneDispatchQueue.idempotencyKey, key))
        .limit(1);
      if (existing) {
        logger.info(`[dispatchQueue] enqueue deduped on idempotencyKey → existing id=${existing.id}`);
        return existing.id;
      }
      throw new Error("enqueueDispatch: conflict but no existing row found");
    }
  } else {
    [inserted] = await db
      .insert(soleneDispatchQueue)
      .values(values)
      .returning({ id: soleneDispatchQueue.id });
  }

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
    review_status: string | null;
    reviewed_by_dispatch_id: number | null;
    original_dispatch_id: number | null;
    attempts: number;
    not_before_at: Date | null;
    success_criteria: DispatchSuccessCriteria | null;
  }>(sql`
    UPDATE solene_dispatch_queue
    SET status = 'in_progress', started_at = now(), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM solene_dispatch_queue
      WHERE status = 'queued'
        AND (not_before_at IS NULL OR not_before_at <= now())
      ORDER BY priority DESC, queued_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING
      id, queued_at, status, priority, source_type, source_id,
      agent_role, prompt_text, max_cost_usd, timeout_ms,
      started_at, completed_at, result_summary, result_full_path,
      enqueued_by, review_status, reviewed_by_dispatch_id,
      original_dispatch_id, idempotency_key, attempts, not_before_at,
      success_criteria
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
    reviewStatus: r.review_status,
    reviewedByDispatchId: r.reviewed_by_dispatch_id,
    originalDispatchId: r.original_dispatch_id,
    idempotencyKey: r.idempotency_key ?? null,
    // Batch 5 cost-audit — optional per-dispatch model override
    // (selectModelForDispatch picks when null).
    model: r.model ?? null,
    attempts: r.attempts ?? 1,
    notBeforeAt: r.not_before_at ?? null,
    // CP2 (Jarvis Phase 1) — explicit success criteria for verify dispatches.
    successCriteria: r.success_criteria ?? null,
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

  // CP1 of Jarvis Phase 1 (Verified Act-and-Confirm, founder GO 2026-07-14):
  // when the COMPLETING dispatch is itself a code_review, consume its
  // verdict — the wire that was missing since L2.8 shipped. Parse the
  // UNSLICED summary (the stored copy is cut at 4000 chars and the VERDICT
  // block sits at the END of the review's final message), then
  // recordReviewOutcome flips the original's review_status and, on
  // flagged, fires the existing self-debug chain. Unparseable verdicts are
  // logged loudly and leave review_status pending (surfaced by
  // listPendingReviews) — an unparseable review never counts as passed.
  // Fire-and-forget: verdict-consumption failure must not fail completion.
  //
  // CP2 extends the same hook: when the completing dispatch is a generic
  // `verify` dispatch, the SAME structured block (VERDICT: passed | flagged
  // + FINDINGS) is parsed by the SAME parser and routed by sourceId —
  // 'verify:dispatch:<id>' flips the target dispatch's review_status (and
  // fires self-debug on flagged); 'verify:import:<jobId>' lands the verdict
  // on the import_jobs row; CP3 adds 'verify:mailShipment:<id>' and
  // 'verify:dunningEvent:<id>' routes. Verify dispatches remain READ-ONLY
  // observers: they never block or fail the work they verify. CP3's
  // act-and-confirm binding is TRUST, not blocking — verdicts on dispatches
  // in known autopilot domains feed the Trust Ledger (verified clean cycles
  // / circuit-breaker bounces) inside recordReviewOutcome/recordVerifyOutcome.
  void (async () => {
    try {
      const [row] = await db
        .select({
          sourceType: soleneDispatchQueue.sourceType,
          sourceId: soleneDispatchQueue.sourceId,
        })
        .from(soleneDispatchQueue)
        .where(eq(soleneDispatchQueue.id, id))
        .limit(1);
      if (row?.sourceType !== "code_review" && row?.sourceType !== "verify") return;
      const { parseReviewVerdict } = await import("./codeReviewQueue");
      const verdict = parseReviewVerdict(result.resultSummary);
      if (!verdict) {
        logger.warn(
          `[dispatchQueue] ${row.sourceType} dispatch id=${id} completed WITHOUT a parseable VERDICT — target stays pending (never counts as passed)`,
        );
        return;
      }
      if (row.sourceType === "code_review") {
        const { recordReviewOutcome } = await import("./codeReviewQueue");
        await recordReviewOutcome(id, verdict.outcome, verdict.findings);
      } else {
        const { recordVerifyOutcome } = await import("./verifyQueue");
        await recordVerifyOutcome(id, verdict.outcome, verdict.findings);
      }
    } catch (err) {
      logger.warn(
        `[dispatchQueue] verdict consumption failed for dispatch id=${id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  })();

  // L2.8 — multi-agent code review. Fire-and-forget. enqueueReviewDispatch
  // handles all the eligibility checks (commits present, not already a review,
  // not recursive). We never let a review failure propagate back into the
  // primary completion path — code-review is an OBSERVABILITY layer, not a
  // gate, and the worker loop must move on regardless.
  if ((result.commitsReferenced?.length ?? 0) > 0) {
    void import("./codeReviewQueue")
      .then(({ enqueueReviewDispatch }) => enqueueReviewDispatch(id))
      .catch((err) => {
        logger.warn(
          `[dispatchQueue] code-review enqueue failed for dispatch id=${id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
  }

  // L3.11 — confidence-calibrated outputs. Fire-and-forget. recordObservation
  // parses the final text for confidence signals (explicit %, band, hedge,
  // uncertainty) and persists a row when the parse yields a non-trivial
  // signal. Like the code-review hook above, errors are observability-only —
  // we never let confidence-recording failure propagate back into the
  // primary completion path. We re-read agent_role here (instead of taking it
  // as a parameter) to keep the completeDispatch signature unchanged.
  void (async () => {
    try {
      const [row] = await db
        .select({ agentRole: soleneDispatchQueue.agentRole })
        .from(soleneDispatchQueue)
        .where(eq(soleneDispatchQueue.id, id))
        .limit(1);
      if (!row) return;
      const { recordObservation } = await import("./confidenceObservations");
      await recordObservation({
        dispatchId: id,
        agentRole: row.agentRole as SoleneDispatchAgentRole,
        finalText: result.resultSummary,
      });
    } catch (err) {
      logger.warn(
        `[dispatchQueue] confidence record failed for dispatch id=${id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  })();
}

// ----------------------------------------------------------------------------
// failDispatch — terminal fail, OR bounded requeue for proven-transient failures.
// ----------------------------------------------------------------------------

/**
 * Pure: backoff delay before a retried dispatch becomes claimable again.
 * `attempts` is the number of runs already started (claim-time counter), so
 * after the first failed run (attempts=1) the row waits 2 minutes, after the
 * second 4 minutes. Exponential, deliberately short — these are provider
 * blips, not incident recovery.
 */
export function retryBackoffMs(attempts: number): number {
  const n = Math.max(1, Math.floor(attempts));
  return Math.pow(2, n) * 60_000;
}

/** Marker prepended to the result summary when retries are exhausted, so the
 *  Control-door dispatch list reads as a dead-letter surface without a new
 *  status enum value (terminal DLQ rows keep status='failed'). */
export const DEAD_LETTER_MARKER = "[dead-letter]";

/**
 * Record a failed run. Default is TERMINAL (the original at-most-once stance —
 * we never risk a double outward effect by re-running blind).
 *
 * `opts.transient = true` is the caller's PROOF that the failure happened
 * before any side effect: no tool executed, nothing sent, nothing charged
 * (e.g. the ensemble-cap READ failed, or the model call itself threw before
 * the first tool ran). Only then do we requeue with exponential backoff,
 * up to DISPATCH_MAX_ATTEMPTS total runs; after that the row dead-letters
 * (status='failed', summary prefixed with DEAD_LETTER_MARKER).
 *
 * Every attempt — requeued or terminal — still inserts its own
 * solene_dispatch_results row, so the audit trail shows each real run.
 */
export async function failDispatch(
  id: number,
  error: DispatchFailureInput,
  opts: { status?: "failed" | "cancelled"; transient?: boolean } = {},
): Promise<{ requeued: boolean; attempts: number }> {
  const requestedStatus = opts.status ?? "failed";
  const now = new Date();

  return await db.transaction(async (tx) => {
    // Read attempts inside the transaction so the retry decision and the
    // status write can't race another writer.
    const [row] = await tx
      .select({ attempts: soleneDispatchQueue.attempts })
      .from(soleneDispatchQueue)
      .where(eq(soleneDispatchQueue.id, id))
      .limit(1);
    const attempts = row?.attempts ?? DISPATCH_MAX_ATTEMPTS;

    // A cancellation is a decision, not a blip — never retried.
    const canRetry =
      opts.transient === true &&
      requestedStatus !== "cancelled" &&
      attempts < DISPATCH_MAX_ATTEMPTS;

    const exhaustedTransient =
      opts.transient === true &&
      requestedStatus !== "cancelled" &&
      attempts >= DISPATCH_MAX_ATTEMPTS;

    const summary = exhaustedTransient
      ? `${DEAD_LETTER_MARKER} ${error.errorMessage}`.slice(0, 4000)
      : error.errorMessage.slice(0, 4000);

    if (canRetry) {
      const notBeforeAt = new Date(now.getTime() + retryBackoffMs(attempts));
      await tx
        .update(soleneDispatchQueue)
        .set({
          status: "queued",
          startedAt: null,
          completedAt: null,
          notBeforeAt,
          resultSummary: `retry ${attempts}/${DISPATCH_MAX_ATTEMPTS} scheduled (transient): ${error.errorMessage}`.slice(0, 4000),
          resultFullPath: error.resultFullPath ?? null,
        })
        .where(eq(soleneDispatchQueue.id, id));
    } else {
      await tx
        .update(soleneDispatchQueue)
        .set({
          status: requestedStatus,
          completedAt: now,
          resultSummary: summary,
          resultFullPath: error.resultFullPath ?? null,
        })
        .where(eq(soleneDispatchQueue.id, id));
    }

    // Per-attempt audit row regardless of requeue/terminal.
    await tx.insert(soleneDispatchResults).values({
      dispatchId: id,
      success: false,
      costUsd: (error.costUsd ?? 0).toFixed(4),
      durationMs: Math.max(0, Math.floor(error.durationMs ?? 0)),
      tokenInput: Math.max(0, Math.floor(error.tokenInput ?? 0)),
      tokenOutput: Math.max(0, Math.floor(error.tokenOutput ?? 0)),
      errorMessage: summary,
      commitsReferenced: error.commitsReferenced ?? null,
      filesModified: error.filesModified ?? null,
      followUpOpportunities: {},
    });

    if (canRetry) {
      logger.info(
        `[dispatchQueue] transient failure — requeued id=${id} attempt=${attempts}/${DISPATCH_MAX_ATTEMPTS} backoffMs=${retryBackoffMs(attempts)}`,
      );
    } else if (exhaustedTransient) {
      logger.warn(
        `[dispatchQueue] transient failure with retries exhausted — dead-lettered id=${id} after ${attempts} attempt(s)`,
      );
    }

    return { requeued: canRetry, attempts };
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

// ----------------------------------------------------------------------------
// Founder read/list/cancel helpers — back the /api/founder/dispatches surface.
// ----------------------------------------------------------------------------

export interface DispatchWithResult {
  queue: SoleneDispatchQueueRow;
  result: SoleneDispatchResultRow | null;
}

/**
 * List recent dispatches (queue rows) optionally filtered by status. Left-joins
 * the matching result row so terminal dispatches surface their cost/duration
 * alongside the queue metadata. Ordered by queued_at DESC.
 */
export async function listDispatches(opts: {
  status?: SoleneDispatchStatus;
  limit?: number;
}): Promise<DispatchWithResult[]> {
  const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? 50)), 200);
  const baseQuery = db
    .select({
      queue: soleneDispatchQueue,
      result: soleneDispatchResults,
    })
    .from(soleneDispatchQueue)
    .leftJoin(
      soleneDispatchResults,
      eq(soleneDispatchResults.dispatchId, soleneDispatchQueue.id),
    );

  const rows = opts.status
    ? await baseQuery
        .where(eq(soleneDispatchQueue.status, opts.status))
        .orderBy(desc(soleneDispatchQueue.queuedAt))
        .limit(limit)
    : await baseQuery
        .orderBy(desc(soleneDispatchQueue.queuedAt))
        .limit(limit);

  return rows.map((r) => ({ queue: r.queue, result: r.result }));
}

/**
 * Fetch a single dispatch by id along with its result row (if any). Returns
 * null when no queue row exists for that id.
 */
export async function getDispatchById(
  id: number,
): Promise<DispatchWithResult | null> {
  const rows = await db
    .select({
      queue: soleneDispatchQueue,
      result: soleneDispatchResults,
    })
    .from(soleneDispatchQueue)
    .leftJoin(
      soleneDispatchResults,
      eq(soleneDispatchResults.dispatchId, soleneDispatchQueue.id),
    )
    .where(eq(soleneDispatchQueue.id, id))
    .limit(1);

  if (rows.length === 0) return null;
  return { queue: rows[0].queue, result: rows[0].result };
}

/**
 * Founder kill-switch — only legal from `queued` state. Cancelling an
 * in-flight dispatch is rejected because the worker is mid-call and would
 * orphan; cancelling an already-terminal dispatch is rejected because the
 * state machine is closed. Does NOT write a solene_dispatch_results row —
 * those are for terminal runtime outcomes, not pre-claim cancellations.
 *
 * Returns:
 *   - { ok: true, priorStatus: 'queued' } when the cancel landed
 *   - { ok: false, priorStatus: <found> } when the row exists but is not queued
 *   - { ok: false, priorStatus: null } when no such row exists
 */
export async function cancelQueuedDispatch(
  id: number,
  reason: string,
): Promise<{ ok: boolean; priorStatus: string | null }> {
  const [existing] = await db
    .select({
      id: soleneDispatchQueue.id,
      status: soleneDispatchQueue.status,
    })
    .from(soleneDispatchQueue)
    .where(eq(soleneDispatchQueue.id, id))
    .limit(1);

  if (!existing) return { ok: false, priorStatus: null };
  if (existing.status !== "queued") {
    return { ok: false, priorStatus: existing.status };
  }

  const now = new Date();
  const summary = reason && reason.trim().length > 0
    ? `cancelled by founder: ${reason}`.slice(0, 4000)
    : "cancelled by founder";
  await db
    .update(soleneDispatchQueue)
    .set({
      status: "cancelled",
      completedAt: now,
      resultSummary: summary,
    })
    .where(eq(soleneDispatchQueue.id, id));

  logger.info(
    `[dispatchQueue] cancelled id=${id} (prior=queued) reason=${(reason ?? "").slice(0, 120)}`,
  );

  return { ok: true, priorStatus: "queued" };
}

// ── Orphaned-dispatch reaper (frontier #12: exactly-once outward effects) ─────
// The claim itself is already exactly-once (FOR UPDATE SKIP LOCKED — exactly one
// worker claims a queued row). The remaining gap is an ORPHAN: a dispatch claimed
// `in_progress` whose worker crashed before it could complete — it would sit
// in_progress forever (claimNextDispatch only picks `queued`), never re-run,
// never finished. This reaps it.

/** Pure: a dispatch is ORPHANED once it's been `in_progress` longer than its own
 *  timeout + a margin — almost always a worker that crashed mid-dispatch. */
export function isOrphanedDispatch(
  d: { status: string; startedAt: Date | null; timeoutMs: number },
  now: number,
  marginMs = 5 * 60_000,
): boolean {
  if (d.status !== "in_progress" || !d.startedAt) return false;
  return now - new Date(d.startedAt).getTime() > (d.timeoutMs ?? 0) + marginMs;
}

/**
 * Reap orphaned `in_progress` dispatches. They are marked FAILED, NOT requeued:
 * we cannot know whether the orphan's outward effect (a send, a charge) partially
 * fired, so the safe exactly-once stance is AT-MOST-ONCE for the side effect —
 * fail it and surface it, never risk a double-send by re-running. The reaped
 * dispatch's domain takes its honest autonomy hit through the normal feedback
 * edge the next tick reads. Best-effort; returns the count reaped.
 */
export async function reapOrphanedDispatches(marginMs = 5 * 60_000): Promise<number> {
  try {
    const res = await db.execute(sql`
      UPDATE solene_dispatch_queue
      SET status = 'failed', completed_at = now(),
          result_summary = 'reaped: orphaned in_progress past timeout (likely a worker crash mid-dispatch)'
      WHERE status = 'in_progress'
        AND started_at IS NOT NULL
        AND started_at < now() - (((timeout_ms + ${marginMs}) || ' milliseconds')::interval)
      RETURNING id
    `);
    const list: unknown[] = Array.isArray(res) ? res : ((res as { rows?: unknown[] })?.rows ?? []);
    if (list.length > 0) logger.warn(`[dispatchQueue] reaped ${list.length} orphaned in_progress dispatch(es)`);
    return list.length;
  } catch (err) {
    logger.warn("[dispatchQueue] orphan reap failed", err instanceof Error ? err : undefined);
    return 0;
  }
}

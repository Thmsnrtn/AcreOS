/**
 * SOLENE — Discovery → Decision → Dispatch → Delivery pipeline service
 * (Phase B L2.9).
 *
 * A pipeline row is a single tracking record that links the existing
 * stage tables — improvement_opportunities (L1 detectors), plan_proposals
 * (L2.6), solene_dispatch_queue (L1.1), and the L2.8 code-review
 * dispatch — via foreign keys, plus a current_stage column so the lifecycle
 * is queryable in one shot.
 *
 * The pipeline does NOT own the underlying state. We never reach over and
 * mutate a dispatch row from here; instead we record "stage X happened" and
 * carry the cross-table linkage forward.
 *
 * State machine — allowed transitions:
 *   discovery → decision    (advanceToDecision)
 *   discovery → dispatch    (advanceToDispatch — skip-decision shortcut for
 *                            auto-dispatch flows; duration_ms_decision_to_dispatch
 *                            stays null because there was no decision stage)
 *   decision  → dispatch    (advanceToDispatch)
 *   dispatch  → delivery    (advanceToDelivery)
 *   delivery  → completed   (closePipeline)
 *   any-non-terminal → abandoned (abandonPipeline)
 *
 * Terminal stages: completed, abandoned. Further transitions throw.
 *
 * Tool name: pipeline_advance
 * Tool description: Update the pipeline tracking for this work. Used to mark
 *   the lifecycle stage of a dispatched piece of work so the funnel surface
 *   shows where things sit.
 *
 * Input schema:
 *   pipeline_id: number
 *   advance_to: enum(decision, dispatch, delivery, completed, abandoned)
 *   plan_proposal_id?: number       (when advance_to=decision)
 *   dispatch_id?: number            (when advance_to=dispatch)
 *   review_dispatch_id?: number     (when advance_to=delivery)
 *   outcome?: enum(shipped, flagged_and_recovered, abandoned, superseded)
 *                                   (when advance_to=completed)
 *   notes?: string
 *
 * Output: { current_stage, updated_at }
 */

import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "../../db";
import {
  solenePipelines,
  PIPELINE_KINDS,
  PIPELINE_OUTCOMES,
  PIPELINE_STAGES,
  type PipelineKind,
  type PipelineOutcome,
  type PipelineStage,
  type SolenePipelineRow,
} from "@shared/schema/solene-pipeline";
import { logger } from "../../utils/logger";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface OpenPipelineInput {
  pipelineKind: PipelineKind;
  triggeringSourceKind?: string;
  triggeringSourceId?: string;
  improvementOpportunityId?: number;
}

export interface AdvanceToDecisionInput {
  pipelineId: number;
  planProposalId: number;
}

export interface AdvanceToDispatchInput {
  pipelineId: number;
  dispatchId: number;
}

export interface AdvanceToDeliveryInput {
  pipelineId: number;
  reviewDispatchId?: number;
}

export interface ClosePipelineInput {
  pipelineId: number;
  outcome: PipelineOutcome;
  notes?: string;
}

export interface PipelineFunnel {
  byStage: Record<PipelineStage, number>;
  byKind: Record<PipelineKind, number>;
  byOutcome: Record<PipelineOutcome, number>;
  averageDurationMs: {
    discoveryToDecision: number | null;
    decisionToDispatch: number | null;
    dispatchToDelivery: number | null;
    discoveryToDelivery: number | null;
  };
}

// ----------------------------------------------------------------------------
// openPipeline
// ----------------------------------------------------------------------------

export async function openPipeline(
  input: OpenPipelineInput,
): Promise<{ pipelineId: number }> {
  if (!PIPELINE_KINDS.includes(input.pipelineKind)) {
    throw new Error(
      `openPipeline: invalid pipelineKind=${input.pipelineKind}`,
    );
  }

  const now = new Date();
  const [inserted] = await db
    .insert(solenePipelines)
    .values({
      pipelineKind: input.pipelineKind,
      currentStage: "discovery",
      triggeringSourceKind: input.triggeringSourceKind ?? null,
      triggeringSourceId: input.triggeringSourceId ?? null,
      improvementOpportunityId: input.improvementOpportunityId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: solenePipelines.id });

  if (!inserted) {
    throw new Error("openPipeline: insert returned no id");
  }

  logger.info(
    `[pipeline] opened id=${inserted.id} kind=${input.pipelineKind} stage=discovery`,
  );

  return { pipelineId: inserted.id };
}

// ----------------------------------------------------------------------------
// advanceToDecision
// ----------------------------------------------------------------------------

export async function advanceToDecision(
  input: AdvanceToDecisionInput,
): Promise<void> {
  const existing = await getPipeline(input.pipelineId);
  if (!existing) {
    throw new Error(
      `advanceToDecision: pipeline id=${input.pipelineId} not found`,
    );
  }
  if (existing.currentStage !== "discovery") {
    throw new Error(
      `advanceToDecision: pipeline id=${input.pipelineId} is stage=${existing.currentStage}; only 'discovery' can advance to 'decision'`,
    );
  }

  const now = new Date();
  const durationMs = Math.max(0, now.getTime() - existing.createdAt.getTime());

  await db
    .update(solenePipelines)
    .set({
      currentStage: "decision",
      planProposalId: input.planProposalId,
      durationMsDiscoveryToDecision: durationMs,
      updatedAt: now,
    })
    .where(eq(solenePipelines.id, input.pipelineId));

  logger.info(
    `[pipeline] id=${input.pipelineId} discovery→decision plan=${input.planProposalId} duration_ms=${durationMs}`,
  );
}

// ----------------------------------------------------------------------------
// advanceToDispatch
// ----------------------------------------------------------------------------

export async function advanceToDispatch(
  input: AdvanceToDispatchInput,
): Promise<void> {
  const existing = await getPipeline(input.pipelineId);
  if (!existing) {
    throw new Error(
      `advanceToDispatch: pipeline id=${input.pipelineId} not found`,
    );
  }
  // Allowed: decision → dispatch, or discovery → dispatch (skip-decision shortcut).
  if (
    existing.currentStage !== "decision" &&
    existing.currentStage !== "discovery"
  ) {
    throw new Error(
      `advanceToDispatch: pipeline id=${input.pipelineId} is stage=${existing.currentStage}; only 'discovery' or 'decision' can advance to 'dispatch'`,
    );
  }

  const now = new Date();

  // Duration from previous-stage entry to now.
  // If coming from 'decision', previous-stage entry ≈ createdAt + discoveryToDecision.
  // If coming from 'discovery' (skip-decision), there was no decision stage so
  // we leave durationMsDecisionToDispatch null.
  const patch: Record<string, unknown> = {
    currentStage: "dispatch",
    dispatchId: input.dispatchId,
    updatedAt: now,
  };

  if (existing.currentStage === "decision") {
    const decisionEnteredAt =
      existing.createdAt.getTime() +
      (existing.durationMsDiscoveryToDecision ?? 0);
    const durationMs = Math.max(0, now.getTime() - decisionEnteredAt);
    patch.durationMsDecisionToDispatch = durationMs;
  }
  // else: skip-decision → durationMsDecisionToDispatch stays null;
  // durationMsDiscoveryToDecision also stays null (there was no decision).

  await db
    .update(solenePipelines)
    .set(patch)
    .where(eq(solenePipelines.id, input.pipelineId));

  logger.info(
    `[pipeline] id=${input.pipelineId} ${existing.currentStage}→dispatch dispatch=${input.dispatchId}`,
  );
}

// ----------------------------------------------------------------------------
// advanceToDelivery
// ----------------------------------------------------------------------------

export async function advanceToDelivery(
  input: AdvanceToDeliveryInput,
): Promise<void> {
  const existing = await getPipeline(input.pipelineId);
  if (!existing) {
    throw new Error(
      `advanceToDelivery: pipeline id=${input.pipelineId} not found`,
    );
  }
  if (existing.currentStage !== "dispatch") {
    throw new Error(
      `advanceToDelivery: pipeline id=${input.pipelineId} is stage=${existing.currentStage}; only 'dispatch' can advance to 'delivery'`,
    );
  }

  const now = new Date();
  // Dispatch-entered-at = createdAt
  //   + (discoveryToDecision ?? 0)   (null on skip-decision path)
  //   + (decisionToDispatch ?? 0)    (null on skip-decision path)
  const dispatchEnteredAt =
    existing.createdAt.getTime() +
    (existing.durationMsDiscoveryToDecision ?? 0) +
    (existing.durationMsDecisionToDispatch ?? 0);
  const durationMs = Math.max(0, now.getTime() - dispatchEnteredAt);

  const patch: Record<string, unknown> = {
    currentStage: "delivery",
    durationMsDispatchToDelivery: durationMs,
    updatedAt: now,
  };
  if (input.reviewDispatchId !== undefined) {
    patch.reviewDispatchId = input.reviewDispatchId;
  }

  await db
    .update(solenePipelines)
    .set(patch)
    .where(eq(solenePipelines.id, input.pipelineId));

  logger.info(
    `[pipeline] id=${input.pipelineId} dispatch→delivery review=${input.reviewDispatchId ?? "none"} duration_ms=${durationMs}`,
  );
}

// ----------------------------------------------------------------------------
// closePipeline
// ----------------------------------------------------------------------------

export async function closePipeline(input: ClosePipelineInput): Promise<void> {
  if (!PIPELINE_OUTCOMES.includes(input.outcome)) {
    throw new Error(`closePipeline: invalid outcome=${input.outcome}`);
  }
  const existing = await getPipeline(input.pipelineId);
  if (!existing) {
    throw new Error(
      `closePipeline: pipeline id=${input.pipelineId} not found`,
    );
  }
  if (existing.currentStage !== "delivery") {
    throw new Error(
      `closePipeline: pipeline id=${input.pipelineId} is stage=${existing.currentStage}; only 'delivery' can close to 'completed'`,
    );
  }

  const now = new Date();
  await db
    .update(solenePipelines)
    .set({
      currentStage: "completed",
      finalOutcome: input.outcome,
      finalOutcomeNotes: input.notes ?? null,
      updatedAt: now,
    })
    .where(eq(solenePipelines.id, input.pipelineId));

  logger.info(
    `[pipeline] id=${input.pipelineId} delivery→completed outcome=${input.outcome}`,
  );
}

// ----------------------------------------------------------------------------
// abandonPipeline
// ----------------------------------------------------------------------------

export async function abandonPipeline(
  pipelineId: number,
  reason: string,
): Promise<void> {
  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw new Error("abandonPipeline: reason required");
  }
  const existing = await getPipeline(pipelineId);
  if (!existing) {
    throw new Error(`abandonPipeline: pipeline id=${pipelineId} not found`);
  }
  if (
    existing.currentStage === "completed" ||
    existing.currentStage === "abandoned"
  ) {
    throw new Error(
      `abandonPipeline: pipeline id=${pipelineId} is terminal stage=${existing.currentStage}`,
    );
  }

  const now = new Date();
  await db
    .update(solenePipelines)
    .set({
      currentStage: "abandoned",
      finalOutcome: "abandoned",
      finalOutcomeNotes: reason,
      updatedAt: now,
    })
    .where(eq(solenePipelines.id, pipelineId));

  logger.info(
    `[pipeline] id=${pipelineId} ${existing.currentStage}→abandoned reason="${reason}"`,
  );
}

// ----------------------------------------------------------------------------
// listPipelines
// ----------------------------------------------------------------------------

export async function listPipelines(opts?: {
  stage?: PipelineStage;
  kind?: PipelineKind;
  limit?: number;
}): Promise<SolenePipelineRow[]> {
  const limit = Math.min(Math.max(1, Math.floor(opts?.limit ?? 50)), 500);

  const conds = [];
  if (opts?.stage) conds.push(eq(solenePipelines.currentStage, opts.stage));
  if (opts?.kind) conds.push(eq(solenePipelines.pipelineKind, opts.kind));

  const where =
    conds.length === 0
      ? undefined
      : conds.length === 1
        ? conds[0]
        : and(...conds);

  const q = db.select().from(solenePipelines);
  const rows = where
    ? await q
        .where(where)
        .orderBy(desc(solenePipelines.updatedAt))
        .limit(limit)
    : await q.orderBy(desc(solenePipelines.updatedAt)).limit(limit);
  return rows;
}

// ----------------------------------------------------------------------------
// getPipeline
// ----------------------------------------------------------------------------

export async function getPipeline(
  pipelineId: number,
): Promise<SolenePipelineRow | null> {
  const [row] = await db
    .select()
    .from(solenePipelines)
    .where(eq(solenePipelines.id, pipelineId))
    .limit(1);
  return row ?? null;
}

// ----------------------------------------------------------------------------
// getFunnelSummary
// ----------------------------------------------------------------------------

export async function getFunnelSummary(
  windowDays: number,
): Promise<PipelineFunnel> {
  if (!Number.isFinite(windowDays) || windowDays <= 0) {
    throw new Error(
      `getFunnelSummary: windowDays=${windowDays} must be > 0`,
    );
  }

  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(solenePipelines)
    .where(gte(solenePipelines.createdAt, since));

  const byStage = Object.fromEntries(
    PIPELINE_STAGES.map((s) => [s, 0]),
  ) as Record<PipelineStage, number>;
  const byKind = Object.fromEntries(
    PIPELINE_KINDS.map((k) => [k, 0]),
  ) as Record<PipelineKind, number>;
  const byOutcome = Object.fromEntries(
    PIPELINE_OUTCOMES.map((o) => [o, 0]),
  ) as Record<PipelineOutcome, number>;

  const sums = {
    discoveryToDecision: { sum: 0, n: 0 },
    decisionToDispatch: { sum: 0, n: 0 },
    dispatchToDelivery: { sum: 0, n: 0 },
    discoveryToDelivery: { sum: 0, n: 0 },
  };

  for (const r of rows) {
    if ((PIPELINE_STAGES as readonly string[]).includes(r.currentStage)) {
      byStage[r.currentStage as PipelineStage] += 1;
    }
    if ((PIPELINE_KINDS as readonly string[]).includes(r.pipelineKind)) {
      byKind[r.pipelineKind as PipelineKind] += 1;
    }
    if (
      r.finalOutcome &&
      (PIPELINE_OUTCOMES as readonly string[]).includes(r.finalOutcome)
    ) {
      byOutcome[r.finalOutcome as PipelineOutcome] += 1;
    }

    if (typeof r.durationMsDiscoveryToDecision === "number") {
      sums.discoveryToDecision.sum += r.durationMsDiscoveryToDecision;
      sums.discoveryToDecision.n += 1;
    }
    if (typeof r.durationMsDecisionToDispatch === "number") {
      sums.decisionToDispatch.sum += r.durationMsDecisionToDispatch;
      sums.decisionToDispatch.n += 1;
    }
    if (typeof r.durationMsDispatchToDelivery === "number") {
      sums.dispatchToDelivery.sum += r.durationMsDispatchToDelivery;
      sums.dispatchToDelivery.n += 1;
    }
    // End-to-end discovery → delivery: only counted when dispatch→delivery
    // has been measured (i.e., the work actually delivered). We sum the
    // non-null per-stage durations, treating nulls as 0 (skip-decision path).
    if (typeof r.durationMsDispatchToDelivery === "number") {
      const total =
        (r.durationMsDiscoveryToDecision ?? 0) +
        (r.durationMsDecisionToDispatch ?? 0) +
        r.durationMsDispatchToDelivery;
      sums.discoveryToDelivery.sum += total;
      sums.discoveryToDelivery.n += 1;
    }
  }

  const avg = (s: { sum: number; n: number }): number | null =>
    s.n === 0 ? null : Math.round(s.sum / s.n);

  return {
    byStage,
    byKind,
    byOutcome,
    averageDurationMs: {
      discoveryToDecision: avg(sums.discoveryToDecision),
      decisionToDispatch: avg(sums.decisionToDispatch),
      dispatchToDelivery: avg(sums.dispatchToDelivery),
      discoveryToDelivery: avg(sums.discoveryToDelivery),
    },
  };
}

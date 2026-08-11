/**
 * Collection-sequence arming service (founder ruling R-3, 2026-08-11).
 *
 * This is the CHOKEPOINT that makes `collection_sequences.auto_start`
 * load-bearing. Before R-3 the column existed, defaulted to TRUE, and was read
 * by nothing — so flipping the default alone would have changed no behaviour.
 * Every path that can begin debt-collection-adjacent contact with a consumer
 * now passes through `assertSequenceArmed()` first.
 *
 * Call sites (grep before deleting anything here):
 *   • server/services/agent-skills.ts → startCollectionSequence skill
 *   • server/routes-va-engine.ts      → POST /api/collection-enrollments
 *
 * Every query is org-scoped at the query, not filtered afterwards.
 *
 * MONEY POSTURE: nothing here moves money. A dunning contact tells a consumer
 * money is owed on the CUSTOMER'S own rails; AcreOS is not a party to the debt.
 */

import { db } from "../db";
import { and, eq, inArray } from "drizzle-orm";
import { collectionSequences, collectionEnrollments, type CollectionSequence } from "@shared/schema";
import {
  describeArmingPlan,
  isArmedForDispatch,
  ladderDigest,
  needsConfirmation,
  UNARMED_REFUSAL,
  type ArmingPlan,
} from "@shared/collections/arming";
import { logger } from "../utils/logger";

export interface ArmingRefusal {
  ok: false;
  reason: string;
  /** Machine-readable so callers can branch without string-matching. */
  code: "sequence_unarmed";
  plan: ArmingPlan;
}

export type ArmingCheck = { ok: true; plan: ArmingPlan } | ArmingRefusal;

/**
 * Gate an enrollment. Refuses only for `unarmed` — an `armed_unconfirmed` row
 * (created under the old schema default) is allowed through on purpose so a
 * live collection is not cut off mid-ladder; it is simultaneously listed by
 * `listSequencesNeedingConfirmation()` until a human owns it.
 */
export function assertSequenceArmed(sequence: CollectionSequence): ArmingCheck {
  const plan = describeArmingPlan(sequence);
  if (!isArmedForDispatch(sequence)) {
    return { ok: false, code: "sequence_unarmed", reason: UNARMED_REFUSAL, plan };
  }
  return { ok: true, plan };
}

/** Every sequence in the org, with its arming disclosure attached. */
export async function listSequencesWithArming(
  organizationId: number,
): Promise<Array<CollectionSequence & { arming: ArmingPlan }>> {
  const rows = await db
    .select()
    .from(collectionSequences)
    .where(eq(collectionSequences.organizationId, organizationId));
  return rows.map((row) => ({ ...row, arming: describeArmingPlan(row) }));
}

/**
 * The confirm surface's population: sequences that are running but have nobody
 * on record (`armed_unconfirmed`), plus sequences whose ladder was edited after
 * confirmation (`armed_stale`).
 */
export async function listSequencesNeedingConfirmation(
  organizationId: number,
): Promise<Array<CollectionSequence & { arming: ArmingPlan }>> {
  const rows = await listSequencesWithArming(organizationId);
  return rows.filter((row) => needsConfirmation(row));
}

/**
 * Arm or confirm a sequence.
 *
 * `acknowledgedDigest` is the digest of the ladder the customer actually had on
 * screen. A mismatch means the ladder changed between render and tap, so the
 * confirmation is refused rather than applied to steps nobody saw.
 */
export async function armSequence(
  organizationId: number,
  sequenceId: number,
  userId: string,
  acknowledgedDigest: string,
): Promise<
  | { ok: true; sequence: CollectionSequence & { arming: ArmingPlan } }
  | { ok: false; code: "not_found" | "ladder_changed"; reason: string }
> {
  const [existing] = await db
    .select()
    .from(collectionSequences)
    .where(
      and(
        eq(collectionSequences.id, sequenceId),
        eq(collectionSequences.organizationId, organizationId),
      ),
    );
  if (!existing) {
    return { ok: false, code: "not_found", reason: "Collection sequence not found" };
  }

  const currentDigest = ladderDigest(existing.steps);
  if (currentDigest !== acknowledgedDigest) {
    return {
      ok: false,
      code: "ladder_changed",
      reason:
        "The ladder changed since it was shown to you. Review the current steps and confirm again.",
    };
  }

  const [updated] = await db
    .update(collectionSequences)
    .set({
      autoStart: true,
      armedAt: new Date(),
      armedBy: userId,
      armedLadderDigest: currentDigest,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(collectionSequences.id, sequenceId),
        eq(collectionSequences.organizationId, organizationId),
      ),
    )
    .returning();

  logger.info("[CollectionArming] Sequence armed", {
    metadata: {
      __pii_safe: true,
      organizationId,
      sequenceId,
      digest: currentDigest,
      steps: (existing.steps ?? []).length,
    },
  });

  return { ok: true, sequence: { ...updated, arming: describeArmingPlan(updated) } };
}

/** Stand a sequence down. Clears the arming record so re-arming re-discloses. */
/**
 * Disarm a sequence AND stop the ladders already running on it.
 *
 * The row update alone was not enough, and the gap was a lie the customer
 * could read: `autoStart` is consulted in exactly one place — `assertSequenceArmed`,
 * which runs only when an enrollment is CREATED — and nothing re-checks it at
 * dispatch time. So flipping the row stopped NEW enrollments and left every
 * in-flight ladder walking, while the surface said "No further messages will
 * be sent." A customer with 40 notes already enrolled would have kept sending
 * to all 40 after being told they had stopped.
 *
 * Cancelling the enrollments is the honest reading of an off switch, and it is
 * what the control's own label promises. The count is returned so the surface
 * can say exactly what it stopped rather than asserting a blanket silence.
 */
export async function disarmSequence(
  organizationId: number,
  sequenceId: number,
): Promise<
  | {
      ok: true;
      sequence: CollectionSequence & { arming: ArmingPlan };
      cancelledEnrollments: number;
    }
  | { ok: false; code: "not_found"; reason: string }
> {
  const [updated] = await db
    .update(collectionSequences)
    .set({
      autoStart: false,
      armedAt: null,
      armedBy: null,
      armedLadderDigest: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(collectionSequences.id, sequenceId),
        eq(collectionSequences.organizationId, organizationId),
      ),
    )
    .returning();

  if (!updated) {
    return { ok: false, code: "not_found", reason: "Collection sequence not found" };
  }

  // Stop the ladders that are already walking. Org-scoped at the query, and
  // only the statuses that can still send — a completed or already-cancelled
  // enrollment is left alone so the count means "what this actually stopped".
  const cancelled = await db
    .update(collectionEnrollments)
    .set({
      status: "cancelled",
      // The table's own outcome vocabulary (schema: paid | partial_paid |
      // no_response | escalated | cancelled) — not a new string invented here.
      outcome: "cancelled",
      completedAt: new Date(),
    })
    .where(
      and(
        eq(collectionEnrollments.organizationId, organizationId),
        eq(collectionEnrollments.sequenceId, sequenceId),
        // The only statuses that can still send, per the column's own comment.
        inArray(collectionEnrollments.status, ["active", "paused"]),
      ),
    )
    .returning({ id: collectionEnrollments.id });

  logger.info("[CollectionArming] Sequence disarmed", {
    metadata: {
      __pii_safe: true,
      organizationId,
      sequenceId,
      cancelledEnrollments: cancelled.length,
    },
  });

  return {
    ok: true,
    sequence: { ...updated, arming: describeArmingPlan(updated) },
    cancelledEnrollments: cancelled.length,
  };
}

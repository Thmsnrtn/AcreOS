/**
 * Founder Autopilot — the execution seam (Elite Vision H1).
 *
 * The witnessed-send surface for AUTOPILOT hands. When a dispatched agent drafts
 * a customer-facing action and calls an approval-required hand, the executor
 * FREEZES it here instead of sending. The founder approves it in /decisions;
 * approval re-verifies the content hash and fires executeHandWitnessed exactly
 * once. This closes the loop the brain was missing: decide → draft → FREEZE →
 * founder tap → send → audit.
 *
 * Safety contract (mirrors the org-scoped approvalKernel, founder-scoped here):
 *   • Frozen args + sha256 content hash binding approval to exactly this action.
 *   • 24h expiry — a stale draft must be re-witnessed.
 *   • Idempotent pending→approved claim: exactly one approval executes.
 *   • Hash re-verified at approval — tampered args refuse.
 *   • Append-only autopilot_sends audit on success (no UPDATE path).
 *   • executeHandWitnessed is the ONLY executor; it itself refuses without a
 *     real approver identity. There is no path from a model call to a live send.
 */
import { and, eq, desc, sql } from "drizzle-orm";
import { db } from "../../db";
import { autopilotPendingActions, autopilotSends, type AutopilotPendingAction } from "@shared/schema";
import { actionContentHash } from "../approvalKernel";
import { executeHandWitnessed } from "./hands";
import { logger } from "../../utils/logger";

const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * F2 slice 2 (handoff P6 §3, "one decision queue") — keep the founder's ONE
 * ranked queue in step with this store.
 *
 * A frozen hand is a decision inflow: it gets a MIRROR card in the decisions
 * queue so it carries a rank against everything else waiting (a frozen refund
 * should not sit below a marketing email just because it was drafted later).
 * The card is presence + rank only — the disposition control stays here, where
 * the content hash is re-verified before anything sends.
 *
 * Both hooks are BEST-EFFORT by contract, and deliberately so in both
 * directions: a mirror failure must never turn a freeze into a send (or into a
 * refusal), and it must never fail a founder's approval either. Dynamic import
 * keeps the decisions service out of this module's import graph — hands/ is
 * loaded by the dispatch executor at tool-call time and must stay light.
 */
async function mirrorPendingHand(pendingActionId: number): Promise<void> {
  try {
    const { decisionsInboxService } = await import("../decisionsInbox");
    await decisionsInboxService.createFromPendingHand(pendingActionId);
  } catch (err) {
    logger.warn(
      "[autopilot/pendingHands] decisions-queue mirror failed (the frozen action is unaffected)",
      err instanceof Error ? err : undefined,
    );
  }
}

async function resolvePendingHandMirror(
  pendingActionId: number,
  status: "approved" | "rejected" | "auto_resolved",
  detail: string,
  resolvedBy?: string,
): Promise<void> {
  try {
    const { decisionsInboxService } = await import("../decisionsInbox");
    await decisionsInboxService.resolveMirrorItem({
      itemType: "witnessed_send",
      sourceId: pendingActionId,
      status,
      detail,
      resolvedBy,
    });
  } catch (err) {
    logger.warn(
      "[autopilot/pendingHands] decisions-queue mirror resolution failed",
      err instanceof Error ? err : undefined,
    );
  }
}

/**
 * Freeze a hand call for the founder's approval. Reuses an identical live
 * pending row (same hand + content hash) so a re-proposed draft doesn't mint a
 * second approval target. Best-effort: returns null on DB failure (the caller
 * then falls back to a plain refusal — never a silent send).
 */
export async function proposePendingHand(input: {
  handName: string;
  args: Record<string, unknown>;
  domain?: string | null;
  summary?: string | null;
  sourceDispatchId?: number | null;
  now?: number;
}): Promise<AutopilotPendingAction | null> {
  try {
    const contentHash = actionContentHash(input.handName, input.args);
    const now = input.now ?? Date.now();
    const existing = await db
      .select()
      .from(autopilotPendingActions)
      .where(
        and(
          eq(autopilotPendingActions.handName, input.handName),
          eq(autopilotPendingActions.contentHash, contentHash),
          eq(autopilotPendingActions.status, "pending"),
        ),
      );
    const live = existing.find((r) => r.expiresAt && r.expiresAt.getTime() > now);
    if (live) {
      // Re-mirror the reused row too: createFromPendingHand dedupes on an open
      // card, so this is a no-op when the card exists and a self-heal when an
      // earlier mirror attempt failed.
      await mirrorPendingHand(live.id);
      return live;
    }

    const [row] = await db
      .insert(autopilotPendingActions)
      .values({
        handName: input.handName,
        args: input.args,
        contentHash,
        domain: input.domain ?? null,
        summary: input.summary ?? null,
        sourceDispatchId: input.sourceDispatchId ?? null,
        status: "pending",
        expiresAt: new Date(now + TTL_MS),
      })
      .returning();
    logger.info("[autopilot/pendingHands] action frozen for founder approval", { metadata: { id: row.id, handName: input.handName } });
    await mirrorPendingHand(row.id);
    return row;
  } catch (err) {
    logger.warn("[autopilot/pendingHands] propose failed (will refuse instead)", err instanceof Error ? err : undefined);
    return null;
  }
}

export type ApprovalOutcome =
  | { outcome: "not_found" }
  | { outcome: "expired" }
  | { outcome: "rejected" }
  | { outcome: "hash_mismatch" }
  | { outcome: "in_flight" }
  | { outcome: "already_executed"; result: Record<string, unknown> | null }
  | { outcome: "executed"; result: Record<string, unknown> }
  | { outcome: "execution_failed"; error: string };

/** Approve + execute exactly one frozen action. Founder-witnessed. */
export async function approvePendingHand(input: {
  id: number;
  approvedBy: string;
  /**
   * HOW this approval happened. Required rather than defaulted, because the
   * default was the bug: `autoWitness` taps through this exact function under
   * a standing grant, and with no way to tell the two apart the mirror
   * recorded a machine send as `founder_deep_surface` — a founder review that
   * never occurred, filed under "You reviewed" and then ingested into the
   * model-read corpus by `decisionLogRag`.
   *
   * `approvedBy` already carried the truth here; nothing read it.
   */
  via: "founder_tap" | "witness_grant";
  now?: number;
}): Promise<ApprovalOutcome> {
  const now = input.now ?? Date.now();
  const [action] = await db.select().from(autopilotPendingActions).where(eq(autopilotPendingActions.id, input.id));
  if (!action) return { outcome: "not_found" };
  if (action.status === "rejected") return { outcome: "rejected" };
  if (action.status === "executed") return { outcome: "already_executed", result: (action.resultSummary as Record<string, unknown>) ?? null };
  if (action.status === "expired" || !action.expiresAt || action.expiresAt.getTime() <= now) {
    if (action.status === "pending") {
      await db.update(autopilotPendingActions).set({ status: "expired" }).where(and(eq(autopilotPendingActions.id, input.id), eq(autopilotPendingActions.status, "pending")));
    }
    // NOT "rejected". The founder tapped APPROVE; the draft merely aged out.
    // Recording a rejection here would put a decline the founder never made
    // into the decision log's "You reviewed" bucket — the same fabrication the
    // sweep path is already pinned against (`expect(status).not.toBe(
    // "rejected")`), which simply was not applied to this second expiry path.
    await resolvePendingHandMirror(
      input.id,
      "auto_resolved",
      "The frozen draft passed its 24-hour approval window and can never send. Nothing was sent.",
      "witnessed_send_expired",
    );
    return { outcome: "expired" };
  }

  // Re-verify the hash against the frozen args — tamper → refuse.
  const recomputed = actionContentHash(action.handName, action.args as Record<string, unknown>);
  if (recomputed !== action.contentHash) {
    logger.warn("[autopilot/pendingHands] content hash mismatch — refusing", { metadata: { id: input.id } });
    return { outcome: "hash_mismatch" };
  }

  // Atomic claim: exactly one approval transitions pending→approved.
  const claimed = await db
    .update(autopilotPendingActions)
    .set({ status: "approved", approvedBy: input.approvedBy })
    .where(and(eq(autopilotPendingActions.id, input.id), eq(autopilotPendingActions.status, "pending")))
    .returning();
  if (claimed.length === 0) {
    const [cur] = await db.select().from(autopilotPendingActions).where(eq(autopilotPendingActions.id, input.id));
    if (cur?.status === "executed") return { outcome: "already_executed", result: (cur.resultSummary as Record<string, unknown>) ?? null };
    if (cur?.status === "rejected") return { outcome: "rejected" };
    return { outcome: "in_flight" };
  }

  // Execute EXACTLY the frozen row through the witnessed executor.
  const result = await executeHandWitnessed(action.handName, action.args as Record<string, unknown>, input.approvedBy, { dispatchId: action.sourceDispatchId ?? null });
  if (!result.success) {
    // Nothing sent — release the claim so the founder can retry.
    await db.update(autopilotPendingActions).set({ status: "pending", approvedBy: null }).where(and(eq(autopilotPendingActions.id, input.id), eq(autopilotPendingActions.status, "approved")));
    return { outcome: "execution_failed", error: result.output };
  }

  const resultSummary = { success: true, output: result.output };
  await db.update(autopilotPendingActions).set({ status: "executed", executedAt: new Date(), resultSummary }).where(and(eq(autopilotPendingActions.id, input.id), eq(autopilotPendingActions.status, "approved")));
  // Append-only audit (INSERT only — no UPDATE path, by contract).
  await db.insert(autopilotSends).values({
    pendingActionId: action.id,
    handName: action.handName,
    domain: action.domain,
    approvedBy: input.approvedBy,
    contentHash: action.contentHash,
  });
  logger.info("[autopilot/pendingHands] action executed after founder approval", { metadata: { id: input.id, handName: action.handName } });
  // The audit trail must distinguish a tap from a delegation. A send made
  // under a standing grant while the founder was away belongs in the
  // "Auto-handled" bucket — what the system did in your absence — not in
  // "You reviewed".
  if (input.via === "witness_grant") {
    await resolvePendingHandMirror(
      input.id,
      "auto_resolved",
      `Sent under a witness grant you issued — ${action.handName} executed without a tap from you. Authorised by: ${input.approvedBy}.`,
      "witness_grant_delegated",
    );
  } else {
    await resolvePendingHandMirror(
      input.id,
      "approved",
      `Approved and sent from the witnessed-send card on Decisions — ${action.handName} executed on your tap.`,
    );
  }
  return { outcome: "executed", result: resultSummary };
}

/** Reject a frozen action — terminal; it can never execute afterwards. */
export async function rejectPendingHand(id: number): Promise<{ outcome: "rejected" | "not_found" | "already_executed" }> {
  const updated = await db
    .update(autopilotPendingActions)
    .set({ status: "rejected" })
    .where(and(eq(autopilotPendingActions.id, id), eq(autopilotPendingActions.status, "pending")))
    .returning();
  if (updated.length > 0) {
    await resolvePendingHandMirror(
      id,
      "rejected",
      "Rejected from the witnessed-send card on Decisions — the autopilot will not send this.",
    );
    return { outcome: "rejected" };
  }
  const [cur] = await db.select().from(autopilotPendingActions).where(eq(autopilotPendingActions.id, id));
  if (!cur) return { outcome: "not_found" };
  if (cur.status === "executed") return { outcome: "already_executed" };
  return { outcome: "rejected" };
}

/** Open frozen actions for the founder's /decisions queue (newest first). */
export async function listPendingHands(limit = 50): Promise<AutopilotPendingAction[]> {
  try {
    return await db
      .select()
      .from(autopilotPendingActions)
      .where(and(eq(autopilotPendingActions.status, "pending"), sql`${autopilotPendingActions.expiresAt} > now()`))
      .orderBy(desc(autopilotPendingActions.createdAt))
      .limit(limit);
  } catch (err) {
    logger.warn("[autopilot/pendingHands] list failed", err instanceof Error ? err : undefined);
    return [];
  }
}

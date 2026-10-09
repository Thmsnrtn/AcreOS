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
import { clock } from "../../utils/clock";

const TTL_MS = 24 * 60 * 60 * 1000;

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
  /**
   * The role worker (or seam) that drafted it — server code sets this, never a
   * model. Absent ⇒ no WitnessGrant may ever release the action.
   */
  sourceRole?: string | null;
  now?: number;
}): Promise<AutopilotPendingAction | null> {
  try {
    const contentHash = actionContentHash(input.handName, input.args);
    const now = input.now ?? clock.nowMs();
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
    // A draft only folds into a row with the SAME drafter: a role-drafted row
    // must never stand in for a coding agent's identical draft, or vice versa.
    const live = existing.find((r) => r.expiresAt && r.expiresAt.getTime() > now && (r.sourceRole ?? null) === (input.sourceRole ?? null));
    if (live) return live;

    const [row] = await db
      .insert(autopilotPendingActions)
      .values({
        handName: input.handName,
        args: input.args,
        contentHash,
        domain: input.domain ?? null,
        summary: input.summary ?? null,
        sourceDispatchId: input.sourceDispatchId ?? null,
        sourceRole: input.sourceRole ?? null,
        status: "pending",
        expiresAt: new Date(now + TTL_MS),
      })
      .returning();
    logger.info("[autopilot/pendingHands] action frozen for founder approval", { metadata: { id: row.id, handName: input.handName } });
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
   * Set ONLY by the auto-witness sweep: the grant releasing this action. The
   * executor then re-checks every delegated-release rule at execution (the
   * controls, the hand/role bounds, the hand's own delegated rules) against
   * the ROW's source_role — never a caller-supplied one.
   */
  delegation?: { grantId: string };
  now?: number;
}): Promise<ApprovalOutcome> {
  const now = input.now ?? clock.nowMs();
  const [action] = await db.select().from(autopilotPendingActions).where(eq(autopilotPendingActions.id, input.id));
  if (!action) return { outcome: "not_found" };
  if (action.status === "rejected") return { outcome: "rejected" };
  if (action.status === "executed") return { outcome: "already_executed", result: (action.resultSummary as Record<string, unknown>) ?? null };
  if (action.status === "expired" || !action.expiresAt || action.expiresAt.getTime() <= now) {
    if (action.status === "pending") {
      await db.update(autopilotPendingActions).set({ status: "expired" }).where(and(eq(autopilotPendingActions.id, input.id), eq(autopilotPendingActions.status, "pending")));
    }
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
  const result = await executeHandWitnessed(action.handName, action.args as Record<string, unknown>, input.approvedBy, {
    dispatchId: action.sourceDispatchId ?? null,
    ...(input.delegation ? { delegation: { grantId: input.delegation.grantId, sourceRole: action.sourceRole ?? null } } : {}),
  });
  if (!result.success) {
    // Nothing sent — release the claim so the founder can retry.
    await db.update(autopilotPendingActions).set({ status: "pending", approvedBy: null }).where(and(eq(autopilotPendingActions.id, input.id), eq(autopilotPendingActions.status, "approved")));
    return { outcome: "execution_failed", error: result.output };
  }

  const resultSummary = { success: true, output: result.output };
  await db.update(autopilotPendingActions).set({ status: "executed", executedAt: clock.now(), resultSummary }).where(and(eq(autopilotPendingActions.id, input.id), eq(autopilotPendingActions.status, "approved")));
  // Append-only audit (INSERT only — no UPDATE path, by contract).
  await db.insert(autopilotSends).values({
    pendingActionId: action.id,
    handName: action.handName,
    domain: action.domain,
    approvedBy: input.approvedBy,
    contentHash: action.contentHash,
  });
  logger.info("[autopilot/pendingHands] action executed after founder approval", { metadata: { id: input.id, handName: action.handName } });
  return { outcome: "executed", result: resultSummary };
}

/** Reject a frozen action — terminal; it can never execute afterwards. */
export async function rejectPendingHand(id: number): Promise<{ outcome: "rejected" | "not_found" | "already_executed" }> {
  const updated = await db
    .update(autopilotPendingActions)
    .set({ status: "rejected" })
    .where(and(eq(autopilotPendingActions.id, id), eq(autopilotPendingActions.status, "pending")))
    .returning();
  if (updated.length > 0) return { outcome: "rejected" };
  const [cur] = await db.select().from(autopilotPendingActions).where(eq(autopilotPendingActions.id, id));
  if (!cur) return { outcome: "not_found" };
  if (cur.status === "executed") return { outcome: "already_executed" };
  return { outcome: "rejected" };
}

/** Open frozen actions for the founder's /decisions queue (newest first). */
// Throws on a failed read (DEFECT-0163): returning [] made "nothing is
// frozen" the answer to "could not look", on the Controls door, the step-away
// check and the board report alike.
export async function listPendingHands(limit = 50): Promise<AutopilotPendingAction[]> {
  return db
    .select()
    .from(autopilotPendingActions)
    .where(and(eq(autopilotPendingActions.status, "pending"), sql`${autopilotPendingActions.expiresAt} > now()`))
    .orderBy(desc(autopilotPendingActions.createdAt))
    .limit(limit);
}

/**
 * Frozen-send visibility counters (stage-4 turn 5, OD-9). The grants-for-all
 * ruling only stays honest if an expiring card is a VISIBLE event: these
 * counters feed the Story door strip and the Letter's line, so a send dying
 * at the 24h TTL is something the founder sees counted, never a silent drop.
 * "Auto-witnessed" is recognized by the approver attribution the sweep
 * writes ("… via witness-grant #N") — the same string the audit carries.
 */
export async function pendingHandCounters(windowHours = 168): Promise<{
  windowHours: number;
  proposed: number;
  tappedByFounder: number;
  autoWitnessed: number;
  expiredUnseen: number;
  pendingNow: number;
}> {
  const since = new Date(clock.nowMs() - windowHours * 3600_000);
  const rows = await db
    .select({
      status: autopilotPendingActions.status,
      approvedBy: autopilotPendingActions.approvedBy,
      expiresAt: autopilotPendingActions.expiresAt,
      createdAt: autopilotPendingActions.createdAt,
    })
    .from(autopilotPendingActions)
    .where(sql`${autopilotPendingActions.createdAt} >= ${since}`);
  const now = clock.nowMs();
  let tapped = 0, auto = 0, expired = 0, pendingNow = 0;
  for (const r of rows) {
    // Released without a founder tap: by a grant, or by the standing
    // routine-support policy (founder decision 2026-10-09).
    const viaGrant = (r.approvedBy ?? "").includes("via witness-grant #") || (r.approvedBy ?? "").startsWith("solene (routine-support policy");
    if (r.status === "approved" || r.status === "executed") {
      if (viaGrant) auto++; else tapped++;
    } else if (r.status === "expired" || (r.status === "pending" && (!r.expiresAt || r.expiresAt.getTime() <= now))) {
      // A pending row with no expiry is expired: approvePendingHand refuses
      // it and listPendingHands does not show it, so counting it "pending
      // now" put a number on the Controls door no list could explain.
      expired++;
    } else if (r.status === "pending") {
      pendingNow++;
    }
  }
  return { windowHours, proposed: rows.length, tappedByFounder: tapped, autoWitnessed: auto, expiredUnseen: expired, pendingNow };
}

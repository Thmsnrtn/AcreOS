/**
 * Pending-action expiry sweep (every 5 minutes) — S3 decomposition slice.
 *
 * Customer review-queue plumbing (autonomy clarity program, 2026-09-02).
 * pending_actions rows expire after PENDING_ACTION_TTL_MS (24h) but the
 * status column was only ever flipped LAZILY — when a human tapped Approve on
 * a stale row. Every reader (list / count / the kernel's own duplicate-reuse
 * check) applies `expires_at > now()` itself, so this sweep changes no
 * visible behaviour of the LIVE queue: it is bookkeeping that keeps `status`
 * truthful for the audit trail, for "Expired — ask Pax to draft it again"
 * (the needs-you list shows rows expired within 7 days), and for anything
 * that groups by status. Guarded UPDATE (`status = 'pending' AND expires_at
 * <= now()`) inside the kernel, so overlapping or repeated runs are safe.
 *
 * Wave 1 (AUTONOMY_SPEC.md §4.5, §4.7): the sweep runs every five minutes
 * instead of once a night — an ask that expired at 9:14 should read
 * "expired" by 9:19, not tomorrow — and every row it flips leaves an
 * `ask_expired` receipt in "What Pax did" (attributed to the org, the ask's
 * own origin and the org's stance at the time). The kernel's sweep
 * (server/services/approvalKernel.ts) owns the status flip and the
 * `pax.needs_you` broadcast; this job owns the cadence, the lock, and the
 * receipts. Receipts are written for the rows this run found due BEFORE the
 * flip: a row tapped in the gap between read and flip is not expired by the
 * sweep, and its receipt refers to a row that reads `executed`, which the
 * reader can tell apart — never a fabricated expiry.
 *
 * Same shared runtime as every other job (jobRuntime lock/interval/log);
 * runScheduledJobs.ts calls the start* entrypoint from its orchestrator like
 * the other extracted slices.
 */

import { and, eq, sql } from "drizzle-orm";
import { pendingActions } from "@shared/schema";
import { unscopedForPlatformOps } from "../utils/orgScopedDb";
import { trackInterval, withJobLock, jobLog as log } from "../utils/jobRuntime";
import { logger } from "../utils/logger";
import { groupForTool, type PaxAskOrigin } from "@shared/pax-controls";
import { recordPaxEffect } from "../services/paxReceipts";
import { getPaxControls } from "../services/paxControls";

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const SWEEP_LOCK_TTL_SECONDS = 4 * 60;
/** Bound on how many expiry receipts one run writes; the flip itself is unbounded. */
const RECEIPT_BATCH = 500;

interface DueRow {
  id: number;
  organizationId: number;
  toolName: string;
  origin: PaxAskOrigin | null;
}

/** The rows the sweep is about to flip — read cross-org for the same reason the flip is. */
async function readDueRows(): Promise<DueRow[]> {
  const platformDb = unscopedForPlatformOps(
    "pending-action expiry sweep: cross-org read of rows past TTL so each flip leaves an attributed receipt",
  );
  return platformDb
    .select({
      id: pendingActions.id,
      organizationId: pendingActions.organizationId,
      toolName: pendingActions.toolName,
      origin: pendingActions.origin,
    })
    .from(pendingActions)
    .where(and(eq(pendingActions.status, "pending"), sql`${pendingActions.expiresAt} <= now()`))
    .limit(RECEIPT_BATCH);
}

/** One sweep: read what is due, flip it through the kernel, receipt each row. */
async function runPendingActionExpirySweep(): Promise<{ flipped: number; receipted: number }> {
  let due: DueRow[] = [];
  try {
    due = await readDueRows();
  } catch (err) {
    // The flip does not depend on this read; the receipts do. Say so.
    logger.error("[pending-action-expiry] Could not read due rows — flipping without receipts", err as Error);
  }

  const { sweepExpiredPendingActions } = await import("../services/approvalKernel");
  const flipped = await sweepExpiredPendingActions();

  let receipted = 0;
  const stanceByOrg = new Map<number, Awaited<ReturnType<typeof getPaxControls>>>();
  for (const row of due) {
    let controls = stanceByOrg.get(row.organizationId);
    if (!controls) {
      controls = await getPaxControls(row.organizationId);
      stanceByOrg.set(row.organizationId, controls);
    }
    const { written } = await recordPaxEffect({
      orgId: row.organizationId,
      actor: "pax",
      origin: row.origin ?? "engine",
      group: groupForTool(row.toolName) ?? undefined,
      stance: controls.checkFailed ? null : controls.stance,
      tool: row.toolName,
      action: "ask_expired",
      entityType: "pending_action",
      entityId: row.id,
      description: `${row.toolName.replace(/[_-]+/g, " ")} — expired before a tap`,
      after: { pendingActionId: row.id, status: "expired" },
      witnessed: false,
    });
    if (written) receipted++;

    // Tell the customer their ask lapsed. dispatchPaxAskEvent's own header
    // named this sweep as one of its two wave-1 callers and neither was
    // wired, so the lane was built and never fired (2026-09-04 central
    // verification). Best-effort by the same contract as the receipt: the
    // row is already flipped, and a notification that fails must not stop
    // the sweep from finishing the rest of the batch.
    try {
      const { dispatchPaxAskEvent } = await import("../services/notificationDispatcher");
      await dispatchPaxAskEvent({
        type: "pax:ask_expired",
        orgId: row.organizationId,
        pendingActionId: row.id,
      });
    } catch (err) {
      logger.warn(
        "[pending-action-expiry] pax:ask_expired notification failed (the row is expired regardless)",
        err instanceof Error ? err : undefined,
      );
    }
  }

  return { flipped, receipted };
}

export function startPendingActionExpiryJob(): void {
  log("Registering pending-action expiry sweep (every 5 minutes)", "pending-action-expiry");
  trackInterval(() => {
    void withJobLock("pending_action_expiry_sweep", SWEEP_LOCK_TTL_SECONDS, async () => {
      const { flipped, receipted } = await runPendingActionExpirySweep();
      if (flipped > 0 || receipted > 0) {
        log(
          `Pending-action expiry sweep complete: ${flipped} flipped pending → expired, ${receipted} receipt(s) written`,
          "pending-action-expiry",
        );
      }
    }).catch((err) => {
      log(`Pending-action expiry sweep failed: ${err}`, "pending-action-expiry");
    });
  }, SWEEP_INTERVAL_MS);
}

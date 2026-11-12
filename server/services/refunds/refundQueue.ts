/**
 * The founder refund queue + the SLA/escalation sweep (design 2026-11 §3.3).
 *
 * Every request that automation did not process lands here, with an internal
 * decision clock: dueAt = createdAt + 24h. The 24h is the DECISION discipline
 * for queued items — stricter than any published promise; §5A's 5–10 business
 * days is the PROCESSING promise for approved refunds.
 *
 *   reminder   at dueAt
 *   escalation at dueAt + 24h (severity raised to critical + a founder ask)
 *   uncertain  items are listed — and re-announced daily — until resolved
 *
 * Reads and writes here cross orgs on purpose (the founder's queue is
 * platform-wide), always through unscopedForPlatformOps.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { refundRequests, systemAlerts, type RefundRequest } from "@shared/schema";
import { logger } from "../../utils/logger";
import { clock } from "../../utils/clock";
import { storage } from "../../storage";
import { unscopedForPlatformOps } from "../../utils/orgScopedDb";
import type { AuditActor } from "../../utils/auditLog";
import { executeRefundRequest, completeProcessedRefund, withExecution, type ExecuteRefundResult } from "./executeRefund";
import { REFUND_ESCALATION_AFTER_DUE_HOURS, REFUND_MAX_AUTO_ATTEMPTS, REFUND_STUCK_PROCESSING_AFTER_HOURS } from "./refundConfig";
import { raiseRefundPipelineAlert } from "./refundAlerts";

const HOUR_MS = 60 * 60 * 1000;
const QUEUE_REASON = "founder refund queue / SLA sweep: refund_requests are read and decided platform-wide";

export type SlaState = "on_track" | "due" | "escalated" | "no_sla";

/** Where a queued request stands against its decision clock. Pure. */
export function slaStateOf(dueAt: Date | null | undefined, nowMs: number): SlaState {
  if (!dueAt) return "no_sla";
  const due = new Date(dueAt).getTime();
  if (nowMs < due) return "on_track";
  return nowMs < due + REFUND_ESCALATION_AFTER_DUE_HOURS * HOUR_MS ? "due" : "escalated";
}

export interface FounderQueueItem {
  id: number;
  organizationId: number;
  status: string;
  brake: string | null;
  amountCents: number;
  reason: string | null;
  stripeChargeId: string | null;
  createdAt: Date | null;
  dueAt: Date | null;
  ageHours: number;
  sla: SlaState;
  eligibility: Record<string, unknown> | null;
  attempts: number;
  lastError: string | null;
  autoApproved: boolean | null;
  /** A "processing" claim older than the stuck threshold: the executor died mid-run; outcome unknown. */
  stuck: boolean;
}

/**
 * When the executor claimed the row. The table has no updatedAt, so the claim
 * stamps `eligibility.execution.claimedAt`; a row claimed before that stamp
 * existed falls back to createdAt (an over-estimate of age — it errs toward
 * alerting, never toward hiding).
 */
function claimedAtMs(r: RefundRequest): number | null {
  const at = (r.eligibility as { execution?: { claimedAt?: string } } | null)?.execution?.claimedAt;
  const t = at ? new Date(at).getTime() : r.createdAt ? new Date(r.createdAt).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
}

/** A processing row whose claim is past the stuck threshold. Pure. */
function isStuckProcessing(r: RefundRequest, nowMs: number): boolean {
  if (r.status !== "processing") return false;
  const t = claimedAtMs(r);
  return t !== null && nowMs - t >= REFUND_STUCK_PROCESSING_AFTER_HOURS * HOUR_MS;
}

const toItem = (r: RefundRequest, nowMs: number): FounderQueueItem => ({
  id: r.id,
  organizationId: r.organizationId,
  status: r.status,
  brake: r.brake ?? null,
  amountCents: r.amountCents,
  reason: r.reason,
  stripeChargeId: r.stripeChargeId,
  createdAt: r.createdAt,
  dueAt: r.dueAt ?? null,
  ageHours: r.createdAt ? Math.max(0, Math.floor((nowMs - new Date(r.createdAt).getTime()) / HOUR_MS)) : 0,
  sla: slaStateOf(r.dueAt, nowMs),
  eligibility: (r.eligibility as Record<string, unknown> | null) ?? null,
  attempts: r.attempts ?? 0,
  lastError: r.lastError ?? null,
  autoApproved: r.autoApproved ?? null,
  stuck: isStuckProcessing(r, nowMs),
});

/** Pending + uncertain + stuck-processing, oldest first. A fresh "processing" row is the executor mid-run and is not listed. */
export async function listFounderRefundQueue(limit = 100, nowMs = clock.nowMs()): Promise<FounderQueueItem[]> {
  const rows = await unscopedForPlatformOps(QUEUE_REASON)
    .select()
    .from(refundRequests)
    .where(inArray(refundRequests.status, ["pending", "uncertain", "processing"]))
    .orderBy(asc(refundRequests.createdAt))
    .limit(limit);
  return rows.filter((r) => r.status !== "processing" || isStuckProcessing(r, nowMs)).map((r) => toItem(r, nowMs));
}

async function loadRow(id: number): Promise<RefundRequest | null> {
  const [row] = await unscopedForPlatformOps(QUEUE_REASON).select().from(refundRequests).where(eq(refundRequests.id, id)).limit(1);
  return row ?? null;
}

/** Close the notification(s) a decided request raised. Best-effort. */
async function resolveAlertsFor(requestId: number): Promise<void> {
  try {
    await unscopedForPlatformOps(QUEUE_REASON)
      .update(systemAlerts)
      .set({ status: "resolved", resolvedAt: clock.now() })
      .where(and(eq(systemAlerts.relatedEntityType, "refund_request"), eq(systemAlerts.relatedEntityId, requestId), eq(systemAlerts.status, "new")));
  } catch (err) {
    logger.warn(`[Refund] could not resolve the alerts of refund request #${requestId}`, err as Error);
  }
}

export type ApproveResult = { found: false } | { found: true; result: ExecuteRefundResult };

/** Approve-and-execute: the shared executor with processedBy = the founder. */
export async function approveRefundRequest(id: number, founderId: string, actor?: AuditActor): Promise<ApproveResult> {
  const row = await loadRow(id);
  if (!row) return { found: false };
  const result = await executeRefundRequest({ requestId: row.id, organizationId: row.organizationId, processedBy: founderId, trigger: "founder", actor: actor ?? { userId: founderId } });
  if (result.outcome === "processed") await resolveAlertsFor(row.id);
  return { found: true, result };
}

export type DenyResult = { found: false } | { found: true; denied: boolean; status: string };

/** Deny: status "denied" + deniedReason, and the customer is told. */
export async function denyRefundRequest(id: number, founderId: string, reason: string): Promise<DenyResult> {
  const row = await loadRow(id);
  if (!row) return { found: false };
  const updated = await unscopedForPlatformOps(QUEUE_REASON)
    .update(refundRequests)
    .set({ status: "denied", deniedReason: reason.slice(0, 1000), processedBy: founderId, processedAt: clock.now() })
    .where(and(eq(refundRequests.id, row.id), eq(refundRequests.organizationId, row.organizationId), eq(refundRequests.status, "pending")))
    .returning({ id: refundRequests.id });
  if (updated.length === 0) return { found: true, denied: false, status: row.status };
  await resolveAlertsFor(row.id);
  try {
    const org = await storage.getOrganization(row.organizationId);
    const { emailService } = await import("../emailService");
    const { users } = await import("@shared/models/auth");
    const [owner] = org ? await unscopedForPlatformOps(QUEUE_REASON).select({ email: users.email }).from(users).where(eq(users.id, org.ownerId)).limit(1) : [];
    if (owner?.email) {
      const body = `Thank you for asking. After reviewing your refund request we are not able to refund this charge.\n\n${reason.trim()}\n\nIf you think we have this wrong, reply to this email and we will look again.\n\n— The AcreOS Team`;
      await emailService.sendEmail({
        // The deny write above is atomic on status=pending, so this notice
        // is reached at most once per request; the key covers the crash
        // window between the write and the send, keyed on the request's
        // durable identity and org-scoped so the claim engages.
        purpose: "system", // AcreOS to its own customer about their own billing
        organizationId: row.organizationId,
        idempotencyKey: `refund_request:${row.id}:denied_notice`,
        to: owner.email,
        subject: "Your AcreOS refund request",
        html: `<h2>Your refund request</h2>${body.split("\n\n").map((p) => `<p>${p.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`).join("")}`,
        text: body,
        transactional: true, // a decision on the customer's own billing request — not commercial
      });
    }
  } catch (err) {
    // The row says denied either way; say that the customer was not emailed.
    logger.error(`[Refund] refund request #${row.id} denied but the customer could NOT be notified`, err instanceof Error ? err : undefined);
    await raiseRefundPipelineAlert({
      type: "refund_deny_notice_failed",
      severity: "warning",
      title: `Refund request #${row.id} denied — customer NOT notified`,
      message: `The denial stands, but the notification email to org #${row.organizationId} failed (${err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300)}). Tell the customer by hand.`,
      organizationId: row.organizationId,
      requestId: row.id,
    });
  }
  return { found: true, denied: true, status: "denied" };
}

export type ResolveUncertainFinding = "refunded" | "not_refunded";
export type ResolveUncertainResult = { found: false } | { found: true; resolved: boolean; status: string; followUpErrors?: string[] };

/**
 * The founder checked Stripe and records what it shows. The claim is kept
 * either way: the finding is written on the row, and the row never goes back to
 * the automatic path.
 *   refunded      → status processed (the refund id the founder saw, if given);
 *                   the follow-up bundle (cancel, downgrade, email, audit)
 *                   never ran for an uncertain row, so it runs now.
 *   not_refunded  → back to the founder's queue (pending, brake B6) with the
 *                   finding recorded; approving it later re-uses the same
 *                   Stripe idempotency key, so a misread cannot double-refund.
 */
export async function resolveUncertainRefundRequest(
  id: number,
  founderId: string,
  finding: { outcome: ResolveUncertainFinding; note: string; stripeRefundId?: string },
): Promise<ResolveUncertainResult> {
  const row = await loadRow(id);
  if (!row) return { found: false };
  if (row.status !== "uncertain") return { found: true, resolved: false, status: row.status };
  const resolution = { by: founderId, at: clock.now().toISOString(), finding: finding.outcome, note: finding.note.slice(0, 1000), stripeRefundId: finding.stripeRefundId ?? null };
  const eligibility = withExecution(row.eligibility, { resolution });
  if (finding.outcome === "refunded") {
    const refundId = finding.stripeRefundId ?? row.stripeRefundId ?? null;
    const updated = await unscopedForPlatformOps(QUEUE_REASON)
      .update(refundRequests)
      .set({ status: "processed", processedAt: clock.now(), processedBy: founderId, ...(refundId ? { stripeRefundId: refundId } : {}), lastError: null, eligibility })
      .where(and(eq(refundRequests.id, row.id), eq(refundRequests.organizationId, row.organizationId), eq(refundRequests.status, "uncertain")))
      .returning({ id: refundRequests.id });
    if (updated.length === 0) return { found: true, resolved: false, status: row.status };
    await resolveAlertsFor(row.id);
    let followUpErrors: string[] = [];
    try {
      const { getUncachableStripeClient } = await import("../../stripeClient");
      const stripe = await getUncachableStripeClient();
      const org = await storage.getOrganization(row.organizationId);
      const done = await completeProcessedRefund(row, refundId, { requestId: row.id, organizationId: row.organizationId, processedBy: founderId, trigger: "founder" }, stripe, org?.name ?? `#${row.organizationId}`);
      followUpErrors = done.bundleErrors;
    } catch (err) {
      followUpErrors = [`follow-up could not run: ${err instanceof Error ? err.message : String(err)}`];
      logger.error(`[Refund] uncertain refund request #${row.id} resolved as refunded but its follow-up did not run`, err instanceof Error ? err : undefined);
    }
    return { found: true, resolved: true, status: "processed", followUpErrors };
  }
  const updated = await unscopedForPlatformOps(QUEUE_REASON)
    .update(refundRequests)
    .set({ status: "pending", brake: "B6", autoApproved: false, eligibility })
    .where(and(eq(refundRequests.id, row.id), eq(refundRequests.organizationId, row.organizationId), eq(refundRequests.status, "uncertain")))
    .returning({ id: refundRequests.id });
  return { found: true, resolved: updated.length > 0, status: "pending" };
}

// ───────────────────────────────────────────────────────────────────────────
// The sweep
// ───────────────────────────────────────────────────────────────────────────

export interface RefundSweepResult {
  retried: number;
  retryProcessed: number;
  retryExhausted: number;
  reminded: number;
  escalated: number;
  uncertainListed: number;
  stuckProcessing: number;
}

type Execution = { remindedAt?: string; escalatedAt?: string; exhaustedAlertedAt?: string; uncertainNoticeAt?: string; stuckNoticeAt?: string; nextAttemptAt?: string };
const executionOf = (r: RefundRequest): Execution => {
  const e = (r.eligibility as { execution?: Execution } | null)?.execution;
  return e && typeof e === "object" ? e : {};
};

/** Stamp a sweep action on the row so it fires once. Conditional on the status the sweep read. */
async function stamp(r: RefundRequest, patch: Record<string, unknown>): Promise<void> {
  await unscopedForPlatformOps(QUEUE_REASON)
    .update(refundRequests)
    .set({ eligibility: withExecution(r.eligibility, patch) })
    .where(and(eq(refundRequests.id, r.id), eq(refundRequests.organizationId, r.organizationId), eq(refundRequests.status, r.status)));
}

export async function runRefundSlaSweep(nowMs = clock.nowMs()): Promise<RefundSweepResult> {
  const out: RefundSweepResult = { retried: 0, retryProcessed: 0, retryExhausted: 0, reminded: 0, escalated: 0, uncertainListed: 0, stuckProcessing: 0 };
  const rows = await unscopedForPlatformOps(QUEUE_REASON).select().from(refundRequests).where(inArray(refundRequests.status, ["pending", "uncertain", "processing"])).orderBy(asc(refundRequests.createdAt)).limit(500);
  const nowIso = new Date(nowMs).toISOString();

  for (const r of rows) {
    try {
      const exec = executionOf(r);

      if (r.status === "processing") {
        // Claimed but never finished: the executor died mid-run and whether the
        // refund went out is unknown. NEVER requeued, NEVER status-changed here —
        // a human checks Stripe. Fresh claims are the executor at work: skipped.
        if (!isStuckProcessing(r, nowMs)) continue;
        out.stuckProcessing++;
        logger.error(`[Refund] refund request #${r.id} (org #${r.organizationId}, ${r.stripeChargeId}) stuck in processing since ${new Date(claimedAtMs(r) ?? 0).toISOString()}`);
        const last = exec.stuckNoticeAt ? new Date(exec.stuckNoticeAt).getTime() : 0;
        if (nowMs - last >= 24 * HOUR_MS) {
          await raiseRefundPipelineAlert({
            type: "refund_stuck",
            severity: "critical",
            title: `Refund request #${r.id} is stuck in processing`,
            message: `It was claimed over ${REFUND_STUCK_PROCESSING_AFTER_HOURS}h ago and never finished; the executor likely died mid-run, so it is UNKNOWN whether ${r.stripeChargeId} was refunded. It will not be retried automatically. Check the charge on Stripe, then approve, deny or resolve it.`,
            organizationId: r.organizationId,
            requestId: r.id,
          });
          await stamp(r, { stuckNoticeAt: nowIso });
        }
        continue;
      }

      if (r.status === "uncertain") {
        // Listed until resolved: logged every sweep, re-announced daily.
        out.uncertainListed++;
        logger.error(`[Refund] uncertain refund request #${r.id} (org #${r.organizationId}, ${r.stripeChargeId}) still unresolved — ${r.lastError ?? "no detail"}`);
        const last = exec.uncertainNoticeAt ? new Date(exec.uncertainNoticeAt).getTime() : 0;
        if (nowMs - last >= 24 * HOUR_MS) {
          await raiseRefundPipelineAlert({
            type: "refund_uncertain",
            severity: "critical",
            title: `Still unresolved: uncertain refund request #${r.id}`,
            message: `${r.lastError ?? "Outcome unknown."} Check ${r.stripeChargeId} on Stripe and record the finding (POST /api/founder/refund-requests/${r.id}/resolve-uncertain).`,
            organizationId: r.organizationId,
            requestId: r.id,
          });
          await stamp(r, { uncertainNoticeAt: nowIso });
        }
        continue;
      }

      // Retry pass: an eligible request whose execution failed BEFORE the refund call.
      if (r.autoApproved === true && !r.brake && (r.attempts ?? 0) > 0) {
        if ((r.attempts ?? 0) < REFUND_MAX_AUTO_ATTEMPTS) {
          const next = exec.nextAttemptAt ? new Date(exec.nextAttemptAt).getTime() : 0;
          if (nowMs >= next) {
            out.retried++;
            const result = await executeRefundRequest({ requestId: r.id, organizationId: r.organizationId, processedBy: "auto", trigger: "sweep" });
            if (result.outcome === "processed") out.retryProcessed++;
            // The executor rewrote the row; this pass's copy is stale. The SLA
            // checks run on the next sweep rather than stamp over its bookkeeping.
            continue;
          }
        } else if (!exec.exhaustedAlertedAt) {
          out.retryExhausted++;
          await raiseRefundPipelineAlert({
            type: "refund_request",
            severity: "critical",
            title: `Refund request #${r.id}: automatic retries exhausted`,
            message: `${r.attempts} attempts failed before the refund call (nothing moved). Last error: ${r.lastError ?? "unknown"}. Approve it from the queue or deny it.`,
            organizationId: r.organizationId,
            requestId: r.id,
          });
          await stamp(r, { exhaustedAlertedAt: nowIso });
        }
      }

      // SLA: reminder at dueAt, escalation at dueAt + 24h.
      const state = slaStateOf(r.dueAt, nowMs);
      if (state === "escalated" && !exec.escalatedAt) {
        out.escalated++;
        await raiseRefundPipelineAlert({
          type: "refund_request",
          severity: "critical",
          title: `OVERDUE >24h past SLA: refund request #${r.id} ($${(r.amountCents / 100).toFixed(2)}${r.brake ? `, ${r.brake}` : ""})`,
          message: `This refund request has waited more than ${REFUND_ESCALATION_AFTER_DUE_HOURS}h past its decision deadline. Approve or deny it: POST /api/founder/refund-requests/${r.id}/approve | /deny.`,
          organizationId: r.organizationId,
          requestId: r.id,
        });
        try {
          const { askFounder } = await import("../solene/founderCollab");
          await askFounder({
            askingAgentRole: "general-purpose",
            questionSummary: `Refund request #${r.id} is overdue — approve or deny?`,
            questionBody: `Org #${r.organizationId} asked for a $${(r.amountCents / 100).toFixed(2)} refund of ${r.stripeChargeId}${r.brake ? ` (held under ${r.brake})` : ""}. Reason: ${r.reason ?? "(none)"}. It is past its decision deadline by more than ${REFUND_ESCALATION_AFTER_DUE_HOURS}h.`,
            answerFormat: "free_text",
            urgency: "urgent",
          });
        } catch (err) {
          logger.error(`[Refund] the founder could NOT be asked about overdue refund request #${r.id} (the critical alert stands)`, err instanceof Error ? err : undefined);
        }
        await stamp(r, { escalatedAt: nowIso, remindedAt: exec.remindedAt ?? nowIso });
      } else if (state === "due" && !exec.remindedAt) {
        out.reminded++;
        await raiseRefundPipelineAlert({
          type: "refund_request",
          severity: "warning",
          title: `Refund request #${r.id} is due for a decision`,
          message: `Its 24h decision deadline has passed ($${(r.amountCents / 100).toFixed(2)}${r.brake ? `, ${r.brake}` : ""}). Approve or deny it from the refund queue.`,
          organizationId: r.organizationId,
          requestId: r.id,
        });
        await stamp(r, { remindedAt: nowIso });
      }
    } catch (err) {
      logger.error(`[Refund] SLA sweep failed on refund request #${r.id} (the rest of the sweep continues)`, err instanceof Error ? err : undefined);
    }
  }
  return out;
}

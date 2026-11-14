/**
 * The ONE refund executor (design 2026-11 §3.2) — extracted from the inline
 * auto block of POST /api/subscription/refund-request. Three callers: the
 * intake (guarantee-eligible requests, ANY amount), the SLA sweep's retry
 * pass, and the founder queue's approve action.
 *
 *   1. Claim pending → processing, in ONE transaction under an advisory lock
 *      on the charge: no other request for the charge may be processed /
 *      processing / uncertain, and the status flip is conditional on
 *      status = 'pending'. The loser of a race stops.
 *   2. Re-verify E4 (fresh from Stripe) and — for automatic runs — E6.
 *   3. stripe.refunds.create({ charge }, { idempotencyKey: "refund_request:<id>" }).
 *   4. Row → processed (processedBy "auto" or the founder's id), refund id kept.
 *   5. The downstream bundle, unchanged from the inline block: cancel the
 *      Stripe subscription (errors logged), downgrade to free + wind-down
 *      stamp, subscription event + history, owner email, BILLING_REFUND_ISSUED.
 *   6. Credits-settlement hook (S2: routes the position to the founder queue;
 *      moves no money).
 *
 * LEDGER EFFECTS ARE NOT POSTED HERE. They stay in the charge.refunded
 * webhook (WebhookHandlers.processChargeRefunded), single-counted by its own
 * externalEventId discipline. This module writes no ledger row.
 *
 * FAILURE DISCIPLINE (copied from autopilot/hands/apply-refund.ts):
 *   • a failure BEFORE refunds.create is called → back to the queue,
 *     attempts + 1, last_error set, retry-at recorded for the sweep;
 *   • a failure AFTER the call (the call itself failing or timing out, or the
 *     row update that records it) → status "uncertain", the claim kept, the
 *     founder surfaced. Never silently re-queued, never refunded twice.
 */
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { refundRequests, type RefundRequest } from "@shared/schema";
import { SUBSCRIPTION_EVENT } from "@shared/billing/subscriptionEventVocabulary";
import { db, withTransaction } from "../../db";
import { storage } from "../../storage";
import { logger } from "../../utils/logger";
import { clock } from "../../utils/clock";
import { auditLog, AuditActions, type AuditActor } from "../../utils/auditLog";
import { subscriptionEndedPatch } from "../borrower/servicingPhase";
import { chargeFactsOf, type StripeChargeLike } from "./guaranteeFacts";
import { brakeForFailures, evaluateChargeRefundable, type PredicateId, type RefundBrakeCode } from "./guaranteeEligibility";
import { REFUND_RETRY_BASE_MS, REFUND_RETRY_MAX_MS } from "./refundConfig";
import { raiseRefundPipelineAlert, raiseRefundQueueAlert } from "./refundAlerts";
import { queueCreditsSettlementForFounder, type CreditsSettlementHook, type CreditsSettlementOutcome } from "./creditsSettlementHook";
import { assertWritablePatch } from "../../utils/patch";

export type RefundTrigger = "intake" | "sweep" | "founder";

export interface ExecuteRefundArgs {
  requestId: number;
  organizationId: number;
  /** "auto" for the guarantee path / sweep retry; the founder's user id for a queue approval. */
  processedBy: string;
  trigger: RefundTrigger;
  /** The audit actor: the requesting user (intake) or the founder (approve). */
  actor?: AuditActor;
}

export interface ExecuteRefundDeps {
  settleCredits?: CreditsSettlementHook;
}

export type ExecuteRefundResult =
  | { outcome: "processed"; amountCents: number; stripeRefundId: string; bundleErrors: string[]; credits: CreditsSettlementOutcome }
  /** Not ours to run: already claimed/processed/uncertain/denied, or it does not exist. */
  | { outcome: "not_claimable"; status: string }
  /** Re-verification said no: back in the queue under a brake. */
  | { outcome: "queued"; brake: RefundBrakeCode; reason: string }
  /** Failed before the refund call: back in the queue, the sweep retries. */
  | { outcome: "retry_queued"; attempts: number; error: string }
  /** The refund may have gone out; claim kept, founder asked. */
  | { outcome: "uncertain"; reason: string };

/**
 * A Stripe API error that definitively means the refund was NOT created: a
 * typed Stripe error (the repo's convention — `error.type`, as in
 * healthCheck.ts) of a rejection kind, carrying a 4xx status. Connection,
 * timeout, 5xx, idempotency-conflict (409) and unknown errors are NOT
 * definitive — Stripe may have acted — and stay "uncertain".
 */
const DEFINITIVE_STRIPE_REJECTIONS = new Set(["StripeCardError", "StripeInvalidRequestError", "StripeAuthenticationError", "StripePermissionError", "StripeRateLimitError"]);
function isDefinitiveStripeRejection(err: unknown): boolean {
  const e = err as { type?: unknown; statusCode?: unknown } | null;
  if (!e || typeof e.type !== "string" || !e.type.startsWith("Stripe")) return false;
  if (!DEFINITIVE_STRIPE_REJECTIONS.has(e.type)) return false;
  return typeof e.statusCode === "number" && e.statusCode >= 400 && e.statusCode < 500 && e.statusCode !== 409;
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 500);

function retryDelayMs(attempts: number): number {
  return Math.min(REFUND_RETRY_BASE_MS * Math.max(1, attempts), REFUND_RETRY_MAX_MS);
}

/** Merge `execution` bookkeeping into the eligibility jsonb without losing the verdicts. */
export function withExecution(eligibility: unknown, execution: Record<string, unknown>): Record<string, unknown> {
  const base = eligibility && typeof eligibility === "object" ? (eligibility as Record<string, unknown>) : {};
  const prior = base.execution && typeof base.execution === "object" ? (base.execution as Record<string, unknown>) : {};
  return { ...base, execution: { ...prior, ...execution } };
}

type ClaimResult = { kind: "claimed" } | { kind: "busy" } | { kind: "lost" };

/**
 * The claim. One transaction under an advisory lock on the CHARGE, so two
 * requests for the same charge — whichever rows they are — cannot both pass
 * the busy check and both claim.
 */
async function claim(row: RefundRequest, processedBy: string): Promise<ClaimResult> {
  return withTransaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`refund_charge:${row.stripeChargeId}`}))`);
    const [busy] = await tx
      .select({ id: refundRequests.id })
      .from(refundRequests)
      .where(
        and(
          eq(refundRequests.organizationId, row.organizationId),
          eq(refundRequests.stripeChargeId, row.stripeChargeId as string),
          ne(refundRequests.id, row.id),
          inArray(refundRequests.status, ["processed", "processing", "uncertain"]),
        ),
      )
      .limit(1);
    if (busy) return { kind: "busy" } as const;
    const claimed = await tx
      .update(refundRequests)
      .set(
        assertWritablePatch(
          {
            status: "processing",
            ...(processedBy === "auto" ? { autoApproved: true } : {}),
            // The claim time: the sweep's stuck-processing check reads it (the table has no updatedAt).
            eligibility: withExecution(row.eligibility, { claimedAt: clock.now().toISOString() }),
          },
          "refundRequests.claim",
        ),
      )
      .where(and(eq(refundRequests.id, row.id), eq(refundRequests.organizationId, row.organizationId), eq(refundRequests.status, "pending")))
      .returning({ id: refundRequests.id });
    return claimed.length > 0 ? ({ kind: "claimed" } as const) : ({ kind: "lost" } as const);
  });
}

/** Put a claimed (or pending) request back in the queue under a brake. */
async function releaseToQueue(row: RefundRequest, brake: RefundBrakeCode, reason: string, orgName: string): Promise<void> {
  try {
    await db
      .update(refundRequests)
      .set({
        status: "pending",
        autoApproved: false,
        brake,
        eligibility: withExecution(row.eligibility, { releasedAt: clock.now().toISOString(), releasedBecause: reason.slice(0, 300) }),
      })
      .where(and(eq(refundRequests.id, row.id), eq(refundRequests.organizationId, row.organizationId), inArray(refundRequests.status, ["processing", "pending"])));
  } catch (err) {
    logger.error(`[Refund] could not return refund request #${row.id} to the queue under ${brake}`, err instanceof Error ? err : undefined);
  }
  await raiseRefundQueueAlert({
    organizationId: row.organizationId,
    organizationName: orgName,
    requestId: row.id,
    amountCents: row.amountCents,
    brake,
    reason: row.reason,
    note: `Held at execution: ${reason}`,
  });
}

/** A failure before refunds.create: nothing moved. Back to the queue for the sweep. */
async function releaseForRetry(row: RefundRequest, err: unknown): Promise<ExecuteRefundResult> {
  const attempts = (row.attempts ?? 0) + 1;
  const error = errText(err);
  logger.error(`[Refund] refund request #${row.id} failed BEFORE the refund call (attempt ${attempts}) — returned to the queue`, err instanceof Error ? err : undefined);
  try {
    await db
      .update(refundRequests)
      .set({
        status: "pending",
        attempts,
        lastError: error,
        eligibility: withExecution(row.eligibility, {
          lastAttemptAt: clock.now().toISOString(),
          nextAttemptAt: new Date(clock.nowMs() + retryDelayMs(attempts)).toISOString(),
        }),
      })
      .where(and(eq(refundRequests.id, row.id), eq(refundRequests.organizationId, row.organizationId), eq(refundRequests.status, "processing")));
  } catch (dbErr) {
    // The claim is still "processing" and the sweep does NOT revisit that
    // status, so the critical refund_stuck alert below is the only surfacing.
    // Say so loudly.
    logger.error(`[Refund] could not return refund request #${row.id} to the queue after a pre-call failure`, dbErr instanceof Error ? dbErr : undefined);
    await raiseRefundPipelineAlert({
      type: "refund_stuck",
      severity: "critical",
      title: `Refund request #${row.id} is stuck in processing`,
      message: `It failed before the refund call (${error}) and could not be returned to the queue. Nothing was refunded.`,
      organizationId: row.organizationId,
      requestId: row.id,
    });
  }
  return { outcome: "retry_queued", attempts, error };
}

/**
 * The refund call was made (or may have been): keep the claim, mark the row
 * uncertain, tell the founder. Best-effort on each half; never throws.
 */
async function markUncertain(row: RefundRequest, why: string, orgName: string, stripeRefundId?: string): Promise<void> {
  try {
    await db
      .update(refundRequests)
      .set({ status: "uncertain", brake: "B6", lastError: why.slice(0, 500), ...(stripeRefundId ? { stripeRefundId } : {}) })
      .where(and(eq(refundRequests.id, row.id), eq(refundRequests.organizationId, row.organizationId)));
  } catch (err) {
    logger.error(`[Refund] could not mark refund request #${row.id} uncertain — it stays 'processing' (the SLA sweep raises a critical refund_stuck alert once the claim is over an hour old)`, err instanceof Error ? err : undefined);
  }
  await raiseRefundPipelineAlert({
    type: "refund_uncertain",
    severity: "critical",
    title: `Refund outcome uncertain: request #${row.id} (${row.stripeChargeId})`,
    message:
      `A $${(row.amountCents / 100).toFixed(2)} refund of ${row.stripeChargeId} for "${orgName}" may or may not have gone out. ${why.slice(0, 500)} ` +
      `The claim is kept; it will never be refunded again automatically. Check the charge on Stripe and record what you found.`,
    organizationId: row.organizationId,
    requestId: row.id,
  });
  try {
    const { askFounder } = await import("../solene/founderCollab");
    await askFounder({
      askingAgentRole: "general-purpose",
      questionSummary: `Refund outcome uncertain: request #${row.id} (org #${row.organizationId})`,
      questionBody: [
        `A $${(row.amountCents / 100).toFixed(2)} refund of ${row.stripeChargeId} for organization #${row.organizationId} may or may not have gone out.`,
        `Why: ${why.slice(0, 500)}`,
        "",
        "The claim is kept, so it will never be refunded again automatically. Check the charge on Stripe and record what happened (POST /api/founder/refund-requests/" + row.id + "/resolve-uncertain).",
      ].join("\n"),
      answerFormat: "free_text",
      urgency: "urgent",
    });
  } catch (err) {
    logger.error(`[Refund] the founder could NOT be asked about uncertain refund request #${row.id} (the row and alert still list it)`, err instanceof Error ? err : undefined);
  }
}

/** The downstream bundle — unchanged from the inline auto block. Returns the failures that mattered. */
async function runBundle(row: RefundRequest, refundId: string | null, args: ExecuteRefundArgs, stripe: { subscriptions: { cancel(id: string): Promise<unknown> } }): Promise<{ errors: string[]; orgName: string }> {
  const errors: string[] = [];
  const org = await storage.getOrganization(row.organizationId).catch((err: unknown) => {
    errors.push(`organization read failed: ${errText(err)}`);
    return undefined;
  });
  if (!org) {
    errors.push("organization not found — no downgrade was applied");
    return { errors, orgName: `#${row.organizationId}` };
  }
  const previousTier = org.subscriptionTier || "free";

  if (org.stripeSubscriptionId) {
    try {
      await stripe.subscriptions.cancel(org.stripeSubscriptionId);
      logger.info(`[Refund] Cancelled Stripe subscription ${org.stripeSubscriptionId} for org ${org.id}`);
    } catch (cancelErr) {
      // Subscription may already be cancelled — log but continue
      logger.warn(`[Refund] Could not cancel Stripe subscription ${org.stripeSubscriptionId}`, cancelErr as Error);
    }
  }

  try {
    await storage.updateOrganization(org.id, {
      subscriptionTier: "free",
      subscriptionStatus: "cancelled",
      stripeSubscriptionId: null,
      // Starts the 90-day borrower wind-down (ruling #3, DEFECT-0106).
      ...subscriptionEndedPatch(),
    });
    logger.info(`[Refund] Downgraded org ${org.id} from ${previousTier} to free after refund`);
  } catch (err) {
    errors.push(`downgrade failed: ${errText(err)}`);
  }

  try {
    await storage.logSubscriptionEvent({
      organizationId: org.id,
      eventType: SUBSCRIPTION_EVENT.cancel,
      fromTier: previousTier,
      toTier: null,
    });
  } catch (err) {
    errors.push(`subscription event log failed: ${errText(err)}`);
  }

  // Renoir audit-log: priced cancel for reactivation context.
  try {
    const { recordSubscriptionHistoryEvent } = await import("../../routes-subscription");
    await recordSubscriptionHistoryEvent({
      organizationId: org.id,
      eventType: "canceled",
      tier: previousTier,
      billingInterval: org.billingInterval || null,
      priceCents: null,
      metadata: { source: "refund_auto_cancel", refundRequestId: row.id },
    });
  } catch { /* non-fatal */ }

  // Confirmation email (non-fatal).
  try {
    const { emailService } = await import("../emailService");
    const { users } = await import("@shared/models/auth");
    const [owner] = await db.select({ email: users.email }).from(users).where(eq(users.id, org.ownerId)).limit(1);
    if (owner?.email) {
      await emailService.sendEmail({
        // One confirmation per refund request, however the executor is
        // retried: the key is the request's durable identity (the same root
        // as the Stripe idempotency key), org-scoped so the outward-action
        // claim engages.
        purpose: "system", // AcreOS to its own customer about their own billing
        organizationId: org.id,
        idempotencyKey: `refund_request:${row.id}:processed_notice`,
        to: owner.email,
        subject: "Your AcreOS refund has been processed",
        html: `<h2>Refund Processed</h2><p>Your refund of <strong>$${(row.amountCents / 100).toFixed(2)}</strong> has been processed. It should appear on your statement within 5-10 business days.</p><p>— The AcreOS Team</p>`,
        text: `Your refund of $${(row.amountCents / 100).toFixed(2)} has been processed. It should appear within 5-10 business days.\n\n— The AcreOS Team`,
        transactional: true, // billing receipt — not commercial
      });
    }
  } catch { /* non-fatal */ }

  // Phase 3 Week 11 — refund issuance is a sensitive billing event.
  await auditLog({
    actor: args.actor ?? { userId: args.processedBy === "auto" ? null : args.processedBy },
    action: AuditActions.BILLING_REFUND_ISSUED,
    target: { type: "billing", id: org.id },
    metadata: {
      op: args.processedBy === "auto" ? "auto_refund" : "founder_approved_refund",
      trigger: args.trigger,
      refundRequestId: row.id,
      stripeRefundId: refundId,
      amountCents: row.amountCents,
      previousTier,
    },
  });
  return { errors, orgName: org.name };
}

/**
 * Everything that follows a RECORDED refund: the downstream bundle, then the
 * credits hook. A failure here is surfaced, never allowed to put the row back
 * in the queue (the refund went out). Never throws.
 */
export async function completeProcessedRefund(
  row: RefundRequest,
  /** null only on the founder's resolve-uncertain path when no Stripe refund id was recorded or supplied — never a made-up id. */
  refundId: string | null,
  args: ExecuteRefundArgs,
  stripe: { subscriptions: { cancel(id: string): Promise<unknown> } },
  orgName: string,
  deps: ExecuteRefundDeps = {},
): Promise<{ bundleErrors: string[]; credits: CreditsSettlementOutcome }> {
  let bundle: { errors: string[]; orgName: string };
  try {
    bundle = await runBundle(row, refundId, args, stripe);
  } catch (err) {
    bundle = { errors: [`follow-up bundle crashed: ${errText(err)}`], orgName };
  }
  if (bundle.errors.length > 0) {
    logger.error(`[Refund] refund request #${row.id} processed, follow-up incomplete: ${bundle.errors.join("; ")}`);
    await raiseRefundPipelineAlert({
      type: "refund_followup_incomplete",
      severity: "critical",
      title: `Refund processed, follow-up incomplete: request #${row.id}`,
      message: `Refund ${refundId ?? "(id not recorded)"} went out and is recorded, but: ${bundle.errors.join("; ")}. Check the org's tier and subscription by hand.`,
      organizationId: row.organizationId,
      requestId: row.id,
    });
  }

  // The credits position — S2 routes it to the founder; moves no money.
  const settle = deps.settleCredits ?? queueCreditsSettlementForFounder;
  let credits: CreditsSettlementOutcome;
  try {
    credits = await settle({ organizationId: row.organizationId, organizationName: bundle.orgName, refundRequestId: row.id });
  } catch (err) {
    logger.error(`[Refund] credits-settlement hook failed for refund request #${row.id}`, err instanceof Error ? err : undefined);
    credits = { state: "check_failed", balanceCents: null };
  }
  return { bundleErrors: bundle.errors, credits };
}

export async function executeRefundRequest(args: ExecuteRefundArgs, deps: ExecuteRefundDeps = {}): Promise<ExecuteRefundResult> {
  const [row] = await db
    .select()
    .from(refundRequests)
    .where(and(eq(refundRequests.id, args.requestId), eq(refundRequests.organizationId, args.organizationId)))
    .limit(1);
  if (!row) return { outcome: "not_claimable", status: "missing" };
  if (row.status !== "pending") return { outcome: "not_claimable", status: row.status };
  if (!row.stripeChargeId) return { outcome: "not_claimable", status: "no_charge" };

  const orgName = (await storage.getOrganization(row.organizationId).catch(() => undefined))?.name ?? `#${row.organizationId}`;

  // 1. Claim.
  const claimed = await claim(row, args.processedBy);
  if (claimed.kind === "lost") {
    const [now] = await db
      .select({ status: refundRequests.status })
      .from(refundRequests)
      .where(and(eq(refundRequests.id, row.id), eq(refundRequests.organizationId, row.organizationId)))
      .limit(1);
    return { outcome: "not_claimable", status: now?.status ?? "missing" };
  }
  if (claimed.kind === "busy") {
    const reason = "another request for this charge is processed, processing or uncertain — never refunded twice";
    await releaseToQueue(row, "B1", reason, orgName);
    return { outcome: "queued", brake: "B1", reason };
  }

  // 2. Re-verify, fresh. From here the row is 'processing' and ours.
  let stripe: Awaited<ReturnType<typeof import("../../stripeClient").getUncachableStripeClient>>;
  try {
    // E6 (org half): an automatic run never spends a second guarantee refund.
    // A founder approval is a human decision and may knowingly go ahead.
    if (args.processedBy === "auto") {
      const [consumed] = await db
        .select({ id: refundRequests.id })
        .from(refundRequests)
        .where(and(eq(refundRequests.organizationId, row.organizationId), eq(refundRequests.status, "processed"), ne(refundRequests.id, row.id)))
        .limit(1);
      if (consumed) {
        const reason = "the org already has a processed refund (E6)";
        await releaseToQueue(row, "B1", reason, orgName);
        return { outcome: "queued", brake: "B1", reason };
      }
    }

    const { getUncachableStripeClient } = await import("../../stripeClient");
    stripe = await getUncachableStripeClient();
    const charge = (await stripe.charges.retrieve(row.stripeChargeId)) as unknown as StripeChargeLike;
    const e4 = evaluateChargeRefundable(chargeFactsOf(charge));
    if (e4.verdict === "fail") {
      const facts = chargeFactsOf(charge);
      const brake = brakeForFailures(new Set<PredicateId>(["E4"]), facts) as RefundBrakeCode;
      await releaseToQueue(row, brake, e4.detail, orgName);
      return { outcome: "queued", brake, reason: e4.detail };
    }
  } catch (err) {
    return releaseForRetry(row, err);
  }

  // 3. The refund call. From here the money may have moved: never un-claim.
  let refundId: string;
  try {
    const refund = await stripe.refunds.create({ charge: row.stripeChargeId }, { idempotencyKey: `refund_request:${row.id}` });
    refundId = refund.id;
  } catch (err) {
    // Stripe said no, in so many words: nothing was refunded. Back to the queue
    // like any pre-call failure (the row is still "processing", which is what
    // releaseForRetry's update requires).
    if (isDefinitiveStripeRejection(err)) return releaseForRetry(row, err);
    const why = `refund call failed or timed out — Stripe may or may not have refunded: ${errText(err)}`;
    logger.error(`[Refund] refund request #${row.id}: ${why}`);
    await markUncertain(row, why, orgName);
    return { outcome: "uncertain", reason: why };
  }

  // 4. Record it.
  try {
    const done = await db
      .update(refundRequests)
      .set({
        status: "processed",
        processedAt: clock.now(),
        processedBy: args.processedBy,
        stripeRefundId: refundId,
        lastError: null,
      })
      .where(and(eq(refundRequests.id, row.id), eq(refundRequests.organizationId, row.organizationId), eq(refundRequests.status, "processing")))
      .returning({ id: refundRequests.id });
    if (done.length === 0) throw new Error("the row was no longer 'processing' when the refund was recorded");
  } catch (err) {
    // The refund WENT OUT; only our record of it did not land. Keep the claim.
    const why = `refund ${refundId} issued but its record could not be written: ${errText(err)}`;
    logger.error(`[Refund] refund request #${row.id}: ${why}`);
    await markUncertain(row, why, orgName, refundId);
    return { outcome: "uncertain", reason: why };
  }

  // 5–6. Follow-up bundle + credits hook (shared with the founder's
  // resolve-uncertain "it was refunded" path).
  const followUp = await completeProcessedRefund(row, refundId, args, stripe, orgName, deps);
  return { outcome: "processed", amountCents: row.amountCents, stripeRefundId: refundId, bundleErrors: followUp.bundleErrors, credits: followUp.credits };
}

/**
 * ONE posting rule for a tenant's card payment of rent (P3-3, decided
 * 2026-11-16: rent collection comes into scope narrowly — collection through
 * the LANDLORD'S OWN Stripe Standard account, the P3-4 pattern).
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * Until P3-3 the rent ledger only recorded money the landlord had ALREADY
 * received elsewhere ("the rent ledger is manual-entry"). The monthly act of
 * the Buy-and-Hold vertical — collecting rent — happened outside the product.
 * This module is the collection rail, and it is deliberately the twin of
 * services/borrower/portalPaymentPosting.ts:
 *
 *   * The charge is a DIRECT charge on the landlord's own connected account.
 *     Session creation goes through `prepareCustomerMoneyCall`
 *     (customerMoneyRouting.ts), which scopes `stripeAccount` to the org's
 *     acct_… and throws if any platform-take key appears. AcreOS never holds
 *     rent, takes no cut, and is never merchant of record. An org with no
 *     usable connected processor is REFUSED — there is no platform fallback.
 *
 *   * This function is the single writer both entry points call: the
 *     operator's browser return (POST /api/leases/:id/rent-checkout/verify)
 *     and the Connect webhook (checkout.session.completed /
 *     async_payment_succeeded for metadata.type === "rent_payment"). Which
 *     one arrives first is network timing; the ledger result is identical.
 *
 *   * Posting goes through the ledger's ONE writer, `recordRentPayment`
 *     (paymentPosting.ts) — multi-charge allocation, oldest first, rent
 *     before late fees, overpayment as an explicit unapplied credit. This
 *     module adds no second allocation rule and no direct rent_payments
 *     insert.
 *
 *   * Idempotency: the Checkout Session id is the payment's operationKey
 *     (unique per org, 0258). A redelivered webhook or a browser return that
 *     loses the race finds the recorded row and returns `already_recorded` —
 *     no second allocation, no second workflow emit.
 *
 * Money-path discipline: the emits run AFTER the ledger transaction commits
 * and are fire-and-forget — a workflow fault can never roll back banked rent.
 */

import type Stripe from "stripe";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { leaseTenants, rentCharges, rentPayments, rentalLeases } from "@shared/schema";
import type { RentPayment } from "@shared/schema";
import { recordRentPayment, PartialPaymentUnderNoticeError } from "./paymentPosting";
import { emitRentPaymentReceived, emitRentReceived } from "../rentalEvents";
import { logger } from "../../utils/logger";
import { clock } from "../../utils/clock";

// ───────────────────────────────────────────────────────────────────────────
// Pure core — the decisions, testable without a database or Stripe
// ───────────────────────────────────────────────────────────────────────────

/**
 * What a charge is still owed, DERIVED from its columns
 * (amount + lateFee − paid) — never from the stored `balanceCents`, which is
 * a cache the allocator itself treats as untrusted (paymentPosting.ts §5).
 */
export function outstandingCentsForCharge(charge: {
  amountCents: number;
  lateFeeCents: number;
  paidCents: number;
}): number {
  return Math.max(0, charge.amountCents + charge.lateFeeCents - charge.paidCents);
}

/** Total still owed across a lease's charges with a positive derived balance. */
export function totalOutstandingCents(
  charges: ReadonlyArray<{ amountCents: number; lateFeeCents: number; paidCents: number }>,
): number {
  return charges.reduce((sum, c) => sum + outstandingCentsForCharge(c), 0);
}

/** The fields of a Checkout Session the posting rule reads. */
export type RentCheckoutSession = Pick<
  Stripe.Checkout.Session,
  "id" | "amount_total" | "payment_status" | "metadata" | "payment_intent"
>;

export type RentSessionRefusal =
  | "payment_not_completed"
  | "session_not_for_lease"
  | "amount_missing";

/**
 * Validate a session against the lease it claims to pay. Metadata is OURS —
 * `buildRentCardCheckoutParams` wrote leaseId + organizationId at
 * session-create time — so a mismatch is a refusal, never a guess. Returns
 * null when the session may post.
 */
export function rentSessionRefusal(
  session: RentCheckoutSession,
  expected: { leaseId: string; organizationId: number },
): RentSessionRefusal | null {
  if (session.payment_status !== "paid") return "payment_not_completed";
  const metaLeaseId = session.metadata?.leaseId;
  if (metaLeaseId != null && metaLeaseId !== expected.leaseId) return "session_not_for_lease";
  const metaOrgId = session.metadata?.organizationId;
  if (metaOrgId != null && Number(metaOrgId) !== expected.organizationId) {
    return "session_not_for_lease";
  }
  if (session.amount_total == null || session.amount_total <= 0) return "amount_missing";
  return null;
}

// ───────────────────────────────────────────────────────────────────────────
// The posting rule
// ───────────────────────────────────────────────────────────────────────────

export type RentPaymentSource = "stripe_webhook" | "operator_verify";

export interface PostRentCheckoutPaymentInput {
  /** Loaded and ownership-checked by the caller (org-scoped). */
  organizationId: number;
  leaseId: string;
  stripeSession: RentCheckoutSession;
  source: RentPaymentSource;
  /** Injectable clock for tests. */
  now?: Date;
}

export type PostRentCheckoutPaymentResult =
  | { outcome: "refused"; reason: RentSessionRefusal | "lease_not_found" }
  | { outcome: "already_recorded"; payment: RentPayment }
  | {
      outcome: "posted";
      payment: RentPayment;
      amountCents: number;
      isPartial: boolean;
      allocatedCents: number;
      unappliedCents: number;
      /**
       * The payment arrived while the charge it left short sits under a
       * notice to vacate. The operator-facing record-payment path REFUSES
       * that (accepting partial rent can void the notice); here the money
       * has ALREADY moved on the landlord's own account, so the ledger must
       * record it — flagged, logged, and surfaced, never silently dropped
       * and never silently treated as an operator's acceptance.
       */
      acceptedDespitePartialUnderNotice: boolean;
    };

export async function postRentCheckoutPayment(
  input: PostRentCheckoutPaymentInput,
): Promise<PostRentCheckoutPaymentResult> {
  const { organizationId, leaseId, stripeSession, source } = input;
  const now = input.now ?? clock.now();

  const refusal = rentSessionRefusal(stripeSession, { leaseId, organizationId });
  if (refusal) return { outcome: "refused", reason: refusal };
  const amountCents = stripeSession.amount_total as number;

  const findRecorded = async (): Promise<RentPayment | undefined> => {
    const [row] = await db
      .select()
      .from(rentPayments)
      .where(
        and(
          eq(rentPayments.organizationId, organizationId),
          eq(rentPayments.operationKey, stripeSession.id),
        ),
      )
      .limit(1);
    return row;
  };

  const recorded = await findRecorded();
  if (recorded) return { outcome: "already_recorded", payment: recorded };

  const [lease] = await db
    .select()
    .from(rentalLeases)
    .where(and(eq(rentalLeases.id, leaseId), eq(rentalLeases.organizationId, organizationId)));
  if (!lease) return { outcome: "refused", reason: "lease_not_found" };

  const [primaryTenant] = await db
    .select({ tenantId: leaseTenants.tenantId })
    .from(leaseTenants)
    .where(
      and(eq(leaseTenants.leaseId, leaseId), eq(leaseTenants.organizationId, organizationId)),
    )
    .orderBy(desc(leaseTenants.isPrimary))
    .limit(1);

  const receivedAt = now.toISOString().slice(0, 10);
  const paymentIntentId =
    typeof stripeSession.payment_intent === "string"
      ? stripeSession.payment_intent
      : stripeSession.payment_intent?.id ?? null;

  const attempt = (acceptedDespitePartial: boolean) =>
    db.transaction((tx) =>
      recordRentPayment(tx, {
        organizationId,
        leaseId,
        amountCents,
        receivedAt,
        method: "card",
        referenceNumber: stripeSession.id,
        payorType: "tenant",
        payorTenantId: primaryTenant?.tenantId ?? null,
        acceptedDespitePartial,
        notes: "Collected by card through the landlord's connected Stripe account (P3-3).",
        operationKey: stripeSession.id,
        stripePaymentIntentId: paymentIntentId,
      }),
    );

  let posted;
  let acceptedDespitePartialUnderNotice = false;
  try {
    posted = await attempt(false);
  } catch (err) {
    if (err instanceof PartialPaymentUnderNoticeError) {
      // The money has moved; an unrecorded payment is a ledger that lies.
      // Record it, flagged — the landlord decides what the acceptance means
      // for the notice; AcreOS does not decide it for them by omission.
      acceptedDespitePartialUnderNotice = true;
      logger.warn("[P3-3] rent checkout payment recorded despite partial-under-notice", {
        metadata: {
          organizationId,
          leaseId,
          sessionId: stripeSession.id,
          chargeId: err.chargeId,
          balanceAfterCents: err.balanceAfterCents,
          source,
        },
      });
      posted = await attempt(true);
    } else {
      // A concurrent writer with the same session id committed first: the
      // unique (org, operation_key) index rolled this attempt back. Answer
      // with theirs. drizzle wraps the driver error; SQLSTATE is on `cause`.
      const e = err as { code?: string; cause?: { code?: string } } | null;
      if ((e?.code ?? e?.cause?.code) === "23505") {
        const winner = await findRecorded();
        if (winner) return { outcome: "already_recorded", payment: winner };
      }
      throw err;
    }
  }

  const { payment, allocation, firstCharge, isPartial } = posted;

  logger.info("[P3-3] rent checkout payment posted", {
    metadata: {
      organizationId,
      leaseId,
      paymentId: payment.id,
      sessionId: stripeSession.id,
      amountCents,
      allocatedCents: allocation.appliedCents,
      unappliedCents: allocation.unappliedCents,
      isPartial,
      acceptedDespitePartialUnderNotice,
      source,
    },
  });

  // Post-commit effects — exactly once, on the winning writer. Both emits
  // are fire-and-forget and never throw back into the posting.
  emitRentPaymentReceived({
    organizationId,
    leaseId,
    paymentId: payment.id,
    rentChargeId: firstCharge?.chargeId ?? null,
    amountCents,
    isPartial,
    payorType: "tenant",
    method: "card",
    receivedAt,
    dueDate: firstCharge?.dueDate ?? null,
    chargeAmountCents: posted.firstChargeAmountCents,
    chargeBalanceAfterCents: firstCharge?.balanceCents ?? null,
    legalPosture: firstCharge?.legalPosture ?? null,
    allocatedCents: allocation.appliedCents,
    unappliedCents: allocation.unappliedCents,
    allocationLineCount: allocation.allocations.length,
    allocationExplanation: allocation.explanation,
  });
  emitRentReceived({
    organizationId,
    leaseId,
    paymentId: payment.id,
    propertyId: lease.propertyId,
    amountCents,
    receivedAt,
    rentChargeId: firstCharge?.chargeId ?? null,
    rentPeriodMonth: firstCharge?.chargedForMonth ?? null,
  });

  return {
    outcome: "posted",
    payment,
    amountCents,
    isPartial,
    allocatedCents: allocation.appliedCents,
    unappliedCents: allocation.unappliedCents,
    acceptedDespitePartialUnderNotice,
  };
}

/**
 * The lease's open charges (derived balance > 0), oldest first — the read
 * the checkout-creation route prices from. Exported for the route; the
 * posting path re-reads inside its transaction via recordRentPayment.
 */
export async function loadOpenRentCharges(organizationId: number, leaseId: string) {
  const rows = await db
    .select()
    .from(rentCharges)
    .where(and(eq(rentCharges.organizationId, organizationId), eq(rentCharges.leaseId, leaseId)));
  return rows
    .filter((c) => outstandingCentsForCharge(c) > 0)
    .sort((a, b) =>
      String(a.chargedForMonth).localeCompare(String(b.chargedForMonth)) ||
      String(a.dueDate).localeCompare(String(b.dueDate)),
    );
}

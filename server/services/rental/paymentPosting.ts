/**
 * Posting a rent payment to the ledger — the multi-charge allocation writer.
 *
 * The bug this replaces
 * ────────────────────
 * `POST /api/leases/:id/payments` selected the SINGLE oldest open charge
 * (`.limit(1)`) and credited the whole payment to it:
 *
 *     paidCents    = openCharge.paidCents + amountCents
 *     balanceCents = Math.max(0, amount + lateFee - newPaid)
 *
 * The `max(0, …)` silently swallowed every cent of overpayment. A tenant two
 * months behind who paid BOTH months got one month marked paid and the other
 * still showing a full balance — while the ledger's own totals said the money
 * had arrived. Aging buckets, the late-fee decision, `legalPosture`, the
 * collected-% tile and the notice-to-vacate math all keyed off that wrong
 * number. A mis-stated balance in landlord/tenant court is not a display bug;
 * it is the exhibit.
 *
 * What this module does instead
 * ─────────────────────────────
 *   1. Reads EVERY open charge for the lease `FOR UPDATE`, inside the caller's
 *      transaction, so two payments recorded at the same instant cannot both
 *      allocate against the same balance.
 *   2. Allocates with the shared pure rule (`@shared/rental/paymentAllocation`:
 *      oldest charge first, rent before late fees) and proves the split
 *      balances to the cent with `assertAllocationBalances` BEFORE anything is
 *      written. A violation aborts the transaction rather than surfacing as a
 *      wrong number weeks later.
 *   3. PERSISTS one `rent_payment_allocations` row per line, so every ledger
 *      entry can answer "why is this month's balance what it is" — which month
 *      each dollar cured, and how much went to a late fee rather than to rent.
 *   4. Handles overpayment EXPLICITLY: cents that outlive every open charge are
 *      recorded as `rent_payments.unapplied_cents`, an operator-visible credit.
 *      Never clamped away, never absorbed into a balance.
 *   5. Self-heals a balance the old writer mis-stated. The allocator derives
 *      each charge's outstanding from `amountCents + lateFeeCents - paidCents`
 *      (never from the stored `balanceCents`), and the update writes the
 *      derived figure back — so a ledger the old `max(0, …)` corrupted becomes
 *      correct the next time a payment touches the charge.
 *
 * Integer cents throughout. There is no division and no rounding in this
 * module or the allocator it calls, so there is no cent to lose.
 *
 * MONEY POSTURE (founder ruling #15, "be the rail, not the provider"): this is
 * a LEDGER writer. It touches no payment processor, moves no funds, and holds
 * nothing. A `rent_payments` row records money the landlord ALREADY received on
 * their own rails. There is deliberately no tenant payment rail here.
 */

import { and, asc, eq, gt } from "drizzle-orm";
import type { db as database } from "../../db";
import { rentCharges, rentPaymentAllocations, rentPayments } from "@shared/schema";
import type { RentCharge, RentPayment } from "@shared/schema";
import {
  ALLOCATION_ORDER_RULE,
  allocatePayment,
  assertAllocationBalances,
  type AllocationResult,
  type OpenChargeForAllocation,
} from "@shared/rental/paymentAllocation";

/**
 * The transaction handle drizzle hands to `db.transaction(tx => …)`. Derived
 * from the real client rather than hand-written, so a drizzle upgrade cannot
 * silently widen it (and so this file needs no `as any`).
 */
export type RentLedgerTx = Parameters<Parameters<(typeof database)["transaction"]>[0]>[0];

export interface RecordRentPaymentInput {
  organizationId: number;
  leaseId: string;
  /** Integer cents the landlord received. */
  amountCents: number;
  /** YYYY-MM-DD. */
  receivedAt: string;
  method: string | null;
  referenceNumber: string | null;
  payorType: string;
  payorTenantId: string | null;
  /**
   * Operator's explicit acknowledgement that they accept a payment which
   * leaves a charge under a notice to vacate still short. Without it, such a
   * payment is REFUSED (see PartialPaymentUnderNoticeError).
   */
  acceptedDespitePartial: boolean;
  notes: string | null;
}

/** One charge row as it stands after the payment applied. */
export interface ChargeAfterPayment {
  chargeId: string;
  chargedForMonth: string;
  dueDate: string;
  paidCents: number;
  balanceCents: number;
  legalPosture: string;
  /** true when this payment took the charge to a zero balance. */
  clearedByThisPayment: boolean;
}

export interface RecordedRentPayment {
  payment: RentPayment;
  allocation: AllocationResult;
  charges: ChargeAfterPayment[];
  /**
   * The oldest charge the payment touched. `rent_payments.rentChargeId` points
   * at it for backwards compatibility with every existing ledger read; the
   * authoritative breakdown is the allocation rows.
   */
  firstCharge: ChargeAfterPayment | null;
  /** Rent principal of the first charge touched — for the workflow event. */
  firstChargeAmountCents: number | null;
  /**
   * true when the payment left the oldest charge it touched still short. This
   * is the flag `rent_payments.is_partial` has always carried.
   */
  isPartial: boolean;
}

/**
 * Imelda §2.5: "in Texas, accepting partial rent after filing a notice to
 * vacate can void the notice and force me to start over." Thrown from inside
 * the transaction, so the refusal rolls back rather than half-posting.
 */
export class PartialPaymentUnderNoticeError extends Error {
  readonly code = "PARTIAL_PAYMENT_VOIDS_NOTICE";
  readonly chargeId: string;
  readonly balanceAfterCents: number;
  readonly chargedForMonth: string;
  constructor(args: { chargeId: string; chargedForMonth: string; balanceAfterCents: number }) {
    super(
      `Payment leaves the ${args.chargedForMonth.slice(0, 7)} charge short by ` +
        `${args.balanceAfterCents} cents while it is under a notice to vacate.`,
    );
    this.name = "PartialPaymentUnderNoticeError";
    this.chargeId = args.chargeId;
    this.chargedForMonth = args.chargedForMonth;
    this.balanceAfterCents = args.balanceAfterCents;
  }
}

/** Narrow a `rent_charges` row to what the pure allocator needs. */
export function toAllocationCharge(charge: RentCharge): OpenChargeForAllocation {
  return {
    id: charge.id,
    chargedForMonth: String(charge.chargedForMonth).slice(0, 10),
    dueDate: String(charge.dueDate).slice(0, 10),
    amountCents: charge.amountCents,
    lateFeeCents: charge.lateFeeCents,
    paidCents: charge.paidCents,
    balanceCents: charge.balanceCents,
  };
}

/**
 * Record one received payment against every open charge on the lease.
 *
 * MUST be called inside `db.transaction(...)` — the charge read takes row
 * locks that only mean anything for the life of a transaction, and the payment
 * row, the allocation rows and the charge updates have to land together or not
 * at all.
 *
 * The caller emits `payment.received` AFTER the transaction commits. This
 * function deliberately does not emit: a workflow fault must never be able to
 * roll back banked rent.
 */
export async function recordRentPayment(
  tx: RentLedgerTx,
  input: RecordRentPaymentInput,
): Promise<RecordedRentPayment> {
  const openCharges = await tx
    .select()
    .from(rentCharges)
    .where(
      and(
        eq(rentCharges.leaseId, input.leaseId),
        eq(rentCharges.organizationId, input.organizationId),
        gt(rentCharges.balanceCents, 0),
      ),
    )
    // Same order as sortChargesForAllocation, so the SQL and the pure rule can
    // never disagree about what "oldest" means.
    .orderBy(asc(rentCharges.chargedForMonth), asc(rentCharges.dueDate), asc(rentCharges.id))
    // Row locks: two payments recorded in the same instant must not both
    // allocate against the same outstanding balance.
    .for("update");

  const chargeById = new Map<string, RentCharge>();
  for (const c of openCharges) chargeById.set(c.id, c);

  const allocation = allocatePayment(input.amountCents, openCharges.map(toAllocationCharge));
  // Proves every cent is either on a charge or explicitly unapplied, and that
  // no charge was credited past its outstanding balance. Throws → rollback.
  assertAllocationBalances(input.amountCents, allocation);

  const now = new Date();
  const charges: ChargeAfterPayment[] = [];

  for (const line of allocation.allocations) {
    const charge = chargeById.get(line.chargeId);
    if (!charge) {
      // Cannot happen — every line comes from a row we just read — but a
      // missing charge here would mean writing an allocation against nothing.
      throw new Error(`rent allocation referenced an unread charge ${line.chargeId}`);
    }
    const cleared = line.balanceAfterCents === 0;
    if (!cleared && charge.legalPosture === "notice_served" && !input.acceptedDespitePartial) {
      throw new PartialPaymentUnderNoticeError({
        chargeId: charge.id,
        chargedForMonth: String(charge.chargedForMonth).slice(0, 10),
        balanceAfterCents: line.balanceAfterCents,
      });
    }
    charges.push({
      chargeId: charge.id,
      chargedForMonth: String(charge.chargedForMonth).slice(0, 10),
      dueDate: String(charge.dueDate).slice(0, 10),
      paidCents: line.paidAfterCents,
      balanceCents: line.balanceAfterCents,
      // A cleared charge returns to 'ok'. A charge still short keeps whatever
      // posture the operator set — a partial payment does not quietly cancel a
      // notice to vacate.
      legalPosture: cleared ? "ok" : charge.legalPosture,
      clearedByThisPayment: cleared,
    });
  }

  const firstCharge = charges[0] ?? null;
  const firstChargeRow = firstCharge ? chargeById.get(firstCharge.chargeId) ?? null : null;
  const isPartial = firstCharge !== null && firstCharge.balanceCents > 0;

  const [payment] = await tx
    .insert(rentPayments)
    .values({
      organizationId: input.organizationId,
      leaseId: input.leaseId,
      // Backwards compatibility: the oldest charge touched. The full breakdown
      // is in rent_payment_allocations.
      rentChargeId: firstCharge?.chargeId ?? null,
      payorType: input.payorType,
      payorTenantId: input.payorTenantId,
      amountCents: input.amountCents,
      receivedAt: input.receivedAt,
      method: input.method,
      referenceNumber: input.referenceNumber,
      isPartial,
      acceptedDespitePartial: isPartial ? input.acceptedDespitePartial : null,
      allocatedCents: allocation.appliedCents,
      unappliedCents: allocation.unappliedCents,
      allocationOrderRule: ALLOCATION_ORDER_RULE,
      notes: input.notes,
    })
    .returning();

  if (!payment) {
    throw new Error("rent payment insert returned no row");
  }

  if (allocation.allocations.length > 0) {
    await tx.insert(rentPaymentAllocations).values(
      allocation.allocations.map((line) => ({
        organizationId: input.organizationId,
        paymentId: payment.id,
        rentChargeId: line.chargeId,
        leaseId: input.leaseId,
        sequence: line.sequence,
        appliedToRentCents: line.appliedToRentCents,
        appliedToLateFeeCents: line.appliedToLateFeeCents,
        appliedCents: line.appliedCents,
        balanceBeforeCents: line.balanceBeforeCents,
        balanceAfterCents: line.balanceAfterCents,
        orderRule: allocation.orderRule,
      })),
    );
  }

  for (const applied of charges) {
    await tx
      .update(rentCharges)
      .set({
        paidCents: applied.paidCents,
        balanceCents: applied.balanceCents,
        legalPosture: applied.legalPosture,
        legalPostureAt: applied.clearedByThisPayment
          ? now
          : chargeById.get(applied.chargeId)?.legalPostureAt ?? null,
        updatedAt: now,
      })
      .where(
        and(
          eq(rentCharges.id, applied.chargeId),
          eq(rentCharges.organizationId, input.organizationId),
        ),
      );
  }

  return {
    payment,
    allocation,
    charges,
    firstCharge,
    firstChargeAmountCents: firstChargeRow?.amountCents ?? null,
    isPartial,
  };
}

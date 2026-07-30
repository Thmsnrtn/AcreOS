/**
 * Rent-payment allocation — how one payment is spread across open charges.
 *
 * The bug this replaces
 * ────────────────────
 * `POST /api/leases/:id/payments` selected the SINGLE oldest open charge
 * (`.limit(1)`) and credited the whole payment to it:
 *
 *     paidCents   = openCharge.paidCents + amountCents
 *     balanceCents = max(0, amount + lateFee - newPaid)
 *
 * The `max(0, …)` silently swallowed every cent of overpayment. A tenant who
 * was two months behind and paid both months got ONE month marked paid and the
 * other still showing a full balance — while the ledger's own totals said the
 * money arrived. Every downstream number keyed off that: aging buckets, the
 * late-fee decision, `legalPosture`, the "collected %" on the landlord
 * dashboard, and the notice-to-vacate math. A mis-stated balance in
 * landlord/tenant court is not a display bug; it is the exhibit.
 *
 * The order, and why it is defensible
 * ───────────────────────────────────
 * 1. ACROSS charges: oldest first — `chargedForMonth`, then `dueDate`, then
 *    `id` as a stable tiebreak. Oldest-first is the near-universal default in
 *    residential landlord/tenant practice and the only order that lets a
 *    tenant cure the earliest default (the one an eviction would be based on).
 *    It is also the order that cannot be gamed to keep a tenant permanently
 *    "one month behind".
 * 2. WITHIN a charge: RENT before late fees. This direction matters. Applying
 *    a payment to fees first leaves rent unpaid, which in several states
 *    manufactures the ground for a non-payment eviction out of a tenant who
 *    paid the rent in full. Rent-first cannot do that.
 * 3. Money that outlives every open charge is NOT absorbed into a balance and
 *    is NOT silently dropped: it comes back as `unappliedCents`, to be held as
 *    an explicit credit against the next charge.
 *
 * Everything is integer cents. There is no division and no rounding anywhere
 * in this file, so there is no cent to lose. `appliedCents + unappliedCents`
 * always equals the payment exactly — `assertAllocationBalances` proves it.
 *
 * Pure module: no DB, no clock, no I/O. The writer is
 * server/routes-rent-ledger.ts, which persists one `rent_payment_allocations`
 * row per line below so a ledger entry can always answer "why is this charge's
 * balance what it is".
 */

/** The `rent_charges` fields allocation needs. Integer cents throughout. */
export interface OpenChargeForAllocation {
  id: string;
  /** YYYY-MM-DD, always day 1 of the charged month. */
  chargedForMonth: string;
  /** YYYY-MM-DD. */
  dueDate: string;
  /** Rent principal for the period. */
  amountCents: number;
  /** Late fees assessed onto this charge so far. */
  lateFeeCents: number;
  /** Cents already applied to this charge (rent first, then fees). */
  paidCents: number;
  /** Authoritative outstanding: amountCents + lateFeeCents - paidCents. */
  balanceCents: number;
}

/** One recorded allocation line — mirrors a `rent_payment_allocations` row. */
export interface ChargeAllocation {
  chargeId: string;
  /** 1-based position in the application order, for a readable ledger. */
  sequence: number;
  chargedForMonth: string;
  dueDate: string;
  appliedToRentCents: number;
  appliedToLateFeeCents: number;
  /** appliedToRentCents + appliedToLateFeeCents. */
  appliedCents: number;
  balanceBeforeCents: number;
  balanceAfterCents: number;
  /** Charge's rent still outstanding before this payment touched it. */
  rentOutstandingBeforeCents: number;
  /** Charge's late fees still outstanding before this payment touched it. */
  lateFeeOutstandingBeforeCents: number;
  /** paid_cents the charge must be updated to. */
  paidAfterCents: number;
}

export interface AllocationResult {
  allocations: ChargeAllocation[];
  /** Total cents that landed on a charge. */
  appliedCents: number;
  /** Cents with no open charge to land on — an explicit credit, never lost. */
  unappliedCents: number;
  /** Stable identifier for the ordering rule, persisted with each line. */
  orderRule: AllocationOrderRule;
  /** One-line human explanation for the ledger UI / audit. */
  explanation: string;
}

export const ALLOCATION_ORDER_RULE = "oldest_charge_first_rent_before_late_fee" as const;
export type AllocationOrderRule = typeof ALLOCATION_ORDER_RULE;

/**
 * Split a charge's already-applied cents into "went to rent" and "went to
 * fees" under the rent-first rule, then derive what is still outstanding on
 * each. Derived (not stored) so it can never drift from `paidCents`.
 */
export function splitChargeOutstanding(charge: OpenChargeForAllocation): {
  rentOutstandingCents: number;
  lateFeeOutstandingCents: number;
} {
  const rentPaid = Math.min(Math.max(0, charge.paidCents), Math.max(0, charge.amountCents));
  const rentOutstanding = Math.max(0, charge.amountCents - rentPaid);
  const feePaid = Math.max(0, charge.paidCents - rentPaid);
  const lateFeeOutstanding = Math.max(0, charge.lateFeeCents - feePaid);
  return { rentOutstandingCents: rentOutstanding, lateFeeOutstandingCents: lateFeeOutstanding };
}

/**
 * Oldest-first ordering. Exported so the route's SQL ordering and this module
 * can never disagree about what "oldest" means.
 */
export function sortChargesForAllocation<T extends OpenChargeForAllocation>(charges: readonly T[]): T[] {
  return [...charges].sort((a, b) => {
    if (a.chargedForMonth !== b.chargedForMonth) return a.chargedForMonth < b.chargedForMonth ? -1 : 1;
    if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Allocate `amountCents` across every open charge, oldest first, rent before
 * late fees. Charges with no outstanding balance are skipped (they produce no
 * line). Returns the allocation lines plus any unapplied remainder.
 *
 * @throws RangeError if `amountCents` is not a non-negative integer — a
 *         non-integer cent amount must never reach a ledger.
 */
export function allocatePayment(
  amountCents: number,
  charges: readonly OpenChargeForAllocation[],
): AllocationResult {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new RangeError(
      `allocatePayment: amountCents must be a non-negative integer number of cents, got ${amountCents}`,
    );
  }

  const ordered = sortChargesForAllocation(charges);
  const allocations: ChargeAllocation[] = [];
  let remaining = amountCents;
  let sequence = 0;

  for (const charge of ordered) {
    if (remaining <= 0) break;
    const { rentOutstandingCents, lateFeeOutstandingCents } = splitChargeOutstanding(charge);
    const outstanding = rentOutstandingCents + lateFeeOutstandingCents;
    if (outstanding <= 0) continue;

    const toRent = Math.min(remaining, rentOutstandingCents);
    const afterRent = remaining - toRent;
    const toFee = Math.min(afterRent, lateFeeOutstandingCents);
    const applied = toRent + toFee;
    if (applied <= 0) continue;

    sequence += 1;
    allocations.push({
      chargeId: charge.id,
      sequence,
      chargedForMonth: charge.chargedForMonth,
      dueDate: charge.dueDate,
      appliedToRentCents: toRent,
      appliedToLateFeeCents: toFee,
      appliedCents: applied,
      balanceBeforeCents: outstanding,
      balanceAfterCents: outstanding - applied,
      rentOutstandingBeforeCents: rentOutstandingCents,
      lateFeeOutstandingBeforeCents: lateFeeOutstandingCents,
      paidAfterCents: charge.paidCents + applied,
    });
    remaining -= applied;
  }

  const appliedCents = allocations.reduce((s, a) => s + a.appliedCents, 0);
  const unappliedCents = amountCents - appliedCents;

  return {
    allocations,
    appliedCents,
    unappliedCents,
    orderRule: ALLOCATION_ORDER_RULE,
    explanation: buildAllocationExplanation(amountCents, allocations, unappliedCents),
  };
}

function fmtUsd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

/** Plain-language "where did my money go" line for the ledger + audit trail. */
export function buildAllocationExplanation(
  amountCents: number,
  allocations: readonly ChargeAllocation[],
  unappliedCents: number,
): string {
  if (allocations.length === 0) {
    return `${fmtUsd(amountCents)} received with no open charge to apply it to; held as an unapplied credit.`;
  }
  const parts = allocations.map((a) => {
    const bits = [`${fmtUsd(a.appliedToRentCents)} rent`];
    if (a.appliedToLateFeeCents > 0) bits.push(`${fmtUsd(a.appliedToLateFeeCents)} late fee`);
    return `${a.chargedForMonth.slice(0, 7)} (${bits.join(" + ")}, ${fmtUsd(a.balanceAfterCents)} left)`;
  });
  const tail = unappliedCents > 0 ? `; ${fmtUsd(unappliedCents)} held as an unapplied credit` : "";
  return `${fmtUsd(amountCents)} applied oldest-charge-first, rent before late fees → ${parts.join(", ")}${tail}.`;
}

/**
 * Invariant guard for the writer: every cent of the payment is either on a
 * charge or explicitly unapplied, and no charge is credited past its balance.
 * Called inside the payment transaction so a violation aborts before commit
 * rather than showing up as a wrong number weeks later.
 *
 * @throws Error when the allocation does not balance.
 */
export function assertAllocationBalances(amountCents: number, result: AllocationResult): void {
  const summed = result.allocations.reduce((s, a) => s + a.appliedCents, 0);
  if (summed + result.unappliedCents !== amountCents) {
    throw new Error(
      `rent allocation does not balance: applied ${summed} + unapplied ${result.unappliedCents} !== payment ${amountCents}`,
    );
  }
  for (const a of result.allocations) {
    if (a.appliedToRentCents < 0 || a.appliedToLateFeeCents < 0) {
      throw new Error(`rent allocation produced a negative line on charge ${a.chargeId}`);
    }
    if (a.appliedCents > a.balanceBeforeCents) {
      throw new Error(
        `rent allocation over-applied charge ${a.chargeId}: ${a.appliedCents} > outstanding ${a.balanceBeforeCents}`,
      );
    }
    if (a.balanceAfterCents < 0) {
      throw new Error(`rent allocation drove charge ${a.chargeId} to a negative balance`);
    }
  }
}

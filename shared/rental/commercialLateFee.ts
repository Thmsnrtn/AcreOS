// ============================================================================
// SHARED/RENTAL/COMMERCIALLATEFEE.TS — the CONTRACTUAL late fee, computed honestly.
// ----------------------------------------------------------------------------
// Pure and browser-safe. A residential late fee is bounded by STATUTE (state
// caps, grace, citations — the late_fee_rules table); a COMMERCIAL late fee is
// CONTRACTUAL — set by the lease itself, not by a tenancy statute. Presenting the
// residential statutory cap to a commercial lease is wrong-domain fabrication
// (which is why the residential endpoints refuse a commercial org). This is the
// symmetric other half: the fee computed from the lease's OWN contractual terms.
//
// Honesty rules, decided once here:
//   1. No contractual term on the lease ⇒ REFUSE. If the operator has not set the
//      lease's late-fee shape we cannot compute one — we do not invent a fee.
//   2. A chosen shape missing its parameter (flat with no amount, per-diem with no
//      daily rate) ⇒ REFUSE, never a fabricated figure.
//   3. Within the contractual grace period ⇒ zero, and say so (withinGrace).
//   4. The contractual max cap is applied and disclosed (cappedByMax).
// This computes a PROPOSAL; posting a charge is a separate operator action.
// ============================================================================

export interface CommercialLateFeeLeaseTerms {
  lateFeeType: "flat" | "pct_of_overdue" | "per_diem" | "none" | null;
  lateFeeFlatCents: number | null;
  lateFeePctBps: number | null;
  lateFeeGraceDays: number | null;
  lateFeeMaxCents: number | null;
  lateFeePerDayCents: number | null;
}

export interface CommercialLateFeeResult {
  /** False when the lease defines no late-fee term at all. */
  applicable: boolean;
  lateFeeCents: number | null;
  basis: "flat" | "pct_of_overdue" | "per_diem" | "none" | null;
  /** True when the charge is still inside the contractual grace period (fee is 0). */
  withinGrace: boolean;
  /** True when the computed fee was reduced by the contractual max cap. */
  cappedByMax: boolean;
  /** Non-null when the engine refused (no term, or a shape missing its parameter). */
  refusedReason: string | null;
}

function refuse(reason: string): CommercialLateFeeResult {
  return {
    applicable: true,
    lateFeeCents: null,
    basis: null,
    withinGrace: false,
    cappedByMax: false,
    refusedReason: reason,
  };
}

/**
 * Compute the contractual late fee for one overdue charge from the lease's own
 * late-fee terms. `daysLate` is days past the due date (0 or negative ⇒ not late).
 */
export function computeCommercialLateFee(args: {
  lease: CommercialLateFeeLeaseTerms;
  overdueBalanceCents: number;
  daysLate: number;
}): CommercialLateFeeResult {
  const { lease, overdueBalanceCents, daysLate } = args;

  // 1. No contractual term set → refuse (do not invent a fee).
  if (lease.lateFeeType == null) {
    return {
      applicable: false,
      lateFeeCents: null,
      basis: null,
      withinGrace: false,
      cappedByMax: false,
      refusedReason:
        "This lease has no contractual late-fee term set. A commercial late fee is set by the lease — " +
        "record the lease's late-fee terms (type, amount/rate, grace, cap) before proposing one.",
    };
  }

  // The lease explicitly says "no late fee".
  if (lease.lateFeeType === "none") {
    return { applicable: true, lateFeeCents: 0, basis: "none", withinGrace: false, cappedByMax: false, refusedReason: null };
  }

  // 2. Grace: not yet chargeable.
  const grace = lease.lateFeeGraceDays ?? 0;
  if (daysLate <= grace) {
    return {
      applicable: true,
      lateFeeCents: 0,
      basis: lease.lateFeeType,
      withinGrace: true,
      cappedByMax: false,
      refusedReason: null,
    };
  }

  // 3. The fee by shape — a missing parameter refuses.
  let fee: number;
  switch (lease.lateFeeType) {
    case "flat":
      if (lease.lateFeeFlatCents == null) return refuse("Late-fee type is 'flat' but no flat amount (lateFeeFlatCents) is set.");
      fee = lease.lateFeeFlatCents;
      break;
    case "pct_of_overdue":
      if (lease.lateFeePctBps == null) return refuse("Late-fee type is 'pct_of_overdue' but no percentage (lateFeePctBps) is set.");
      fee = Math.round((overdueBalanceCents * lease.lateFeePctBps) / 10000);
      break;
    case "per_diem": {
      if (lease.lateFeePerDayCents == null) return refuse("Late-fee type is 'per_diem' but no daily rate (lateFeePerDayCents) is set.");
      // Accrues per day PAST the grace period.
      const chargeableDays = Math.max(0, daysLate - grace);
      fee = lease.lateFeePerDayCents * chargeableDays;
      break;
    }
    default:
      return refuse(`Unknown late-fee type '${lease.lateFeeType}'.`);
  }

  // 4. Contractual max cap.
  let cappedByMax = false;
  if (lease.lateFeeMaxCents != null && fee > lease.lateFeeMaxCents) {
    fee = lease.lateFeeMaxCents;
    cappedByMax = true;
  }

  return {
    applicable: true,
    lateFeeCents: fee,
    basis: lease.lateFeeType,
    withinGrace: false,
    cappedByMax,
    refusedReason: null,
  };
}

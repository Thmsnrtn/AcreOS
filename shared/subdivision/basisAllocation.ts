// ============================================================================
// SHARED/SUBDIVISION/BASISALLOCATION.TS — a parent's cost basis, split honestly.
// ----------------------------------------------------------------------------
// Pure and browser-safe: no DB, no `process`, no imports. When a parent parcel
// is subdivided, its purchase-price BASIS must distribute across the child lots
// so each lot carries a defensible cost (Brigid §3.3: "my CPA needs basis-per-
// lot for every closing"). This is the ONE place that split is computed, so its
// honesty rules live once here:
//
//   1. There must BE a basis to split. With no parent purchase price the engine
//      REFUSES (allocations null + a reason) — it never allocates a basis it
//      does not have.
//   2. The denominator must be real. Acreage / frontage / appraisal shares are
//      numerator ÷ (sum of numerators); if that sum is zero the split is
//      undefined and the engine REFUSES rather than divide by zero.
//   3. Override shares must sum to 1.0 (within a cent's worth of tolerance).
//      A set of operator shares that doesn't total the whole would silently
//      lose or double-count basis, so the engine REFUSES it.
//   4. Cents are CONSERVED. Per-lot allocations are rounded, but the last lot
//      absorbs the rounding remainder so the allocations sum EXACTLY to the
//      parent basis — no cent is created or destroyed by the split.
//
// COGS realization (realizeCogs) is the tax-time other half: a lot held as
// inventory is not depreciated; its allocated basis becomes cost-of-goods-sold
// when it sells (Brigid §4). COGS is exactly the allocated basis — never a
// re-derived or assumed figure.
// ============================================================================

export type BasisAllocationMethod = "acreage" | "frontage" | "appraisal" | "override";

/** One child lot's allocation input — its id and the numerator for the method. */
export interface BasisAllocationChild {
  id: number;
  /** The lot's numerator: acres (acreage), frontage feet, appraisal value, or override share. */
  numerator: number;
}

/** One child lot's computed allocation line. */
export interface BasisAllocationLine {
  childId: number;
  numerator: number;
  denominator: number;
  /** numerator ÷ denominator — the fraction of parent basis this lot carries. */
  sharePct: number;
  /** The allocated basis in cents; the set sums EXACTLY to the parent basis. */
  allocatedBasisCents: number;
}

export interface BasisAllocationResult {
  method: BasisAllocationMethod;
  /** The frozen denominator (sum of numerators, or 1.0 for override) — null when refused. */
  denominator: number | null;
  /** The per-lot lines, in the input order — null when the engine refused. */
  allocations: BasisAllocationLine[] | null;
  /** Non-null when the engine refused (no basis / zero denominator / bad override sum). */
  refusedReason: string | null;
}

/** Override shares are accepted when they sum to 1.0 within this tolerance. */
export const OVERRIDE_SUM_TOLERANCE = 0.001;

/**
 * Allocate a parent parcel's purchase-price basis across its child lots.
 *
 * For "override" the numerators ARE the operator's shares and the denominator is
 * 1.0 (the shares are validated to sum to 1.0 within tolerance). For every other
 * method the denominator is the sum of the numerators, so the shares are
 * numerator ÷ total. Allocations are cent-rounded with the last lot absorbing the
 * remainder, so `sum(allocatedBasisCents) === parentBasisCents` exactly.
 *
 * Refuses (allocations null + a reason, never a fabricated split) when: the
 * parent has no basis; the denominator is zero; or override shares don't sum to
 * 1.0.
 */
export function allocateBasis(args: {
  parentBasisCents: number | null;
  method: BasisAllocationMethod;
  children: BasisAllocationChild[];
}): BasisAllocationResult {
  const { parentBasisCents, method, children } = args;

  if (parentBasisCents == null) {
    return {
      method,
      denominator: null,
      allocations: null,
      refusedReason:
        "Parent parcel has no purchase price; there is no basis to allocate. Refusing to split a basis it does not have.",
    };
  }

  // Denominator: 1.0 for override (shares are the numerators), else the sum.
  let denominator: number;
  if (method === "override") {
    let sum = 0;
    for (const c of children) sum += c.numerator;
    if (Math.abs(sum - 1.0) > OVERRIDE_SUM_TOLERANCE) {
      return {
        method,
        denominator: null,
        allocations: null,
        refusedReason: `Override shares must sum to 1.0; got ${sum.toFixed(4)}. Refusing to allocate on shares that don't total the whole.`,
      };
    }
    denominator = 1.0;
  } else {
    denominator = 0;
    for (const c of children) denominator += c.numerator;
  }

  if (!(denominator > 0)) {
    return {
      method,
      denominator: null,
      allocations: null,
      refusedReason: "Cannot allocate: the total denominator is zero. Refusing to divide the basis by zero.",
    };
  }

  // Cent-conserving allocation: round each lot's share, but let the LAST lot
  // absorb the accumulated rounding remainder so the set sums EXACTLY to the
  // parent basis. No cent is created or lost by the split.
  const lastIndex = children.length - 1;
  let allocatedSoFar = 0;
  const allocations: BasisAllocationLine[] = children.map((c, i) => {
    const sharePct = c.numerator / denominator;
    let allocatedBasisCents: number;
    if (i === lastIndex) {
      allocatedBasisCents = parentBasisCents - allocatedSoFar;
    } else {
      allocatedBasisCents = Math.round(parentBasisCents * sharePct);
      allocatedSoFar += allocatedBasisCents;
    }
    return { childId: c.id, numerator: c.numerator, denominator, sharePct, allocatedBasisCents };
  });

  return { method, denominator, allocations, refusedReason: null };
}

/**
 * Realize cost-of-goods-sold for a sold lot. A subdivided lot is inventory, not
 * a depreciable asset, so its COGS at sale is exactly its allocated basis — never
 * re-derived and never assumed. Gain is sale price minus that COGS (it may be
 * negative — a loss is a real outcome, not clamped).
 */
export function realizeCogs(args: {
  allocatedBasisCents: number;
  salePriceCents: number;
}): { cogsCents: number; gainCents: number } {
  const cogsCents = args.allocatedBasisCents;
  return { cogsCents, gainCents: args.salePriceCents - cogsCents };
}

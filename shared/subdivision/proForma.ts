// ============================================================================
// SHARED/SUBDIVISION/PROFORMA.TS — the subdivider's project pro-forma.
// ----------------------------------------------------------------------------
// Pure and browser-safe: no DB, no `process`, no imports beyond the sibling
// carry-cost axis. This is the developer's analogue of the multifamily T-12: it
// combines the four subdivision facts a project already has —
//
//   • the parent's purchase basis            (→ COGS as lots sell)
//   • the lot count                          (the mix being sold)
//   • the LOCKED lot-pricing grid            (→ gross proceeds)
//   • the carry over the county timeline     (→ p50 / p90 holding cost)
//
// — into projected gross proceeds, COGS, carry, and net project margin. The one
// discipline that matters lives here so no call site can re-decide it:
//
//   REFUSE PER LINE, NEVER ASSUME. A line whose inputs are missing renders null
//   with an "insufficient inputs" reason — never a fabricated number. No parent
//   purchase price → no COGS and no net margin. No locked grid → no gross
//   proceeds and no net margin. No lots → no lot-count line. No county timeline
//   → no carry, so the carry-INCLUSIVE p50/p90 margin is WITHHELD (the margin
//   before carry, which IS computable, is still reported honestly). This mirrors
//   noi.ts's `commercial_unmeasured` (null op-ex rather than a 40%-of-rent guess)
//   and camReconciliation's `refusedReason`: the honest alternative to a guess
//   is a refusal, everywhere.
// ============================================================================

import type { CarryCostResult } from "./carryCost";

/** One frozen row of the locked pricing grid the pro-forma reads as proceeds. */
export interface ProFormaLockedGridRow {
  childParcelId: number;
  askingPriceCents: number;
}

export interface ProFormaInputs {
  /** The parent parcel's purchase price, in cents — the project's total basis / COGS. */
  parentPurchasePriceCents: number | null;
  /** The number of child lots in the project. */
  lotCount: number | null;
  /** The LOCKED lot-pricing grid (lot_pricing_rules.lockedGrid) — null when not yet locked. */
  lockedGrid: ProFormaLockedGridRow[] | null;
  /** The carry projection over the county timeline (from carryCost.projectCarryCost). */
  carry: CarryCostResult;
}

/** A single cents line that is either computed or refused (never assumed). */
export interface ProFormaCentsLine {
  cents: number | null;
  refusedReason: string | null;
}

export interface ProFormaResult {
  /** Sum of the locked grid's asking prices — refused when the grid isn't locked. */
  grossProceeds: ProFormaCentsLine;
  /** The parent basis carried as cost-of-goods-sold — refused when no purchase price. */
  cogs: ProFormaCentsLine;
  /** The project's lot count — refused when there are no lots. */
  lotCount: { count: number | null; refusedReason: string | null };
  /** Projected carry — p50/p90 over the county timeline; refused when no timeline. */
  carry: { p50Cents: number | null; p90Cents: number | null; refusedReason: string | null };
  /**
   * Net project margin. `beforeCarryCents` (gross proceeds − COGS) is computable
   * whenever both of those lines are; `p50Cents` / `p90Cents` subtract the
   * projected carry and are WITHHELD (null, with `carryRefusedReason`) when the
   * carry couldn't be projected — never a carry-free margin dressed up as the
   * real one. `refusedReason` is set only when the structural inputs (proceeds
   * or COGS) are missing.
   */
  netMargin: {
    beforeCarryCents: number | null;
    p50Cents: number | null;
    p90Cents: number | null;
    refusedReason: string | null;
    carryRefusedReason: string | null;
  };
}

/**
 * Build a subdivision project pro-forma from its four inputs, refusing per line
 * rather than assuming any missing one.
 */
export function computeProForma(inputs: ProFormaInputs): ProFormaResult {
  // ── Gross proceeds — the sum of the LOCKED grid. No lock, no proceeds. ──
  let grossProceeds: ProFormaCentsLine;
  if (inputs.lockedGrid == null || inputs.lockedGrid.length === 0) {
    grossProceeds = {
      cents: null,
      refusedReason:
        "No locked pricing grid: lock the lot-pricing grid before projecting gross proceeds. Refusing to assume an asking price.",
    };
  } else {
    let sum = 0;
    for (const row of inputs.lockedGrid) sum += Math.round(Number(row.askingPriceCents));
    grossProceeds = { cents: sum, refusedReason: null };
  }

  // ── COGS — the parent basis. No purchase price, no basis. ──
  const cogs: ProFormaCentsLine =
    inputs.parentPurchasePriceCents == null
      ? {
          cents: null,
          refusedReason:
            "Parent parcel has no purchase price: there is no basis to carry as COGS. Refusing to assume a basis.",
        }
      : { cents: inputs.parentPurchasePriceCents, refusedReason: null };

  // ── Lot count. No lots, no line. ──
  const lotCount =
    inputs.lotCount == null || inputs.lotCount <= 0
      ? {
          count: null,
          refusedReason: "No child lots on this parent parcel yet. Refusing to project a mix that doesn't exist.",
        }
      : { count: inputs.lotCount, refusedReason: null };

  // ── Carry — projected over the county timeline, or refused when absent. ──
  let carry: { p50Cents: number | null; p90Cents: number | null; refusedReason: string | null };
  if (!inputs.carry.timelineFound) {
    carry = {
      p50Cents: null,
      p90Cents: null,
      refusedReason:
        "No county subdivision timeline on file: carry can't be projected without an approval lead time. Refusing to assume a timeline.",
    };
  } else if (inputs.carry.p50 === null && inputs.carry.p90 === null) {
    carry = {
      p50Cents: null,
      p90Cents: null,
      refusedReason:
        "Carry inputs not supplied: provide a monthly holding cost to project carry over the county timeline.",
    };
  } else {
    carry = {
      p50Cents: inputs.carry.p50?.totalCarryCents ?? null,
      p90Cents: inputs.carry.p90?.totalCarryCents ?? null,
      refusedReason: null,
    };
  }

  // ── Net project margin — gross proceeds − COGS − carry. ──
  let netMargin: ProFormaResult["netMargin"];
  if (grossProceeds.cents == null || cogs.cents == null) {
    netMargin = {
      beforeCarryCents: null,
      p50Cents: null,
      p90Cents: null,
      refusedReason:
        "Insufficient inputs for net margin: it needs both gross proceeds (a locked grid) and COGS (a parent purchase price).",
      carryRefusedReason: null,
    };
  } else {
    const beforeCarryCents = grossProceeds.cents - cogs.cents;
    // Carry-inclusive margin only when carry actually projected; otherwise the
    // p50/p90 figures are WITHHELD (never a carry-free margin passed off as net).
    const haveCarry = carry.refusedReason === null;
    netMargin = {
      beforeCarryCents,
      p50Cents: haveCarry && carry.p50Cents != null ? beforeCarryCents - carry.p50Cents : null,
      p90Cents: haveCarry && carry.p90Cents != null ? beforeCarryCents - carry.p90Cents : null,
      refusedReason: null,
      carryRefusedReason: haveCarry ? null : carry.refusedReason,
    };
  }

  return { grossProceeds, cogs, lotCount, carry, netMargin };
}

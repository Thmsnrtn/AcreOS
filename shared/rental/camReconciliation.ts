// ============================================================================
// SHARED/RENTAL/CAMRECONCILIATION.TS — the CAM true-up, computed honestly.
// ----------------------------------------------------------------------------
// Pure and browser-safe: no DB, no `process`, no imports beyond the sibling
// expense/NOI axes. This is the ONE place a commercial CAM reconciliation is
// computed, so the rules that keep a tenant's true-up honest are decided once
// here and cannot be re-decided per call site:
//
//   1. ONLY the operator's ACTUAL recorded spend recovers. The pool actual is
//      the sum of property_expenses rows in the pool's recoverable categories,
//      filtered to OPERATING rows (a mortgage-interest or depreciation line can
//      never be recovered as CAM even if mis-added to the recoverable set) — the
//      same isOperating flag NOI uses. No estimate is ever billed as an actual.
//   2. The pro-rata share is DERIVED or REFUSED, never guessed. It comes from
//      the lease's fixed CAM share, or from leased ÷ building rentable sqft — and
//      if neither is knowable the engine REFUSES (recoverableShare null + a
//      reason) rather than invent a denominator. A CAM bill on a fabricated share
//      is exactly the kind of number this whole program exists to refuse.
//   3. Thin coverage is DISCLOSED, not hidden. A pool period with expenses in
//      only some of its months still computes a share on what is recorded (that
//      IS the actual spend so far), but coverageComplete is false so the frozen
//      statement can say "based on N/M months of recorded expenses" instead of
//      presenting a partial year as a settled annual true-up.
//
// The result is a FROZEN snapshot: server/routes-rent-ledger.ts writes it once at
// generation with these exact inputs, and never recomputes on read, so a later
// edit to the pool cannot silently rewrite a statement already handed to a tenant.
// ============================================================================

import type { PropertyExpenseCategory } from "./propertyExpense";
import type { MeasurableExpenseRow } from "./noi";

/** The pool definition inputs the reconciliation needs. */
export interface CamPoolInput {
  /** The categories the operator ASSERTS recoverable — the sum is taken over these only. */
  recoverableCategories: PropertyExpenseCategory[];
  /** The building's total rentable area — the denominator of a sqft-derived share. */
  totalRentableSqft: number | null;
  /** An administrative fee on the recovered total, in basis points (1500 = 15%). */
  adminFeeBps: number | null;
  /** Gross-up percentage applied to the pool actual for a partially-occupied building. */
  grossUpPct: number | null;
  /** The reconciliation window (inclusive), YYYY-MM-DD. */
  periodStart: string;
  periodEnd: string;
}

/** The per-lease inputs the reconciliation needs. */
export interface CamLeaseInput {
  /** The lease's CAM share in basis points, when fixed by the lease document. */
  camProRataBps: number | null;
  /** The lease's rentable area — the numerator of a sqft-derived share. */
  rentableSqft: number | null;
  /** The modified-gross base-year expense stop the landlord absorbs before recovery. */
  camBaseYearStopCents: number | null;
  /** Bears on whether a base-year stop applies. */
  leaseType: "gross" | "nnn" | "modified_gross" | null;
}

export interface CamReconciliationResult {
  /** Sum of the recoverable OPERATING rows in the period, in cents (the pool actual). */
  poolActualCents: number;
  /** The per-category breakdown behind poolActualCents. */
  byCategoryCents: Partial<Record<PropertyExpenseCategory, number>>;
  /** The pool actual after the gross-up multiplier (equals poolActual when no gross-up). */
  grossedUpPoolCents: number;
  /** The pro-rata applied, in basis points — null when it could not be determined. */
  proRataBps: number | null;
  /** How the pro-rata was derived, or null when refused. */
  proRataBasis: "lease_fixed" | "sqft" | null;
  leasedSqftUsed: number | null;
  totalRentableSqftUsed: number | null;
  /** This lease's recoverable share (× admin fee, − base-year stop), or null when refused. */
  recoverableShareCents: number | null;
  /** What the tenant was billed in estimates over the period (an input, echoed back). */
  estimatedBilledCents: number;
  /** recoverableShare − estimatedBilled: positive = tenant owes, negative = credit. Null when refused. */
  deltaCents: number | null;
  /** Distinct YYYY-MM buckets in the period carrying a recoverable operating row. */
  coverageMonths: number;
  /** The number of calendar months the pool period spans. */
  periodMonths: number;
  /** True only when every month of the period had a recorded recoverable expense. */
  coverageComplete: boolean;
  /**
   * Set (non-null) when the engine REFUSED to produce a share — the honest
   * alternative to a fabricated number. The caller must surface this and write
   * no billable delta.
   */
  refusedReason: string | null;
}

/** Distinct YYYY-MM count spanned by [start, end] inclusive; 0 for a malformed/reversed range. */
export function monthsInPeriod(periodStart: string, periodEnd: string): number {
  const parse = (d: string): number | null => {
    if (typeof d !== "string" || d.length < 7) return null;
    const y = Number(d.slice(0, 4));
    const m = Number(d.slice(5, 7));
    if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return null;
    return y * 12 + (m - 1);
  };
  const s = parse(periodStart);
  const e = parse(periodEnd);
  if (s === null || e === null || e < s) return 0;
  return e - s + 1;
}

/**
 * Compute a commercial CAM reconciliation for one lease against one pool.
 *
 * The order of operations is the standard commercial one and each step is a
 * recorded or asserted fact, never a guess: sum the ACTUAL recoverable operating
 * spend → gross it up (operator's asserted %) → take the lease's pro-rata share →
 * subtract the modified-gross base-year stop → add the admin fee → subtract what
 * was estimated-billed to get the delta. If the pro-rata share cannot be derived
 * the whole thing refuses rather than bill a fabricated share.
 */
export function computeCamReconciliation(args: {
  pool: CamPoolInput;
  lease: CamLeaseInput;
  rows: MeasurableExpenseRow[];
  estimatedBilledCents: number;
}): CamReconciliationResult {
  const { pool, lease, rows, estimatedBilledCents } = args;

  // 1. Pool actual — ONLY operating rows in the recoverable set. A non-operating
  //    line (mortgage_interest, depreciation) is excluded even if it was mis-added
  //    to recoverableCategories: a financing cost is never a recoverable CAM cost.
  const recoverable = new Set(pool.recoverableCategories);
  const byCategoryCents: Partial<Record<PropertyExpenseCategory, number>> = {};
  const months = new Set<string>();
  let poolActualCents = 0;
  for (const r of rows) {
    if (!r.isOperating) continue;
    if (!recoverable.has(r.category)) continue;
    const cents = Math.round(Number(r.amountCents));
    poolActualCents += cents;
    byCategoryCents[r.category] = (byCategoryCents[r.category] ?? 0) + cents;
    if (typeof r.incurredOn === "string" && r.incurredOn.length >= 7) {
      months.add(r.incurredOn.slice(0, 7));
    }
  }

  const periodMonths = monthsInPeriod(pool.periodStart, pool.periodEnd);
  const coverageMonths = months.size;
  // Complete only when every month of the period carries a recoverable row. When
  // the period is unknowable (periodMonths 0), coverage is never "complete".
  const coverageComplete = periodMonths > 0 && coverageMonths >= periodMonths;

  // 2. Gross-up (operator's asserted percentage applied to the pool actual).
  const grossedUpPoolCents =
    pool.grossUpPct != null && pool.grossUpPct > 0
      ? Math.round(poolActualCents * (1 + pool.grossUpPct / 100))
      : poolActualCents;

  // 3. Pro-rata share — derived from the lease's fixed share, else from sqft,
  //    else REFUSED. No fabricated denominator.
  let proRataBps: number | null = null;
  let proRataBasis: "lease_fixed" | "sqft" | null = null;
  let leasedSqftUsed: number | null = null;
  let totalRentableSqftUsed: number | null = null;

  if (lease.camProRataBps != null) {
    proRataBps = lease.camProRataBps;
    proRataBasis = "lease_fixed";
  } else if (
    lease.rentableSqft != null &&
    lease.rentableSqft > 0 &&
    pool.totalRentableSqft != null &&
    pool.totalRentableSqft > 0
  ) {
    // Clamp to [0, 10000] — a lease cannot recover more than 100% of a pool.
    const raw = Math.round((lease.rentableSqft / pool.totalRentableSqft) * 10000);
    proRataBps = Math.max(0, Math.min(10000, raw));
    proRataBasis = "sqft";
    leasedSqftUsed = lease.rentableSqft;
    totalRentableSqftUsed = pool.totalRentableSqft;
  }

  if (proRataBps === null) {
    return {
      poolActualCents,
      byCategoryCents,
      grossedUpPoolCents,
      proRataBps: null,
      proRataBasis: null,
      leasedSqftUsed: null,
      totalRentableSqftUsed: null,
      recoverableShareCents: null,
      estimatedBilledCents,
      deltaCents: null,
      coverageMonths,
      periodMonths,
      coverageComplete,
      refusedReason:
        "Cannot determine this lease's CAM pro-rata share: set the lease's fixed CAM share (camProRataBps), " +
        "or set both the lease's rentable sqft and the pool's total rentable sqft. Refusing to bill a fabricated share.",
    };
  }

  // 4. Share, then modified-gross base-year stop, then admin fee.
  let share = grossedUpPoolCents * (proRataBps / 10000);
  if (lease.leaseType === "modified_gross" && lease.camBaseYearStopCents != null) {
    // The landlord absorbs recovery up to the base-year stop; the tenant reimburses
    // only the excess. Never negative.
    share = Math.max(0, share - lease.camBaseYearStopCents);
  }
  if (pool.adminFeeBps != null && pool.adminFeeBps > 0) {
    share = share * (1 + pool.adminFeeBps / 10000);
  }
  const recoverableShareCents = Math.round(share);
  const deltaCents = recoverableShareCents - estimatedBilledCents;

  return {
    poolActualCents,
    byCategoryCents,
    grossedUpPoolCents,
    proRataBps,
    proRataBasis,
    leasedSqftUsed,
    totalRentableSqftUsed,
    recoverableShareCents,
    estimatedBilledCents,
    deltaCents,
    coverageMonths,
    periodMonths,
    coverageComplete,
    refusedReason: null,
  };
}

/** cents → "$1,234.56" (a minus sign for negatives), locale-independent. */
export function formatCents(cents: number): string {
  const neg = cents < 0;
  const s = (Math.abs(cents) / 100).toFixed(2);
  const [int, frac] = s.split(".");
  const withCommas = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "−" : ""}$${withCommas}.${frac}`;
}

/**
 * Render the frozen reconciliation as the operator-facing statement text. Pure so
 * the ONE piece of honesty that matters here — the thin-coverage caveat — is
 * decided in a testable place and cannot be dropped at a call site. A refused
 * reconciliation renders its refusal, never a fabricated statement.
 */
export function renderCamStatementMarkdown(
  result: CamReconciliationResult,
  ctx: { periodStart: string; periodEnd: string; poolKind: string },
): string {
  if (result.refusedReason) {
    return (
      `## CAM reconciliation — could not be produced\n\n` +
      `${result.refusedReason}\n`
    );
  }
  const lines: string[] = [];
  lines.push(`## CAM reconciliation (${ctx.poolKind}) — ${ctx.periodStart} to ${ctx.periodEnd}`);
  lines.push("");
  const grossNote =
    result.grossedUpPoolCents !== result.poolActualCents
      ? ` (grossed up to ${formatCents(result.grossedUpPoolCents)})`
      : "";
  lines.push(`- Recoverable pool actual: ${formatCents(result.poolActualCents)}${grossNote}`);
  const basisNote = result.proRataBasis === "sqft"
    ? ` (${result.leasedSqftUsed} of ${result.totalRentableSqftUsed} rentable sqft)`
    : " (fixed by lease)";
  lines.push(`- Your pro-rata share: ${((result.proRataBps ?? 0) / 100).toFixed(2)}%${basisNote}`);
  lines.push(`- Recoverable share: ${formatCents(result.recoverableShareCents ?? 0)}`);
  lines.push(`- Estimated CAM billed over the period: ${formatCents(result.estimatedBilledCents)}`);
  const delta = result.deltaCents ?? 0;
  lines.push(
    `- **${delta >= 0 ? "Balance due" : "Credit due to tenant"}: ${formatCents(Math.abs(delta))}**`,
  );
  if (!result.coverageComplete) {
    lines.push("");
    lines.push(
      `> ⚠️ Based on recorded expenses for ${result.coverageMonths} of ${result.periodMonths} ` +
        `months in this period. This is a PARTIAL reconciliation — the pool actual will rise as the ` +
        `remaining months' expenses are recorded, so treat this balance as provisional, not a settled true-up.`,
    );
  }
  return lines.join("\n") + "\n";
}

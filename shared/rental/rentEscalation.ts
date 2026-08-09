// ============================================================================
// SHARED/RENTAL/RENTESCALATION.TS — the base rent for a given month, escalated.
// ----------------------------------------------------------------------------
// Pure and browser-safe. A commercial lease's rent is rarely a single figure:
// it steps over the term (fixed bumps, fixed %, CPI with a collar). The rent for
// any month is COMPUTED from the applicable steps, not stored. This is the ONE
// place that computation lives.
//
// THE BACKWARD-COMPATIBILITY INVARIANT (load-bearing)
// ───────────────────────────────────────────────────
// A lease with NO schedule steps — every residential lease, and every commercial
// lease that hasn't defined escalation — returns its flat monthlyRentCents,
// byte-for-byte. Escalation is purely additive: it can only change the rent of a
// lease that has explicitly defined steps. rentSchedule.ts's planner calls this
// with `scheduleSteps ?? []`, so the empty case is the common case and it is a
// no-op. Getting this wrong would silently restate every landlord's rent roll.
//
// HONESTY: a step missing the input its type needs (a fixed_amount with no
// amount, a CPI step with no index anchor) is a NO-OP, never a fabricated jump.
// The write path (rentScheduleStepSchema) already refuses such a step; this is
// the defence in depth so incomplete data can never invent an escalation.
// ============================================================================

export interface RentScheduleStepInput {
  /** The month this step takes effect, YYYY-MM-01 (or any YYYY-MM-DD; only the month is used). */
  effectiveMonth: string;
  stepType: "fixed_amount" | "fixed_pct" | "cpi";
  /** Absolute new rent (fixed_amount). */
  amountCents: number | null;
  /** Escalation in basis points (fixed_pct). */
  pctBps: number | null;
  /** CPI anchor at the prior reference (cpi). */
  cpiIndexBase: number | null;
  /** CPI value at this step (cpi). */
  cpiIndexCurrent: number | null;
  /** Collar floor on the CPI escalation, in basis points. */
  floorPctBps: number | null;
  /** Collar ceiling on the CPI escalation, in basis points. */
  ceilingPctBps: number | null;
}

function applyStep(rent: number, step: RentScheduleStepInput): number {
  switch (step.stepType) {
    case "fixed_amount":
      // Absolute reset. A missing amount is a no-op — never fabricate a figure.
      return step.amountCents != null ? step.amountCents : rent;
    case "fixed_pct":
      if (step.pctBps == null) return rent;
      return Math.round(rent * (1 + step.pctBps / 10000));
    case "cpi": {
      if (step.cpiIndexBase == null || step.cpiIndexCurrent == null || step.cpiIndexBase <= 0) {
        return rent;
      }
      // The raw CPI escalation as a fraction, then bounded by the collar when set.
      let pct = step.cpiIndexCurrent / step.cpiIndexBase - 1;
      if (step.floorPctBps != null) pct = Math.max(pct, step.floorPctBps / 10000);
      if (step.ceilingPctBps != null) pct = Math.min(pct, step.ceilingPctBps / 10000);
      return Math.round(rent * (1 + pct));
    }
    default:
      return rent;
  }
}

/**
 * The effective base rent for `monthKey`, starting from `baseRentCents` and
 * applying every schedule step effective on or before that month, in
 * chronological order (bumps compound; a fixed_amount resets).
 *
 * Returns `baseRentCents` unchanged when there are no steps — the invariant the
 * residential rent roll depends on.
 */
export function effectiveBaseRentForMonth(
  baseRentCents: number,
  steps: readonly RentScheduleStepInput[],
  monthKey: string,
): number {
  if (!steps || steps.length === 0) return baseRentCents;
  const target = String(monthKey).slice(0, 7); // YYYY-MM
  const applicable = steps
    .filter(
      (s) =>
        typeof s.effectiveMonth === "string" &&
        s.effectiveMonth.length >= 7 &&
        s.effectiveMonth.slice(0, 7) <= target,
    )
    .sort((a, b) => a.effectiveMonth.slice(0, 7).localeCompare(b.effectiveMonth.slice(0, 7)));

  let rent = baseRentCents;
  for (const step of applicable) rent = applyStep(rent, step);
  return rent;
}

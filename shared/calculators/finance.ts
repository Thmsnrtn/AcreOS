/**
 * Loan arithmetic shared by every vertical underwriting calculator.
 *
 * The vertical program's ONE payment formula: every engine built on the
 * underwriting kit uses it, so a rental, a mobile-home park and a
 * seller-financed deal underwritten there cannot disagree about what the same
 * loan costs. It is not yet the repo's only one — older calculators
 * (dealUnderwriting, the blind-offer calculator, Pax's tools, among others)
 * carry their own, and converging them is separate work.
 *
 * `remainingBalanceCents` has no production caller. The note-acquisition engine
 * (V1) deliberately walks its schedule month by month instead, because a
 * secondary-market note's actual payment often differs from the level payment
 * this function assumes; its tests use this function as the oracle the walk
 * must agree with when the payment IS level.
 * PURE. Money is integer cents in and out; rates are PERCENTAGE POINTS (7.5 for
 * 7.5%), following the shared/economics/engineFields.ts convention.
 */

/**
 * The level monthly payment that amortises `principalCents` over `years` at
 * `annualRatePct`. A zero rate is straight-line. Zero principal or term is 0.
 *
 * Rounded to the cent at the end only, so the rounding is not compounded.
 */
export function monthlyPaymentCents(principalCents: number, annualRatePct: number, years: number): number {
  if (principalCents <= 0 || years <= 0) return 0;
  const n = Math.round(years * 12);
  const r = annualRatePct / 100 / 12;
  if (r === 0) return Math.round(principalCents / n);
  const payment = (principalCents * r) / (1 - Math.pow(1 + r, -n));
  return Math.round(payment);
}

/**
 * Remaining principal after `monthsPaid` level payments — what a balloon or a
 * refinance must retire. Never negative.
 */
export function remainingBalanceCents(
  principalCents: number,
  annualRatePct: number,
  amortizationYears: number,
  monthsPaid: number,
): number {
  if (principalCents <= 0) return 0;
  const n = Math.round(amortizationYears * 12);
  if (monthsPaid >= n) return 0;
  const r = annualRatePct / 100 / 12;
  if (r === 0) return Math.max(0, Math.round(principalCents - (principalCents / n) * monthsPaid));
  const growth = Math.pow(1 + r, monthsPaid);
  const pmt = (principalCents * r) / (1 - Math.pow(1 + r, -n));
  const balance = principalCents * growth - pmt * ((growth - 1) / r);
  return Math.max(0, Math.round(balance));
}

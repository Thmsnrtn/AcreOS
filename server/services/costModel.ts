/**
 * costModel — the single source of truth for the platform's own cost
 * constants (2026-07-07 cost audit).
 *
 * Before this module, the nightly cost optimizer carried these numbers as
 * private constants while the financial forecaster used a flat "$200 base
 * infra" guess — roughly double the real floor — so the founder-facing
 * runway math and the optimizer's margin math could never agree. Both now
 * read from here.
 *
 * The numbers are deliberately rough planning figures, revisited whenever
 * the Fly bill meaningfully moves; they are not a billing feed.
 */

/** Fly.io baseline shared infra (app + worker + managed Postgres), USD/mo. */
export const FLY_BASE_COST_USD = 25.0;

/** Very rough Fly marginal cost per paying customer, USD/mo. */
export const FLY_COST_PER_CUSTOMER_USD = 0.18;

/** Lob + Twilio + SendGrid blended platform-paid comms per customer, USD/mo. */
export const COMMS_COST_PER_CUSTOMER_USD = 0.12;

/** Non-AI monthly platform cost for a given paying-customer count, USD. */
export function estimateMonthlyInfraUsd(payingCustomerCount: number): number {
  const customers = Math.max(0, payingCustomerCount);
  return (
    FLY_BASE_COST_USD +
    customers * (FLY_COST_PER_CUSTOMER_USD + COMMS_COST_PER_CUSTOMER_USD)
  );
}

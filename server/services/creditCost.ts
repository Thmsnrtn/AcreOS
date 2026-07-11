/**
 * Effective credit cost for a metered action — founder-calibrated override
 * with compiled fallback.
 *
 * Moved out of shared/billing/credit-weights.ts (Tier 1C boundary
 * enforcement): the old location reached into server/services/settings via a
 * dynamic `await import("../../server/services/settings")`, which made a
 * shared/ module depend on server code (drizzle/pg) and relied on a runtime
 * try/catch to stay client-bundle-safe. shared/ must stay isomorphic
 * (enforced by scripts/check-boundaries.mjs), so the server-only half lives
 * here; the pure constants (CREDIT_WEIGHTS, creditExamples, CreditAction)
 * remain in shared/ for the pricing page.
 */

import {
  CREDIT_WEIGHTS,
  type CreditAction,
} from "@shared/billing/credit-weights";
import { getSetting } from "./settings";

/**
 * Reads from `founder_settings` first (key `credits.weight.{action}`) so the
 * founder can recalibrate via /founder/studio/credits without a code deploy;
 * falls back to the compiled `CREDIT_WEIGHTS` constant when no override row
 * exists.
 *
 * Returns a `number` (cents-to-us). Callers should round-up at deduction
 * time so fractional weights (email at 0.02) never undercount.
 */
export async function creditCost(action: CreditAction): Promise<number> {
  const fallback = CREDIT_WEIGHTS[action];

  try {
    const value = await getSetting<number>(
      `credits.weight.${action}`,
      fallback,
      { scope: "global", scopeRef: null },
    );
    // Defensive: founder_settings is JSONB so a malformed write could
    // return a non-number. Fall back to the constant rather than
    // billing wrongly.
    //
    // ZERO IS THE SENTINEL, not a price: settingsSeeder.ts seeds every
    // credits.weight.* row as 0 documented as "0 = use the canonical
    // constant from shared/billing/credit-weights.ts". This comparison
    // previously accepted 0 (`value >= 0`), so the seeded sentinel
    // OVERRODE every compiled weight and every metered action cost 0¢ —
    // the pool gate never engaged and COGS ran unmetered (found by the
    // 2026-07-11 full-app sweep). A founder override must be > 0.
    return typeof value === "number" && Number.isFinite(value) && value > 0
      ? value
      : fallback;
  } catch {
    // Settings service unavailable (e.g. during test isolation without a
    // DB) — return the compiled constant rather than throw, so metered
    // actions never block on settings infrastructure failures.
    return fallback;
  }
}

/**
 * Plan limits — ONE definition, because two answers to "is this org near its
 * limit?" is one answer too many.
 *
 * This table lived privately inside `server/jobs/growthAutomation.ts`, where it
 * drives the upsell email. `leadingIndicators.computeLeadingIndicators` — the
 * founder's "orgs approaching plan limits" signal — could not see it, and so
 * INVENTED its numbers instead: it took the first three organizations by
 * `limit(10).slice(0, 3)` and assigned `usagePercent: 75 + i * 8`,
 * `daysToLimit: 14 - i * 3`. Real organization names, beside figures that were
 * a function of array position.
 *
 * Extracted here so both consumers compute the same thing from the same
 * numbers. Adding a tier means editing one place, and the two surfaces cannot
 * drift into disagreeing about what "80% of your plan" means.
 */

export interface PlanLimit {
  /** Maximum leads on this tier. */
  leads: number;
  /** Maximum deals on this tier. */
  deals: number;
  /** Human-facing tier name. */
  name: string;
  /** The tier an org on this one would move up to. */
  nextTier: string;
}

export const PLAN_LIMITS: Record<string, PlanLimit> = {
  free: { leads: 50, deals: 5, name: "Free", nextTier: "starter" },
  starter: { leads: 500, deals: 50, name: "Starter", nextTier: "pro" },
  pro: { leads: 5000, deals: 500, name: "Pro", nextTier: "scale" },
};

/** The tiers that HAVE a limit. Tiers above these are unmetered here. */
export const METERED_TIERS = Object.keys(PLAN_LIMITS);

/** Limits for a tier, or null when the tier is unmetered or unknown. */
export function planLimitsFor(tier: string | null | undefined): PlanLimit | null {
  if (!tier) return null;
  return PLAN_LIMITS[tier] ?? null;
}

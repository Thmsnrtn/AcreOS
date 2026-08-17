/**
 * simulationMode.ts — the single source of truth for "no real-world
 * side effects allowed". When SIMULATION_MODE=true, every external
 * side-effect call site short-circuits and logs a "would have done X"
 * record instead of actually doing X.
 *
 * Built for the founder-side autonomy testing suite. The whole point
 * is that the test org can execute the full decision pipeline — up
 * to and including "charge the card, send the letter, dial the
 * number" — without any real money or communication leaving the
 * building.
 *
 * Four enforcement layers, in order of preference:
 *
 *   1. Category-level kill-switches (SIMULATION_MODE_* per provider)
 *      Fine-grained control for targeted tests.
 *   2. Global kill-switch (SIMULATION_MODE=true)
 *      Sets all category switches at once. Use this by default.
 *   3. Per-org kill-switch (org.settings.simulationMode)
 *      Per-org override so the test org can be simulated while real
 *      customer orgs on the same deployment are still live.
 *   4. Audit log (simulated_actions table / activity log fallback)
 *      Every would-have-happened action is logged with a payload so
 *      the persona harness can score "did the system attempt this?"
 *
 * Tests should set SIMULATION_MODE=true. The test org's settings
 * should ALSO have simulationMode=true — either one is sufficient.
 */

import { logger } from "./logger";

export type SimulatedCategory =
  | "stripe"
  | "lob"
  | "sms"
  | "email"
  | "ai_paid"
  | "webhook_outbound"
  | "billing_mutation"
  // Listing syndication side-effects (LANDCOM, LANDFLIP, Meta Marketplace,
  // etc.). When simulated, /api/listings/:id/publish writes a recordSimulated
  // entry instead of posting to partner APIs.
  | "listings"
  // Paid advertising (Meta ad campaigns). The most literally-spending rail in
  // the repo: `createLandListingCampaign` POSTs a `daily_budget` to
  // graph.facebook.com against the PLATFORM ad account. It had no category and
  // therefore no kill-switch, so a dev, CI or staging boot could buy ads.
  | "ads";

/**
 * Bare process-env read of the global kill-switch. Tests should set
 * SIMULATION_MODE=true. Production leaves it unset.
 */
export function isGlobalSimulationMode(): boolean {
  const v = (process.env.SIMULATION_MODE || "").toLowerCase().trim();
  return v === "true" || v === "1" || v === "yes";
}

/**
 * Categories included in the global SIMULATION_MODE=true kill-switch.
 *
 * Excluded: `ai_paid`. We deliberately let OpenRouter / OpenAI calls
 * run live during simulation — token spend is small, metered, and
 * *we need real AI output to grade the system's decisions*. Stubbing
 * AI would reduce every test to "did pipeline wiring work" and throw
 * away the whole point of the founder autonomy test.
 *
 * Any tester worried about AI cost during a long vacation sim can
 * set SIMULATION_MODE_AI_PAID=true explicitly to force the stub.
 */
const GLOBAL_SIM_CATEGORIES: ReadonlySet<SimulatedCategory> = new Set([
  "stripe",
  "lob",
  "sms",
  "email",
  "webhook_outbound",
  "billing_mutation",
  "listings",
  // Spend rails default to simulated. Ads is the one category where the
  // absence of a default would be paid for in real money per hour.
  "ads",
]);

/**
 * Category-specific override — lets you run most of the system live
 * but ring-fence a single provider for a targeted test. Example:
 *
 *   SIMULATION_MODE_LOB=true        # postcards/letters never print
 *   SIMULATION_MODE_STRIPE=true     # cards never charged
 *   SIMULATION_MODE_AI_PAID=true    # AI returns canned responses
 */
export function isCategorySimulated(category: SimulatedCategory): boolean {
  if (isGlobalSimulationMode() && GLOBAL_SIM_CATEGORIES.has(category)) return true;
  const key = `SIMULATION_MODE_${category.toUpperCase()}`;
  const v = (process.env[key] || "").toLowerCase().trim();
  return v === "true" || v === "1" || v === "yes";
}

/**
 * Per-organization simulation mode — read from `org.settings.simulationMode`.
 * Pass `org` when available; returns false when undefined so callers can
 * fall back to the env-level check with `|| isCategorySimulated(...)`.
 */
export function isOrgSimulated(org: { settings?: unknown } | null | undefined): boolean {
  if (!org?.settings || typeof org.settings !== "object") return false;
  const s = org.settings as Record<string, unknown>;
  return s.simulationMode === true;
}

/**
 * Convenience: is this call about to cause a real-world side effect,
 * or should it be short-circuited?
 */
export function shouldSimulate(
  category: SimulatedCategory,
  org?: { settings?: unknown } | null
): boolean {
  return isCategorySimulated(category) || isOrgSimulated(org);
}

/**
 * Record a would-have-happened action. Writes to the simulated_actions
 * table when available, falls back to structured logger so nothing is
 * ever lost. Returns a fake response shaped like the provider's real
 * response so callers can continue without null-check pollution.
 */
export async function recordSimulatedAction<T extends Record<string, unknown>>(
  category: SimulatedCategory,
  action: string,
  payload: T,
  org?: { id?: number; settings?: unknown } | null
): Promise<{ simulated: true; category: SimulatedCategory; action: string; payload: T; id: string }> {
  const id = `sim_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const record = {
    simulated: true as const,
    category,
    action,
    payload,
    id,
    orgId: org?.id,
    at: new Date().toISOString(),
  };
  logger.info("[simulation] would have executed action", {
    source: "simulationMode",
    metadata: record,
  });
  // Best-effort DB log. Never throw — logging must not break the caller.
  try {
    const { db } = await import("../storage");
    const { simulatedActions } = await import("@shared/schema");
    await db.insert(simulatedActions).values({
      category,
      action,
      payload: payload as Record<string, unknown>,
      organizationId: org?.id ?? null,
      simulatedId: id,
    });
  } catch {
    /* non-fatal — table may not exist yet on fresh DB */
  }
  return record as any;
}

/**
 * Fluent guard: throw if simulation mode is off when the caller
 * expects it to be on. Useful at the top of a test harness:
 *
 *   requireSimulationMode();   // aborts if someone forgot to flip it
 */
export function requireSimulationMode(): void {
  if (!isGlobalSimulationMode()) {
    throw new Error(
      "SIMULATION_MODE must be set to 'true' before running this code. " +
        "Refusing to continue — real-world side effects could fire."
    );
  }
}

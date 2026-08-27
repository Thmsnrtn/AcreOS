// The permanent hard-stops, as a PURE data module (no db/logger imports) so
// that pure policy code — witnessGrant, the hands registry — can enforce them
// without dragging in runtime dependencies. gateWatcher re-exports these for
// its callers; this file is the single source of truth.
//
// (mature-machine §1.4 + §4, final row): these classes of action are NEVER
// autonomous, forever. Encoded as data so tests can pin the list and so ask
// bodies can cite it verbatim.

export const HARD_STOPS = [
  "pricing_changes",
  "legal_signing",
  "spend_over_500_usd",
  "customer_data_deletion",
] as const;

export type HardStop = (typeof HARD_STOPS)[number];

/**
 * The ">$500 spend" hard-stop, as machine constants. This module is the SINGLE
 * SOURCE OF TRUTH for the ceiling across every autonomy lane.
 *
 * Both units are derived from ONE number so they can never drift. Before
 * 2026-08-28 the executor lane (financialAuthorityGate.ts's
 * AUTONOMOUS_SPEND_CEILING_CENTS = 50_000) and the autopilot lane (this file's
 * USD constant) each hard-coded the ceiling in a different unit, agreeing only
 * by the author's arithmetic — change one and the other silently drifts. The
 * executor now DERIVES its cents value from HARD_STOP_SPEND_LIMIT_CENTS here.
 * Kept a pure data module (no db/logger) so witnessGrant, the hands registry
 * and financialAuthorityGate can all import it without a dependency cycle.
 */
export const HARD_STOP_SPEND_LIMIT_USD = 500;
/** The same ceiling in cents — the unit financial gates and Stripe operate in. */
export const HARD_STOP_SPEND_LIMIT_CENTS = HARD_STOP_SPEND_LIMIT_USD * 100;

/**
 * Name/description patterns that identify an actuator implementing a
 * hard-stop class. The hands registry refuses AT BOOT to register any hand
 * matching these — pricing changes, legal signing, and customer-data deletion
 * must never gain an actuator, witnessed or not. This converts what was a
 * convention ("no such hand exists") into code (no such hand CAN exist).
 */
export const HARD_STOP_HAND_PATTERNS: ReadonlyArray<{ pattern: RegExp; hardStop: HardStop }> = [
  { pattern: /pric(e|ing)[-_ ]?(change|update|set|adjust)/i, hardStop: "pricing_changes" },
  { pattern: /(change|update|set|adjust)[-_ ]?pric(e|ing)/i, hardStop: "pricing_changes" },
  { pattern: /legal[-_ ]?(sign|signing|execute|contract)/i, hardStop: "legal_signing" },
  { pattern: /sign[-_ ]?(contract|agreement|legal)/i, hardStop: "legal_signing" },
  { pattern: /(delete|purge|destroy|erase)[-_ ]?(customer|org|organization|account)[-_ ]?data/i, hardStop: "customer_data_deletion" },
  { pattern: /(customer|org|organization)[-_ ]?data[-_ ]?(delete|deletion|purge)/i, hardStop: "customer_data_deletion" },
];

/**
 * Returns the hard-stop class a hand name/description would implement, or
 * null when it matches none. Pure.
 */
export function matchHardStopHand(name: string, description: string): HardStop | null {
  const haystack = `${name} ${description}`;
  for (const { pattern, hardStop } of HARD_STOP_HAND_PATTERNS) {
    if (pattern.test(haystack)) return hardStop;
  }
  return null;
}


/**
 * CROSS-LANE COVERAGE — which enforcement each lane owes every hard-stop class.
 *
 * The hard-stops are enforced by THREE lanes with three different input shapes,
 * each fit to what it governs (this is deliberate, not duplication):
 *   - the EXECUTOR lane  — checkHardGuardrails() in autonomousDecisionExecutor.ts,
 *     classifying free-text action types/payloads by token intent;
 *   - the AGENT-AUTHORITY lane — NEVER_PROMOTE_ACTIONS in agentAuthorityGate.ts,
 *     refusing to promote specific action ids;
 *   - the HANDS lane — HARD_STOP_HAND_PATTERNS above, refusing AT BOOT to
 *     register an actuator whose identity implements a hard-stop class.
 *
 * What was NOT deliberate is that nothing tied them together: a class covered in
 * one lane could be invisible in another, silently. Writing this map found a
 * real instance on 2026-08-28 — NEVER_PROMOTE_ACTIONS had ids for pricing,
 * legal, and refunds, but NO customer-data-deletion id at all, so a promotion
 * request for "delete_customer_data" passed isNeverPromote unchecked.
 *
 * This Record is keyed by HardStop, so adding a new hard-stop class WITHOUT
 * declaring its lane coverage is a COMPILE ERROR — exhaustive by type. The
 * runtime half lives in tests/unit/hardStopLaneCoverage.test.ts, which drives
 * each lane's REAL gate with these probes. A probe of `null` is a recorded
 * design decision, not silence.
 */
export interface HardStopLaneCoverage {
  /** An action the executor's checkHardGuardrails MUST block, verbatim. */
  executorProbe: { itemType?: string; actionPayload?: Record<string, unknown> };
  /** Action ids agentAuthorityGate's NEVER_PROMOTE_ACTIONS must contain. */
  neverPromoteIds: readonly string[];
  /**
   * A hand identity matchHardStopHand MUST classify as this class — or null
   * where the class is not expressible as a hand identity (spend is an AMOUNT
   * property of any action, not a kind of hand; it is enforced by the numeric
   * guards instead).
   */
  handProbe: { name: string; description: string } | null;
}

export const HARD_STOP_LANE_COVERAGE: Record<HardStop, HardStopLaneCoverage> = {
  pricing_changes: {
    executorProbe: { itemType: "modify_pricing_plans" },
    neverPromoteIds: ["modify_pricing_plans", "pricing_tier_restructure"],
    handProbe: { name: "pricing-change", description: "updates subscription pricing tiers" },
  },
  legal_signing: {
    executorProbe: { itemType: "sign_contract" },
    neverPromoteIds: ["legal_document_change", "regulatory_filing"],
    handProbe: { name: "legal-signing", description: "executes and signs contracts" },
  },
  spend_over_500_usd: {
    executorProbe: { actionPayload: { amount: HARD_STOP_SPEND_LIMIT_CENTS + 1 } },
    neverPromoteIds: ["process_refund_over_500"],
    handProbe: null,
  },
  customer_data_deletion: {
    executorProbe: { itemType: "purge_customer_data" },
    neverPromoteIds: ["delete_customer_data", "purge_customer_data"],
    handProbe: { name: "delete-customer-data", description: "purges organization data" },
  },
};

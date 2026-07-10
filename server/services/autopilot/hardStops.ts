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

/** The ">$500 spend" hard-stop, as a machine constant (USD). */
export const HARD_STOP_SPEND_LIMIT_USD = 500;

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

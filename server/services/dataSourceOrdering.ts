/**
 * The one ordering decision for data-source lookups, extracted pure.
 *
 * Lives OUTSIDE data-source-broker.ts on purpose (unit 119): the broker is a
 * dynamically-imported module the reachability gate treats as opaque, so a new
 * export there is one the gate can never assert on — the count that may only
 * shrink grew by one the moment the freeSourceFirst test seam was exported from
 * it. Here the broker imports it statically, the gate sees a real production
 * consumer, and the founder-dial test exercises it directly.
 *
 * `freeSourceFirst` is the founder studio dial (routing.data) that unit 116's
 * triage found wired to nothing; the broker now consults it, and this function
 * is where the dial actually changes the answer: ON forces free tiers ahead of
 * paid before priority/success-rate tiebreaks, OFF falls back to the broker's
 * natural priority order.
 */

import type { DataSource } from "@shared/schema";
import type { AccessTier } from "./data-source-broker";

export const TIER_PRIORITY: AccessTier[] = ["free", "cached", "byok", "paid"];

export function orderSourcesForLookup(
  sources: DataSource[],
  opts: {
    freeSourceFirst: boolean;
    tierOf: (source: DataSource) => AccessTier;
    successRateOf: (sourceId: number) => number;
  },
): DataSource[] {
  return sources.sort((a, b) => {
    const verifiedA = a.isVerified ? 0 : 1;
    const verifiedB = b.isVerified ? 0 : 1;
    if (verifiedA !== verifiedB) return verifiedA - verifiedB;

    if (opts.freeSourceFirst) {
      const tierA = TIER_PRIORITY.indexOf(opts.tierOf(a));
      const tierB = TIER_PRIORITY.indexOf(opts.tierOf(b));
      if (tierA !== tierB) return tierA - tierB;
    }

    const priorityA = a.priority || 100;
    const priorityB = b.priority || 100;
    if (priorityA !== priorityB) return priorityA - priorityB;

    return opts.successRateOf(b.id) - opts.successRateOf(a.id);
  });
}

/**
 * The subscription_events vocabulary — what the writers actually write
 * (DEFECT-0149).
 *
 * The billing webhook and the cancel route write `cancel`, `trial_end`,
 * `change`, `pause` and `resume`. About ten founder readers filtered on
 * `subscription_cancelled` / `subscription_upgraded` / `subscription_created`,
 * and storage.getSubscriptionStats on `upgrade` / `downgrade` / `signup` —
 * values nothing has ever written — so every churn number, weekly-digest
 * cancellation count and upgrade count read zero. Readers and writers name
 * these constants; `subscriptionEventVocabulary.test.ts` holds every literal
 * compared against or written to `event_type` to this set.
 *
 * An upgrade or downgrade is not its own event: it is a `change` whose tier
 * rank went up or down, classified here from fromTier/toTier.
 */
import { tierForSubscriptionTier, type Tier } from "./tier-pricing";

export const SUBSCRIPTION_EVENT = {
  /** A PAYING subscription ended. */
  cancel: "cancel",
  /** A trial ended without converting — not churn of a paying customer. */
  trialEnd: "trial_end",
  /** The tier changed (upgrade, downgrade, or conversion from free). */
  change: "change",
  pause: "pause",
  resume: "resume",
} as const;

export type SubscriptionEventType = (typeof SUBSCRIPTION_EVENT)[keyof typeof SUBSCRIPTION_EVENT];

const RANK: Record<Tier, number> = { starter: 1, pro: 2, scale: 3 };

/** 0 for free or unknown; 1..3 for the paid tiers (legacy aliases resolved). */
export function tierRank(subscriptionTier: string | null | undefined): number {
  const tier = tierForSubscriptionTier(subscriptionTier);
  return tier ? RANK[tier] : 0;
}

export type TierMove = "upgrade" | "downgrade" | "lateral";

export function classifyTierChange(fromTier: string | null | undefined, toTier: string | null | undefined): TierMove {
  const a = tierRank(fromTier);
  const b = tierRank(toTier);
  return b > a ? "upgrade" : b < a ? "downgrade" : "lateral";
}

/**
 * 30-day subscription movement from raw events. upgrade / downgrade /
 * reactivate / signup were never written, so these were four zeros: an
 * upgrade or downgrade is a `change` classified by tier rank, a signup is a
 * change from free to paid, a reactivation is a paused subscription resuming.
 */
export function tallySubscriptionEvents(
  events: ReadonlyArray<{ eventType: string; fromTier: string | null; toTier: string | null }>,
): { upgrades30d: number; downgrades30d: number; cancellations30d: number; reactivations30d: number; signups30d: number } {
  const t = { upgrades30d: 0, downgrades30d: 0, cancellations30d: 0, reactivations30d: 0, signups30d: 0 };
  for (const e of events) {
    if (e.eventType === SUBSCRIPTION_EVENT.change) {
      const move = classifyTierChange(e.fromTier, e.toTier);
      if (move === "upgrade") {
        t.upgrades30d++;
        if (tierRank(e.fromTier) === 0) t.signups30d++;
      } else if (move === "downgrade") t.downgrades30d++;
    } else if (e.eventType === SUBSCRIPTION_EVENT.cancel) t.cancellations30d++;
    else if (e.eventType === SUBSCRIPTION_EVENT.resume) t.reactivations30d++;
  }
  return t;
}

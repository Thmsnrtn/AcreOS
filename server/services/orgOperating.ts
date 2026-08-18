/**
 * ONE answer to "may AcreOS act on this organization's behalf right now?"
 *
 * ── THE DEFECT THIS ENDS ────────────────────────────────────────────────────
 * Three orthogonal columns decide it, and until 2026-08-18 nothing read all
 * three together:
 *
 *   organizations.subscriptionStatus   — 'active' | 'paused' | 'cancelled' | …
 *   organizations.subscriptionPaused   — the customer's elected 30/60/90-day pause
 *   organizations.dunningStage         — 'none' | 'warning' | 'restricted' | 'suspended'
 *
 * The two newer axes were enforced ONLY in the HTTP path
 * (`subscriptionPauseGate`, `dunningAccessGate`), both chained from the session
 * chokepoint in `getOrCreateOrg` — which a cron by construction never traverses.
 * Fifteen background queries selected organizations with a hand-copied fragment
 * that predates both: `eq(organizations.subscriptionStatus, "active")`.
 *
 * So `subscriptionPauseGate` promised the customer, in its own words, "no new
 * actions allowed (no new mail, no new comps, no Pax messages)" — while
 * `paxNudges` kept minting Pax nudges, `autonomousDealMachine` kept scoring
 * leads AND sending a morning briefing email, and `growthAutomation` /
 * `lifecycleDispatch` kept sending lifecycle and re-engagement mail. To exactly
 * the customers who had been told the product had gone read-only.
 *
 * The axes provably diverge, so this is not a theory:
 *   - `routes-billing.ts` writes ONLY `subscriptionPaused: true` on a pause
 *     ("the webhook will follow up"), leaving `subscriptionStatus` 'active';
 *   - `autonomousHealthMonitor` itself queries
 *     `dunning_stage IN ('warning','restricted') AND subscription_status = 'active'`,
 *     which is the codebase asserting the third axis is independent.
 *
 * ── WHAT THIS IS NOT ────────────────────────────────────────────────────────
 * "May we ACT for this org" is NOT "is this org a live customer". Founder
 * analytics, revenue rollups, outcome analysis and the fair-lending audit must
 * keep counting a paused org — it is still a customer, and a compliance audit
 * that skipped paused accounts would be worse than useless. Those queries
 * deliberately keep their own `subscriptionStatus` filter. Collapsing the two
 * questions into one predicate would be the same class of error in the opposite
 * direction, so `orgOperating.test.ts` pins the split rather than the count.
 *
 * NO NEW COLUMN. This is a read over the three that exist. Adding an
 * `operating` column would create exactly the parallel truth this removes.
 */

import { and, eq, isNull, lt, notInArray, or, type SQL } from "drizzle-orm";
import { organizations } from "@shared/schema";

/** Why AcreOS may not act for an org. `null` means it may. */
export type OrgActRefusal =
  /** The subscription is not active — cancelled, past due, or webhook-paused. */
  | "subscription_inactive"
  /** The customer elected a 30/60/90-day pause. AcreOS is read-only for them. */
  | "subscription_paused"
  /** Payment is past due far enough that the account is read-only. */
  | "dunning_restricted";

/** The three columns that decide it. Deliberately structural, not the ORM row. */
export interface OrgOperatingFacts {
  subscriptionStatus?: string | null;
  subscriptionPaused?: boolean | null;
  /**
   * When the elected pause window closes.
   *
   * An ELAPSED pause is not a pause. `subscriptionPauseGate` already treated it
   * that way — the resume worker runs hourly, so between expiry and the next
   * tick the flag is still true while the customer is entitled to act. Jobs
   * need the same reading, or a customer whose pause ended at 09:05 sits out
   * every background pass until 10:00 for no reason.
   */
  subscriptionPauseEndsAt?: Date | string | null;
  dunningStage?: string | null;
}

/** True when an elected pause is still in force (absent or elapsed = not paused). */
function pauseInForce(facts: OrgOperatingFacts, now: number): boolean {
  if (facts.subscriptionPaused !== true) return false;
  const endsAt = facts.subscriptionPauseEndsAt;
  if (!endsAt) return true;
  return new Date(endsAt).getTime() > now;
}

/**
 * Dunning stages that stop AcreOS acting FOR the customer.
 *
 * Wider than `dunningAccessGate`, which blocks only `restricted`. That gate is
 * careful not to brick a downgraded org's READ access, and `suspended` is
 * handled there by the free-tier downgrade. Taking an outbound action on a
 * suspended account's behalf is a different question with a different answer:
 * we do not send their mail.
 */
const NON_ACTING_DUNNING_STAGES = ["restricted", "suspended"] as const;

/**
 * The refusal, if any. Order is deliberate — the reported reason is the one the
 * customer would recognise, and an elected pause outranks a dunning state
 * because the customer chose it.
 */
export function orgActRefusal(
  facts: OrgOperatingFacts,
  now: number = Date.now(),
): OrgActRefusal | null {
  if (pauseInForce(facts, now)) return "subscription_paused";
  if ((facts.subscriptionStatus ?? "") !== "active") return "subscription_inactive";
  if (NON_ACTING_DUNNING_STAGES.includes((facts.dunningStage ?? "none") as never)) {
    return "dunning_restricted";
  }
  return null;
}

// There is deliberately no `orgMayAct(): boolean` wrapper. One existed, had no
// production consumer — every caller wants the REASON, to log it or to branch on
// which axis refused — and the reachability gate said so. A boolean that throws
// away why is a worse answer, not a more convenient one.

/**
 * The same rule as a Drizzle predicate, for org-selection queries.
 *
 * Every background job that ACTS for a customer selects with this instead of
 * retyping `eq(organizations.subscriptionStatus, "active")` — a hand-copied
 * fragment of a rule goes stale the day the rule grows another axis, which is
 * exactly how these three drifted apart.
 */
export function orgMayActFilter(): SQL {
  return and(
    eq(organizations.subscriptionStatus, "active"),
    or(
      isNull(organizations.subscriptionPaused),
      eq(organizations.subscriptionPaused, false),
      // An elapsed pause is not a pause — see `pauseInForce`.
      lt(organizations.subscriptionPauseEndsAt, new Date()),
    ),
    or(
      isNull(organizations.dunningStage),
      notInArray(organizations.dunningStage, [...NON_ACTING_DUNNING_STAGES]),
    ),
  ) as SQL;
}

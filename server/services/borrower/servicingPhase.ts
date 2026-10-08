/**
 * What AcreOS still does for a lender's borrowers after the lender's
 * subscription ends (founder ruling 2026-09-29 #3, DEFECT-0106).
 *
 * Before this, the borrower money paths disagreed: periodic statements ran
 * only for `subscription_status = 'active'` orgs, while ACH autopay and the
 * portal card routes ignored the lender's subscription entirely. A cancelled
 * lender's borrower kept being debited while their statements stopped — and a
 * paused or past-due lender's borrowers lost their statements too.
 *
 * The ruling is one policy for every path:
 *  - `full` — the lender's subscription has not ended (active, trialing,
 *    past_due, paused, …). Everything runs. A billing problem between the
 *    lender and AcreOS is not the borrower's.
 *  - `wind_down` — for 90 days after it ended, autopay, the portal and
 *    periodic statements continue, and the lender is told to export or move
 *    the book.
 *  - `ended` — after 90 days no NEW debit or card payment starts; borrowers
 *    are told to pay the lender directly. Money already in flight still
 *    reconciles, and the borrower can still sign in and read their records.
 *
 * The clock starts at `organizations.subscription_ended_at`, stamped by every
 * writer that ends a subscription (`subscriptionEndedPatch`). A lender that
 * was already cancelled before the column existed has no stamp; it is stamped
 * NOW on first sight, so every party gets the full 90 days of notice rather
 * than having it retroactively spent.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { organizations } from "@shared/schema";
import { db } from "../../db";
import { clock } from "../../utils/clock";

export const WIND_DOWN_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Statuses meaning the lender's AcreOS subscription has ended: cancelled
 * (AcreOS spelling), canceled (Stripe's, written raw by the support resync),
 * and an incomplete subscription that expired unpaid (`expired` as mapped by
 * the webhook, `incomplete_expired` raw). `unpaid` and `past_due` are billing
 * problems dunning is still working, not ends.
 */
export const SUBSCRIPTION_ENDED_STATUSES = ["cancelled", "canceled", "expired", "incomplete_expired"] as const;

export type ServicingPhase =
  | { phase: "full" }
  | { phase: "wind_down" | "ended"; endedAt: Date; windDownEndsAt: Date };

export function subscriptionHasEnded(status: string | null | undefined): boolean {
  return (SUBSCRIPTION_ENDED_STATUSES as readonly string[]).includes(status ?? "");
}

/** The pure rule. `endedAt` must be stamped for an ended subscription. */
export function servicingPhaseFor(
  org: { subscriptionStatus: string | null; subscriptionEndedAt: Date | null },
  now: Date,
): ServicingPhase {
  if (!subscriptionHasEnded(org.subscriptionStatus) || !org.subscriptionEndedAt) return { phase: "full" };
  const endedAt = org.subscriptionEndedAt;
  const windDownEndsAt = new Date(endedAt.getTime() + WIND_DOWN_DAYS * DAY_MS);
  return { phase: now < windDownEndsAt ? "wind_down" : "ended", endedAt, windDownEndsAt };
}

/**
 * What every writer that ends a subscription sets, in the same write. A later
 * cancel restarts the clock; the notices are keyed on this date
 * (`servicingWindDown.ts`), so they go out again for the new end.
 */
export function subscriptionEndedPatch(now: Date = clock.now()): { subscriptionEndedAt: Date } {
  return { subscriptionEndedAt: now };
}

/**
 * Stamp every ended subscription that has no end date yet (lenders cancelled
 * before the column existed). Idempotent: only NULL stamps are written.
 */
export async function stampUnstampedSubscriptionEnds(now: Date = clock.now()): Promise<number> {
  const stamped = await db
    .update(organizations)
    .set({ subscriptionEndedAt: now })
    .where(
      and(
        inArray(organizations.subscriptionStatus, [...SUBSCRIPTION_ENDED_STATUSES]),
        isNull(organizations.subscriptionEndedAt),
      ),
    )
    .returning({ id: organizations.id });
  return stamped.length;
}

/** The phase for one lender, stamping a legacy end on first sight. */
export async function lenderServicingPhase(organizationId: number, now: Date = clock.now()): Promise<ServicingPhase> {
  const [org] = await db
    .select({ subscriptionStatus: organizations.subscriptionStatus, subscriptionEndedAt: organizations.subscriptionEndedAt })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!org) return { phase: "full" };
  if (subscriptionHasEnded(org.subscriptionStatus) && !org.subscriptionEndedAt) {
    // Stamp only a NULL stamp; if a concurrent caller won, read theirs, so
    // both agree on one date.
    const [row] = await db
      .update(organizations)
      .set({ subscriptionEndedAt: now })
      .where(and(eq(organizations.id, organizationId), isNull(organizations.subscriptionEndedAt)))
      .returning({ subscriptionEndedAt: organizations.subscriptionEndedAt });
    let endedAt = row?.subscriptionEndedAt ?? null;
    if (!endedAt) {
      const [again] = await db
        .select({ subscriptionEndedAt: organizations.subscriptionEndedAt })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);
      endedAt = again?.subscriptionEndedAt ?? now;
    }
    return servicingPhaseFor({ ...org, subscriptionEndedAt: endedAt }, now);
  }
  return servicingPhaseFor(org, now);
}

/**
 * The lenders whose borrowers AcreOS still services: every org except those
 * whose wind-down is over. The periodic-statements job reads this (it used to
 * select `subscription_status = 'active'` alone).
 */
export async function orgsStillServiced(now: Date = clock.now()): Promise<number[]> {
  await stampUnstampedSubscriptionEnds(now);
  const all = await db
    .select({
      id: organizations.id,
      subscriptionStatus: organizations.subscriptionStatus,
      subscriptionEndedAt: organizations.subscriptionEndedAt,
    })
    .from(organizations);
  return all.filter((o) => servicingPhaseFor(o, now).phase !== "ended").map((o) => o.id);
}

/** What a borrower is told when a new payment is refused in the `ended` phase. */
export function servicingEndedBorrowerMessage(lenderName: string | null): string {
  const who = lenderName || "your lender";
  return `${who} no longer services this loan through AcreOS, so payments can't be made here. Please contact ${who} and pay them directly. Your payment history on this portal is unchanged.`;
}

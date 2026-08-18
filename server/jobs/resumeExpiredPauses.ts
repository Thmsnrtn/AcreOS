/**
 * Tahoe E11 — resume expired subscription pauses.
 *
 * Hourly defensive double-write alongside the `customer.subscription.resumed`
 * webhook. Stripe auto-resumes collection when `pause_collection.resumes_at`
 * passes, but if that webhook is missed — or the pause was set without a Stripe
 * subscription, on a manual or trial org — this clears the DB pause so
 * `subscriptionPauseGate` stops 402-ing the customer. Bounded 500/tick.
 *
 * ── WHY IT LIVES HERE AND NOT IN runScheduledJobs.ts ────────────────────────
 * That file is under a line-count ratchet that may only shrink, because it is a
 * monolith being taken apart. Fixing the half-resume below needed a guard and
 * the reasoning for it, and adding either to the monolith would have pushed the
 * count up. Extracting the body is what the ratchet is asking for: the caller
 * keeps the schedule, the work moves out, and the file gets smaller rather than
 * larger.
 *
 * ── THE HALF-RESUME ─────────────────────────────────────────────────────────
 * This cleared the four pause columns and left `subscriptionStatus` alone.
 * `routes-billing` pauses by writing only `subscriptionPaused`, so that was
 * complete for its case — but `webhookHandlers` writes
 * `subscriptionStatus: 'paused'`, and nothing put it back. A customer whose
 * pause expired stayed 'paused' FOREVER to every background job that filters on
 * the status, while the product told them they had resumed. Half a resume is
 * worse than none: it is invisible from both sides.
 */

import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { organizations } from "@shared/schema";

/** Injected so the caller keeps owning how this job logs. */
export interface ResumeExpiredPausesDeps {
  logLine: (message: string, tag: string) => void;
}

export interface ResumeExpiredPausesResult {
  expired: number;
  resumed: number;
}

/**
 * Clear every pause whose window has closed. Pure of scheduling — the caller
 * owns the interval and the job lock.
 */
export async function resumeExpiredPauses(
  deps: ResumeExpiredPausesDeps,
): Promise<ResumeExpiredPausesResult> {
  const { logLine } = deps;
  const now = new Date();
  const expired = await db
    .select({
      id: organizations.id,
      stripeSubscriptionId: organizations.stripeSubscriptionId,
      // Needed to decide whether the resume must also lift a webhook-written
      // 'paused' status — see the update below.
      subscriptionStatus: organizations.subscriptionStatus,
    })
    .from(organizations)
    .where(sql`
      ${organizations.subscriptionPaused} = true
      AND ${organizations.subscriptionPauseEndsAt} IS NOT NULL
      AND ${organizations.subscriptionPauseEndsAt} <= ${now}
    `)
    .limit(500);

  let resumed = 0;
  for (const org of expired) {
    try {
      if (org.stripeSubscriptionId) {
        try {
          const { stripeService } = await import('../stripeService');
          await stripeService.resumeSubscription(org.stripeSubscriptionId);
        } catch (stripeErr) {
          // Stripe resume is best-effort; the DB clear below is what
          // un-gates the customer. Stripe also auto-resumes on resumes_at.
          logLine(`[pause-resume] org ${org.id} stripe resume failed: ${stripeErr}`, 'pause-resume');
        }
      }
      // RESTORE THE STATUS TOO, or the resume only half-happens.
      //
      // This cleared the four pause columns and left `subscriptionStatus`
      // alone. That is fine when the pause was written by routes-billing,
      // which sets only `subscriptionPaused` — but webhookHandlers.ts:967
      // writes `subscriptionStatus: 'paused'`, and nothing put it back. A
      // customer whose pause expired was then 'paused' FOREVER to every
      // background job that filters on the status, while the product told
      // them they had resumed. Half a resume is worse than none: it is
      // invisible from both sides.
      //
      // Only lifts the status when it is exactly 'paused'. A subscription
      // that went 'cancelled' or 'past_due' during the pause must keep that
      // state — this worker ends a pause, it does not grant a subscription.
      await db.update(organizations)
        .set({
          subscriptionPaused: false,
          subscriptionPausedAt: null,
          subscriptionPauseEndsAt: null,
          subscriptionPauseReason: null,
          ...(org.subscriptionStatus === "paused"
            ? { subscriptionStatus: "active" as const }
            : {}),
        })
        .where(eq(organizations.id, org.id));
      resumed++;
    } catch (rowErr) {
      logLine(`[pause-resume] org ${org.id} resume failed: ${rowErr}`, 'pause-resume');
    }
  }

  if (expired.length > 0) {
    logLine(`[pause-resume] hourly run: expired=${expired.length} resumed=${resumed}`, 'pause-resume');
  }
  return { expired: expired.length, resumed };
}

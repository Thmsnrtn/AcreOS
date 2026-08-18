/**
 * lifecycleDispatch.ts — Tier 2C (elevation blueprint 2026-06-10): light the
 * growth machinery.
 *
 * The lifecycle template registry (shared/lifecycle/messages.ts) and the
 * compliant send pipeline (lifecycleProgram.sendLifecycleMessage → outbox →
 * worker lifecycle_email handler → emailService with CAN-SPAM footer +
 * List-Unsubscribe + suppression checks) both existed — but NOTHING ever
 * called sendLifecycleMessage for the journey templates. This job is the
 * missing dispatcher. It starts with the three highest-leverage keys:
 *
 *   d7_check_in            — T+7d from org create, active orgs. Reply-based
 *                            "is anything in the way?" check-in.
 *   d30_nps                — T+30d from the FIRST PAID EVENT (the
 *                            `first_payment_processed` activation event the
 *                            Stripe webhook already records idempotently).
 *   cancellation_reason_ask — T+0 from cancel. The Stripe webhook
 *                            (processSubscriptionCancelled) dispatches this
 *                            immediately via dispatchLifecycleOnce(); this
 *                            job is the daily catch-up for cancels whose
 *                            webhook-side dispatch failed, bounded to a
 *                            7-day updated_at window so it can never mail
 *                            an org that cancelled months ago.
 *
 * EVERY send goes through sendLifecycleMessage — never raw SMTP — so
 * suppression lists, the win-back throttle, the lifecycle_message_sends
 * audit trail, and the CAN-SPAM-compliant transport all apply.
 *
 * Idempotency: one send per (org, templateKey), EVER, enforced by checking
 * lifecycle_message_sends before dispatch. Any prior row — including
 * suppressed/skipped — blocks a resend: a suppressed recipient must not be
 * re-attempted, and a skipped send means another code path already judged
 * the org ineligible.
 *
 * Eligibility windows are CLOSED on both ends (e.g. d7 fires between day 7
 * and day 14). The lower bound is the trigger; the upper bound means a
 * fresh deploy onto a year-old database can never carpet-bomb every old org
 * with "How's your first week?" — orgs already past the window are simply
 * skipped forever.
 */

import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "../db";
import {
  organizations,
  activationEvents,
  churnReasons,
  lifecycleMessageSends,
} from "@shared/schema";
import { users } from "@shared/models/auth";
import { sendLifecycleMessage } from "../services/lifecycleProgram";
import { logger } from "../utils/logger";
import { orgMayActFilter } from "../services/orgOperating";

const APP_URL = process.env.APP_URL || "https://app.acreos.io";
const DAY_MS = 24 * 60 * 60 * 1000;

// ── Eligibility windows (exported for the unit tests) ──────────────────────
export const D7_WINDOW_DAYS = { min: 7, max: 14 } as const;
export const D30_WINDOW_DAYS = { min: 30, max: 44 } as const;
export const CANCEL_CATCHUP_WINDOW_DAYS = 7;

export const DISPATCHED_KEYS = [
  "d7_check_in",
  "d30_nps",
  "cancellation_reason_ask",
] as const;
export type DispatchedKey = (typeof DISPATCHED_KEYS)[number];

/** Everything the eligibility rules need to know about one org. Pure data —
 *  the selection functions below take this and a clock, nothing else, so the
 *  unit tests can exercise every window edge without a database. */
export interface LifecycleOrgFacts {
  organizationId: number;
  /** organizations.created_at */
  createdAt: Date | null;
  /** organizations.updated_at — proxy for "when did the cancel land" on
   *  cancelled orgs (there is no cancelled_at column). */
  updatedAt: Date | null;
  /** organizations.subscription_status ('active' | 'cancelled' | …) */
  subscriptionStatus: string | null;
  /** occurred_at of the org's first_payment_processed activation event,
   *  i.e. the first paid event witnessed by the Stripe webhook. */
  firstPaidAt: Date | null;
  /** true when a churn_reasons row exists — the customer already told us
   *  why they left via the in-app cancel survey; don't ask again. */
  hasChurnReason: boolean;
  /** templateKeys with ANY lifecycle_message_sends row for this org. */
  priorSends: ReadonlySet<string>;
}

function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / DAY_MS;
}

/** d7_check_in: active org, created 7–14 days ago, never sent. */
export function isD7CheckInEligible(facts: LifecycleOrgFacts, now: Date): boolean {
  if (facts.priorSends.has("d7_check_in")) return false;
  if (facts.subscriptionStatus !== "active") return false;
  if (!facts.createdAt) return false;
  const age = daysBetween(facts.createdAt, now);
  return age >= D7_WINDOW_DAYS.min && age <= D7_WINDOW_DAYS.max;
}

/** d30_nps: active org, first paid event 30–44 days ago, never sent. */
export function isD30NpsEligible(facts: LifecycleOrgFacts, now: Date): boolean {
  if (facts.priorSends.has("d30_nps")) return false;
  if (facts.subscriptionStatus !== "active") return false;
  if (!facts.firstPaidAt) return false;
  const sincePaid = daysBetween(facts.firstPaidAt, now);
  return sincePaid >= D30_WINDOW_DAYS.min && sincePaid <= D30_WINDOW_DAYS.max;
}

/** cancellation_reason_ask (catch-up path): cancelled org touched within the
 *  last 7 days, no in-app exit-survey answer, never sent. */
export function isCancellationAskEligible(
  facts: LifecycleOrgFacts,
  now: Date,
): boolean {
  if (facts.priorSends.has("cancellation_reason_ask")) return false;
  if (facts.subscriptionStatus !== "cancelled") return false;
  if (facts.hasChurnReason) return false;
  if (!facts.updatedAt) return false;
  return daysBetween(facts.updatedAt, now) <= CANCEL_CATCHUP_WINDOW_DAYS;
}

/** All keys this org is currently due for. */
export function eligibleLifecycleKeys(
  facts: LifecycleOrgFacts,
  now: Date,
): DispatchedKey[] {
  const keys: DispatchedKey[] = [];
  if (isD7CheckInEligible(facts, now)) keys.push("d7_check_in");
  if (isD30NpsEligible(facts, now)) keys.push("d30_nps");
  if (isCancellationAskEligible(facts, now)) keys.push("cancellation_reason_ask");
  return keys;
}

/** Placeholder map per key — {npsUrl} is the only substitution the three
 *  launch templates need (cancellation_reason_ask v2 is reply-based). */
export function placeholdersFor(key: DispatchedKey): Record<string, string> {
  // Same destination the registry's nps_prompt email uses — the in-app NPS
  // dialog (queued by nps_prompt_scheduler) takes over after login.
  if (key === "d30_nps") return { npsUrl: `${APP_URL}/today?nps=1` };
  return {};
}

// ── Shared once-only dispatch (used here AND by the Stripe webhook) ────────

/**
 * Send `templateKey` to the org's owner exactly once, ever. Checks
 * lifecycle_message_sends for ANY prior row first; the webhook T+0 path and
 * this daily catch-up both funnel through here so they can never double-send.
 * Best-effort: returns the outcome, never throws into the caller.
 */
export async function dispatchLifecycleOnce(params: {
  templateKey: DispatchedKey;
  organizationId: number;
  recipientEmail: string;
  userId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<{ dispatched: boolean; reason?: string }> {
  const { templateKey, organizationId, recipientEmail, userId, metadata } = params;
  try {
    const prior = await db
      .select({ id: lifecycleMessageSends.id })
      .from(lifecycleMessageSends)
      .where(
        and(
          eq(lifecycleMessageSends.organizationId, organizationId),
          eq(lifecycleMessageSends.templateKey, templateKey),
        ),
      )
      .limit(1);
    if (prior.length > 0) return { dispatched: false, reason: "already_sent" };

    const result = await sendLifecycleMessage({
      templateKey,
      organizationId,
      userId: userId ?? null,
      recipientEmail,
      placeholders: placeholdersFor(templateKey),
      metadata: { dispatcher: "lifecycleDispatch", ...(metadata ?? {}) },
    });
    return {
      dispatched: result.status === "queued",
      reason: result.status === "queued" ? undefined : (result.reason ?? result.status),
    };
  } catch (err) {
    logger.warn("[lifecycleDispatch] dispatchLifecycleOnce failed", {
      metadata: {
        templateKey,
        organizationId,
        error: err instanceof Error ? err.message : String(err),
      },
    });
    return { dispatched: false, reason: "dispatch_error" };
  }
}

// ── The daily sweep ─────────────────────────────────────────────────────────

interface SweepCounters {
  candidates: number;
  dispatched: number;
  skipped: number;
  noOwnerEmail: number;
  errors: number;
}

/** Resolve the org owner's email (organizations.owner_id is the Clerk user
 *  id; users.clerk_user_id links back). */
async function ownerEmailOf(ownerId: string | null): Promise<{ email: string; userId: string } | null> {
  if (!ownerId) return null;
  const [owner] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.clerkUserId, ownerId))
    .limit(1);
  if (!owner?.email) return null;
  return { email: owner.email, userId: owner.id };
}

/**
 * One daily pass. Three bounded candidate queries (one per template key),
 * facts assembly, pure eligibility, then once-only dispatch per (org, key).
 */
export async function runLifecycleDispatch(now: Date = new Date()): Promise<SweepCounters> {
  const counters: SweepCounters = {
    candidates: 0,
    dispatched: 0,
    skipped: 0,
    noOwnerEmail: 0,
    errors: 0,
  };

  // 1. d7 candidates: active orgs created inside the window.
  const d7Lo = new Date(now.getTime() - D7_WINDOW_DAYS.max * DAY_MS);
  const d7Hi = new Date(now.getTime() - D7_WINDOW_DAYS.min * DAY_MS);
  const d7Orgs = await db
    .select({
      id: organizations.id,
      ownerId: organizations.ownerId,
      createdAt: organizations.createdAt,
      updatedAt: organizations.updatedAt,
      subscriptionStatus: organizations.subscriptionStatus,
    })
    .from(organizations)
    .where(
      and(
        orgMayActFilter(),
        gte(organizations.createdAt, d7Lo),
        lte(organizations.createdAt, d7Hi),
      ),
    )
    .limit(500);

  // 2. d30 candidates: first_payment_processed inside the window, org active.
  const d30Lo = new Date(now.getTime() - D30_WINDOW_DAYS.max * DAY_MS);
  const d30Hi = new Date(now.getTime() - D30_WINDOW_DAYS.min * DAY_MS);
  const paidRows = await db
    .select({
      organizationId: activationEvents.organizationId,
      occurredAt: activationEvents.occurredAt,
    })
    .from(activationEvents)
    .where(
      and(
        eq(activationEvents.eventName, "first_payment_processed"),
        gte(activationEvents.occurredAt, d30Lo),
        lte(activationEvents.occurredAt, d30Hi),
      ),
    )
    .limit(500);
  const firstPaidByOrg = new Map<number, Date>();
  for (const r of paidRows) {
    if (r.occurredAt) firstPaidByOrg.set(r.organizationId, new Date(r.occurredAt));
  }
  const d30Orgs = firstPaidByOrg.size
    ? await db
        .select({
          id: organizations.id,
          ownerId: organizations.ownerId,
          createdAt: organizations.createdAt,
          updatedAt: organizations.updatedAt,
          subscriptionStatus: organizations.subscriptionStatus,
        })
        .from(organizations)
        .where(inArray(organizations.id, [...firstPaidByOrg.keys()]))
    : [];

  // 3. Cancellation catch-up: cancelled orgs touched in the last 7 days.
  const cancelLo = new Date(now.getTime() - CANCEL_CATCHUP_WINDOW_DAYS * DAY_MS);
  const cancelledOrgs = await db
    .select({
      id: organizations.id,
      ownerId: organizations.ownerId,
      createdAt: organizations.createdAt,
      updatedAt: organizations.updatedAt,
      subscriptionStatus: organizations.subscriptionStatus,
    })
    .from(organizations)
    .where(
      and(
        eq(organizations.subscriptionStatus, "cancelled"),
        gte(organizations.updatedAt, cancelLo),
      ),
    )
    .limit(500);

  // Merge candidates (an org can appear in multiple buckets).
  type OrgRow = (typeof d7Orgs)[number];
  const byId = new Map<number, OrgRow>();
  for (const o of [...d7Orgs, ...d30Orgs, ...cancelledOrgs]) byId.set(o.id, o);
  const orgIds = [...byId.keys()];
  counters.candidates = orgIds.length;
  if (orgIds.length === 0) return counters;

  // Prior sends for all candidates in one query.
  const priorRows = await db
    .select({
      organizationId: lifecycleMessageSends.organizationId,
      templateKey: lifecycleMessageSends.templateKey,
    })
    .from(lifecycleMessageSends)
    .where(
      and(
        inArray(lifecycleMessageSends.organizationId, orgIds),
        inArray(lifecycleMessageSends.templateKey, [...DISPATCHED_KEYS]),
      ),
    );
  const priorByOrg = new Map<number, Set<string>>();
  for (const r of priorRows) {
    let set = priorByOrg.get(r.organizationId);
    if (!set) priorByOrg.set(r.organizationId, (set = new Set()));
    set.add(r.templateKey);
  }

  // churn_reasons presence for the cancelled bucket.
  const cancelledIds = cancelledOrgs.map((o) => o.id);
  const churnReasonOrgIds = new Set<number>();
  if (cancelledIds.length > 0) {
    const reasonRows = await db
      .select({ organizationId: churnReasons.organizationId })
      .from(churnReasons)
      .where(inArray(churnReasons.organizationId, cancelledIds));
    for (const r of reasonRows) churnReasonOrgIds.add(r.organizationId);
  }

  for (const org of byId.values()) {
    const facts: LifecycleOrgFacts = {
      organizationId: org.id,
      createdAt: org.createdAt ? new Date(org.createdAt) : null,
      updatedAt: org.updatedAt ? new Date(org.updatedAt) : null,
      subscriptionStatus: org.subscriptionStatus,
      firstPaidAt: firstPaidByOrg.get(org.id) ?? null,
      hasChurnReason: churnReasonOrgIds.has(org.id),
      priorSends: priorByOrg.get(org.id) ?? new Set(),
    };
    const due = eligibleLifecycleKeys(facts, now);
    if (due.length === 0) {
      counters.skipped++;
      continue;
    }
    try {
      const owner = await ownerEmailOf(org.ownerId);
      if (!owner) {
        counters.noOwnerEmail++;
        continue;
      }
      for (const key of due) {
        const result = await dispatchLifecycleOnce({
          templateKey: key,
          organizationId: org.id,
          recipientEmail: owner.email,
          userId: owner.userId,
          metadata: { trigger: "daily_sweep" },
        });
        if (result.dispatched) counters.dispatched++;
        else counters.skipped++;
      }
    } catch (err) {
      counters.errors++;
      logger.warn("[lifecycleDispatch] per-org dispatch failed", {
        metadata: {
          organizationId: org.id,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  logger.info("[lifecycleDispatch] sweep complete", { metadata: { ...counters } });
  return counters;
}

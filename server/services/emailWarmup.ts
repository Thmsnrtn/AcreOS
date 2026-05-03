/**
 * emailWarmup — per-org IP warmup ramp + daily-limit enforcement.
 *
 * Eleonora deliverability foundation (Phase 1 §10 / Week 7-8).
 *
 * Inboxes punish a fresh sending identity that goes from zero to thousands
 * of messages overnight. The standard mitigation is a multi-day "warmup":
 * a slowly increasing daily cap that gives the receiving infrastructure
 * time to learn the sender's reputation. The ramp below is the
 * SparkPost/SendGrid published default, scaled to a single tenant:
 *
 *   day 1:    50
 *   day 2:   100
 *   day 3:   500
 *   day 4:  1000
 *   day 5:  5000
 *   day 6:  5000
 *   day 7+ 10000 (warmup complete)
 *
 * Enforcement happens at send time: emailService calls reserveSend(orgId)
 * before dispatching to SES; if the org has hit its daily limit the call
 * returns { ok: false } and the email is rejected (campaign) or queued
 * for the next reset (transactional, future hook).
 */

import { db } from "../db";
import { emailWarmupState } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { logger } from "../utils/logger";

export const WARMUP_RAMP: ReadonlyArray<{ day: number; limit: number }> = [
  { day: 1, limit: 50 },
  { day: 2, limit: 100 },
  { day: 3, limit: 500 },
  { day: 4, limit: 1000 },
  { day: 5, limit: 5000 },
  { day: 6, limit: 5000 },
  { day: 7, limit: 10000 },
];

export const POST_WARMUP_LIMIT = 10000;

export function limitForDay(daysSinceFirstSend: number): number {
  // Day index is 1-based on the public ramp (day 1 = first day of sending).
  // Internally we work with `daysSinceFirstSend` where 0 = same day as the
  // first send. So `effectiveDay = daysSinceFirstSend + 1`.
  const effectiveDay = Math.max(1, daysSinceFirstSend + 1);
  if (effectiveDay >= 7) return POST_WARMUP_LIMIT;
  const entry = WARMUP_RAMP.find((r) => r.day === effectiveDay);
  return entry ? entry.limit : WARMUP_RAMP[0].limit;
}

function startOfUtcDay(d: Date = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function diffInDaysUtc(from: Date, to: Date): number {
  const ms = startOfUtcDay(to).getTime() - startOfUtcDay(from).getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

export interface ReserveResult {
  ok: boolean;
  /** The current daily cap for this org. */
  dailyLimit: number;
  /** How many sends have been booked today (including this one if ok=true). */
  used: number;
  /** UTC timestamp at which `used` resets to 0. */
  resetAt: Date;
  /** Day-of-warmup (1-based). >= 7 means warmup complete. */
  warmupDay: number;
  /** Reason for refusal when ok=false. */
  reason?: "limit_exceeded";
}

/**
 * Atomically book one outbound send against the org's warmup budget.
 *
 * The call rolls the day if `currentDayResetAt` is in the past, recomputes
 * the daily limit from `daysSinceFirstSend`, and increments `currentDayUsed`
 * by one — all in a single statement so concurrent senders can't race past
 * the cap. Returns ok=false (without incrementing) if the cap is hit.
 *
 * For brand-new orgs the row is inserted with day-1 defaults on first call.
 */
export async function reserveSend(organizationId: number, now: Date = new Date()): Promise<ReserveResult> {
  // Insert if missing — first send for this org. firstSendAt = now.
  await db
    .insert(emailWarmupState)
    .values({
      organizationId,
      firstSendAt: now,
      daysSinceFirstSend: 0,
      dailySendLimit: limitForDay(0),
      currentDayUsed: 0,
      currentDayResetAt: new Date(startOfUtcDay(now).getTime() + 24 * 60 * 60 * 1000),
      warmupComplete: false,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: emailWarmupState.organizationId });

  // Read current state.
  const rows = await db
    .select()
    .from(emailWarmupState)
    .where(eq(emailWarmupState.organizationId, organizationId))
    .limit(1);
  if (rows.length === 0) {
    // Should be impossible after the insert, but fail closed to keep callers safe.
    return {
      ok: false,
      dailyLimit: 0,
      used: 0,
      resetAt: new Date(startOfUtcDay(now).getTime() + 24 * 60 * 60 * 1000),
      warmupDay: 1,
      reason: "limit_exceeded",
    };
  }
  let row = rows[0];

  // Day rollover. If now >= currentDayResetAt, recompute days-since-first-send,
  // update daily_send_limit, zero current_day_used, advance reset_at.
  if (now >= row.currentDayResetAt) {
    const firstSendAt = row.firstSendAt ?? now;
    const newDays = diffInDaysUtc(firstSendAt, now);
    const newLimit = limitForDay(newDays);
    const newReset = new Date(startOfUtcDay(now).getTime() + 24 * 60 * 60 * 1000);
    const updated = await db
      .update(emailWarmupState)
      .set({
        daysSinceFirstSend: newDays,
        dailySendLimit: newLimit,
        currentDayUsed: 0,
        currentDayResetAt: newReset,
        warmupComplete: newDays + 1 >= 7,
        updatedAt: now,
      })
      .where(eq(emailWarmupState.organizationId, organizationId))
      .returning();
    if (updated.length > 0) row = updated[0];
  }

  // Cap check + atomic increment. The WHERE clause only matches when there's
  // headroom; if not, the UPDATE is a no-op and we return limit_exceeded.
  const incremented = await db
    .update(emailWarmupState)
    .set({
      currentDayUsed: sql`${emailWarmupState.currentDayUsed} + 1`,
      updatedAt: now,
    })
    .where(
      sql`${emailWarmupState.organizationId} = ${organizationId} AND ${emailWarmupState.currentDayUsed} < ${emailWarmupState.dailySendLimit}`,
    )
    .returning();

  if (incremented.length === 0) {
    logger.warn("[emailWarmup] daily limit reached", {
      metadata: {
        organizationId,
        dailyLimit: row.dailySendLimit,
        used: row.currentDayUsed,
        warmupDay: row.daysSinceFirstSend + 1,
      },
    });
    return {
      ok: false,
      dailyLimit: row.dailySendLimit,
      used: row.currentDayUsed,
      resetAt: row.currentDayResetAt,
      warmupDay: row.daysSinceFirstSend + 1,
      reason: "limit_exceeded",
    };
  }

  const updated = incremented[0];
  return {
    ok: true,
    dailyLimit: updated.dailySendLimit,
    used: updated.currentDayUsed,
    resetAt: updated.currentDayResetAt,
    warmupDay: updated.daysSinceFirstSend + 1,
  };
}

/** Read-only view of warmup state, for the founder dashboard. */
export async function getWarmupState(organizationId: number) {
  const rows = await db
    .select()
    .from(emailWarmupState)
    .where(eq(emailWarmupState.organizationId, organizationId))
    .limit(1);
  return rows[0] ?? null;
}

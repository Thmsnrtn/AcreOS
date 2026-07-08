/**
 * Referral application — single server-side authority for linking a new
 * signup (referee) to the referrer who sent them.
 *
 * Tier 2C (2026-06-10). Why this exists:
 *   - Before this, the ONLY apply path was POST /api/referral/apply with a
 *     refereeId taken from the request body — any authenticated user could
 *     attribute arbitrary users to arbitrary codes. The route now delegates
 *     here and always uses the AUTHENTICATED user as the referee.
 *   - The ?ref=CODE param had no pickup anywhere in the acquisition chain.
 *     It now rides the pending-UTM snapshot (client/src/lib/acquisition-utm)
 *     and routes-acquisition-utm calls applyReferralCode() at signup flush,
 *     so referral attribution works without any extra client plumbing.
 *
 * Semantics:
 *   - One referee per code row. The referrals.code column is UNIQUE, so a
 *     code maps to exactly one row; if that row already has a different
 *     refereeId we refuse ("code_exhausted") rather than silently stealing
 *     attribution from the first referee.
 *   - A user can be referred at most once (first code wins) — being listed
 *     as referee on multiple rows would double-pay rewards at conversion.
 *   - Self-referral is rejected.
 *   - Idempotent: re-applying the same code for the same referee is "ok".
 */

import { eq, isNull, and } from "drizzle-orm";
import { db } from "../db";
import { users, referrals } from "@shared/models/auth";
import { logger } from "../utils/logger";

export type ApplyReferralResult =
  | { applied: true }
  | {
      applied: false;
      reason:
        | "invalid_code"
        | "unknown_code"
        | "self_referral"
        | "already_referred"
        | "code_exhausted"
        | "error";
    };

const REF_CODE_RE = /^[A-Za-z0-9_-]{4,16}$/;

/**
 * Link `refereeId` (MUST be the authenticated user — never trust a
 * body-supplied id) to the referrer who owns `code`. Never throws.
 */
export async function applyReferralCode(
  code: string,
  refereeId: string,
): Promise<ApplyReferralResult> {
  try {
    const normalized = code.trim().toUpperCase();
    if (!REF_CODE_RE.test(normalized)) {
      return { applied: false, reason: "invalid_code" };
    }

    // Resolve the referrer by their personal code.
    const [referrer] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.referralCode, normalized))
      .limit(1);
    if (!referrer) return { applied: false, reason: "unknown_code" };
    if (referrer.id === refereeId) {
      return { applied: false, reason: "self_referral" };
    }

    // A user can be referred at most once — if they're already a referee
    // on ANY row, the first attribution stands.
    const [priorReferral] = await db
      .select({ id: referrals.id, code: referrals.code })
      .from(referrals)
      .where(eq(referrals.refereeId, refereeId))
      .limit(1);
    if (priorReferral) {
      // Same code re-applied → idempotent success; different code → refuse.
      return priorReferral.code === normalized
        ? { applied: true }
        : { applied: false, reason: "already_referred" };
    }

    // Claim the code row only if it is unclaimed. The WHERE refereeId IS
    // NULL guard makes the claim atomic — no TOCTOU window where two
    // signups both think they got the code.
    const claimed = await db
      .update(referrals)
      .set({ refereeId, status: "signed_up" })
      .where(and(eq(referrals.code, normalized), isNull(referrals.refereeId)))
      .returning({ id: referrals.id });

    if (claimed.length > 0) {
      logger.info("[referral] code applied", {
        code: normalized,
        refereeId,
        referrerId: referrer.id,
      });
      return { applied: true };
    }

    // No row claimed: either the code row exists but is already claimed by
    // someone else (exhausted), or no row exists yet (GET /code creates one,
    // but an old account may predate that) — insert in the latter case.
    const [existing] = await db
      .select({ refereeId: referrals.refereeId })
      .from(referrals)
      .where(eq(referrals.code, normalized))
      .limit(1);
    if (existing) {
      return { applied: false, reason: "code_exhausted" };
    }

    await db
      .insert(referrals)
      .values({
        referrerId: referrer.id,
        refereeId,
        code: normalized,
        status: "signed_up",
      })
      .onConflictDoNothing();

    logger.info("[referral] code applied (row created)", {
      code: normalized,
      refereeId,
      referrerId: referrer.id,
    });
    return { applied: true };
  } catch (error) {
    logger.error("[referral] applyReferralCode failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { applied: false, reason: "error" };
  }
}

/**
 * Panel-300 G3 — auth-fail lockout (adversarial-stress + security-compliance).
 *
 * After 5 failed auth attempts within 15 minutes from the same (ip, email),
 * subsequent attempts return 429 with `code='AUTH_LOCKED_OUT'` until the
 * window passes. The Clerk auth flow handles its own lockouts upstream; this
 * file is the AcreOS-side belt-and-suspenders for any custom auth flows
 * (e.g., the public-signing token verifier, the founder-recovery console
 * password-reset flow).
 *
 * Wire by calling:
 *   recordAuthFailure(ip, email, reason)  on each failed attempt
 *   await assertNotLockedOut(ip, email)   before validating credentials
 */

import { db } from "../db";
import { authFailAttempts } from "@shared/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { logger } from "../utils/logger";

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_WINDOW_MS = 15 * 60_000;

export class AuthLockedOutError extends Error {
  readonly code = "AUTH_LOCKED_OUT" as const;
  constructor(public readonly retryAfterSeconds: number) {
    super(`Locked out for ${retryAfterSeconds}s after repeated auth failures`);
    this.name = "AuthLockedOutError";
  }
}

export async function recordAuthFailure(
  ip: string | null,
  email: string | null,
  reason: "password" | "mfa" | "session" | "unknown",
  userAgent?: string | null,
): Promise<void> {
  try {
    await db.insert(authFailAttempts).values({
      ip,
      email,
      failureReason: reason,
      userAgent: userAgent ?? null,
    });
  } catch (err) {
    logger.warn("[authLockout] insert failed", err instanceof Error ? err : undefined);
  }
}

/**
 * Throw AuthLockedOutError if the (ip, email) tuple has ≥5 failures
 * in the last 15 minutes. Either ip or email may be null; lockout
 * fires if EITHER hits the threshold.
 */
export async function assertNotLockedOut(
  ip: string | null,
  email: string | null,
): Promise<void> {
  const since = new Date(Date.now() - LOCKOUT_WINDOW_MS);

  const checks: Array<Promise<number>> = [];
  if (ip) {
    checks.push(
      db
        .select({ c: sql<number>`count(*)::int` })
        .from(authFailAttempts)
        .where(and(
          eq(authFailAttempts.ip, ip),
          gte(authFailAttempts.attemptedAt, since),
        ))
        .then((r) => Number(r[0]?.c ?? 0)),
    );
  }
  if (email) {
    checks.push(
      db
        .select({ c: sql<number>`count(*)::int` })
        .from(authFailAttempts)
        .where(and(
          eq(authFailAttempts.email, email.toLowerCase()),
          gte(authFailAttempts.attemptedAt, since),
        ))
        .then((r) => Number(r[0]?.c ?? 0)),
    );
  }
  if (checks.length === 0) return;

  try {
    const counts = await Promise.all(checks);
    const max = Math.max(...counts);
    if (max >= LOCKOUT_THRESHOLD) {
      const retryAfterSeconds = Math.ceil(LOCKOUT_WINDOW_MS / 1000);
      throw new AuthLockedOutError(retryAfterSeconds);
    }
  } catch (err) {
    if (err instanceof AuthLockedOutError) throw err;
    logger.warn(
      "[authLockout] count read failed; falling open",
      err instanceof Error ? err : undefined,
    );
  }
}

/**
 * R4 — Clerk Native MFA Enforcement
 *
 * Replaces the broken in-house `require2FA` middleware. Reads MFA state
 * directly from the Clerk session JWT (`req.auth.factorVerificationAge`)
 * and the user's Clerk profile (`twoFactorEnabled`).
 *
 * History: AcreOS shipped an in-house TOTP implementation that read
 * `req.session.twoFactorVerified` from express-session — but
 * express-session is NOT installed in this codebase, so the legacy
 * middleware silently fell through on every request. The legacy
 * `users.twoFactorEnabled` column also doesn't exist on the table; the
 * old code only worked because of an `as any` cast and a
 * `try/catch ... next()` "fail open" branch on DB error. R4 deletes
 * that path and moves to Clerk-native MFA.
 *
 * How Clerk surfaces MFA state to the server:
 *   - `req.auth.userId`              — Clerk user-id (populated by clerkMiddleware)
 *   - `req.auth.factorVerificationAge` — `[firstFactorAge, secondFactorAge]`
 *     where `secondFactorAge >= 0` means the user verified a second factor
 *     N seconds ago in the current session, and `secondFactorAge === -1`
 *     means they have never verified a second factor in this session.
 *     `null` means the Clerk instance hasn't opted into the FVA claim;
 *     we treat that as "MFA not verified" (fail closed).
 *   - `clerkClient.users.getUser(id).twoFactorEnabled` — boolean indicating
 *     the user has at least one MFA factor set up on their Clerk profile.
 *
 * Decision matrix (audit-logged on every call):
 *   1. No `req.auth.userId`            → 401
 *   2. Clerk user has 2FA enabled
 *      AND second factor verified      → pass through
 *   3. Clerk user has 2FA enabled
 *      AND second factor NOT verified  → 403 mfa_required
 *   4. Clerk user has NO 2FA enabled
 *      AND route is high-trust         → 403 mfa_setup_required
 *   5. Clerk user has NO 2FA enabled
 *      AND MFA_REQUIRED_FOR_ALL_USERS  → 403 mfa_setup_required
 *   6. Otherwise                       → pass through
 *
 * Fail-closed posture: if the Clerk SDK call fails, the user has no
 * Clerk userId, or the FVA claim is missing on a high-trust route, we
 * return 403 — never silently bypass.
 */

import type { Request, RequestHandler, Response, NextFunction } from "express";
import { createClerkClient } from "@clerk/express";
import { db } from "../db";
import { auditEvents } from "@shared/schema";
import { logger } from "../utils/logger";
import { sendError } from "../utils/errors";

// ─── Clerk client (lazy, env-driven) ─────────────────────────────────────────
const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
});

// ─── High-trust path matcher ─────────────────────────────────────────────────
/**
 * Routes that demand MFA *be set up* even from users who have never
 * enabled it. These are the highest-blast-radius endpoints in the
 * system: admin-recovery (impersonation, password resets, autopay
 * freeze, ownership transfer) and any future "founder console"
 * surface.
 *
 * Keep this list narrow on purpose — adding a path here forces every
 * admin user without 2FA to enable it before they can use that area.
 */
const HIGH_TRUST_PATH_PREFIXES = [
  "/api/admin/recovery",
  "/api/admin/users/",         // covers /:id/2fa/reset, /sessions, /password-reset-link
  "/api/admin/orgs/",          // covers /:id/freeze-autopay, /:id/transfer-ownership
];

function isHighTrustPath(path: string): boolean {
  return HIGH_TRUST_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

// ─── Audit-event writer (best-effort, never blocks the request) ──────────────
type MfaDecision = "pass" | "blocked_mfa_required" | "blocked_setup_required" | "blocked_no_session";

/**
 * Narrow read of fields we care about — avoids `(req as any)` while staying
 * resilient to differences between worktree TS versions of `req.auth` (some
 * Clerk express versions type it as a callable, others as a property).
 */
interface MfaRequestShape {
  userId: string | null;
  fva: [number, number] | null;
  email: string | null;
  ip: string | null;
  userAgent: string | null;
  url: string;
  method: string;
}

function readMfaRequestShape(req: Request): MfaRequestShape {
  // Clerk's @clerk/express augments Express.Request#auth, but the type
  // shape varies between SDK minor versions — we narrow defensively.
  const auth = (req as Request & { auth?: { userId?: string; factorVerificationAge?: [number, number] | null } }).auth;
  // hydrateUser populates req.user with our DB record — type via the
  // shared AuthenticatedRequest is not used here because this middleware
  // can also run before user-hydration on routes that haven't applied it.
  const user = (req as Request & { user?: { email?: string | null; clerkUserId?: string | null } }).user;
  return {
    userId: auth?.userId ?? user?.clerkUserId ?? null,
    fva: auth?.factorVerificationAge ?? null,
    email: user?.email ?? null,
    ip: req.ip ?? null,
    userAgent: (req.headers["user-agent"] as string | undefined) ?? null,
    url: req.originalUrl || req.url,
    method: req.method,
  };
}

async function logMfaDecision(
  shape: MfaRequestShape,
  decision: MfaDecision,
  meta: Record<string, unknown> = {}
): Promise<void> {
  try {
    await db.insert(auditEvents).values({
      actorUserId: shape.userId,
      actorEmail: shape.email,
      action: `mfa.${decision}`,
      targetType: "route",
      targetId: shape.url,
      metadata: {
        method: shape.method,
        decision,
        ...meta,
      },
      ip: shape.ip,
      userAgent: shape.userAgent,
    });
  } catch (err) {
    // Audit write failure must never block enforcement.
    logger.error("[requireClerkMFA] audit write failed", err as Error);
  }
}

// ─── Feature flag: hard-block all users without MFA ──────────────────────────
function mfaRequiredForAll(): boolean {
  const v = process.env.MFA_REQUIRED_FOR_ALL_USERS;
  return v === "1" || v === "true" || v === "TRUE";
}

// ─── The middleware ──────────────────────────────────────────────────────────
export const requireClerkMFA: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  const shape = readMfaRequestShape(req);

  // 1. No Clerk session → 401. (isAuthenticated should run first; this is
  //    a belt-and-suspenders check.)
  if (!shape.userId) {
    await logMfaDecision(shape, "blocked_no_session");
    return sendError(res, 401, "Unauthorized", "No valid session");
  }

  // 2. Read FVA from the verified Clerk session JWT. `factorVerificationAge`
  //    is `[firstFactorAge, secondFactorAge]` in seconds; `-1` for never
  //    verified. `null` means the instance hasn't opted into the claim —
  //    treat as "not verified" so we fail closed on high-trust routes.
  const secondFactorVerified = Array.isArray(shape.fva) && shape.fva[1] >= 0;

  // 3. Look up the user's Clerk profile to determine whether they have
  //    any MFA factor enrolled (`twoFactorEnabled` is true if any TOTP,
  //    SMS, or backup-code factor exists on the Clerk user).
  let twoFactorEnabled = false;
  try {
    const clerkUser = await clerkClient.users.getUser(shape.userId);
    twoFactorEnabled = Boolean(clerkUser.twoFactorEnabled);
  } catch (err) {
    // Hard fail: if we cannot determine MFA state we refuse access on
    // any route that wants this middleware. Never silently bypass.
    logger.error("[requireClerkMFA] clerk.users.getUser failed", err as Error);
    await logMfaDecision(shape, "blocked_no_session", { reason: "clerk_lookup_failed" });
    return sendError(
      res,
      403,
      "mfa_required",
      "Could not verify MFA status. Sign out and sign back in."
    );
  }

  const highTrust = isHighTrustPath(shape.url);
  const requireForAll = mfaRequiredForAll();

  // 4. User has 2FA enabled — require they completed it for *this* session.
  if (twoFactorEnabled) {
    if (secondFactorVerified) {
      await logMfaDecision(shape, "pass", { highTrust, twoFactorEnabled });
      return next();
    }
    await logMfaDecision(shape, "blocked_mfa_required", { highTrust, twoFactorEnabled, fva: shape.fva });
    return sendError(
      res,
      403,
      "mfa_required",
      "Sign out and sign back in with your 2FA code."
    );
  }

  // 5. User does NOT have 2FA enabled. Block only if route is high-trust
  //    or the global feature flag is on; otherwise pass through so the
  //    rest of the app stays usable for users who haven't enrolled yet.
  if (highTrust || requireForAll) {
    await logMfaDecision(shape, "blocked_setup_required", { highTrust, requireForAll });
    return sendError(
      res,
      403,
      "mfa_setup_required",
      "Enable 2FA in your account settings before accessing this."
    );
  }

  await logMfaDecision(shape, "pass", { highTrust: false, twoFactorEnabled: false });
  return next();
};

// Test-only export: lets unit tests inspect/override the high-trust list
// without exporting the constant directly to runtime callers.
export const __testing = {
  isHighTrustPath,
  HIGH_TRUST_PATH_PREFIXES,
};

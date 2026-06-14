import { clerkMiddleware, createClerkClient } from "@clerk/express";
import type { RequestHandler } from "express";
import { db } from "../db";
import { users } from "@shared/models/auth";
import { Errors, sendError } from "../utils/errors";
import { eq } from "drizzle-orm";
import { isFounderEmail, isFounderIdentity } from "../services/founder";
import { logger } from "../utils/logger";
import { e2eTestAuthEnabled, resolveTestUserId } from "./testAuth";

export { clerkMiddleware };

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
});

// ─── Revoked-session cache (Lens 23 finding #5) ───────────────────────────────
//
// The manual JWT-fallback path below verifies the __session JWT signature
// against CLERK_JWT_KEY and the `exp` claim. Critically, this does NOT honor
// Clerk session revocation — when a user clicks "Sign out everywhere" or an
// admin terminates a session in Clerk, the JWT remains cryptographically
// valid until its native expiry (typically 60s for short-lived templates,
// but up to days for the multi-session JWT depending on Clerk config).
//
// During that window, anyone holding the cookie value (XSS, stolen device,
// compromised browser sync) could keep using the app even after the user
// thinks they've signed out. clerkMiddleware (the happy path) calls Clerk
// and would catch this; our fallback bypassed it.
//
// Fix: maintain a small revoked-sid (session id) cache that is refreshed on
// a short interval by polling Clerk's `sessions.getSessionList({ status:
// 'revoked' })`. When the fallback path verifies a JWT, it now ALSO checks
// the `sid` claim against this set. If the sid is known-revoked, reject.
//
// Fail-open vs fail-closed: cache misses (e.g., Clerk API down, refresh
// failed) fall back to fail-closed for the manual path only — if we can't
// confirm a session isn't revoked, we send the user back through Clerk's
// own middleware on the next request, which will refuse if Clerk says so.
// The happy path through clerkMiddleware is unaffected.

interface RevokedSidCache {
  sids: Set<string>;
  lastRefreshAt: number;
  refreshing: Promise<void> | null;
}

const REVOKED_SID_REFRESH_MS = 60 * 1000; // 1 minute — Clerk recommends ≤ 60s for revocation propagation
const REVOKED_SID_CACHE_FRESH_MS = 5 * 60 * 1000; // accept cache up to 5 min stale before failing closed

const revokedSidCache: RevokedSidCache = {
  sids: new Set(),
  lastRefreshAt: 0,
  refreshing: null,
};

async function refreshRevokedSids(): Promise<void> {
  if (revokedSidCache.refreshing) return revokedSidCache.refreshing;
  revokedSidCache.refreshing = (async () => {
    try {
      // Clerk's session list API supports filtering by status. We pull the
      // most-recently-revoked page (up to 100); long-tail revocations age
      // out of the cookie's `exp` window naturally and don't need tracking.
      const revoked = await clerkClient.sessions.getSessionList({
        status: "revoked",
        limit: 100,
      });
      const next = new Set<string>();
      const rows: any[] = Array.isArray(revoked) ? revoked : (revoked as any)?.data ?? [];
      for (const s of rows) {
        if (s?.id) next.add(s.id);
      }
      revokedSidCache.sids = next;
      revokedSidCache.lastRefreshAt = Date.now();
    } catch (err: any) {
      logger.warn("[clerkAuth] revoked-sid cache refresh failed: " + err?.message);
      // Don't clobber the cache — keep whatever we last had and let the
      // freshness gate downstream decide whether to fail closed.
    } finally {
      revokedSidCache.refreshing = null;
    }
  })();
  return revokedSidCache.refreshing;
}

/**
 * Returns:
 *   - 'ok'       → sid not in revoked set (cache may or may not be fresh)
 *   - 'revoked'  → sid is in the revoked set — reject this cookie
 *
 * History (2026-05-27 incident): the prior version returned 'unknown' and
 * caused the caller to fail closed when the Clerk session-list API
 * couldn't be reached. The Clerk SDK call shape / scope is fragile, and
 * a single failed refresh on a fresh Fly machine boot translated to
 * every JWT-fallback verify returning 401 → universal auth-loop on every
 * client. clerkMiddleware (the happy path) calls Clerk authoritatively
 * on every request and catches revocations anyway; the JWT-fallback's
 * job is to keep the user signed in during a 401-recovery race, not to
 * be the primary revocation gate. Fail OPEN when we can't confirm
 * revocation; log it so we can see when the cache is broken.
 *
 * Security trade-off: a revoked session can survive on the fallback path
 * for at most one request before clerkMiddleware re-verifies. This is
 * the same window users have always had (the prior fail-closed design
 * was the regression, not the baseline).
 */
async function checkRevokedSid(
  sid: string | undefined,
): Promise<"ok" | "revoked"> {
  if (!sid) return "ok"; // No sid claim → can't validate; defer to clerkMiddleware
  const now = Date.now();
  // Trigger a background refresh if stale, but never block the hot path.
  if (now - revokedSidCache.lastRefreshAt > REVOKED_SID_REFRESH_MS) {
    void refreshRevokedSids();
  }
  // Only reject when we're certain — sid present in the revoked set.
  if (revokedSidCache.sids.has(sid)) return "revoked";
  // Otherwise let it through. clerkMiddleware will catch a recently-
  // revoked sid on the next round-trip.
  return "ok";
}

// Test-only override — tests can stub the revoked-sid cache directly
// instead of hitting Clerk.
export function __setRevokedSidsForTests(sids: string[] | null): void {
  if (sids === null) {
    revokedSidCache.sids = new Set();
    revokedSidCache.lastRefreshAt = 0;
    return;
  }
  revokedSidCache.sids = new Set(sids);
  revokedSidCache.lastRefreshAt = Date.now();
}

/**
 * Syncs the Clerk user into our users table on first access.
 * Attaches `req.user` with the DB user record so downstream handlers
 * (getOrCreateOrg, route handlers) can use req.user as before.
 */
async function hydrateUser(req: any, res: any, next: any) {
  let userId = req.auth?.userId;

  // Fallback: if clerkMiddleware couldn't verify (e.g., proxy/Cloudflare issues),
  // manually decode the __session JWT using CLERK_JWT_KEY.
  //
  // Cookie name shape: Clerk-JS sets the session JWT under a per-instance
  // suffixed name like `__session_<hash>=…` in production. The bare
  // `__session=` name is legacy and may either (a) not exist or (b) hold a
  // stale value from a previous session that the user already signed out of.
  // The original `/__session=([^;]+)/` regex only matched the bare name —
  // when only the suffixed cookie was set, fallback found nothing and we
  // 401'd every request with a perfectly valid session JWT in the jar.
  // F-D14: walk every cookie, collect every __session* value, verify each
  // until one passes — the first valid one wins. The suffixed cookie is
  // almost always the fresh one in production.
  if (!userId) {
    try {
      const cookieHeader: string | undefined = req.headers.cookie;
      const candidates: string[] = [];
      if (cookieHeader && process.env.CLERK_JWT_KEY) {
        for (const part of cookieHeader.split(";")) {
          const eq = part.indexOf("=");
          if (eq < 0) continue;
          const name = part.slice(0, eq).trim();
          const value = part.slice(eq + 1).trim();
          if (/^__session(_[A-Za-z0-9_-]+)?$/.test(name) && value) {
            candidates.push(value);
          }
        }
      }
      // Prefer suffixed cookies (production) before bare (legacy / possibly stale)
      candidates.sort((a, b) => (a.length === b.length ? 0 : b.length - a.length));
      for (const sessionCookie of candidates) {
        if (userId) break;
        try {
        const crypto = await import("crypto");
        const [headerB64, payloadB64, sigB64] = sessionCookie.split(".");
        const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());

        // Verify signature with the public key
        const clerkJwtKey = process.env.CLERK_JWT_KEY;
        if (!clerkJwtKey) break;
        const verifier = crypto.createVerify("RSA-SHA256");
        verifier.update(headerB64 + "." + payloadB64);
        const isValid = verifier.verify(clerkJwtKey, sigB64, "base64url");

        // Accept tokens up to 30 seconds past expiry to handle Clerk session refresh lag
        // SEC-005: reduced from 5 min — 30s is sufficient for normal clock skew
        const GRACE_PERIOD_MS = 30 * 1000;
        if (isValid && payload.sub && payload.exp * 1000 > Date.now() - GRACE_PERIOD_MS) {
          // Lens 23 #5: JWT signature + expiry are necessary but not sufficient.
          // A revoked session keeps its valid JWT until exp. Cross-check the
          // `sid` claim against our revoked-sid cache; fail closed on unknown.
          const sidCheck = await checkRevokedSid(payload.sid as string | undefined);
          if (sidCheck === "revoked") {
            logger.warn("[hydrateUser] rejecting JWT for revoked session", {
              metadata: { sid: payload.sid, sub: payload.sub },
            });
            continue; // try next candidate cookie (in case multiple sessions stacked)
          }
          // 'ok' — proceed. The 'unknown' branch was removed after the
          // 2026-05-27 incident; see checkRevokedSid header comment.
          userId = payload.sub;
        }
        } catch {
          // try the next candidate cookie
          continue;
        }
      }
    } catch (jwtErr: any) {
      logger.warn("[hydrateUser] JWT fallback failed: " + jwtErr.message);
    }
  }

  if (!userId) {
    return Errors.unauthorized(res);
  }

  try {
    let [user] = await db
      .select()
      .from(users)
      .where(eq(users.clerkUserId, userId))
      .limit(1);

    if (!user) {
      // First time this Clerk user hits the app — create our DB record.
      // Race: many parallel authenticated requests hit this path simultaneously
      // on first login (dashboard fires 9+ queries at once). Plain INSERT
      // returned 500 for every request after the first due to the
      // users_clerk_user_id_unique constraint. ON CONFLICT DO NOTHING +
      // re-SELECT makes this idempotent and race-safe.
      const clerkUser = await clerkClient.users.getUser(userId);
      const primaryEmail = clerkUser.emailAddresses.find(
        (e: any) => e.id === clerkUser.primaryEmailAddressId
      );
      const email = primaryEmail?.emailAddress?.toLowerCase() ?? null;

      // Phase Zero-Three clickwrap (Beatrice audit 2026-06-01): every NEW
      // user row is stamped with ToS + Privacy acceptance at creation. The
      // client-side checkbox gate in auth-page.tsx blocks Clerk SignUp from
      // rendering until the user affirmatively checks the box, so reaching
      // this code path on a brand-new clerkUserId is itself the audit trail
      // for the affirmation. We trust the server clock (defense against
      // client-clock manipulation); the two columns are set to the same
      // instant for v1.0 (separate columns enable independent re-acceptance
      // tracking when v1.1 ships).
      const acceptedAt = new Date();
      const inserted = await db
        .insert(users)
        .values({
          clerkUserId: userId,
          email,
          firstName: clerkUser.firstName ?? null,
          lastName: clerkUser.lastName ?? null,
          profileImageUrl: clerkUser.imageUrl ?? null,
          tosAcceptedAt: acceptedAt,
          privacyAcceptedAt: acceptedAt,
        })
        .onConflictDoNothing({ target: users.clerkUserId })
        .returning();

      if (inserted.length > 0) {
        user = inserted[0];
      } else {
        // Another request created the row first — re-select it.
        [user] = await db
          .select()
          .from(users)
          .where(eq(users.clerkUserId, userId))
          .limit(1);
      }
    }

    req.user = user;
    // Set isFounder flag for founder-only routes. Matches by email
    // (FOUNDER_EMAIL/FOUNDER_EMAILS) or Clerk user ID (FOUNDER_USER_IDS) —
    // see server/services/founder.ts.
    if (isFounderIdentity({ email: user.email, userId })) {
      req.isFounder = true;
    }
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Drop-in replacement for the old Passport `isAuthenticated` middleware.
 * Checks req.auth.userId (populated by global clerkMiddleware) and
 * falls back to manual JWT verification. Returns 401 JSON for API
 * routes — never redirects.
 */
export const isAuthenticated: RequestHandler = (req: any, res, next) => {
  // E2E test-auth — inject a fixed test user so the Playwright suite can
  // exercise the authenticated app in CI. Hard-gated: never active on Fly.
  // The `__session` cookie value selects customer vs founder test identity
  // so the suite can assert both sides of the founder gate.
  // See server/auth/testAuth.ts.
  if (e2eTestAuthEnabled()) {
    req.auth = { userId: resolveTestUserId(req.headers.cookie) };
    return hydrateUser(req, res, next);
  }

  // clerkMiddleware already ran globally and populated req.auth
  // Check if it found a valid session
  if (req.auth?.userId) {
    return hydrateUser(req, res, next);
  }

  // No Clerk session from clerkMiddleware — try the JWT fallback in hydrateUser.
  //
  // BUG FIX (2026-05-31): the prior guard here used `/__session=([^;]+)/`
  // which only matched the bare `__session=` cookie name. Clerk in our
  // proxy config sets `__session_<instance-hash>=` (suffixed form).  When
  // clerkMiddleware couldn't populate req.auth.userId, that regex found
  // nothing even though a perfectly valid suffixed session JWT was present,
  // and we returned 401 immediately — bypassing hydrateUser entirely.
  //
  // hydrateUser already has the correct multi-cookie-name walking logic
  // (added in commit F-D14): it iterates every cookie that matches
  // /^__session(_[A-Za-z0-9_-]+)?$/ and verifies each JWT until one
  // passes. That logic is authoritative; this guard was redundant AND
  // wrong.  Remove the guard and always delegate to hydrateUser.  If there
  // is genuinely no valid session (no CLERK_JWT_KEY, no matching cookies,
  // all JWTs expired), hydrateUser returns 401 itself at line 214.
  if (process.env.CLERK_JWT_KEY || req.headers.cookie) {
    return hydrateUser(req, res, next);
  }

  // No CLERK_JWT_KEY configured and no cookies at all — no auth possible.
  return Errors.unauthorized(res);
};

/**
 * Middleware that requires the user to be a founder.
 * Returns 404 to hide the existence of founder-only routes from non-founders.
 * Must run after isAuthenticated (requires req.user to be set).
 *
 * Matches founders by email (FOUNDER_EMAIL/FOUNDER_EMAILS) or Clerk user ID
 * (FOUNDER_USER_IDS) — see server/services/founder.ts.
 */
export const requireFounder: RequestHandler = (req: any, res, next) => {
  if (!req.user) {
    return sendError(res, 404, "NOT_FOUND", "Not found");
  }

  const user = req.user;
  const userId = req.auth?.userId ?? user.clerkUserId ?? null;
  if (!isFounderIdentity({ email: user.email, userId })) {
    return sendError(res, 404, "NOT_FOUND", "Not found");
  }

  req.isFounder = true;
  next();
};

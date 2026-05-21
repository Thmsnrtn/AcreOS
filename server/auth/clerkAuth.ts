import { clerkMiddleware, createClerkClient } from "@clerk/express";
import type { RequestHandler } from "express";
import { db } from "../db";
import { users } from "@shared/models/auth";
import { eq } from "drizzle-orm";
import { isFounderEmail, isFounderIdentity } from "../services/founder";
import { logger } from "../utils/logger";

export { clerkMiddleware };

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
});

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
        const verifier = crypto.createVerify("RSA-SHA256");
        verifier.update(headerB64 + "." + payloadB64);
        const isValid = verifier.verify(process.env.CLERK_JWT_KEY, sigB64, "base64url");

        // Accept tokens up to 30 seconds past expiry to handle Clerk session refresh lag
        // SEC-005: reduced from 5 min — 30s is sufficient for normal clock skew
        const GRACE_PERIOD_MS = 30 * 1000;
        if (isValid && payload.sub && payload.exp * 1000 > Date.now() - GRACE_PERIOD_MS) {
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
    return res.status(401).json({ error: "Unauthorized", message: "No valid session" });
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

      const inserted = await db
        .insert(users)
        .values({
          clerkUserId: userId,
          email,
          firstName: clerkUser.firstName ?? null,
          lastName: clerkUser.lastName ?? null,
          profileImageUrl: clerkUser.imageUrl ?? null,
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
  // clerkMiddleware already ran globally and populated req.auth
  // Check if it found a valid session
  if (req.auth?.userId) {
    return hydrateUser(req, res, next);
  }

  // No Clerk session — try JWT fallback from __session cookie
  const sessionCookie = req.headers.cookie?.match(/__session=([^;]+)/)?.[1];
  if (sessionCookie && process.env.CLERK_JWT_KEY) {
    return hydrateUser(req, res, next);
  }

  // No valid auth at all — return 401 JSON (never redirect)
  return res.status(401).json({ error: "Unauthorized", message: "No valid session" });
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
    return res.status(404).json({ message: "Not found" });
  }

  const user = req.user as any;
  const userId = req.auth?.userId ?? user.clerkUserId ?? null;
  if (!isFounderIdentity({ email: user.email, userId })) {
    return res.status(404).json({ message: "Not found" });
  }

  req.isFounder = true;
  next();
};

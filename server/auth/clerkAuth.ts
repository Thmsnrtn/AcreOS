import { clerkMiddleware, createClerkClient } from "@clerk/express";
import type { RequestHandler } from "express";
import { db } from "../db";
import { users } from "@shared/models/auth";
import { eq } from "drizzle-orm";
import { isFounderEmail } from "../services/founder";
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
  // manually decode the __session JWT using CLERK_JWT_KEY
  if (!userId) {
    try {
      const sessionCookie = req.headers.cookie?.match(/__session=([^;]+)/)?.[1];
      if (sessionCookie && process.env.CLERK_JWT_KEY) {
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
      // First time this Clerk user hits the app — create our DB record
      const clerkUser = await clerkClient.users.getUser(userId);
      const primaryEmail = clerkUser.emailAddresses.find(
        (e: any) => e.id === clerkUser.primaryEmailAddressId
      );
      const email = primaryEmail?.emailAddress?.toLowerCase() ?? null;

      [user] = await db
        .insert(users)
        .values({
          clerkUserId: userId,
          email,
          firstName: clerkUser.firstName ?? null,
          lastName: clerkUser.lastName ?? null,
          profileImageUrl: clerkUser.imageUrl ?? null,
        })
        .returning();
    }

    req.user = user;
    // Set isFounder flag for founder-only routes
    if (user.email && isFounderEmail(user.email)) {
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
 */
export const requireFounder: RequestHandler = (req, res, next) => {
  if (!req.user) {
    return res.status(404).json({ message: "Not found" });
  }

  const user = req.user as any;
  if (!isFounderEmail(user.email)) {
    return res.status(404).json({ message: "Not found" });
  }

  req.isFounder = true;
  next();
};

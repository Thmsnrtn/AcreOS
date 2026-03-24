import { clerkMiddleware, requireAuth, createClerkClient } from "@clerk/express";
import type { RequestHandler } from "express";
import { db } from "../db";
import { users } from "@shared/models/auth";
import { eq } from "drizzle-orm";
import { isFounderEmail } from "../services/founder";

export { clerkMiddleware };

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
});

/**
 * Syncs the Clerk user into our users table on first access.
 * Attaches `req.user` with the DB user record so downstream handlers
 * (getOrCreateOrg, route handlers) can use req.user as before.
 *
 * Must only be called after requireAuth() has confirmed the user is authenticated.
 */
async function hydrateUser(req: any, res: any, next: any) {
  const { userId } = req.auth;

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
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Drop-in replacement for the old Passport `isAuthenticated` middleware.
 * Requires a valid Clerk session and populates req.user from our DB.
 */
export const isAuthenticated: RequestHandler = (req, res, next) => {
  requireAuth()(req, res, (err?: any) => {
    if (err) return next(err);
    hydrateUser(req, res, next);
  });
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

/**
 * F-A07-1: MFA Enforcement Middleware
 *
 * When an owner or admin user has 2FA enabled on their account,
 * this middleware gates access until the current session has
 * completed the 2FA verification step (session.twoFactorVerified === true).
 *
 * Usage:
 *   app.use('/api/admin', isAuthenticated, require2FA, adminRouter);
 *
 * The client should redirect the user to /settings/security?verify=true
 * when a 428 status is received, so they can complete 2FA before retrying.
 */

import type { RequestHandler } from "express";
import { db } from "../db";
import { users } from "@shared/models/auth";
import { eq } from "drizzle-orm";

export const require2FA: RequestHandler = async (req, res, next) => {
  try {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // Already verified in this session — allow through
    if ((req.session as any).twoFactorVerified === true) {
      return next();
    }

    const user = req.user as any;
    const userId = user.claims?.sub || user.id;

    const [dbUser] = await db.select().from(users).where(eq(users.id, String(userId)));
    const twoFactorEnabled = (dbUser as any)?.twoFactorEnabled ?? false;

    if (!twoFactorEnabled) {
      // 2FA not set up for this account — no enforcement needed
      return next();
    }

    // 2FA is enabled but not yet verified in this session
    return res.status(428).json({
      message: "Two-factor authentication required",
      code: "2FA_REQUIRED",
    });
  } catch (err: any) {
    console.error("[require2FA] Error checking 2FA status:", err.message);
    return next(); // Fail open so a DB error doesn't lock all users out
  }
};

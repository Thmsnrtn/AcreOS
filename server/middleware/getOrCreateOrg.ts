import type { Request, Response, NextFunction } from "express";
import { storage, db } from "../storage";
import { eq } from "drizzle-orm";
import { organizations } from "@shared/schema";

/**
 * Founder email — gets enterprise tier and unlimited access.
 * Read from FOUNDER_EMAILS env var (comma-separated) with a fallback.
 */
const FOUNDER_EMAILS = (process.env.FOUNDER_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

function isFounderEmail(email: string | undefined): boolean {
  if (!email) return false;
  return FOUNDER_EMAILS.includes(email.toLowerCase());
}

/**
 * Middleware to get or create an organization for the authenticated user.
 * Attaches `(req as any).organization` for downstream handlers.
 *
 * Must be placed AFTER `isAuthenticated` in the middleware chain.
 */
export async function getOrCreateOrg(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const user = req.user as any;
  const userId = user.id;
  const userEmail = user.email;

  if (!userId) {
    console.error("No user ID found in session:", user);
    return res.status(401).json({ message: "Invalid user session" });
  }

  const isFounder = isFounderEmail(userEmail);

  let org = await storage.getOrganizationByOwner(userId);

  if (!org) {
    // Create default organization for new user with 7-day free trial
    const displayName = user.firstName || user.email || "User";
    const slug = `org-${userId}-${Date.now()}`;
    const now = new Date();
    const trialEnds = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    org = await storage.createOrganization({
      name: `${displayName}'s Organization`,
      slug,
      ownerId: userId,
      subscriptionTier: isFounder ? "enterprise" : "free",
      subscriptionStatus: "active",
      trialStartedAt: isFounder ? null : now,
      trialEndsAt: isFounder ? null : trialEnds,
      trialUsed: isFounder ? true : false,
      isFounder,
    });

    // Add user as owner team member
    await storage.createTeamMember({
      organizationId: org.id,
      userId,
      displayName,
      role: "owner",
      isActive: true,
    });

    if (isFounder) {
      console.log(`[Founder] Created founder organization for ${userEmail}`);
    }
  } else if (isFounder && !org.isFounder) {
    // Upgrade existing org to founder status
    await db
      .update(organizations)
      .set({
        isFounder: true,
        subscriptionTier: "enterprise",
        subscriptionStatus: "active",
      })
      .where(eq(organizations.id, org.id));

    org = {
      ...org,
      isFounder: true,
      subscriptionTier: "enterprise",
      subscriptionStatus: "active",
    };
    console.log(`[Founder] Upgraded existing organization to founder status for ${userEmail}`);
  }

  (req as any).organization = org;
  next();
}

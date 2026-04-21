import type { Request, Response, NextFunction } from "express";
import { storage, db } from "../storage";
import { withTransaction } from "../db";
import { eq } from "drizzle-orm";
import { organizations, teamMembers } from "@shared/schema";
import { logger } from "../utils/logger";

/**
 * Founder email — gets enterprise tier and unlimited access.
 * Reads FOUNDER_EMAIL (single) and/or FOUNDER_EMAILS (comma-separated),
 * matching the same logic as server/services/founder.ts.
 */
const _founderPrimary = (process.env.FOUNDER_EMAIL || "").trim().toLowerCase();
const _founderAdditional = (process.env.FOUNDER_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);
const FOUNDER_EMAILS = [...new Set([_founderPrimary, ..._founderAdditional].filter(Boolean))];

function isFounderEmail(email: string | undefined): boolean {
  if (!email) return false;
  return FOUNDER_EMAILS.includes(email.toLowerCase());
}

/**
 * Middleware to get or create an organization for the authenticated user.
 * Attaches `req.organization` and `req.organizationId` for downstream handlers.
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
    logger.warn("No user ID found in session", { source: "getOrCreateOrg" });
    return res.status(401).json({ message: "Invalid user session" });
  }

  const isFounder = isFounderEmail(userEmail);

  let org = await storage.getOrganizationByOwner(userId);

  // Cycle 14: if the user doesn't own any org but is an active team
  // member of one (invited seat user), use that org instead of
  // spinning up a fresh shadow org. Prevents seat users from
  // accidentally landing in a personal sandbox after accepting an
  // invite.
  if (!org) {
    try {
      const memberships = await db
        .select()
        .from(teamMembers)
        .where(eq(teamMembers.userId, userId));
      const active = memberships.find((m) => m.isActive);
      if (active) {
        const [inviteOrg] = await db
          .select()
          .from(organizations)
          .where(eq(organizations.id, active.organizationId))
          .limit(1);
        if (inviteOrg) org = inviteOrg;
      }
    } catch {
      /* non-fatal; fall through to shadow-org creation below */
    }
  }

  if (!org) {
    // DEFECT-0021: Wrap org creation + team member creation in a transaction
    // so we never end up with an org that has no owner team member.
    const displayName = user.firstName || user.email || "User";
    const slug = `org-${userId}-${Date.now()}`;
    const now = new Date();
    const trialEnds = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    org = await withTransaction(async (tx) => {
      const [newOrg] = await tx.insert(organizations).values({
        name: `${displayName}'s Organization`,
        slug,
        ownerId: userId,
        subscriptionTier: isFounder ? "enterprise" : "free",
        subscriptionStatus: "active",
        trialStartedAt: isFounder ? null : now,
        trialEndsAt: isFounder ? null : trialEnds,
        trialUsed: isFounder ? true : false,
        isFounder,
        utmSource: null,
        utmMedium: null,
        utmCampaign: null,
        utmContent: null,
      }).returning();

      // Add user as owner team member
      await tx.insert(teamMembers).values({
        organizationId: newOrg.id,
        userId,
        displayName,
        role: "owner",
        isActive: true,
      });

      return newOrg;
    });

    if (isFounder) {
      logger.info(`Founder organization created`, { source: "getOrCreateOrg", metadata: { email: userEmail } });
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
    logger.info(`Founder organization upgraded to enterprise`, { source: "getOrCreateOrg", metadata: { email: userEmail } });
  }

  // Set typed properties on the request
  req.organization = org;
  req.organizationId = org.id;
  // Legacy alias — will be removed once all route files use AuthenticatedRequest
  (req as any).org = org;
  next();
}

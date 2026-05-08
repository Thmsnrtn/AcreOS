import type { Request, Response, NextFunction, CookieOptions } from "express";
import { storage, db } from "../storage";
import { withTransaction } from "../db";
import { and, eq } from "drizzle-orm";
import { organizations, teamMembers } from "@shared/schema";
import { logger } from "../utils/logger";

/**
 * Cookie name + options for the per-session "active organization" override.
 * Set by POST /api/auth/switch-organization (Reyna §2 — VA workflow).
 * httpOnly so JS can't read it; sameSite=lax so it survives in-app navigation
 * but won't leak on cross-site POSTs; 30-day TTL so the user's choice
 * survives logout cycles.
 */
export const ACTIVE_ORG_COOKIE = "acreos_active_org";
export const ACTIVE_ORG_COOKIE_OPTS: CookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

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

  let org: any = undefined;

  // Reyna §2 — honor the active-org cookie set by /api/auth/switch-organization,
  // but only if the user is still a verified active member of that org.
  // A revoked seat cannot keep operating in someone else's org by holding
  // onto a stale cookie.
  const activeOrgCookieRaw = (req as any).cookies?.[ACTIVE_ORG_COOKIE];
  const activeOrgCookieId = activeOrgCookieRaw ? Number(activeOrgCookieRaw) : NaN;
  if (Number.isFinite(activeOrgCookieId) && activeOrgCookieId > 0) {
    try {
      const [candidate] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, activeOrgCookieId))
        .limit(1);
      if (candidate) {
        if (candidate.ownerId === userId) {
          org = candidate;
        } else {
          const [member] = await db
            .select()
            .from(teamMembers)
            .where(
              and(
                eq(teamMembers.organizationId, candidate.id),
                eq(teamMembers.userId, userId),
                eq(teamMembers.isActive, true),
              ),
            )
            .limit(1);
          if (member) org = candidate;
        }
      }
    } catch {
      /* non-fatal — fall through to default resolution. */
    }
  }

  if (!org) {
    org = await storage.getOrganizationByOwner(userId);
  }

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

    // Phase 3 Week 14 — Activation telemetry. First (and only) org_created
    // event for this organisation. Fire-and-forget; never blocks request.
    try {
      const { recordActivationEventAsync } = await import("../services/activation");
      recordActivationEventAsync({
        orgId: org.id,
        userId,
        eventName: "org_created",
        eventValue: { isFounder, source: "getOrCreateOrg" },
      });
    } catch {
      /* non-fatal; telemetry failures must not break org creation */
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

  // RS-5: fire-and-forget new-location detector. Bounded by an in-memory
  // Set keyed on sessionId so it touches the DB at most once per session
  // per process — not on every authenticated request.
  // RS-6: same memo pattern, detects an email change in Clerk vs our
  // local DB row and alerts both addresses.
  try {
    const sessionId = (req as any).auth?.sessionId ?? null;
    const ip = req.ip ?? null;
    const userAgent = (req.headers["user-agent"] as string) ?? null;
    void import("../services/loginAnomalyDetector").then((m) =>
      m.recordAndAlertIfNew({
        userId,
        sessionId,
        ip,
        userAgent,
        headers: req.headers as Record<string, any>,
      }).catch(() => {/* fail-open */}),
    ).catch(() => {/* fail-open */});
    void import("../services/emailChangeDetector").then((m) =>
      m.detectAndAlertEmailChange({
        userId,
        clerkUserId: (user as any).clerkUserId ?? null,
        sessionId,
        ip,
        userAgent,
      }).catch(() => {/* fail-open */}),
    ).catch(() => {/* fail-open */});
  } catch {/* fail-open */}

  next();
}

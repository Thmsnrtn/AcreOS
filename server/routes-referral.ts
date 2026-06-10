import type { Express } from "express";
import crypto from "crypto";
import { db } from "./db";
import { users, referrals } from "@shared/models/auth";
import { organizations } from "@shared/schema";
import { isAuthenticated } from "./auth/clerkAuth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { eq, count, sql } from "drizzle-orm";
import { logger } from "./utils/logger";
import { Errors } from "./utils/errors";
import { applyReferralCode } from "./services/referralService";

// Generate a random 8-char alphanumeric referral code
function generateCode(): string {
  return crypto.randomBytes(5).toString("base64url").slice(0, 8).toUpperCase();
}

export function registerReferralRoutes(app: Express): void {
  /**
   * GET /api/referral/code
   * Returns (or creates) the authenticated user's personal referral code.
   */
  app.get("/api/referral/code", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.user as any)?.id;
      if (!userId) return Errors.unauthorized(res);

      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user) return Errors.notFound(res, "User");

      if (user.referralCode) {
        return res.json({ code: user.referralCode });
      }

      // Generate a unique code
      let code = generateCode();
      let attempts = 0;
      while (attempts < 10) {
        const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.referralCode, code)).limit(1);
        if (!existing) break;
        code = generateCode();
        attempts++;
      }

      await db.update(users).set({ referralCode: code }).where(eq(users.id, userId));

      // Also create the referrals tracking row for this referrer
      await db.insert(referrals).values({
        referrerId: userId,
        code,
        status: "pending",
      }).onConflictDoNothing();

      return res.json({ code });
    } catch (err) {
      logger.error("[referral] GET /code error", err);
      return Errors.internal(res, new Error('Internal server error'));
    }
  });

  /**
   * GET /api/referral/stats
   * Returns the referrer's stats: signups, conversions, credit balance.
   */
  app.get("/api/referral/stats", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const userId = (req.user as any)?.id;
      if (!userId) return Errors.unauthorized(res);

      const org = req.organization;

      const rows = await db
        .select()
        .from(referrals)
        .where(eq(referrals.referrerId, userId));

      const signups = rows.filter((r) => r.status === "signed_up" || r.status === "converted").length;
      const conversions = rows.filter((r) => r.status === "converted").length;
      const creditsEarned = rows.reduce((sum, r) => sum + (r.creditAmount ?? 0), 0);

      return res.json({
        signups,
        conversions,
        creditsEarned,       // cents total ever earned
        creditBalance: org?.referralCredits ?? 0, // cents currently available
      });
    } catch (err) {
      logger.error("[referral] GET /stats error", err);
      return Errors.internal(res, new Error('Internal server error'));
    }
  });

  /**
   * POST /api/referral/apply
   * Called after a new user registers if they came via ?ref=CODE.
   * Links the AUTHENTICATED user (the referee is always the caller —
   * Tier 2C removed the body-supplied refereeId, which let any authed
   * user attribute arbitrary users to arbitrary codes) to the referrer.
   *
   * Body: { code: string }
   *
   * Note: the primary apply path is now server-side during the signup
   * UTM flush (routes-acquisition-utm.ts); this route remains for
   * explicit/manual application and is idempotent with that path.
   */
  app.post("/api/referral/apply", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.user as any)?.id;
      if (!userId) return Errors.unauthorized(res);

      const { code } = req.body as { code?: string };
      if (!code || typeof code !== "string") {
        return Errors.badRequest(res, "code required");
      }

      const result = await applyReferralCode(code, userId);
      if (result.applied) return res.json({ ok: true });

      switch (result.reason) {
        case "unknown_code":
          return Errors.notFound(res, "Referral code");
        case "self_referral":
          return Errors.badRequest(res, "Cannot refer yourself");
        case "invalid_code":
          return Errors.badRequest(res, "Invalid referral code");
        case "already_referred":
        case "code_exhausted":
          // Not an error from the caller's perspective — attribution
          // simply already belongs to someone. Don't leak who.
          return res.json({ ok: false, reason: result.reason });
        default:
          return Errors.internal(res, new Error("Referral apply failed"));
      }
    } catch (err) {
      logger.error("[referral] POST /apply error", err);
      return Errors.internal(res, new Error('Internal server error'));
    }
  });

  /**
   * POST /api/referral/activate
   * Called when a referred user reaches deal_won activation event.
   * Rewards BOTH referrer and referred with one free month.
   */
  app.post("/api/referral/activate", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const userId = (req.user as any)?.id;
      if (!userId) return Errors.unauthorized(res);

      // Find referral where this user is the referee
      const [referral] = await db
        .select()
        .from(referrals)
        .where(eq(referrals.refereeId, userId))
        .limit(1);

      if (!referral) return res.json({ rewarded: false, message: "No referral found" });
      if (referral.status === "converted") return res.json({ rewarded: false, message: "Already rewarded" });

      // Update status to converted and set credit
      const creditAmount = 100; // $1.00 credit (or 1 month free depending on plan)
      await db
        .update(referrals)
        .set({ status: "converted", creditAmount, creditedAt: new Date() })
        .where(eq(referrals.id, referral.id));

      // Credit the referrer's org
      if (referral.referrerId) {
        const [referrerUser] = await db
          .select()
          .from(users)
          .where(eq(users.id, referral.referrerId))
          .limit(1);

        if (referrerUser) {
          // Add referral credit to referrer's org
          await db.execute(
            sql`UPDATE organizations SET referral_credits = COALESCE(referral_credits, 0) + ${creditAmount}
                WHERE id = (SELECT organization_id FROM users WHERE id = ${referral.referrerId} LIMIT 1)`
          );
        }
      }

      // Credit the referee's org
      const org = req.organization;
      await db.execute(
        sql`UPDATE organizations SET referral_credits = COALESCE(referral_credits, 0) + ${creditAmount}
            WHERE id = ${org.id}`
      );

      return res.json({
        rewarded: true,
        message: "Congratulations! You both earned a free month.",
      });
    } catch (err) {
      logger.error("[referral] POST /activate error", err);
      return Errors.internal(res, new Error('Internal server error'));
    }
  });

  /**
   * GET /api/referral/referees
   * Returns list of referred users and their activation status.
   */
  app.get("/api/referral/referees", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.user as any)?.id;
      if (!userId) return Errors.unauthorized(res);

      const refs = await db
        .select()
        .from(referrals)
        .where(eq(referrals.referrerId, userId));

      const referees = refs.map((r) => ({
        status: r.status,
        signedUpAt: r.createdAt,
        convertedAt: (r as any).convertedAt || null,
        rewarded: r.status === "converted",
      }));

      return res.json({ referees });
    } catch (err) {
      logger.error("[referral] GET /referees error", err);
      return Errors.internal(res, new Error('Internal server error'));
    }
  });
}

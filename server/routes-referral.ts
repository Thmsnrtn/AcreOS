import type { Express } from "express";
import crypto from "crypto";
import { db } from "./db";
import { users, referrals } from "@shared/models/auth";
import { organizations } from "@shared/schema";
import { isAuthenticated } from "./auth/localAuth";
import { getOrCreateOrg } from "./services/getOrCreateOrg";
import { eq, count, sql } from "drizzle-orm";

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
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user) return res.status(404).json({ message: "User not found" });

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
      console.error("[referral] GET /code error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  /**
   * GET /api/referral/stats
   * Returns the referrer's stats: signups, conversions, credit balance.
   */
  app.get("/api/referral/stats", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.user as any)?.id;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const org = await getOrCreateOrg(req as any);

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
        creditBalance: org.referralCredits ?? 0, // cents currently available
      });
    } catch (err) {
      console.error("[referral] GET /stats error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  /**
   * POST /api/referral/apply
   * Called after a new user registers if they came via ?ref=CODE.
   * Links the new user to the referrer. Non-blocking — errors are swallowed.
   *
   * Body: { code: string, refereeId: string }
   */
  app.post("/api/referral/apply", async (req, res) => {
    try {
      const { code, refereeId } = req.body as { code?: string; refereeId?: string };
      if (!code || !refereeId) return res.status(400).json({ message: "code and refereeId required" });

      // Find the referrer by code
      const [referrer] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.referralCode, code.toUpperCase()))
        .limit(1);

      if (!referrer) return res.status(404).json({ message: "Invalid referral code" });
      if (referrer.id === refereeId) return res.status(400).json({ message: "Cannot refer yourself" });

      // Upsert the referral row — update status to signed_up if it was pending
      const existing = await db
        .select()
        .from(referrals)
        .where(eq(referrals.code, code.toUpperCase()))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(referrals)
          .set({ refereeId, status: "signed_up" })
          .where(eq(referrals.code, code.toUpperCase()));
      } else {
        await db.insert(referrals).values({
          referrerId: referrer.id,
          refereeId,
          code: code.toUpperCase(),
          status: "signed_up",
        });
      }

      return res.json({ ok: true });
    } catch (err) {
      console.error("[referral] POST /apply error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  });
}

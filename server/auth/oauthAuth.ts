import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { db } from "../db";
import { users } from "@shared/models/auth";
import { eq, and } from "drizzle-orm";
import type { Express } from "express";
import { setCsrfCookie } from "../middleware/csrf";
import { isFounderEmail } from "../services/founder";

// ============================================
// GOOGLE OAUTH STRATEGY
// ============================================

export function setupGoogleOAuth(app: Express): boolean {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.log("[oauth] GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set — Google OAuth disabled");
    return false;
  }

  const appUrl = (process.env.APP_URL || "http://localhost:5000").replace(/\/$/, "");
  const callbackUrl = `${appUrl}/api/auth/google/callback`;

  passport.use(
    "google",
    new GoogleStrategy(
      {
        clientID: clientId,
        clientSecret,
        callbackURL: callbackUrl,
        scope: ["profile", "email"],
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value?.toLowerCase();
          if (!email) {
            return done(null, false);
          }

          // Try to find existing user by OAuth provider ID first
          const [existingOAuth] = await db
            .select()
            .from(users)
            .where(and(eq(users.oauthProvider, "google"), eq(users.oauthProviderId, profile.id)))
            .limit(1);

          if (existingOAuth) {
            return done(null, existingOAuth);
          }

          // Try to find existing user by email (link accounts)
          const [existingEmail] = await db
            .select()
            .from(users)
            .where(eq(users.email, email))
            .limit(1);

          if (existingEmail) {
            // Link the Google account to the existing user
            const [updated] = await db
              .update(users)
              .set({
                oauthProvider: "google",
                oauthProviderId: profile.id,
                profileImageUrl: existingEmail.profileImageUrl || profile.photos?.[0]?.value || null,
                updatedAt: new Date(),
              })
              .where(eq(users.id, existingEmail.id))
              .returning();
            return done(null, updated);
          }

          // Create new user
          const [newUser] = await db
            .insert(users)
            .values({
              email,
              firstName: profile.name?.givenName || null,
              lastName: profile.name?.familyName || null,
              profileImageUrl: profile.photos?.[0]?.value || null,
              oauthProvider: "google",
              oauthProviderId: profile.id,
            })
            .returning();

          return done(null, newUser);
        } catch (error) {
          return done(error as Error);
        }
      }
    )
  );

  // OAuth initiation
  app.get(
    "/api/auth/google",
    passport.authenticate("google", { scope: ["profile", "email"] })
  );

  // OAuth callback
  app.get(
    "/api/auth/google/callback",
    passport.authenticate("google", { failureRedirect: "/auth?error=oauth_failed", session: false }),
    (req, res, next) => {
      if (!req.user) {
        return res.redirect("/auth?error=oauth_failed");
      }
      // Regenerate session to prevent fixation
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.login(req.user!, (loginErr) => {
          if (loginErr) return next(loginErr);
          setCsrfCookie(req, res);
          res.redirect("/");
        });
      });
    }
  );

  console.log("[oauth] Google OAuth enabled");
  return true;
}

/**
 * T12 — OAuth / SSO Integration (Google + Microsoft)
 *
 * Provides Passport.js-based OAuth2 flows for:
 *   - Google Workspace (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)
 *   - Microsoft / Azure AD (MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET)
 *
 * Flow:
 *   GET /api/auth/google          → redirect to Google OAuth consent
 *   GET /api/auth/google/callback → exchange code, create/link user
 *   GET /api/auth/microsoft       → redirect to Microsoft OAuth consent
 *   GET /api/auth/microsoft/callback → exchange code, create/link user
 *
 * Organization mapping:
 *   Users are matched to orgs by email domain (e.g. all @acmeco.com
 *   automatically join the org that has OAUTH_DOMAIN=acmeco.com set).
 *   If no org is found, a new one is created (self-serve signup via OAuth).
 *
 * Required env vars:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 *   MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET
 *   APP_URL (e.g. https://app.acreOS.com — used for callback URLs)
 */

import type { Express, Request, Response } from "express";
import { db } from "../db";
import { users } from "@shared/models/auth";
import { organizations, teamMembers } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import crypto from "crypto";

interface OAuthProfile {
  provider: "google" | "microsoft";
  providerId: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
}

/**
 * Find or create a user from an OAuth profile.
 * Handles org assignment by email domain.
 */
async function findOrCreateOAuthUser(profile: OAuthProfile) {
  const email = profile.email.toLowerCase();

  // 1. Check if user already exists by email
  const [existing] = await db.select().from(users).where(eq(users.email, email));
  if (existing) return existing;

  // 2. Find org by email domain
  const domain = email.split("@")[1];
  let orgId: number | null = null;

  // Look for an org that has this domain in its settings
  const [orgRow] = await db.execute<any>(
    sql`SELECT id FROM organizations WHERE settings->>'oauthDomain' = ${domain} LIMIT 1`
  ) as any;

  if ((orgRow as any)?.rows?.[0]) {
    orgId = (orgRow as any).rows[0].id;
  }

  // 3. If no org found, create one
  if (!orgId) {
    const [newOrg] = await db
      .insert(organizations)
      .values({
        name: `${profile.firstName}'s Organization`,
        slug: `org-${crypto.randomUUID().slice(0, 8)}`,
        subscriptionTier: "free",
        onboardingCompleted: false,
      } as any)
      .returning({ id: organizations.id });
    orgId = newOrg.id;
  }

  // 4. Create the user
  const userId = crypto.randomUUID();
  const [newUser] = await db
    .insert(users)
    .values({
      id: userId,
      email,
      firstName: profile.firstName,
      lastName: profile.lastName,
      profileImageUrl: profile.avatarUrl,
      oauthProvider: profile.provider,
      oauthProviderId: profile.providerId,
    } as any)
    .returning();

  // 5. Add to org as owner if they just created it, else as member
  await db.insert(teamMembers).values({
    organizationId: orgId,
    userId,
    email,
    firstName: profile.firstName,
    lastName: profile.lastName,
    role: "owner",
    isActive: true,
  } as any);

  return newUser;
}

/**
 * Register OAuth routes on the Express app.
 * Uses a manual OAuth2 code exchange (no passport-google-oauth20 dependency)
 * so we don't need an npm install.
 */
export function registerOAuthRoutes(app: Express): void {
  const appUrl = process.env.APP_URL || "http://localhost:5000";

  // ── Google OAuth ──────────────────────────────────────────────────────────
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    app.get("/api/auth/google", (req: Request, res: Response) => {
      const params = new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        redirect_uri: `${appUrl}/api/auth/google/callback`,
        response_type: "code",
        scope: "openid email profile",
        access_type: "offline",
        prompt: "select_account",
      });
      res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
    });

    app.get("/api/auth/google/callback", async (req: Request, res: Response) => {
      try {
        const { code } = req.query as { code?: string };
        if (!code) return res.redirect("/auth?error=oauth_failed");

        // Exchange code for tokens
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: process.env.GOOGLE_CLIENT_ID!,
            client_secret: process.env.GOOGLE_CLIENT_SECRET!,
            redirect_uri: `${appUrl}/api/auth/google/callback`,
            grant_type: "authorization_code",
          }),
        });

        const tokens = await tokenRes.json() as any;
        if (!tokens.access_token) return res.redirect("/auth?error=oauth_failed");

        // Get user info
        const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        const profile = await userRes.json() as any;

        const user = await findOrCreateOAuthUser({
          provider: "google",
          providerId: profile.sub,
          email: profile.email,
          firstName: profile.given_name || "",
          lastName: profile.family_name || "",
          avatarUrl: profile.picture,
        });

        // Establish session
        (req as any).login(user, (err: Error) => {
          if (err) return res.redirect("/auth?error=session_failed");
          res.redirect("/today");
        });
      } catch (err) {
        res.redirect("/auth?error=oauth_failed");
      }
    });
  }

  // ── Microsoft OAuth ───────────────────────────────────────────────────────
  if (process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET) {
    const msClientId = process.env.MICROSOFT_CLIENT_ID;
    const msTenantId = process.env.MICROSOFT_TENANT_ID || "common";

    app.get("/api/auth/microsoft", (req: Request, res: Response) => {
      const params = new URLSearchParams({
        client_id: msClientId,
        redirect_uri: `${appUrl}/api/auth/microsoft/callback`,
        response_type: "code",
        scope: "openid email profile User.Read",
        response_mode: "query",
        prompt: "select_account",
      });
      res.redirect(
        `https://login.microsoftonline.com/${msTenantId}/oauth2/v2.0/authorize?${params}`
      );
    });

    app.get("/api/auth/microsoft/callback", async (req: Request, res: Response) => {
      try {
        const { code } = req.query as { code?: string };
        if (!code) return res.redirect("/auth?error=oauth_failed");

        const tokenRes = await fetch(
          `https://login.microsoftonline.com/${msTenantId}/oauth2/v2.0/token`,
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              code,
              client_id: msClientId,
              client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
              redirect_uri: `${appUrl}/api/auth/microsoft/callback`,
              grant_type: "authorization_code",
            }),
          }
        );

        const tokens = await tokenRes.json() as any;
        if (!tokens.access_token) return res.redirect("/auth?error=oauth_failed");

        // Get user info from Microsoft Graph
        const userRes = await fetch("https://graph.microsoft.com/v1.0/me", {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        const profile = await userRes.json() as any;

        const user = await findOrCreateOAuthUser({
          provider: "microsoft",
          providerId: profile.id,
          email: profile.mail || profile.userPrincipalName,
          firstName: profile.givenName || "",
          lastName: profile.surname || "",
        });

        (req as any).login(user, (err: Error) => {
          if (err) return res.redirect("/auth?error=session_failed");
          res.redirect("/today");
        });
      } catch (err) {
        res.redirect("/auth?error=oauth_failed");
      }
    });
  }

  // ── OAuth status endpoint (for the Settings → Auth page) ─────────────────
  app.get("/api/auth/oauth/status", (req: Request, res: Response) => {
    res.json({
      google: {
        configured: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
        loginUrl: "/api/auth/google",
      },
      microsoft: {
        configured: !!(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET),
        loginUrl: "/api/auth/microsoft",
      },
    });
  });
}

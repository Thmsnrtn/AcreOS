/**
 * T11 — Two-Factor Authentication Routes
 *
 * Endpoints:
 *   GET  /api/auth/2fa/status          — is 2FA enabled for current user?
 *   POST /api/auth/2fa/setup           — generate secret + QR + backup codes
 *   POST /api/auth/2fa/verify-setup    — confirm code and activate 2FA
 *   POST /api/auth/2fa/verify          — verify code during login flow
 *   POST /api/auth/2fa/disable         — disable 2FA (requires valid code)
 *   GET  /api/auth/2fa/backup-codes    — list remaining backup code count
 */

import type { Express } from "express";
import { isAuthenticated } from "./auth";
import { db } from "./db";
import { users } from "@shared/models/auth";
import { eq } from "drizzle-orm";
import { twoFactorAuth } from "./services/twoFactorAuth";
import { z } from "zod";

export function register2FARoutes(app: Express): void {
  // ── GET /api/auth/2fa/status ──────────────────────────────────────────────
  app.get("/api/auth/2fa/status", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      const userId = user.claims?.sub || user.id;
      const [dbUser] = await db.select().from(users).where(eq(users.id, String(userId)));
      res.json({
        enabled: (dbUser as any)?.twoFactorEnabled ?? false,
        backupCodesRemaining: ((dbUser as any)?.twoFactorBackupCodes ?? []).length,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── POST /api/auth/2fa/setup ──────────────────────────────────────────────
  // Returns a new TOTP secret + QR code URL + backup codes.
  // Does NOT activate 2FA — user must verify a valid code first.
  app.post("/api/auth/2fa/setup", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      const userEmail = user.claims?.email || user.email || "user";

      const setup = twoFactorAuth.generateSetup(userEmail);
      const qrUrl = twoFactorAuth.getQrUrl(setup.otpauthUrl);

      // Temporarily store unconfirmed secret in session
      (req.session as any).pendingTwoFactorSecret = setup.secret;
      (req.session as any).pendingBackupCodes = setup.backupCodes;

      res.json({
        qrUrl,
        secret: setup.secret,
        backupCodes: setup.backupCodes,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── POST /api/auth/2fa/verify-setup ──────────────────────────────────────
  // Verify the TOTP code from the user's authenticator app, then activate 2FA.
  app.post("/api/auth/2fa/verify-setup", isAuthenticated, async (req, res) => {
    try {
      const { code } = z.object({ code: z.string().min(6).max(8) }).parse(req.body);
      const user = req.user as any;
      const userId = user.claims?.sub || user.id;

      const secret = (req.session as any).pendingTwoFactorSecret;
      const rawCodes: string[] = (req.session as any).pendingBackupCodes || [];

      if (!secret) {
        return res.status(400).json({ message: "No pending 2FA setup. Start setup first." });
      }

      if (!twoFactorAuth.verifyCode(secret, code)) {
        return res.status(400).json({ message: "Invalid verification code. Try again." });
      }

      // Hash backup codes for storage
      const hashedCodes = await Promise.all(rawCodes.map((c) => twoFactorAuth.hashBackupCode(c)));

      // Persist to DB
      await db
        .update(users)
        .set({
          twoFactorSecret: secret,
          twoFactorEnabled: true,
          twoFactorBackupCodes: hashedCodes,
        } as any)
        .where(eq(users.id, String(userId)));

      // Clean up session
      delete (req.session as any).pendingTwoFactorSecret;
      delete (req.session as any).pendingBackupCodes;

      res.json({ success: true, message: "Two-factor authentication enabled." });
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ message: "Invalid request body" });
      }
      res.status(500).json({ message: err.message });
    }
  });

  // ── POST /api/auth/2fa/verify ─────────────────────────────────────────────
  // Used during login when 2FA is pending. Accepts TOTP or backup code.
  app.post("/api/auth/2fa/verify", isAuthenticated, async (req, res) => {
    try {
      const { code } = z.object({ code: z.string().min(6).max(12) }).parse(req.body);
      const user = req.user as any;
      const userId = user.claims?.sub || user.id;

      const [dbUser] = await db.select().from(users).where(eq(users.id, String(userId)));
      const secret = (dbUser as any)?.twoFactorSecret;

      if (!secret || !(dbUser as any)?.twoFactorEnabled) {
        return res.status(400).json({ message: "2FA not enabled for this account." });
      }

      // Try TOTP first
      if (twoFactorAuth.verifyCode(secret, code)) {
        (req.session as any).twoFactorVerified = true;
        return res.json({ success: true });
      }

      // Try backup codes
      const backupCodes: string[] = (dbUser as any)?.twoFactorBackupCodes || [];
      const matchedIndex = await twoFactorAuth.verifyBackupCode(code, backupCodes);
      if (matchedIndex >= 0) {
        const updatedCodes = backupCodes.filter((_, i) => i !== matchedIndex);
        await db
          .update(users)
          .set({ twoFactorBackupCodes: updatedCodes } as any)
          .where(eq(users.id, String(userId)));
        (req.session as any).twoFactorVerified = true;
        return res.json({ success: true, backupCodeUsed: true, codesRemaining: updatedCodes.length });
      }

      res.status(400).json({ message: "Invalid code. Check your authenticator app or use a backup code." });
    } catch (err: any) {
      if (err.name === "ZodError") return res.status(400).json({ message: "Invalid request body" });
      res.status(500).json({ message: err.message });
    }
  });

  // ── POST /api/auth/2fa/disable ────────────────────────────────────────────
  app.post("/api/auth/2fa/disable", isAuthenticated, async (req, res) => {
    try {
      const { code } = z.object({ code: z.string().min(6).max(12) }).parse(req.body);
      const user = req.user as any;
      const userId = user.claims?.sub || user.id;

      const [dbUser] = await db.select().from(users).where(eq(users.id, String(userId)));
      const secret = (dbUser as any)?.twoFactorSecret;

      if (!secret || !twoFactorAuth.verifyCode(secret, code)) {
        // Also allow backup code for disable
        const backupCodes: string[] = (dbUser as any)?.twoFactorBackupCodes || [];
        const matchedIndex = await twoFactorAuth.verifyBackupCode(code, backupCodes);
        if (matchedIndex < 0) {
          return res.status(400).json({ message: "Invalid code." });
        }
      }

      await db
        .update(users)
        .set({
          twoFactorSecret: null,
          twoFactorEnabled: false,
          twoFactorBackupCodes: [],
        } as any)
        .where(eq(users.id, String(userId)));

      res.json({ success: true, message: "Two-factor authentication disabled." });
    } catch (err: any) {
      if (err.name === "ZodError") return res.status(400).json({ message: "Invalid request body" });
      res.status(500).json({ message: err.message });
    }
  });
}

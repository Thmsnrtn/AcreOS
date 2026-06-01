/**
 * /api/me/ai-disclosure — Constitution §7 + Colorado SB 24-205 consent gate.
 *
 * Why this exists: The constitution's Immutable §7 requires AcreOS to
 * "Always disclose AI use clearly to every customer at first interaction."
 * Colorado SB 24-205 (effective Feb 1, 2026) independently mandates written
 * disclosure before AI-driven output is rendered to consumers, with an
 * auditable record of acknowledgement. A localStorage flag is not auditable.
 *
 * This module provides two endpoints:
 *
 *   GET  /api/me/ai-disclosure/status
 *     Returns { disclosed: boolean, version: string | null, at: string | null }.
 *     The client gates onboarding-v2 on this response; while disclosed===false
 *     the AiDisclosureDialog is shown and further interaction is blocked.
 *
 *   POST /api/me/ai-disclosure/accept
 *     Body: { version: string }  (e.g. "v1")
 *     Idempotent write. First call writes ai_disclosed_at = now() and
 *     ai_disclosure_version = version. Repeating with the SAME version is a
 *     no-op. Repeating with a DIFFERENT version (wording bump by Beatrice)
 *     overwrites so re-consent is recorded. Returns 200 with the current
 *     stored state.
 *
 * Auth: isAuthenticated only — no org context required. Disclosure is a
 * per-user fact; the same user joining a second org inherits their prior
 * consent if the version matches.
 */

import { Router, type Response } from "express";
import { eq, and, isNull, or, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { users } from "@shared/models/auth";
import type { AuthenticatedRequest } from "./types/request";
import { getUserId } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

const router = Router();

// ── GET /status ─────────────────────────────────────────────────────────────

router.get("/status", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserId(req);

    const [row] = await db
      .select({
        aiDisclosedAt: users.aiDisclosedAt,
        aiDisclosureVersion: users.aiDisclosureVersion,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!row) {
      // Should never happen — isAuthenticated guarantees a user row exists.
      return Errors.notFound(res, "User");
    }

    return res.json({
      disclosed: row.aiDisclosedAt !== null,
      version: row.aiDisclosureVersion ?? null,
      at: row.aiDisclosedAt ? row.aiDisclosedAt.toISOString() : null,
    });
  } catch (error) {
    logger.error("[ai-disclosure] status check failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return Errors.internal(res, error);
  }
});

// ── POST /accept ─────────────────────────────────────────────────────────────

const acceptSchema = z.object({
  version: z.string().min(1).max(32),
});

router.post("/accept", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserId(req);

    const parsed = acceptSchema.safeParse(req.body);
    if (!parsed.success) {
      return Errors.validationFailed(res, parsed.error.issues);
    }
    const { version } = parsed.data;

    // Idempotent upsert:
    //   - First-time consent (ai_disclosed_at IS NULL)  → write.
    //   - Same version repeated                         → WHERE excludes the
    //     row; UPDATE touches 0 rows. Re-read returns existing state.
    //   - Version bump (wording change)                 → WHERE matches again;
    //     new consent supersedes old.
    //
    // The compound WHERE: id = $1 AND (ai_disclosed_at IS NULL OR ai_disclosure_version != $2)
    const now = new Date();
    await db
      .update(users)
      .set({
        aiDisclosedAt: now,
        aiDisclosureVersion: version,
        updatedAt: now,
      })
      .where(
        and(
          eq(users.id, userId),
          or(
            isNull(users.aiDisclosedAt),
            ne(users.aiDisclosureVersion, version),
          ),
        ),
      );

    // Re-read the canonical state — covers the no-op path too.
    const [row] = await db
      .select({
        aiDisclosedAt: users.aiDisclosedAt,
        aiDisclosureVersion: users.aiDisclosureVersion,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!row) {
      return Errors.notFound(res, "User");
    }

    logger.info("[ai-disclosure] consent accepted", {
      userId,
      version,
      at: (row.aiDisclosedAt ?? now).toISOString(),
    });

    return res.json({
      disclosed: true,
      version: row.aiDisclosureVersion ?? version,
      at: row.aiDisclosedAt ? row.aiDisclosedAt.toISOString() : now.toISOString(),
    });
  } catch (error) {
    logger.error("[ai-disclosure] accept failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return Errors.internal(res, error);
  }
});

export default router;

/**
 * /api/pax/acknowledge-disclosure — Phase Zero-Three gate (Beatrice audit
 * 2026-06-01). Constitution §7 + CO SB 24-205 §6-1-1703 evidentiary trail.
 *
 * Why this exists: The prior gate was a `localStorage` key
 * (`pax_greeting_dismissed`) that suppressed the welcome banner on
 * subsequent visits. localStorage is not auditable. A subpoena from CO AG
 * under SB 24-205 (or a plaintiff's class-cert exhibit) cannot rely on a
 * browser-local flag. The server records the timestamp once on first
 * acknowledgement; the row is the evidentiary artifact.
 *
 *   POST /api/pax/acknowledge-disclosure
 *     Body: {} (no payload needed — versioning is handled via the
 *     onboarding-entry ai_disclosure_version row, which is the consent of
 *     record. This column is the first-interaction surface acknowledgement,
 *     stamped once.)
 *     Idempotent: if pax_disclosure_acknowledged_at IS NULL, sets it to
 *     now(). If already non-null, no-op. Returns the canonical user payload
 *     shape so the client can update the `/api/auth/user` cache without a
 *     re-fetch round-trip.
 *
 * Auth: isAuthenticated only — per-user fact, no org context required.
 */

import { Router, type Response } from "express";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "./db";
import { users } from "@shared/models/auth";
import type { AuthenticatedRequest } from "./types/request";
import { getUserId } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

const router = Router();

router.post("/acknowledge-disclosure", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const now = new Date();

    // Idempotent set — UPDATE matches only when the column is still null.
    // Re-posting after acknowledgement touches 0 rows; the re-SELECT below
    // returns the existing timestamp.
    await db
      .update(users)
      .set({
        paxDisclosureAcknowledgedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(users.id, userId),
          isNull(users.paxDisclosureAcknowledgedAt),
        ),
      );

    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!row) {
      return Errors.notFound(res, "User");
    }

    logger.info("[pax-disclosure] acknowledged", {
      userId,
      at: (row.paxDisclosureAcknowledgedAt ?? now).toISOString(),
    });

    // Return the canonical user payload so the client can update the
    // /api/auth/user TanStack cache without a follow-up GET.
    return res.json(row);
  } catch (error) {
    logger.error("[pax-disclosure] acknowledge failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return Errors.internal(res, error);
  }
});

export default router;

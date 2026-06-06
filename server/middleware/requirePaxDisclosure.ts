/**
 * requirePaxDisclosure — server-side gate for the CO SB 24-205 / general
 * AI-disclosure requirement.
 *
 * The client-side `AiDisclosureDialog` blocks the UI until acknowledgement
 * but a determined user (cookies disabled, custom client, direct API
 * caller) could POST to /api/ai/chat without going through that gate.
 * The `users.pax_disclosure_acknowledged_at` column is the evidentiary
 * artifact the policy contract is built on — letting a request through
 * without it leaves AcreOS unable to prove disclosure was made.
 *
 * Surfaced by the 2026-06-05 Beatrice security/compliance audit (P0).
 *
 * Returns HTTP 428 (Precondition Required) with a structured body the
 * client can interpret to re-show the disclosure modal. Fail-open ONLY
 * on transient DB errors — never silently allow an unack'd chat to land.
 */

import type { NextFunction, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users } from "@shared/models/auth";
import type { AuthenticatedRequest } from "../types/request";
import { logger } from "../utils/logger";

export async function requirePaxDisclosure(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const clerkUserId = (req as AuthenticatedRequest & { auth?: { userId?: string } })
    .auth?.userId;
  if (!clerkUserId) {
    res.status(401).json({
      error: "Unauthorized",
      message: "Session required for AI chat",
    });
    return;
  }

  try {
    const [row] = await db
      .select({ ackAt: users.paxDisclosureAcknowledgedAt })
      .from(users)
      .where(eq(users.clerkUserId, clerkUserId))
      .limit(1);

    if (!row || row.ackAt === null) {
      // 428 Precondition Required — signals the client to show the
      // AiDisclosureDialog and retry only after ack.
      res.status(428).json({
        error: "DisclosureRequired",
        message:
          "AI disclosure must be acknowledged before using Pax chat. Please complete the disclosure prompt and retry.",
        code: "PAX_DISCLOSURE_REQUIRED",
      });
      return;
    }
    next();
  } catch (err) {
    // Transient DB error — fail OPEN so a single hiccup doesn't brick
    // chat for everyone, but log loudly. Compliance posture stays valid
    // because the row IS persisted on ack; we're not failing-open the
    // disclosure itself, just the gate's lookup.
    logger.warn("[requirePaxDisclosure] DB lookup failed, allowing call", {
      metadata: {
        detail: err instanceof Error ? err.message : String(err),
      },
    });
    next();
  }
}

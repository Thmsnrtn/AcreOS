/**
 * SOLENE — proactive page channel endpoint.
 *
 *   POST /api/internal/solene/page
 *     Body: { severity: 'urgent' | 'critical', subject: string, body: string }
 *     Auth: shared-secret header `X-Solene-Page-Secret` matching env
 *           SOLENE_PAGE_SECRET. Lets Solene fire pages without a Clerk
 *           session — she's not a customer user.
 *     Response: { eventId, deliveryStatus, deliveryDetail }
 *
 *   GET /api/founder/solene-page/recent
 *     Auth: isAuthenticated + requireFounder (no shared-secret bypass)
 *     Returns the last 50 page events so Tom can audit Solene's page
 *     discipline during the weekly retro pass.
 *
 * Page-worthy discipline (NOT enforced in code — see
 * docs/internal/solene-page-discipline.md): production 5xx spike, AWS
 * production-access decision, LLC formation status change, customer-facing
 * constitutional violation, active exploitation attempt. Routine work
 * landing / agent completions are NOT page-worthy.
 */

import type { Express, Request, Response, NextFunction } from "express";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { solenePageEvents } from "@shared/schema/solene-page";
import { isAuthenticated, requireFounder } from "./auth";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { sendSolenePage } from "./services/solene/pagerService";
import { logger } from "./utils/logger";

const RECENT_PAGES_LIMIT = 50;
const MAX_SUBJECT_LEN = 200;
const MAX_BODY_LEN = 2000;

const PageRequestSchema = z.object({
  severity: z.enum(["urgent", "critical"]),
  subject: z.string().min(1).max(MAX_SUBJECT_LEN),
  body: z.string().min(1).max(MAX_BODY_LEN),
});

/**
 * Shared-secret check. Constant-time-ish via Buffer comparison so timing
 * attacks against the secret are infeasible. Mismatched / missing secret
 * → 401, with a generic message to avoid leaking whether the env is set.
 */
function checkPageSecret(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.SOLENE_PAGE_SECRET;
  if (!expected || expected.length === 0) {
    logger.warn("[solene-page] SOLENE_PAGE_SECRET not set — endpoint disabled");
    Errors.unauthorized(res);
    return;
  }
  const provided = req.headers["x-solene-page-secret"];
  if (typeof provided !== "string" || provided.length === 0) {
    Errors.unauthorized(res);
    return;
  }
  // Length compare first to keep timing roughly uniform on the hot path.
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    Errors.unauthorized(res);
    return;
  }
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a[i] ^ b[i];
  }
  if (mismatch !== 0) {
    Errors.unauthorized(res);
    return;
  }
  next();
}

export function registerSolenePageRoutes(app: Express): void {
  // INTERNAL — fire a page to Tom. Shared-secret auth (Solene is not a
  // Clerk-authed user; she's the orchestrator).
  app.post(
    "/api/internal/solene/page",
    checkPageSecret,
    async (req: Request, res: Response) => {
      try {
        const parsed = PageRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          return Errors.validationFailed(res, parsed.error.issues);
        }
        const { severity, subject, body } = parsed.data;
        const result = await sendSolenePage({ severity, subject, body });
        return res.status(200).json({
          eventId: result.eventId,
          deliveryStatus: result.deliveryStatus,
          deliveryDetail: result.deliveryDetail,
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // FOUNDER — last 50 page events for audit review.
  app.get(
    "/api/founder/solene-page/recent",
    isAuthenticated,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const events = await db
          .select()
          .from(solenePageEvents)
          .orderBy(desc(solenePageEvents.firedAt))
          .limit(RECENT_PAGES_LIMIT);
        return res.json({ events });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );
}

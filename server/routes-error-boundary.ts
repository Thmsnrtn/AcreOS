/**
 * SOLENE — customer-surface ErrorBoundary trip endpoints.
 *
 *   POST /api/client/error-boundary-trip
 *     Auth: open (the boundary fires BEFORE the auth context is necessarily
 *           hydrated; the trip should be ledger'd even for anonymous sessions).
 *     Rate-limited per (user-or-IP, route_path) so a runaway component can't
 *     loop-fire and flood the table. Fired-and-forget from the client.
 *     Body: { errorId, errorName, errorMessageExcerpt, routePath,
 *             componentStackExcerpt?, clientMeta? }
 *     Response: { tripId: number | null }
 *
 *   GET /api/founder/error-boundary-trips/recent
 *     Auth: isAuthenticated + requireFounder
 *     Query: ?days=7 (1-30)
 *     Response: { trips: ErrorBoundaryTrip[], windowDays }
 *
 * NOT a customer-visible surface — the POST is fire-and-forget from the
 * existing ErrorBoundary component; the GET is founder-only diagnostic.
 */

import type { Express, Request, Response } from "express";
import { and, desc, gte } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import {
  errorBoundaryTrips,
  ERROR_BOUNDARY_CONTENT_EXCERPT_CHARS,
  ERROR_BOUNDARY_SEVERITIES,
} from "@shared/schema/error-boundary-trips";
import { isAuthenticated, requireFounder } from "./auth";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { createRateLimiter } from "./middleware/rateLimit";

const MAX_ERROR_NAME_LEN = 200;
const MAX_ROUTE_PATH_LEN = 500;
const DEFAULT_RECENT_DAYS = 7;
const MAX_RECENT_DAYS = 30;

// Per (user-or-IP, route) limiter — 10 trips/min/route. A single boundary
// looping (e.g. a useEffect that re-throws on every retry) would saturate
// at 10/min instead of flooding the table.
const tripLimiter = createRateLimiter(
  { maxRequests: 10, windowMs: 60 * 1000 },
  (req: Request) => {
    const userId =
      (req as { user?: { id?: string } }).user?.id ?? "anon";
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const routePath = String(
      (req.body as { routePath?: string } | undefined)?.routePath ?? "/",
    ).slice(0, MAX_ROUTE_PATH_LEN);
    return `eb-trip:${userId}:${ip}:${routePath}`;
  },
);

const PostBodySchema = z.object({
  errorId: z.string().min(1).max(200),
  errorName: z.string().min(1).max(MAX_ERROR_NAME_LEN),
  errorMessageExcerpt: z.string().max(ERROR_BOUNDARY_CONTENT_EXCERPT_CHARS),
  routePath: z.string().min(1).max(MAX_ROUTE_PATH_LEN),
  componentStackExcerpt: z
    .string()
    .max(ERROR_BOUNDARY_CONTENT_EXCERPT_CHARS * 4)
    .optional(),
  clientMeta: z.record(z.string(), z.unknown()).optional(),
  severity: z.enum(ERROR_BOUNDARY_SEVERITIES).optional(),
});

const RecentQuerySchema = z.object({
  days: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_RECENT_DAYS)
    .default(DEFAULT_RECENT_DAYS),
});

export function registerErrorBoundaryRoutes(app: Express): void {
  // CLIENT — record an ErrorBoundary trip. No Clerk auth required (the
  // boundary may fire pre-hydration). User + org are looked up from the
  // session if present; otherwise the row is anonymous.
  app.post(
    "/api/client/error-boundary-trip",
    tripLimiter,
    async (req: Request, res: Response) => {
      try {
        const parsed = PostBodySchema.safeParse(req.body);
        if (!parsed.success) {
          return Errors.validationFailed(res, parsed.error.issues);
        }
        const input = parsed.data;

        // Best-effort user/org lookup from the augmented request — never
        // required, never throws. The boundary's primary job is to keep the
        // trip captured even when auth never resolved.
        const augmented = req as {
          user?: { id?: string };
          organizationId?: number;
        };
        const userId = augmented.user?.id ?? null;
        const organizationId =
          typeof augmented.organizationId === "number"
            ? augmented.organizationId
            : null;

        const [row] = await db
          .insert(errorBoundaryTrips)
          .values({
            errorId: input.errorId,
            errorName: input.errorName.slice(0, MAX_ERROR_NAME_LEN),
            errorMessageExcerpt: input.errorMessageExcerpt.slice(
              0,
              ERROR_BOUNDARY_CONTENT_EXCERPT_CHARS,
            ),
            routePath: input.routePath.slice(0, MAX_ROUTE_PATH_LEN),
            userId,
            organizationId,
            componentStackExcerpt:
              input.componentStackExcerpt?.slice(
                0,
                ERROR_BOUNDARY_CONTENT_EXCERPT_CHARS * 4,
              ) ?? null,
            clientMeta: input.clientMeta ?? null,
            severity: input.severity ?? "warn",
          })
          .returning({ id: errorBoundaryTrips.id });

        // Best-effort log so the trip surfaces in aggregator logs even
        // before the next aggregator tick.
        logger.warn("[errorBoundaryTrip] captured", {
          metadata: {
            errorId: input.errorId,
            errorName: input.errorName,
            routePath: input.routePath,
            tripId: row?.id ?? null,
          },
        });

        return res.status(202).json({ tripId: row?.id ?? null });
      } catch (err) {
        // Never propagate — fired-and-forget contract from the client.
        logger.error(
          "[errorBoundaryTrip] insert failed",
          err instanceof Error ? err : undefined,
        );
        return res.status(202).json({ tripId: null });
      }
    },
  );

  // FOUNDER — recent trips for the diagnostic surface.
  app.get(
    "/api/founder/error-boundary-trips/recent",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const parsed = RecentQuerySchema.safeParse(req.query);
        if (!parsed.success) {
          return Errors.validationFailed(res, parsed.error.issues);
        }
        const { days } = parsed.data;
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        const trips = await db
          .select()
          .from(errorBoundaryTrips)
          .where(and(gte(errorBoundaryTrips.firedAt, cutoff)))
          .orderBy(desc(errorBoundaryTrips.firedAt))
          .limit(500);

        return res.json({ trips, windowDays: days });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );
}

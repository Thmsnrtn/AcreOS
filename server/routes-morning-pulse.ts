/**
 * Solene (COO) — morning-pulse founder HTTP surface (Phase 7).
 *
 *   GET  /api/founder/solene/morning-pulse           — latest cached snapshot
 *                                                      (falls back to live
 *                                                      compute when no row
 *                                                      exists yet)
 *   POST /api/founder/solene/morning-pulse/refresh   — force re-compute +
 *                                                      persist
 *
 * Auth: isAuthenticated + requireFounder (returns 404 for non-founder per
 * the existing dispatch-routes pattern).
 *
 * The Today page consumes GET / for the live one-line. The 12:00 UTC cron
 * keeps the cache fresh; this endpoint is the read surface.
 */

import type { Express, Response } from "express";
import { isAuthenticated, requireFounder } from "./auth";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import {
  composeMorningPulse,
  getLatestMorningPulse,
  persistMorningPulse,
} from "@acreos/solene";
import { logger } from "./utils/logger";

export function registerMorningPulseRoutes(app: Express): void {
  // ── GET cached (or fall through to live) ────────────────────────────────
  app.get(
    "/api/founder/solene/morning-pulse",
    isAuthenticated,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const latest = await getLatestMorningPulse();
        if (latest) {
          return res.json({ pulse: latest, freshFromCache: true });
        }
        // No cached pulse yet — compose live and best-effort persist for
        // next time. Persistence failures are swallowed so the caller
        // still gets the live snapshot.
        const live = await composeMorningPulse();
        await persistMorningPulse(live).catch((err) => {
          logger.warn(
            "[morning-pulse] persist after fallback compute failed",
            err instanceof Error ? err : undefined,
          );
        });
        return res.json({ pulse: live, freshFromCache: false });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── POST force re-compute ──────────────────────────────────────────────
  app.post(
    "/api/founder/solene/morning-pulse/refresh",
    isAuthenticated,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const live = await composeMorningPulse();
        const persisted = await persistMorningPulse(live);
        return res.json({ pulse: live, pulseId: persisted.pulseId });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );
}

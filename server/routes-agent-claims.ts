/**
 * Solene (Layer 1 cap #2) — agent-claims founder visibility endpoint.
 *
 *   GET /api/founder/agent-claims/active
 *     Returns currently-active solene_agent_claims rows with patterns,
 *     age (seconds since claimed_at), and remaining-ttl (when positive).
 *
 * Auth: isAuthenticated + requireFounder.
 *
 * No write endpoints here — claimSurfaces / releaseClaim are dispatch-time
 * primitives invoked by Solene's planning code, not surfaced to the founder
 * UI yet (deferred until the dispatch UI lands in keystone 1).
 */

import type { Express, Response } from "express";
import { isAuthenticated, requireFounder } from "./auth";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { listActiveClaims } from "./services/solene/agentClaims";
import { logger } from "./utils/logger";

export function registerAgentClaimsRoutes(app: Express): void {
  app.get(
    "/api/founder/agent-claims/active",
    isAuthenticated,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const claims = await listActiveClaims();
        const now = Date.now();
        const enriched = claims.map((c) => {
          const claimedMs = c.claimedAt.getTime();
          const ageSeconds = Math.floor((now - claimedMs) / 1000);
          const ttlMs = c.ttlMinutes * 60_000;
          const remainingSeconds = Math.max(
            0,
            Math.floor((claimedMs + ttlMs - now) / 1000),
          );
          return {
            id: c.id,
            dispatchId: c.dispatchId,
            agentRole: c.agentRole,
            claimedAt: c.claimedAt,
            ttlMinutes: c.ttlMinutes,
            ageSeconds,
            remainingSeconds,
            patterns: c.fileSurfacePatterns ?? [],
            note: c.note,
          };
        });
        return res.json({
          claims: enriched,
          summary: {
            total: enriched.length,
            byAgentRole: enriched.reduce<Record<string, number>>((acc, c) => {
              acc[c.agentRole] = (acc[c.agentRole] ?? 0) + 1;
              return acc;
            }, {}),
          },
        });
      } catch (err) {
        logger.error("[agent-claims] active-list failed", { err: String(err) });
        return Errors.internal(res, err);
      }
    },
  );
}

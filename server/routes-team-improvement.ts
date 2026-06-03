/**
 * Team-improvement detector — founder read endpoints.
 *
 *   GET /api/founder/team-improvement/recent
 *     Last 30 days of opportunities. Optional query: ?member=<m>,
 *     ?severity=<s>, ?auto_dispatched=true|false. Sorted by detected_at desc.
 *
 *   GET /api/founder/team-improvement/pending
 *     Opportunities NOT auto-dispatched (queued for Solene review).
 *     Sorted by severity (urgent > opportunity > info) then detected_at desc.
 *
 * Auth: isAuthenticated + requireFounder. The detector layer surfaces what
 * it found; resolution + dispatch happen elsewhere (auto via
 * autoDispatch.ts, manually via the chat surface).
 */

import type { Express, Response } from "express";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import {
  teamImprovementOpportunities,
  TEAM_IMPROVEMENT_MEMBERS,
  TEAM_IMPROVEMENT_SEVERITIES,
  type TeamImprovementMember,
  type TeamImprovementSeverity,
} from "@shared/schema/team-improvement";
import { isAuthenticated, requireFounder } from "./auth";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";

const RECENT_DAYS = 30;
const RECENT_LIMIT = 500;
const PENDING_LIMIT = 200;

// Severity ranking for the pending sort.
const SEVERITY_RANK: Record<TeamImprovementSeverity, number> = {
  urgent: 0,
  opportunity: 1,
  info: 2,
};

export function registerTeamImprovementRoutes(app: Express): void {
  // FOUNDER — last 30 days of opportunities, with optional filters.
  app.get(
    "/api/founder/team-improvement/recent",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const since = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000);
        const conditions = [
          gte(teamImprovementOpportunities.detectedAt, since),
        ];

        const memberRaw = req.query.member;
        if (typeof memberRaw === "string") {
          if (
            !TEAM_IMPROVEMENT_MEMBERS.includes(memberRaw as TeamImprovementMember)
          ) {
            return Errors.badRequest(
              res,
              `Invalid member; must be one of ${TEAM_IMPROVEMENT_MEMBERS.join(", ")}`,
            );
          }
          conditions.push(
            eq(teamImprovementOpportunities.teamMember, memberRaw),
          );
        }

        const severityRaw = req.query.severity;
        if (typeof severityRaw === "string") {
          if (
            !TEAM_IMPROVEMENT_SEVERITIES.includes(
              severityRaw as TeamImprovementSeverity,
            )
          ) {
            return Errors.badRequest(
              res,
              `Invalid severity; must be one of ${TEAM_IMPROVEMENT_SEVERITIES.join(", ")}`,
            );
          }
          conditions.push(eq(teamImprovementOpportunities.severity, severityRaw));
        }

        const autoRaw = req.query.auto_dispatched;
        if (typeof autoRaw === "string") {
          if (autoRaw !== "true" && autoRaw !== "false") {
            return Errors.badRequest(
              res,
              "auto_dispatched must be 'true' or 'false'",
            );
          }
          conditions.push(
            eq(
              teamImprovementOpportunities.autoDispatched,
              autoRaw === "true",
            ),
          );
        }

        const rows = await db
          .select()
          .from(teamImprovementOpportunities)
          .where(and(...conditions))
          .orderBy(desc(teamImprovementOpportunities.detectedAt))
          .limit(RECENT_LIMIT);

        // Headline counters for the founder UI.
        const summary = {
          totalRows: rows.length,
          autoDispatchedCount: rows.filter((r) => r.autoDispatched).length,
          pendingCount: rows.filter(
            (r) => !r.autoDispatched && r.resolvedAt === null,
          ).length,
          resolvedCount: rows.filter((r) => r.resolvedAt !== null).length,
          byMember: countBy(rows, (r) => r.teamMember),
          bySeverity: countBy(rows, (r) => r.severity),
          byPattern: countBy(rows, (r) => r.signalPattern),
        };

        return res.json({
          windowDays: RECENT_DAYS,
          opportunities: rows,
          summary,
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // FOUNDER — pending (NOT auto-dispatched, NOT resolved). The queue for
  // Solene-in-the-loop.
  app.get(
    "/api/founder/team-improvement/pending",
    isAuthenticated,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const rows = await db
          .select()
          .from(teamImprovementOpportunities)
          .where(
            and(
              eq(teamImprovementOpportunities.autoDispatched, false),
              sql`${teamImprovementOpportunities.resolvedAt} IS NULL`,
            ),
          )
          .orderBy(desc(teamImprovementOpportunities.detectedAt))
          .limit(PENDING_LIMIT);

        // Re-sort: severity first (urgent > opportunity > info), then
        // detectedAt desc within bucket.
        const sorted = [...rows].sort((a, b) => {
          const rA = SEVERITY_RANK[a.severity as TeamImprovementSeverity] ?? 9;
          const rB = SEVERITY_RANK[b.severity as TeamImprovementSeverity] ?? 9;
          if (rA !== rB) return rA - rB;
          const tA = a.detectedAt?.getTime?.() ?? 0;
          const tB = b.detectedAt?.getTime?.() ?? 0;
          return tB - tA;
        });

        return res.json({
          totalPending: sorted.length,
          opportunities: sorted,
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );
}

// ============================================================================
// HELPERS
// ============================================================================

function countBy<T, K extends string>(
  arr: T[],
  key: (t: T) => K,
): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const item of arr) {
    const k = key(item);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

// Silence unused-import warnings on imports kept for code-search hygiene.
void inArray;

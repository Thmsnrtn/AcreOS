/**
 * Solene v3 — TEAM-SYSTEM audit founder read endpoints.
 *
 *   GET /api/founder/team-system-audit/recent
 *       Last 30 runs + per-dimension finding counts. Surface for the
 *       morning brief's "team-as-a-system" line.
 *
 *   GET /api/founder/team-system-audit/findings?dimension=...&severity=...
 *       Drill-down — recent findings filtered by dimension and/or severity.
 *       Caps at 500 rows per call.
 *
 * Auth: isAuthenticated + requireFounder. No founder-side UI ships with
 * this — the endpoints are the read-only surface Solene consults during
 * weekly retros and the morning brief composer reads at digest time.
 */

import type { Express, Response } from "express";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import {
  teamSystemAuditRuns,
  teamSystemAuditFindings,
  TEAM_SYSTEM_AUDIT_DIMENSIONS,
  TEAM_SYSTEM_AUDIT_SEVERITIES,
  type TeamSystemAuditDimension,
  type TeamSystemAuditSeverity,
} from "@shared/schema/team-system-audit";
import { isAuthenticated, requireFounder } from "./auth";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";

const RECENT_RUNS_LIMIT = 30;
const MAX_FINDINGS_PER_QUERY = 500;
const FINDINGS_WINDOW_DAYS = 30;

export function registerTeamSystemAuditRoutes(app: Express): void {
  // FOUNDER — last 30 runs + per-dimension finding counts.
  app.get(
    "/api/founder/team-system-audit/recent",
    isAuthenticated,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const runs = await db
          .select()
          .from(teamSystemAuditRuns)
          .orderBy(desc(teamSystemAuditRuns.runStartedAt))
          .limit(RECENT_RUNS_LIMIT);

        if (runs.length === 0) {
          return res.json({
            runs: [],
            summary: {
              totalRuns: 0,
              driftSignalCount: 0,
              totalFindings: 0,
              byDimension: {},
            },
          });
        }

        const runIds = runs.map((r) => r.id);
        const countRows = await db
          .select({
            runId: teamSystemAuditFindings.runId,
            dimension: teamSystemAuditFindings.dimension,
            severity: teamSystemAuditFindings.severity,
            count: sql<number>`COUNT(*)::int`,
          })
          .from(teamSystemAuditFindings)
          // inArray, not raw `= ANY(${jsArray})` — drizzle binds a JS array
          // param in a shape Postgres rejects, which 500'd /founder/build
          // whenever at least one audit run existed (2026-07-11 sweep).
          .where(inArray(teamSystemAuditFindings.runId, runIds))
          .groupBy(
            teamSystemAuditFindings.runId,
            teamSystemAuditFindings.dimension,
            teamSystemAuditFindings.severity,
          );

        const perRun = new Map<
          number,
          Record<string, { total: number; bySeverity: Record<string, number> }>
        >();
        for (const row of countRows) {
          const runBucket = perRun.get(row.runId) ?? {};
          const dimBucket = runBucket[row.dimension] ?? {
            total: 0,
            bySeverity: {},
          };
          const cnt = Number(row.count);
          dimBucket.total += cnt;
          dimBucket.bySeverity[row.severity] =
            (dimBucket.bySeverity[row.severity] ?? 0) + cnt;
          runBucket[row.dimension] = dimBucket;
          perRun.set(row.runId, runBucket);
        }

        const enrichedRuns = runs.map((r) => ({
          ...r,
          findingsByDimension: perRun.get(r.id) ?? {},
        }));

        // Cross-run summary.
        const byDimension: Record<string, number> = {};
        for (const d of TEAM_SYSTEM_AUDIT_DIMENSIONS) byDimension[d] = 0;
        let totalFindings = 0;
        for (const r of enrichedRuns) {
          for (const [dim, bucket] of Object.entries(r.findingsByDimension)) {
            byDimension[dim] = (byDimension[dim] ?? 0) + bucket.total;
            totalFindings += bucket.total;
          }
        }

        const summary = {
          totalRuns: runs.length,
          driftSignalCount: runs.filter((r) => r.driftSignalEmitted).length,
          totalFindings,
          byDimension,
        };

        return res.json({ runs: enrichedRuns, summary });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // FOUNDER — recent findings, optionally filtered.
  app.get(
    "/api/founder/team-system-audit/findings",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const dimensionRaw = req.query.dimension;
        const severityRaw = req.query.severity;

        let dimension: TeamSystemAuditDimension | null = null;
        if (typeof dimensionRaw === "string" && dimensionRaw.length > 0) {
          if (
            !TEAM_SYSTEM_AUDIT_DIMENSIONS.includes(
              dimensionRaw as TeamSystemAuditDimension,
            )
          ) {
            return Errors.badRequest(
              res,
              `dimension must be one of: ${TEAM_SYSTEM_AUDIT_DIMENSIONS.join(", ")}`,
            );
          }
          dimension = dimensionRaw as TeamSystemAuditDimension;
        }

        let severity: TeamSystemAuditSeverity | null = null;
        if (typeof severityRaw === "string" && severityRaw.length > 0) {
          if (
            !TEAM_SYSTEM_AUDIT_SEVERITIES.includes(
              severityRaw as TeamSystemAuditSeverity,
            )
          ) {
            return Errors.badRequest(
              res,
              `severity must be one of: ${TEAM_SYSTEM_AUDIT_SEVERITIES.join(", ")}`,
            );
          }
          severity = severityRaw as TeamSystemAuditSeverity;
        }

        const cutoff = new Date(
          Date.now() - FINDINGS_WINDOW_DAYS * 24 * 60 * 60 * 1000,
        );

        // Build predicates in a Drizzle-friendly way.
        const predicates: any[] = [
          gte(teamSystemAuditFindings.firedAt, cutoff),
        ];
        if (dimension) {
          predicates.push(eq(teamSystemAuditFindings.dimension, dimension));
        }
        if (severity) {
          predicates.push(eq(teamSystemAuditFindings.severity, severity));
        }

        const findings = await db
          .select()
          .from(teamSystemAuditFindings)
          .where(and(...predicates))
          .orderBy(desc(teamSystemAuditFindings.firedAt))
          .limit(MAX_FINDINGS_PER_QUERY);

        return res.json({
          findings,
          filter: { dimension, severity, windowDays: FINDINGS_WINDOW_DAYS },
          count: findings.length,
          truncated: findings.length === MAX_FINDINGS_PER_QUERY,
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );
}

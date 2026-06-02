/**
 * Solene (COO) — self-audit founder read endpoints.
 *
 *   GET /api/founder/solene-audit/recent     — last 30 audit runs + finding counts
 *   GET /api/founder/solene-audit/findings   — detail for one run (run_id query)
 *
 * Capital-tracker endpoints are added in a follow-on commit and live in
 * the same router function so the registerSoleneAuditRoutes hook keeps
 * one mount point.
 *
 * Auth: isAuthenticated + requireFounder. Same shape as the Pax-audit
 * founder endpoints in server/routes-pax-audit.ts.
 *
 * No founder-side UI ships with this — the endpoints are the read-only
 * surface Solene consults when reviewing her own week.
 */

import type { Express, Response } from "express";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import {
  soleneAuditRuns,
  soleneAuditFindings,
} from "@shared/schema/solene-audit";
import { isAuthenticated, requireFounder } from "./auth";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";

const RECENT_RUNS_LIMIT = 30;
const MAX_FINDINGS_PER_RUN = 500;

export function registerSoleneAuditRoutes(app: Express): void {
  // FOUNDER — last 30 self-audit runs + their finding counts.
  app.get(
    "/api/founder/solene-audit/recent",
    isAuthenticated,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const runs = await db
          .select()
          .from(soleneAuditRuns)
          .orderBy(desc(soleneAuditRuns.runStartedAt))
          .limit(RECENT_RUNS_LIMIT);

        if (runs.length === 0) {
          return res.json({
            runs: [],
            summary: { totalRuns: 0, driftSignalCount: 0, totalFindings: 0 },
          });
        }

        const runIds = runs.map((r) => r.id);
        const countRows = await db
          .select({
            runId: soleneAuditFindings.runId,
            severity: soleneAuditFindings.severity,
            count: sql<number>`COUNT(*)::int`,
          })
          .from(soleneAuditFindings)
          .where(sql`${soleneAuditFindings.runId} = ANY(${runIds})`)
          .groupBy(soleneAuditFindings.runId, soleneAuditFindings.severity);

        const findingsByRun = new Map<
          number,
          { info: number; warn: number; fail: number; critical: number; total: number }
        >();
        for (const row of countRows) {
          const bucket =
            findingsByRun.get(row.runId) ?? {
              info: 0,
              warn: 0,
              fail: 0,
              critical: 0,
              total: 0,
            };
          const count = Number(row.count);
          if (row.severity === "info") bucket.info += count;
          else if (row.severity === "warn") bucket.warn += count;
          else if (row.severity === "fail") bucket.fail += count;
          else if (row.severity === "critical") bucket.critical += count;
          bucket.total += count;
          findingsByRun.set(row.runId, bucket);
        }

        const enrichedRuns = runs.map((r) => ({
          ...r,
          findingCounts:
            findingsByRun.get(r.id) ?? {
              info: 0,
              warn: 0,
              fail: 0,
              critical: 0,
              total: 0,
            },
        }));

        const summary = {
          totalRuns: runs.length,
          driftSignalCount: runs.filter((r) => r.driftSignalEmitted).length,
          totalFindings: enrichedRuns.reduce(
            (sum, r) => sum + r.findingCounts.total,
            0,
          ),
        };

        return res.json({ runs: enrichedRuns, summary });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // FOUNDER — finding detail for one run.
  app.get(
    "/api/founder/solene-audit/findings",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const runIdRaw = req.query.run_id;
        const runId =
          typeof runIdRaw === "string" ? parseInt(runIdRaw, 10) : NaN;
        if (!Number.isFinite(runId) || runId <= 0) {
          return Errors.badRequest(
            res,
            "run_id (positive integer) is required as a query parameter",
          );
        }

        const [run] = await db
          .select()
          .from(soleneAuditRuns)
          .where(eq(soleneAuditRuns.id, runId))
          .limit(1);
        if (!run) return Errors.notFound(res, "audit run");

        const findings = await db
          .select()
          .from(soleneAuditFindings)
          .where(eq(soleneAuditFindings.runId, runId))
          .orderBy(desc(soleneAuditFindings.firedAt))
          .limit(MAX_FINDINGS_PER_RUN);

        return res.json({ run, findings });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );
}

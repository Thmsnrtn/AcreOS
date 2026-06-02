/**
 * Solene (COO) — self-audit founder read endpoints.
 *
 *   GET /api/founder/solene-audit/recent     — last 30 audit runs + finding counts
 *   GET /api/founder/solene-audit/findings   — detail for one run (run_id query)
 *
 *   GET /api/founder/solene-capital/envelope — monthly envelope status (used by the
 *                                              daily-pulse workflow)
 *   GET /api/founder/solene-capital/recent   — last 7 days of capital events
 *
 * Auth: isAuthenticated + requireFounder. The /envelope endpoint also accepts
 * a shared-secret header (X-Pulse-Secret matching PULSE_SHARED_SECRET) so the
 * GitHub Actions daily-pulse workflow can read it without a Clerk session.
 *
 * No founder-side UI ships with this — the endpoints are the read-only
 * surface Solene consults when reviewing her own week.
 */

import type { Express, Response, NextFunction } from "express";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "./db";
import {
  soleneAuditRuns,
  soleneAuditFindings,
} from "@shared/schema/solene-audit";
import { soleneCapitalEvents } from "@shared/schema/solene-capital";
import { isAuthenticated, requireFounder } from "./auth";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { getMonthlyEnvelopeStatus, getSpendSummary } from "./services/solene/capitalTracker";

const RECENT_RUNS_LIMIT = 30;
const MAX_FINDINGS_PER_RUN = 500;
const RECENT_EVENTS_LIMIT = 500;

/**
 * Pulse-shared-secret bypass for the daily-pulse endpoint only. When
 * PULSE_SHARED_SECRET is set in the env and the request carries a
 * matching X-Pulse-Secret header, fall through to the handler without
 * Clerk auth. Mismatched/missing → defer to isAuthenticated+requireFounder.
 */
function envelopeAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const secret = process.env.PULSE_SHARED_SECRET;
  if (secret && req.headers["x-pulse-secret"] === secret) {
    return next();
  }
  return isAuthenticated(req as any, res, () =>
    requireFounder(req as any, res, next),
  );
}

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

  // ──────────────────────────────────────────────────────────────────────
  // CAPITAL TRACKER ENDPOINTS
  // ──────────────────────────────────────────────────────────────────────

  // FOUNDER + PULSE — envelope status. Used by the daily-pulse workflow.
  app.get(
    "/api/founder/solene-capital/envelope",
    envelopeAuth,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const status = await getMonthlyEnvelopeStatus();
        const last24h = await getSpendSummary(24);
        return res.json({
          envelope: status,
          last24hSpendUsd: last24h.totalUsd,
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // FOUNDER — last 7 days of capital events.
  app.get(
    "/api/founder/solene-capital/recent",
    isAuthenticated,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const events = await db
          .select()
          .from(soleneCapitalEvents)
          .where(and(gte(soleneCapitalEvents.occurredAt, sevenDaysAgo)))
          .orderBy(desc(soleneCapitalEvents.occurredAt))
          .limit(RECENT_EVENTS_LIMIT);
        const summary = await getSpendSummary(7 * 24);
        return res.json({ events, summary });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );
}

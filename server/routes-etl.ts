/**
 * Phase 8 Months 11 — Founder ETL operator API.
 *
 * Backs /founder/etl. Founder-gated.
 *
 *   GET  /api/founder/etl/jobs                — job catalog + last-run summary
 *   GET  /api/founder/etl/jobs/:id/runs       — recent etl_runs for one job
 *   POST /api/founder/etl/jobs/:id/run        — manual run-now (uses orchestrator)
 *   GET  /api/founder/etl/dlq                 — pending DLQ records (etl:* events)
 *   POST /api/founder/etl/dlq/:id/replay      — replay a single DLQ record
 */

import type { Express } from "express";
import { z } from "zod";
import { desc, eq, like, sql } from "drizzle-orm";

import { db } from "./db";
import { etlJobs, etlRuns, outboxDlq } from "@shared/schema";
import { isAuthenticated } from "./auth";
import { isFounderIdentity } from "./services/founder";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { runJob, replayDlqRecord } from "./services/etlOrchestrator";
import type { AuthenticatedRequest } from "./types/request";

function requireFounder(req: AuthenticatedRequest, res: any): boolean {
  const user = req.user as any;
  const userId = (req as any).auth?.userId ?? user?.clerkUserId ?? null;
  const email = user?.email ?? null;
  if (!isFounderIdentity({ email, userId })) {
    Errors.forbidden(res, "Founder access required");
    return false;
  }
  return true;
}

export function registerEtlRoutes(app: Express): void {
  // ── Job catalog + last-run summary ────────────────────────────────────
  app.get("/api/founder/etl/jobs", isAuthenticated, async (req, res) => {
    const areq = req as AuthenticatedRequest;
    if (!requireFounder(areq, res)) return;
    try {
      const jobs = await db.select().from(etlJobs).orderBy(etlJobs.jobName);

      // Per-job last-run summary. One round-trip — not ideal at huge job
      // counts, but the catalog is expected to stay in the dozens.
      const summaries = await Promise.all(
        jobs.map(async (j) => {
          const [last] = await db
            .select()
            .from(etlRuns)
            .where(eq(etlRuns.jobId, j.id))
            .orderBy(desc(etlRuns.startedAt))
            .limit(1);
          const [{ count: dlqCount }] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(outboxDlq)
            .where(eq(outboxDlq.eventType, `etl:${j.jobName}:record`));
          return {
            ...j,
            lastRun: last ?? null,
            dlqCount: Number(dlqCount ?? 0),
          };
        }),
      );
      return res.json({ jobs: summaries });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // ── Recent runs for a single job ──────────────────────────────────────
  app.get("/api/founder/etl/jobs/:id/runs", isAuthenticated, async (req, res) => {
    const areq = req as AuthenticatedRequest;
    if (!requireFounder(areq, res)) return;
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return Errors.badRequest(res, "Invalid job id");
    try {
      const rows = await db
        .select()
        .from(etlRuns)
        .where(eq(etlRuns.jobId, id))
        .orderBy(desc(etlRuns.startedAt))
        .limit(50);
      return res.json({ runs: rows });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // ── Manual run-now ────────────────────────────────────────────────────
  app.post("/api/founder/etl/jobs/:id/run", isAuthenticated, async (req, res) => {
    const areq = req as AuthenticatedRequest;
    if (!requireFounder(areq, res)) return;
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return Errors.badRequest(res, "Invalid job id");
    try {
      const result = await runJob(id);
      logger.info(`[founder/etl] manual run job=${id} status=${result.status}`);
      return res.json(result);
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // ── DLQ list ──────────────────────────────────────────────────────────
  app.get("/api/founder/etl/dlq", isAuthenticated, async (req, res) => {
    const areq = req as AuthenticatedRequest;
    if (!requireFounder(areq, res)) return;
    const jobName = (req.query.jobName as string | undefined) ?? null;
    try {
      // ETL DLQ rows have eventType `etl:<jobName>:record`. Generic non-ETL
      // outbox failures live in the same table — we filter by the prefix.
      const where = jobName
        ? eq(outboxDlq.eventType, `etl:${jobName}:record`)
        : like(outboxDlq.eventType, "etl:%");
      const rows = await db
        .select()
        .from(outboxDlq)
        .where(where)
        .orderBy(desc(outboxDlq.failedAt))
        .limit(200);
      return res.json({ dlq: rows });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // ── Replay single DLQ row ─────────────────────────────────────────────
  const replayParams = z.object({ id: z.coerce.number().int().positive() });
  app.post("/api/founder/etl/dlq/:id/replay", isAuthenticated, async (req, res) => {
    const areq = req as AuthenticatedRequest;
    if (!requireFounder(areq, res)) return;
    const parsed = replayParams.safeParse(req.params);
    if (!parsed.success) {
      return Errors.validationFailed(res, parsed.error.errors);
    }
    try {
      const result = await replayDlqRecord(parsed.data.id);
      if (!result.ok) {
        return res.status(200).json({ ok: false, error: result.error });
      }
      return res.json({ ok: true });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });
}

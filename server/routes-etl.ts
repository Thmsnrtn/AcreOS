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

import crypto from "crypto";
import type { Express } from "express";
import { z } from "zod";
import { desc, eq, like, sql } from "drizzle-orm";

import { db } from "./db";
import { storage } from "./storage";
import { etlJobs, etlRuns, outboxDlq } from "@shared/schema";
import { isAuthenticated } from "./auth";
import { isFounderIdentity } from "./services/founder";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { runJob, replayDlqRecord } from "./services/etlOrchestrator";
import { getClerkAuth, type AuthenticatedRequest } from "./types/request";

function requireFounder(req: AuthenticatedRequest, res: any): boolean {
  const user = req.user;
  const userId = getClerkAuth(req)?.userId ?? user?.clerkUserId ?? null;
  const email = user?.email ?? null;
  if (!isFounderIdentity({ email, userId })) {
    Errors.notFound(res, "Resource");
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
      const [job] = await db.select().from(etlJobs).where(eq(etlJobs.id, id));
      if (!job) return Errors.notFound(res, "ETL job");

      // Same lock the scheduled path takes (runDueJobs: `etl:<jobName>`, 300s),
      // so run-now cannot overlap a scheduled tick or another run-now. The
      // holder id is fresh per request ON PURPOSE: acquireJobLock re-extends
      // for the current holder, so reusing the process-wide ETL id would let a
      // click sail through a tick running in this same process.
      const lockName = `etl:${job.jobName}`;
      const holderId = `etl-run-now-${crypto.randomUUID()}`;
      const acquired = await storage.acquireJobLock(lockName, holderId, 300);
      if (!acquired) {
        // The codebase's lock-contention result is `skipped` (runDueJobs);
        // there is no HTTP lock-refusal status, so none is invented here.
        logger.info(`[founder/etl] manual run job=${id} skipped — lock held`);
        return res.json({ status: "skipped", reason: "locked", jobId: id, jobName: job.jobName });
      }
      try {
        const result = await runJob(id);
        logger.info(`[founder/etl] manual run job=${id} status=${result.status}`);
        return res.json(result);
      } finally {
        await storage.releaseJobLock(lockName, holderId);
      }
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
      return Errors.validationFailed(res, parsed.error.issues);
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

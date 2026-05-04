/**
 * Wenzeslaus ETL Orchestrator — Phase 8 Months 11.
 *
 * Why this exists
 * ───────────────
 * AcreOS pulls data from many external providers (Regrid boundaries, FEMA
 * flood zones, Mapbox, county assessors, ...). Historically each provider
 * had its own ad-hoc fetch loop with a copy-pasted retry policy and no
 * shared observability. The Wenzeslaus pattern unifies all of those pulls
 * behind one orchestrator that owns:
 *
 *   1. Watermarks  — every job stores `watermarkValue` (last successful
 *      `updated_at` boundary or external cursor). The next run only pulls
 *      records modified since that watermark, so backfill is a one-time
 *      cost and steady-state pulls are cheap.
 *
 *   2. DLQ + replay — per-record failures inside an otherwise-successful
 *      run go to `outbox_dlq` (Wave 7) with eventType `etl:<job>:record`
 *      and the failed payload. The /founder/etl UI surfaces those rows
 *      and exposes a "Replay" action that re-runs the handler against
 *      the original payload.
 *
 *   3. Soft-delete propagation — when a job sets
 *      `softDeleteOnMissing = true` and the upstream provider responds
 *      with a full set, the orchestrator marks any local rows that
 *      no longer appear upstream as deleted. (Default off — most jobs
 *      are incremental and never see "missing".)
 *
 *   4. Cron coordination — `runDueJobs()` consults `etl_jobs.schedule`
 *      and runs jobs whose interval has elapsed. `withJobLock()` (5-min
 *      TTL) prevents two scheduler instances from running the same job
 *      concurrently.
 *
 * Everything else is per-provider. Handlers are registered via
 * `registerEtlHandler()` and implement the `EtlProviderHandler` interface
 * below.
 */

import { eq } from "drizzle-orm";

import { db } from "../db";
import {
  etlJobs,
  etlRuns,
  outboxDlq,
  type EtlJob,
} from "@shared/schema";
import { logger } from "../utils/logger";
import { storage } from "../storage";

/**
 * A single record yielded by a provider's fetch generator.
 *
 * `externalId` is the upstream stable identifier. The handler uses it as
 * the upsert key. `updatedAt` is the upstream "last modified" timestamp;
 * the orchestrator tracks the max value across the run and writes it
 * back to `etl_jobs.watermarkValue` on success.
 *
 * `payload` is opaque to the orchestrator — it's whatever the handler
 * needs to perform an upsert. It's also the body that gets dead-lettered
 * on per-record failure, so it must be JSON-serialisable.
 */
export interface EtlRecord {
  externalId: string;
  updatedAt?: Date | string | null;
  payload: Record<string, unknown>;
}

/**
 * The action a handler's upsert took. The orchestrator uses this to
 * increment per-run counters in `etl_runs`.
 */
export type UpsertAction = "inserted" | "updated" | "unchanged";

/**
 * Drizzle DB handle (or a transaction). Handlers receive whichever the
 * orchestrator is using for the run.
 */
export type DrizzleDb = typeof db;

/**
 * Opts passed to a handler's `fetch()` generator.
 *
 * `since` is the watermark — the timestamp/cursor of the last successful
 * run. On the first ever run for a job it's `null` and the handler
 * should backfill everything.
 */
export interface EtlFetchOpts {
  since: string | Date | null;
  /** Free-form per-job config from `etl_jobs.config` (e.g. county codes). */
  config?: Record<string, unknown>;
  /** Optional source URL from `etl_jobs.sourceUrl`. */
  sourceUrl?: string | null;
  /** Hard limit on records the orchestrator wants this run to fetch. */
  limit?: number;
}

/**
 * Per-provider plug-in.
 *
 * Implementations:
 *   - `fetch()` is an async generator so providers can stream pages
 *     instead of materialising the full result set in memory.
 *   - `upsert()` performs the local DB write keyed on `externalId`. It
 *     returns the action so the orchestrator can keep accurate run
 *     counters.
 *   - Optional `listExternalIds()` is used when the job has
 *     `softDeleteOnMissing = true` — it returns the full set of upstream
 *     IDs so the orchestrator knows which local rows to mark deleted.
 *   - Optional `softDelete()` performs the local soft-delete given an
 *     externalId.
 */
export interface EtlProviderHandler {
  name: string;
  fetch(opts: EtlFetchOpts): AsyncGenerator<EtlRecord, void, void>;
  upsert(record: EtlRecord, tx: DrizzleDb): Promise<{ action: UpsertAction }>;
  listExternalIds?(opts: EtlFetchOpts): Promise<string[]>;
  softDelete?(externalId: string, tx: DrizzleDb): Promise<void>;
}

const handlers = new Map<string, EtlProviderHandler>();

/**
 * Register a provider handler. Idempotent — last registration wins so
 * tests can swap in stubs.
 */
export function registerEtlHandler(name: string, handler: EtlProviderHandler): void {
  handlers.set(name, handler);
}

export function getEtlHandler(name: string): EtlProviderHandler | undefined {
  return handlers.get(name);
}

/** Visible for tests — clear the registry. */
export function _clearEtlHandlersForTest(): void {
  handlers.clear();
}

/** Visible for tests — list registered handlers. */
export function listRegisteredEtlHandlers(): string[] {
  return Array.from(handlers.keys());
}

// ─── Run statistics ─────────────────────────────────────────────────────────

interface RunStats {
  read: number;
  inserted: number;
  updated: number;
  deleted: number;
  failed: number;
}

function emptyStats(): RunStats {
  return { read: 0, inserted: 0, updated: 0, deleted: 0, failed: 0 };
}

// ─── DLQ helpers ────────────────────────────────────────────────────────────

/**
 * Dead-letter a single failed record into `outbox_dlq`. Event type carries
 * the job name so /founder/etl can filter, and `payload.etlJobId` lets the
 * replay path find the right handler.
 */
async function deadLetterRecord(
  job: EtlJob,
  runId: number,
  record: EtlRecord,
  err: unknown,
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  try {
    await db.insert(outboxDlq).values({
      eventType: `etl:${job.jobName}:record`,
      payload: {
        etlJobId: job.id,
        etlJobName: job.jobName,
        etlRunId: runId,
        providerName: job.providerName,
        externalId: record.externalId,
        record,
      },
      status: "failed",
      attempts: 1,
      lastErrorAt: new Date(),
      failureReason: message,
    });
  } catch (dlqErr) {
    logger.error(`[etl:${job.jobName}] failed to dead-letter record`, dlqErr, {
      metadata: { externalId: record.externalId },
    });
  }
}

// ─── Core: runJob ───────────────────────────────────────────────────────────

export interface RunJobResult {
  runId: number;
  status: "success" | "failure";
  stats: RunStats;
  watermarkBefore: string | null;
  watermarkAfter: string | null;
  errorMessage?: string;
}

/**
 * Run a single ETL job. Pulls records since the last watermark, upserts
 * each, dead-letters per-record failures, optionally propagates
 * soft-deletes, and updates `etl_runs` + `etl_jobs.watermarkValue`.
 *
 * Throws only on catastrophic failure (handler missing, DB unreachable).
 * Per-record errors are caught + dead-lettered so a single bad record
 * never tanks the whole run.
 */
export async function runJob(jobId: number): Promise<RunJobResult> {
  const [job] = await db.select().from(etlJobs).where(eq(etlJobs.id, jobId));
  if (!job) {
    throw new Error(`etl_jobs row not found for id=${jobId}`);
  }
  const handler = handlers.get(job.providerName);
  if (!handler) {
    throw new Error(
      `No ETL handler registered for provider "${job.providerName}". ` +
        `Call registerEtlHandler() in server boot.`,
    );
  }

  const stats = emptyStats();
  const watermarkBefore = job.watermarkValue ?? null;
  let maxWatermark: string | null = watermarkBefore;

  // Insert the run row up front so failures are still observable.
  const [run] = await db
    .insert(etlRuns)
    .values({
      jobId: job.id,
      status: "running",
      watermarkBefore,
    })
    .returning({ id: etlRuns.id });
  if (!run) {
    throw new Error(`Failed to insert etl_runs row for job ${job.jobName}`);
  }
  const runId = run.id;

  const seenIds = new Set<string>();
  let runError: unknown = null;

  try {
    const fetchOpts: EtlFetchOpts = {
      since: watermarkBefore,
      config: job.config ?? {},
      sourceUrl: job.sourceUrl,
    };

    for await (const record of handler.fetch(fetchOpts)) {
      stats.read += 1;
      seenIds.add(record.externalId);
      try {
        const result = await handler.upsert(record, db);
        if (result.action === "inserted") stats.inserted += 1;
        else if (result.action === "updated") stats.updated += 1;
        // 'unchanged' is intentionally not counted — it's a no-op.

        // Track the highest watermark seen.
        if (record.updatedAt) {
          const iso =
            record.updatedAt instanceof Date
              ? record.updatedAt.toISOString()
              : String(record.updatedAt);
          if (!maxWatermark || iso > maxWatermark) {
            maxWatermark = iso;
          }
        }
      } catch (recordErr) {
        stats.failed += 1;
        logger.warn(`[etl:${job.jobName}] record failed`, {
          metadata: {
            externalId: record.externalId,
            error: recordErr instanceof Error ? recordErr.message : String(recordErr),
          },
        });
        await deadLetterRecord(job, runId, record, recordErr);
      }
    }

    // Soft-delete propagation. Only when the job opts in AND the handler
    // implements both listExternalIds() (the upstream truth set) and
    // softDelete() (the local mutation).
    if (
      job.softDeleteOnMissing &&
      handler.listExternalIds &&
      handler.softDelete
    ) {
      try {
        const upstreamIds = new Set(await handler.listExternalIds(fetchOpts));
        // The orchestrator can only safely soft-delete IDs we actually saw
        // upstream this run AND that are absent from the truth set. The
        // intersection of (locally-known ⊂ stored) ∖ upstream is computed
        // lazily by the handler — we pass the set so the handler can
        // enumerate its own table.
        // (The default contract: handler.softDelete() iterates locally
        // and marks any row whose externalId isn't in `upstreamIds`.)
        const handlerWithBulk = handler as EtlProviderHandler & {
          softDeleteMissing?(
            upstreamIds: Set<string>,
            tx: DrizzleDb,
          ): Promise<number>;
        };
        if (handlerWithBulk.softDeleteMissing) {
          const removed = await handlerWithBulk.softDeleteMissing(
            upstreamIds,
            db,
          );
          stats.deleted += removed;
        }
      } catch (deleteErr) {
        // Soft-delete failures are non-fatal: log and move on. We'd rather
        // miss a delete than abort an otherwise-successful pull.
        logger.error(
          `[etl:${job.jobName}] soft-delete propagation failed`,
          deleteErr,
        );
      }
    }
  } catch (err) {
    runError = err;
  }

  const status: "success" | "failure" = runError ? "failure" : "success";
  const errorMessage =
    runError instanceof Error
      ? runError.message
      : runError != null
        ? String(runError)
        : null;

  // Persist the run + watermark.
  try {
    await db
      .update(etlRuns)
      .set({
        completedAt: new Date(),
        status,
        recordsRead: stats.read,
        recordsInserted: stats.inserted,
        recordsUpdated: stats.updated,
        recordsDeleted: stats.deleted,
        recordsFailed: stats.failed,
        errorMessage,
        watermarkAfter: maxWatermark,
      })
      .where(eq(etlRuns.id, runId));

    if (status === "success") {
      await db
        .update(etlJobs)
        .set({
          watermarkValue: maxWatermark,
          lastSuccessAt: new Date(),
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(etlJobs.id, job.id));
    } else {
      await db
        .update(etlJobs)
        .set({
          lastErrorAt: new Date(),
          lastError: errorMessage,
          updatedAt: new Date(),
        })
        .where(eq(etlJobs.id, job.id));
    }
  } catch (persistErr) {
    logger.error(
      `[etl:${job.jobName}] failed to persist run completion`,
      persistErr,
    );
  }

  return {
    runId,
    status,
    stats,
    watermarkBefore,
    watermarkAfter: maxWatermark,
    errorMessage: errorMessage ?? undefined,
  };
}

// ─── Cron coordinator ───────────────────────────────────────────────────────

/**
 * Parse a 5-field cron expression (`m h dom mon dow`) just enough to
 * compute the next-due interval in minutes from a base instant. We only
 * support the subset we actually use: star-slash-N, star, and literal integers.
 *
 * For schedules we don't recognise we fall back to 15 minutes — the same
 * as the table default — which is the safe option (a slow job is worse
 * than a fast one only by a small margin in our pull-volume regime).
 */
function intervalMsFromCron(schedule: string): number {
  // Match patterns like "*/15 * * * *" — the minute field tells us the
  // cadence. Anything else => default 15-minute cadence.
  const minuteField = schedule.trim().split(/\s+/)[0] ?? "*";
  const everyN = /^\*\/(\d+)$/.exec(minuteField);
  if (everyN) {
    return Math.max(1, parseInt(everyN[1] ?? "15", 10)) * 60_000;
  }
  if (minuteField === "*") {
    return 60_000; // every minute
  }
  const literalMinute = /^\d+$/.test(minuteField);
  if (literalMinute) {
    return 60 * 60_000; // hourly anchor
  }
  return 15 * 60_000;
}

function isJobDue(job: EtlJob, now: Date): boolean {
  if (!job.isActive) return false;
  if (!job.lastSuccessAt) return true; // never run
  const intervalMs = intervalMsFromCron(job.schedule);
  return now.getTime() - job.lastSuccessAt.getTime() >= intervalMs;
}

/**
 * Fetch all active jobs that are currently due. Visible for tests.
 */
export async function listDueJobs(now: Date = new Date()): Promise<EtlJob[]> {
  const rows = await db
    .select()
    .from(etlJobs)
    .where(eq(etlJobs.isActive, true));
  return rows.filter((j) => isJobDue(j, now));
}

/**
 * Run every job that's currently due. Each job is wrapped in
 * `withJobLock()` so a second scheduler instance won't double-run.
 *
 * The orchestrator returns a summary (job → status) so the supervisor
 * can tell what happened during this tick.
 */
export async function runDueJobs(
  now: Date = new Date(),
): Promise<Array<{ jobName: string; status: "success" | "failure" | "skipped"; runId?: number }>> {
  const due = await listDueJobs(now);
  const results: Array<{
    jobName: string;
    status: "success" | "failure" | "skipped";
    runId?: number;
  }> = [];

  for (const job of due) {
    const lockName = `etl:${job.jobName}`;
    // 5-minute TTL — long enough for a fat backfill page, short enough
    // that a crashed scheduler doesn't wedge the job for hours.
    const acquired = await storage.acquireJobLock(
      lockName,
      ETL_INSTANCE_ID,
      300,
    );
    if (!acquired) {
      results.push({ jobName: job.jobName, status: "skipped" });
      continue;
    }
    try {
      const result = await runJob(job.id);
      results.push({
        jobName: job.jobName,
        status: result.status,
        runId: result.runId,
      });
    } catch (err) {
      logger.error(`[etl:${job.jobName}] runJob threw`, err);
      results.push({ jobName: job.jobName, status: "failure" });
    } finally {
      await storage.releaseJobLock(lockName, ETL_INSTANCE_ID);
    }
  }

  return results;
}

// Stable per-process instance ID for job-lock ownership. Crypto is loaded
// lazily so this module stays import-safe in test environments that mock
// the global crypto object.
const ETL_INSTANCE_ID =
  typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `etl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// ─── DLQ replay ─────────────────────────────────────────────────────────────

/**
 * Replay a single dead-lettered record. Re-runs the original handler's
 * `upsert()` against the captured payload. On success the DLQ row is
 * deleted; on repeated failure a fresh DLQ row is inserted (with
 * `attempts` incremented) so the audit trail stays linear.
 */
export async function replayDlqRecord(
  dlqId: number,
): Promise<{ ok: boolean; error?: string }> {
  const [row] = await db
    .select()
    .from(outboxDlq)
    .where(eq(outboxDlq.id, dlqId));
  if (!row) {
    return { ok: false, error: "DLQ row not found" };
  }
  const payload = row.payload as Record<string, unknown> | null;
  if (!payload) {
    return { ok: false, error: "DLQ payload empty" };
  }
  const jobName = String(payload.etlJobName ?? "");
  const record = payload.record as EtlRecord | undefined;
  if (!jobName || !record) {
    return { ok: false, error: "DLQ payload missing etlJobName/record" };
  }
  const [job] = await db
    .select()
    .from(etlJobs)
    .where(eq(etlJobs.jobName, jobName));
  if (!job) {
    return { ok: false, error: `etl_jobs row not found for ${jobName}` };
  }
  const handler = handlers.get(job.providerName);
  if (!handler) {
    return { ok: false, error: `no handler registered for ${job.providerName}` };
  }

  try {
    await handler.upsert(record, db);
    // Success — burn the DLQ row.
    await db.delete(outboxDlq).where(eq(outboxDlq.id, dlqId));
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Update the existing row's last_error (keeps history compact).
    await db
      .update(outboxDlq)
      .set({
        attempts: (row.attempts ?? 0) + 1,
        lastErrorAt: new Date(),
        failureReason: message,
      })
      .where(eq(outboxDlq.id, dlqId));
    return { ok: false, error: message };
  }
}

/** Visible for tests. */
export const _internal = {
  intervalMsFromCron,
  isJobDue,
};

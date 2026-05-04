/**
 * AcreOS Worker Process — heavy-job offload entry point.
 *
 * Purpose
 * ───────
 * Runs in its own Fly machine (`worker` process group in fly.toml). The
 * customer-facing `app` machines stay lean and do not block on
 * compute-heavy work — PDF rendering, eval batches, image processing,
 * embedding refresh, ML recognition, 1099 batch generation. Those
 * effects are enqueued onto the existing `outbox` table (Wave 7) by
 * route handlers and consumed here.
 *
 * Lifecycle
 * ─────────
 *   1. Connect to Postgres (reuses server/db.ts pool config).
 *   2. Poll `outbox` every POLL_INTERVAL_MS for status='pending' rows
 *      whose `event_type` is one of the worker-handled categories.
 *   3. Mark each row as `running` (atomically via UPDATE…RETURNING),
 *      dispatch to the registered handler, then write status back as
 *      `sent` (success) or `failed` (terminal) or `retry` (transient,
 *      re-queued by leaving status='pending' with attempts++).
 *   4. On SIGTERM/SIGINT, finish in-flight jobs (best-effort, 30s
 *      grace) and exit cleanly so Fly can drain the machine.
 *
 * Status values
 * ─────────────
 * The `outbox.status` column is text in the schema — we use:
 *   • pending  — fresh insert, waiting for a worker
 *   • running  — claimed by this process, in flight (avoids re-pickup)
 *   • sent     — completed successfully
 *   • failed   — terminal failure after MAX_ATTEMPTS
 *   • retry    — transient failure; will be retried on the next poll
 *
 * The DLQ flow (`outbox_dlq`) is handled by the existing scheduler's
 * helper — we hand off via `recordTerminalFailure`.
 *
 * Why no external queue
 * ─────────────────────
 * The dual-write trap (DB + Redis/SQS) is what `outbox` was built to
 * avoid in Wave 7. Reusing it here means producers stay
 * transactional with their state change, and the worker is the sole
 * consumer — no Redis, no SQS, no extra failure mode.
 */

import { pool, db } from "./db";
import { outbox, outboxDlq } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { logger } from "./utils/logger";
import { initSentry, Sentry } from "./utils/sentry";

// Initialize Sentry early so unhandled errors are reported.
initSentry();

// ── Configuration ───────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = parseInt(process.env.WORKER_POLL_INTERVAL_MS ?? "5000", 10);
const BATCH_SIZE = parseInt(process.env.WORKER_BATCH_SIZE ?? "10", 10);
const MAX_ATTEMPTS = parseInt(process.env.WORKER_MAX_ATTEMPTS ?? "5", 10);
const SHUTDOWN_GRACE_MS = parseInt(process.env.WORKER_SHUTDOWN_GRACE_MS ?? "30000", 10);

// Event types this worker is responsible for. Must match what producers
// (route handlers in server/routes-*.ts and the scheduler) emit.
const HANDLED_EVENT_TYPES = [
  "pdf_render",
  "eval_run",
  "image_process",
  "embedding_refresh",
  "recognition_run",
  "1099_batch_generate",
] as const;

type HandledEventType = (typeof HANDLED_EVENT_TYPES)[number];

// ── Handler registry ────────────────────────────────────────────────────────

interface JobHandler {
  (payload: Record<string, unknown>): Promise<Record<string, unknown> | void>;
}

const HANDLERS: Record<HandledEventType, JobHandler> = {
  pdf_render: handlePdfRender,
  eval_run: handleEvalRun,
  image_process: handleImageProcess,
  embedding_refresh: handleEmbeddingRefresh,
  recognition_run: handleRecognitionRun,
  "1099_batch_generate": handle1099BatchGenerate,
};

// ── Handlers ────────────────────────────────────────────────────────────────
// Each handler is intentionally thin — it imports the heavy service lazily
// so cold start stays fast and a broken module in one category doesn't
// prevent the worker from booting and processing other categories.

async function handlePdfRender(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const variant = String(payload.variant ?? "");
  if (variant === "general_ledger") {
    const { generateGeneralLedgerPdf } = await import("./services/glPdfExport");
    const pdf = await generateGeneralLedgerPdf({
      organizationId: Number(payload.organizationId),
      organizationName: String(payload.organizationName ?? ""),
      fromDate: String(payload.fromDate),
      toDate: String(payload.toDate),
    });
    return {
      pdfBase64: pdf.toString("base64"),
      bytes: pdf.length,
    };
  }
  throw new Error(`pdf_render: unknown variant '${variant}'`);
}

async function handleEvalRun(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  // The eval harness lives in /evals as a CLI script. Invoking it as a
  // child process (rather than importing) keeps its top-level argv
  // parsing untouched and lets us surface stdout/stderr in `outbox`
  // status. Spawning is fine here — the worker is the right place for
  // long-running shell-out work.
  const { spawn } = await import("node:child_process");
  return await new Promise((resolve, reject) => {
    const args = ["tsx", "evals/run-eval.ts"];
    if (payload.limit) args.push("--limit", String(payload.limit));
    if (payload.suite) args.push("--suite", String(payload.suite));
    const child = spawn("npx", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => (stdout += b.toString()));
    child.stderr.on("data", (b) => (stderr += b.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ exitCode: code, stdoutBytes: stdout.length });
      } else {
        reject(new Error(`eval_run failed (exit ${code}): ${stderr.slice(0, 500)}`));
      }
    });
  });
}

async function handleImageProcess(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  // Aerial / property image processing. The dedicated processing service
  // is wave-dependent — try the canonical name first, fall back to the
  // aerial-images helper if that's all that's available. This keeps the
  // worker decoupled from in-flight wave restructuring.
  try {
    const mod = (await import("./services/imageProcessing")) as Record<string, unknown>;
    const fn = mod.processImageJob as ((p: Record<string, unknown>) => Promise<Record<string, unknown>>) | undefined;
    if (typeof fn === "function") {
      const result = await fn(payload);
      return (result ?? {}) as Record<string, unknown>;
    }
  } catch {
    /* module not present yet — fall through */
  }
  throw new Error("image_process: no processor module registered yet");
}

async function handleEmbeddingRefresh(_payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { refreshStaleEmbeddings } = await import("./jobs/embeddingRefresh");
  const refreshed = await refreshStaleEmbeddings(100, 7);
  return { refreshed };
}

async function handleRecognitionRun(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  // ML recognition tick (Magnus revenue recognition / pattern recognition).
  // The canonical entry is `runRecognitionTick` in services/recognitionWorker.
  const mod = await import("./services/recognitionWorker");
  const fn = (mod as unknown as { runRecognitionTick?: (...args: unknown[]) => Promise<unknown> }).runRecognitionTick;
  if (typeof fn !== "function") {
    throw new Error("recognition_run: services/recognitionWorker has no runRecognitionTick export");
  }
  const result = await fn(payload);
  return (result ?? {}) as Record<string, unknown>;
}

async function handle1099BatchGenerate(
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { generate1099Batch } = await import("./services/form1099Batch");
  const result = await generate1099Batch(
    Number(payload.organizationId),
    Number(payload.taxYear),
  );
  return {
    jobId: result.jobId,
    status: result.status,
    formCount: result.formCount,
    totalInterestCents: result.totalInterestCents,
  };
}

// ── Polling loop ────────────────────────────────────────────────────────────

let stopping = false;
let inFlight = 0;

/**
 * Atomically claim up to `BATCH_SIZE` rows: SELECT … FOR UPDATE SKIP LOCKED
 * within an UPDATE…RETURNING ensures two workers in the same process group
 * don't grab the same row. The Postgres SKIP LOCKED locking clause is the
 * canonical primitive for "competing consumers" without an external queue.
 */
async function claimBatch(): Promise<Array<{
  id: number;
  eventType: string;
  payload: Record<string, unknown>;
  attempts: number;
}>> {
  const rows = await db.execute<{
    id: number;
    event_type: string;
    payload: Record<string, unknown>;
    attempts: number;
  }>(sql`
    UPDATE outbox
    SET status = 'running', attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM outbox
      WHERE status IN ('pending', 'retry')
        AND event_type = ANY(${HANDLED_EVENT_TYPES}::text[])
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT ${BATCH_SIZE}
    )
    RETURNING id, event_type, payload, attempts
  `);

  const list = (rows as any)?.rows ?? [];
  return list.map((r: any) => ({
    id: r.id,
    eventType: r.event_type,
    payload: r.payload ?? {},
    attempts: r.attempts ?? 0,
  }));
}

async function markSent(id: number, _result: unknown): Promise<void> {
  await db
    .update(outbox)
    .set({
      status: "sent",
      sentAt: new Date(),
    })
    .where(eq(outbox.id, id));
}

async function markFailedTransient(id: number, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  await db
    .update(outbox)
    .set({
      status: "retry",
      lastErrorAt: new Date(),
      lastErrorMessage: message.slice(0, 1000),
    })
    .where(eq(outbox.id, id));
}

async function markFailedTerminal(
  id: number,
  eventType: string,
  payload: Record<string, unknown>,
  attempts: number,
  err: unknown,
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  await db
    .update(outbox)
    .set({
      status: "failed",
      lastErrorAt: new Date(),
      lastErrorMessage: message.slice(0, 1000),
    })
    .where(eq(outbox.id, id));

  // Dead-letter for operator inspection.
  try {
    await db.insert(outboxDlq).values({
      originalOutboxId: id,
      eventType,
      payload,
      status: "failed",
      attempts,
      lastErrorAt: new Date(),
      failureReason: message.slice(0, 1000),
    });
  } catch (dlqErr) {
    logger.error("[worker] failed to write outbox_dlq row", dlqErr instanceof Error ? dlqErr : undefined);
  }
}

async function processOne(row: {
  id: number;
  eventType: string;
  payload: Record<string, unknown>;
  attempts: number;
}): Promise<void> {
  inFlight += 1;
  const started = Date.now();
  try {
    const handler = HANDLERS[row.eventType as HandledEventType];
    if (!handler) {
      // Defensive: claimBatch already filtered, but if a typo slips in
      // we want a deterministic terminal failure rather than a silent loop.
      await markFailedTerminal(
        row.id,
        row.eventType,
        row.payload,
        row.attempts,
        new Error(`no handler registered for event_type=${row.eventType}`),
      );
      return;
    }

    const result = await handler(row.payload);
    await markSent(row.id, result);
    logger.info(`[worker] ${row.eventType} #${row.id} sent`, {
      metadata: { durationMs: Date.now() - started },
    });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { worker: row.eventType, outboxId: String(row.id) },
    });
    if (row.attempts >= MAX_ATTEMPTS) {
      await markFailedTerminal(row.id, row.eventType, row.payload, row.attempts, err);
      logger.error(`[worker] ${row.eventType} #${row.id} terminal failure after ${row.attempts} attempts`, err instanceof Error ? err : undefined);
    } else {
      await markFailedTransient(row.id, err);
      logger.warn(`[worker] ${row.eventType} #${row.id} transient failure (attempt ${row.attempts}/${MAX_ATTEMPTS}): ${err instanceof Error ? err.message : String(err)}`);
    }
  } finally {
    inFlight -= 1;
  }
}

async function pollOnce(): Promise<void> {
  const batch = await claimBatch();
  if (batch.length === 0) return;
  // Process serially within a tick — most handlers are CPU-bound (PDF
  // render, embedding) so parallelism on a 1-CPU machine just adds
  // contention. Tune via WORKER_BATCH_SIZE if profiling argues for it.
  for (const row of batch) {
    if (stopping) break;
    await processOne(row);
  }
}

async function loop(): Promise<void> {
  while (!stopping) {
    try {
      await pollOnce();
    } catch (err) {
      logger.error("[worker] poll cycle failed", err instanceof Error ? err : undefined);
      Sentry.captureException(err);
    }
    if (stopping) break;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

// ── Shutdown handling ───────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info(`[worker] received ${signal} — draining (inFlight=${inFlight})`);

  const deadline = Date.now() + SHUTDOWN_GRACE_MS;
  while (inFlight > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
  }

  if (inFlight > 0) {
    logger.warn(`[worker] grace expired with ${inFlight} job(s) still in flight; exiting anyway`);
  }

  try {
    await pool.end();
  } catch (err) {
    logger.error("[worker] error closing pool", err instanceof Error ? err : undefined);
  }

  try {
    await Sentry.close(2000);
  } catch {
    /* best effort */
  }

  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  logger.error("[worker] unhandledRejection", reason instanceof Error ? reason : undefined);
  Sentry.captureException(reason);
});
process.on("uncaughtException", (err) => {
  logger.error("[worker] uncaughtException", err);
  Sentry.captureException(err);
});

// ── Boot ────────────────────────────────────────────────────────────────────

logger.info(`[worker] booting — pollInterval=${POLL_INTERVAL_MS}ms batchSize=${BATCH_SIZE} handlers=${HANDLED_EVENT_TYPES.join(",")}`);

void loop();

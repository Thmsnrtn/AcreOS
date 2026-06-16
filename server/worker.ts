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
import { outbox, outboxDlq, workerHeartbeat } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { logger } from "./utils/logger";
import { runWithRestoredTraceContext } from "./utils/queueTraceContext";
import { initSentry, Sentry } from "./utils/sentry";
import { instanceId } from "./utils/jobRuntime";
import { requireEncryptionKey } from "./utils/validateEnv";
// Founder Autopilot — the Solene founder-ops dispatch consumer. Separate queue
// (solene_dispatch_queue) from the outbox + the customer-facing decision
// executor, so this never double-dispatches against either.
import { claimNextDispatch } from "./services/solene/dispatchQueue";
import { runDispatch } from "./services/solene/dispatchRunner";

// Initialize Sentry early so unhandled errors are reported.
initSentry();

// ── Configuration ───────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = parseInt(process.env.WORKER_POLL_INTERVAL_MS ?? "5000", 10);
const BATCH_SIZE = parseInt(process.env.WORKER_BATCH_SIZE ?? "10", 10);
const MAX_ATTEMPTS = parseInt(process.env.WORKER_MAX_ATTEMPTS ?? "5", 10);
const SHUTDOWN_GRACE_MS = parseInt(process.env.WORKER_SHUTDOWN_GRACE_MS ?? "30000", 10);

// Founder Autopilot — Solene dispatch consumer. GATED OFF by default: this is
// the wire that lets the autonomous brain's enqueued dispatches actually
// EXECUTE (run an agent with tools). Turning it on is a deliberate switch
// (set SOLENE_DISPATCH_ENABLED=true), never automatic on deploy — so P0 can
// ship the wiring while nothing acts autonomously yet.
const SOLENE_DISPATCH_ENABLED = process.env.SOLENE_DISPATCH_ENABLED === "true";
const SOLENE_DISPATCH_POLL_MS = parseInt(process.env.SOLENE_DISPATCH_POLL_MS ?? "5000", 10);

// Event types this worker is responsible for. Must match what producers
// (route handlers in server/routes-*.ts and the scheduler) emit.
const HANDLED_EVENT_TYPES = [
  "pdf_render",
  "eval_run",
  "image_process",
  "embedding_refresh",
  "recognition_run",
  "1099_batch_generate",
  // Tier 2C (2026-06-10): lifecycle emails enqueued by
  // services/lifecycleProgram.sendLifecycleMessage. The producer existed
  // since Phase 4 but NO consumer did — every lifecycle send was queueing
  // into a void. This handler is the missing drain.
  "lifecycle_email",
  // CMO ad engine (2026-05-20)
  "cmo.manual-generate",      // founder hit "Generate" on /founder/cmo
  "cmo.render-script",        // a scored script is ready to render to 3 MP4s
  "cmo.broadcast",            // an approved render is ready to ship to a platform
  "cmo.weekly-refresh",       // Monday morning batch
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
  lifecycle_email: handleLifecycleEmail,
  "cmo.manual-generate": handleCmoManualGenerate,
  "cmo.render-script": handleCmoRenderScript,
  "cmo.broadcast": handleCmoBroadcastEvent,
  "cmo.weekly-refresh": handleCmoWeeklyRefresh,
};

/**
 * Tier 2C — drain one lifecycle_email outbox row. Payload shape is fixed by
 * lifecycleProgram.sendLifecycleMessage: { templateKey, channel, category,
 * organizationId, userId, recipientEmail, subject, body, … }. Suppression was
 * already checked at enqueue time; the transport re-checks hard bounces.
 * Sends via emailService with isCampaignEmail=true so every lifecycle email
 * carries the List-Unsubscribe header + CAN-SPAM footer. On success the
 * matching lifecycle_message_sends audit row flips queued → sent.
 */
async function handleLifecycleEmail(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const recipientEmail = String(payload.recipientEmail ?? "");
  const subject = String(payload.subject ?? "");
  const body = String(payload.body ?? "");
  const templateKey = String(payload.templateKey ?? "");
  const channel = String(payload.channel ?? "email");
  const organizationId = typeof payload.organizationId === "number" ? payload.organizationId : null;

  if (channel !== "email") {
    // SMS lifecycle templates exist in the registry but no SMS transport is
    // wired for them yet. Skip terminally (don't retry — retrying won't grow
    // a transport) and keep the audit row honest.
    logger.warn(`[worker] lifecycle_email: unsupported channel '${channel}' for ${templateKey} — skipped`);
    return { skipped: true, reason: "unsupported_channel" };
  }
  if (!recipientEmail.includes("@") || !subject) {
    throw new Error(`lifecycle_email payload missing recipientEmail/subject (templateKey=${templateKey})`);
  }

  const { emailService } = await import("./services/emailService");
  // Templates are plain text with blank-line paragraph breaks; render a
  // minimal HTML body (escaped) alongside the text part.
  const escaped = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const html = escaped
    .split("\n\n")
    .map((p) => `<p style="margin:0 0 16px;line-height:1.7;">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");

  const result = await emailService.sendEmail({
    to: recipientEmail,
    subject,
    html,
    text: body,
    organizationId: organizationId ?? undefined,
    // Lifecycle = marketing-shaped: CAN-SPAM footer + List-Unsubscribe.
    isCampaignEmail: true,
  });

  if (!result.success) {
    // Throw so the outbox retry/DLQ machinery owns the failure.
    throw new Error(result.error ?? `lifecycle_email send failed (${templateKey})`);
  }

  // Flip the audit row queued → sent (best-effort; the send already happened).
  if (organizationId !== null) {
    try {
      const { lifecycleMessageSends } = await import("@shared/schema");
      const { and, eq } = await import("drizzle-orm");
      await db
        .update(lifecycleMessageSends)
        .set({ status: "sent" })
        .where(
          and(
            eq(lifecycleMessageSends.organizationId, organizationId),
            eq(lifecycleMessageSends.templateKey, templateKey),
            eq(lifecycleMessageSends.recipientEmail, recipientEmail),
            eq(lifecycleMessageSends.status, "queued"),
          ),
        );
    } catch (auditErr) {
      logger.warn("[worker] lifecycle_email audit status update failed", auditErr instanceof Error ? auditErr : undefined);
    }
  }

  return { sent: true, messageId: result.messageId ?? null };
}

async function handleCmoManualGenerate(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { handleCmoGenerateEvent } = await import("./services/agents/cmoAgent");
  const result = await handleCmoGenerateEvent(payload as Parameters<typeof handleCmoGenerateEvent>[0]);
  return result as unknown as Record<string, unknown>;
}

async function handleCmoRenderScript(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { handleCmoRender } = await import("./jobs/cmoVideoRender");
  const result = await handleCmoRender(payload as unknown as Parameters<typeof handleCmoRender>[0]);
  return result as unknown as Record<string, unknown>;
}

async function handleCmoBroadcastEvent(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { handleCmoBroadcast } = await import("./jobs/cmoBroadcast");
  const result = await handleCmoBroadcast(payload as unknown as Parameters<typeof handleCmoBroadcast>[0]);
  return result as unknown as Record<string, unknown>;
}

async function handleCmoWeeklyRefresh(_payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { runWeeklyRefresh } = await import("./services/agents/cmoAgent");
  const result = await runWeeklyRefresh();
  return result as unknown as Record<string, unknown>;
}

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
    // Optional, wave-dependent module that may not exist yet — resolved through
    // a non-literal specifier so its absence is a runtime (caught) condition
    // rather than a compile-time module-resolution error.
    const imageProcessingModule = "./services/imageProcessing";
    const mod = (await import(imageProcessingModule)) as Record<string, unknown>;
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
// Founder-ops dispatches currently executing (tracked separately from outbox
// `inFlight` so shutdown drains them too).
let soleneInFlight = 0;

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
        AND event_type IN (${sql.join(HANDLED_EVENT_TYPES.map((t) => sql`${t}`), sql`, `)})
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
  const truncated = message.slice(0, 1000);
  const now = new Date();

  // Pillar 9.1 — atomic DLQ move.  Insert into outbox_dlq + delete the
  // outbox row in a single transaction.  Either both rows transition or
  // neither does; no scenario can land the job in both tables (which
  // would risk a phantom retry against an already-DLQ'd payload) or
  // neither (which would silently lose the audit trail).
  try {
    await db.transaction(async (tx) => {
      // Pull the original `created_at` so first_failed_at / last_failed_at
      // tell an honest story for forensic review.  If the outbox row was
      // already vacuumed for some reason, gracefully default to now().
      const [existing] = await tx
        .select({
          id: outbox.id,
          createdAt: outbox.createdAt,
          lastErrorAt: outbox.lastErrorAt,
        })
        .from(outbox)
        .where(eq(outbox.id, id))
        .limit(1);

      await tx.insert(outboxDlq).values({
        originalOutboxId: id,
        eventType,
        payload,
        status: "failed",
        attempts,
        lastErrorAt: now,
        failureReason: truncated,
        lastError: truncated,
        failureCount: attempts,
        firstFailedAt: existing?.createdAt ?? now,
        lastFailedAt: existing?.lastErrorAt ?? now,
        movedToDlqAt: now,
      });

      if (existing) {
        await tx.delete(outbox).where(eq(outbox.id, id));
      }
    });
  } catch (dlqErr) {
    // If the atomic move fails, fall back to the prior best-effort
    // behavior so we at least record a terminal failure status on the
    // outbox row.  The next worker tick won't re-pick this row because
    // status='failed' is excluded from claimBatch().
    logger.error("[worker] atomic DLQ move failed — falling back to status='failed'", dlqErr instanceof Error ? dlqErr : undefined);
    try {
      await db
        .update(outbox)
        .set({
          status: "failed",
          lastErrorAt: now,
          lastErrorMessage: truncated,
        })
        .where(eq(outbox.id, id));
    } catch (updErr) {
      logger.error("[worker] fallback outbox status update failed", updErr instanceof Error ? updErr : undefined);
    }
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

    // L4 — restore the W3C trace context the producer stamped onto the
    // payload at enqueue time so consumer log lines + downstream outbound
    // calls continue the SAME distributed trace as the request that
    // scheduled this job. When the payload carries no trace envelope (e.g.
    // a scheduled-tick producer with no upstream request), a fresh context
    // is minted so consumer work is always traceable.
    const result = await runWithRestoredTraceContext(row.payload, () =>
      handler(row.payload),
    );
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

/**
 * Tess #5 — worker liveness pulse. Bumps the single-row `worker_heartbeat`
 * (id=1) on every poll loop so an EXTERNAL eye can detect "the worker — and
 * therefore all of alerting — is down" via GET /api/health/worker-heartbeat.
 * Best-effort: a failed heartbeat write must NEVER stop the worker draining
 * the outbox (the inverse would be self-defeating). We log + continue.
 */
async function writeHeartbeat(): Promise<void> {
  try {
    await db
      .insert(workerHeartbeat)
      .values({
        id: 1,
        instanceId,
        gitSha: process.env.VITE_GIT_SHA ?? process.env.SENTRY_RELEASE ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: workerHeartbeat.id,
        set: {
          instanceId,
          gitSha: process.env.VITE_GIT_SHA ?? process.env.SENTRY_RELEASE ?? null,
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    // Don't let an observability write break the work the worker exists to do.
    logger.warn(`[worker] heartbeat write failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function pollOnce(): Promise<void> {
  // Pulse first, every loop — independent of whether there is work to do, so a
  // quiet-but-alive worker still proves liveness to the external probe.
  await writeHeartbeat();
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

// ── Founder Autopilot — Solene dispatch consumer ─────────────────────────────
// THE KEYSTONE WIRE. The autonomous brain (autoDispatch / founderBypass /
// planProposals / the continuous loop) enqueues founder-ops work onto
// `solene_dispatch_queue` — but until now nothing drained it (dispatchRunner
// expected a `runSoleneDispatchLoop` that was never written, so every dispatch
// sat queued forever). This loop is that consumer.
//
// Serial by design: runDispatch executes an agent with tools (incl. git
// mutations), so two concurrent dispatches would race the working tree. We
// claim ONE row (atomic FOR UPDATE SKIP LOCKED) and run it to completion —
// runDispatch self-handles cost caps, completion, failure, and capital events.
// Gated OFF by default (SOLENE_DISPATCH_ENABLED) so the wiring can ship without
// anything acting autonomously yet.
async function runSoleneDispatchLoop(): Promise<void> {
  if (!SOLENE_DISPATCH_ENABLED) {
    logger.info("[worker] Solene dispatch consumer DORMANT (SOLENE_DISPATCH_ENABLED!=true)");
    return;
  }
  logger.info(`[worker] Solene dispatch consumer ACTIVE — pollInterval=${SOLENE_DISPATCH_POLL_MS}ms`);
  while (!stopping) {
    let claimed = false;
    try {
      const row = await claimNextDispatch();
      if (row) {
        claimed = true;
        soleneInFlight++;
        try {
          await runDispatch(row);
        } finally {
          soleneInFlight--;
        }
      }
    } catch (err) {
      logger.error("[worker] Solene dispatch cycle failed", err instanceof Error ? err : undefined);
      Sentry.captureException(err);
    }
    if (stopping) break;
    // Loop immediately to drain a backlog; only sleep when the queue is empty.
    if (!claimed) {
      await new Promise((r) => setTimeout(r, SOLENE_DISPATCH_POLL_MS));
    }
  }
}

// ── Shutdown handling ───────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info(`[worker] received ${signal} — draining (inFlight=${inFlight})`);

  // Tier 1H: stop the scheduled-job runners from firing NEW ticks, then
  // drain both outbox jobs (inFlight) and any scheduled-job body currently
  // executing (scheduler lease holders) within the same grace window.
  let scheduledInFlight: () => string[] = () => [];
  try {
    const scheduler = await import("./jobs/scheduler");
    scheduler.cancelAllScheduledJobs();
    scheduledInFlight = scheduler.getInFlightScheduledJobs;
  } catch (err) {
    logger.warn(`[worker] could not cancel scheduled jobs during shutdown: ${err instanceof Error ? err.message : String(err)}`);
  }
  // Clear interval-based background jobs registered via trackInterval so they
  // don't fire mid-drain.
  for (const handle of ((globalThis as any).__bgIntervals ?? []) as NodeJS.Timeout[]) {
    clearInterval(handle);
  }

  const deadline = Date.now() + SHUTDOWN_GRACE_MS;
  while ((inFlight > 0 || soleneInFlight > 0 || scheduledInFlight().length > 0) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
  }

  const stillRunning = scheduledInFlight();
  if (inFlight > 0 || soleneInFlight > 0 || stillRunning.length > 0) {
    logger.warn(
      `[worker] grace expired with ${inFlight} outbox job(s), ${soleneInFlight} dispatch(es), and ${stillRunning.length} scheduled job(s) [${stillRunning.join(", ")}] still in flight; exiting anyway`,
    );
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

// Tier 1H crash discipline: after an uncaughtException or unhandledRejection
// the process state is undefined — continuing risks half-written rows, a
// wedged poll loop, and silent darkness (the heartbeat keeps pulsing while
// the worker does nothing useful). Flush Sentry, then EXIT non-zero: Fly
// restarts the machine into a clean state, and the deadman/heartbeat probes
// cover the gap.
let crashing = false;
function crashExit(label: string, err: unknown): void {
  if (crashing) return; // a second fault while flushing must not recurse
  crashing = true;
  logger.error(`[worker] ${label} — flushing Sentry and exiting for restart`, err instanceof Error ? err : undefined);
  Sentry.captureException(err);
  Sentry.close(2000).finally(() => process.exit(1));
  // Hard backstop: if the Sentry flush itself hangs, force the exit.
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("unhandledRejection", (reason) => crashExit("unhandledRejection", reason));
process.on("uncaughtException", (err) => crashExit("uncaughtException", err));

// ── Boot ────────────────────────────────────────────────────────────────────

// Beatrice / compliance-debt §3 — the worker process runs scheduled jobs that
// read/write encrypted columns (founder vault, skip-trace PII, BYOK secrets).
// It must NOT boot under the ephemeral dev fallback key against prod data.
// Hard-require the field-encryption key here, independent of NODE_ENV, so a
// mis-provisioned worker refuses to start rather than silently corrupting or
// exposing encrypted data. Throws (never logs the value) → process crashes
// loudly, which is the intended fail-closed behavior.
requireEncryptionKey();

logger.info(`[worker] booting — pollInterval=${POLL_INTERVAL_MS}ms batchSize=${BATCH_SIZE} handlers=${HANDLED_EVENT_TYPES.join(",")}`);

void loop();
// Founder Autopilot — start the Solene dispatch consumer concurrently with the
// outbox loop. No-ops (logs DORMANT and returns) unless SOLENE_DISPATCH_ENABLED.
void runSoleneDispatchLoop();

// Scheduled jobs — formerly gated off the app process by
// DISABLE_BACKGROUND_JOBS. Now run here on the worker so onboarding
// sweepers, drip campaigns, the autonomous executor, etc. actually
// fire in production. The per-job Postgres locks make it safe to run
// the same module on multiple processes — only one will win each tick.
if (process.env.WORKER_DISABLE_SCHEDULED_JOBS !== "1") {
  void (async () => {
    try {
      const { runScheduledJobs } = await import("./jobs/runScheduledJobs");
      await runScheduledJobs();
      logger.info("[worker] scheduled jobs started");
    } catch (err) {
      logger.error("[worker] failed to start scheduled jobs", err instanceof Error ? err : undefined);
    }
  })();
}

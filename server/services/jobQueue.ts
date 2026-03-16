// @ts-nocheck
import crypto from "crypto";
import { log } from "../index";
import { db } from "../db";
import { backgroundJobs } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";

export type JobType = "email" | "webhook" | "payment_sync" | "notification";
export type JobStatus = "pending" | "processing" | "completed" | "failed" | "retrying";

export interface Job {
  id: string;
  type: JobType;
  payload: Record<string, any>;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  scheduledFor: Date;
  error: string | null;
  result?: Record<string, any>;
  processingStartedAt?: Date;
  completedAt?: Date;
}

export interface JobQueueOptions {
  maxAttempts?: number;
  scheduledFor?: Date;
}

export interface JobHandler {
  (job: Job): Promise<Record<string, any>>;
}

// ---------------------------------------------------------------------------
// Determine at module load time whether we have a Redis URL. If not, we fall
// back to the original in-memory implementation so local dev keeps working
// without a Redis instance.
// ---------------------------------------------------------------------------
const REDIS_URL = process.env.REDIS_URL;
const USE_BULLMQ = Boolean(REDIS_URL);

if (!USE_BULLMQ) {
  console.warn(
    "[jobQueue] REDIS_URL is not set — falling back to in-memory job queue. " +
      "Jobs will not survive server restarts. Set REDIS_URL to enable BullMQ."
  );
}

// ---------------------------------------------------------------------------
// BullMQ implementation
// ---------------------------------------------------------------------------
async function createBullMQService(): Promise<JobQueueService> {
  const { Queue, Worker } = await import("bullmq");
  const IORedis = (await import("ioredis")).default;

  const QUEUE_NAME = "acreos-jobs";

  const connection = new IORedis(REDIS_URL!, {
    maxRetriesPerRequest: null, // required by BullMQ
  });

  const bullQueue = new Queue(QUEUE_NAME, { connection });

  // In-memory job cache for fast status look-ups (keyed by our own UUID).
  // BullMQ job IDs are separate; we store ours in the BullMQ job data.
  const jobCache: Map<string, Job> = new Map();

  let bullWorker: InstanceType<typeof Worker> | null = null;
  const handlers: Map<JobType, JobHandler> = new Map();

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  function bullDataToJob(data: any): Job {
    return {
      id: data._jobId,
      type: data.type as JobType,
      payload: data.payload ?? {},
      status: data.status ?? "pending",
      attempts: data.attempts ?? 0,
      maxAttempts: data.maxAttempts ?? 3,
      createdAt: new Date(data.createdAt),
      scheduledFor: new Date(data.scheduledFor),
      error: data.error ?? null,
      result: data.result,
      processingStartedAt: data.processingStartedAt
        ? new Date(data.processingStartedAt)
        : undefined,
      completedAt: data.completedAt ? new Date(data.completedAt) : undefined,
    };
  }

  async function syncJobStatusToDb(job: Job, dbId?: number): Promise<void> {
    const id = dbId ?? (job as any)._dbId;
    if (!id) return;
    const dbStatus = job.status === "retrying" ? "pending" : job.status;
    await db
      .update(backgroundJobs)
      .set({
        status: dbStatus,
        attempts: job.attempts,
        error: job.error ?? null,
        result: job.result ?? null,
        scheduledFor: job.scheduledFor,
        completedAt: job.completedAt ?? null,
      })
      .where(eq(backgroundJobs.id, id));
  }

  // ------------------------------------------------------------------
  // Public service object
  // ------------------------------------------------------------------
  const service: JobQueueService = {
    registerHandler(type: JobType, handler: JobHandler): void {
      handlers.set(type, handler);
      log(`Job handler registered for type: ${type}`, "jobQueue");
    },

    addJob(
      type: JobType,
      payload: Record<string, any>,
      options: JobQueueOptions = {}
    ): Job {
      const jobId = crypto.randomUUID();
      const now = new Date();
      const scheduledFor = options.scheduledFor || now;
      const maxAttempts = options.maxAttempts || 3;
      const delayMs = Math.max(0, scheduledFor.getTime() - now.getTime());

      const job: Job = {
        id: jobId,
        type,
        payload,
        status: "pending",
        attempts: 0,
        maxAttempts,
        createdAt: now,
        scheduledFor,
        error: null,
      };

      jobCache.set(jobId, job);

      // Enqueue in BullMQ
      bullQueue
        .add(
          type,
          {
            _jobId: jobId,
            type,
            payload,
            status: "pending",
            attempts: 0,
            maxAttempts,
            createdAt: now.toISOString(),
            scheduledFor: scheduledFor.toISOString(),
            error: null,
          },
          {
            delay: delayMs,
            attempts: maxAttempts,
            backoff: { type: "exponential", delay: 1000 },
            removeOnComplete: { count: 1000 },
            removeOnFail: { count: 1000 },
          }
        )
        .catch((err: unknown) => {
          log(`Failed to enqueue job ${jobId} in BullMQ: ${err}`, "jobQueue");
        });

      // Persist to DB
      db.insert(backgroundJobs)
        .values({
          type,
          payload,
          status: "pending",
          attempts: 0,
          maxAttempts,
          scheduledFor,
          error: null,
          result: undefined,
        })
        .then(([row]) => {
          if (row) {
            (job as any)._dbId = (row as any).id;
          }
        })
        .catch((err: unknown) => {
          log(`Failed to persist job ${jobId} to DB: ${err}`, "jobQueue");
        });

      log(`Job added: ${jobId} (type: ${type})`, "jobQueue");
      return job;
    },

    getJobStatus(jobId: string): Job | null {
      return jobCache.get(jobId) || null;
    },

    getRecentJobs(limit = 100): Job[] {
      return Array.from(jobCache.values())
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit);
    },

    getJobsByStatus(status: JobStatus): Job[] {
      return Array.from(jobCache.values()).filter((j) => j.status === status);
    },

    async processJobs(): Promise<{ processed: number; failed: number }> {
      // With BullMQ the worker processes jobs automatically; this method is a
      // no-op that returns current in-memory counters for callers that expect it.
      const jobs = Array.from(jobCache.values());
      const processed = jobs.filter((j) => j.status === "completed").length;
      const failed = jobs.filter((j) => j.status === "failed").length;
      return { processed, failed };
    },

    startWorker(_intervalMs = 10000): void {
      if (bullWorker) {
        log("Job queue worker already started", "jobQueue");
        return;
      }

      log("Starting BullMQ worker", "jobQueue");

      bullWorker = new Worker(
        QUEUE_NAME,
        async (bullJob) => {
          const data = bullJob.data;
          const jobId: string = data._jobId;

          // Retrieve or reconstruct the in-memory job
          let job = jobCache.get(jobId);
          if (!job) {
            job = bullDataToJob(data);
            jobCache.set(jobId, job);
          }

          job.status = "processing";
          job.processingStartedAt = new Date();
          job.attempts = bullJob.attemptsMade + 1;

          const handler = handlers.get(job.type);
          if (!handler) {
            job.status = "failed";
            job.error = `No handler registered for job type: ${job.type}`;
            job.completedAt = new Date();
            log(`Job failed (no handler): ${jobId}`, "jobQueue");
            syncJobStatusToDb(job).catch((err: unknown) =>
              log(`DB sync failed for job ${jobId}: ${err}`, "jobQueue")
            );
            throw new Error(job.error);
          }

          try {
            const result = await handler(job);
            job.status = "completed";
            job.error = null;
            job.result = result;
            job.completedAt = new Date();
            log(`Job completed: ${jobId}`, "jobQueue");
            syncJobStatusToDb(job).catch((err: unknown) =>
              log(`DB sync failed for job ${jobId}: ${err}`, "jobQueue")
            );
            return result;
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            const isLastAttempt = job.attempts >= job.maxAttempts;

            if (!isLastAttempt) {
              job.status = "retrying";
              job.error = errorMessage;
              const backoffMs = Math.min(
                1000 * Math.pow(2, job.attempts - 1),
                60000
              );
              job.scheduledFor = new Date(Date.now() + backoffMs);
              log(
                `Job retrying: ${jobId} (attempt ${job.attempts}/${job.maxAttempts})`,
                "jobQueue"
              );
            } else {
              job.status = "failed";
              job.error = errorMessage;
              job.completedAt = new Date();
              log(`Job failed (max retries): ${jobId}`, "jobQueue");
            }

            syncJobStatusToDb(job).catch((err: unknown) =>
              log(`DB sync failed for job ${jobId}: ${err}`, "jobQueue")
            );
            throw error; // let BullMQ handle retry scheduling
          }
        },
        { connection, concurrency: 5 }
      );

      bullWorker.on("error", (err) => {
        log(`BullMQ worker error: ${err}`, "jobQueue");
      });

      // Load unfinished jobs from DB for status visibility
      db.select()
        .from(backgroundJobs)
        .where(inArray(backgroundJobs.status, ["pending", "processing"]))
        .then((rows) => {
          let loaded = 0;
          for (const row of rows) {
            const tempId = crypto.randomUUID();
            const job: Job = {
              id: tempId,
              type: row.type as JobType,
              payload: (row.payload as Record<string, any>) ?? {},
              status: "pending",
              attempts: row.attempts ?? 0,
              maxAttempts: row.maxAttempts ?? 3,
              createdAt: row.createdAt ?? new Date(),
              scheduledFor: row.scheduledFor,
              error: row.error ?? null,
              result: row.result as Record<string, any> | undefined,
            };
            (job as any)._dbId = row.id;
            jobCache.set(tempId, job);
            loaded++;
          }
          if (loaded > 0) {
            log(`Loaded ${loaded} unfinished job(s) from DB into cache`, "jobQueue");
          }
        })
        .catch((err: unknown) => {
          log(`Failed to hydrate job cache from DB: ${err}`, "jobQueue");
        });

      // Graceful shutdown
      const shutdown = async () => {
        log("Shutting down BullMQ worker…", "jobQueue");
        await bullWorker?.close();
        await bullQueue.close();
        await connection.quit();
      };

      process.once("SIGTERM", shutdown);
      process.once("SIGINT", shutdown);
    },

    stopWorker(): void {
      if (bullWorker) {
        bullWorker.close().catch((err: unknown) => {
          log(`Error closing BullMQ worker: ${err}`, "jobQueue");
        });
        bullWorker = null;
        log("Job queue worker stopped", "jobQueue");
      }
    },

    getStats() {
      const jobs = Array.from(jobCache.values());
      return {
        total: jobs.length,
        pending: jobs.filter((j) => j.status === "pending").length,
        processing: jobs.filter((j) => j.status === "processing").length,
        completed: jobs.filter((j) => j.status === "completed").length,
        failed: jobs.filter((j) => j.status === "failed").length,
        retrying: jobs.filter((j) => j.status === "retrying").length,
      };
    },

    clear(): void {
      jobCache.clear();
      bullQueue.obliterate({ force: true }).catch((err: unknown) => {
        log(`Failed to obliterate BullMQ queue: ${err}`, "jobQueue");
      });
      log("Job queue cleared", "jobQueue");
    },

    retryFailedJobs(
      jobType?: string,
      orgId?: number,
      maxRetries = 10
    ): number {
      const failedJobs = Array.from(jobCache.values())
        .filter((job) => {
          if (job.status !== "failed") return false;
          if (jobType && jobType !== "all" && job.type !== jobType) return false;
          if (orgId && job.payload?.organizationId !== orgId) return false;
          return true;
        })
        .slice(0, maxRetries);

      for (const job of failedJobs) {
        job.status = "pending";
        job.attempts = 0;
        job.error = null;
        job.scheduledFor = new Date();

        // Re-enqueue in BullMQ
        bullQueue
          .add(
            job.type,
            {
              _jobId: job.id,
              type: job.type,
              payload: job.payload,
              status: "pending",
              attempts: 0,
              maxAttempts: job.maxAttempts,
              createdAt: job.createdAt.toISOString(),
              scheduledFor: job.scheduledFor.toISOString(),
              error: null,
            },
            {
              attempts: job.maxAttempts,
              backoff: { type: "exponential", delay: 1000 },
              removeOnComplete: { count: 1000 },
              removeOnFail: { count: 1000 },
            }
          )
          .catch((err: unknown) => {
            log(`Failed to re-enqueue job ${job.id}: ${err}`, "jobQueue");
          });

        log(`Retrying failed job: ${job.id} (type: ${job.type})`, "jobQueue");
      }

      return failedJobs.length;
    },
  } as unknown as JobQueueService;

  return service;
}

// ---------------------------------------------------------------------------
// In-memory fallback implementation (original logic, preserved verbatim)
// ---------------------------------------------------------------------------
function createInMemoryService(): JobQueueService {
  return new InMemoryJobQueueService();
}

class InMemoryJobQueueService implements JobQueueService {
  private jobs: Map<string, Job> = new Map();
  private pendingQueue: string[] = [];
  private handlers: Map<JobType, JobHandler> = new Map();
  private processing = false;
  private processInterval: NodeJS.Timeout | null = null;

  registerHandler(type: JobType, handler: JobHandler): void {
    this.handlers.set(type, handler);
    log(`Job handler registered for type: ${type}`, "jobQueue");
  }

  addJob(
    type: JobType,
    payload: Record<string, any>,
    options: JobQueueOptions = {}
  ): Job {
    const jobId = crypto.randomUUID();
    const now = new Date();
    const scheduledFor = options.scheduledFor || now;
    const maxAttempts = options.maxAttempts || 3;

    const job: Job = {
      id: jobId,
      type,
      payload,
      status: "pending",
      attempts: 0,
      maxAttempts,
      createdAt: now,
      scheduledFor,
      error: null,
    };

    this.jobs.set(jobId, job);
    this.pendingQueue.push(jobId);

    db.insert(backgroundJobs)
      .values({
        type,
        payload,
        status: "pending",
        attempts: 0,
        maxAttempts,
        scheduledFor,
        error: null,
        result: undefined,
      })
      .then(([row]) => {
        if (row) {
          (job as any)._dbId = (row as any).id;
        }
      })
      .catch((err: unknown) => {
        log(`Failed to persist job ${jobId} to DB: ${err}`, "jobQueue");
      });

    log(`Job added: ${jobId} (type: ${type})`, "jobQueue");
    return job;
  }

  getJobStatus(jobId: string): Job | null {
    return this.jobs.get(jobId) || null;
  }

  getRecentJobs(limit = 100): Job[] {
    return Array.from(this.jobs.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  getJobsByStatus(status: JobStatus): Job[] {
    return Array.from(this.jobs.values()).filter((j) => j.status === status);
  }

  async processJobs(): Promise<{ processed: number; failed: number }> {
    if (this.processing) return { processed: 0, failed: 0 };
    this.processing = true;
    let processed = 0;
    let failed = 0;

    try {
      const now = new Date();
      const jobsToProcess: string[] = [];

      for (const jobId of this.pendingQueue) {
        const job = this.jobs.get(jobId);
        if (!job) continue;
        if (job.scheduledFor <= now) jobsToProcess.push(jobId);
      }

      for (const jobId of jobsToProcess) {
        const job = this.jobs.get(jobId);
        if (!job) continue;
        try {
          await this.executeJob(job);
          processed++;
        } catch {
          failed++;
          log(`Job failed: ${jobId}`, "jobQueue");
        }
      }

      this.pendingQueue = this.pendingQueue.filter((id) => {
        const job = this.jobs.get(id);
        return job && (job.status === "pending" || job.status === "retrying");
      });

      if (this.jobs.size > 1000) this.cleanupOldJobs();
    } finally {
      this.processing = false;
    }

    return { processed, failed };
  }

  private async executeJob(job: Job): Promise<void> {
    job.status = "processing";
    job.processingStartedAt = new Date();
    job.attempts++;

    const handler = this.handlers.get(job.type);

    if (!handler) {
      job.status = "failed";
      job.error = `No handler registered for job type: ${job.type}`;
      log(`Job failed (no handler): ${job.id}`, "jobQueue");
      this.syncJobStatusToDb(job).catch((err: unknown) =>
        log(`DB sync failed for job ${job.id}: ${err}`, "jobQueue")
      );
      return;
    }

    try {
      const result = await handler(job);
      job.status = "completed";
      job.error = null;
      job.result = result;
      job.completedAt = new Date();
      log(`Job completed: ${job.id}`, "jobQueue");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (job.attempts < job.maxAttempts) {
        job.status = "retrying";
        job.error = errorMessage;
        const backoffMs = Math.min(1000 * Math.pow(2, job.attempts - 1), 60000);
        job.scheduledFor = new Date(Date.now() + backoffMs);
        this.pendingQueue.push(job.id);
        log(
          `Job retrying: ${job.id} (attempt ${job.attempts}/${job.maxAttempts}, next in ${backoffMs}ms)`,
          "jobQueue"
        );
      } else {
        job.status = "failed";
        job.error = errorMessage;
        job.completedAt = new Date();
        log(`Job failed (max retries): ${job.id}`, "jobQueue");
      }
    }

    this.syncJobStatusToDb(job).catch((err: unknown) =>
      log(`DB sync failed for job ${job.id}: ${err}`, "jobQueue")
    );
  }

  private async syncJobStatusToDb(job: Job): Promise<void> {
    const dbId: number | undefined = (job as any)._dbId;
    if (!dbId) return;
    const dbStatus = job.status === "retrying" ? "pending" : job.status;
    await db
      .update(backgroundJobs)
      .set({
        status: dbStatus,
        attempts: job.attempts,
        error: job.error ?? null,
        result: job.result ?? null,
        scheduledFor: job.scheduledFor,
        completedAt: job.completedAt ?? null,
      })
      .where(eq(backgroundJobs.id, dbId));
  }

  private cleanupOldJobs(): void {
    const allJobs = Array.from(this.jobs.entries())
      .sort((a, b) => b[1].createdAt.getTime() - a[1].createdAt.getTime())
      .slice(1000);
    for (const [jobId] of allJobs) this.jobs.delete(jobId);
    log(`Cleaned up old jobs, remaining: ${this.jobs.size}`, "jobQueue");
  }

  startWorker(intervalMs = 10000): void {
    if (this.processInterval) {
      log("Job queue worker already started", "jobQueue");
      return;
    }
    log(`Starting in-memory job queue worker (every ${intervalMs}ms)`, "jobQueue");

    this.loadPendingJobsFromDb().catch((err: unknown) => {
      log(`Failed to hydrate job queue from DB: ${err}`, "jobQueue");
    });

    this.processInterval = setInterval(() => {
      this.processJobs().catch((err) => {
        log(`Job queue processing error: ${err}`, "jobQueue");
      });
    }, intervalMs);

    const shutdown = () => {
      this.stopWorker();
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
  }

  private async loadPendingJobsFromDb(): Promise<void> {
    try {
      const rows = await db
        .select()
        .from(backgroundJobs)
        .where(inArray(backgroundJobs.status, ["pending", "processing"]));

      let loaded = 0;
      for (const row of rows) {
        const job: Job = {
          id: crypto.randomUUID(),
          type: row.type as JobType,
          payload: (row.payload as Record<string, any>) ?? {},
          status: "pending",
          attempts: row.attempts ?? 0,
          maxAttempts: row.maxAttempts ?? 3,
          createdAt: row.createdAt ?? new Date(),
          scheduledFor: row.scheduledFor,
          error: row.error ?? null,
          result: row.result as Record<string, any> | undefined,
        };
        (job as any)._dbId = row.id;
        this.jobs.set(job.id, job);
        this.pendingQueue.push(job.id);
        loaded++;
      }
      if (loaded > 0) {
        log(`Loaded ${loaded} unfinished job(s) from DB`, "jobQueue");
      }
    } catch (err) {
      log(`loadPendingJobsFromDb error: ${err}`, "jobQueue");
    }
  }

  stopWorker(): void {
    if (this.processInterval) {
      clearInterval(this.processInterval);
      this.processInterval = null;
      log("Job queue worker stopped", "jobQueue");
    }
  }

  getStats() {
    const jobs = Array.from(this.jobs.values());
    return {
      total: jobs.length,
      pending: jobs.filter((j) => j.status === "pending").length,
      processing: jobs.filter((j) => j.status === "processing").length,
      completed: jobs.filter((j) => j.status === "completed").length,
      failed: jobs.filter((j) => j.status === "failed").length,
      retrying: jobs.filter((j) => j.status === "retrying").length,
    };
  }

  clear(): void {
    this.jobs.clear();
    this.pendingQueue = [];
    log("Job queue cleared", "jobQueue");
  }

  retryFailedJobs(jobType?: string, orgId?: number, maxRetries = 10): number {
    const failedJobs = Array.from(this.jobs.values())
      .filter((job) => {
        if (job.status !== "failed") return false;
        if (jobType && jobType !== "all" && job.type !== jobType) return false;
        if (orgId && job.payload?.organizationId !== orgId) return false;
        return true;
      })
      .slice(0, maxRetries);

    for (const job of failedJobs) {
      job.status = "pending";
      job.attempts = 0;
      job.error = null;
      job.scheduledFor = new Date();
      this.pendingQueue.push(job.id);
      log(`Retrying failed job: ${job.id} (type: ${job.type})`, "jobQueue");
    }

    return failedJobs.length;
  }
}

// ---------------------------------------------------------------------------
// Public interface (mirrors the original JobQueueService API)
// ---------------------------------------------------------------------------
export interface JobQueueService {
  registerHandler(type: JobType, handler: JobHandler): void;
  addJob(type: JobType, payload: Record<string, any>, options?: JobQueueOptions): Job;
  getJobStatus(jobId: string): Job | null;
  getRecentJobs(limit?: number): Job[];
  getJobsByStatus(status: JobStatus): Job[];
  processJobs(): Promise<{ processed: number; failed: number }>;
  startWorker(intervalMs?: number): void;
  stopWorker(): void;
  getStats(): {
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    retrying: number;
  };
  clear(): void;
  retryFailedJobs(jobType?: string, orgId?: number, maxRetries?: number): number;
}

// ---------------------------------------------------------------------------
// Singleton — initialised lazily so the import itself never throws even if
// BullMQ/Redis is unavailable.
// ---------------------------------------------------------------------------
let _serviceInstance: JobQueueService | null = null;
let _initPromise: Promise<JobQueueService> | null = null;

async function getOrInitService(): Promise<JobQueueService> {
  if (_serviceInstance) return _serviceInstance;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    if (USE_BULLMQ) {
      try {
        _serviceInstance = await createBullMQService();
        log("BullMQ job queue initialised", "jobQueue");
      } catch (err) {
        console.warn(
          `[jobQueue] Failed to initialise BullMQ (${err}), falling back to in-memory queue`
        );
        _serviceInstance = createInMemoryService();
      }
    } else {
      _serviceInstance = createInMemoryService();
    }
    return _serviceInstance;
  })();

  return _initPromise;
}

// Eagerly kick off initialisation so callers that use the synchronous
// `jobQueueService` export get the resolved instance ASAP.
getOrInitService().catch(() => {/* handled inside */});

/**
 * Synchronous-looking singleton exported for backward compatibility.
 *
 * All methods delegate to either the BullMQ or in-memory implementation.
 * During the brief window before async initialisation resolves, calls fall
 * back to an in-memory shim so startup is never blocked.
 */
const _fallback = createInMemoryService();

export const jobQueueService: JobQueueService = new Proxy({} as JobQueueService, {
  get(_target, prop: string) {
    const svc = _serviceInstance ?? _fallback;
    return (svc as any)[prop];
  },
});

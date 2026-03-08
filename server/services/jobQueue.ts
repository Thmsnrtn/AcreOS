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

export class JobQueueService {
  private static instance: JobQueueService;
  private jobs: Map<string, Job> = new Map();
  private pendingQueue: string[] = [];
  private handlers: Map<JobType, JobHandler> = new Map();
  private processing = false;
  private processInterval: NodeJS.Timeout | null = null;

  private constructor() {}

  static getInstance(): JobQueueService {
    if (!JobQueueService.instance) {
      JobQueueService.instance = new JobQueueService();
    }
    return JobQueueService.instance;
  }

  /**
   * Register a handler for a specific job type
   */
  registerHandler(type: JobType, handler: JobHandler): void {
    this.handlers.set(type, handler);
    log(`Job handler registered for type: ${type}`, "jobQueue");
  }

  /**
   * Add a job to the queue.
   * Dual-writes to DB for durability, then keeps in the in-memory Map.
   */
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

    // Persist to DB asynchronously — failures are non-fatal so in-memory
    // processing continues even if the write fails.
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
        // Annotate the in-memory job with its DB id for later status updates.
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

  /**
   * Get job status by ID
   */
  getJobStatus(jobId: string): Job | null {
    return this.jobs.get(jobId) || null;
  }

  /**
   * Get all recent jobs (max 100)
   */
  getRecentJobs(limit = 100): Job[] {
    const allJobs = Array.from(this.jobs.values());
    return allJobs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);
  }

  /**
   * Get jobs by status
   */
  getJobsByStatus(status: JobStatus): Job[] {
    return Array.from(this.jobs.values()).filter((job) => job.status === status);
  }

  /**
   * Process all pending jobs
   */
  async processJobs(): Promise<{ processed: number; failed: number }> {
    // Prevent concurrent processing
    if (this.processing) {
      return { processed: 0, failed: 0 };
    }

    this.processing = true;
    let processed = 0;
    let failed = 0;

    try {
      const now = new Date();
      const jobsToProcess: string[] = [];

      // Get all pending jobs that are due for processing
      for (const jobId of this.pendingQueue) {
        const job = this.jobs.get(jobId);
        if (!job) continue;

        // Only process if scheduled time has passed
        if (job.scheduledFor <= now) {
          jobsToProcess.push(jobId);
        }
      }

      // Process each job
      for (const jobId of jobsToProcess) {
        const job = this.jobs.get(jobId);
        if (!job) continue;

        try {
          await this.executeJob(job);
          processed++;
        } catch (error) {
          failed++;
          log(`Job failed: ${jobId} - ${error}`, "jobQueue");
        }
      }

      // Clean up processed jobs from queue
      this.pendingQueue = this.pendingQueue.filter((id) => {
        const job = this.jobs.get(id);
        return job && (job.status === "pending" || job.status === "retrying");
      });

      // Clean up old jobs (keep only last 1000)
      if (this.jobs.size > 1000) {
        this.cleanupOldJobs();
      }
    } finally {
      this.processing = false;
    }

    return { processed, failed };
  }

  /**
   * Execute a single job
   */
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
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (job.attempts < job.maxAttempts) {
        // Schedule retry with exponential backoff
        job.status = "retrying";
        job.error = errorMessage;
        const backoffMs = Math.min(1000 * Math.pow(2, job.attempts - 1), 60000);
        job.scheduledFor = new Date(Date.now() + backoffMs);
        this.pendingQueue.push(job.id);
        log(`Job retrying: ${job.id} (attempt ${job.attempts}/${job.maxAttempts}, next in ${backoffMs}ms)`, "jobQueue");
      } else {
        // Max retries exceeded
        job.status = "failed";
        job.error = errorMessage;
        job.completedAt = new Date();
        log(`Job failed (max retries): ${job.id}`, "jobQueue");
      }
    }

    // Persist terminal / retry state back to DB.
    this.syncJobStatusToDb(job).catch((err: unknown) =>
      log(`DB sync failed for job ${job.id}: ${err}`, "jobQueue")
    );
  }

  /**
   * Update the DB row that backs this in-memory job.
   * Uses the _dbId annotated by addJob; silently skips if not yet available.
   */
  private async syncJobStatusToDb(job: Job): Promise<void> {
    const dbId: number | undefined = (job as any)._dbId;
    if (!dbId) return;

    // Map internal "retrying" status to "pending" in the DB schema
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

  /**
   * Clean up old jobs to prevent memory leaks
   */
  private cleanupOldJobs(): void {
    const allJobs = Array.from(this.jobs.entries())
      .sort((a, b) => b[1].createdAt.getTime() - a[1].createdAt.getTime())
      .slice(1000); // Keep only the most recent 1000

    for (const [jobId] of allJobs) {
      this.jobs.delete(jobId);
    }

    log(`Cleaned up old jobs, remaining: ${this.jobs.size}`, "jobQueue");
  }

  /**
   * Start the background worker.
   * On first start, loads any pending/processing jobs from the DB that were
   * left unfinished by a previous server process (crash recovery).
   */
  startWorker(intervalMs = 10000): void {
    if (this.processInterval) {
      log("Job queue worker already started", "jobQueue");
      return;
    }

    log(`Starting job queue worker (every ${intervalMs}ms)`, "jobQueue");

    // Hydrate queue from DB before the first tick.
    this.loadPendingJobsFromDb().catch((err: unknown) => {
      log(`Failed to hydrate job queue from DB: ${err}`, "jobQueue");
    });

    this.processInterval = setInterval(() => {
      this.processJobs().catch((err) => {
        log(`Job queue processing error: ${err}`, "jobQueue");
      });
    }, intervalMs);
  }

  /**
   * Load unfinished jobs (pending / processing) from the DB into the
   * in-memory Map so they are retried after a server restart.
   * Jobs already present in memory (same _dbId) are skipped to avoid
   * duplicates when startWorker is called on a warm instance.
   */
  private async loadPendingJobsFromDb(): Promise<void> {
    try {
      const rows = await db
        .select()
        .from(backgroundJobs)
        .where(inArray(backgroundJobs.status, ["pending", "processing"]));

      let loaded = 0;
      for (const row of rows) {
        // Build an in-memory job mirroring the DB row.
        const job: Job = {
          id: crypto.randomUUID(), // generate a fresh in-memory id
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

        // Link back to DB row so status updates work.
        (job as any)._dbId = row.id;

        this.jobs.set(job.id, job);
        this.pendingQueue.push(job.id);
        loaded++;
      }

      if (loaded > 0) {
        log(`Loaded ${loaded} unfinished job(s) from DB`, "jobQueue");
      }
    } catch (err) {
      // Non-fatal: in-memory queue still works without DB hydration.
      log(`loadPendingJobsFromDb error: ${err}`, "jobQueue");
    }
  }

  /**
   * Stop the background worker
   */
  stopWorker(): void {
    if (this.processInterval) {
      clearInterval(this.processInterval);
      this.processInterval = null;
      log("Job queue worker stopped", "jobQueue");
    }
  }

  /**
   * Get queue statistics
   */
  getStats(): {
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    retrying: number;
  } {
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

  /**
   * Clear all jobs (for testing)
   */
  clear(): void {
    this.jobs.clear();
    this.pendingQueue = [];
    log("Job queue cleared", "jobQueue");
  }

  /**
   * Retry failed jobs optionally filtered by type and orgId
   */
  retryFailedJobs(jobType?: string, orgId?: number, maxRetries = 10): number {
    const failedJobs = Array.from(this.jobs.values())
      .filter(job => {
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

export const jobQueueService = JobQueueService.getInstance();

import crypto from "crypto";
import { log } from "../index";

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
   * Add a job to the queue
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
   * Start the background worker
   */
  startWorker(intervalMs = 10000): void {
    if (this.processInterval) {
      log("Job queue worker already started", "jobQueue");
      return;
    }

    log(`Starting job queue worker (every ${intervalMs}ms)`, "jobQueue");

    this.processInterval = setInterval(() => {
      this.processJobs().catch((err) => {
        log(`Job queue processing error: ${err}`, "jobQueue");
      });
    }, intervalMs);
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

import { db } from '../db';
import { apiJobs } from '@shared/schema';
import { eq, lt, and, or, isNull } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { logger } from "../utils/logger";

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  maxRetries: number;
}

const RATE_LIMITS: Record<string, RateLimitConfig> = {
  openai: { maxRequests: 60, windowMs: 60000, maxRetries: 3 },
  stripe: { maxRequests: 100, windowMs: 1000, maxRetries: 3 },
  lob: { maxRequests: 500, windowMs: 60000, maxRetries: 2 },
  sendgrid: { maxRequests: 1000, windowMs: 60000, maxRetries: 2 },
  twilio: { maxRequests: 100, windowMs: 1000, maxRetries: 2 },
};

const requestCounts: Record<string, { count: number; resetAt: number }> = {};

export class ApiQueueService {
  async enqueue(
    type: string,
    operation: string,
    payload: any,
    organizationId?: number,
    maxRetries: number = 3
  ): Promise<string> {
    const id = randomUUID();
    await db.insert(apiJobs).values({
      id,
      organizationId,
      type,
      operation,
      payload,
      status: 'pending',
      retries: 0,
      maxRetries,
      createdAt: new Date(),
    });
    return id;
  }

  // getJob deleted 2026-08-29 — zero callers, adversarially verified (rule-1 register close-out).

  async getPendingJobs(limit: number = 10) {
    const now = new Date();
    return db
      .select()
      .from(apiJobs)
      .where(
        and(
          or(eq(apiJobs.status, 'pending'), eq(apiJobs.status, 'retrying')),
          or(isNull(apiJobs.nextRetryAt), lt(apiJobs.nextRetryAt, now))
        )
      )
      .limit(limit);
  }

  async updateJob(id: string, updates: Partial<typeof apiJobs.$inferInsert>) {
    await db.update(apiJobs).set(updates).where(eq(apiJobs.id, id));
  }

  calculateBackoff(attempt: number): number {
    const baseDelay = 1000;
    const maxDelay = 30000;
    return Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
  }

  checkRateLimit(type: string): boolean {
    const config = RATE_LIMITS[type];
    if (!config) return true;

    const now = Date.now();
    const tracker = requestCounts[type] || { count: 0, resetAt: now + config.windowMs };

    if (now > tracker.resetAt) {
      requestCounts[type] = { count: 0, resetAt: now + config.windowMs };
      return true;
    }

    return tracker.count < config.maxRequests;
  }

  incrementRateLimit(type: string): void {
    const config = RATE_LIMITS[type];
    if (!config) return;

    const now = Date.now();
    if (!requestCounts[type] || now > requestCounts[type].resetAt) {
      requestCounts[type] = { count: 1, resetAt: now + config.windowMs };
    } else {
      requestCounts[type].count++;
    }
  }

  async processQueue(): Promise<{ processed: number; failed: number }> {
    const jobs = await this.getPendingJobs(10);
    let processed = 0;
    let failed = 0;

    for (const job of jobs) {
      if (!this.checkRateLimit(job.type)) {
        continue;
      }

      try {
        await this.updateJob(job.id, { status: 'processing' });
        this.incrementRateLimit(job.type);

        const result = await this.executeJob(job);
        
        await this.updateJob(job.id, {
          status: 'completed',
          result,
          completedAt: new Date(),
        });
        processed++;
      } catch (error: any) {
        const maxRetries = job.maxRetries || RATE_LIMITS[job.type]?.maxRetries || 3;
        const newRetries = (job.retries || 0) + 1;

        if (newRetries >= maxRetries) {
          await this.updateJob(job.id, {
            status: 'failed',
            error: error.message,
            retries: newRetries,
          });
          failed++;
        } else {
          const nextRetryAt = new Date(Date.now() + this.calculateBackoff(newRetries));
          await this.updateJob(job.id, {
            status: 'retrying',
            error: error.message,
            retries: newRetries,
            nextRetryAt,
          });
        }
      }
    }

    return { processed, failed };
  }

  async executeJob(job: typeof apiJobs.$inferSelect): Promise<any> {
    const payload = job.payload as Record<string, any> || {};
    
    switch (job.type) {
      case 'openai':
        const { requireOpenAIClient } = await import('../utils/openaiClient');
        const openai = requireOpenAIClient();
        if (job.operation === 'chat') {
          const response = await openai.chat.completions.create({
            model: payload.model || 'gpt-4o-mini',
            messages: payload.messages || [],
          });
          return response.choices[0]?.message?.content;
        }
        throw new Error(`Unknown OpenAI operation: ${job.operation}`);

      case 'lob': {
        const { directMailService } = await import('./directMail');
        if (job.operation === 'sendPostcard') {
          return directMailService.sendPostcard(payload as any);
        }
        // B6 (BLOCKERS): `sendPostcard` is the ONLY implemented Lob operation.
        // Anything else is not "unknown" — it is not implemented, and the fault
        // is at the ENQUEUE site, not here: a job this switch cannot run will
        // burn its retries and settle in `failed` forever while the enqueue
        // implies a recovery that never happens. `sendLetter` was exactly that
        // for direct mail; see the comment at the removed enqueue in
        // server/services/communications.ts for the order in which it may be
        // reinstated. Say so plainly, so a future re-introduction fails loudly
        // and points at the caller instead of looking like a queue glitch.
        throw new Error(
          `Lob operation "${job.operation}" is NOT IMPLEMENTED in apiQueue.executeJob ` +
            `(job ${job.id}). Nothing here can ever run it, so enqueuing it is a bug at ` +
            `the enqueue site — fix the caller rather than retrying this job. ` +
            `Implemented Lob operations: sendPostcard. Implementing a physical-mail ` +
            `operation must not be done blind: it would make dormant queued jobs print ` +
            `real mail on the next deploy, and it needs the outward-action boundary ` +
            `keyed on job.id.`,
        );
      }

      default:
        throw new Error(`Unknown job type: ${job.type}`);
    }
  }

  async cleanupOldJobs(olderThanDays: number = 7): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    // Delete completed jobs older than cutoff
    const completedResult = await db
      .delete(apiJobs)
      .where(
        and(
          eq(apiJobs.status, 'completed'),
          lt(apiJobs.completedAt!, cutoffDate)
        )
      )
      .returning({ id: apiJobs.id });

    // Also delete failed jobs older than cutoff (after 30 days)
    const failedCutoff = new Date();
    failedCutoff.setDate(failedCutoff.getDate() - 30);
    
    const failedResult = await db
      .delete(apiJobs)
      .where(
        and(
          eq(apiJobs.status, 'failed'),
          lt(apiJobs.createdAt!, failedCutoff)
        )
      )
      .returning({ id: apiJobs.id });

    const totalDeleted = completedResult.length + failedResult.length;
    if (totalDeleted > 0) {
      logger.info(`[queue] Cleaned up ${completedResult.length} completed and ${failedResult.length} failed jobs`);
    }
    
    return totalDeleted;
  }
}

export const apiQueueService = new ApiQueueService();

export async function queueApiCall(
  type: string,
  operation: string,
  payload: any,
  organizationId?: number
): Promise<string> {
  return apiQueueService.enqueue(type, operation, payload, organizationId);
}

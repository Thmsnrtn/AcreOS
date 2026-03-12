/**
 * systemActivityLogger.ts
 *
 * Thin, fire-and-forget wrapper that records every meaningful autonomous action
 * the system takes into the system_activity table. Used to power the live
 * "System Activity" feed on the founder dashboard.
 *
 * Never throws. Always non-blocking.
 */

import { db } from "../db";
import { systemActivity } from "@shared/schema";

interface LogActivityParams {
  orgId?: number;
  job: string;
  action: string;
  summary: string;
  entityType?: string;
  entityId?: string | number;
  metadata?: Record<string, any>;
}

export async function logActivity(params: LogActivityParams): Promise<void> {
  try {
    await db.insert(systemActivity).values({
      orgId: params.orgId ?? null,
      jobName: params.job,
      action: params.action,
      summary: params.summary,
      entityType: params.entityType ?? null,
      entityId: params.entityId != null ? String(params.entityId) : null,
      metadata: params.metadata ?? null,
    });
  } catch {
    // Silent — never interrupt the calling job
  }
}

/**
 * Convenience: wrap an async function so any thrown error is swallowed
 * and logged to systemActivity before re-throwing to the caller.
 */
export async function withActivityOnError<T>(
  job: string,
  fn: () => Promise<T>
): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    logActivity({
      job,
      action: "job_error",
      summary: `${job} encountered an error: ${err?.message ?? "unknown error"}`,
      metadata: { stack: err?.stack?.slice(0, 500) },
    }).catch(() => {});
    throw err;
  }
}

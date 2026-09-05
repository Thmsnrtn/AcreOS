/**
 * Frugal Autonomy — Intelligence Coordinator
 *
 * Adds three gates to recurring AI jobs so they only run when they
 * should:
 *   1. Budget gate — if the job's category is over today's cap, skip.
 *   2. Must-run condition — founder-essential jobs always run regardless
 *      of activity (e.g. morning brief always fires for Tom). Non-essential
 *      jobs skip when their precondition isn't met.
 *   3. Idle dormancy — if inputs haven't changed since last run, skip.
 *      A daily company-briefing job that already ran today with the same
 *      agent set / metrics returns the cached output instead of paying
 *      again.
 *
 * Usage from a scheduled job (replaces the bare `await processX()` body):
 *
 *   const gate = await shouldRunAIJob("company_briefing", {
 *     category: "briefing",
 *     mustRunCondition: () => founderActiveInLast7Days(),
 *     fingerprintInputs: () => agentCountSinceLastRun(),
 *   });
 *   if (!gate.run) { log(`skip: ${gate.reason}`); return; }
 *   await processX();
 *
 * Job runs are persisted to `intelligence_job_runs` (created lazily —
 * idempotent CREATE TABLE on first call so this module is safe to ship
 * before the migration lands).
 */

import { db } from "../../db";
import { sql } from "drizzle-orm";
import { logger } from "../../utils/logger";
import {
  type BudgetCategory,
  checkBudget,
} from "./budget";

export interface JobGateOptions {
  /** Budget category to check before running. Default "general". */
  category?: BudgetCategory;
  /**
   * Founder-essential override. Return `true` to allow the job to run
   * even when other gates would skip (still subject to budget cap).
   * Use this for things like the morning brief that the founder reads
   * daily regardless of activity.
   */
  mustRunCondition?: () => boolean | Promise<boolean>;
  /**
   * Returns a fingerprint of the job's *inputs*. If the fingerprint is
   * identical to the last successful run's fingerprint, the job skips
   * (its output would be the same; no point re-paying for it).
   *
   * Return null to disable input-change tracking (always-run-when-due).
   */
  fingerprintInputs?: () => string | Promise<string> | null | Promise<null>;
  /**
   * Minimum time between runs in minutes. The coordinator skips if the
   * job ran more recently than this even if the cron timer fires.
   * Defaults to 0 (no min interval — rely on the cron schedule).
   */
  minIntervalMinutes?: number;
}

export interface JobGateResult {
  run: boolean;
  reason: string;
}

/**
 * Lazy-initialize the job-runs table on first call. Idempotent.
 */
let tableReady = false;
async function ensureTable(): Promise<void> {
  if (tableReady) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "intelligence_job_runs" (
        "name"             text PRIMARY KEY,
        "last_ran_at"      timestamp NOT NULL DEFAULT now(),
        "last_fingerprint" text,
        "last_skipped"     boolean NOT NULL DEFAULT false,
        "last_skip_reason" text,
        "total_runs"       integer NOT NULL DEFAULT 0,
        "total_skips"      integer NOT NULL DEFAULT 0
      )
    `);
    tableReady = true;
  } catch (err) {
    logger.warn("[coordinator] ensureTable failed", {
      metadata: { err: err instanceof Error ? err.message : String(err) },
    });
  }
}

// Declared as a type alias (not an interface) so it satisfies the
// `Record<string, unknown>` constraint on db.execute<T>().
type JobRunRow = {
  name: string;
  last_ran_at: Date;
  last_fingerprint: string | null;
  last_skipped: boolean;
  last_skip_reason: string | null;
  total_runs: number;
  total_skips: number;
};

async function getJobRunRow(name: string): Promise<JobRunRow | null> {
  await ensureTable();
  try {
    const r = await db.execute<JobRunRow>(sql`
      SELECT name, last_ran_at, last_fingerprint, last_skipped, last_skip_reason, total_runs, total_skips
      FROM intelligence_job_runs
      WHERE name = ${name}
      LIMIT 1
    `);
    const rows = (r as any)?.rows ?? r;
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  } catch {
    return null;
  }
}

async function recordSkip(name: string, reason: string, fingerprint: string | null): Promise<void> {
  // The table is lazily created, so EVERY statement that names it has to
  // ensure it first. `getJobRunRow` did; the two writers did not — and the
  // catch below turned "relation intelligence_job_runs does not exist" into a
  // warn, so a skip that was never recorded looked exactly like a skip that
  // was. The coordinator's whole job is deduping AI work; losing the record
  // silently means the next tick re-runs work it meant to skip.
  await ensureTable();
  try {
    await db.execute(sql`
      INSERT INTO intelligence_job_runs (name, last_ran_at, last_fingerprint, last_skipped, last_skip_reason, total_runs, total_skips)
      VALUES (${name}, now(), ${fingerprint}, true, ${reason}, 0, 1)
      ON CONFLICT (name) DO UPDATE SET
        last_ran_at = now(),
        last_fingerprint = ${fingerprint},
        last_skipped = true,
        last_skip_reason = ${reason},
        total_skips = intelligence_job_runs.total_skips + 1
    `);
  } catch (err) {
    logger.warn("[coordinator] recordSkip failed", {
      metadata: { name, err: err instanceof Error ? err.message : String(err) },
    });
  }
}

/**
 * Call this from a scheduled job's entrypoint BEFORE doing real work.
 * Returns { run: true } when all gates pass, { run: false, reason } when
 * any gate refuses. On a "false" result the job should return immediately;
 * the coordinator has already logged the skip.
 *
 * Always errs toward running on its own bugs — if any gate query fails
 * unexpectedly, the job runs. Better to slightly overspend than to
 * silently break autonomy.
 */
export async function shouldRunAIJob(
  name: string,
  options: JobGateOptions = {},
): Promise<JobGateResult> {
  const {
    category = "general",
    mustRunCondition,
    fingerprintInputs,
    minIntervalMinutes = 0,
  } = options;

  // Gate 1 — budget. Read remaining in category; refuse if zero.
  try {
    const b = await checkBudget(category);
    if (!b.withinBudget) {
      await recordSkip(name, `budget exhausted (cat=${category}, spent=${b.spentCents}¢ / cap=${b.capCents}¢)`, null);
      return { run: false, reason: `budget category=${category} exhausted` };
    }
  } catch (err) {
    logger.warn("[coordinator] budget check failed — allowing job", {
      metadata: { name, err: err instanceof Error ? err.message : String(err) },
    });
  }

  // Gate 2 — must-run condition (or skip-when-no-activity).
  if (mustRunCondition) {
    try {
      const required = await mustRunCondition();
      if (!required) {
        await recordSkip(name, "mustRunCondition false", null);
        return { run: false, reason: "mustRunCondition returned false" };
      }
    } catch (err) {
      // mustRunCondition errors: fail-open, run.
      logger.warn("[coordinator] mustRunCondition errored — running anyway", {
        metadata: { name, err: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  // Gate 3 — input-change fingerprint + min-interval.
  let fingerprint: string | null = null;
  if (fingerprintInputs) {
    try {
      const fp = await fingerprintInputs();
      if (typeof fp === "string") fingerprint = fp;
    } catch {
      // fail-open
    }
  }
  const row = await getJobRunRow(name);
  if (row) {
    const minutesSince = (Date.now() - new Date(row.last_ran_at).getTime()) / 60_000;
    if (minIntervalMinutes > 0 && minutesSince < minIntervalMinutes) {
      await recordSkip(name, `min interval (${minIntervalMinutes}m, last ran ${minutesSince.toFixed(1)}m ago)`, fingerprint);
      return { run: false, reason: `min interval not yet elapsed` };
    }
    if (
      fingerprint &&
      row.last_fingerprint === fingerprint &&
      row.last_skipped === false // only skip when last attempt actually ran
    ) {
      await recordSkip(name, `inputs unchanged (fingerprint=${fingerprint.slice(0, 32)}…)`, fingerprint);
      return { run: false, reason: "inputs unchanged since last successful run" };
    }
  }

  return { run: true, reason: "all gates passed" };
}

/**
 * Call this AFTER a job's real work completes successfully so the
 * coordinator records the fingerprint + bumps the run counter.
 * Pair with shouldRunAIJob via try/finally for guaranteed bookkeeping.
 */
export async function recordJobRun(name: string, fingerprint?: string | null): Promise<void> {
  // Same reason as recordSkip — and this one is EXPORTED, so it can be called
  // without `shouldRunAIJob` ever having run in this process. The doc comment
  // asks callers to pair them; nothing enforces that, so the ensure belongs
  // here rather than in the pairing.
  await ensureTable();
  try {
    await db.execute(sql`
      INSERT INTO intelligence_job_runs (name, last_ran_at, last_fingerprint, last_skipped, last_skip_reason, total_runs, total_skips)
      VALUES (${name}, now(), ${fingerprint ?? null}, false, null, 1, 0)
      ON CONFLICT (name) DO UPDATE SET
        last_ran_at = now(),
        last_fingerprint = ${fingerprint ?? null},
        last_skipped = false,
        last_skip_reason = null,
        total_runs = intelligence_job_runs.total_runs + 1
    `);
  } catch (err) {
    logger.warn("[coordinator] recordJobRun failed", {
      metadata: { name, err: err instanceof Error ? err.message : String(err) },
    });
  }
}

/**
 * Compose a stable fingerprint from arbitrary input objects.
 * Use this in fingerprintInputs callbacks instead of hand-rolling
 * serialization so every job uses the same hashing.
 */
export function fingerprintOf(...parts: unknown[]): string {
  // Stable JSON: sort object keys recursively before stringifying.
  const stableStringify = (v: unknown): string => {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return (
      "{" +
      keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") +
      "}"
    );
  };
  // Lightweight non-cryptographic hash (sufficient for change detection).
  const s = parts.map(stableStringify).join("|");
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return `h${h}_${s.length}`;
}

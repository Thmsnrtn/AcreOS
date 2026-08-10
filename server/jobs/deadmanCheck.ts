/**
 * deadmanCheck.ts — the missing DEADMAN for scheduled jobs.
 *
 * Problem (verified): a scheduled job can stop running and ALL alarms stay
 * green. The three existing health systems key on rows that EXIST, never on
 * rows that SHOULD exist (see jobRegistry.ts header). This module closes that
 * blind spot by asserting the EXPECTATION encoded in JOB_ROSTER: for every job
 * we expect to be alive, when did it last emit ANY job_health_logs row?
 *
 * Liveness signal — why job_health_logs is sufficient
 * ───────────────────────────────────────────────────
 * jobRuntime.withJobLock writes a job_health_logs row on:
 *   - `failed`        (always, on a thrown error)
 *   - `skipped_lock`  (always, when another machine holds the lock)
 *   - `success`       (SAMPLED — at most one per hour per job per process)
 * Success is sampled, so a healthy high-frequency job might go >1h between
 * `success` rows — but a job that reaches `withJobLock` at all on a multi-
 * machine deploy will frequently write `skipped_lock` (only one machine wins
 * the lock; the rest log skipped_lock every tick). We therefore count
 * skipped_lock AS LIVENESS: a lock-skipped job is demonstrably alive. This
 * avoids write-amplification (no always-on success heartbeat) while still
 * detecting true death. The deadman threshold is 2× the job's effective work
 * cadence, which is comfortably larger than the 1-hour success sampling window
 * for every daily+ job, and high-frequency jobs (≤30m) emit skipped_lock or
 * sampled-success well inside 2× their interval on any multi-machine worker.
 *
 * On a genuinely SINGLE-machine worker a low-frequency job with zero failures
 * and zero lock contention could in theory go a full success-sampling window
 * without a row; that is why intervalMs is the WORK cadence (≥ daily for the
 * time-gated jobs) and the threshold is 2× — a daily job that ran today writes
 * one sampled-success row today, which is < 2×24h old tomorrow.
 *
 * Action on detection
 * ───────────────────
 * raiseAlert via the ONE alert spine (Tier 1D): a dark CRITICAL job pages
 * (P0, throttled inside the spine — the repage throttle that used to live
 * here was hoisted into alertSpine.pageCriticalThrottled) + records a
 * reliability finding + a system_alerts row. A dark non-critical job lands
 * as a warning (finding + system_alerts, no page) per spine policy.
 *
 * Tier 1H / blueprint E11: the spine's throttle window is in-process and
 * resets on deploy, so the deadman PERSISTS page timestamps to
 * deadman_page_state (migration 0154). Each sweep hydrates the persisted
 * rows and seeds the spine's window (seedPageThrottle) before raising, so a
 * deploy mid-incident doesn't re-page on-call for every still-dark job.
 *
 * Dedupe: findings upsert on (detector, dedupeKey); the dedupeKey is
 * per-job, so a job that stays dark re-fires (bumps last_seen_at) rather
 * than spamming. The spine's page/system_alert windows additionally ensure
 * we don't re-page the same dark job every 5 minutes.
 */

import { sql } from "drizzle-orm";
import { db } from "../db";
import { deadmanPageState, jobHealthLogs } from "@shared/schema";
import { logger } from "../utils/logger";
import { raiseAlert, seedPageThrottle } from "../services/alertSpine";
import { recordFinding } from "../services/audit/domainAudit";
import { activeRosterEntries, configDormantEntries, resolveFailureLane, type ConfigDormantEntry } from "./jobRegistry";

// Process start time — used to avoid false-paging a job that has simply never
// had a chance to run yet on a freshly-booted worker.
const _processStartedAt = Date.now();

const DETECTOR_ID = "job_deadman";

export interface DeadmanResult {
  checked: number;
  dark: Array<{ name: string; critical: boolean; lastSeenMs: number | null; thresholdMs: number }>;
  /** Tier 1E meta-check: roster jobs currently dormant on missing config. */
  configDormant: ConfigDormantEntry[];
}

/**
 * Walk the active roster; page + record a finding for any job that has gone
 * dark (no job_health_logs row within 2× its effective cadence). Returns the
 * set of dark jobs (also used by tests).
 */
export async function runJobDeadmanCheck(): Promise<DeadmanResult> {
  const entries = activeRosterEntries();
  const now = Date.now();
  const uptimeMs = now - _processStartedAt;
  const dark: DeadmanResult["dark"] = [];

  // Hydrate the persisted re-page throttle (one read per sweep). Best-effort:
  // a failed read degrades to the in-memory map (worst case: one duplicate
  // page after a deploy — the pre-persistence behavior).
  const persistedPagedAt = new Map<string, number>();
  try {
    const rows = await db.select().from(deadmanPageState);
    for (const row of rows) {
      persistedPagedAt.set(row.jobName, new Date(row.lastPagedAt).getTime());
    }
  } catch (err) {
    logger.warn("[deadman] failed to hydrate deadman_page_state — using in-memory throttle only", {
      metadata: { error: String(err) },
    });
  }

  for (const entry of entries) {
    let lastSeenMs: number | null = null;
    try {
      // ANY status counts as liveness: success | failed | timeout |
      // skipped_lock. A lock-skipped job is alive; a failed job is alive (and
      // already separately alarmed). We only care that SOMETHING ran.
      const [row] = await db
        .select({ lastSeen: sql<Date | null>`max(${jobHealthLogs.runStartedAt})` })
        .from(jobHealthLogs)
        .where(sql`${jobHealthLogs.jobName} = ${entry.name}`);
      lastSeenMs = row?.lastSeen ? new Date(row.lastSeen).getTime() : null;
    } catch (err) {
      // Best-effort: if the query itself fails, log and skip this job rather
      // than crash the whole sweep. A DB outage is alarmed elsewhere.
      logger.warn(`[deadman] failed to query last-seen for ${entry.name}`, {
        metadata: { error: String(err) },
      });
      continue;
    }

    const thresholdMs = entry.intervalMs * 2;

    let isDark: boolean;
    if (lastSeenMs == null) {
      // Never seen. Only treat as dark once the process has been up long
      // enough that the job SHOULD have run at least once — otherwise a fresh
      // boot would page every job before its first scheduled tick.
      isDark = uptimeMs > entry.intervalMs;
    } else {
      isDark = now - lastSeenMs > thresholdMs;
    }

    if (!isDark) continue;
    dark.push({ name: entry.name, critical: entry.critical, lastSeenMs, thresholdMs });

    const ageDesc =
      lastSeenMs == null
        ? `never (process up ${Math.round(uptimeMs / 60000)}m, expected every ${Math.round(entry.intervalMs / 60000)}m)`
        : `${Math.round((now - lastSeenMs) / 60000)}m ago (threshold ${Math.round(thresholdMs / 60000)}m)`;

    const title = `Scheduled job dark: ${entry.name}`;
    const body =
      `Job "${entry.name}" has emitted no job_health_logs row (success/failed/skipped_lock) ` +
      `within 2× its expected cadence. Last seen: ${ageDesc}. ` +
      `It may have stopped registering (deploy regression), be stuck, or its host worker may be down.`;

    // One spine call replaces the old recordFinding + throttled notifyOnCall
    // pair: critical job dark → P0 page (throttled once/hour inside the
    // spine) + finding + system_alerts; non-critical dark → warning finding
    // + system_alerts, no page.
    //
    // Tier 1H / blueprint E11: the spine's page-throttle window is in-process
    // and resets on deploy. Seed it from the persisted deadman_page_state row
    // so a deploy mid-incident doesn't re-page on-call for every still-dark
    // job; when the spine DOES page, persist the timestamp back.
    const persisted = persistedPagedAt.get(entry.name);
    if (persisted != null) {
      seedPageThrottle(DETECTOR_ID, `dark:${entry.name}`, persisted);
    }
    // Pager-matrix-as-data (audit P5-1 / Wave 0.9): the roster's resolved
    // lane — not a local criticality branch — decides the dispatch. page →
    // critical spine alert (P0 page); queue → warning spine alert (finding +
    // system_alerts, no page); tray → log-only (for jobs whose absence a
    // human reviews on their own cadence — no spine row).
    const lane = resolveFailureLane(entry);
    if (lane === "tray") {
      logger.warn(`[deadman] tray ${title} — ${ageDesc}`, {
        metadata: { job: entry.name, lastSeenMs, thresholdMs, lane },
      });
      continue;
    }
    try {
      const alertResult = await raiseAlert({
        severity: lane === "page" ? "critical" : "warning",
        source: DETECTOR_ID,
        title,
        detail: body,
        dedupeKey: `dark:${entry.name}`,
        domain: "reliability",
        citedReason:
          "SLO: every roster job must emit a liveness row within 2× its cadence (deadman).",
        subjectRef: entry.name,
        alertType: "job_dark",
        metadata: { lastSeenMs, thresholdMs, critical: entry.critical, lane, intervalMs: entry.intervalMs },
      });
      if (alertResult.paged) {
        // Persist the page timestamp (fire-and-forget — never block the sweep).
        db.insert(deadmanPageState)
          .values({ jobName: entry.name, lastPagedAt: new Date(now), updatedAt: new Date(now) })
          .onConflictDoUpdate({
            target: deadmanPageState.jobName,
            set: { lastPagedAt: new Date(now), updatedAt: new Date(now) },
          })
          .catch((err) => {
            logger.warn(`[deadman] failed to persist page state for ${entry.name}`, {
              metadata: { error: String(err) },
            });
          });
      }
    } catch (err) {
      // raiseAlert is internally best-effort, but never let an alerting
      // failure abort the rest of the sweep.
      logger.error(`[deadman] raiseAlert failed for ${entry.name}`, err instanceof Error ? err : undefined);
    }

    logger.warn(`[deadman] ${entry.critical ? "P0" : "P1"} ${title} — ${ageDesc}`, {
      metadata: { job: entry.name, lastSeenMs, thresholdMs },
    });
  }

  if (dark.length === 0) {
    logger.info(`[deadman] all ${entries.length} active roster jobs alive`);
  } else {
    logger.warn(`[deadman] ${dark.length}/${entries.length} roster jobs DARK`, {
      metadata: { dark: dark.map((d) => d.name) },
    });
  }

  // ── Tier 1E meta-check: config-dormant jobs must stay VISIBLE ─────────────
  // A disabledWhen predicate keeps the deadman from false-paging, but it also
  // creates the opposite failure mode: a critical job sits "intentionally"
  // dormant on a missing secret and everyone forgets it exists. Every sweep,
  // list the dormant roster entries; record a durable, deduped finding for
  // each CRITICAL one (warn severity — it's a known gap, not an outage) so
  // the founder surfaces keep showing it until the config lands.
  const configDormant = configDormantEntries();
  // Same matrix as darkness dispatch: dormancy visibility follows the
  // resolved lane, not the raw critical flag (audit P5-1 / Wave 0.9).
  const dormantCritical = configDormant.filter((e) => e.lane === "page");
  if (configDormant.length > 0) {
    logger.warn(
      `[deadman] ${configDormant.length} roster job(s) config-dormant (${dormantCritical.length} critical): ` +
        configDormant.map((e) => `${e.name}${e.critical ? " [CRITICAL]" : ""}`).join(", "),
      { metadata: { configDormant } },
    );
  }
  for (const entry of dormantCritical) {
    try {
      await recordFinding({
        domain: "reliability",
        detector: "job_config_dormant",
        severity: "warn",
        title: `Critical job config-dormant: ${entry.name}`,
        detail:
          `Critical scheduled job "${entry.name}" is wired but dormant on missing configuration. ` +
          `Reason: ${entry.reason}. It will activate the moment the config lands — until then this ` +
          `finding re-fires every deadman sweep so the gap cannot be forgotten.`,
        citedReason:
          "Tier 1E: config-dormant critical jobs must be listed every sweep, never silently skipped.",
        dedupeKey: `config-dormant:${entry.name}`,
        subjectRef: entry.name,
        metadata: { reason: entry.reason },
      });
    } catch (err) {
      logger.error(
        `[deadman] recordFinding (config-dormant) failed for ${entry.name}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  return { checked: entries.length, dark, configDormant };
}

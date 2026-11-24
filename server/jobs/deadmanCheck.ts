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
 * detecting true death.
 *
 * MON-DEF-1 (2026-11-21) — the threshold is DERIVED, never a bare 2× the
 * work cadence. The original 2× rule sat INSIDE the healthy row gap of
 * every sub-hourly job on a single-lock-winner worker: success rows are
 * sampled at SUCCESS_LOG_SAMPLE_MS (1h), so burn_rate_monitor (5m tick)
 * legitimately emits rows ~65m apart against a 10m threshold, and
 * retry_failed_actions / recourse_sweep (30m) emit rows 57–81m apart
 * against 60m — staging produced 30–67 false job_dark alerts/hour for
 * months. `deadmanThresholdMs` (jobRegistry.ts) derives the threshold
 * from both sources of truth — 2 × max(intervalMs, SAMPLE) — which
 * provably exceeds the worst-case healthy gap (SAMPLE + interval) for
 * every job while keeping daily+ jobs at exactly 2× cadence. The pure
 * judgment lives in deadmanPolicy.ts (evaluateDarkness).
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
 *
 * MON-DEF-1 — page-once-then-digest: the persisted row's meaning widened
 * from "last paged at" to "last FULL-severity alert of the current dark
 * episode" (deadmanPolicy.deadmanAlertMode). A dark job with a full alert
 * inside DEADMAN_REPAGE_WINDOW_MS (24h) is re-raised at info severity —
 * the finding upsert IS the digest (it bumps last_seen_at; no page, no
 * system_alerts row). A job observed alive again has its row DELETED, so
 * the next episode opens with a fresh full alert: a job that recovers and
 * dies again pages again.
 */

import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { deadmanPageState, jobHealthLogs, jobRuns } from "@shared/schema";
import { logger } from "../utils/logger";
import { raiseAlert, seedPageThrottle } from "../services/alertSpine";
import { recordFinding } from "../services/audit/domainAudit";
import { activeRosterEntries, configDormantEntries, type ConfigDormantEntry } from "./jobRegistry";
import { deadmanAlertMode, evaluateDarkness } from "./deadmanPolicy";
import { clock } from "../utils/clock";

// Process start time — used to avoid false-paging a job that has simply never
// had a chance to run yet on a freshly-booted worker.
const _processStartedAt = clock.nowMs();

const DETECTOR_ID = "job_deadman";

export interface DeadmanResult {
  checked: number;
  dark: Array<{ name: string; critical: boolean; lastSeenMs: number | null; thresholdMs: number }>;
  /** Dark jobs re-raised as digest (finding-only) this sweep — MON-DEF-1. */
  digested: string[];
  /** Tier 1E meta-check: roster jobs currently dormant on missing config. */
  configDormant: ConfigDormantEntry[];
}

/**
 * Walk the active roster; page + record a finding for any job that has gone
 * dark (no liveness row within its derived deadman threshold). Returns the
 * set of dark jobs (also used by tests).
 */
export async function runJobDeadmanCheck(): Promise<DeadmanResult> {
  const entries = activeRosterEntries();
  const now = clock.nowMs();
  const uptimeMs = now - _processStartedAt;
  const dark: DeadmanResult["dark"] = [];
  const digested: string[] = [];

  // Hydrate the persisted episode state (one read per sweep): per job, the
  // timestamp of the last FULL-severity alert of its current dark episode.
  // Best-effort: a failed read degrades to an empty map (worst case: one
  // duplicate full alert after a deploy — the pre-persistence behavior).
  const persistedAlertAt = new Map<string, number>();
  try {
    const rows = await db.select().from(deadmanPageState);
    for (const row of rows) {
      persistedAlertAt.set(row.jobName, new Date(row.lastPagedAt).getTime());
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
      //
      // BOTH TABLES, because this codebase records liveness in two of them and
      // reading one is a population claim, not a query. `withJobLock` writes
      // `job_health_logs`; `scheduleSelfRescheduling` writes `job_runs` — a
      // row before every run and an update after it. A job registered through
      // the scheduler whose body never calls withJobLock emits nothing into
      // job_health_logs at all, so against that table alone it is
      // indistinguishable from a job that has never run — and adding it to the
      // roster would have paged it as permanently dark rather than watched it.
      //
      // Measured 2026-09-05: 13 live scheduled jobs were in exactly that
      // position, sequence_processor and the two revenue-recognition workers
      // among them. They were absent from JOB_ROSTER, which read as "nothing to
      // watch" and was really "nothing this query could see".
      const [health] = await db
        .select({ lastSeen: sql<Date | null>`max(${jobHealthLogs.runStartedAt})` })
        .from(jobHealthLogs)
        .where(sql`${jobHealthLogs.jobName} = ${entry.name}`);
      const [runs] = await db
        .select({ lastSeen: sql<Date | null>`max(${jobRuns.startedAt})` })
        .from(jobRuns)
        .where(sql`${jobRuns.jobName} = ${entry.name}`);
      const seen = [health?.lastSeen, runs?.lastSeen]
        .filter((d): d is Date => d != null)
        .map((d) => new Date(d).getTime());
      lastSeenMs = seen.length > 0 ? Math.max(...seen) : null;
    } catch (err) {
      // Best-effort: if the query itself fails, log and skip this job rather
      // than crash the whole sweep. A DB outage is alarmed elsewhere.
      logger.warn(`[deadman] failed to query last-seen for ${entry.name}`, {
        metadata: { error: String(err) },
      });
      continue;
    }

    // Darkness + threshold from the pure policy (deadmanPolicy.ts): the
    // threshold is derived from the cadence AND the success-log sampling
    // window — a bare 2× intervalMs sits inside the healthy row gap of
    // every sub-hourly job (MON-DEF-1).
    const { isDark, thresholdMs } = evaluateDarkness({
      entry,
      lastSeenMs,
      nowMs: now,
      uptimeMs,
    });

    if (!isDark) {
      // Episode close: the job is alive again. If a previous dark episode
      // left persisted state, delete it so the NEXT episode opens with a
      // fresh full alert instead of inheriting this one's digest window.
      if (persistedAlertAt.has(entry.name)) {
        persistedAlertAt.delete(entry.name);
        db.delete(deadmanPageState)
          .where(eq(deadmanPageState.jobName, entry.name))
          .catch((err) => {
            logger.warn(`[deadman] failed to clear page state for recovered ${entry.name}`, {
              metadata: { error: String(err) },
            });
          });
      }
      continue;
    }
    dark.push({ name: entry.name, critical: entry.critical, lastSeenMs, thresholdMs });

    const ageDesc =
      lastSeenMs == null
        ? `never (process up ${Math.round(uptimeMs / 60000)}m, expected every ${Math.round(entry.intervalMs / 60000)}m)`
        : `${Math.round((now - lastSeenMs) / 60000)}m ago (threshold ${Math.round(thresholdMs / 60000)}m)`;

    const title = `Scheduled job dark: ${entry.name}`;
    const body =
      `Job "${entry.name}" has emitted no liveness row (job_health_logs or job_runs) ` +
      `within its deadman threshold. Last seen: ${ageDesc}. ` +
      `It may have stopped registering (deploy regression), be stuck, or its host worker may be down.`;

    // Page-once-then-digest (MON-DEF-1): a job whose current dark episode
    // already got a full alert inside the repage window is re-raised at
    // info severity — the spine turns that into a finding upsert only
    // (the digest record), with no page and no new system_alerts row.
    const mode = deadmanAlertMode({
      lastFullAlertMs: persistedAlertAt.get(entry.name) ?? null,
      nowMs: now,
    });

    if (mode === "digest") {
      digested.push(entry.name);
      try {
        await raiseAlert({
          severity: "info",
          source: DETECTOR_ID,
          title,
          detail: body,
          dedupeKey: `dark:${entry.name}`,
          domain: "reliability",
          citedReason:
            "SLO: every roster job must emit a liveness row within its deadman threshold.",
          subjectRef: entry.name,
          alertType: "job_dark",
          metadata: {
            lastSeenMs,
            thresholdMs,
            critical: entry.critical,
            intervalMs: entry.intervalMs,
            alertMode: "digest",
          },
        });
      } catch (err) {
        logger.error(`[deadman] digest raiseAlert failed for ${entry.name}`, err instanceof Error ? err : undefined);
      }
      logger.info(`[deadman] still dark (digest): ${entry.name} — ${ageDesc}`, {
        metadata: { job: entry.name, lastSeenMs, thresholdMs },
      });
      continue;
    }

    // Full alert. One spine call replaces the old recordFinding + throttled
    // notifyOnCall pair: critical job dark → P0 page (throttled once/hour
    // inside the spine) + finding + system_alerts; non-critical dark →
    // warning finding + system_alerts, no page.
    //
    // Tier 1H / blueprint E11: the spine's page-throttle window is in-process
    // and resets on deploy. Seed it from the persisted deadman_page_state row
    // so a deploy mid-incident doesn't re-page on-call for every still-dark
    // job; persist the full-alert timestamp back for BOTH severities (the
    // row now opens the episode's digest window, not just the page throttle).
    const persisted = persistedAlertAt.get(entry.name);
    if (persisted != null) {
      seedPageThrottle(DETECTOR_ID, `dark:${entry.name}`, persisted);
    }
    try {
      await raiseAlert({
        severity: entry.critical ? "critical" : "warning",
        source: DETECTOR_ID,
        title,
        detail: body,
        dedupeKey: `dark:${entry.name}`,
        domain: "reliability",
        citedReason:
          "SLO: every roster job must emit a liveness row within its deadman threshold.",
        subjectRef: entry.name,
        alertType: "job_dark",
        metadata: {
          lastSeenMs,
          thresholdMs,
          critical: entry.critical,
          intervalMs: entry.intervalMs,
          alertMode: "full",
        },
      });
      // Persist the full-alert timestamp (fire-and-forget — never block the sweep).
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
  const dormantCritical = configDormant.filter((e) => e.critical);
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

  return { checked: entries.length, dark, digested, configDormant };
}

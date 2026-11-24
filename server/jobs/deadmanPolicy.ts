/**
 * deadmanPolicy.ts — the job deadman's pure decision logic (MON-DEF-1).
 *
 * Extracted from deadmanCheck.ts so the two judgment calls the sweep makes
 * per job — "is it dark?" and "full alert or digest?" — are unit-testable
 * without a database. This module is dependency-free apart from the roster
 * types + threshold derivation in jobRegistry.ts (which is itself
 * dependency-free), mirroring the arrangement the Tier 1E predicates use.
 *
 * Why "digest" exists
 * ───────────────────
 * Before MON-DEF-1, a continuously-dark job was re-raised at full severity
 * on every sweep, forever: the alert spine's 1h dedupe window and the
 * hourly sweep cadence aligned, so each dark job produced a fresh page +
 * system_alerts row roughly every hour (staging measured 30–67 job_dark
 * alerts/hour across ~40 miscalibrated jobs). The durable record of an
 * ongoing incident is the FINDING — recordFinding upserts on
 * (detector, dedupeKey), so re-raising bumps last_seen_at. A dark episode
 * therefore needs exactly one full alert when it opens, finding-only
 * digest bumps while it continues, and one fresh full alert per
 * DEADMAN_REPAGE_WINDOW_MS for as long as it stays dark — plus a fresh
 * full alert the moment a NEW episode opens after a recovery.
 */

import { deadmanThresholdMs, type JobRosterEntry } from "./jobRegistry";

/**
 * How long a continuously-dark job stays in digest mode before the
 * deadman re-raises at full severity (re-page for critical jobs). One
 * full alert per day per dark episode: loud enough that a week-long
 * outage can't be forgotten, quiet enough that it can't become the storm
 * this cure exists to stop.
 */
export const DEADMAN_REPAGE_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface DarknessEvaluation {
  isDark: boolean;
  /** The derived threshold the age was judged against. */
  thresholdMs: number;
}

/**
 * Judge one roster entry's liveness.
 *
 * `lastSeenMs` is the newest liveness row (job_health_logs OR job_runs)
 * or null when the job has never emitted one. A never-seen job is only
 * dark once the process has been up past one full cadence — otherwise a
 * fresh boot would page every job before its first scheduled tick.
 * A seen job is dark when its row age exceeds the DERIVED threshold
 * (deadmanThresholdMs — never a bare 2× intervalMs: success rows are
 * sampled, so the healthy row gap can reach SAMPLE + interval).
 */
export function evaluateDarkness(input: {
  entry: Pick<JobRosterEntry, "intervalMs">;
  lastSeenMs: number | null;
  nowMs: number;
  uptimeMs: number;
}): DarknessEvaluation {
  const thresholdMs = deadmanThresholdMs(input.entry);
  if (input.lastSeenMs == null) {
    return { isDark: input.uptimeMs > input.entry.intervalMs, thresholdMs };
  }
  return { isDark: input.nowMs - input.lastSeenMs > thresholdMs, thresholdMs };
}

export type DeadmanAlertMode = "full" | "digest";

/**
 * Decide whether a dark job gets a full-severity raise (page for critical
 * jobs + system_alerts row) or a digest raise (finding upsert only).
 *
 * `lastFullAlertMs` is the persisted timestamp of the last full raise for
 * the CURRENT dark episode (deadman_page_state), or null when no episode
 * is open — including right after a recovery cleared the row, which is
 * what makes a genuinely-dark job page again after it comes back and
 * dies a second time.
 */
export function deadmanAlertMode(input: {
  lastFullAlertMs: number | null;
  nowMs: number;
}): DeadmanAlertMode {
  if (input.lastFullAlertMs == null) return "full";
  return input.nowMs - input.lastFullAlertMs >= DEADMAN_REPAGE_WINDOW_MS
    ? "full"
    : "digest";
}

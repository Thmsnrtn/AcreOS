/**
 * deadmanCadence.test.ts — MON-DEF-1: the job deadman must judge jobs by
 * their liveness-ROW cadence, not their tick cadence.
 *
 * The defect (staging, measured 2026-11-20/21): `withJobLock` writes
 * success rows SAMPLED at ≤1/hour/process, so a healthy sub-hourly job's
 * rows land ~hourly. The deadman compared row age against 2× the TICK
 * cadence (burn_rate_monitor 5m → 10m threshold vs ~65m actual row gaps;
 * retry_failed_actions / recourse_sweep 30m → 60m vs 57–81m), producing
 * 30–67 false job_dark alerts/hour. And a continuously-dark job re-paged
 * at full severity every sweep, forever.
 *
 * These tests pin the cure:
 *   1. Thresholds derive from BOTH sources of truth (cadence + the
 *      sampling window) — deadmanThresholdMs in jobRegistry.ts.
 *   2. The healthy sampled pattern is NOT dark (the storm regression).
 *   3. A genuinely-dark job IS dark and its first alert is FULL (the
 *      detector stays sharp — it still pages).
 *   4. Page-once-then-digest: full → digest inside 24h → full again
 *      after; recovery (no persisted episode) re-arms the full alert.
 */

import { describe, expect, it } from "vitest";
import {
  JOB_ROSTER,
  SUCCESS_LOG_SAMPLE_MS,
  deadmanThresholdMs,
} from "../../server/jobs/jobRegistry";
import {
  DEADMAN_REPAGE_WINDOW_MS,
  deadmanAlertMode,
  evaluateDarkness,
} from "../../server/jobs/deadmanPolicy";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function rosterEntry(name: string) {
  const entry = JOB_ROSTER.find((e) => e.name === name);
  if (!entry) throw new Error(`roster entry missing: ${name}`);
  return entry;
}

describe("deadmanThresholdMs — derived from cadence + sampling window", () => {
  it("floors sub-hourly jobs at 2× the sampling window", () => {
    // burn_rate_monitor: registered 5m, was threshold 10m, actual rows ~65m apart.
    expect(deadmanThresholdMs(rosterEntry("burn_rate_monitor"))).toBe(2 * HOUR);
    // retry_failed_actions / recourse_sweep: registered 30m, was 60m, actual 57–81m.
    expect(deadmanThresholdMs(rosterEntry("retry_failed_actions"))).toBe(2 * HOUR);
    expect(deadmanThresholdMs(rosterEntry("recourse_sweep"))).toBe(2 * HOUR);
    // The deadman watching itself: 5m registration, self-rescheduling rows.
    expect(deadmanThresholdMs(rosterEntry("job_deadman_monitor"))).toBe(2 * HOUR);
  });

  it("keeps hourly and slower jobs at exactly 2× cadence", () => {
    expect(deadmanThresholdMs({ intervalMs: HOUR })).toBe(2 * HOUR);
    expect(deadmanThresholdMs({ intervalMs: DAY })).toBe(2 * DAY);
    expect(deadmanThresholdMs({ intervalMs: 7 * DAY })).toBe(14 * DAY);
    expect(deadmanThresholdMs(rosterEntry("proof_chain_audit"))).toBe(2 * DAY);
  });

  it("exceeds the observed staging row gaps for the miscalibrated jobs", () => {
    // Worst observed healthy gaps (investigation 2026-11-20/21): ~65m for
    // burn_rate_monitor, ~81m for retry_failed_actions / recourse_sweep.
    expect(deadmanThresholdMs(rosterEntry("burn_rate_monitor"))).toBeGreaterThan(65 * MIN);
    expect(deadmanThresholdMs(rosterEntry("retry_failed_actions"))).toBeGreaterThan(81 * MIN);
    expect(deadmanThresholdMs(rosterEntry("recourse_sweep"))).toBeGreaterThan(81 * MIN);
  });

  it("whole roster: threshold ≥ worst-case healthy row gap (SAMPLE + interval)", () => {
    // The derivation's soundness claim, asserted for every roster entry:
    // a healthy job's row gap can reach SUCCESS_LOG_SAMPLE_MS + intervalMs
    // (a success just after a sampled row waits out the window). If any
    // entry's threshold fell below that bound, the storm returns for it.
    for (const entry of JOB_ROSTER) {
      expect(
        deadmanThresholdMs(entry),
        `${entry.name}: threshold must cover SAMPLE + interval`,
      ).toBeGreaterThanOrEqual(SUCCESS_LOG_SAMPLE_MS + entry.intervalMs);
    }
  });

  it("the sampling constant is the one-hour window the investigation measured", () => {
    expect(SUCCESS_LOG_SAMPLE_MS).toBe(HOUR);
  });
});

describe("evaluateDarkness — the storm regression and the sharp detector", () => {
  const now = 1_800_000_000_000;

  it("a healthy sampled job is NOT dark at its observed row gap", () => {
    // burn_rate_monitor succeeding every 5m on a single lock-winner emits
    // rows ~65m apart. 65m of silence from it is HEALTH, not death.
    const burn = rosterEntry("burn_rate_monitor");
    expect(
      evaluateDarkness({ entry: burn, lastSeenMs: now - 65 * MIN, nowMs: now, uptimeMs: DAY }).isDark,
    ).toBe(false);
    // retry_failed_actions at its worst observed jitter (81m).
    const retry = rosterEntry("retry_failed_actions");
    expect(
      evaluateDarkness({ entry: retry, lastSeenMs: now - 81 * MIN, nowMs: now, uptimeMs: DAY }).isDark,
    ).toBe(false);
  });

  it("a genuinely-dark job IS dark — the detector stays sharp", () => {
    // A deliberately stopped burn_rate_monitor: no rows for 3h, well past
    // its 2h derived threshold. This is the acceptance-drill shape: kill a
    // job's schedule and the deadman must still catch it.
    const burn = rosterEntry("burn_rate_monitor");
    const evaluation = evaluateDarkness({
      entry: burn,
      lastSeenMs: now - 3 * HOUR,
      nowMs: now,
      uptimeMs: DAY,
    });
    expect(evaluation.isDark).toBe(true);
    expect(evaluation.thresholdMs).toBe(2 * HOUR);
    // …and its first alert of the episode is a FULL one (it pages).
    expect(deadmanAlertMode({ lastFullAlertMs: null, nowMs: now })).toBe("full");
  });

  it("a daily job is dark only past 2 days, not past the sampling window", () => {
    const audit = rosterEntry("proof_chain_audit");
    expect(
      evaluateDarkness({ entry: audit, lastSeenMs: now - 36 * HOUR, nowMs: now, uptimeMs: 7 * DAY }).isDark,
    ).toBe(false);
    expect(
      evaluateDarkness({ entry: audit, lastSeenMs: now - 49 * HOUR, nowMs: now, uptimeMs: 7 * DAY }).isDark,
    ).toBe(true);
  });

  it("never-seen jobs: dark only once the process outlives one cadence", () => {
    const burn = rosterEntry("burn_rate_monitor");
    // Fresh boot — the job simply hasn't ticked yet. Not dark.
    expect(
      evaluateDarkness({ entry: burn, lastSeenMs: null, nowMs: now, uptimeMs: 2 * MIN }).isDark,
    ).toBe(false);
    // A process up for hours that has NEVER seen a 5m job: dark.
    expect(
      evaluateDarkness({ entry: burn, lastSeenMs: null, nowMs: now, uptimeMs: 3 * HOUR }).isDark,
    ).toBe(true);
  });
});

describe("deadmanAlertMode — page once, then digest", () => {
  const now = 1_800_000_000_000;

  it("first detection of an episode is full", () => {
    expect(deadmanAlertMode({ lastFullAlertMs: null, nowMs: now })).toBe("full");
  });

  it("a still-dark job digests inside the repage window", () => {
    expect(deadmanAlertMode({ lastFullAlertMs: now - HOUR, nowMs: now })).toBe("digest");
    expect(deadmanAlertMode({ lastFullAlertMs: now - 23 * HOUR, nowMs: now })).toBe("digest");
  });

  it("a job dark for a full day re-raises at full severity", () => {
    expect(deadmanAlertMode({ lastFullAlertMs: now - DEADMAN_REPAGE_WINDOW_MS, nowMs: now })).toBe("full");
    expect(deadmanAlertMode({ lastFullAlertMs: now - 2 * DAY, nowMs: now })).toBe("full");
  });

  it("the repage window is one day", () => {
    expect(DEADMAN_REPAGE_WINDOW_MS).toBe(DAY);
  });
});

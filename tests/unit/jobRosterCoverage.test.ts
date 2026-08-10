/**
 * jobRosterCoverage.test.ts — keeps JOB_ROSTER honest.
 *
 * The deadman (server/jobs/deadmanCheck.ts) can only page on a job's absence
 * if that job is in JOB_ROSTER. The classic failure mode (the one this whole
 * change fixes) is a hand-maintained list drifting from reality: a new
 * `withJobLock('foo', …)` ships, nobody adds it to the roster, and the deadman
 * is blind to foo going dark. These tests assert exact parity between the
 * `withJobLock` literals in runScheduledJobs.ts and JOB_ROSTER (minus the two
 * jobs registered without a legacy withJobLock literal that live only in the
 * roster), so CI fails the moment they diverge.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { JOB_ROSTER } from "../../server/jobs/jobRegistry";

// Jobs that exist in the roster but are registered via scheduleSelfRescheduling
// in this same change and DO call withJobLock with these exact names — so they
// actually ARE withJobLock literals too. Nothing is roster-only.
const ROSTER_ONLY: string[] = [];

// Files that carry withJobLock literals. runScheduledJobs.ts is the main
// registrar; the W5.1 migrations (2026-07) moved three former bare
// setIntervals into the runtime at their own definition sites.
const SCANNED_FILES = [
  "../../server/jobs/runScheduledJobs.ts",
  // S3 (2026-07): lead_nurturing + campaign_optimizer withJobLock literals
  // moved here as the first decomposition slice out of runScheduledJobs.ts.
  "../../server/jobs/leadCampaignJobs.ts",
  // S3 slice 2 (Wave B, 2026-07-29): workflow_delay_resume owns its own
  // process*/start*Job pair in its module, same as leadCampaignJobs.
  "../../server/jobs/workflowDelayResume.ts",
  // S3 slice 3 (Wave C, 2026-07-29): ach_autopay_cycle owns its own
  // process/start-job pair in its module — runScheduledJobs.ts is under a
  // strictly-DOWN line-count ratchet, so a money job must not grow it.
  "../../server/jobs/achAutopayRun.ts",
  // Structural build B (2026-07-30): acquired_note_aging owns its own
  // process/start pair for the same reason — runScheduledJobs.ts is under a
  // strictly-DOWN line-count ratchet, so a new sweep must not grow it.
  "../../server/jobs/acquiredNoteAging.ts",
  // Audit Wave 1 (2026-08, buy_and_hold beta→core): the note-payment-due and
  // lease-expiry daily detectors were extracted here out of runScheduledJobs.ts
  // (same strictly-DOWN line ratchet), so their withJobLock literals
  // (note_payment_due_scan + lease_expiry_scan) now live in this module.
  "../../server/jobs/expiryDetectorJobs.ts",
  // O4 (2026-08-10): the reliability-canary group owns its withJobLock
  // literals in its own module — synthetic_checks moved VERBATIM out of
  // runScheduledJobs.ts (same strictly-DOWN line ratchet) alongside the new
  // persona_journey_canary.
  "../../server/jobs/reliabilityCanaries.ts",
  "../../server/jobs/atlasPendingConfirmationNudger.ts",
  "../../server/jobs/autonomousTaskProcessor.ts",
  "../../server/services/founderDigest.ts",
  // F3 eternal lines (2026-08): the gate-estate tamper watch owns its own
  // withJobLock literal (gate_tamper_watch) — registered from
  // runScheduledJobs.ts via dynamic import (that file's line-count ratchet
  // only goes down), scheduled inside the module like founderDigest above.
  "../../server/services/autopilot/gateTamperWatch.ts",
];

function extractWithJobLockNames(): Set<string> {
  const names = new Set<string>();
  const re = /withJobLock\(\s*(["'])([^"']+)\1/g;
  for (const rel of SCANNED_FILES) {
    const src = readFileSync(resolve(__dirname, rel), "utf8");
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) names.add(m[2]);
  }
  return names;
}

describe("JOB_ROSTER ↔ withJobLock parity", () => {
  const lockNames = extractWithJobLockNames();
  const rosterNames = new Set(JOB_ROSTER.map((e) => e.name));

  it("every withJobLock job has a roster entry (deadman would be blind otherwise)", () => {
    const missing = [...lockNames].filter((n) => !rosterNames.has(n));
    expect(missing, `withJobLock jobs missing from JOB_ROSTER: ${missing.join(", ")}`).toEqual([]);
  });

  it("every roster entry maps to a real withJobLock job (no phantom rows)", () => {
    const phantom = [...rosterNames].filter(
      (n) => !lockNames.has(n) && !ROSTER_ONLY.includes(n),
    );
    expect(phantom, `roster entries with no withJobLock literal: ${phantom.join(", ")}`).toEqual([]);
  });

  it("has no duplicate roster names", () => {
    expect(rosterNames.size).toBe(JOB_ROSTER.length);
  });
});

describe("JOB_ROSTER entry sanity", () => {
  it("every entry has a positive interval and a boolean critical flag", () => {
    for (const e of JOB_ROSTER) {
      expect(e.intervalMs, e.name).toBeGreaterThan(0);
      expect(typeof e.critical, e.name).toBe("boolean");
    }
  });

  it("disabledWhen predicates read env and return a boolean without throwing", () => {
    const gated = JOB_ROSTER.filter((e) => e.disabledWhen);
    // The three env-kill-switched AI jobs + fly_night_mode (prod+token gated)
    // + the Tier 1E config-dormant set (backup pipeline + SES-gated course
    // completion + Wave C's Stripe-gated borrower ACH autopay cycle).
    expect(gated.map((e) => e.name).sort()).toEqual([
      "ach_autopay_cycle",
      "autonomous_decision_executor",
      "backup_restore_verify",
      "campaign_optimizer",
      "course_completion_check",
      "db_backup",
      "fly_night_mode",
      "lead_nurturing",
    ]);
    for (const e of gated) {
      expect(typeof e.disabledWhen!(), e.name).toBe("boolean");
    }
  });

  it("every disabledWhen-gated entry declares a human-readable disabledReason (Tier 1E contract)", () => {
    for (const e of JOB_ROSTER.filter((x) => x.disabledWhen)) {
      // fly_night_mode predates the contract and is environment-gated, not
      // secret-gated — grandfathered without a reason.
      if (e.name === "fly_night_mode") continue;
      if (["lead_nurturing", "campaign_optimizer", "autonomous_decision_executor"].includes(e.name)) continue;
      expect(e.disabledReason, `${e.name} must declare disabledReason`).toBeTruthy();
    }
  });

  it("env kill-switch jobs are reported disabled when their env var is set", () => {
    const cases: Array<[string, string]> = [
      ["lead_nurturing", "LEAD_NURTURING_AI_DISABLED"],
      ["campaign_optimizer", "CAMPAIGN_OPTIMIZER_AI_DISABLED"],
      ["autonomous_decision_executor", "AUTONOMOUS_DECISION_EXECUTOR_DISABLED"],
    ];
    for (const [job, envVar] of cases) {
      const entry = JOB_ROSTER.find((e) => e.name === job)!;
      const prev = process.env[envVar];
      try {
        process.env[envVar] = "1";
        expect(entry.disabledWhen!(), `${job} should be disabled when ${envVar}=1`).toBe(true);
        delete process.env[envVar];
        expect(entry.disabledWhen!(), `${job} should be enabled when ${envVar} unset`).toBe(false);
      } finally {
        if (prev === undefined) delete process.env[envVar];
        else process.env[envVar] = prev;
      }
    }
  });
});

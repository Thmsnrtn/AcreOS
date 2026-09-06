/**
 * jobRosterCoverage.test.ts — keeps JOB_ROSTER honest.
 *
 * The deadman (server/jobs/deadmanCheck.ts) can only page on a job's absence
 * if that job is in JOB_ROSTER. The classic failure mode is a hand-maintained
 * list drifting from reality: a new job ships, nobody adds it to the roster,
 * and the deadman is blind to it going dark.
 *
 * This file used to guard against that with two hand-maintained lists of its
 * own — the files to scan, and the one spelling to scan for. On 2026-09-05 both
 * turned out to be the drift they were written to catch: fifteen live jobs sat
 * outside them, sequence_processor and the two revenue-recognition workers
 * among them.
 *
 * So the parity is now asserted over a DERIVED population: every .ts file under
 * server/, every registration SHAPE in REGISTRATION_SHAPES, in both directions
 * (no unrostered job, no phantom row), with a per-shape vacuity floor — because
 * one extractor silently ceasing to match reads exactly like that shape not
 * being used anywhere. CI fails the moment a job and its roster row diverge,
 * and a new registration helper must join REGISTRATION_SHAPES.
 */

import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { resolve, join } from "path";
import { REPO_SWEEP_TIMEOUT_MS, stripComments } from "../helpers/stripComments";
import { JOB_ROSTER } from "../../server/jobs/jobRegistry";

// THIS FILE SWEEPS THE WHOLE REPOSITORY. Stripping comments correctly means
// parsing, ~2.7ms a file, and under the coverage run's instrumentation a
// sweep does not fit the suite's 30s default. Killing it does not make the
// suite faster — it makes this gate stop reporting. Declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

// Jobs that exist in the roster but are registered via scheduleSelfRescheduling
// in this same change and DO call withJobLock with these exact names — so they
// actually ARE withJobLock literals too. Nothing is roster-only.
const ROSTER_ONLY: string[] = [];

/**
 * THE POPULATION — every file that carries a `withJobLock("<name>", …)`
 * literal, found by walking the tree.
 *
 * This was a hand-maintained list of eleven paths, each with a comment saying
 * why it was added. That list WAS the parity claim, and nothing checked it: a
 * `withJobLock` literal in a file nobody had added was outside the set this
 * test read, so the job existed, had no roster row, and the deadman was blind
 * to it going dark — the precise failure the header above says this file
 * exists to prevent, achieved by the gate's own population instead of by the
 * roster.
 *
 * Measured 2026-09-05: two such jobs. `revenue_protection`
 * (server/services/revenueProtection.ts — 6-hourly churn scoring and retention
 * email) and `clean_borrower_sessions` (server/routes.ts — hourly expired
 * session sweep). Both had been running unwatched since they were written.
 *
 * Comments are stripped before the scan, and that is load-bearing rather than
 * tidy: `server/jobs/indexAnalyzer.ts` and `jobRegistry.ts` itself both DESCRIBE
 * `withJobLock('index_analyzer', 23h)` in prose while registering nothing, and a
 * raw scan would invent a job from the documentation of one. Fourth law.
 *
 * It uses tests/helpers/stripComments.ts, and the first draft of this file did
 * not — it hand-rolled the two-regex idiom that helper exists to replace, and
 * paid for it inside a minute: a stray `/*` in runScheduledJobs.ts opened a
 * block comment that ran 1,146 lines to the end of the file, taking four real
 * `withJobLock` literals with it. The parity test then reported four PHANTOM
 * roster rows — jobs that exist, in a file the scanner had eaten. Exactly the
 * failure mode the helper's own header describes.
 */

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      out.push(...walk(full));
    } else if (entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * TWO REGISTRATION SHAPES, not one.
 *
 * `withJobLock("<name>", …)` was the only spelling this file knew. The other is
 * `scheduleSelfRescheduling({ name: "<name>", … })`, and on 2026-09-05 THIRTEEN
 * live jobs used it without ever calling withJobLock — sequence_processor, both
 * revenue-recognition workers, the DSAR overdue clock among them. None had a
 * roster row, and "no roster row" read here as "not a job" rather than "a job
 * the deadman cannot see".
 *
 * That is the third law twice in one gate: the population was one directory,
 * AND the unit was one spelling. A seventh registration helper added later must
 * join this list, which is why the shapes are enumerated in one place instead of
 * being implicit in a regex.
 */
const REGISTRATION_SHAPES = [
  { label: "withJobLock", re: /withJobLock\(\s*(["'])([^"']+)\1/g, group: 2 },
  {
    label: "scheduleSelfRescheduling",
    re: /scheduleSelfRescheduling\(\s*\{[\s\S]{0,200}?name:\s*(["'])([^"']+)\1/g,
    group: 2,
  },
] as const;

const LOCK_RE = REGISTRATION_SHAPES[0].re;

const SERVER_DIR = resolve(__dirname, "../../server");
const ALL_SERVER_FILES = walk(SERVER_DIR);
const SCANNED_FILES = ALL_SERVER_FILES.filter((abs) => {
  const src = stripComments(readFileSync(abs, "utf8"));
  return REGISTRATION_SHAPES.some((shape) => {
    const re = new RegExp(shape.re.source, "g");
    return re.test(src);
  });
});

/** Every job name registered by any shape, with the shape that found it. */
function registeredJobs(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const abs of SCANNED_FILES) {
    const src = stripComments(readFileSync(abs, "utf8"));
    for (const shape of REGISTRATION_SHAPES) {
      const re = new RegExp(shape.re.source, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const name = m[shape.group];
        if (!out.has(name)) out.set(name, new Set());
        out.get(name)!.add(shape.label);
      }
    }
  }
  return out;
}

function extractWithJobLockNames(): Set<string> {
  const names = new Set<string>();
  for (const abs of SCANNED_FILES) {
    const src = stripComments(readFileSync(abs, "utf8"));
    const re = new RegExp(LOCK_RE.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) names.add(m[2]);
  }
  return names;
}

describe("JOB_ROSTER ↔ registered-job parity", () => {
  const registered = registeredJobs();
  const lockNames = extractWithJobLockNames();
  const rosterNames = new Set(JOB_ROSTER.map((e) => e.name));

  it("reads a real population, by BOTH shapes (vacuity guard)", () => {
    // Per-member, because one shape silently ceasing to match reads exactly
    // like that shape not being used anywhere.
    expect(ALL_SERVER_FILES.length, "the server walk found nothing").toBeGreaterThan(500);
    expect(SCANNED_FILES.length, "no file registers a job at all").toBeGreaterThanOrEqual(11);
    for (const shape of REGISTRATION_SHAPES) {
      const found = [...registered.entries()].filter(([, shapes]) => shapes.has(shape.label));
      expect(
        found.length,
        `the ${shape.label} extractor matched NOTHING. It matched on 2026-09-05 ` +
          "(120 withJobLock names, 40 scheduleSelfRescheduling names), so this is " +
          "the extractor breaking, not the shape disappearing — and a broken " +
          "extractor makes every job it should have found look like it does not exist.",
      ).toBeGreaterThan(10);
    }
  });

  it("every registered job has a roster entry (deadman would be blind otherwise)", () => {
    const missing = [...registered.keys()].filter((n) => !rosterNames.has(n)).sort();
    expect(
      missing,
      "jobs that run on a schedule but are missing from JOB_ROSTER, so " +
        `deadmanCheck cannot page when they go dark: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("every roster entry maps to a real registration (no phantom rows)", () => {
    const phantom = [...rosterNames].filter(
      (n) => !registered.has(n) && !ROSTER_ONLY.includes(n),
    ).sort();
    expect(phantom, `roster entries nothing registers: ${phantom.join(", ")}`).toEqual([]);
  });

  it("the deadman reads the liveness table each shape actually writes", () => {
    // A roster row for a scheduleSelfRescheduling job is worse than no row at
    // all if the deadman only reads job_health_logs: the job is alive, writes
    // job_runs, and gets paged as permanently dark. The two must move together.
    const deadman = stripComments(
      readFileSync(resolve(__dirname, "../../server/jobs/deadmanCheck.ts"), "utf8"),
    );
    //
    // WORD-BOUNDED, and on `.from(<table>)` rather than the bare identifier.
    // Falsifying this assertion caught it: renaming the import `jobRuns` to
    // `jobRunsX` left `toContain("jobRuns")` satisfied, so the gate certified a
    // deadman that no longer read the table. Same substring trap CLAUDE.md
    // records paying for on a trigger renamed `…_RENAMED`, and the second time
    // it surfaced in this session — which is the argument for falsifying every
    // assertion rather than the interesting ones.
    const readsFrom = (table: string) =>
      new RegExp(`\\.from\\(\\s*${table}(?![A-Za-z0-9_])`).test(deadman);
    expect(
      readsFrom("jobHealthLogs"),
      "deadmanCheck no longer SELECTs from job_health_logs — every withJobLock " +
        "job would read as never-run.",
    ).toBe(true);
    expect(
      readsFrom("jobRuns"),
      "deadmanCheck no longer SELECTs from job_runs, which is the ONLY liveness " +
        "a scheduleSelfRescheduling job emits. Every such roster row would page " +
        "as dark while the job runs fine.",
    ).toBe(true);
  });

  it("has no duplicate roster names", () => {
    expect(rosterNames.size).toBe(JOB_ROSTER.length);
  });

  it("the deleted autonomous task processor has no roster row and no lock literal (founder decision 2026-09-02 #7)", () => {
    expect(rosterNames.has("autonomous_task_processor")).toBe(false);
    expect(lockNames.has("autonomous_task_processor")).toBe(false);
    expect(SCANNED_FILES.some((f) => f.includes("autonomousTaskProcessor"))).toBe(false);
    // …and the walk really did read the tree, rather than returning nothing.
    expect(SCANNED_FILES.length, "the withJobLock file walk found nothing").toBeGreaterThanOrEqual(11);
  });

  it("the review-queue expiry sweep is rostered and locked at its real cadence", () => {
    const entry = JOB_ROSTER.find((e) => e.name === "pending_action_expiry_sweep");
    expect(entry).toBeTruthy();
    expect(lockNames.has("pending_action_expiry_sweep")).toBe(true);
    expect(entry!.intervalMs).toBe(5 * 60 * 1000);
    expect(entry!.cron).toBeUndefined();
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

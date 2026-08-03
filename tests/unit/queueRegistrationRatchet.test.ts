/**
 * Queue-registration ratchet (Phase 4, audit critique #15 — the
 * "built-but-unwired" defect class).
 *
 * This repo's single most common defect is a background job that is fully
 * written but never registered, so it silently never runs. The canonical
 * example is `server/jobs/countyAssessorIngest.ts`: it instantiates a BullMQ
 * `new Queue(...)` + `new Worker(...)`, exports `registerCountyAssessorIngestJob`
 * / `countyAssessorIngestJob` / `createCountyAssessorIngestQueue`, and yet the
 * corpus feeder was NEVER wired into the scheduler — the scheduler
 * (`runScheduledJobs.ts`) imports nothing from it, and it appears in no roster.
 * The only external reference is a route pulling the unrelated
 * `fetchAttomComparables` HELPER, which does not make the JOB run.
 *
 * This ratchet mechanizes "every job must be wired into the scheduler". It
 * treats a file in `server/jobs/` as a BACKGROUND JOB MODULE when it either
 *   (a) instantiates a BullMQ queue/worker (`new Queue(` / `new Worker(`), or
 *   (b) exports a `register<Name>Job` or `<name>IngestJob` symbol.
 * Every such module MUST be imported by the scheduler wiring — the canonical
 * scheduler entrypoints in SCHEDULER_WIRING_FILES. A module that no scheduler
 * file imports is an unwired job and trips this test.
 *
 * WHY scheduler-file imports specifically (not "any external reference"):
 * countyAssessorIngest IS referenced externally (a route imports a helper), so
 * a naive "any importer counts" rule would miss it. The defect is precisely
 * that nothing in the SCHEDULER starts the job, so wiring is measured against
 * the scheduler surface only.
 *
 * KNOWN-UNWIRED BASELINE: `countyAssessorIngest` is the documented existing
 * offender (the comps-corpus feeder, dormant pending its revenue trigger). It
 * is allow-listed below so the ratchet is GREEN now, but any NEW job module
 * that is not wired into the scheduler will fail. When countyAssessorIngest is
 * finally wired, its allowlist entry must be removed — the ratchet fails if an
 * allow-listed module is actually wired (self-cleaning; no stale baselines).
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const JOBS_DIR = path.resolve(__dirname, "../../server/jobs");

/**
 * Canonical scheduler wiring surface. A background job is considered "wired"
 * iff one of these files imports its module. If a genuinely-new scheduler
 * entrypoint is ever introduced, add it here (with a comment) — that is a
 * deliberate, reviewable change, not a silent one.
 *
 * `runScheduledJobs.ts` is the 259KB body of `start*Job()` wrappers that
 * dynamic-`import()` each job's run function; `scheduler.ts` and
 * `jobRegistry.ts` are the roster/cron surfaces.
 */
const SCHEDULER_WIRING_FILES = [
  "runScheduledJobs.ts",
  "scheduler.ts",
  "jobRegistry.ts",
];

/**
 * Known-unwired job modules, baselined so the ratchet is green today while
 * still blocking NEW unwired jobs. Each entry MUST name why it is dormant.
 * Measured 2026-08-03 (see baselineNote in the wave report): the only job
 * module in server/jobs/ that no scheduler file imports.
 */
const KNOWN_UNWIRED_ALLOWLIST: Record<string, string> = {
  // The comps-corpus / tax-delinquent feeder. Built (BullMQ queue+worker,
  // registerCountyAssessorIngestJob, countyAssessorIngestJob) but never
  // registered — no scheduler file imports it and it is in no roster. It sits
  // behind the "no residential-comps data plane before its revenue trigger"
  // hard-stop, so it is intentionally dormant, not merely forgotten. When it is
  // wired into the scheduler, DELETE this line (the ratchet enforces that).
  countyAssessorIngest:
    "comps-corpus feeder; dormant pending its revenue trigger — no scheduler import yet",
};

/** A file in server/jobs is a background-job module if it defines a BullMQ
 *  queue/worker or exports a register*Job / *IngestJob entry point. */
const QUEUE_WORKER_RE = /new\s+(?:Queue|Worker)\s*\(/;
const REGISTER_JOB_RE =
  /export\s+(?:async\s+)?function\s+register[A-Za-z0-9]*Job\b/;
const INGEST_JOB_RE = /export\s+(?:async\s+)?function\s+[A-Za-z0-9]*IngestJob\b/;

function isJobModule(source: string): boolean {
  return (
    QUEUE_WORKER_RE.test(source) ||
    REGISTER_JOB_RE.test(source) ||
    INGEST_JOB_RE.test(source)
  );
}

function jobModuleBasenames(): string[] {
  return fs
    .readdirSync(JOBS_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .filter((f) => !SCHEDULER_WIRING_FILES.includes(f))
    .filter((f) => isJobModule(fs.readFileSync(path.join(JOBS_DIR, f), "utf8")))
    .map((f) => f.replace(/\.ts$/, ""))
    .sort();
}

const schedulerSources: string = SCHEDULER_WIRING_FILES.map((f) => {
  const p = path.join(JOBS_DIR, f);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}).join("\n");

/** True iff a scheduler wiring file imports the given module (any quoted
 *  import path whose final segment is the module basename). */
function isWiredIntoScheduler(basename: string): boolean {
  const esc = basename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Matches 'basename', './basename', './jobs/basename', '../jobs/basename', etc.
  const importRe = new RegExp(`['"](?:[^'"]*/)?${esc}['"]`);
  return importRe.test(schedulerSources);
}

describe("queue-registration ratchet (every job must be wired into the scheduler)", () => {
  const modules = jobModuleBasenames();

  it("finds a non-trivial set of background-job modules (guards a broken matcher)", () => {
    // If the matcher silently stopped matching, every downstream assertion
    // would pass vacuously. Pin a floor: the repo has ~9 queue/register-job
    // modules today (autonomousDealMachine, autonomousHealthMonitor,
    // countyAssessorIngest, courseCompletionCheck, dbBackup,
    // featureEngineeringJob, founderWeeklyDigest, indexAnalyzer,
    // landCreditScoreRecalculation). Measured 2026-08-03.
    expect(
      modules.length,
      `expected to detect several BullMQ/register*Job job modules in ` +
        `server/jobs; found ${modules.length}. The scan matcher is likely ` +
        `broken — do not weaken this floor to make it pass.`,
    ).toBeGreaterThanOrEqual(8);
  });

  it("the scheduler-import matcher recognises the known-wired jobs (guards a broken matcher)", () => {
    // Sanity anchors: these are wired via runScheduledJobs.ts today. If the
    // import matcher regressed to always-false, this fails loudly instead of
    // green-washing the ratchet into flagging everything.
    for (const wired of [
      "courseCompletionCheck",
      "landCreditScoreRecalculation",
      "featureEngineeringJob",
      "dbBackup",
    ]) {
      expect(
        isWiredIntoScheduler(wired),
        `${wired} is wired via runScheduledJobs.ts but the matcher did not ` +
          `find its import — the wiring detector is broken.`,
      ).toBe(true);
    }
  });

  it("no background-job module is unwired (except the documented allowlist)", () => {
    const unwired = modules.filter(
      (m) => !isWiredIntoScheduler(m) && !(m in KNOWN_UNWIRED_ALLOWLIST),
    );
    expect(
      unwired,
      `these server/jobs modules define a BullMQ queue/worker or a ` +
        `register*Job/*IngestJob export but NO scheduler file ` +
        `(${SCHEDULER_WIRING_FILES.join(", ")}) imports them — they are built ` +
        `but never registered, so they silently never run. Wire each into the ` +
        `scheduler (add a start*Job() in runScheduledJobs.ts and import its run ` +
        `function), or, if it is deliberately dormant, add it to ` +
        `KNOWN_UNWIRED_ALLOWLIST with a reason.\nUnwired:\n${unwired.join("\n")}`,
    ).toEqual([]);
  });

  it("the allowlist is self-cleaning: no allow-listed module is actually wired", () => {
    // When a dormant job is finally wired, its allowlist entry must be removed
    // in the same change so the baseline never goes stale.
    const staleWired = Object.keys(KNOWN_UNWIRED_ALLOWLIST).filter((m) =>
      isWiredIntoScheduler(m),
    );
    expect(
      staleWired,
      `these modules are in KNOWN_UNWIRED_ALLOWLIST but a scheduler file now ` +
        `imports them — they ARE wired. Remove their allowlist entries so the ` +
        `ratchet keeps protecting the newly-wired job.\nStale:\n${staleWired.join("\n")}`,
    ).toEqual([]);
  });

  it("every allow-listed module still exists as a job module (guards renames)", () => {
    // If an allow-listed file is renamed/removed, drop its stale entry rather
    // than leaving a dangling exception.
    const missing = Object.keys(KNOWN_UNWIRED_ALLOWLIST).filter(
      (m) => !modules.includes(m),
    );
    expect(
      missing,
      `KNOWN_UNWIRED_ALLOWLIST names modules that are no longer job modules in ` +
        `server/jobs (renamed/removed/no longer a queue): ${missing.join(", ")}. ` +
        `Remove the stale entries.`,
    ).toEqual([]);
  });
});

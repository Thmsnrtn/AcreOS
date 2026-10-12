/**
 * The by-id cross-tenant isolation sweep (tests/simulation/campaign/
 * idor-sweep.ts) runs in CI, and its verdict is the job's verdict.
 *
 * Until 2026-10-12 the sweep ran only by hand against a local build, so every
 * by-id route added after a manual run was outside any isolation check until
 * the next campaign. It now runs in the workflow job that already builds and
 * boots the app under the test-auth bypass. What this file holds, against the
 * parsed workflows rather than their text:
 *
 *   1. WIRING — exactly one step in all of .github/workflows runs the sweep;
 *      its workflow runs on pushes to main and on pull requests; its job boots
 *      under E2E_TEST_AUTH; it runs after the build; the server it starts is
 *      the one the sweep talks to.
 *   2. THE VERDICT REACHES THE JOB — neither the step nor its job may continue
 *      on error, the script runs under `set -euo pipefail`, and the sweep is
 *      its LAST command, unpiped and unguarded, so exit 1 (breach), 2 (under
 *      floor / could not run) and 3 (log carried data) fail the job.
 *   3. THE LOG STAYS PUBLIC-SAFE — the ledger goes to the runner temp dir and
 *      no upload step publishes it; the stream guard withholds any written
 *      chunk that carries the run's marker (exercised for real below).
 *   4. THE POPULATION — the route extractor still finds at least the floor,
 *      and the floor is at least the program's 457.
 */
import { describe, expect, it, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Writable } from "node:stream";
import yaml from "js-yaml";
import { POPULATION_FLOOR, enumerateRoutes, routeSourceFiles } from "../simulation/campaign/byIdRoutes";
import { installPublicLogGuard, WITHHELD_LINE } from "../simulation/campaign/publicLog";
// The population check strips every route source file; under the coverage run
// that does not fit the 30s default, so the budget is declared.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = process.cwd();
const DIR = path.join(ROOT, ".github/workflows");
const SWEEP_SCRIPT = "tests/simulation/campaign/idor-sweep.ts";
const SWEEP_COMMAND = `npx tsx ${SWEEP_SCRIPT}`;
/** The program's floor for the by-id population (2026-10-12 brief). */
const PROGRAM_FLOOR = 457;

type Step = {
  id?: string;
  name?: string;
  if?: string;
  run?: string;
  uses?: string;
  shell?: string;
  env?: Record<string, unknown>;
  with?: Record<string, unknown>;
  "continue-on-error"?: unknown;
};
type Job = { env?: Record<string, unknown>; steps?: Step[]; "continue-on-error"?: unknown };
type Workflow = { on?: any; true?: any; jobs?: Record<string, Job> };

const mayContinue = (v: unknown) => v !== undefined && v !== false && v !== "false";

const files = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f));
const workflows = files.map((file) => ({
  file,
  wf: yaml.load(readFileSync(path.join(DIR, file), "utf8")) as Workflow,
}));

/** Every step, in every job, of every workflow, that names the sweep script. */
const sweepSteps = workflows.flatMap(({ file, wf }) =>
  Object.entries(wf.jobs ?? {}).flatMap(([jobName, job]) =>
    (job.steps ?? []).flatMap((step, index) =>
      String(step.run ?? "").includes(SWEEP_SCRIPT) ? [{ file, wf, jobName, job, step, index }] : [],
    ),
  ),
);

/** Script lines with bash comments and blank lines removed. */
const scriptLines = (run: string) =>
  run
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

describe("the isolation sweep runs in CI and decides the job", () => {
  it("vacuity: the workflows parse", () => {
    expect(files.length).toBeGreaterThan(10);
    for (const { file, wf } of workflows) expect(wf, file).toBeTruthy();
  });

  it("exactly one step runs the sweep", () => {
    expect(sweepSteps.map((s) => `${s.file} :: ${s.jobName} :: ${s.step.name}`)).toHaveLength(1);
  });

  const hit = sweepSteps[0];

  it("its workflow runs on pushes to main and on pull requests", () => {
    // js-yaml (YAML 1.1) may read the bare key `on` as boolean true.
    const on = hit.wf.on ?? hit.wf.true;
    expect(on, "workflow has no trigger block").toBeTruthy();
    expect(on.push?.branches ?? [], "push trigger must include main").toContain("main");
    expect(on.pull_request, "pull_request trigger").toBeTruthy();
  });

  it("its job boots under the test-auth bypass, after the build, against the server it starts", () => {
    const env = { ...(hit.job.env ?? {}), ...(hit.step.env ?? {}) };
    expect(String(env.E2E_TEST_AUTH)).toBe("1");
    expect(String(env.DATABASE_URL ?? "")).toMatch(/^postgres(ql)?:\/\//);
    expect(String(env.SIM_BASE_URL)).toBe(`http://localhost:${env.PORT}`);

    const steps = hit.job.steps ?? [];
    const build = steps.findIndex((s) => s.id === "build" && /^npm run build$/.test(String(s.run ?? "").trim()));
    expect(build, "a step with id `build` running `npm run build`").toBeGreaterThanOrEqual(0);
    expect(hit.index).toBeGreaterThan(build);

    const lines = scriptLines(String(hit.step.run));
    const server = lines.findIndex((l) => /\bnode dist\/index\.cjs\b.*&$/.test(l));
    const sweep = lines.indexOf(SWEEP_COMMAND);
    expect(server, "the step starts the built server in the background").toBeGreaterThanOrEqual(0);
    expect(sweep).toBeGreaterThan(server);
    expect(lines.some((l) => l.includes("tests/personas/seedDb.ts")), "persona orgs are seeded").toBe(true);
  });

  it("runs whenever the build succeeded — never skipped on a green build", () => {
    // Absent `if` means success(); the only other accepted form keeps the
    // sweep running when an earlier E2E step failed.
    const cond = hit.step.if;
    if (cond !== undefined) {
      expect(String(cond).replace(/\s+/g, " ").trim()).toBe("${{ !cancelled() && steps.build.outcome == 'success' }}");
    }
  });

  it("a failing sweep fails the job", () => {
    expect(mayContinue(hit.step["continue-on-error"]), "step continue-on-error").toBe(false);
    expect(mayContinue(hit.job["continue-on-error"]), "job continue-on-error").toBe(false);
    expect(hit.step.shell === undefined || /^bash\b/.test(String(hit.step.shell))).toBe(true);

    const lines = scriptLines(String(hit.step.run));
    expect(lines[0]).toBe("set -euo pipefail");
    // The sweep is the step's last command, verbatim: no pipe, no `|| true`,
    // no `&`, no `;` after it — its exit status is the step's.
    expect(lines[lines.length - 1]).toBe(SWEEP_COMMAND);
    expect(lines.filter((l) => l.includes(SWEEP_SCRIPT))).toEqual([SWEEP_COMMAND]);
  });

  it("its ledger stays off the public record", () => {
    const out = String(hit.step.env?.CAMPAIGN_OUT ?? "");
    expect(out.startsWith("${{ runner.temp }}/"), `CAMPAIGN_OUT=${out}`).toBe(true);
    for (const { file, wf } of workflows) {
      for (const job of Object.values(wf.jobs ?? {})) {
        for (const s of job.steps ?? []) {
          if (!String(s.uses ?? "").startsWith("actions/upload-artifact")) continue;
          const p = String(s.with?.path ?? "");
          expect(p, `${file}: ${s.name}`).not.toContain("runner.temp");
          expect(p, `${file}: ${s.name}`).not.toContain("tests/simulation/reports");
        }
      }
    }
  });
});

describe("the sweep's population", () => {
  const { routes } = enumerateRoutes();

  it("the floor is at least the program floor, and the extractor reaches it", () => {
    expect(POPULATION_FLOOR).toBeGreaterThanOrEqual(PROGRAM_FLOOR);
    expect(routes.length).toBeGreaterThanOrEqual(POPULATION_FLOOR);
  });

  it("reads the route files, including core CRUD registered through an aliased receiver", () => {
    expect(routeSourceFiles().length).toBeGreaterThan(50);
    const keys = new Set(routes.map((r) => `${r.verb} ${r.path}`));
    for (const k of ["GET /api/leads/:id", "PUT /api/leads/:id", "DELETE /api/leads/:id", "GET /api/deals/:id", "PUT /api/deals/:id"]) {
      expect(keys.has(k), k).toBe(true);
    }
    for (const verb of ["GET", "PUT", "PATCH", "DELETE"]) {
      expect(routes.filter((r) => r.verb === verb).length, verb).toBeGreaterThan(10);
    }
  });
});

describe("the public-log guard", () => {
  function sink() {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(String(chunk));
        cb();
      },
    }) as unknown as NodeJS.WriteStream;
    return { stream, chunks };
  }

  it("withholds a chunk carrying a run marker and counts it; passes the rest", () => {
    const { stream, chunks } = sink();
    const guard = installPublicLogGuard(() => ["idcMARKER1"], [stream]);
    try {
      stream.write("✓ GET    /api/leads/:id  ctrl=200 atk=404 → isolated\n");
      stream.write(`body={"notes":"idcMARKER1"}\n`);
      stream.write(Buffer.from("raw idcMARKER1 bytes\n"));
    } finally {
      guard.uninstall();
    }
    expect(chunks).toEqual(["✓ GET    /api/leads/:id  ctrl=200 atk=404 → isolated\n", WITHHELD_LINE, WITHHELD_LINE]);
    expect(guard.leaks()).toBe(2);
    expect(chunks.join("")).not.toContain("idcMARKER1");
  });

  it("uninstall restores the stream", () => {
    const { stream, chunks } = sink();
    const guard = installPublicLogGuard(() => ["idcMARKER2"], [stream]);
    guard.uninstall();
    stream.write("idcMARKER2\n");
    expect(chunks).toEqual(["idcMARKER2\n"]);
    expect(guard.leaks()).toBe(0);
  });
});

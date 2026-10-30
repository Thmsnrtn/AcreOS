/**
 * `janitor registers exactly once across placements` (scheduler double-boot
 * fix, 2026-10).
 *
 * Chosen option for item 4: the janitor moved into scheduledJobsBoot.ts, started by runScheduledJobs (not
 * placement-gated in routes.ts). runScheduledJobs runs in exactly one process
 * group by the placement rule, so there is one registration across the app and
 * worker combined. The module-scope registration in routes.ts fired in every
 * process that imports routes (app AND worker), which is how it doubled.
 *
 * Population: every .ts file under server/ (comments stripped), looking for a
 * `scheduleSelfRescheduling({ name: "<janitor>" …` registration (the roster
 * row in jobRegistry.ts is a name, not a registration). A registration reintroduced in any
 * file — routes.ts or a new one — makes the count 2 and fails.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { REPO_SWEEP_TIMEOUT_MS, stripComments } from "../helpers/stripComments";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const SERVER = path.resolve(__dirname, "../../server");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

const files = walk(SERVER).map((f) => ({ f, src: stripComments(readFileSync(f, "utf8")) }));

function registrationsOf(job: string): string[] {
  // The roster row in jobRegistry.ts is a name, not a registration.
  const re = new RegExp(`scheduleSelfRescheduling\\(\\{\\s*name:\\s*["'\`]${job}["'\`]`);
  return files.filter(({ src }) => re.test(src)).map(({ f }) => path.relative(SERVER, f));
}

describe("janitor registers exactly once across placements", () => {
  it("the population is real (vacuity floor)", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  for (const job of ["clean_expired_job_locks", "clean_borrower_sessions"]) {
    it(`${job} is registered in exactly one file: scheduledJobsBoot.ts`, () => {
      expect(registrationsOf(job)).toEqual([path.join("jobs", "scheduledJobsBoot.ts")]);
    });
  }

  it("routes.ts has no module-scope scheduler registration at all", () => {
    const routes = files.find(({ f }) => f.endsWith(`${path.sep}routes.ts`))!.src;
    expect(routes).not.toMatch(/scheduleSelfRescheduling\s*\(/);
  });
});

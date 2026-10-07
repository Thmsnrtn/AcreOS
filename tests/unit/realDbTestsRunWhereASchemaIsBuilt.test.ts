/**
 * The real-database tests (tests/helpers/realDb.ts) must RUN in every CI job
 * that builds a schema from this repo, and must not be required in a job that
 * builds none.
 *
 * They skip when ACREOS_REAL_DATABASE_URL is unset. That is right for the CI
 * workflow and a local run, and wrong for a job that built a database: there a
 * missing variable would turn every such test into a silent skip. So each job
 * that runs `db:build-from-repo` must set the URL to the database it built and
 * ACREOS_REQUIRE_REAL_DB, and a job that builds no database must not set
 * REQUIRE (its test step would fail on a database it never had).
 *
 * Population: every workflow file and every job in it, parsed as YAML (a
 * parse never reads a comment). Floors pin that the jobs are found.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const WF_DIR = resolve(__dirname, "../../.github/workflows");

interface Job {
  file: string;
  name: string;
  env: Record<string, unknown>;
  buildsSchema: boolean;
  runsVitest: boolean;
}

function jobs(): Job[] {
  const out: Job[] = [];
  for (const f of readdirSync(WF_DIR).filter((n) => /\.ya?ml$/.test(n))) {
    const doc = yaml.load(readFileSync(resolve(WF_DIR, f), "utf8")) as { jobs?: Record<string, any> } | null;
    for (const [name, job] of Object.entries(doc?.jobs ?? {})) {
      const runs: string[] = (job.steps ?? []).map((s: { run?: unknown }) => String(s.run ?? ""));
      out.push({
        file: f,
        name,
        env: (job.env ?? {}) as Record<string, unknown>,
        buildsSchema: runs.some((r) => r.includes("db:build-from-repo")),
        runsVitest: runs.some((r) => /\bvitest\b|npm (run )?test\b|test:coverage/.test(r)),
      });
    }
  }
  return out;
}

describe("real-database tests run wherever CI builds a database", () => {
  const all = jobs();
  const building = all.filter((j) => j.buildsSchema && j.runsVitest);

  it("finds the workflows and the jobs that build a schema (vacuity floors)", () => {
    expect(all.length).toBeGreaterThanOrEqual(20);
    expect(building.map((j) => `${j.file}:${j.name}`).sort()).toEqual(
      expect.arrayContaining(["deploy.yml:test", "staging.yml:test", "test.yml:test"]),
    );
  });

  it("every job that builds a schema and runs vitest requires the real database, pointed at that schema", () => {
    for (const j of building) {
      expect(j.env.ACREOS_REQUIRE_REAL_DB, `${j.file}:${j.name}`).toBe("1");
      expect(j.env.ACREOS_REAL_DATABASE_URL, `${j.file}:${j.name}`).toBe(j.env.DATABASE_URL);
    }
  });

  it("no job that builds no database requires one", () => {
    for (const j of all.filter((x) => !x.buildsSchema)) {
      expect(j.env.ACREOS_REQUIRE_REAL_DB, `${j.file}:${j.name}`).toBeUndefined();
    }
  });
});

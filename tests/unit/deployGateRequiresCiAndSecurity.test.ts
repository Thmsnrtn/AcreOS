/**
 * Roadmap W10.1 (public-readiness plan item 0.3) — production ships only a SHA
 * that the branch gates passed on.
 *
 * Until 2026-10-01 the deploy job needed only `test`. ESLint, the truth-engine
 * audits, the sitemap check, the coverage ratchet and the bundle budget ran in
 * ci.yml, which nothing in deploy.yml waited on. GitHub cannot `needs:` a job
 * in another workflow, so deploy.yml CALLS ci.yml and the deploy job needs it.
 *
 * security.yml joins in W10.1b: it has been red on main since 2026-09-13, and
 * gating on it now would stop every deploy with no hotfix path. PENDING_GATES
 * records that, and the test refuses to let the pending entry rot: the moment
 * deploy.yml calls security.yml, it must be a REQUIRED gate.
 *
 * Parsed, not pattern-matched: a regex over the file reads comments, and this
 * file's history comments name `needs: test`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const WORKFLOWS = path.resolve(process.cwd(), ".github/workflows");
type Perms = Record<string, string> | string | undefined;
type Job = { needs?: string | string[]; uses?: string; if?: string; permissions?: Perms; "runs-on"?: string };
type Workflow = { on?: Record<string, unknown>; permissions?: Perms; jobs?: Record<string, Job> };

const load = (file: string) => yaml.load(readFileSync(path.join(WORKFLOWS, file), "utf8")) as Workflow;
const needsOf = (job: Job | undefined) => (job?.needs == null ? [] : Array.isArray(job.needs) ? job.needs : [job.needs]);

const deploy = load("deploy.yml");
const jobs = deploy.jobs ?? {};

/** The gates the deploy must wait on, and the workflow each one calls (null = in-file job). */
const REQUIRED_GATES: Record<string, string | null> = {
  test: null,
  ci: "./.github/workflows/ci.yml",
};
/** Gates that will be required once green — W10.1b. */
const PENDING_GATES: Record<string, string> = {
  security: "./.github/workflows/security.yml",
};

const RANK: Record<string, number> = { none: 0, read: 1, write: 2 };

describe("the deploy waits on its gates", () => {
  it("vacuity: deploy.yml parses to a job graph with a deploy job", () => {
    expect(Object.keys(jobs).length).toBeGreaterThan(2);
    expect(jobs.deploy).toBeDefined();
  });

  it("the deploy job needs every required gate", () => {
    expect(needsOf(jobs.deploy)).toEqual(expect.arrayContaining(Object.keys(REQUIRED_GATES)));
  });

  it("the deploy job cannot run past a failed gate", () => {
    // `if: always()` / `!cancelled()` / `failure()` on the deploy job would run
    // it whatever its needs concluded.
    expect(String(jobs.deploy.if ?? "")).not.toMatch(/always\(\)|cancelled\(\)|failure\(\)/);
  });

  it("each called gate runs the real workflow, and that workflow can be called", () => {
    for (const [name, uses] of Object.entries(REQUIRED_GATES)) {
      expect(jobs[name], `deploy.yml has no '${name}' job`).toBeDefined();
      if (uses === null) continue;
      expect(jobs[name].uses).toBe(uses);
      expect(Object.keys(load(path.basename(uses)).on ?? {}), `${uses} cannot be called`).toContain("workflow_call");
    }
  });

  it("a pending gate that is called is required — the pending list cannot rot", () => {
    for (const [name, uses] of Object.entries(PENDING_GATES)) {
      const calling = Object.entries(jobs).find(([, j]) => j.uses === uses);
      if (calling) expect(needsOf(jobs.deploy), `${uses} is called but the deploy does not need it`).toContain(calling[0]);
      expect(Object.keys(load(path.basename(uses)).on ?? {}), `${name}: keep ${uses} callable for W10.1b`).toContain("workflow_call");
    }
  });

  it("every called workflow's jobs ask for no more than the caller grants (or GitHub refuses the whole run)", () => {
    for (const [name, job] of Object.entries(jobs)) {
      if (!job.uses?.startsWith("./.github/workflows/")) continue;
      const granted = job.permissions;
      const called = load(path.basename(job.uses));
      for (const [calledJob, cj] of Object.entries(called.jobs ?? {})) {
        const asked = cj.permissions ?? called.permissions;
        if (asked == null) continue; // asks nothing: inherits the caller's token
        // Asking for scopes the caller never granted explicitly depends on the
        // repo's default token, which this repo does not control in code.
        expect(granted, `${name} calls ${job.uses}, whose '${calledJob}' asks for permissions — grant them explicitly`).toBeDefined();
        if (granted == null || typeof asked === "string" || typeof granted === "string") continue;
        for (const [scope, level] of Object.entries(asked)) {
          const have = granted[scope] ?? "none";
          expect(RANK[have] ?? 0, `${name} → ${calledJob} asks ${scope}: ${level}, caller grants ${have}`).toBeGreaterThanOrEqual(RANK[level] ?? 0);
        }
      }
    }
  });

  it("a refused gate still pages the founder once", () => {
    const notify = jobs["notify-gate-failure"];
    expect(notify).toBeDefined();
    expect(String(notify.if)).toMatch(/failure\(\)/);
    expect(needsOf(notify)).toEqual(expect.arrayContaining(Object.keys(REQUIRED_GATES)));
  });
});

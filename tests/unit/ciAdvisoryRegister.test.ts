/**
 * Roadmap W10.1 — no workflow step may fail silently.
 *
 * `continue-on-error: true` turns a red step green for its job. That is right
 * in two cases (see docs/audits/ci-advisory-register.md): the verdict is
 * re-raised by a later step once artifacts are uploaded, or the step is
 * bookkeeping on an already-decided path. In every other case it is a gate
 * that cannot fail. The population is every workflow file AND every
 * composite action under .github/actions/, parsed — a new `continue-on-error`
 * without a register row is what fails here, and a "re-emitted" row is checked
 * against the job: the re-raising step must exist. Any value but false counts:
 * `continue-on-error: ${{ ... }}` is an expression that can be true, so it is
 * in the population too.
 */
import { describe, expect, it, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
// Walks .github/; a killed gate reports nothing, so the budget is declared.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = process.cwd();
const DIR = path.join(ROOT, ".github/workflows");
type Step = { id?: string; name?: string; if?: string; run?: string; "continue-on-error"?: unknown };
type Job = { steps?: Step[]; "continue-on-error"?: unknown };

/** Anything but absent / false can make a step's failure green. */
const mayContinue = (v: unknown) => v !== undefined && v !== false && v !== "false";

const found: Array<{ file: string; job: string; step: string; id?: string; steps: Step[]; index: number }> = [];
const files = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f));
for (const file of files) {
  const wf = yaml.load(readFileSync(path.join(DIR, file), "utf8")) as { jobs?: Record<string, Job> };
  for (const [job, j] of Object.entries(wf.jobs ?? {})) {
    if (mayContinue(j["continue-on-error"])) found.push({ file, job, step: "(job-level)", steps: [], index: -1 });
    (j.steps ?? []).forEach((s, index) => {
      if (mayContinue(s["continue-on-error"])) {
        found.push({ file, job, step: String(s.name ?? s.id ?? `#${index}`), id: s.id, steps: j.steps ?? [], index });
      }
    });
  }
}
// Composite actions: their steps run inside the calling job.
const ACTIONS = path.join(ROOT, ".github/actions");
const actionFiles = existsSync(ACTIONS)
  ? readdirSync(ACTIONS).flatMap((d) => ["action.yml", "action.yaml"].map((f) => path.join(d, f))).filter((f) => existsSync(path.join(ACTIONS, f)))
  : [];
for (const rel of actionFiles) {
  const action = yaml.load(readFileSync(path.join(ACTIONS, rel), "utf8")) as { runs?: { steps?: Step[] } };
  const steps = action.runs?.steps ?? [];
  steps.forEach((s, index) => {
    if (mayContinue(s["continue-on-error"])) {
      found.push({ file: `actions/${rel}`, job: "(composite)", step: String(s.name ?? s.id ?? `#${index}`), id: s.id, steps, index });
    }
  });
}

const rows = readFileSync(path.join(ROOT, "docs/audits/ci-advisory-register.md"), "utf8")
  .split("\n")
  .filter((l) => /^\| [\w./-]+\.ya?ml \|/.test(l))
  .map((l) => {
    const [file, job, step, klass, reason] = l.split("|").slice(1, 6).map((c) => c.trim());
    return { file, job, step, klass, reason };
  });
const key = (x: { file: string; job: string; step: string }) => `${x.file} :: ${x.job} :: ${x.step}`;

describe("every continue-on-error is registered and honest", () => {
  it("vacuity: the workflows parse and the scan finds steps", () => {
    expect(files.length).toBeGreaterThan(10);
    expect(actionFiles.length, "the composite-action population went empty").toBeGreaterThan(0);
    expect(found.length).toBeGreaterThan(0);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("the register and the workflows name the same steps", () => {
    expect(found.map(key).sort()).toEqual(rows.map(key).sort());
  });

  it("every row has a class and a reason", () => {
    for (const r of rows) {
      expect(["re-emitted", "advisory"], key(r)).toContain(r.klass);
      expect(r.reason.length, key(r)).toBeGreaterThan(20);
    }
  });

  it("a re-emitted step's failure is re-raised later in the same job", () => {
    for (const r of rows.filter((x) => x.klass === "re-emitted")) {
      const f = found.find((x) => key(x) === key(r))!;
      expect(f.id, `${key(r)} needs an id for a later step to read its outcome`).toBeTruthy();
      const reraise = f.steps.slice(f.index + 1).find(
        (s) => String(s.if ?? "").includes(`steps.${f.id}.outcome == 'failure'`) && /\bexit 1\b/.test(String(s.run ?? "")),
      );
      expect(reraise, `${key(r)} is marked re-emitted but no later step fails the job on it`).toBeDefined();
    }
  });
});

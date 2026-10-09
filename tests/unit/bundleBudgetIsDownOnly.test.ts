/**
 * Roadmap W10.1 — the bundle-size gate blocks in CI, and its ceilings only go
 * down.
 *
 * The gate's budgets (600 KB per chunk, 3 MB total) were never met, so it was
 * never wired: a gate that would stop every deploy cannot be turned on, and an
 * unwired gate guards nothing. The measured over-budget sizes became ceilings
 * in scripts/bundle-budget.json. These fixtures run the REAL script against
 * fake build trees and prove the ceiling semantics; the last case proves CI
 * runs it at all.
 */
import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import yaml from "js-yaml";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

// This gate runs a script that walks the source tree, in a child process;
// its cost scales with the repo, and under load it does not fit the
// suite's 30s default. A killed gate reports nothing about what it guards,
// so the budget is declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = process.cwd();
const KB = 1024;

function run(budget: object, chunks: Record<string, number>): { status: number | null; out: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "bundle-budget-"));
  mkdirSync(path.join(dir, "scripts"));
  copyFileSync(path.join(ROOT, "scripts/check-bundle-size.js"), path.join(dir, "scripts/check-bundle-size.js"));
  writeFileSync(path.join(dir, "scripts/bundle-budget.json"), JSON.stringify(budget));
  const assets = path.join(dir, "dist/public/assets");
  mkdirSync(assets, { recursive: true });
  for (const [file, kb] of Object.entries(chunks)) writeFileSync(path.join(assets, file), Buffer.alloc(Math.round(kb * KB), 97));
  const r = spawnSync(process.execPath, [path.join(dir, "scripts/check-bundle-size.js")], {
    env: { ...process.env, CI: "true" },
    encoding: "utf8",
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

const BUDGET = {
  targets: { maxChunkKB: 600, maxTotalKB: 3000 },
  ceilings: { totalKB: 3500, chunks: { "vendor-map": 2650 } },
  slackBeforeLoweringPct: 5,
};
const OK = { "vendor-map-AbCd1234.js": 2600, "index-EfGh5678.js": 500, "page-IjKl9012.js": 900 / 3 };

describe("the bundle budget is down-only", () => {
  it("within every ceiling and target: PASS", () => {
    const r = run(BUDGET, OK);
    expect(r.out).toMatch(/PASS/);
    expect(r.status).toBe(0);
  });

  it("a chunk that grows past its ceiling fails", () => {
    expect(run(BUDGET, { ...OK, "vendor-map-AbCd1234.js": 2700 }).status).toBe(1);
  });

  it("a chunk with no ceiling is held to the 600 KB target", () => {
    expect(run(BUDGET, { ...OK, "index-EfGh5678.js": 700 }).status).toBe(1);
  });

  it("a ceiling left loose after the chunk shrinks fails until it is lowered", () => {
    const r = run(BUDGET, { ...OK, "vendor-map-AbCd1234.js": 2000 });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/lower the ceiling/);
  });

  it("a ceiling whose chunk is back within target, or gone, must be removed", () => {
    expect(run(BUDGET, { ...OK, "vendor-map-AbCd1234.js": 500 }).out).toMatch(/remove its ceiling/);
    const { "vendor-map-AbCd1234.js": _gone, ...rest } = OK;
    expect(run(BUDGET, rest).out).toMatch(/matches no chunk/);
  });

  it("a ceiling covers only the largest chunk of its name — a same-named small chunk keeps the 600 KB target", () => {
    const budget = { ...BUDGET, ceilings: { ...BUDGET.ceilings, totalKB: 4300 } };
    // index-big under its 745 ceiling would be fine; index-small at 700 KB
    // must fail on the 600 KB target, not hide under the big one's ceiling.
    const r = run(
      { ...budget, ceilings: { ...budget.ceilings, chunks: { ...budget.ceilings.chunks, index: 745 } } },
      { ...OK, "index-EfGh5678.js": 730, "index-Zz123456.js": 700 },
    );
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/index-Zz123456\.js: 700 KB \(limit: 600 KB\)/);
  });

  it("a loose total ceiling fails too", () => {
    expect(run({ ...BUDGET, ceilings: { ...BUDGET.ceilings, totalKB: 9000 } }, OK).status).toBe(1);
  });

  it("the real budget's ceilings sit above their targets (a ceiling below target is not a ceiling)", () => {
    const real = JSON.parse(readFileSync(path.join(ROOT, "scripts/bundle-budget.json"), "utf8"));
    for (const kb of Object.values(real.ceilings.chunks as Record<string, number>)) expect(kb).toBeGreaterThan(real.targets.maxChunkKB);
    expect(real.ceilings.totalKB).toBeGreaterThan(real.targets.maxTotalKB);
  });

  it("CI runs the gate after the build, in the job deploy depends on through ci.yml", () => {
    const ci = yaml.load(readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8")) as {
      jobs: Record<string, { steps: Array<{ run?: string }> }>;
    };
    const runs = ci.jobs.build.steps.map((s) => s.run ?? "");
    const build = runs.findIndex((r) => /npm run build/.test(r));
    const gate = runs.findIndex((r) => /node scripts\/check-bundle-size\.js/.test(r));
    expect(build).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(build);
  });
});

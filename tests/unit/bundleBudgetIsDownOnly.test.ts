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

interface RunOptions {
  /** Which build output to lay out and measure (default: customer, the original shape). */
  output?: "customer" | "founder";
  /** Extra CLI args (the script is always passed `--output <output>` for the founder). */
  args?: string[];
  /** A chunk graph to write at dist/client-chunk-graph.json (customer run only). */
  graph?: object;
  /** Skip creating the output directory entirely (the "build did not run" case). */
  noOutputDir?: boolean;
}

function run(
  budget: object,
  chunks: Record<string, number>,
  opts: RunOptions = {},
): { status: number | null; out: string } {
  const output = opts.output ?? "customer";
  const dir = mkdtempSync(path.join(tmpdir(), "bundle-budget-"));
  mkdirSync(path.join(dir, "scripts"));
  copyFileSync(path.join(ROOT, "scripts/check-bundle-size.js"), path.join(dir, "scripts/check-bundle-size.js"));
  writeFileSync(path.join(dir, "scripts/bundle-budget.json"), JSON.stringify(budget));
  const assets =
    output === "founder" ? path.join(dir, "dist/founder/founder-assets") : path.join(dir, "dist/public/assets");
  if (opts.noOutputDir) mkdirSync(path.join(dir, "dist"), { recursive: true });
  else mkdirSync(assets, { recursive: true });
  if (!opts.noOutputDir) {
    for (const [file, kb] of Object.entries(chunks)) writeFileSync(path.join(assets, file), Buffer.alloc(Math.round(kb * KB), 97));
  }
  if (opts.graph) writeFileSync(path.join(dir, "dist/client-chunk-graph.json"), JSON.stringify(opts.graph));
  const cliArgs = [path.join(dir, "scripts/check-bundle-size.js"), ...(output === "founder" ? ["--output", "founder"] : []), ...(opts.args ?? [])];
  const r = spawnSync(process.execPath, cliArgs, {
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

  it("CI runs the gate for BOTH outputs — an unmeasured founder bundle is not a passing one", () => {
    const ci = yaml.load(readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8")) as {
      jobs: Record<string, { steps: Array<{ run?: string }> }>;
    };
    const runs = ci.jobs.build.steps.map((s) => s.run ?? "");
    const build = runs.findIndex((r) => /npm run build/.test(r));
    const customer = runs.findIndex(
      (r) => /node scripts\/check-bundle-size\.js(?!.*--output)/.test(r) && /--require-graph/.test(r),
    );
    const founder = runs.findIndex((r) => /node scripts\/check-bundle-size\.js\s+--output\s+founder/.test(r));
    expect(customer, "no customer-output gate step with --require-graph").toBeGreaterThan(build);
    expect(founder, "no founder-output gate step").toBeGreaterThan(build);
  });
});

// ── The founder output (P1-9 / X-2) ───────────────────────────────────────────
// The client builds to two outputs. The founder bundle (dist/founder) has its
// own down-only ceiling and vacuity floor, and the customer run proves no
// founder-only module leaked into a customer chunk. Each of those is a gate over
// a property, so each is exercised against the DEFECT (a founder module put
// back into a customer chunk), not just the happy path.
describe("the founder output has its own down-only budget", () => {
  const FOUNDER_BUDGET = { ...BUDGET, founder: { ceilings: { totalKB: 660 } } };
  /** `count` chunks of `kbEach` KB — the founder floor is 140 files. */
  const founderTree = (count: number, kbEach: number) =>
    Object.fromEntries(
      Array.from({ length: count }, (_, i) => [`page${String(i).padStart(3, "0")}-AbCd${String(i).padStart(4, "0")}.js`, kbEach]),
    );

  it("within its ceiling: PASS, and says it measured the founder output", () => {
    const r = run(FOUNDER_BUDGET, founderTree(160, 4), { output: "founder" });
    expect(r.out).toMatch(/PASS/);
    expect(r.out).toMatch(/output:\s+founder/);
    expect(r.out).toMatch(/dist\/founder\/founder-assets/);
    expect(r.status).toBe(0);
  });

  it("growth past the founder ceiling fails", () => {
    const r = run(FOUNDER_BUDGET, founderTree(160, 5), { output: "founder" });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/Total JS: \d+ KB exceeds limit of 660 KB/);
  });

  it("a founder ceiling left loose fails until it is lowered (down-only)", () => {
    const r = run({ ...BUDGET, founder: { ceilings: { totalKB: 900 } } }, founderTree(160, 4), { output: "founder" });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/lower the ceiling/);
  });

  it("the founder run is held to the founder ceiling, not the customer's (and vice versa)", () => {
    // 160 x 4 KB = 640 KB: far under the customer ceiling (3500), over a tight founder one.
    const tight = { ...BUDGET, founder: { ceilings: { totalKB: 600 } } };
    expect(run(tight, founderTree(160, 4), { output: "founder" }).status).toBe(1);
    // A founder block must not loosen or tighten the CUSTOMER run.
    expect(run(tight, OK).status).toBe(0);
  });

  it("an absent founder output fails — it is never a skip, in CI or out of it", () => {
    const r = run(FOUNDER_BUDGET, {}, { output: "founder", noOutputDir: true });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/--output founder was requested/);
  });

  it("a founder run with no founder ceiling in the budget fails rather than falling back to a target", () => {
    const r = run(BUDGET, founderTree(160, 4), { output: "founder" });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/no numeric founder\.ceilings\.totalKB/);
  });

  it("the founder run has its own vacuity floor — a mostly-empty founder output is not a small clean one", () => {
    const r = run(FOUNDER_BUDGET, founderTree(10, 10), { output: "founder" });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/VACUOUS SCAN/);
  });

  it("an unknown --output is refused, not guessed", () => {
    const r = run(FOUNDER_BUDGET, OK, { args: ["--output", "bogus"] });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/unknown --output "bogus"/);
  });

  it("the real budget carries a numeric, down-only founder ceiling", () => {
    const real = JSON.parse(readFileSync(path.join(ROOT, "scripts/bundle-budget.json"), "utf8"));
    expect(Number.isFinite(real.founder?.ceilings?.totalKB), "founder.ceilings.totalKB must be a number").toBe(true);
    expect(real.founder.ceilings.totalKB).toBeGreaterThan(0);
    // Down-only on the customer side too: the extraction can only have LOWERED
    // the 9,823 KB ceiling it started from.
    expect(real.ceilings.totalKB).toBeLessThanOrEqual(9823);
  });
});

describe("the customer run proves no founder-only module is in a customer chunk", () => {
  const graphOf = (chunks: Record<string, Record<string, number>>) => ({
    version: 2,
    chunks: Object.fromEntries(
      Object.entries(chunks).map(([file, modules]) => [
        `assets/${file}`,
        { name: file, isEntry: false, imports: [], dynamicImports: [], modules, bytes: 1 },
      ]),
    ),
    dynamicImports: {},
  });
  const CLEAN = graphOf({
    "vendor-map-AbCd1234.js": { "node_modules/maplibre-gl/dist/x.js": 100 },
    "index-EfGh5678.js": { "client/src/App.tsx": 100, "client/src/lib/founder-doors.ts": 5 },
    "page-IjKl9012.js": { "client/src/pages/today.tsx": 100, "client/src/pages/commissions.tsx": 5 },
  });

  it("a clean graph passes and the run says how much it read", () => {
    const r = run(BUDGET, OK, { graph: CLEAN, args: ["--require-graph"] });
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/3 chunks, 5 modules scanned, 0 founder-only/);
  });

  it("lib/founder-doors.ts and the shared commissions page are NOT founder-only (shared on purpose)", () => {
    // Pinned so the pattern list cannot quietly grow to cover shared code and
    // turn this gate into a standing false alarm someone then deletes.
    expect(run(BUDGET, OK, { graph: CLEAN, args: ["--require-graph"] }).status).toBe(0);
  });

  it.each([
    "client/src/pages/founder/home.tsx",
    "client/src/pages/founder-letter.tsx",
    "client/src/components/founder/ai-console/VaTeamPanel.tsx",
    "client/src/components/founder-chat/Dock.tsx",
    "client/src/components/founder-bridge/BridgeAtlasSheet.tsx",
    "client/src/components/mobile/FounderMobileBottomNav.tsx",
    "client/src/pages/dunning-manager.tsx",
    "client/src/pages/agent-detail.tsx",
    "client/src/hooks/use-sovereign-dashboard.ts",
    "client/src/founder-routes.tsx",
  ])("a founder-only module in a customer chunk fails: %s", (mod) => {
    const graph = graphOf({
      "index-EfGh5678.js": { "client/src/App.tsx": 100 },
      "page-IjKl9012.js": { [mod]: 9 },
    });
    const r = run(BUDGET, OK, { graph, args: ["--require-graph"] });
    expect(r.status).toBe(1);
    expect(r.out).toContain("founder-only module in the CUSTOMER bundle");
    expect(r.out).toContain(mod);
  });

  it("a graph that names a chunk the build did not emit is the graph of another build", () => {
    const graph = graphOf({
      "index-EfGh5678.js": { "client/src/App.tsx": 100 },
      "ghost-ZzZz0000.js": { "client/src/pages/today.tsx": 100 },
    });
    const r = run(BUDGET, OK, { graph, args: ["--require-graph"] });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/graph of another build/);
  });

  it("a graph that lists no modules proves nothing", () => {
    const graph = graphOf({ "index-EfGh5678.js": {} });
    const r = run(BUDGET, OK, { graph, args: ["--require-graph"] });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/no modules/);
  });

  it("a missing graph fails with --require-graph (CI), and is a loud skip without it", () => {
    const required = run(BUDGET, OK, { args: ["--require-graph"] });
    expect(required.status).toBe(1);
    expect(required.out).toMatch(/chunk-graph\.json is missing/);
    const optional = run(BUDGET, OK);
    expect(optional.status).toBe(0);
    expect(optional.out).toMatch(/chunk graph: SKIPPED/);
  });
});

/**
 * Negative-control battery for scripts/check-schema-journal-sync.mjs (P1-17).
 *
 * Each case builds a synthetic repo tree (migrations/, scripts/migrate.mjs,
 * scripts/ratchets/schema-journal-sync.json) and runs the REAL evaluator as a
 * child process with `--root <fixture>`. The defect is planted in the tree the
 * gate governs, not in a string the gate mentions.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const REPO_ROOT = resolve(__dirname, "../..");
const EVALUATOR = join(REPO_ROOT, "scripts", "check-schema-journal-sync.mjs");

interface LegacyDesync {
  sqlOnly: string[];
  blockOnly: string[];
  duplicateSql: Record<string, number>;
  duplicateBlock: Record<string, number>;
}

interface FixtureSpec {
  /** .sql file names under migrations/ */
  sql: string[];
  /** block numbers to emit as `// NNNN — …` headers (one per entry) */
  blocks: string[];
  legacy?: Partial<LegacyDesync>;
  freezePoint?: string;
  minima?: { sqlFiles: number; blockHeaders: number; sqlNumbers: number };
}

interface RunResult {
  status: number | null;
  output: string;
}

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const d = tempDirs.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

// Fixture baseline: 0100 is a legacy sqlOnly; 0001 is a legacy duplicateSql.
const BASE_SQL = ["0001_a.sql", "0001_b.sql", "0100_legacy.sql", "0200_paired.sql", "0309_paired.sql"];
const BASE_BLOCKS = ["0200", "0309"];
const BASE_LEGACY: LegacyDesync = {
  sqlOnly: ["0001", "0100"],
  blockOnly: [],
  duplicateSql: { "0001": 2 },
  duplicateBlock: {},
};

function buildFixture(spec: FixtureSpec): string {
  const root = mkdtempSync(join(tmpdir(), "journal-sync-"));
  tempDirs.push(root);
  mkdirSync(join(root, "migrations"), { recursive: true });
  mkdirSync(join(root, "scripts", "ratchets"), { recursive: true });
  for (const f of spec.sql) writeFileSync(join(root, "migrations", f), "SELECT 1;\n");
  const body = spec.blocks.map((n) => `// ${n} — fixture block\nawait noop();\n`).join("\n");
  writeFileSync(join(root, "scripts", "migrate.mjs"), `// fixture\n${body}`);
  const legacy: LegacyDesync = { ...BASE_LEGACY, ...spec.legacy };
  const headline =
    legacy.sqlOnly.length +
    legacy.blockOnly.length +
    Object.keys(legacy.duplicateSql).length +
    Object.keys(legacy.duplicateBlock).length;
  const cfg = {
    name: "schema-journal-sync",
    baselineCount: headline,
    minima: spec.minima ?? { sqlFiles: 3, blockHeaders: 1, sqlNumbers: 3 },
    freezePoint: spec.freezePoint ?? "0309",
    legacyDesync: legacy,
  };
  writeFileSync(join(root, "scripts", "ratchets", "schema-journal-sync.json"), JSON.stringify(cfg, null, 2));
  return root;
}

function run(root: string): RunResult {
  const r = spawnSync(process.execPath, [EVALUATOR, "--root", root], { encoding: "utf8" });
  return { status: r.status, output: `${r.stdout}${r.stderr}` };
}

describe("schema-journal-sync evaluator", () => {
  it("1. a frontier migration paired on both sides passes", () => {
    const root = buildFixture({
      sql: [...BASE_SQL, "0310_new.sql"],
      blocks: [...BASE_BLOCKS, "0310"],
    });
    const r = run(root);
    expect(r.output).toContain("PASS");
    expect(r.status).toBe(0);
  });

  it("2. a .sql with no block fails and names the number", () => {
    const root = buildFixture({ sql: [...BASE_SQL, "0310_new.sql"], blocks: BASE_BLOCKS });
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.output).toContain("0310");
    expect(r.output).toContain("NEW DESYNC");
    expect(r.output).not.toContain("PASS");
  });

  it("3. a block with no .sql fails and names the number", () => {
    const root = buildFixture({ sql: BASE_SQL, blocks: [...BASE_BLOCKS, "0310"] });
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.output).toContain("0310");
    expect(r.output).toContain("blockOnly");
  });

  it("4. two .sql files sharing a number fail and name it", () => {
    const root = buildFixture({
      sql: [...BASE_SQL, "0310_a.sql", "0310_b.sql"],
      blocks: [...BASE_BLOCKS, "0310"],
    });
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.output).toContain("0310");
    expect(r.output).toContain("duplicateSql");
  });

  it("5. a desync exactly equal to the baseline passes", () => {
    // Baseline already lists 0100 sqlOnly and 0001 duplicateSql; the tree has both.
    const root = buildFixture({ sql: BASE_SQL, blocks: BASE_BLOCKS });
    const r = run(root);
    expect(r.status).toBe(0);
    expect(r.output).toContain("PASS");
  });

  it("6. a baseline entry cured in the tree fails (baseline update owed)", () => {
    const root = buildFixture({ sql: BASE_SQL, blocks: [...BASE_BLOCKS, "0100"] });
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.output).toContain("0100");
    expect(r.output).toContain("CURED");
    expect(r.output).not.toContain("PASS");
  });

  it("7. a baseline that grandfathers a number above freezePoint fails", () => {
    const root = buildFixture({
      sql: [...BASE_SQL, "0310_new.sql"],
      blocks: BASE_BLOCKS,
      legacy: { sqlOnly: ["0001", "0100", "0310"] },
    });
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.output).toContain("CONFIG ERROR");
    expect(r.output).toContain("0310");
    expect(r.output).not.toContain("PASS");
  });

  it("8. an emptied migrations/ is refused with no verdict", () => {
    const root = buildFixture({ sql: [], blocks: BASE_BLOCKS });
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.output).toContain("REFUSED");
    expect(r.output).not.toContain("PASS");
  });
});

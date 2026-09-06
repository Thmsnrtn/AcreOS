/**
 * `migrate.mjs` retries its skipped statements once, in the same run.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 * A skipped statement has two very different causes:
 *
 *   (a) the prerequisite genuinely is not in this repository — an operator has
 *       to apply something and re-deploy; or
 *   (b) the prerequisite IS in this file, later. `ALTER TABLE
 *       "cancellation_surveys" …` sits near line 183; that table's CREATE is at
 *       ~1949.
 *
 * Measured against PostgreSQL 16 on 2026-08-18: after one full pass of
 * migrations/*.sql, 37 statements skipped and ALL 37 were case (b), across
 * eight tables. A second invocation of the script resolved every one — which is
 * the only reason the DR runbook told you to run it twice.
 *
 * ── WHAT THIS GATES ─────────────────────────────────────────────────────────
 * The retry is easy to weaken in ways that stay green: make it unbounded, let
 * it swallow a genuine failure, or let it hide a prerequisite that really is
 * absent. Each of those is pinned here, on the source, because this script has
 * no import-safe entry point (it connects on import and calls process.exit).
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const SRC = fs.readFileSync(
  path.join(path.resolve(__dirname, "../.."), "scripts/migrate.mjs"),
  "utf8",
);

/**
 * Source with comments removed.
 *
 * The ordering assertion below first compared `indexOf("WOULD FAIL")` against
 * the raw file and failed — because the phrase appears in the explanatory
 * comment ABOVE the code it describes. A source gate that reads its own
 * documentation is matching prose, not behaviour; the same mistake this
 * session already made twice, in the county-opportunity and deal-feed scanners.
 */
const CODE = stripComments(SRC);

describe("the retry pass exists and is bounded", () => {
  it("vacuity guard: the runner still has its statement loop and skip bookkeeping", () => {
    expect(SRC.length).toBeGreaterThan(100000);
    expect(SRC).toMatch(/for \(const stmt of STATEMENTS\)/);
    expect(SRC).toMatch(/EXPECTED_FAILURE_PATTERNS/);
    expect(SRC).toMatch(/skipped\.push\(/);
  });

  it("retries the skipped statements once, not in a loop", () => {
    expect(SRC).toMatch(/retrying \$\{firstPass\.length\} skipped statement\(s\)/);
    // `splice` drains the first-pass list exactly once and the retry iterates
    // that snapshot — so a statement that skips again cannot be retried
    // forever. A `while (skipped.length)` here would be unbounded.
    expect(SRC).toMatch(/const firstPass = skipped\.splice\(0, skipped\.length\)/);
    expect(SRC, "the retry became an unbounded loop").not.toMatch(
      /while\s*\(\s*skipped\.length/,
    );
  });

  it("a statement that still skips is still reported, and says the retry happened", () => {
    // Case (a) must survive the change: a genuinely absent prerequisite is
    // reported, not silently absorbed by the retry.
    expect(SRC).toMatch(/skipped due to missing prerequisite, even after the retry pass/);
  });

  it("a statement that FAILS differently on retry is escalated, not softened", () => {
    // The first pass classified it as a non-fatal skip. If the retry produces
    // an unexpected error, the softer verdict must not stand.
    expect(SRC).toMatch(/FAILED on retry/);
    const at = SRC.indexOf("FAILED on retry");
    const near = SRC.slice(at, at + 400);
    expect(near, "a retry failure does not set the non-zero exit code").toMatch(/exitCode = 1/);
    expect(near, "a retry failure is not recorded as a failure").toMatch(/failures\.push\(/);
  });

  it("the retry runs BEFORE the residual-skip verdict is printed", () => {
    // Printing the verdict first would report the pre-retry count — the
    // number the retry exists to reduce.
    const retryAt = SRC.indexOf("retrying ${firstPass.length} skipped");
    const verdictAt = SRC.indexOf("even after the retry pass");
    expect(retryAt).toBeGreaterThan(-1);
    expect(verdictAt).toBeGreaterThan(retryAt);
  });
});

describe("the dry-run gate does not call an unvalidatable statement a failure", () => {
  /**
   * Found by running the DR runbook's restore drill end to end for the first
   * time: `migrate.mjs --dry-run` exited 1 with "NOT safe to deploy as-is"
   * against a database that had just restored PERFECTLY (row counts exact).
   * All 7 reported failures were `CREATE INDEX CONCURRENTLY`, which PostgreSQL
   * refuses inside a transaction block — and the dry-run validates inside one
   * transaction and rolls back. Its own mechanism cannot host them; the real
   * non-transactional run applies all 7 without trouble.
   *
   * An operator following the runbook after a real outage would be told their
   * good backup is unsafe. One who has seen it before learns to ignore the
   * gate, and then it cannot warn them about anything.
   */
  it("classifies non-transactional statements separately from failures", () => {
    expect(SRC).toMatch(/const unvalidatable = \[\]/);
    expect(SRC).toMatch(/cannot run inside a transaction block/);
    expect(SRC).toMatch(/NOT VALIDATED \(cannot run inside a transaction/);
  });

  it("an unvalidatable statement does NOT set the failure exit code", () => {
    // The whole defect: these counted toward `failures`, which sets exit 1.
    const at = SRC.indexOf("unvalidatable.push(");
    expect(at).toBeGreaterThan(-1);
    const branch = SRC.slice(at - 200, at + 300);
    expect(branch, "the unvalidatable branch still marks a failure").not.toMatch(/failures\.push\(/);
    expect(branch, "the unvalidatable branch still sets exit 1").not.toMatch(/exitCode = 1/);
  });

  it("the unvalidatable branch is checked BEFORE the generic failure branch", () => {
    // Order matters: a generic `else` reached first would re-classify them as
    // failures and restore the false alarm.
    // 61,856 chars measured after stripping (the file is heavily commented).
    expect(CODE.length, "the comment stripper ate the file").toBeGreaterThan(40000);
    const conc = CODE.indexOf("CANNOT_DRY_RUN.test(err.message)");
    const wouldFail = CODE.indexOf("WOULD FAIL");
    expect(conc).toBeGreaterThan(-1);
    expect(conc).toBeLessThan(wouldFail);
  });

  it("the gate STATES the coverage it does not have, on every run", () => {
    // A gate that silently drops a category is claiming proof it never had.
    expect(SRC).toMatch(/not validated \(non-transactional\)/);
    expect(SRC).toMatch(/they are not proof either — this gate says nothing about them/);
  });
});

describe("the DR runbook states the procedure that was actually measured", () => {
  const RUNBOOK = fs.readFileSync(
    path.join(path.resolve(__dirname, "../.."), "docs/reliability/dr-runbook-postgres-restore.md"),
    "utf8",
  );

  it("documents one SQL pass and one migrate.mjs run", () => {
    expect(RUNBOOK).toMatch(/ONE pass of the SQL files, ONE run of migrate\.mjs/);
    // The old two-pass loop must be gone, or an operator follows the wrong one.
    expect(RUNBOOK, "the old two-pass loop is still in the runbook").not.toMatch(
      /for pass in 1 2; do/,
    );
  });

  it("carries the measured end state rather than a claim", () => {
    expect(RUNBOOK).toMatch(/757 tables/);
    expect(RUNBOOK).toMatch(/ZERO skipped/);
  });

  it("the RTO table is filled in, and says which step was NOT exercised", () => {
    // It read "PLACEHOLDER, fill on first drill … Until then, RTO is unproven."
    expect(RUNBOOK, "the RTO table is a placeholder again").not.toMatch(/PLACEHOLDER, fill on first drill/);
    expect(RUNBOOK).toMatch(/first drill run 2026-08-18/);
    // The honest half: a measured local drill is not a measured production RTO,
    // and the S3 fetch was never run. Dropping that caveat would turn a partial
    // proof into a claimed one.
    expect(RUNBOOK, "the un-exercised S3 step is no longer disclosed").toMatch(
      /not exercised/,
    );
    expect(RUNBOOK).toMatch(/does \*\*not\*\* prove the timings|not prove the timings/);
  });
});

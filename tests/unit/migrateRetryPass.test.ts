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

const SRC = fs.readFileSync(
  path.join(path.resolve(__dirname, "../.."), "scripts/migrate.mjs"),
  "utf8",
);

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
});

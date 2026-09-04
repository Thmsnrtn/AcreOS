/**
 * CI builds the schema this repository describes, and gates on the result.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * Three separate steps looked like a migration gate. None could fail.
 *
 *   1. test.yml ran `npx drizzle-kit migrate` with `continue-on-error: true`.
 *      drizzle.config.ts records that migrations/meta/_journal.json was
 *      deleted on 2026-05-11 and must not be partially restored, so the
 *      migrator has no journal — the step could only ever error, and
 *      continue-on-error swallowed it.
 *   2. deploy.yml counted `find drizzle -name "*.sql" -newer fly.toml`. There
 *      is no `drizzle/` directory in this repository; migrations live in
 *      `migrations/`. MIGRATION_COUNT was permanently 0 and nothing read it.
 *   3. check-schema-migrate-mirror.mjs is TABLE-level and defers column drift
 *      to "the DB-backed `migrate.mjs --dry-run` gate ... in the deploy
 *      pipeline". `grep -rn "dry-run" .github/workflows/` returned nothing.
 *
 * The first time anyone actually built the schema from this repository
 * (2026-09-04, PostgreSQL 16), 37 columns declared in shared/schema.ts existed
 * in no DDL here — and because Drizzle names every declared column when a
 * select has no projection, `db.select().from(properties)` and `.from(deals)`
 * both failed outright on the result, against 39 and 17 bare-select call
 * sites.
 *
 * ── WHAT THIS PINS ──────────────────────────────────────────────────────────
 * The gate is one script (`npm run db:build-from-repo`) called by BOTH
 * workflows that provision a postgres service, so the two cannot drift; the
 * script runs all four phases; the two dead spellings cannot come back
 * anywhere under .github/; and the column-mirror register stays at zero.
 *
 * This test cannot run the database itself — that is the CI step's job. It
 * pins that the step EXISTS, is wired, and is not decorative, which is exactly
 * what was missing before.
 *
 * idempotent: true — pure source reads, no DB.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const NPM_SCRIPT = "db:build-from-repo";
const BUILD_SCRIPT = "scripts/ci/build-schema-from-repo.sh";
const MIRROR = "scripts/check-db-column-mirror.ts";
const ALLOWLIST = "scripts/db-column-mirror.allowlist.json";

const WORKFLOW_DIR = ".github/workflows";
const workflows = fs
  .readdirSync(path.join(ROOT, WORKFLOW_DIR))
  .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
  .map((f) => `${WORKFLOW_DIR}/${f}`);

/**
 * Strip comment lines before scanning for a forbidden spelling. The comments
 * added in the same commit as this test EXPLAIN the two dead spellings by
 * name, and a raw substring scan reads its own documentation as the defect —
 * the identical trap `stripComments` was written for on the TS side.
 * A `#` line is a comment in YAML and, inside a `run:` block, in the shell
 * too, so one rule covers both.
 *
 * It is applied to the POPULATION predicates as well, not just the forbidden
 * spellings. That is not caution: borrower-cookie-e2e.yml mentions
 * `npm run check` only in a header comment explaining which env var it needs,
 * and the first version of this file pulled it into the gating population on
 * that line alone. A population predicate is a predicate — it reads comments
 * exactly as eagerly as the rule does.
 */
const withoutComments = (src: string) =>
  src
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");

/**
 * THE POPULATION: workflows that run the repository's unified gate
 * (`npm run check`) against a postgres service. That is the set for which
 * "you are already gating this commit, and you have a database to gate it in"
 * is true — test.yml (branch gate), deploy.yml (production pre-deploy) and
 * staging.yml (staging pre-deploy).
 *
 * Derived, not typed, so a fourth gating workflow that skips the schema build
 * is what fails here. borrower-cookie-e2e.yml is deliberately NOT in it: it
 * provisions postgres only as a fallback and normally points DATABASE_URL at
 * `secrets.E2E_DATABASE_URL`, a shared throwaway database. Running the
 * release_command against someone else's database is a side effect a test
 * workflow has no business having, which is why the population is "runs the
 * gate suite" and not "has a postgres service".
 */
const withPostgres = workflows.filter((rel) => /image:\s*postgres:/.test(withoutComments(read(rel))));
const gatingWorkflows = withPostgres.filter((rel) =>
  withoutComments(read(rel)).includes("npm run check"),
);

describe("the schema build is wired into CI", () => {
  it("scans a real population of workflows (vacuity guard)", () => {
    expect(workflows.length).toBeGreaterThan(3);
    expect(withPostgres.length).toBeGreaterThan(0);
    expect(gatingWorkflows.length).toBeGreaterThan(0);
  });

  it("every gating workflow runs the schema build", () => {
    // All of them call the SAME npm script. A workflow that inlined the psql
    // loop instead would drift from the others within a release.
    const missing = gatingWorkflows.filter(
      (rel) => !withoutComments(read(rel)).includes(`npm run ${NPM_SCRIPT}`),
    );
    expect(
      missing,
      `these workflows gate a commit against a postgres service and never build the schema in it: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("the three that gate a branch, staging and production are all in the population", () => {
    // Named as well as derived: the derivation proves the rule holds over
    // whatever exists, this proves the three that matter still exist at all.
    // If one is renamed, this fails and the rename gets read by a human.
    expect(gatingWorkflows.sort()).toEqual(
      [`${WORKFLOW_DIR}/deploy.yml`, `${WORKFLOW_DIR}/staging.yml`, `${WORKFLOW_DIR}/test.yml`].sort(),
    );
  });

  it("the deploy gate runs it in the job the deploy DEPENDS on", () => {
    const deploy = read(`${WORKFLOW_DIR}/deploy.yml`);
    // The step must be in the `test` job (which `deploy` needs:), not in the
    // deploy job where it would run after the point of no return.
    const testJobAt = deploy.indexOf("  test:");
    const deployJobAt = deploy.indexOf("  deploy:");
    const stepAt = deploy.indexOf(`npm run ${NPM_SCRIPT}`);
    expect(testJobAt).toBeGreaterThan(-1);
    expect(deployJobAt).toBeGreaterThan(testJobAt);
    expect(stepAt).toBeGreaterThan(testJobAt);
    expect(stepAt).toBeLessThan(deployJobAt);
    expect(deploy).toMatch(/needs:\s*test/);
  });

  it("neither dead spelling can come back, anywhere under .github/", () => {
    for (const rel of workflows) {
      const src = withoutComments(read(rel));
      expect(src, `${rel}: \`find drizzle\` globs a directory this repo does not have`).not.toMatch(
        /find\s+drizzle\b/,
      );
      expect(
        src,
        `${rel}: drizzle-kit migrate cannot run — migrations/meta/_journal.json was deleted (drizzle.config.ts)`,
      ).not.toMatch(/drizzle-kit\s+migrate/);
    }
    // Vacuity: the premise that makes the second rule correct still holds.
    expect(fs.existsSync(path.join(ROOT, "migrations/meta/_journal.json"))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, "drizzle"))).toBe(false);
    // And the stripper is doing work rather than blanking the files: both
    // spellings ARE still present in the comments that explain them, so a
    // stripper that returned "" would look identical to a clean repo.
    expect(read(`${WORKFLOW_DIR}/deploy.yml`)).toMatch(/find drizzle/);
    expect(read(`${WORKFLOW_DIR}/test.yml`)).toMatch(/drizzle-kit migrate/);
    for (const rel of workflows) {
      expect(withoutComments(read(rel)).length, `${rel}: stripper ate the file`).toBeGreaterThan(50);
    }
  });
});

describe("the script it calls is not decorative", () => {
  const sh = read(BUILD_SCRIPT);

  it("package.json points the npm script at it", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts[NPM_SCRIPT]).toContain(BUILD_SCRIPT);
  });

  it("runs all four phases, in order, and each one can fail the job", () => {
    const phases = [
      { what: "migrations/*.sql", match: /psql .*-f "\$f"/ },
      { what: "the release_command", match: /if ! node scripts\/migrate\.mjs;/ },
      { what: "--dry-run", match: /if ! node scripts\/migrate\.mjs --dry-run;/ },
      { what: "the column mirror", match: new RegExp(`if ! npx tsx ${MIRROR.replace(/\//g, "\\/")};`) },
    ];
    let cursor = -1;
    for (const p of phases) {
      const m = sh.match(p.match);
      expect(m, `${BUILD_SCRIPT} must run ${p.what}`).not.toBeNull();
      const at = sh.indexOf(m![0]);
      expect(at, `${p.what} is out of order`).toBeGreaterThan(cursor);
      cursor = at;
    }
    // Each gated phase exits non-zero. `set -e` is deliberately NOT used (the
    // base layer tolerates per-statement errors), so the exits must be explicit.
    expect((sh.match(/exit 1/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it("refuses to run without a database rather than passing", () => {
    expect(sh).toMatch(/if \[\[ -z "\$\{DATABASE_URL:-\}" \]\]; then\n\s*echo[^\n]*\n\s*exit 1/);
  });
});

describe("the column mirror gate", () => {
  const src = read(MIRROR);

  it("fails on a declared table or column the database does not have", () => {
    expect(src).toContain("missingTables.push(cfg.name)");
    expect(src).toContain("missingColumns.push(`${cfg.name}.${c.name}`)");
    expect(src).toMatch(/unexplainedTables\.length > 0 \|\| unexplainedColumns\.length > 0/);
  });

  it("cannot report clean over a population it failed to read", () => {
    // The three vacuity floors. Both halves of this gate's population are
    // produced by code that can stop matching silently: getTableConfig throws
    // for every non-table export (caught), and information_schema answers for
    // whatever database DATABASE_URL names. Either failure reads as "no drift".
    for (const floor of ["DECLARED_TABLE_FLOOR", "DECLARED_COLUMN_FLOOR", "DB_TABLE_FLOOR"]) {
      expect(src, `${MIRROR} must have a ${floor}`).toContain(`const ${floor} =`);
      expect(src, `${floor} must be checked, not merely declared`).toMatch(
        new RegExp(`<\\s*${floor}\\)`),
      );
    }
  });

  it("its register is empty and only shrinks", () => {
    const allow = JSON.parse(read(ALLOWLIST)) as { entries: string[]; _README?: string };
    expect(
      allow.entries,
      "a database built from this repository has every table and column shared/schema.ts " +
        "declares. An entry here means every query naming it 500s on such a database — " +
        "adding one is a regression to argue for, not routine.",
    ).toEqual([]);
    expect(allow._README, "the register must explain itself").toBeTruthy();
    // A stale entry fails too, so the register cannot be used to hide a fix.
    expect(src).toContain("staleAllowlist");
  });

  it("states the coverage it does NOT have", () => {
    // Name-level only. A gate that quietly implies more than it checks is how
    // the table-level mirror's deferral to a non-existent dry-run gate went
    // unnoticed for months.
    expect(src).toMatch(/name-level only — column TYPE and NULLABILITY divergence is not checked/);
  });
});

describe("the 37 columns are in the authoritative patch layer", () => {
  const migrate = read("scripts/migrate.mjs");

  it("every column the build was missing has an idempotent ALTER", () => {
    // A spot-check would pass with 36 of 37 present. This is the full set that
    // a real PostgreSQL 16 build reported absent on 2026-09-04.
    const MISSING_2026_09_04: Record<string, string[]> = {
      deals: ["deleted_at", "deleted_by"],
      decisions_inbox_items: [
        "owner_agent_codename", "expected_outcome", "check_in_date", "actual_outcome",
        "outcome_score", "outcome_recorded_at", "founder_modification",
      ],
      pax_cross_org_learnings: ["contributing_org_ids"],
      pax_nudges: ["snoozed_until", "snooze_count", "actioned_at", "action_type"],
      properties: [
        "bedrooms", "bathrooms", "square_feet", "year_built", "stories", "garage_spaces",
        "lot_size_sq_ft", "structure_type", "condition", "after_repair_value",
        "estimated_repair_cost", "monthly_rent", "cap_rate", "noi", "owning_entity",
        "deleted_at", "deleted_by",
      ],
      scenario_simulations: ["agent_analyses", "scenarios", "recommendation", "requested_by"],
      territories: ["state_code", "assigned_user_id"],
    };
    const all = Object.entries(MISSING_2026_09_04).flatMap(([t, cs]) => cs.map((c) => [t, c]));
    expect(all).toHaveLength(37);
    for (const [table, col] of all) {
      expect(
        migrate,
        `scripts/migrate.mjs must ADD COLUMN IF NOT EXISTS "${col}" on "${table}"`,
      ).toContain(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${col}"`);
    }
  });

  it("NOT NULL is never added without a default", () => {
    // ADD COLUMN ... NOT NULL with no default fails outright on a populated
    // table — it would abort the release_command on production and not in CI,
    // where the tables are empty. territories.state_code is the one such
    // column; it is added nullable and tightened conditionally.
    const bad = [...migrate.matchAll(/ADD COLUMN IF NOT EXISTS "[^"]+" [a-z ()\[\]]+ NOT NULL(?! DEFAULT)/g)];
    expect(bad.map((m) => m[0])).toEqual([]);
    expect(migrate).toContain('ALTER TABLE "territories" ADD COLUMN IF NOT EXISTS "state_code" text`');
    expect(migrate).toMatch(
      /IF NOT EXISTS \(SELECT 1 FROM "territories" WHERE "state_code" IS NULL\) THEN\s*\n\s*ALTER TABLE "territories" ALTER COLUMN "state_code" SET NOT NULL;/,
    );
  });
});

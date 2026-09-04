/**
 * scripts/check-db-column-mirror.ts — can this repository build the schema its
 * own code queries?
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * `check-schema-migrate-mirror.mjs` proves every `pgTable` in shared/schema.ts
 * has a CREATE TABLE somewhere in this repo. It is TABLE-level and says so:
 * "Column-level drift (a new column on an existing table with no ALTER) ... is
 * left to the DB-backed `migrate.mjs --dry-run` gate (which needs a live DB, so
 * it runs in the deploy pipeline, not here)."
 *
 * That deferral pointed at nothing. As of 2026-09-04 no workflow in .github/
 * ran `--dry-run` against any database — `grep -rn "dry-run" .github/workflows`
 * returned zero lines — and test.yml's only migration step was
 * `npx drizzle-kit migrate` with `continue-on-error: true`, which cannot work
 * at all: migrations/meta/_journal.json does not exist, so drizzle-kit has no
 * journal to read. deploy.yml's "check for pending migrations" step globbed
 * `find drizzle -name "*.sql"` against a directory this repo does not have
 * (migrations live in `migrations/`), so its count was permanently 0.
 *
 * Three migration gates, none of which could fail.
 *
 * MEASURED the first time a database was actually built from this repository
 * (PostgreSQL 16, migrations/*.sql in order, then scripts/migrate.mjs):
 * 724/724 declared tables present — the table gate is honest — and 37 of 9,513
 * declared COLUMNS absent. Drizzle's `db.select()` with no projection names
 * every declared column, so `db.select().from(properties)` and
 * `.from(deals)` BOTH failed on that database, against 39 and 17 bare-select
 * call sites. Production has those columns only because someone once ran
 * `db:push` by hand — the exact provenance the 83-table exercise of
 * 2026-08-17 set out to end.
 *
 * ── WHAT IT CHECKS ──────────────────────────────────────────────────────────
 * Against a live DATABASE_URL: every table and every column Drizzle declares
 * exists in information_schema. Columns the database has and schema.ts does not
 * are NOT a finding — dropped columns linger, and nothing queries them.
 *
 * The gate is deliberately NAME-level. Type/nullability divergence is a real
 * but quieter class (a nullable column where the ORM says NOT NULL reads back
 * as `null` on a non-null field; a missing column is an immediate 500), and
 * folding it in here would have meant either a large allowlist on day one or a
 * gate nobody could keep green. It is named in the verdict so the omission is
 * visible rather than implied.
 *
 * ── WHERE IT RUNS ───────────────────────────────────────────────────────────
 * It needs a database, so it cannot join `npm run check`. It runs in
 * .github/workflows/test.yml against the postgres:16 service that job already
 * provisions, immediately after the same build the deploy performs:
 *
 *     migrations/*.sql in order  →  node scripts/migrate.mjs  →  this gate
 *
 * which means CI now exercises the release_command itself. Before this, nothing
 * did.
 *
 *   npx tsx scripts/check-db-column-mirror.ts            # gate (CI)
 *   npx tsx scripts/check-db-column-mirror.ts --measure  # report, never fail
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getTableConfig } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "../shared/schema";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWLIST_PATH = path.join(ROOT, "scripts", "db-column-mirror.allowlist.json");
const MEASURE = process.argv.includes("--measure");

/**
 * VACUITY FLOORS. A gate proves its property only over the population it
 * actually reads, and both halves of this population are produced by code that
 * can stop matching without erroring: `getTableConfig` throws for every export
 * that is not a table (caught below), so a drizzle-orm change that made it
 * throw for tables too would leave zero declared columns and a clean verdict;
 * an information_schema query against the wrong database returns rows for a
 * schema that is not ours. Either failure reads exactly like "no drift".
 *
 * Measured 2026-09-04: 724 tables, 9,513 columns declared; 734 tables in a
 * freshly built database. Floors sit below those and are raised only when the
 * real numbers move well past them.
 */
const DECLARED_TABLE_FLOOR = 650;
const DECLARED_COLUMN_FLOOR = 8500;
const DB_TABLE_FLOOR = 650;

interface Allowlist {
  _README?: string;
  entries: string[];
}

function readAllowlist(): Allowlist {
  if (!fs.existsSync(ALLOWLIST_PATH)) return { entries: [] };
  return JSON.parse(fs.readFileSync(ALLOWLIST_PATH, "utf8")) as Allowlist;
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[db-column-mirror] DATABASE_URL not set — this gate needs a live database.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, max: 2 });
const { rows } = await pool.query<{ table_name: string; column_name: string }>(
  `SELECT table_name, column_name
     FROM information_schema.columns
    WHERE table_schema = 'public'`,
);
await pool.end();

const dbColumns = new Map<string, Set<string>>();
for (const r of rows) {
  let set = dbColumns.get(r.table_name);
  if (!set) dbColumns.set(r.table_name, (set = new Set()));
  set.add(r.column_name);
}

const missingTables: string[] = [];
const missingColumns: string[] = [];
let declaredTables = 0;
let declaredColumns = 0;

for (const value of Object.values(schema)) {
  let cfg: ReturnType<typeof getTableConfig>;
  try {
    cfg = getTableConfig(value as never);
  } catch {
    continue; // not a pgTable — enums, relations, zod schemas, types
  }
  declaredTables++;
  const cols = dbColumns.get(cfg.name);
  if (!cols) {
    missingTables.push(cfg.name);
    // Its columns are not ALSO reported — one missing table is one finding.
    declaredColumns += cfg.columns.length;
    continue;
  }
  for (const c of cfg.columns) {
    declaredColumns++;
    if (!cols.has(c.name)) missingColumns.push(`${cfg.name}.${c.name}`);
  }
}

const allow = readAllowlist();
const allowSet = new Set(allow.entries);
const unexplainedTables = missingTables.filter((t) => !allowSet.has(t));
const unexplainedColumns = missingColumns.filter((c) => !allowSet.has(c));
const stillMissing = new Set([...missingTables, ...missingColumns]);
const staleAllowlist = allow.entries.filter((e) => !stillMissing.has(e));

console.log(
  `[db-column-mirror] read ${declaredTables} declared table(s), ${declaredColumns} declared column(s); ` +
    `database has ${dbColumns.size} table(s), ${rows.length} column(s)`,
);
console.log(
  `[db-column-mirror] name-level only — column TYPE and NULLABILITY divergence is not checked by this gate`,
);

let exitCode = 0;
const fail = (msg: string) => {
  console.error(`[db-column-mirror] ${msg}`);
  exitCode = 1;
};

if (declaredTables < DECLARED_TABLE_FLOOR)
  fail(`only ${declaredTables} declared tables read (floor ${DECLARED_TABLE_FLOOR}) — the schema walk found almost nothing, which is a broken gate, not a clean repo.`);
if (declaredColumns < DECLARED_COLUMN_FLOOR)
  fail(`only ${declaredColumns} declared columns read (floor ${DECLARED_COLUMN_FLOOR}) — same.`);
if (dbColumns.size < DB_TABLE_FLOOR)
  fail(`the database has only ${dbColumns.size} tables (floor ${DB_TABLE_FLOOR}) — this is not a built AcreOS database; build it before gating on it.`);

if (missingTables.length > 0) {
  console.log(`\n[db-column-mirror] tables declared in shared/schema.ts and absent from the database (${missingTables.length}):`);
  for (const t of missingTables.sort()) console.log(`  ${t}${allowSet.has(t) ? "  (allowlisted)" : ""}`);
}
if (missingColumns.length > 0) {
  console.log(`\n[db-column-mirror] columns declared in shared/schema.ts and absent from the database (${missingColumns.length}):`);
  for (const c of missingColumns.sort()) console.log(`  ${c}${allowSet.has(c) ? "  (allowlisted)" : ""}`);
}

if (MEASURE) {
  console.log(`\n[db-column-mirror] --measure: ${unexplainedTables.length + unexplainedColumns.length} unexplained, ${staleAllowlist.length} stale allowlist entr(ies)`);
  process.exit(0);
}

if (unexplainedTables.length > 0 || unexplainedColumns.length > 0) {
  fail(
    `${unexplainedTables.length} table(s) and ${unexplainedColumns.length} column(s) are declared in ` +
      `shared/schema.ts but cannot be created from this repository.\n` +
      `  Every query naming one of them 500s on any database built from this repo — and Drizzle's\n` +
      `  db.select() with no projection names EVERY declared column, so one missing column breaks\n` +
      `  every bare select on its table.\n` +
      `  Fix: add an idempotent CREATE TABLE / ALTER TABLE ... ADD COLUMN IF NOT EXISTS to\n` +
      `  scripts/migrate.mjs (generate it from the Drizzle definitions — scripts/generate-schema-ddl.ts\n` +
      `  for tables — never transcribe it by hand), or delete the declaration if nothing reads it.`,
  );
}

if (staleAllowlist.length > 0) {
  fail(
    `${staleAllowlist.length} allowlist entr(ies) in scripts/db-column-mirror.allowlist.json name something ` +
      `that now EXISTS: ${staleAllowlist.sort().join(", ")}. Remove them — the register only shrinks.`,
  );
}

if (exitCode === 0) {
  console.log(
    `[db-column-mirror] PASS — every declared table and column exists in a database built from this repository` +
      (allow.entries.length > 0 ? ` (${allow.entries.length} allowlisted)` : ""),
  );
}
process.exit(exitCode);

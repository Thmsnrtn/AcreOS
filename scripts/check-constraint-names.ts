/**
 * scripts/check-constraint-names.ts — do the UNIQUE constraints in a database
 * built from this repository carry the names shared/schema.ts declares?
 *
 * The comparison and its rationale live in scripts/lib/constraint-names.ts.
 * This file feeds it the real schema module and a real database (the same
 * DATABASE_URL `npm run db:build-from-repo` just built — it runs as that
 * script's last verdict step), then holds a REGISTER of known drift that may
 * only shrink, like scripts/db-column-mirror.allowlist.json.
 *
 *   npx tsx scripts/check-constraint-names.ts            # gate
 *   npx tsx scripts/check-constraint-names.ts --measure  # report, never fail
 *   npx tsx scripts/check-constraint-names.ts --print-register  # JSON of current findings
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import * as schema from "../shared/schema";
import { declaredUniques, diffUniqueNames, findingKey, type UniqueSpec } from "./lib/constraint-names";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REGISTER_PATH = path.join(ROOT, "scripts", "constraint-names.allowlist.json");
const MEASURE = process.argv.includes("--measure");
const PRINT_REGISTER = process.argv.includes("--print-register");
const TAG = "[constraint-names]";

/**
 * VACUITY FLOORS. Both halves of the population come from code that can stop
 * matching without erroring — getTableConfig throws for non-tables (caught),
 * and a catalog query against the wrong database returns somebody else's
 * indexes. Measured 2026-10-07 on a repo-built database (732 tables): 89
 * declared uniques, 200 non-primary unique indexes.
 */
const DECLARED_FLOOR = 80;
const DB_UNIQUE_FLOOR = 150;

export const UNIQUES_SQL = `
  SELECT t.relname AS "table", i.relname AS "name",
         array_agg(a.attname::text ORDER BY k.ord) AS "columns"
    FROM pg_index x
    JOIN pg_class i ON i.oid = x.indexrelid
    JOIN pg_class t ON t.oid = x.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    CROSS JOIN LATERAL unnest(x.indkey) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
   WHERE n.nspname = 'public' AND x.indisunique AND NOT x.indisprimary
   GROUP BY t.relname, i.relname`;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(`${TAG} DATABASE_URL not set — this gate needs a database built from this repo.`);
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: url, max: 1 });
const { rows } = await pool.query<UniqueSpec>(UNIQUES_SQL);
await pool.end();

const declared = declaredUniques(schema as Record<string, unknown>);
const diff = diffUniqueNames(declared, rows);
const findings = [...diff.renamed, ...diff.missing];

if (PRINT_REGISTER) {
  console.log(JSON.stringify(findings.map(findingKey).sort(), null, 2));
  process.exit(0);
}

const register: { entries: string[] } = fs.existsSync(REGISTER_PATH)
  ? JSON.parse(fs.readFileSync(REGISTER_PATH, "utf8"))
  : { entries: [] };
const allowed = new Set(register.entries);
const unexplained = findings.filter((f) => !allowed.has(findingKey(f)));
const current = new Set(findings.map(findingKey));
const stale = register.entries.filter((e) => !current.has(e));

console.log(
  `${TAG} ${declared.length} declared unique(s) vs ${rows.length} unique index(es) in the database: ` +
    `${diff.ok.length} ok, ${diff.renamed.length} renamed, ${diff.missing.length} missing (${register.entries.length} registered)`,
);
let exitCode = 0;
const fail = (m: string) => {
  console.error(`${TAG} FAIL — ${m}`);
  exitCode = 1;
};
if (declared.length < DECLARED_FLOOR) fail(`only ${declared.length} declared uniques read (floor ${DECLARED_FLOOR}) — the schema walk is broken, not clean.`);
if (rows.length < DB_UNIQUE_FLOOR) fail(`only ${rows.length} unique indexes in the database (floor ${DB_UNIQUE_FLOOR}) — not a built AcreOS database.`);

for (const f of unexplained) {
  if ("actual" in f) {
    console.error(`  RENAMED  ${f.table}: schema declares "${f.name}", database has "${f.actual}" on (${f.columns.join(", ")})`);
  } else {
    console.error(`  MISSING  ${f.table}: schema declares "${f.name}" on (${f.columns.join(", ")}); the database enforces no uniqueness there`);
  }
}
if (MEASURE) process.exit(0);
if (unexplained.length > 0) {
  fail(
    `${unexplained.length} unique constraint(s) drift from shared/schema.ts (listed above). Fix the occurrence: name the ` +
      `schema's .unique("<what the migration creates>"), or add an idempotent rename/create to scripts/migrate.mjs. ` +
      `Do not add to ${path.relative(ROOT, REGISTER_PATH)}.`,
  );
}
if (stale.length > 0) {
  fail(`${stale.length} register entr(ies) no longer drift: ${stale.join(", ")}. Remove them — the register only shrinks.`);
}
if (exitCode === 0) console.log(`${TAG} PASS`);
process.exit(exitCode);

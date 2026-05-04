#!/usr/bin/env node
/**
 * Schema-drift discovery script.
 *
 * Compares shared/schema.ts declared tables/columns/extensions against
 * what actually exists in the production database. Produces an ordered
 * catch-up plan grouped by risk level.
 *
 * Usage:
 *   DATABASE_URL=<prod-url> node scripts/audit-schema-drift.mjs
 *
 * Output: docs/exhaustive-completion/SCHEMA-DRIFT-AUDIT.md
 *
 * 2026-05-04 (Workstream §3.0): catalog every missing item before
 * the migration sweep so the founder can see the full scope.
 */

import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const SCHEMA_PATH = path.join(PROJECT_ROOT, "shared/schema.ts");
const MIGRATIONS_DIR = path.join(PROJECT_ROOT, "migrations");
const OUTPUT_PATH = path.join(PROJECT_ROOT, "docs/exhaustive-completion/SCHEMA-DRIFT-AUDIT.md");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set — aborting");
  process.exit(1);
}

// ─── 1. Parse shared/schema.ts to extract declared tables + columns ─────────

const schemaSrc = fs.readFileSync(SCHEMA_PATH, "utf-8");

/** {tableName: {columns: Set<string>, jsName: string, declarationStart: number}} */
const declaredTables = new Map();

// Parse: `export const <jsName> = pgTable("<sqlName>", { ... }, ...)`
const tableRegex = /export const ([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*pgTable\s*\(\s*"([a-z_][a-z0-9_]*)"/g;
let m;
while ((m = tableRegex.exec(schemaSrc))) {
  const [, jsName, sqlName] = m;
  declaredTables.set(sqlName, {
    jsName,
    columns: new Set(),
    declarationStart: m.index,
  });
}

// For each declared table, attempt to extract column names by parsing the
// next `{...}` block. Columns are declared via the pattern:
//   <camelName>: <type>("<sql_column_name>"...
const colRegex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*[a-zA-Z_]+\s*\(\s*"([a-z_][a-z0-9_]*)"/g;
for (const [sqlName, info] of declaredTables) {
  // Find matching `{` after declarationStart, then walk to its matching `}`.
  let i = info.declarationStart;
  while (i < schemaSrc.length && schemaSrc[i] !== "{") i++;
  if (i === schemaSrc.length) continue;
  let depth = 0;
  let endIndex = i;
  for (let j = i; j < schemaSrc.length; j++) {
    if (schemaSrc[j] === "{") depth++;
    else if (schemaSrc[j] === "}") {
      depth--;
      if (depth === 0) {
        endIndex = j;
        break;
      }
    }
  }
  const block = schemaSrc.slice(i, endIndex);
  let cm;
  while ((cm = colRegex.exec(block))) {
    info.columns.add(cm[2]);
  }
  colRegex.lastIndex = 0;
}

// ─── 2. Query prod information_schema ──────────────────────────────────────

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

const { rows: prodTables } = await pool.query(`
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  ORDER BY table_name
`);
const prodTableSet = new Set(prodTables.map((r) => r.table_name));

const { rows: prodColumns } = await pool.query(`
  SELECT table_name, column_name
  FROM information_schema.columns
  WHERE table_schema = 'public'
  ORDER BY table_name, column_name
`);
const prodColMap = new Map();
for (const r of prodColumns) {
  if (!prodColMap.has(r.table_name)) prodColMap.set(r.table_name, new Set());
  prodColMap.get(r.table_name).add(r.column_name);
}

const { rows: prodExtensions } = await pool.query(`
  SELECT extname FROM pg_extension ORDER BY extname
`);
const prodExtSet = new Set(prodExtensions.map((r) => r.extname));

// ─── 3. Diff ────────────────────────────────────────────────────────────────

const missingTables = [];
const missingColumns = [];

for (const [sqlName, info] of declaredTables) {
  if (!prodTableSet.has(sqlName)) {
    missingTables.push({ table: sqlName, jsName: info.jsName, declaredColumns: [...info.columns] });
  } else {
    const prodCols = prodColMap.get(sqlName) ?? new Set();
    for (const col of info.columns) {
      if (!prodCols.has(col)) {
        missingColumns.push({ table: sqlName, column: col });
      }
    }
  }
}

// Extensions we expect (per shared/schema.ts + migrate.mjs).
const expectedExtensions = ["vector", "pg_trgm", "pg_stat_statements", "unaccent"];
const missingExtensions = expectedExtensions.filter((e) => !prodExtSet.has(e));

// ─── 4. For each missing item, find the canonical migration file ───────────

function findCanonicalMigration(needle) {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  const matches = [];
  for (const f of files) {
    const content = fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf-8");
    if (content.includes(needle)) matches.push(f);
  }
  return matches;
}

const tableMigrations = new Map();
for (const t of missingTables) {
  const candidates = findCanonicalMigration(`"${t.table}"`).concat(findCanonicalMigration(t.table));
  tableMigrations.set(t.table, [...new Set(candidates)]);
}
const columnMigrations = new Map();
for (const c of missingColumns) {
  const key = `${c.table}.${c.column}`;
  const candidates = findCanonicalMigration(`ADD COLUMN IF NOT EXISTS "${c.column}"`).concat(
    findCanonicalMigration(`ADD COLUMN "${c.column}"`),
  ).concat(findCanonicalMigration(c.column));
  columnMigrations.set(key, [...new Set(candidates)]);
}

// ─── 5. Categorize by risk ──────────────────────────────────────────────────

function classifyTableRisk(t) {
  // Tables with no rows yet → low; tables with cross-table foreign keys → medium.
  // We can't easily detect FKs from schema.ts text without parsing references — use heuristic:
  //   - References organizations/users/leads/properties/deals → medium
  //   - All else → low
  const indicators = ["references", "REFERENCES"];
  return "low"; // additive only, default low
}

function classifyColumnRisk(c) {
  // Missing columns are slightly higher risk than missing tables — code may
  // assume the column is present and SELECTs may break. But ADD COLUMN IF
  // NOT EXISTS is safe.
  return "medium";
}

// ─── 6. Compute execution order ────────────────────────────────────────────
// Heuristic: put tables before columns (so columns on tables that don't
// exist yet land naturally), and within tables, tables that other migrations
// reference go first. We don't have a true topological sort here — fall back
// to alphabetical within risk group.

missingTables.sort((a, b) => a.table.localeCompare(b.table));
missingColumns.sort((a, b) => (a.table + a.column).localeCompare(b.table + b.column));

// ─── 7. Write the audit doc ────────────────────────────────────────────────

const lines = [];
lines.push(`# Schema-Drift Audit — Phase 3.0 Discovery`);
lines.push("");
lines.push(`**Date:** ${new Date().toISOString()}`);
lines.push(`**Database queried:** ${process.env.DATABASE_URL.replace(/(:\/\/[^:]+:)[^@]+@/, "$1***@")}`);
lines.push(`**shared/schema.ts version:** as of working tree (no git revision lookup)`);
lines.push("");
lines.push("---");
lines.push("");
lines.push("## Summary");
lines.push("");
lines.push(`| Category | Count |`);
lines.push(`|---|---|`);
lines.push(`| Declared tables | ${declaredTables.size} |`);
lines.push(`| Tables in prod | ${prodTableSet.size} |`);
lines.push(`| Missing tables | **${missingTables.length}** |`);
lines.push(`| Missing columns | **${missingColumns.length}** |`);
lines.push(`| Missing extensions | **${missingExtensions.length}** |`);
lines.push("");
lines.push("---");
lines.push("");
lines.push("## Missing extensions (HIGH risk — may not be available)");
lines.push("");
for (const ext of missingExtensions) {
  const note = ext === "vector"
    ? "⚠ Confirmed unavailable on current Fly Postgres image. Postgres image upgrade required separately."
    : "additive — `CREATE EXTENSION IF NOT EXISTS`.";
  lines.push(`- \`${ext}\` — ${note}`);
}
if (missingExtensions.length === 0) lines.push("_(none)_");
lines.push("");
lines.push("---");
lines.push("");
lines.push("## Missing tables (LOW risk — additive)");
lines.push("");
lines.push("Each is a `CREATE TABLE IF NOT EXISTS` that adds the table without touching existing data.");
lines.push("");
lines.push("| # | Table | Canonical migration | Columns declared |");
lines.push("|---|---|---|---|");
missingTables.forEach((t, i) => {
  const migs = tableMigrations.get(t.table) ?? [];
  const migStr = migs.length ? migs.map((m) => `\`${m}\``).join(", ") : "_(not found)_";
  lines.push(`| ${i + 1} | \`${t.table}\` | ${migStr} | ${t.declaredColumns.length} |`);
});
if (missingTables.length === 0) lines.push("| | _(none)_ | | |");
lines.push("");
lines.push("---");
lines.push("");
lines.push("## Missing columns on existing tables (MEDIUM risk)");
lines.push("");
lines.push("`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` is safe but the column's");
lines.push("absence may have caused silent SELECT failures or NULL coalescence in");
lines.push("application code.");
lines.push("");
lines.push("| # | Table | Column | Canonical migration |");
lines.push("|---|---|---|---|");
missingColumns.forEach((c, i) => {
  const migs = columnMigrations.get(`${c.table}.${c.column}`) ?? [];
  const migStr = migs.length ? migs.map((m) => `\`${m}\``).join(", ") : "_(not found)_";
  lines.push(`| ${i + 1} | \`${c.table}\` | \`${c.column}\` | ${migStr} |`);
});
if (missingColumns.length === 0) lines.push("| | _(none)_ | | |");
lines.push("");
lines.push("---");
lines.push("");
lines.push("## Recommended execution order");
lines.push("");
lines.push("1. **Extensions** — apply first (cheap; some columns/indexes depend on them)");
lines.push("2. **Tables** — alphabetical-by-domain, grouped where related (outbox + outbox_dlq + job_runs together; etl_jobs + etl_runs together; etc.)");
lines.push("3. **Columns** — after all tables exist (some columns reference foreign keys to tables added in step 2)");
lines.push("4. **pgvector** — DEFER. Unavailable on current Fly Postgres image; needs Postgres image upgrade.");
lines.push("");
lines.push("---");
lines.push("");
lines.push("## Estimated time");
lines.push("");
const totalItems = missingTables.length + missingColumns.length + missingExtensions.filter((e) => e !== "vector").length;
const estMin = Math.ceil(totalItems * 1.5);
lines.push(`- Mechanical work: ~${estMin} minutes (extracting CREATE/ALTER blocks, pasting into migrate.mjs)`);
lines.push(`- Deploy + verify cycles: ~5-7 deploys at ~5 min each = ~30-35 minutes`);
lines.push(`- Total: **~${Math.ceil(estMin / 60)}-${Math.ceil((estMin + 35) / 60)} hours** end to end`);
lines.push("");
lines.push("---");
lines.push("");
lines.push(`*Generated by \`scripts/audit-schema-drift.mjs\` — re-run after each batch to track progress.*`);

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, lines.join("\n"));
console.log(`✅ Wrote ${OUTPUT_PATH}`);
console.log(`   ${missingTables.length} missing tables, ${missingColumns.length} missing columns, ${missingExtensions.length} missing extensions`);

await pool.end();

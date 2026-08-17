/**
 * Emit CREATE TABLE / CREATE INDEX DDL for schema tables that no migration
 * creates — the tool that produced the "83 db:push-only tables" block in
 * scripts/migrate.mjs (2026-08-17).
 *
 * WHY A GENERATOR AND NOT HAND-WRITTEN SQL. Those 83 tables existed in
 * production only because someone once ran `drizzle-kit push` by hand. `db:push`
 * does not run on deploy, so a database built from this repository did not have
 * them and every query against them would 500. Hand-transcribing 83 tables from
 * the ORM would have introduced exactly the drift the exercise was meant to
 * remove; introspecting Drizzle's own table config cannot.
 *
 * WHAT IT READS: the allowlist of known-missing tables, and shared/schema.ts via
 * getTableConfig — column types, nullability, defaults, single-column foreign
 * keys, composite primary keys, unique constraints and named indexes. Tables are
 * emitted in dependency order so the FKs resolve.
 *
 * KNOWN LIMITS, deliberately not papered over:
 *   - expression indexes are skipped (no column list to read);
 *   - multi-column foreign keys are skipped;
 *   - a `text[]` default must be a Postgres array literal, never jsonb — the
 *     first run emitted `'[]'::jsonb` for two tables and Postgres rejected the
 *     CREATE TABLE outright. Fixed here rather than patched by hand downstream.
 * Anything skipped simply does not appear, so verify output by EXECUTING it —
 * which is how those limits were found.
 *
 * USAGE
 *   npx tsx scripts/generate-schema-ddl.ts     # writes .gen-missing.{sql,js}
 * Then apply the .sql to a scratch database to prove it, and paste the .js into
 * the STATEMENTS array in scripts/migrate.mjs.
 *
 * The allowlist is empty as of 2026-08-17 (mirror gate reports zero gaps), so
 * this currently emits nothing. It is kept for the next time schema.ts gains a
 * table that no migration creates.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const at = (p: string) => path.join(ROOT, p);
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "../shared/schema";

const allow: string[] = JSON.parse(
  fs.readFileSync(at("scripts/schema-migrate-mirror.allowlist.json"), "utf8"),
).allowlist;
const want = new Set(allow);

// name -> drizzle table
const byName = new Map<string, any>();
for (const v of Object.values(schema as any)) {
  try {
    const cfg = getTableConfig(v as any);
    if (cfg?.name) byName.set(cfg.name, v);
  } catch {
    /* not a pgTable */
  }
}

const missing = allow.filter((t) => !byName.has(t));
if (missing.length) console.error("NOT FOUND IN SCHEMA:", missing.join(", "));

const q = (s: string) => `"${s}"`;

function defaultSql(col: any): string | null {
  const t = col.getSQLType().toLowerCase();
  if (t === "serial" || t === "bigserial" || t === "smallserial") return null;
  if (!col.hasDefault) return null;
  const d = col.default;
  if (d === undefined) return null;
  // drizzle sql`` object
  if (d && typeof d === "object" && Array.isArray(d.queryChunks)) {
    const parts = d.queryChunks
      .map((c: any) => (Array.isArray(c?.value) ? c.value.join("") : typeof c === "string" ? c : ""))
      .join("");
    return parts || null;
  }
  if (typeof d === "number") return String(d);
  if (typeof d === "boolean") return d ? "true" : "false";
  if (typeof d === "string") return `'${d.replace(/'/g, "''")}'`;
  if (Array.isArray(d) && t.endsWith("[]")) {
    // Postgres array literal, NOT jsonb — `text[] DEFAULT '[]'::jsonb` is a
    // type error and fails the CREATE TABLE outright.
    const inner = d
      .map((v) => `"${String(v).replace(/(["\\])/g, "\\$1")}"`)
      .join(",");
    return `'{${inner}}'::${t}`;
  }
  if (Array.isArray(d) || typeof d === "object") {
    return `'${JSON.stringify(d).replace(/'/g, "''")}'::jsonb`;
  }
  return null;
}

interface Gen {
  name: string;
  deps: Set<string>;
  create: string;
  indexes: string[];
}

const gens: Gen[] = [];

for (const name of allow) {
  const tbl = byName.get(name);
  if (!tbl) continue;
  const cfg = getTableConfig(tbl);
  const deps = new Set<string>();
  const lines: string[] = [];

  // inline FK per column where single-column
  const fkByCol = new Map<string, { table: string; col: string; onDelete?: string }>();
  for (const fk of cfg.foreignKeys) {
    const r = fk.reference();
    if (r.columns.length !== 1 || r.foreignColumns.length !== 1) continue;
    const ft = getTableConfig(r.foreignTable).name;
    fkByCol.set(r.columns[0].name, {
      table: ft,
      col: r.foreignColumns[0].name,
      onDelete: (fk as any).onDelete,
    });
    deps.add(ft);
  }

  for (const c of cfg.columns) {
    let line = `    ${q(c.name)} ${c.getSQLType()}`;
    if (c.primary) line += " PRIMARY KEY";
    if (c.notNull && !c.primary) line += " NOT NULL";
    const dv = defaultSql(c);
    if (dv) line += ` DEFAULT ${dv}`;
    const fk = fkByCol.get(c.name);
    if (fk) {
      line += ` REFERENCES ${q(fk.table)}(${q(fk.col)})`;
      if (fk.onDelete) line += ` ON DELETE ${fk.onDelete}`;
    }
    lines.push(line);
  }

  for (const pk of cfg.primaryKeys) {
    lines.push(`    PRIMARY KEY (${pk.columns.map((c: any) => q(c.name)).join(", ")})`);
  }
  for (const u of cfg.uniqueConstraints) {
    lines.push(`    UNIQUE (${u.columns.map((c: any) => q(c.name)).join(", ")})`);
  }

  const create = `CREATE TABLE IF NOT EXISTS ${q(name)} (\n${lines.join(",\n")}\n  )`;

  const indexes: string[] = [];
  for (const idx of cfg.indexes) {
    const cf: any = (idx as any).config;
    if (!cf?.columns?.length) continue;
    const cols = cf.columns
      .map((c: any) => (c?.name ? q(c.name) : null))
      .filter(Boolean);
    if (cols.length !== cf.columns.length) continue; // expression index — skip
    indexes.push(
      `CREATE ${cf.unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS ${q(cf.name)} ON ${q(name)} (${cols.join(", ")})`,
    );
  }

  gens.push({ name, deps, create, indexes });
}

// topological order among the generated set
const out: Gen[] = [];
const placed = new Set<string>();
let guard = 0;
while (out.length < gens.length && guard++ < 200) {
  for (const g of gens) {
    if (placed.has(g.name)) continue;
    const unmet = [...g.deps].filter((d) => want.has(d) && !placed.has(d) && d !== g.name);
    if (unmet.length === 0) {
      out.push(g);
      placed.add(g.name);
    }
  }
}
for (const g of gens) if (!placed.has(g.name)) out.push(g);

console.error(`generated ${out.length} tables, ${out.reduce((n, g) => n + g.indexes.length, 0)} indexes`);

const sqlOut = out
  .map((g) => `${g.create};\n${g.indexes.map((i) => i + ";").join("\n")}`)
  .join("\n\n");
fs.writeFileSync(at(".gen-missing.sql"), sqlOut);

const js = out
  .map((g) => {
    const parts = [`  \`${g.create}\`,`];
    for (const i of g.indexes) parts.push(`  \`${i}\`,`);
    return parts.join("\n");
  })
  .join("\n");
fs.writeFileSync(at(".gen-missing.js"), js);

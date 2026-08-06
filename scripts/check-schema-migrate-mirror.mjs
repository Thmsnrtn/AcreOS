#!/usr/bin/env node
// ============================================================================
// scripts/check-schema-migrate-mirror.mjs
// ----------------------------------------------------------------------------
// Schema→DDL mirror ratchet (audit F-05-2).
//
// WHY
// ───
// scripts/migrate.mjs (the Fly `release_command`) is authoritative for prod
// DDL, but it is only a PATCH layer — its own header says it applies
// "idempotent ALTER TABLE for columns that never got a proper Drizzle
// migration". The base tables live in migrations/*.sql. Nothing checks that a
// table declared in shared/schema.ts actually has a CREATE TABLE in EITHER
// place: a table added to schema.ts with no migration reaches prod only via
// `db:push` (which does NOT run in the deploy), so every SELECT on it 500s for
// all tenants until someone hand-patches the DDL. migrate.mjs's own comments
// record this exact incident happening repeatedly. `migrate-mirror-check.yml`
// only fires when a migrations/*.sql file changes, so a schema-only add has no
// tripwire. `validate-schema-column-refs` checks the TS side only.
//
// This is the audit's own selected wave-failure ("a schema table shipped with
// no migration — would 500 on deploy"). This gate converts it to CI.
//
// WHAT IT CHECKS
// ──────────────
// Every `pgTable("name", …)` in shared/schema.ts + shared/schema/*.ts must have
// a `CREATE TABLE [IF NOT EXISTS] "name"` somewhere in migrations/*.sql or
// scripts/migrate.mjs. A schema table with no such CREATE is a "gap".
//
// WHY A RATCHET, NOT A HARD GATE
// ──────────────────────────────
// ~165 tables are currently gap (created historically via db:push, never
// back-filled into a migration). Failing on all of them on day one would be
// `--no-verify`'d away. Instead the current gaps are frozen in
// scripts/schema-migrate-mirror.allowlist.json and the gate FAILS on:
//   - any NEW schema table with no CREATE (the deploy-500 regression), OR
//   - any STALE allowlist entry (a table that got a migration, or was deleted)
// so the count is bidirectional and can only shrink — same discipline as
// check-no-fabrication / the as-any ratchet. Back-filling a CREATE TABLE for a
// gapped table (or deleting the dead table) removes its allowlist entry.
//
// NOTE ON SCOPE: this is TABLE-level. Column-level drift (a new column on an
// existing table with no ALTER) is a real but noisier class — most columns on
// db:push'd tables are legitimately absent from migrations — and is left to
// the DB-backed `migrate.mjs --dry-run` gate (which needs a live DB, so it runs
// in the deploy pipeline, not here). This gate closes the highest-signal half.
//
//   node scripts/check-schema-migrate-mirror.mjs            # gate (CI)
//   node scripts/check-schema-migrate-mirror.mjs --measure  # list gaps, never fail
// ============================================================================

import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const SHARED_DIR = join(REPO_ROOT, "shared");
const MIGRATIONS_DIR = join(REPO_ROOT, "migrations");
const MIGRATE_MJS = join(REPO_ROOT, "scripts", "migrate.mjs");
const ALLOWLIST_PATH = join(__dirname, "schema-migrate-mirror.allowlist.json");

const MEASURE = process.argv.includes("--measure");
const UPDATE = process.argv.includes("--update-allowlist");

// ── schema pgTable names ────────────────────────────────────────────────────
function schemaFiles() {
  const files = [];
  const top = join(SHARED_DIR, "schema.ts");
  if (existsSync(top)) files.push(top);
  const dir = join(SHARED_DIR, "schema");
  if (existsSync(dir) && statSync(dir).isDirectory()) {
    for (const e of readdirSync(dir)) {
      if (!e.endsWith(".ts") || e.endsWith(".test.ts") || e.endsWith(".spec.ts")) continue;
      files.push(join(dir, e));
    }
  }
  return files.sort();
}

function collectSchemaTables() {
  const names = new Set();
  const re = /\bpgTable\s*\(\s*["'`]([a-zA-Z0-9_]+)["'`]/g;
  for (const f of schemaFiles()) {
    const src = readFileSync(f, "utf8");
    let m;
    while ((m = re.exec(src)) !== null) names.add(m[1]);
  }
  return names;
}

// ── migrated table names (CREATE TABLE in migrations/*.sql + migrate.mjs) ─────
function collectMigratedTables() {
  const names = new Set();
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?([a-zA-Z0-9_]+)["'`]?/gi;
  const sources = [];
  if (existsSync(MIGRATIONS_DIR) && statSync(MIGRATIONS_DIR).isDirectory()) {
    for (const e of readdirSync(MIGRATIONS_DIR)) {
      if (e.endsWith(".sql")) sources.push(join(MIGRATIONS_DIR, e));
    }
  }
  if (existsSync(MIGRATE_MJS)) sources.push(MIGRATE_MJS);
  for (const f of sources) {
    const src = readFileSync(f, "utf8");
    let m;
    while ((m = re.exec(src)) !== null) names.add(m[1]);
  }
  return names;
}

function loadAllowlist() {
  if (!existsSync(ALLOWLIST_PATH)) return new Set();
  try {
    const parsed = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
    const arr = Array.isArray(parsed) ? parsed : parsed.allowlist;
    return new Set(arr);
  } catch (err) {
    console.error(`[schema-migrate-mirror] allowlist not valid JSON: ${err.message}`);
    process.exit(1);
  }
}

function main() {
  const schemaTables = collectSchemaTables();
  const migrated = collectMigratedTables();
  const gaps = [...schemaTables].filter((t) => !migrated.has(t)).sort();

  if (MEASURE || UPDATE) {
    console.log(
      `[schema-migrate-mirror] schema tables: ${schemaTables.size}; migrated (CREATE TABLE in .sql/migrate.mjs): ${migrated.size}; GAP (no migration): ${gaps.length}`,
    );
    if (UPDATE) {
      writeFileSync(ALLOWLIST_PATH, JSON.stringify({ allowlist: gaps }, null, 2) + "\n");
      console.log(`[schema-migrate-mirror] wrote ${gaps.length} entries to allowlist.`);
    } else {
      for (const g of gaps) console.log(`  • ${g}`);
    }
    process.exit(0);
  }

  const allow = loadAllowlist();
  const gapSet = new Set(gaps);
  const newGaps = gaps.filter((t) => !allow.has(t));
  const staleAllow = [...allow].filter((t) => !gapSet.has(t));

  console.log(
    `[schema-migrate-mirror] schema tables: ${schemaTables.size}; gaps: ${gaps.length}; allowlisted: ${allow.size}; new: ${newGaps.length}; stale: ${staleAllow.length}`,
  );

  if (newGaps.length === 0 && staleAllow.length === 0) {
    console.log("[schema-migrate-mirror] PASS");
    process.exit(0);
  }

  if (newGaps.length > 0) {
    console.error("");
    console.error(
      `[schema-migrate-mirror] FAIL — ${newGaps.length} schema table(s) have NO CREATE TABLE in migrations/*.sql or scripts/migrate.mjs. On deploy they exist only if db:push was run (it is NOT run in prod), so every query 500s:`,
    );
    for (const t of newGaps) console.error(`  • ${t}`);
    console.error("");
    console.error(
      "Add a `CREATE TABLE IF NOT EXISTS \"<name>\" (...)` to scripts/migrate.mjs (or a migrations/*.sql), or delete the table if it is dead.",
    );
  }
  if (staleAllow.length > 0) {
    console.error("");
    console.error(
      `[schema-migrate-mirror] FAIL — ${staleAllow.length} stale allowlist entry(ies) (the table now has a migration, or was deleted). Remove them to tighten the ratchet:`,
    );
    for (const t of staleAllow) console.error(`  • ${t}`);
  }
  process.exit(1);
}

main();

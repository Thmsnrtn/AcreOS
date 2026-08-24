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
// 2026-08-17 — THE ALLOWLIST IS NOW EMPTY AND THE GATE REPORTS ZERO GAPS.
// Every table in shared/schema.ts can be created from this repository. The last
// 83 entries (db:push-only tables, frozen with no reasons recorded) were
// generated from the Drizzle definitions by scripts/generate-schema-ddl.ts and
// added to scripts/migrate.mjs, then PROVED by rebuilding a real PostgreSQL 16
// database from migrations/*.sql + migrate.mjs and diffing the resulting table
// list against shared/schema.ts: 746 of 746 present, zero unexpected failures.
//
// So this is a hard gate in practice now, and adding an entry back to the
// allowlist should be treated as a regression rather than routine — the ratchet
// machinery below stays because it is what got the count to zero, and because
// a stale entry must still fail loudly if a gap is ever closed another way.
//
// The history that motivated it: ~165 tables were gap at the start (created via
// db:push, never back-filled into a migration). Failing on all of them on day
// one would have been `--no-verify`'d away. Instead the gaps were frozen in
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
import { stripCommentsPreservingLines } from "./lib/strip-comments.mjs";
const REPO_ROOT = resolve(__dirname, "..");
const SHARED_DIR = join(REPO_ROOT, "shared");
const MIGRATIONS_DIR = join(REPO_ROOT, "migrations");
const MIGRATE_MJS = join(REPO_ROOT, "scripts", "migrate.mjs");
const ALLOWLIST_PATH = join(__dirname, "schema-migrate-mirror.allowlist.json");
const ORPHANS_PATH = join(__dirname, "schema-migrate-mirror.orphans.json");


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
    // STRIP COMMENTS FIRST — with the REPO'S stripper, not a hand-rolled one.
    //
    // Without any stripping the scan reads prose: a line reading
    // "-- see the CREATE TABLE above" contributed a table named `above`. That
    // matters beyond tidiness, because `migrated` is what the forward direction
    // subtracts from, so a COMMENT mentioning a table name can make a genuinely
    // missing migration look covered.
    //
    // The first attempt here used a naive `/\*[\s\S]*?\*\//` on migrate.mjs and
    // took its CREATE TABLE count from 434 to 44 — it MISPAIRED across the SQL
    // in that 612KB file and blanked 390 real statements, which would have
    // reported 223 phantom gaps. That is the precise failure CLAUDE.md records
    // ("a block-comment stripper that mispaired and blanked the very lines a
    // scan was counting"), and stripCommentsPreservingLines exists because of
    // it. SQL files get a line-comment strip only, which has no pairing to get
    // wrong.
    const raw = readFileSync(f, "utf8");
    const src = f.endsWith(".sql") ? raw.replace(/--[^\n]*/g, " ") : stripCommentsPreservingLines(raw);
    let m;
    re.lastIndex = 0;
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

/** Tables the ORM deliberately does not model, each with a written reason. */
function loadOrphanAllowlist() {
  if (!existsSync(ORPHANS_PATH)) return new Set();
  const parsed = JSON.parse(readFileSync(ORPHANS_PATH, "utf8"));
  return new Set(Object.keys(parsed.orphans ?? {}));
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

  // ── THE REVERSE DIRECTION (added 2026-08-23) ─────────────────────────────
  //
  // Everything above asks: does every table in shared/schema.ts have a
  // CREATE TABLE somewhere? That is the direction that 500s, so it was built
  // first and built well. It is also only HALF of "mirror".
  //
  // The other half — a table CREATEd by a migration that the ORM does not model
  // — has a different and quieter failure. It does not 500. It means the
  // database contains tables no code reads or writes, and that shared/schema.ts
  // is not a complete description of production. Found by standing up a real
  // Postgres and running the Fly release_command: `migrate.mjs` reported
  // `SKIPPED (dependency missing): CREATE TRIGGER emd_events_no_update_trg ...
  // relation "earnest_money_events" does not exist` against a database built
  // from schema.ts — and exited 0. That table is created by migrations 0085,
  // 0086 and 0239, is absent from schema.ts, and is read by nothing.
  //
  // Registered rather than dropped. Several of these hold data, and dropping a
  // production table is customer-data deletion — a founder-only hard stop
  // (CLAUDE.md). What belongs to engineering is knowing they exist and why.
  const orphans = [...migrated].filter((t) => !schemaTables.has(t)).sort();
  const orphanAllow = loadOrphanAllowlist();
  const orphanSet = new Set(orphans);
  const newOrphans = orphans.filter((t) => !orphanAllow.has(t));
  const staleOrphans = [...orphanAllow].filter((t) => !orphanSet.has(t));

  const allow = loadAllowlist();
  const gapSet = new Set(gaps);
  const newGaps = gaps.filter((t) => !allow.has(t));
  const staleAllow = [...allow].filter((t) => !gapSet.has(t));

  console.log(
    `[schema-migrate-mirror] schema tables: ${schemaTables.size}; gaps: ${gaps.length}; allowlisted: ${allow.size}; new: ${newGaps.length}; stale: ${staleAllow.length}`,
  );
  console.log(
    `[schema-migrate-mirror] reverse: DDL tables the ORM does not model: ${orphans.length}; registered: ${orphanAllow.size}; new: ${newOrphans.length}; stale: ${staleOrphans.length}`,
  );

  if (newOrphans.length > 0) {
    console.error("");
    console.error(
      `[schema-migrate-mirror] FAIL — ${newOrphans.length} table(s) are CREATEd by a migration but declared nowhere in shared/schema.ts. They will exist in the database with no code reading or writing them, and a rebuild from schema.ts will not contain them:`,
    );
    for (const t of newOrphans) console.error(`  • ${t}`);
    console.error("");
    console.error(
      "Model it in shared/schema.ts if the app should own it, or register it in " +
        "scripts/schema-migrate-mirror.orphans.json WITH A REASON. Do NOT drop a production " +
        "table to satisfy this — that is customer-data deletion, and founder-only.",
    );
  }
  if (staleOrphans.length > 0) {
    console.error("");
    console.error(
      `[schema-migrate-mirror] FAIL — ${staleOrphans.length} stale orphan registration(s) (now modelled in schema.ts, or the migration is gone). Remove them to tighten the ratchet:`,
    );
    for (const t of staleOrphans) console.error(`  • ${t}`);
  }

  if (newGaps.length === 0 && staleAllow.length === 0 && newOrphans.length === 0 && staleOrphans.length === 0) {
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

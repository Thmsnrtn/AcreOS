/**
 * Schema ↔ migration drift ratchet (2026-07 DB audit; debt closed 2026-08-17).
 *
 * This repo's only migration path is scripts/migrate.mjs (idempotent SQL,
 * run as Fly's release_command) — the drizzle journal was retired 2026-05-11.
 * The audit found ~95 tables defined in shared/schema*.ts with NO CREATE
 * TABLE anywhere: on a fresh database the first SELECT against any of them
 * 500s (this bit prod once already — see migrate.mjs's own header).
 *
 * ALL OF THEM NOW HAVE ONE. The baseline below is empty, and a clean two-pass
 * rebuild against a real PostgreSQL 16 produces every table the schema
 * declares. The rules:
 *   1. A NEW pgTable must ship with a CREATE TABLE in migrations/ or
 *      migrate.mjs — the first test fails the moment one doesn't.
 *   2. When an orphan gets its migration (or is deleted), remove it from
 *      the baseline — the second test forces the shrink to be locked in.
 */

import { describe, it, expect, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
// This gate walks the source tree; its cost scales with the repo, and under the
// coverage run it does not fit the suite’s 30s default. A killed gate reports
// nothing about what it guards, so the budget is declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });


const ROOT = resolve(__dirname, "../..");

function schemaTableNames(): Set<string> {
  const files = [resolve(ROOT, "shared/schema.ts")];
  for (const f of readdirSync(resolve(ROOT, "shared/schema"))) {
    if (f.endsWith(".ts")) files.push(resolve(ROOT, "shared/schema", f));
  }
  const names = new Set<string>();
  const re = /pgTable\(\s*["']([a-z0-9_]+)["']/g;
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) names.add(m[1]);
  }
  return names;
}

function createdTableNames(): Set<string> {
  const files = [resolve(ROOT, "scripts/migrate.mjs")];
  for (const f of readdirSync(resolve(ROOT, "migrations"))) {
    if (f.endsWith(".sql")) files.push(resolve(ROOT, "migrations", f));
  }
  const names = new Set<string>();
  const re = /CREATE TABLE (?:IF NOT EXISTS )?"?([a-z0-9_]+)"?/gi;
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) names.add(m[1].toLowerCase());
  }
  return names;
}

// ── HISTORICAL DEBT: CLOSED 2026-08-17 ──────────────────────────────────────
// This baseline was frozen at 95 tables on 2026-07-04 and stood at 83. It is
// now EMPTY: every table in shared/schema*.ts has a CREATE TABLE in
// migrations/ or scripts/migrate.mjs.
//
// The 83 existed in production only because someone once ran `drizzle-kit push`
// by hand; `db:push` does not run on deploy, so a database built from this
// repository simply lacked them. Their DDL was generated from the Drizzle
// definitions (scripts/generate-schema-ddl.ts) and proved by rebuilding a real
// PostgreSQL 16 database and diffing the resulting table list against the
// schema: 746 of 746 present.
//
// The rules are unchanged, and the first one now has no exceptions at all: a
// new pgTable must ship with a CREATE TABLE. Adding an entry back here is a
// regression, not routine.
//
// NOTE — this is the SECOND register of the same debt. The first is
// scripts/schema-migrate-mirror.allowlist.json, driven by
// check-schema-migrate-mirror.mjs, which is also now empty. Two independent
// scanners agreeing on zero is worth more than one, so both are kept; they read
// the corpus differently (this one parses pgTable names, that one resolves
// through shared/schema/*.ts) and a bug in either would show up as disagreement
// rather than as silence.
const BASELINE_ORPHANS = new Set<string>([]);

describe("schema ↔ migration drift ratchet", () => {
  const schema = schemaTableNames();
  const created = createdTableNames();
  const orphans = [...schema].filter((t) => !created.has(t));

  it("every NEW pgTable ships with a CREATE TABLE migration", () => {
    const newOrphans = orphans.filter((t) => !BASELINE_ORPHANS.has(t));
    expect(
      newOrphans,
      `tables defined in shared/schema*.ts with NO migration (add a CREATE TABLE to scripts/migrate.mjs + migrations/): ${newOrphans.join(", ")}`,
    ).toEqual([]);
  });

  it("baseline only shrinks — remove entries whose migrations landed", () => {
    const stale = [...BASELINE_ORPHANS].filter((t) => !orphans.includes(t));
    expect(
      stale,
      `baseline entries no longer orphaned (migration landed or table deleted) — remove them: ${stale.join(", ")}`,
    ).toEqual([]);
  });

  it("sanity: the scanner actually finds tables on both sides", () => {
    expect(schema.size).toBeGreaterThan(500);
    expect(created.size).toBeGreaterThan(400);
  });
});

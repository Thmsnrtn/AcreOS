/**
 * Schema-drift detector — fails CI when a NEW column is declared in
 * shared/schema*.ts but no SQL migration creates it.
 *
 * Why this exists: on 2026-05-27 the Today tab broke for every
 * authenticated user because three ATR columns were added to `notes`
 * in the schema without a corresponding ALTER TABLE migration.
 * Drizzle's default SELECT pulls every declared column, so any
 * "PG: column does not exist" cascades into a 500 on every endpoint
 * that touches the table.
 *
 * The codebase has 642 pre-existing drift cases (tables that grew
 * columns over time without migrations). Those are captured in
 * tests/unit/schemaDrift.allowlist.json as a known-debt baseline.
 * The test fails on any drift NOT in that file — i.e. NEW drift
 * introduced after this gate landed.
 *
 * To resolve a failure:
 *  - PREFERRED: add an idempotent `ALTER TABLE "<table>" ADD COLUMN
 *    IF NOT EXISTS "<col>" <type>` to scripts/migrate.mjs (it runs
 *    as Fly's release_command before traffic hits the new image), or
 *    ship a new migrations/NNNN_*.sql.
 *  - ESCAPE HATCH: if the column legitimately must not be in the DB
 *    yet (e.g. you're staging a multi-step change), add the entry
 *    to schemaDrift.allowlist.json with a comment in the PR.
 *
 * This is a pure-static test — no Postgres required.
 */

import { describe, it, expect, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import { readFileSync, readdirSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
// This gate walks the source tree; its cost scales with the repo, and under the
// coverage run it does not fit the suite’s 30s default. A killed gate reports
// nothing about what it guards, so the budget is declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });


const REPO_ROOT = join(import.meta.dirname, "..", "..");
const SCHEMA_FILES = [
  "shared/schema.ts",
  ...readdirSync(join(REPO_ROOT, "shared/schema")).map((f) => `shared/schema/${f}`),
];

const DRIZZLE_COL_TYPES = [
  "text", "varchar", "integer", "serial", "bigserial", "bigint", "smallint",
  "numeric", "decimal", "real", "doublePrecision", "boolean", "timestamp",
  "date", "time", "jsonb", "json", "uuid", "char", "inet", "interval",
];

/**
 * Pre-existing drift captured 2026-05-27. Each entry is "table.column".
 * NEW columns added after this snapshot must ship with a migration.
 * Burn this list down as migrations land — every removed entry is a
 * gap closed in prod.
 *
 * The file is keyed as a flat array of "table.column" strings; loaded
 * lazily so a missing file (first run) writes a snapshot rather than
 * blowing up the test.
 */
const ALLOWLIST_PATH = join(import.meta.dirname, "schemaDrift.allowlist.json");

function loadAllowlist(): Set<string> {
  if (!existsSync(ALLOWLIST_PATH)) return new Set();
  const raw = readFileSync(ALLOWLIST_PATH, "utf-8");
  try {
    const parsed = JSON.parse(raw) as { entries: string[] };
    return new Set(parsed.entries);
  } catch {
    return new Set();
  }
}

interface DeclaredColumn {
  table: string;
  column: string;
  schemaFile: string;
  line: number;
}

/**
 * Parse a schema TS file and pull every (table, column) pair declared
 * via the Drizzle pgTable + col-helper pattern.
 *
 * Matches:
 *   export const myTable = pgTable("my_table", {
 *     someCol: text("some_col")...,
 *     other: integer("other_col").notNull(),
 *   }, ...);
 */
function parseSchemaFile(relPath: string): DeclaredColumn[] {
  const content = readFileSync(join(REPO_ROOT, relPath), "utf-8");
  const lines = content.split("\n");
  const out: DeclaredColumn[] = [];

  // First pass: find each pgTable(...) block. We need the table name
  // and the line range so we can scope column scanning correctly. A
  // single file declares many tables back-to-back.
  //
  // The table name can appear on the SAME line as `pgTable(`:
  //     export const t = pgTable("my_table", {
  // OR on the FOLLOWING line (the prevailing multi-line style in
  // shared/schema.ts):
  //     export const t = pgTable(
  //       "my_table",
  //       { ... }
  // A single-line-only regex silently MISSES every multi-line table,
  // which then mis-attributes that table's columns to the previous
  // single-line table and floods the report with phantom drift. So we
  // anchor on `pgTable(` and pull the first quoted identifier that
  // follows within a short window.
  const tableStarts: { table: string; startLine: number }[] = [];
  const pgTableOpenRe = /pgTable\(/;
  const tableNameRe = /^\s*"([a-z_][a-z0-9_]*)"\s*,/;
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(pgTableOpenRe);
    if (!open) continue;
    // Same line: pgTable("name", ...
    const sameLine = lines[i].match(/pgTable\(\s*"([a-z_][a-z0-9_]*)"\s*,/);
    if (sameLine) {
      tableStarts.push({ table: sameLine[1], startLine: i });
      continue;
    }
    // Multi-line: the name is the first quoted identifier on a
    // following line (skip blank/comment-only lines in between).
    for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
      const nm = lines[j].match(tableNameRe);
      if (nm) {
        tableStarts.push({ table: nm[1], startLine: i });
        break;
      }
      // Stop scanning if we hit something that clearly isn't the name
      // (a column declaration means we overshot).
      if (/^\s*[a-zA-Z]/.test(lines[j]) && !/^\s*"/.test(lines[j])) break;
    }
  }

  // For each pgTable block, scan forward until the brace at column 0
  // closes the object — Drizzle's convention is the closing `}` of the
  // column dict appearing on its own line or as `}, (table) => [`.
  for (let t = 0; t < tableStarts.length; t++) {
    const { table, startLine } = tableStarts[t];
    const nextStart =
      t + 1 < tableStarts.length ? tableStarts[t + 1].startLine : lines.length;
    // End the scan at either the next pgTable or a line that closes the
    // declaration. We use the next-pgTable boundary primarily; the brace
    // logic gets noisy with nested object types ($type<{...}>()).
    const colRe = new RegExp(
      `\\b(${DRIZZLE_COL_TYPES.join("|")})\\(\\s*"([a-z_][a-z0-9_]*)"`,
    );
    for (let i = startLine; i < nextStart; i++) {
      const m = lines[i].match(colRe);
      if (m) {
        out.push({ table, column: m[2], schemaFile: relPath, line: i + 1 });
      }
    }
  }

  return out;
}

/**
 * Collect every (table, column) pair that any migration creates or adds.
 * Reads:
 *   - migrations/*.sql  (CREATE TABLE + ALTER TABLE ADD COLUMN)
 *   - scripts/migrate.mjs  (idempotent ADD COLUMN IF NOT EXISTS bag)
 */
function collectMigratedColumns(): Set<string> {
  const out = new Set<string>(); // "table.column" keyed
  const migDir = join(REPO_ROOT, "migrations");
  const sqlFiles = readdirSync(migDir).filter((f) => f.endsWith(".sql"));

  /**
   * Parse one SQL-ish source string. Used for both *.sql files and the
   * mjs migration bag (template literals + ALTER strings live there too).
   *
   * Both quoted ("name") and unquoted (name) identifiers are accepted —
   * different migrations in this repo use different styles.
   */
  function ingest(sql: string) {
    // Identifier: bare or double-quoted. Capture group 1 = name.
    const id = `(?:"([a-z_][a-z0-9_]*)"|([a-z_][a-z0-9_]*))`;
    // Postgres column-type tokens we recognize. The set has to match the
    // declared-column scanner above; if the body of a CREATE TABLE uses
    // a type we don't list here, that column gets dropped silently.
    const typeTok =
      "(?:serial|bigserial|smallserial|text|integer|int|int4|int8|varchar|character|numeric|decimal|boolean|bool|timestamp|timestamptz|date|time|jsonb|json|uuid|bigint|smallint|real|double|float4|float8|char|inet|interval)";

    // CREATE TABLE [IF NOT EXISTS] <id> ( body )
    //
    // We can't capture the body with a non-greedy `\(([\s\S]*?)\)` because
    // column declarations contain NESTED parens — `REFERENCES orgs(id)`,
    // `numeric(12,2)`, `DEFAULT now()` — and the first `)` would truncate
    // the body, dropping most columns and producing phantom drift. Instead
    // we locate the opening paren and walk forward counting paren depth to
    // find the matching close, so the full multi-column body is captured.
    const headRe = new RegExp(
      `CREATE TABLE(?:\\s+IF NOT EXISTS)?\\s+${id}\\s*\\(`,
      "gi",
    );
    let m: RegExpExecArray | null;
    while ((m = headRe.exec(sql))) {
      const table = m[1] ?? m[2];
      // m.index..headRe.lastIndex points just past the opening "(".
      const bodyStart = headRe.lastIndex;
      let depth = 1;
      let k = bodyStart;
      for (; k < sql.length && depth > 0; k++) {
        const ch = sql[k];
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
      }
      const body = sql.slice(bodyStart, k - 1);
      // Each top-level column declaration: id <type>
      const colRe = new RegExp(
        `(?:^|,)\\s*(?:"([a-z_][a-z0-9_]*)"|([a-z_][a-z0-9_]*))\\s+${typeTok}\\b`,
        "gi",
      );
      let cm: RegExpExecArray | null;
      while ((cm = colRe.exec(body))) {
        const col = cm[1] ?? cm[2];
        // Skip SQL keywords that can lead a constraint line and accidentally
        // look like an identifier in our regex (CONSTRAINT, PRIMARY, FOREIGN,
        // UNIQUE, CHECK). The trailing type-token gate already rules most of
        // these out; this is belt-and-suspenders.
        if (
          ["constraint", "primary", "foreign", "unique", "check"].includes(
            col.toLowerCase(),
          )
        )
          continue;
        out.add(`${table}.${col}`);
      }
    }

    // ALTER TABLE <id> ADD COLUMN [IF NOT EXISTS] <id> [, ADD COLUMN ...]
    //
    // A single ALTER TABLE may chain MANY comma-separated ADD COLUMN
    // clauses against the same table:
    //   ALTER TABLE acquired_notes
    //     ADD COLUMN IF NOT EXISTS a INTEGER,
    //     ADD COLUMN IF NOT EXISTS b BOOLEAN,
    //     ADD COLUMN IF NOT EXISTS c JSONB;
    // Matching only `ALTER TABLE <id> ADD COLUMN <id>` would capture just
    // the first column and flag the rest as phantom drift. So we first
    // locate the ALTER TABLE + table name, then sweep every ADD COLUMN
    // clause up to the terminating `;`.
    const alterHeadRe = new RegExp(`ALTER TABLE\\s+${id}\\s+`, "gi");
    while ((m = alterHeadRe.exec(sql))) {
      const table = m[1] ?? m[2];
      // The statement runs from here to the next semicolon.
      const semi = sql.indexOf(";", alterHeadRe.lastIndex);
      const stmt = sql.slice(
        m.index,
        semi === -1 ? sql.length : semi,
      );
      const addColRe = new RegExp(
        `ADD COLUMN(?:\\s+IF NOT EXISTS)?\\s+${id}`,
        "gi",
      );
      let cm: RegExpExecArray | null;
      while ((cm = addColRe.exec(stmt))) {
        const col = cm[1] ?? cm[2];
        out.add(`${table}.${col}`);
      }
    }
  }

  for (const f of sqlFiles) {
    ingest(readFileSync(join(migDir, f), "utf-8"));
  }
  ingest(readFileSync(join(REPO_ROOT, "scripts/migrate.mjs"), "utf-8"));

  return out;
}

describe("schema-drift detector", () => {
  it("no NEW columns are added to existing tables without a migration", () => {
    // Scope: only "live" tables (ones migrations actually touched). A
    // table that exists in the schema but was never CREATE TABLE'd is
    // out of scope here — bad, but bounded (nothing queries it
    // successfully so the blast radius is limited).

    const declared: DeclaredColumn[] = [];
    for (const f of SCHEMA_FILES) declared.push(...parseSchemaFile(f));

    const migrated = collectMigratedColumns();
    const liveTables = new Set<string>();
    for (const key of migrated) liveTables.add(key.split(".")[0]);

    const currentDrift = declared.filter((d) => {
      if (!liveTables.has(d.table)) return false;
      return !migrated.has(`${d.table}.${d.column}`);
    });

    // If the allowlist file does not exist yet, write a snapshot and
    // exit clean — first-run bootstrap. Subsequent runs compare against
    // it and fail for any NEW entry.
    if (!existsSync(ALLOWLIST_PATH)) {
      const entries = currentDrift
        .map((d) => `${d.table}.${d.column}`)
        .sort();
      writeFileSync(
        ALLOWLIST_PATH,
        JSON.stringify(
          {
            description:
              "Pre-existing schema/migration drift, snapshotted on first " +
              "run of tests/unit/schemaDrift.test.ts. Each entry is a " +
              '"table.column" pair declared in shared/schema*.ts that no ' +
              "migration creates. The drift detector fails for any new " +
              "entry. Burn this list down by shipping migrations.",
            entries: Array.from(new Set(entries)),
          },
          null,
          2,
        ),
      );
      // Snapshot just written — pass for this run.
      return;
    }

    const allowlist = loadAllowlist();
    const newDrift = currentDrift.filter(
      (d) => !allowlist.has(`${d.table}.${d.column}`),
    );

    if (newDrift.length > 0) {
      const grouped = newDrift.reduce<Record<string, DeclaredColumn[]>>(
        (acc, m) => {
          (acc[m.table] ||= []).push(m);
          return acc;
        },
        {},
      );
      const report = Object.entries(grouped)
        .map(([t, cols]) => {
          const lines = cols
            .map((c) => `    - ${c.column}  (${c.schemaFile}:${c.line})`)
            .join("\n");
          return `  ${t}:\n${lines}`;
        })
        .join("\n");
      const hint =
        "\n\nFix one of:\n" +
        "  1. PREFERRED — add an idempotent `ALTER TABLE \"<table>\" ADD " +
        'COLUMN IF NOT EXISTS "<col>" <type>` to scripts/migrate.mjs ' +
        "(runs as Fly release_command before traffic hits the new image), " +
        "or ship a migrations/NNNN_*.sql.\n" +
        "  2. ESCAPE HATCH — add the entry to tests/unit/" +
        "schemaDrift.allowlist.json with a PR comment explaining why.";
      throw new Error(
        `New schema drift detected: ${newDrift.length} column(s) declared ` +
          `in shared/schema*.ts but no migration creates them, and they are ` +
          `not in the allowlist:\n${report}${hint}`,
      );
    }

    expect(newDrift).toEqual([]);
  });
});

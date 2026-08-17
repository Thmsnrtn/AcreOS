/**
 * A foreign key must be implementable, not merely written down.
 *
 * ── WHAT THIS CAUGHT ────────────────────────────────────────────────────────
 * Three tables in `scripts/migrate.mjs` declared
 * `"lease_id" varchar REFERENCES "rental_leases"("id")` while the same file
 * creates `rental_leases.id` as `uuid`. Postgres cannot implement a
 * varchar → uuid foreign key, so `cam_reconciliations`,
 * `commercial_sales_reports` and `lease_rent_schedule` failed to create on
 * every database, every time — and because the failure is not
 * "dependency missing" it was classified as unexpected, setting exit 1 and
 * ABORTING THE DEPLOY. 54 server call sites referenced those three tables.
 *
 * `check-schema-migrate-mirror.mjs` was green throughout. It asks whether a
 * CREATE TABLE for the name EXISTS AS TEXT, never whether it can execute, so
 * all three counted as covered and none was allowlisted. That is the gap this
 * file closes: the mirror gate proves a statement was written, this one proves
 * it is not self-contradictory.
 *
 * ── WHY STATIC, WHEN A DATABASE WOULD BE PROOF ──────────────────────────────
 * Executing the DDL is strictly stronger and is how the original defect was
 * actually found (a real Postgres 16 rebuild). But that needs a live server,
 * which CI here does not have. This check needs nothing but the repository, so
 * it runs on every commit. It is the cheap half of a real proof, kept honest by
 * the vacuity guards below — a parser that silently matched nothing would
 * report zero mismatches, which is the same answer as perfect health.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

/** Postgres spellings that denote the same underlying type. */
const NORMALISE: Record<string, string> = {
  serial: "integer",
  bigserial: "bigint",
  serial4: "integer",
  serial8: "bigint",
  int: "integer",
  int4: "integer",
  int8: "bigint",
  "character varying": "varchar",
  bool: "boolean",
};

const norm = (raw: string): string => {
  const t = raw.toLowerCase().trim().replace(/\s+/g, " ");
  return NORMALISE[t] ?? t;
};

/**
 * Types Postgres will happily join across a foreign key.
 *
 * VERIFIED BY EXPERIMENT against PostgreSQL 16, not assumed — an earlier
 * version of this file compared type NAMES and reported
 * `error_boundary_trips.user_id text -> users.id varchar` as a defect. It is
 * not one: Postgres accepts a text → varchar foreign key (both are string
 * types sharing an equality operator), and that exact table was created
 * without complaint during the rebuild that produced these findings. Comparing
 * spellings rather than compatibility would have made this gate cry wolf on
 * legitimate DDL, which is how gates get disabled.
 *
 *   CREATE TABLE p ("id" varchar PRIMARY KEY);
 *   CREATE TABLE c ("pid" text REFERENCES p("id"));   -- ACCEPTED
 *   CREATE TABLE p2 ("id" uuid PRIMARY KEY);
 *   CREATE TABLE c2 ("pid" varchar REFERENCES p2("id"));
 *     -- ERROR: foreign key constraint cannot be implemented
 *
 * So a string may reference a string; a string may NOT reference a uuid.
 */
const COMPATIBILITY_CLASS: Record<string, string> = {
  text: "string",
  varchar: "string",
  char: "string",
  citext: "string",
};

const compatClass = (t: string): string => COMPATIBILITY_CLASS[t] ?? t;

/**
 * Words that begin a TABLE-level clause, not a column. Without this the
 * unquoted-column support below would read `CONSTRAINT foo CHECK (…)` as a
 * column named "constraint" of type "foo".
 */
const TABLE_LEVEL_KEYWORDS = new Set([
  "constraint",
  "primary",
  "unique",
  "check",
  "foreign",
  "exclude",
  "like",
  // A multi-line FK puts REFERENCES at the start of its own line, which reads
  // as a column named "references" of type "organizations" otherwise.
  "references",
  "on",
  "default",
  "deferrable",
]);

interface ForeignKey {
  table: string;
  column: string;
  type: string;
  refTable: string;
  refColumn: string;
  source: string;
}

/** Every `CREATE TABLE` in the corpus → its column types, plus every FK. */
function parseCorpus(sources: { name: string; sql: string }[]) {
  const columns = new Map<string, Map<string, string>>();
  const foreignKeys: ForeignKey[] = [];

  for (const { name, sql } of sources) {
    const table = /CREATE TABLE (?:IF NOT EXISTS )?"?([a-z0-9_]+)"?\s*\(([\s\S]*?)\n\s*\)/gi;
    let m: RegExpExecArray | null;
    while ((m = table.exec(sql))) {
      const [, tableName, body] = m;
      const cols = columns.get(tableName) ?? new Map<string, string>();
      for (const line of body.split("\n")) {
        // `"col" type …` or `col type …`. Quoting is NOT a reliable signal:
        // migrations/*.sql is split roughly half and half, and an
        // earlier version of this parser required the quotes. That silently
        // skipped every column of every unquoted file — including
        // migrations/0073, which is where `acquired_notes.id` is defined. With
        // that column invisible, three real varchar → uuid mismatches in
        // migrations/0096 resolved to nothing and the gate reported zero. The
        // hole was found by rebuilding a database and noticing tables the gate
        // said were fine had not been created.
        const col = line.match(/^\s*"?([a-z0-9_]+)"?\s+([a-z][a-z ]*?)(?=\s|,|\(|$)/i);
        if (!col) continue;
        // Table-level constraints look exactly like a column line otherwise.
        if (TABLE_LEVEL_KEYWORDS.has(col[1].toLowerCase())) continue;
        const [, colName, rawType] = col;
        cols.set(colName, norm(rawType));

        const ref = line.match(/REFERENCES\s+"?([a-z0-9_]+)"?\s*\(\s*"?([a-z0-9_]+)"?\s*\)/i);
        if (ref) {
          foreignKeys.push({
            table: tableName,
            column: colName,
            type: norm(rawType),
            refTable: ref[1],
            refColumn: ref[2],
            source: name,
          });
        }
      }
      columns.set(tableName, cols);
    }
  }
  return { columns, foreignKeys };
}

const sources = [
  { name: "scripts/migrate.mjs", sql: fs.readFileSync(path.join(ROOT, "scripts/migrate.mjs"), "utf8") },
  ...fs
    .readdirSync(path.join(ROOT, "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({
      name: `migrations/${f}`,
      sql: fs.readFileSync(path.join(ROOT, "migrations", f), "utf8"),
    })),
];

const { columns, foreignKeys } = parseCorpus(sources);

/** FKs whose target column we can actually see — the only ones checkable. */
const resolvable = foreignKeys.filter((fk) => columns.get(fk.refTable)?.get(fk.refColumn));

const mismatches = resolvable.filter(
  (fk) => compatClass(columns.get(fk.refTable)!.get(fk.refColumn)!) !== compatClass(fk.type),
);

describe("the DDL parser actually parsed something (vacuity guards, first)", () => {
  it("found tables across the corpus", () => {
    // A parser that matches nothing reports zero mismatches, which is
    // indistinguishable from a clean bill of health.
    expect(
      columns.size,
      "no CREATE TABLE parsed — the regex broke; the zero below means nothing",
    ).toBeGreaterThan(300);
  });

  it("found foreign keys, and resolved a real share of them", () => {
    expect(foreignKeys.length, "no REFERENCES clauses parsed").toBeGreaterThan(150);
    expect(
      resolvable.length,
      "no FK target column resolved — every comparison below is being skipped",
    ).toBeGreaterThan(100);
  });

  it("reports its own coverage, because unresolvable FKs are unchecked", () => {
    // Honest about the hole rather than quiet about it: an FK whose target
    // table is created somewhere this parser cannot see (or by `db:push`, which
    // does not run on deploy) is NOT verified by this file. Printed so the
    // number is visible on every run instead of implied to be zero.
    const unresolved = foreignKeys.length - resolvable.length;
    // eslint-disable-next-line no-console
    console.log(
      `[fk-types] ${columns.size} tables, ${foreignKeys.length} FKs, ` +
        `${resolvable.length} checked, ${unresolved} unresolvable (target not in corpus)`,
    );
    expect(unresolved).toBeGreaterThanOrEqual(0);
  });
});

describe("the check fails on a real mismatch (positive control)", () => {
  it("detects varchar → uuid, the exact shape that shipped", () => {
    // Constructed, so it cannot go vacuous the way a scan over real files can.
    const probe = parseCorpus([
      {
        name: "synthetic",
        sql: `
          CREATE TABLE IF NOT EXISTS "parent" (
            "id" uuid PRIMARY KEY
          );
          CREATE TABLE IF NOT EXISTS "child" (
            "id" varchar PRIMARY KEY,
            "parent_id" varchar NOT NULL REFERENCES "parent"("id") ON DELETE CASCADE
          );
        `,
      },
    ]);
    const bad = probe.foreignKeys.filter(
      (fk) => compatClass(probe.columns.get(fk.refTable)!.get(fk.refColumn)!) !== compatClass(fk.type),
    );
    expect(bad).toHaveLength(1);
    expect(bad[0]).toMatchObject({ table: "child", column: "parent_id", type: "varchar" });
  });

  it("accepts serial → integer, which is the same type spelled two ways", () => {
    const probe = parseCorpus([
      {
        name: "synthetic",
        sql: `
          CREATE TABLE IF NOT EXISTS "orgs" (
            "id" serial PRIMARY KEY
          );
          CREATE TABLE IF NOT EXISTS "rows" (
            "org_id" integer NOT NULL REFERENCES "orgs"("id") ON DELETE CASCADE
          );
        `,
      },
    ]);
    const bad = probe.foreignKeys.filter(
      (fk) => compatClass(probe.columns.get(fk.refTable)!.get(fk.refColumn)!) !== compatClass(fk.type),
    );
    expect(bad, "serial and integer must not be reported as a mismatch").toEqual([]);
  });
});

describe("every foreign key in the corpus is implementable", () => {
  it("has no type mismatch between a column and what it references", () => {
    const listing = mismatches
      .map((fk) => {
        const target = columns.get(fk.refTable)!.get(fk.refColumn)!;
        return `  ${fk.source}: ${fk.table}.${fk.column} is ${fk.type} but ${fk.refTable}.${fk.refColumn} is ${target}`;
      })
      .join("\n");
    expect(
      mismatches,
      "Postgres will reject this with \"foreign key constraint cannot be " +
        "implemented\" and the CREATE TABLE will fail on every database:\n" +
        listing +
        "\n\nMake the referencing column the same type as the column it " +
        "references. Do not allowlist this — an unimplementable FK means the " +
        "table cannot exist at all.",
    ).toEqual([]);
  });
});

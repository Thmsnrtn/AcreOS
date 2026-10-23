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

import { describe, it, expect, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import fs from "node:fs";
import path from "node:path";
// This gate walks the source tree; its cost scales with the repo, and under the
// coverage run it does not fit the suite’s 30s default. A killed gate reports
// nothing about what it guards, so the budget is declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });


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

// ── The population db:push builds, not just the one this corpus builds ──────
//
// Everything above compares the SQL corpus against ITSELF, so it is green when
// the corpus is self-consistent. Staging is not built from the corpus: its
// schema comes from `db:push`, which follows shared/schema, and the nightly
// staging-schema-reconcile then runs `migrate.mjs --ddl-only` on top. Where
// shared/schema declares an FK target with a type the SQL's referencing column
// cannot reference, that CREATE TABLE "cannot be implemented" on staging.
// Measured 2026-10-21: exactly how the reconcile failed on cam_reconciliations,
// commercial_sales_reports and lease_rent_schedule (db:push + --ddl-only:
// 1,888 OK, 3 FAILED, exit 1), and 38 more FKs had the same shape.
//
// Decided (COO, Package 4): the canonical id type of those families is uuid,
// which is what production has for all 14 parents. shared/schema now declares
// them uuid, every one of the 41 FKs agrees, and no table is exempt: the
// type-following DDL that once let three tables skip this check is gone, so
// the check reads every SQL FK. An existing db:push-built database converges
// through CONVERGE_UUID_ID_FAMILIES in scripts/migrate.mjs
// (tests/integration/uuidIdConvergence.db.test.ts).

import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as drizzleSchema from "../../shared/schema";

type ColumnModel = Map<string, Map<string, string>>;

/** The schema db:push builds: every pgTable in shared/schema → column SQL types. */
function dbPushModel(): ColumnModel {
  const model: ColumnModel = new Map();
  for (const v of Object.values(drizzleSchema)) {
    if (!(v instanceof PgTable)) continue;
    const cfg = getTableConfig(v);
    model.set(cfg.name, new Map(cfg.columns.map((c) => [c.name, norm(c.getSQLType())])));
  }
  return model;
}

/** SQL FKs whose target column db:push builds with an incompatible type. */
function dbPushMismatches(fks: ForeignKey[], model: ColumnModel): string[] {
  const out = new Set<string>();
  for (const fk of fks) {
    const target = model.get(fk.refTable)?.get(fk.refColumn);
    if (!target) continue;
    if (compatClass(target) !== compatClass(fk.type)) out.add(`${fk.table}.${fk.column}`);
  }
  return [...out].sort();
}

/** SQL FK columns that db:push builds, on the CHILD side, with a type the SQL FK cannot hold. */
function dbPushChildMismatches(fks: ForeignKey[], model: ColumnModel): string[] {
  const out = new Set<string>();
  for (const fk of fks) {
    const child = model.get(fk.table)?.get(fk.column);
    if (!child) continue;
    if (compatClass(child) !== compatClass(fk.type)) out.add(`${fk.table}.${fk.column} (${child} in shared/schema, ${fk.type} in SQL)`);
  }
  return [...out].sort();
}

/** The 14 parents whose canonical id type is uuid (production, 2026-10-21). */
const UUID_ID_PARENTS = [
  "acquired_notes", "buyer_blasts", "chart_of_accounts", "contractors", "earnest_money_holds",
  "move_inspections", "note_loss_mit_cases", "permit_checklists", "quiet_title_cases",
  "rehab_line_items", "rehabs", "rent_charges", "rental_leases", "tenants",
];

describe("every SQL foreign key is implementable on a db:push-built database too", () => {
  const model = dbPushModel();

  it("read the db:push schema and the SQL FKs into each uuid parent (vacuity)", () => {
    expect(model.size, "no pgTable read from shared/schema").toBeGreaterThan(300);
    for (const p of UUID_ID_PARENTS) {
      expect(model.get(p)?.get("id"), `${p}.id missing from the db:push model`).toBeTruthy();
      // a parent no SQL FK references would make the agreement below vacuous for it
      expect(foreignKeys.some((fk) => fk.refTable === p && fk.refColumn === "id"), `no SQL FK references ${p}.id`).toBe(true);
    }
  });

  it("declares uuid as the id type of all 14 parents in shared/schema (the decision)", () => {
    const notUuid = UUID_ID_PARENTS.filter((p) => model.get(p)?.get("id") !== "uuid");
    expect(notUuid, "canonical id type for these families is uuid — production has uuid").toEqual([]);
  });

  it("has no uuid ↔ string FK against the db:push schema", () => {
    expect(
      dbPushMismatches(foreignKeys, model),
      "these SQL FKs reference a column shared/schema declares with an incompatible type, so their " +
        "CREATE TABLE fails on staging (db:push) with \"foreign key constraint cannot be implemented\". " +
        "Make the two types agree. Do not register or exempt it.",
    ).toEqual([]);
  });

  it("builds every SQL FK column with the SQL's type on the child side too", () => {
    // A child column shared/schema declares varchar while the SQL FK is uuid is
    // built varchar by db:push with no FK at all: the reference silently does
    // not exist on staging. Measured 2026-10-21: 40 such columns before uuid
    // (37 in the rental/rehab/notes/ledger families + the 3 CAM lease_ids).
    expect(
      dbPushChildMismatches(foreignKeys, model),
      "shared/schema declares these FK columns with a type the SQL migration does not, so db:push builds them " +
        "differently from every other database. Make shared/schema match the SQL.",
    ).toEqual([]);
  });

  it("goes red when a parent's db:push type drifts back (positive control)", () => {
    // Mutate the governed thing: rental_leases.id as staging's db:push built it before.
    const drifted: ColumnModel = new Map([...model].map(([t, cols]) => [t, new Map(cols)]));
    drifted.get("rental_leases")!.set("id", "varchar");
    const found = dbPushMismatches(foreignKeys, drifted);
    // every real SQL FK into rental_leases is now a finding, the CAM tables included
    const expected = [...new Set(
      foreignKeys.filter((fk) => fk.refTable === "rental_leases" && fk.refColumn === "id").map((fk) => `${fk.table}.${fk.column}`),
    )].sort();
    expect(expected.length).toBeGreaterThanOrEqual(10);
    expect(found).toEqual(expected);
    for (const cam of ["cam_reconciliations.lease_id", "commercial_sales_reports.lease_id", "lease_rent_schedule.lease_id"]) {
      expect(found).toContain(cam);
    }
  });
});

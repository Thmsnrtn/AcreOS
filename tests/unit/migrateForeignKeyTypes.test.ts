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
// release_command is `true` and its schema comes from `db:push`, which follows
// shared/schema. Where shared/schema declares an FK target varchar and the SQL
// declares the referencing column uuid, the SQL CREATE TABLE "cannot be
// implemented" on a db:push-built database. Measured 2026-10-21: that is exactly
// how staging-schema-reconcile failed on cam_reconciliations,
// commercial_sales_reports and lease_rent_schedule, reproduced locally by
// db:push + `migrate.mjs --ddl-only` (1,888 OK, 3 FAILED, exit 1).
//
// Those three now take lease_id's type from the live rental_leases.id
// (leaseIdTypedToRentalLeases / `DO $lease_fk$`), which is right on both
// populations. The others below are the same shape and survive on staging only
// because db:push already created their tables, so their CREATE TABLE IF NOT
// EXISTS never runs there. They are registered, not fixed: which type is
// canonical (uuid as this corpus builds it, varchar as shared/schema declares it)
// is the open decision in scripts/migrate.mjs, and it needs production's actual
// column types. The register is exact and only shrinks; a NEW instance fails.

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

/** Tables EVERY one of whose CREATE TABLEs types lease_id from the live column. */
function typeFollowingTables(srcs: { name: string; sql: string }[]): Set<string> {
  const created = new Map<string, number>();
  const wrapped = new Map<string, number>();
  for (const { sql } of srcs) {
    for (const m of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?"?([a-z0-9_]+)"?\s*\(/gi)) {
      created.set(m[1], (created.get(m[1]) ?? 0) + 1);
    }
    const shapes = [
      /leaseIdTypedToRentalLeases\(`CREATE TABLE (?:IF NOT EXISTS )?"([a-z0-9_]+)"/g,
      /DO \$lease_fk\$[\s\S]*?\$ddl\$CREATE TABLE (?:IF NOT EXISTS )?"([a-z0-9_]+)"/g,
    ];
    for (const re of shapes) for (const m of sql.matchAll(re)) wrapped.set(m[1], (wrapped.get(m[1]) ?? 0) + 1);
  }
  return new Set([...wrapped].filter(([t, n]) => n === created.get(t)).map(([t]) => t));
}

/** SQL FKs whose target column db:push builds with an incompatible type. */
function dbPushMismatches(fks: ForeignKey[], model: ColumnModel, following: Set<string>): string[] {
  const out = new Set<string>();
  for (const fk of fks) {
    const target = model.get(fk.refTable)?.get(fk.refColumn);
    if (!target || following.has(fk.table)) continue;
    if (compatClass(target) !== compatClass(fk.type)) out.add(`${fk.table}.${fk.column}`);
  }
  return [...out].sort();
}

/** Known, pre-existing instances (2026-10-21). Exact; only shrinks. */
const KNOWN_DB_PUSH_MISMATCHES = [
  "account_ledger_entries.account_id",
  "arv_calculations.rehab_id",
  "bid_estimates.contractor_id",
  "bid_estimates.rehab_id",
  "buyer_blast_recipients.blast_id",
  "chart_of_accounts.parent_account_id",
  "construction_draws.rehab_id",
  "contractor_payments.contractor_id",
  "contractor_payments.rehab_id",
  "contractor_payments.rehab_line_item_id",
  "contractor_w9_documents.contractor_id",
  "earnest_money_events.hold_id",
  "lease_addendums.lease_id",
  "lease_tenants.lease_id",
  "lease_tenants.tenant_id",
  "maintenance_tickets.assigned_contractor_id",
  "maintenance_tickets.lease_id",
  "maintenance_tickets.submitted_by_tenant_id",
  "move_inspections.lease_id",
  "move_inspections.tenant_id",
  "note_assignments.note_id",
  "note_loss_mit_actions.case_id",
  "note_loss_mit_cases.note_id",
  "note_ownership_of_record.note_id",
  "note_ownership_splits.note_id",
  "note_payments.note_id",
  "permit_gates.checklist_id",
  "quiet_title_steps.case_id",
  "rehab_line_items.rehab_id",
  "rehab_photos.line_item_id",
  "rehab_photos.rehab_id",
  "rent_charges.lease_id",
  "rent_payments.lease_id",
  "rent_payments.payor_tenant_id",
  "rent_payments.rent_charge_id",
  "security_deposits.lease_id",
  "security_deposits.move_out_inspection_id",
  "security_deposits.tenant_id",
];

describe("every SQL foreign key is implementable on a db:push-built database too", () => {
  const model = dbPushModel();
  const following = typeFollowingTables(sources);

  it("read the db:push schema and found the type-following tables (vacuity)", () => {
    expect(model.size, "no pgTable read from shared/schema").toBeGreaterThan(300);
    expect(model.get("rental_leases")?.get("id"), "rental_leases.id missing from the db:push model").toBeTruthy();
    // Each of the three is wrapped in BOTH migrate.mjs and migrations/0222.
    expect([...following].sort()).toEqual(["cam_reconciliations", "commercial_sales_reports", "lease_rent_schedule"]);
  });

  it("adds no new uuid ↔ string FK against the db:push schema, and the register is exact", () => {
    const found = dbPushMismatches(foreignKeys, model, following);
    const added = found.filter((k) => !KNOWN_DB_PUSH_MISMATCHES.includes(k));
    const stale = KNOWN_DB_PUSH_MISMATCHES.filter((k) => !found.includes(k));
    expect(
      added,
      "these SQL FKs reference a column shared/schema declares with an incompatible type, so their " +
        "CREATE TABLE fails on staging (db:push) with \"foreign key constraint cannot be implemented\". " +
        "Make the types agree, or type the column from the live target as leaseIdTypedToRentalLeases does.",
    ).toEqual([]);
    expect(stale, "fixed — remove from KNOWN_DB_PUSH_MISMATCHES").toEqual([]);
  });

  it("goes red on the shape that broke staging (positive control)", () => {
    const probe = parseCorpus([
      {
        name: "synthetic",
        sql: `
          CREATE TABLE IF NOT EXISTS "child" (
            "id" varchar PRIMARY KEY,
            "lease_id" uuid NOT NULL REFERENCES "rental_leases"("id") ON DELETE CASCADE
          );
        `,
      },
    ]);
    // rental_leases.id is varchar in shared/schema: an unwrapped uuid FK is a finding…
    expect(dbPushMismatches(probe.foreignKeys, model, new Set())).toEqual(["child.lease_id"]);
    // …and a type-following one is not.
    expect(dbPushMismatches(probe.foreignKeys, model, new Set(["child"]))).toEqual([]);
  });
});

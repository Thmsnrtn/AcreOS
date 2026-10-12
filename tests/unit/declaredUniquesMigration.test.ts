/**
 * Every unique shared/schema declares is enforced by the DDL this repository
 * ships — and migration 0281, which closed the last 17 gaps, can never fail a
 * deploy or change a row on account of the data it finds.
 *
 * 0281 runs as part of the Fly release_command (scripts/migrate.mjs). A
 * release_command that fails blocks every deploy, and production data was never
 * checked for duplicates on these keys. So the contract is: where a table holds
 * duplicate non-null keys, the block keeps every row, does not raise an error,
 * RAISEs a WARNING naming the table, the constraint and the count, and leaves
 * that constraint absent. Everywhere else the constraint exists under exactly
 * the declared name, as a full (non-partial) UNIQUE constraint, NULLs distinct.
 *
 * STATIC (always runs):
 *   - the population: every declared unique (shared/schema) has a full unique
 *     on the same columns in the shipped DDL model (tests/helpers/
 *     onConflictTargets.ts — migrations/*.sql, then migrate.mjs's literals);
 *     removing 0281 and its mirror makes exactly its 17 entries fail;
 *   - each 0281 block names a declared unique exactly (table, name, column);
 *   - migrate.mjs carries the same blocks, text identical, in the same order.
 *
 * REAL DATABASE (ACREOS_REAL_DATABASE_URL; required where CI builds a schema):
 *   (a) on the built database every 0281 constraint exists as declared;
 *   (b) in a scratch schema seeded with a duplicate key, the migration runs
 *       without error, warns, keeps both rows and skips only that constraint;
 *   (c) re-running it changes nothing.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import * as schema from "@shared/schema";
import { declaredUniques, type UniqueSpec } from "../../scripts/lib/constraint-names";
import {
  REPO_ROOT,
  buildShippedUniqueModel,
  migrateMjsSources,
  migrationSources,
  normalizePredicate,
  shippedDdlSources,
  uniqueIndexesOf,
  type ShippedModel,
} from "../helpers/onConflictTargets";
import { useRealDb, realDbAvailable, realDbUrl } from "../helpers/realDb";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

useRealDb("declaredUniquesMigration.test.ts");
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const MIGRATION_LABEL = "migrations/0281_declared_uniques_enforced.sql";
const MIGRATION_SQL = fs.readFileSync(path.join(REPO_ROOT, MIGRATION_LABEL), "utf8");
const MIGRATE_MJS = fs.readFileSync(path.join(REPO_ROOT, "scripts", "migrate.mjs"), "utf8");
const BLOCK_RE = /DO \$mig0281\$[\s\S]*?\n\$mig0281\$/g;
const ADD_RE = /ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)" UNIQUE \("([^"]+)"\)/;
/** The 17 declared uniques no DDL created before 0281 (constraint-names register, 2026-10-12). */
const EXPECTED_ENTRIES = 17;

interface Entry {
  table: string;
  name: string;
  column: string;
  block: string;
}

function entriesOf(text: string): Entry[] {
  return (text.match(BLOCK_RE) ?? []).map((block) => {
    const m = ADD_RE.exec(block);
    if (!m) throw new Error(`0281 block without an ADD CONSTRAINT: ${block.slice(0, 120)}`);
    return { table: m[1], name: m[2], column: m[3], block };
  });
}

const fileEntries = entriesOf(MIGRATION_SQL);
const declared: UniqueSpec[] = declaredUniques(schema as Record<string, unknown>);

/**
 * Enforced = a non-deferrable unique on exactly the declared columns that is
 * either full, or (single column) partial on `<col> IS NOT NULL` — the same
 * guarantee as a NULLs-distinct UNIQUE constraint (deal_rooms.public_share_slug
 * is such an index). Any other predicate leaves rows outside the guarantee.
 */
function unenforced(model: ShippedModel): string[] {
  return declared
    .filter((d) => {
      const want = [...d.columns].sort().join(",");
      return !uniqueIndexesOf(model, d.table).some((u) => {
        if (u.deferrable || u.columns === null || [...u.columns].sort().join(",") !== want) return false;
        if (u.predicate === null) return true;
        return d.columns.length === 1 && normalizePredicate(u.predicate) === normalizePredicate(`"${d.columns[0]}" IS NOT NULL`);
      });
    })
    .map((d) => `${d.table}:${d.name}`)
    .sort();
}

describe("declared uniques are enforced by the shipped DDL", () => {
  it("reads the populations it claims (vacuity floors)", () => {
    expect(declared.length).toBeGreaterThanOrEqual(80);
    expect(fileEntries).toHaveLength(EXPECTED_ENTRIES);
  });

  it("every declared unique has a full unique on its columns in migrations/*.sql + migrate.mjs", () => {
    expect(unenforced(buildShippedUniqueModel(shippedDdlSources()))).toEqual([]);
  });

  it("without 0281 and its migrate.mjs mirror, exactly its entries are unenforced (the gate sees the defect)", () => {
    const without = shippedDdlSources().filter((s) => s.label !== MIGRATION_LABEL && !s.sql.includes("$mig0281$"));
    expect(without.length).toBe(shippedDdlSources().length - 1 - EXPECTED_ENTRIES);
    expect(unenforced(buildShippedUniqueModel(without))).toEqual(fileEntries.map((e) => `${e.table}:${e.name}`).sort());
  });

  it("each 0281 block creates a declared unique exactly as declared (name, table, single column)", () => {
    for (const e of fileEntries) {
      const d = declared.find((x) => x.table === e.table && x.name === e.name);
      expect(d, `${e.table}:${e.name} is declared in shared/schema`).toBeDefined();
      expect(d!.columns).toEqual([e.column]);
    }
    expect(new Set(fileEntries.map((e) => e.name)).size).toBe(EXPECTED_ENTRIES);
  });

  it("scripts/migrate.mjs mirrors 0281 block for block, text identical", () => {
    const mirrored = migrateMjsSources().filter((s) => s.sql.includes("$mig0281$")).map((s) => s.sql);
    expect(mirrored).toEqual(fileEntries.map((e) => e.block));
    expect(entriesOf(MIGRATE_MJS).map((e) => e.block)).toEqual(fileEntries.map((e) => e.block));
    expect(migrationSources().filter((s) => s.sql.includes("$mig0281$")).map((s) => s.label)).toEqual([MIGRATION_LABEL]);
  });
});

describe.runIf(realDbAvailable)("migration 0281 on a real database", () => {
  const scratch = `uniq0281_${process.pid}_${Date.now()}`;
  const dupEntry = () => fileEntries.find((e) => e.table === "company_agents")!;
  const nullEntry = () => fileEntries.find((e) => e.table === "shared_deal_links")!;
  const absentEntry = () => fileEntries.find((e) => e.table === "strategic_plans")!;
  let client: pg.Client;
  const notices: Array<{ severity: string; message: string }> = [];

  async function constraintsInScratch(): Promise<Map<string, number>> {
    const { rows } = await client.query<{ conname: string; oid: number }>(
      `SELECT c.conname, c.oid::int AS oid FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = $1 AND c.contype = 'u'`,
      [scratch],
    );
    return new Map(rows.map((r) => [r.conname, r.oid]));
  }

  async function snapshot(table: string, column: string): Promise<string> {
    const { rows } = await client.query(`SELECT id, "${column}" AS k FROM "${table}" ORDER BY id`);
    return JSON.stringify(rows);
  }

  async function runMigration(): Promise<Array<{ severity: string; message: string }>> {
    notices.length = 0;
    await client.query(MIGRATION_SQL); // throws on any error — which is what (b) and (c) forbid
    return [...notices];
  }

  beforeAll(async () => {
    client = new pg.Client({ connectionString: realDbUrl });
    await client.connect();
    client.on("notice", (n) => notices.push({ severity: String(n.severity ?? ""), message: String(n.message ?? "") }));
    await client.query(`CREATE SCHEMA "${scratch}"`);
    // Only the scratch schema is on the path: the migration's unqualified names
    // (and its to_regclass existence checks) resolve there, never in public.
    await client.query(`SET search_path TO "${scratch}"`);
    for (const e of fileEntries) {
      if (e.table === absentEntry().table) continue;
      await client.query(`CREATE TABLE "${e.table}" (id serial PRIMARY KEY, "${e.column}" text)`);
    }
    const dup = dupEntry();
    await client.query(`INSERT INTO "${dup.table}" ("${dup.column}") VALUES ('same'), ('same'), ('other'), (NULL), (NULL)`);
    const nul = nullEntry();
    await client.query(`INSERT INTO "${nul.table}" ("${nul.column}") VALUES (NULL), (NULL), ('a')`);
  });

  afterAll(async () => {
    if (!client) return;
    await client.query(`DROP SCHEMA IF EXISTS "${scratch}" CASCADE`).catch(() => undefined);
    await client.end().catch(() => undefined);
  });

  it("(a) the built database carries every 0281 constraint as declared: full, not deferrable, on the declared column", async () => {
    const { rows } = await client.query<{ conname: string; relname: string; cols: string[]; partial: boolean; deferrable: boolean }>(
      `SELECT c.conname, t.relname, array_agg(a.attname::text ORDER BY k.ord) AS cols,
              (x.indpred IS NOT NULL) AS partial, c.condeferrable AS deferrable
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace AND n.nspname = 'public'
         JOIN pg_index x ON x.indexrelid = c.conindid
         CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
        WHERE c.contype = 'u' AND c.conname = ANY($1::text[])
        GROUP BY c.conname, t.relname, x.indpred, c.condeferrable`,
      [fileEntries.map((e) => e.name)],
    );
    const got = rows.map((r) => `${r.relname}:${r.conname}(${r.cols.join(",")}) partial=${r.partial} deferrable=${r.deferrable}`).sort();
    const want = fileEntries.map((e) => `${e.table}:${e.name}(${e.column}) partial=false deferrable=false`).sort();
    expect(got).toEqual(want);
  });

  it("(b) a duplicate key: no error, a WARNING with table/constraint/count, every row kept, only that constraint skipped", async () => {
    const dup = dupEntry();
    const before = await snapshot(dup.table, dup.column);
    const seen = await runMigration();

    const warnings = seen.filter((n) => n.severity === "WARNING");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain(dup.table);
    expect(warnings[0].message).toContain(dup.name);
    expect(warnings[0].message).toMatch(/\b1 duplicate non-null key group/);

    expect(await snapshot(dup.table, dup.column)).toBe(before);
    const made = await constraintsInScratch();
    expect(made.has(dup.name)).toBe(false);
    const expected = fileEntries.filter((e) => e !== dup && e !== absentEntry()).map((e) => e.name).sort();
    expect([...made.keys()].sort()).toEqual(expected);

    // NULLs are distinct, as Drizzle declares: two NULL tokens are not duplicates.
    expect(made.has(nullEntry().name)).toBe(true);
    // An absent table is a notice and a skip, never an error.
    expect(seen.some((n) => n.severity === "NOTICE" && n.message.includes(`${absentEntry().table}: table absent`))).toBe(true);
  });

  it("(c) re-running is a no-op: same constraints (same objects), same rows, same single warning", async () => {
    const dup = dupEntry();
    const before = await constraintsInScratch();
    const rows = await snapshot(dup.table, dup.column);
    const seen = await runMigration();
    expect(await constraintsInScratch()).toEqual(before);
    expect(await snapshot(dup.table, dup.column)).toBe(rows);
    expect(seen.filter((n) => n.severity === "WARNING").map((n) => n.message.includes(dup.name))).toEqual([true]);
  });

  it("once the duplicate is resolved by hand, the next run adds the constraint and the new key is enforced", async () => {
    const dup = dupEntry();
    await client.query(`UPDATE "${dup.table}" SET "${dup.column}" = 'same-2' WHERE id = (SELECT max(id) FROM "${dup.table}" WHERE "${dup.column}" = 'same')`);
    const seen = await runMigration();
    expect(seen.filter((n) => n.severity === "WARNING")).toEqual([]);
    expect((await constraintsInScratch()).has(dup.name)).toBe(true);
    await expect(client.query(`INSERT INTO "${dup.table}" ("${dup.column}") VALUES ('other')`)).rejects.toThrow(/duplicate key/);
  });
});

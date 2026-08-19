/**
 * `0085_rebuild_prereq_tables.sql` duplicates three table definitions that also
 * live in `scripts/migrate.mjs`. Duplication is the price of closing the
 * rebuild cycle — but two copies of a CREATE TABLE is exactly how a schema
 * drifts, and this repository already has a worked example of the damage:
 * `0003_robust_namora.sql` carries a "⚠ STALE — DO NOT TRUST THIS SHAPE"
 * block over `field_scout_*` for precisely that reason, and the drift it
 * describes meant a rebuilt database had no `field_scout_visits.organization_id`
 * at all while `shared/schema.ts` declared it `notNull()`.
 *
 * So the duplication is pinned rather than trusted: the columns each side
 * declares must match, name for name.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

/**
 * Read lazily, with the reason on the error.
 *
 * These were module-level `readFileSync` calls, and renaming the migration
 * (which is exactly the mutation this file exists to catch — an ordering fix
 * that sorts AFTER what it unblocks) crashed the suite at import with an
 * ENOENT instead of failing the ordering assertion. A red suite either way,
 * but a maintainer reading "cannot find 0085…" learns less than one reading
 * "the ordering fix sorts after its dependants".
 */
function read(rel: string): string {
  try {
    return fs.readFileSync(path.join(ROOT, rel), "utf8");
  } catch {
    throw new Error(
      `${rel} is missing. If it was renamed, check the ordering assertions ` +
        "below first — a rebuild-prerequisite migration must sort BEFORE the " +
        "migrations it unblocks, or it fixes nothing.",
    );
  }
}

const PREREQ = "migrations/0085_rebuild_prereq_tables.sql";
const FIELD_SCOUT = "migrations/0004_field_scout_canonical_columns.sql";

const TABLES = ["earnest_money_holds", "rehabs", "rehab_line_items"] as const;

/** Column names declared in the first `CREATE TABLE … <table> ( … )` found. */
function columnsOf(source: string, table: string): string[] {
  const re = new RegExp(
    `CREATE TABLE (?:IF NOT EXISTS )?"?${table}"?\\s*\\(([\\s\\S]*?)\\n\\s*\\)`,
    "i",
  );
  const m = re.exec(source);
  if (!m) return [];
  return m[1]
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("--"))
    .map((l) => /^"?([a-z_]+)"?\s/i.exec(l)?.[1] ?? "")
    .filter(Boolean)
    // CONSTRAINT / PRIMARY / UNIQUE lines are not columns.
    .filter((c) => !["constraint", "primary", "unique", "foreign", "check"].includes(c.toLowerCase()));
}

describe("the rebuild-prerequisite tables match their migrate.mjs definitions", () => {
  it("vacuity guard: both sources are readable and declare all three tables", () => {
    const sql = read(PREREQ);
    const mjs = read("scripts/migrate.mjs");
    expect(sql.length).toBeGreaterThan(1000);
    expect(mjs.length).toBeGreaterThan(100000);
    for (const t of TABLES) {
      expect(sql, `${t} is missing from the migration`).toContain(t);
      expect(mjs, `${t} is missing from migrate.mjs`).toContain(t);
    }
  });

  it.each(TABLES)("%s declares the same columns on both sides", (table) => {
    const fromSql = columnsOf(read(PREREQ), table);
    const fromMjs = columnsOf(read("scripts/migrate.mjs"), table);

    // The extractor must actually find something, or the comparison below is
    // an empty-set equality that passes over any drift at all.
    expect(fromSql.length, `no columns parsed from the migration for ${table}`).toBeGreaterThan(5);
    expect(fromMjs.length, `no columns parsed from migrate.mjs for ${table}`).toBeGreaterThan(5);

    expect(
      [...fromSql].sort(),
      `${table} has drifted between migrations/0085_rebuild_prereq_tables.sql ` +
        "and scripts/migrate.mjs. Two copies of a CREATE TABLE is how " +
        "field_scout_* ended up without organization_id — fix both, or delete one.",
    ).toEqual([...fromMjs].sort());
  });

  it("the migration sorts BEFORE the dependants it unblocks", () => {
    // An ordering fix that sorts after what it unblocks fixes nothing.
    const dir = fs.readdirSync(path.join(ROOT, "migrations")).filter((f) => f.endsWith(".sql")).sort();
    const prereq = dir.indexOf("0085_rebuild_prereq_tables.sql");
    const emd = dir.indexOf("0086_earnest_money_events.sql");
    const photos = dir.indexOf("0089_rehab_photos.sql");
    expect(prereq, "the prerequisite migration is gone").toBeGreaterThan(-1);
    expect(emd).toBeGreaterThan(prereq);
    expect(photos).toBeGreaterThan(prereq);
  });

  it("the field_scout reconciliation sorts after 0003 and before 0072", () => {
    const dir = fs.readdirSync(path.join(ROOT, "migrations")).filter((f) => f.endsWith(".sql")).sort();
    const fix = dir.indexOf("0004_field_scout_canonical_columns.sql");
    const stale = dir.findIndex((f) => f.startsWith("0003_"));
    const indexer = dir.indexOf("0072_field_scout_photo_hash.sql");
    expect(fix, "the field_scout reconciliation is gone").toBeGreaterThan(-1);
    // It must run after the stale CREATE TABLE (nothing to alter before it)…
    expect(fix).toBeGreaterThan(stale);
    // …and before the migration that indexes the columns it adds.
    expect(indexer).toBeGreaterThan(fix);
  });

  it("adds organization_id to both field_scout tables", () => {
    const fix = read(FIELD_SCOUT);
    expect(fix).toMatch(/ALTER TABLE "field_scout_visits" ADD COLUMN IF NOT EXISTS "organization_id"/);
    expect(fix).toMatch(/ALTER TABLE "field_scout_photos" ADD COLUMN IF NOT EXISTS "organization_id"/);
    // Nullable on purpose — see the file's own note. A NOT NULL column with no
    // default fails against a table that already holds rows, and this
    // migration cannot see the row counts.
    expect(fix).not.toMatch(/ADD COLUMN IF NOT EXISTS "organization_id" INTEGER NOT NULL/);
  });
});

/**
 * County subdivision timelines are not seeded from an AI persona (P1-C item 7).
 *
 * scripts/migrate.mjs seeded p50/p90 approval days for six TN counties under
 * the comment "Brigid §7 seed: TN counties she actually works" — Brigid is an
 * AI review persona — with sources like "Williamson Co Planning + Brigid
 * historicals 2024-2026". /county-timelines and the carry-cost projector
 * presented those numbers as county data.
 *
 * Population: EVERY INSERT into county_subdivision_timelines in
 * scripts/migrate.mjs AND migrations/*.sql (comments stripped, so the record
 * of the removal cannot read as the defect), plus every string literal in
 * either that is an INSERT's source citing "Brigid" for ANY table of
 * county data. And the cleanup for databases that already ran the seed must
 * exist in both places (the release command runs migrate.mjs only).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";

const ROOT = resolve(__dirname, "../..");
const mjs = stripComments(readFileSync(resolve(ROOT, "scripts/migrate.mjs"), "utf8"));
const stripSql = (s: string) => s.replace(/--[^\n]*/g, "");
const sqlFiles = readdirSync(resolve(ROOT, "migrations")).filter((f) => f.endsWith(".sql"));
const sources: Array<{ name: string; text: string }> = [
  { name: "scripts/migrate.mjs", text: mjs },
  ...sqlFiles.map((f) => ({ name: `migrations/${f}`, text: stripSql(readFileSync(resolve(ROOT, "migrations", f), "utf8")) })),
];

describe("county timelines — no persona seed", () => {
  it("reads the whole population (vacuity floor)", () => {
    expect(sqlFiles.length).toBeGreaterThan(250);
    expect(mjs.length).toBeGreaterThan(100_000);
    // The table is still created (the defect is the seed, not the table).
    expect(mjs).toMatch(/CREATE TABLE IF NOT EXISTS "county_subdivision_timelines"/);
  });

  it("nothing INSERTs into county_subdivision_timelines", () => {
    for (const s of sources) {
      expect(s.text, s.name).not.toMatch(/INSERT\s+INTO\s+"?county_subdivision_timelines"?/i);
    }
  });

  it("no seeded row anywhere cites the Brigid persona as a source", () => {
    for (const s of sources) {
      for (const m of s.text.matchAll(/INSERT\s+INTO[\s\S]*?(?:;|`,|ON\s+CONFLICT)/gi)) {
        expect(m[0], `${s.name}: ${m[0].slice(0, 120)}`).not.toMatch(/brigid/i);
      }
    }
  });

  it("0283 deletes already-seeded persona rows, in migrate.mjs (release path) and migrations/", () => {
    const sqlFile = sqlFiles.find((f) => f.startsWith("0283_"));
    expect(sqlFile).toBeDefined();
    const sql = stripSql(readFileSync(resolve(ROOT, "migrations", sqlFile!), "utf8"));
    for (const [name, text] of [["migrate.mjs", mjs], [sqlFile!, sql]] as const) {
      const block = text.match(/\$mig0283\$([\s\S]*?)\$mig0283\$/);
      expect(block, name).not.toBeNull();
      const body = block![1];
      expect(body).toMatch(/to_regclass\('"county_subdivision_timelines"'\) IS NULL/);
      expect(body).toMatch(/DELETE FROM "county_subdivision_timelines"/);
      expect(body).toMatch(/"source" ILIKE '%brigid%'/);
      for (const county of ["Hickman", "Maury", "Davidson", "Marshall"]) {
        expect(body, `${name} removes ${county}`).toContain(`'TN', '${county}'`);
      }
    }
  });

  it("the page does not present the rows as persona-backed county data", () => {
    const page = stripComments(readFileSync(resolve(ROOT, "client/src/pages/county-timelines.tsx"), "utf8"));
    expect(page).not.toMatch(/brigid/i);
    expect(page).not.toMatch(/operator historicals/i);
  });
});

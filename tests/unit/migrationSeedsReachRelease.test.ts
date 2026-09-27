/**
 * DEFECT-0061 — a seed committed as migrations/*.sql reaches production only
 * if scripts/migrate.mjs carries it.
 *
 * Fly's release_command runs scripts/migrate.mjs and nothing else; it does not
 * apply migrations/*.sql (see the header of .github/workflows/
 * migrate-mirror-check.yml). That workflow only asks that migrate.mjs be
 * TOUCHED in the same change, and check-schema-migrate-mirror.mjs is
 * table-level — so a seed row for a table that already has other rows in
 * migrate.mjs passes both. Migration 0183 (the four module flags featureGate()
 * checks) did exactly that: committed, never mirrored, never run by a deploy.
 *
 * The rule here is row-level. For every migration from 0091 on (the release
 * command has been the only path since the 2026-05-30 drift sweep; earlier
 * seeds were applied before it existed), each `INSERT … VALUES` row's first
 * string literal — its natural key — must appear as a literal in migrate.mjs,
 * and each `INSERT … SELECT` target table must have an INSERT there.
 * migrate.mjs is comment-stripped first, so a comment naming a key does not
 * count as carrying it.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = resolve(__dirname, "../..");
const FLOOR = 91;

/** Individual rows deliberately not mirrored, reason recorded in migrate.mjs. */
const EXEMPT_ROWS: Record<string, string> = {
  "0183_seed_missing_module_flags.sql:feature_voice_ai":
    "module killed 2026-08-01; migrate.mjs deletes this flag row under the 2026-08-13 founder ruling",
};

/** Whole files deliberately not mirrored, reason recorded in migrate.mjs. */
const EXEMPT: Record<string, string> = {
  "0203_arming_tier1.sql":
    "founder decision 2026-07-16: arming the autopilot is a hard-stop and never a deploy side effect",
};

const mjs = stripComments(readFileSync(resolve(ROOT, "scripts/migrate.mjs"), "utf8"));
const stripSql = (s: string) => s.replace(/--[^\n]*/g, "");

interface Seed { file: string; table: string; key: string | null }

function seedsOf(file: string): Seed[] {
  const sql = stripSql(readFileSync(resolve(ROOT, "migrations", file), "utf8"));
  const out: Seed[] = [];
  const values = /INSERT\s+INTO\s+"?(\w+)"?\s*\(([^)]*)\)\s*VALUES([\s\S]*?)(?:;|ON\s+CONFLICT)/gi;
  let m: RegExpExecArray | null;
  while ((m = values.exec(sql))) {
    const rows = [...m[3].matchAll(/\(\s*(?:'([^']+)'|([^,)\s]+))/g)];
    // A VALUES list whose rows cannot be read is COUNTED, never skipped.
    if (rows.length === 0) out.push({ file, table: m[1], key: "<<unreadable VALUES list>>" });
    // A quoted first value is the row's natural key; an unquoted one (a
    // numeric id, now()) falls back to "the table has an INSERT in migrate.mjs".
    for (const r of rows) out.push({ file, table: m[1], key: r[1] ?? null });
  }
  const selects = /INSERT\s+INTO\s+"?(\w+)"?[^;]*?\bSELECT\b/gi;
  while ((m = selects.exec(sql))) {
    if (!/\bVALUES\b/i.test(m[0])) out.push({ file, table: m[1], key: null });
  }
  return out;
}

const files = readdirSync(resolve(ROOT, "migrations"))
  .filter((f) => /^\d+_.*\.sql$/.test(f) && parseInt(f, 10) >= FLOOR)
  .sort();
const seeds = files.flatMap(seedsOf);
/**
 * Every INSERT statement in migrate.mjs, by target table. A key counts as
 * carried only inside an INSERT into the SAME table — a DELETE or UPDATE that
 * names the key (migrate.mjs has both) is not a mirror of the seed.
 */
const mjsInserts: Array<{ table: string; text: string }> = [];
for (const m of mjs.matchAll(/INSERT\s+INTO\s+"?(\w+)"?[\s\S]*?(?:`|;|'\s*,\s*\n)/gi)) {
  mjsInserts.push({ table: m[1], text: m[0] });
}
const carried = (s: Seed) => {
  const into = mjsInserts.filter((i) => i.table === s.table);
  return s.key === null ? into.length > 0 : into.some((i) => i.text.includes(`'${s.key}'`));
};

describe("DEFECT-0061 — migration seeds reach the release command", () => {
  it("reads the seed population (vacuity floor)", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(seeds.filter((s) => s.key !== null).length).toBeGreaterThanOrEqual(20);
    expect(seeds.filter((s) => s.key === null).length).toBeGreaterThanOrEqual(3);
    expect(new Set(seeds.map((s) => s.file)).size).toBeGreaterThanOrEqual(5);
  });

  it("every seed row from 0091 on is carried by scripts/migrate.mjs", () => {
    const missing = seeds
      .filter((s) => !(s.file in EXEMPT))
      .filter((s) => !(`${s.file}:${s.key}` in EXEMPT_ROWS))
      .filter((s) => !carried(s))
      .map((s) => `${s.file} → ${s.table}${s.key ? ` '${s.key}'` : " (table-level)"}`);
    expect(missing).toEqual([]);
  });

  it("each exemption is still needed (a mirrored or deleted file is a stale exemption)", () => {
    for (const file of Object.keys(EXEMPT)) {
      const own = seeds.filter((s) => s.file === file);
      expect(own.length, `${file} has no seeds any more`).toBeGreaterThan(0);
      expect(own.some((s) => !carried(s)), `${file} is fully mirrored — drop the exemption`).toBe(true);
    }
  });

  it("each exempt row exists and is still unmirrored", () => {
    for (const id of Object.keys(EXEMPT_ROWS)) {
      const s = seeds.find((x) => `${x.file}:${x.key}` === id);
      expect(s, `${id} no longer exists — drop the exemption`).toBeDefined();
      expect(carried(s!), `${id} is now mirrored — drop the exemption`).toBe(false);
    }
  });

  it("the live 0183 module flags are carried (the case that shipped)", () => {
    for (const key of ["feature_white_label", "feature_territories", "feature_deal_rooms"]) {
      expect(carried({ file: "0183", table: "platform_feature_flags", key }), key).toBe(true);
    }
  });
});

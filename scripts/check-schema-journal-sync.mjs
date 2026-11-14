#!/usr/bin/env node
// ============================================================================
// scripts/check-schema-journal-sync.mjs
// ----------------------------------------------------------------------------
// Migration journal-sync freeze ratchet (roadmap P1-17, the Phase-1 leg of I-7).
//
// WHY
// ───
// scripts/migrate.mjs (the Fly `release_command`) is the ONLY migration path
// that reaches prod. The Drizzle journal (migrations/meta/_journal.json) was
// retired 2026-05-11, so nothing machine-reads migrations/*.sql in the deploy.
// What replaced the journal is a discipline: every migration number NNNN has
// BOTH a file `migrations/NNNN_<name>.sql` AND a numbered block in
// scripts/migrate.mjs introduced by a header comment line `// NNNN — …`.
// Nothing enforced that pairing. An unpaired .sql file (never reaches prod), an
// unpaired block (no reviewable .sql mirror), or two migrations claiming one
// number (a merge race) had no tripwire, and every schema PR hand-verified
// number allocation across the open PRs.
//
// The other schema guards cover other layers and are not duplicated here:
// check-schema-migrate-mirror.mjs (every pgTable has a CREATE somewhere),
// tests/unit/schemaMigrationDrift.test.ts (same, as a test) and
// migrate-mirror-check.yml (a PR touching migrations/*.sql must touch
// migrate.mjs). None of them looks at the NUMBERS.
//
// WHAT IT CHECKS
// ──────────────
//   sql side   = files in migrations/ matching  ^(\d{4})_.+\.sql$
//   block side = lines in scripts/migrate.mjs matching  ^\s*//\s*(\d{4})\s*—
//                (em-dash U+2014; the mirror line `// Mirrors migrations/…` is
//                common but not universal, so this keys on NUMBERS only)
// and computes four collections:
//   sqlOnly        numbers with .sql file(s) and no block header
//   blockOnly      numbers with a block header and no .sql file
//   duplicateSql   numbers carried by more than one .sql file (with the count)
//   duplicateBlock numbers carried by more than one block header (with count)
// The measured collections must EXACTLY equal `legacyDesync` in
// scripts/ratchets/schema-journal-sync.json — set equality for the two lists,
// key+count equality for the two maps. A new desync fails; a cured legacy
// desync also fails until the baseline is updated in the same commit.
//
// Two guards on the guard:
//   VACUITY — if a population (sqlFiles, sqlNumbers, blockHeaders) is under its
//     `minima` floor, or migrations/ or scripts/migrate.mjs is missing, the
//     evaluator prints a REFUSAL and no verdict. A scan that stops seeing files
//     would otherwise read every block as blockOnly, or every desync as cured.
//   FREEZE — no `legacyDesync` entry may name a number above `freezePoint`.
//     The baseline may never grandfather a frontier desync.
//
// WHY A RATCHET, NOT A HARD GATE
// ──────────────────────────────
// 224 legacy desyncs exist (208 sqlOnly, 16 duplicateSql, all <= 0252). They
// are FROZEN, NOT FORGIVEN: failing on them today would be `--no-verify`'d
// away, and curing them is the consolidation (P3-1), not this slice. The
// ratchet is exact and bidirectional so the legacy set can only shrink and the
// frontier (> freezePoint, and everything paired above 0252) stays clean.
//
//   node scripts/check-schema-journal-sync.mjs                # gate (CI)
//   node scripts/check-schema-journal-sync.mjs --root <dir>   # fixture tree (tests)
// ============================================================================

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const TAG = "[schema-journal-sync]";
const __dirname = dirname(fileURLToPath(import.meta.url));

function parseRoot(argv) {
  const i = argv.indexOf("--root");
  if (i === -1) return resolve(__dirname, "..");
  const v = argv[i + 1];
  if (!v) {
    console.error(`${TAG} FAIL — --root requires a directory`);
    process.exit(1);
  }
  return resolve(v);
}

const ROOT = parseRoot(process.argv.slice(2));
const MIGRATIONS_DIR = join(ROOT, "migrations");
const MIGRATE_MJS = join(ROOT, "scripts", "migrate.mjs");
const CONFIG_PATH = join(ROOT, "scripts", "ratchets", "schema-journal-sync.json");

const SQL_RE = /^(\d{4})_.+\.sql$/;
const HEADER_RE = /^\s*\/\/\s*(\d{4})\s*—/;

function fail(lines) {
  for (const l of lines) console.error(l);
  process.exit(1);
}

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) fail([`${TAG} FAIL — config missing: ${CONFIG_PATH}`]);
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch (err) {
    fail([`${TAG} FAIL — config is not valid JSON: ${err.message}`]);
  }
}

function tally(numbers) {
  const m = new Map();
  for (const n of numbers) m.set(n, (m.get(n) ?? 0) + 1);
  return m;
}

const sortNums = (xs) => [...xs].sort();
const dupObject = (m) =>
  Object.fromEntries(
    [...m.entries()]
      .filter(([, c]) => c > 1)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );

function main() {
  const cfg = loadConfig();
  const minima = cfg.minima ?? {};
  const legacy = cfg.legacyDesync ?? {};

  // ── population ──────────────────────────────────────────────────────────
  let sqlNames;
  let migrateSrc;
  try {
    if (!statSync(MIGRATIONS_DIR).isDirectory()) throw new Error("not a directory");
    sqlNames = readdirSync(MIGRATIONS_DIR);
  } catch (err) {
    fail([`${TAG} REFUSED — migrations/ is missing or unreadable (${err.message}); no verdict.`]);
  }
  try {
    migrateSrc = readFileSync(MIGRATE_MJS, "utf8");
  } catch (err) {
    fail([`${TAG} REFUSED — scripts/migrate.mjs is missing or unreadable (${err.message}); no verdict.`]);
  }

  const sqlNumbersList = [];
  for (const f of sqlNames) {
    const m = SQL_RE.exec(f);
    if (m) sqlNumbersList.push(m[1]);
  }
  const blockNumbersList = [];
  for (const line of migrateSrc.split(/\r?\n/)) {
    const m = HEADER_RE.exec(line);
    if (m) blockNumbersList.push(m[1]);
  }
  const sqlTally = tally(sqlNumbersList);
  const blockTally = tally(blockNumbersList);
  const pops = {
    sqlFiles: sqlNumbersList.length,
    sqlNumbers: sqlTally.size,
    blockHeaders: blockNumbersList.length,
  };

  // ── vacuity first ───────────────────────────────────────────────────────
  const floorProblems = [];
  for (const key of ["sqlFiles", "blockHeaders", "sqlNumbers"]) {
    const floor = minima[key];
    if (typeof floor !== "number") {
      floorProblems.push(`minima.${key} is missing from the config (a missing floor FAILS, by design)`);
    } else if (pops[key] < floor) {
      floorProblems.push(`${key} = ${pops[key]} is under its floor of ${floor}`);
    }
  }
  if (floorProblems.length > 0) {
    fail([
      `${TAG} REFUSED — population under its vacuity floor; NO VERDICT. A scan that stops seeing files reports false progress:`,
      ...floorProblems.map((p) => `  • ${p}`),
      `${TAG} If a real deletion wave (P3-1) caused this, lower the floor in the same commit and name the wave. Never raise a floor to silence this.`,
    ]);
  }

  // ── config sanity: the baseline may never grandfather a frontier desync ──
  const freeze = cfg.freezePoint;
  if (typeof freeze !== "string" || !/^\d{4}$/.test(freeze)) {
    fail([`${TAG} CONFIG ERROR — freezePoint must be a 4-digit string, got ${JSON.stringify(freeze)}`]);
  }
  const legacyNumbers = [
    ...(legacy.sqlOnly ?? []),
    ...(legacy.blockOnly ?? []),
    ...Object.keys(legacy.duplicateSql ?? {}),
    ...Object.keys(legacy.duplicateBlock ?? {}),
  ];
  const frontier = legacyNumbers.filter((n) => String(n) > freeze);
  if (frontier.length > 0) {
    fail([
      `${TAG} CONFIG ERROR — legacyDesync names number(s) above freezePoint ${freeze}: ${sortNums(frontier).join(", ")}. The baseline may never grandfather a frontier desync; pair the migration instead.`,
    ]);
  }

  // ── measured collections ────────────────────────────────────────────────
  const sqlSet = new Set(sqlTally.keys());
  const blockSet = new Set(blockTally.keys());
  const measured = {
    sqlOnly: sortNums([...sqlSet].filter((n) => !blockSet.has(n))),
    blockOnly: sortNums([...blockSet].filter((n) => !sqlSet.has(n))),
    duplicateSql: dupObject(sqlTally),
    duplicateBlock: dupObject(blockTally),
  };
  const headline =
    measured.sqlOnly.length +
    measured.blockOnly.length +
    Object.keys(measured.duplicateSql).length +
    Object.keys(measured.duplicateBlock).length;

  // ── compare exactly ─────────────────────────────────────────────────────
  const newOnes = [];
  const cured = [];
  const cure = {
    sqlOnly: "pair it — add the missing `// NNNN — …` block to scripts/migrate.mjs — or renumber",
    blockOnly: "pair it — add the missing migrations/NNNN_<name>.sql mirror — or renumber",
    duplicateSql: "renumber one of the colliding .sql files (and its block) to the next free number",
    duplicateBlock: "renumber one of the colliding blocks in scripts/migrate.mjs (and its .sql) to the next free number",
  };

  for (const key of ["sqlOnly", "blockOnly"]) {
    const base = new Set(legacy[key] ?? []);
    const now = new Set(measured[key]);
    for (const n of measured[key]) if (!base.has(n)) newOnes.push(`  • ${n} — NEW DESYNC (${key}). Cure: ${cure[key]}.`);
    for (const n of sortNums(base)) if (!now.has(n)) cured.push(`  • ${n} — CURED legacy ${key}; baseline update owed in this commit.`);
  }
  for (const key of ["duplicateSql", "duplicateBlock"]) {
    const base = legacy[key] ?? {};
    const now = measured[key];
    for (const n of Object.keys(now)) {
      if (!(n in base)) newOnes.push(`  • ${n} — NEW DESYNC (${key}, ${now[n]} copies). Cure: ${cure[key]}.`);
      else if (base[n] !== now[n]) newOnes.push(`  • ${n} — CHANGED ${key}: baseline ${base[n]} copies, measured ${now[n]}. Cure: ${cure[key]} (or, if it shrank, update the baseline count).`);
    }
    for (const n of Object.keys(base)) if (!(n in now)) cured.push(`  • ${n} — CURED legacy ${key}; baseline update owed in this commit.`);
  }

  const popLine = `sqlFiles ${pops.sqlFiles}, sqlNumbers ${pops.sqlNumbers}, blockHeaders ${pops.blockHeaders}`;
  console.log(`${TAG} desync headline: ${headline} (baselineCount ${cfg.baselineCount}); freezePoint ${freeze}; ${popLine}`);

  if (newOnes.length === 0 && cured.length === 0) {
    if (headline !== cfg.baselineCount) {
      // Equal collections but a stale headline number: still a config defect.
      fail([`${TAG} FAIL — collections match but baselineCount ${cfg.baselineCount} != measured headline ${headline}; fix baselineCount.`]);
    }
    console.log(`${TAG} PASS — ${headline} legacy desync(s), exactly the frozen baseline (baselineCount ${cfg.baselineCount}); ${popLine}`);
    process.exit(0);
  }

  const out = [];
  if (newOnes.length > 0) {
    out.push("", `${TAG} FAIL — ${newOnes.length} NEW migration-number desync(s). Every number needs BOTH migrations/NNNN_<name>.sql AND a \`// NNNN — …\` block in scripts/migrate.mjs, exactly once each:`, ...newOnes);
  }
  if (cured.length > 0) {
    out.push(
      "",
      `${TAG} FAIL — ${cured.length} legacy desync(s) no longer measured. Good — lock it in by updating scripts/ratchets/schema-journal-sync.json in the same commit (baselineCount ${cfg.baselineCount} → ${headline}; legacyDesync to the measured values below):`,
      ...cured,
      "",
      `  "baselineCount": ${headline},`,
      `  "legacyDesync": ${JSON.stringify(measured)}`,
    );
  }
  fail(out);
}

main();

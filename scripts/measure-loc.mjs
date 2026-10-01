#!/usr/bin/env node
/**
 * Production lines of code — the counting rule behind the deletion ledger's
 * LOC targets (≤650K at G2, ≤600K by the end of H2; roadmap-2026-10.md §B).
 * The target existed without a rule, so no gate crossing could prove it.
 *
 * RULE: `wc -l` (newline count) over every tracked .ts/.tsx under server/,
 * client/src/ and shared/, excluding *.test.*, *.spec.* and __tests__/.
 * Scripts, migrations, docs and tests/ are not product surface.
 *
 * A MEASUREMENT, not yet a ratchet (roadmap W10.1): H0's waves add gate-tied
 * surface (the list builder), and a strictly-down count would refuse them.
 * It becomes a down-only ratchet when the stop rule takes effect after W10.8
 * (decision-memos/2026-09-30-roadmap-stop-rule.md).
 *
 *   node scripts/measure-loc.mjs          # prints "loc: <lines> lines in <files> files"
 *   node scripts/measure-loc.mjs --json   # machine-readable
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const LOC_ROOTS = ["server/", "client/src/", "shared/"];
export const isProductSource = (f) =>
  LOC_ROOTS.some((r) => f.startsWith(r)) &&
  /\.(ts|tsx)$/.test(f) &&
  !/\.(test|spec)\.(ts|tsx)$/.test(f) &&
  !f.includes("/__tests__/");

/** The population can never silently empty: below this, the scan is broken. */
export const LOC_FILE_FLOOR = 2300;

export function measureLoc(cwd = process.cwd()) {
  const files = execFileSync("git", ["ls-files", ...LOC_ROOTS], { cwd, encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .filter(isProductSource);
  let lines = 0;
  for (const f of files) {
    const text = readFileSync(`${cwd}/${f}`, "utf8");
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines++;
  }
  return { files: files.length, lines };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = measureLoc();
  if (r.files < LOC_FILE_FLOOR) {
    console.error(`loc: VACUOUS SCAN — ${r.files} file(s), below the floor of ${LOC_FILE_FLOOR}. The walk or the roots are broken.`);
    process.exit(1);
  }
  console.log(process.argv.includes("--json") ? JSON.stringify(r) : `loc: ${r.lines} lines in ${r.files} files`);
}

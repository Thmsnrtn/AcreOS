#!/usr/bin/env node
/**
 * INLINE-PROVENANCE gate — the epistemic-UX step-4 growth-stop.
 *
 * The vocabulary decision and its enforcement history live in
 * docs/company/experience-legibility.md and shared/dataClassification.ts.
 * This gate holds the LANDSCAPE still while the migration proceeds:
 * scripts/inline-provenance-census.json carries the verified semantic
 * worklist (54 files, 87 sites) and a per-file mechanical baseline of the
 * /confiden(?!tial)/i signal over all of client/src.
 *
 * What each half PROVES (first law: say what the gate measures):
 *  - census: only that each listed file still exists. The site semantics
 *    were verified by a swept+classified+refuted workflow run; each
 *    migration commit re-verifies its file and deletes the entry.
 *  - mechanicalBaseline: that the signal count per file has not grown, and
 *    that no NEW file introduces the signal. It measures the WORD
 *    "confiden…" (excluding "confidential"), not the defect — the census is
 *    the semantic truth; this is the fence.
 *
 * Down-only both ways: a file above its count FAILS; a file below its count
 * FAILS stale-high (lower the baseline in the migrating commit); a signal
 * file absent from the baseline FAILS as growth. Deleting a file entirely
 * requires removing both its entries in the same commit.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REG = JSON.parse(
  readFileSync(join(ROOT, "scripts/inline-provenance-census.json"), "utf8"),
);

const CANONICAL = new Set([
  "client/src/components/data-provenance-chip.tsx",
  "client/src/components/data-confidence-badge.tsx",
]);
const SIGNAL = /confiden(?!tial)/i;

// FLOORS — the population must look like this repo, or the scan is broken.
const FLOORS = { scannedFiles: 700, signalFiles: 40, signalLines: 180 };

function* walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (/\.(tsx|ts)$/.test(e)) yield p;
  }
}

let scannedFiles = 0;
let signalLines = 0;
const counts = new Map();
for (const abs of walk(join(ROOT, "client/src"))) {
  scannedFiles += 1;
  const rel = abs.slice(ROOT.length + 1);
  if (CANONICAL.has(rel)) continue;
  let n = 0;
  for (const line of readFileSync(abs, "utf8").split("\n")) {
    const t = line.trim();
    if (t.startsWith("import ") || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue;
    if (SIGNAL.test(line)) n += 1;
  }
  if (n > 0) {
    counts.set(rel, n);
    signalLines += n;
  }
}

const failures = [];

if (scannedFiles < FLOORS.scannedFiles)
  failures.push(`vacuity: scanned ${scannedFiles} files < floor ${FLOORS.scannedFiles}`);
if (counts.size < FLOORS.signalFiles)
  failures.push(`vacuity: ${counts.size} signal files < floor ${FLOORS.signalFiles}`);
if (signalLines < FLOORS.signalLines)
  failures.push(`vacuity: ${signalLines} signal lines < floor ${FLOORS.signalLines}`);

// Census existence / staleness.
for (const f of Object.keys(REG.census)) {
  if (!existsSync(join(ROOT, f)))
    failures.push(
      `census: ${f} no longer exists — if it was migrated-and-deleted or renamed, remove its census entry in the same commit`,
    );
}

// Mechanical growth-stop, per member, both directions.
const base = REG.mechanicalBaseline;
for (const [f, n] of counts) {
  const b = base[f];
  if (b === undefined)
    failures.push(
      `growth: ${f} newly renders the confidence signal (${n} line(s)) and is not in the baseline — use DataProvenanceChip / DataConfidenceBadge, or add a reasoned baseline entry if the word is not UI`,
    );
  else if (n > b)
    failures.push(`growth: ${f} signal ${n} > baseline ${b} — inline confidence UI may only shrink`);
  else if (n < b)
    failures.push(
      `stale-high: ${f} signal ${n} < baseline ${b} — migrated (good!); lower the baseline in this commit`,
    );
}
for (const f of Object.keys(base)) {
  if (!counts.has(f))
    failures.push(
      `stale: baseline lists ${f} but it has no signal (migrated or deleted — good!); remove its baseline entry in this commit`,
    );
}

console.log(
  `[check-inline-provenance] scanned ${scannedFiles} files; signal: ${counts.size} files / ${signalLines} lines; ` +
    `census: ${Object.keys(REG.census).length} files (semantic worklist); baseline: ${Object.keys(base).length} entries`,
);
if (failures.length) {
  console.error(`[check-inline-provenance] FAIL — ${failures.length} finding(s):`);
  for (const f of failures) console.error(`  • ${f}`);
  process.exit(1);
}
console.log(
  Object.keys(REG.census).length > 0
    ? "[check-inline-provenance] PASS — the landscape holds; work the census down."
    : "[check-inline-provenance] PASS — census empty (migrated 2026-08-28); the growth-stop holds the landscape.",
);

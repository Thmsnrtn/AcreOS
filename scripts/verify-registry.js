#!/usr/bin/env node
/**
 * Verify that the defect registry has 0 open P0/P1 entries.
 *
 * Parses docs/audits/defect-registry.md and exits non-zero if any entry has
 * Status: OPEN and Severity: P0 or P1. Run as a pre-deploy gate from
 * scripts/verify-launch-ready.sh ("Defect registry: 0 open P0/P1").
 *
 * ── WHY THIS FILE HAS A VACUITY GUARD ────────────────────────────────────
 *
 * The whole gate used to be one regex:
 *
 *     /### (DEFECT-\d+)\nTitle: (.+)\nSeverity: (P\d)\nStatus: (\w+)/g
 *
 * which demands those four lines strictly adjacent, and it NEVER asserted how
 * many entries it had parsed. So zero matches was indistinguishable from zero
 * open P0/P1 defects: insert a blank line after a Title, swap the Severity and
 * Status lines, reflow the file, or save it with CRLF endings, and the affected
 * entries stop being read at all — and the gate prints "PASS: 0 open P0/P1
 * defects in registry" on its way into a deploy.
 *
 * That is this repo's most expensive failure shape, and it is not
 * hypothetical here: an evaluator in the same family reported "current count
 * is 1, baseline says 162 — Good news: 161 error(s) were fixed" from a
 * type-checker that had been starved of memory, when the true count was
 * exactly 162. A register that cannot tell "I found nothing" from "I could not
 * look" will eventually report the second as the first.
 *
 * Two guards, both evaluated BEFORE any verdict:
 *
 *   1. RECONCILIATION — every `### DEFECT-nnnn` heading in the file must have
 *      been fully parsed. A heading whose fields could not be read has an
 *      UNKNOWN status, and an unknown status must never be silently treated as
 *      "not open". This is the load-bearing guard: it scales with the file
 *      instead of needing a number kept in sync.
 *   2. FLOOR — the heading count itself must clear a floor, so a truncated,
 *      emptied, moved or replaced registry fails instead of reporting a clean
 *      bill of health. Measured 2026-08-16: 73 headings, 73 parsed, 18 OPEN
 *      (all P2), 12 P0 / 42 P1 / 19 P2. The floor sits well under 73 because it
 *      exists to catch a broken read, not to forbid closing defects out.
 */

import { readFileSync } from "fs";
import { resolve } from "path";

const registryPath = resolve(
  import.meta.dirname || ".",
  "../docs/audits/defect-registry.md"
);

/**
 * Minimum plausible number of defect headings. Measured 2026-08-16: 73.
 * Lower this only alongside a real, explained reduction in the registry — and
 * never to make a failing run pass, which is the move this guard exists to
 * make visible.
 */
const MIN_HEADINGS = 50;

let content;
try {
  content = readFileSync(registryPath, "utf-8");
} catch {
  console.error(`Cannot read registry at ${registryPath}`);
  process.exit(1);
}

// Every entry the file CLAIMS to have — a deliberately loose pattern, so it
// keeps matching under exactly the reflows that break the strict one below.
const headingIds = [...content.matchAll(/^###\s+(DEFECT-\d+)/gm)].map((m) => m[1]);

// The strict field read. `\r?` so a CRLF checkout does not silently blind the
// whole gate; the reconciliation below is what stops any future tolerance gap
// from going unnoticed.
const defectPattern =
  /###\s+(DEFECT-\d+)\r?\nTitle:\s*(.+?)\r?\nSeverity:\s*(P\d+)\r?\nStatus:\s*(\w+)/g;

const parsed = [];
let match;
while ((match = defectPattern.exec(content)) !== null) {
  const [, id, title, severity, status] = match;
  parsed.push({ id, title: title.trim(), severity, status });
}

// ── Guard 1: the scan saw a plausible file at all ─────────────────────────
if (headingIds.length < MIN_HEADINGS) {
  console.error(
    `FAIL (vacuity guard): only ${headingIds.length} defect heading(s) found in ` +
      `${registryPath} (floor ${MIN_HEADINGS}).\n\n` +
      `  This is a broken or truncated read, not a clean registry. A gate that ` +
      `cannot tell "no open blockers" from "I could not parse the file" will\n` +
      `  eventually wave a P0 through a deploy. Fix the read — do NOT lower the floor.`
  );
  process.exit(1);
}

// ── Guard 2: every heading was actually read ──────────────────────────────
const parsedIds = new Set(parsed.map((d) => d.id));
const unparsed = headingIds.filter((id) => !parsedIds.has(id));
if (unparsed.length > 0) {
  console.error(
    `FAIL: ${unparsed.length} defect entr(ies) could not be parsed, so their ` +
      `status is UNKNOWN:\n`
  );
  for (const id of unparsed) console.error(`  ${id}`);
  console.error(
    `\n  This gate requires Title / Severity / Status on consecutive lines ` +
      `immediately after the heading.\n` +
      `  An unreadable entry is NOT a closed one — it could be an open P0. Repair ` +
      `the entry's formatting.`
  );
  process.exit(1);
}

const openBlockers = parsed.filter(
  (d) => d.status === "OPEN" && (d.severity === "P0" || d.severity === "P1")
);

if (openBlockers.length > 0) {
  console.error(`FAIL: ${openBlockers.length} open P0/P1 defect(s):\n`);
  for (const d of openBlockers) {
    console.error(`  ${d.id} [${d.severity}] ${d.title}`);
  }
  process.exit(1);
}

// The counts are printed on every run, not just on failure: a number nobody
// sees is a number nobody notices moving.
console.log(
  `PASS: 0 open P0/P1 defects in registry ` +
    `(${parsed.length}/${headingIds.length} entries parsed, ` +
    `${parsed.filter((d) => d.status === "OPEN").length} open at P2 or below)`
);
process.exit(0);

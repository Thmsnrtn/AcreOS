#!/usr/bin/env node
// ============================================================================
// scripts/check-ledger-refs.mjs
// ----------------------------------------------------------------------------
// Ledger / registry reference integrity gate (audit F-17-1).
//
// WHY
// ───
// The immune system gates CODE but nothing gates PROSE ABOUT CODE. The
// deletion-ledger and the defect-registry are hand-edited and never diffed
// against reality, so their evidence pointers rot silently. The audit's
// worst case: the ledger's own "biggest pure win" KILL row pointed at
// `server/routes-founder-v6.ts`…`v14.ts` — filenames that no longer exist
// (the routers were RENAMED) — so a fresh session greps the dead names, finds
// nothing, and wrongly concludes the deletion already happened. ~20K LOC the
// ledger marks for action silently survives on a false "done".
//
// WHAT IT CHECKS
// ──────────────
// It parses source-path tokens out of the LIVE, action-bearing prose:
//   • deletion-ledger.md  — the "## Verdict table" section only (the rows a
//     future session acts on). The "Executed deletions (log)" section is
//     intentionally NOT scanned: it legitimately references now-deleted files.
//   • defect-registry.md  — the whole file (its OPEN rows carry evidence
//     pointers a session will try to reproduce).
// A token is a path if it is a backtick span `like/this.ts` or a `file.ts:NN`
// ref whose extension is a code/doc extension. For each token, the cited path
// (or, for a bare filename, its basename) must exist among `git ls-files`.
// Any cited path that does NOT exist on disk is a DANGLING reference.
//
// ALLOWLIST
// ─────────
// Some dangling refs are deliberate — e.g. the corrected ledger row cites the
// OLD `routes-founder-v6.ts` names precisely to say "these are gone, do not
// grep for them". Those live in scripts/ledger-refs.allowlist.json with a
// reason each. Everything else must resolve. A NEW stale pointer fails CI;
// fixing one (or the file genuinely returning) shrinks the allowlist.
//
// This is a HARD gate (zero un-allowlisted dangling refs), not a ratchet: the
// allowlist already encodes the tolerated set, so the honest signal is
// "does a NEW unexplained dangling ref exist" — a boolean, not a count.
//
// ── VACUITY GUARDS (added 2026-08-16) ───────────────────────────────────────
// THE DEFECT THIS SECTION EXISTS FOR: a gate whose clean verdict is computed
// over an EMPTY population reports "every cited source path resolves" and
// exits 0 — and the emptier the scan, the cleaner it looks. On the same day
// this was written, scripts/check-tests-typecheck.mjs printed "Current count
// is 1, baseline says 162. Good news: 161 error(s) were fixed. Lock it in"
// from a tsc that had been starved of memory; the real count was 162. A gate
// that instructs the operator to trust a number that was never true is worse
// than no gate. This file had THREE such paths, all now closed:
//
//   (a) a `git ls-files` failure printed "skipping (fail-open)" and exited 0.
//       An unconditional PASS whenever the subprocess died — including the
//       memory-starvation case above. It is now EXIT 1.
//   (b) a source document missing from disk was `continue`d, silently removing
//       it from the checked population. Renaming deletion-ledger.md would have
//       halved the scan and still printed OK. It is now a HARD FAILURE — see
//       ANCHOR SET. Note the distinction: the SOURCE DOCUMENTS are anchors and
//       may not vanish, while a CITED REF that is deliberately gone has always
//       had a real escape hatch (the allowlist, with a written reason). The
//       deliberate-deletion path exists for refs and only for refs.
//   (c) the extracted-ref population was never floored, so a tokeniser that
//       stopped matching (one bad regex edit) reported "every cited source
//       path resolves" over ZERO references. It is now floored — see MINIMA.
//
// MINIMA are VACUITY FLOORS, not ratchets. They floor the SCAN POPULATIONS
// this run prints, they are checked BEFORE any count may read as clean, and a
// MISSING floor fails exactly as loudly as a breached one (so an unfloored
// population cannot exist). MEASURED FROM THE LIVE REPO on 2026-08-16 —
// observed values recorded next to each floor below — and seeded well under
// live, because these populations legitimately SHRINK: executing a verdict row
// re-labels it "executed" and drops it from scope, and fixing a defect closes
// its block. The floors exist to catch a BROKEN SCAN, never to forbid
// progress. If real progress takes a population under its floor, LOWER THE
// FLOOR IN THE SAME COMMIT and name the work — do not raise a floor to silence
// anything, and do not delete a key.
// ============================================================================

import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..");

const CODE_EXT = /\.(ts|tsx|mjs|cjs|js|jsx|json|sql|md|ya?ml|css|html)$/;

// ── VACUITY FLOORS ───────────────────────────────────────────────────────────
// Measured 2026-08-16 against the live repo; observed value in each comment.
// Every population this run prints MUST have a key here (a missing floor is a
// failure, by design) and every key here MUST be measured (a floor for a
// population nobody computes is a dead letter, also a failure).
const MINIMA = {
  trackedFiles: 4000, //  observed 5991  — `git ls-files` truth set
  ledgerVerdictRows: 5, //  observed   11  — active (non-"executed") table rows
  ledgerRefs: 10, //  observed   20  — path tokens extracted from those rows
  registryOpenBlocks: 12, //  observed   25  — non-closed `### DEFECT-…` blocks
  registryRefs: 8, //  observed   16  — path tokens extracted from those blocks
};

// ── Build the on-disk truth set ──────────────────────────────────────────────
// (a) NO FAIL-OPEN. If we cannot enumerate the repo we cannot judge a single
// reference, and "cannot judge" must never print as "nothing wrong".
let tracked;
try {
  tracked = execSync("git ls-files", { cwd: REPO, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
} catch (e) {
  console.error(
    "\n[ledger-refs] FATAL — `git ls-files` failed, so the on-disk truth set is unknown.\n" +
      `  ${e.message?.split("\n")[0] ?? e}\n` +
      "This gate CANNOT pass without it. It used to exit 0 here ('fail-open'),\n" +
      "which meant every subprocess failure — including an OOM-killed git —\n" +
      "printed as a clean bill of health. Fix the environment and re-run.",
  );
  process.exit(1);
}
const fullPaths = new Set(tracked);
const basenames = new Set(tracked.map((p) => basename(p)));

// A ref resolves if it matches a tracked file exactly, as a path SUFFIX (the
// ledger uses shorthand like `services/voiceAI.ts` for
// `server/services/voiceAI.ts`), or — for a bare filename — by basename.
function resolves(ref) {
  if (fullPaths.has(ref)) return true;
  if (ref.includes("/")) {
    const suffix = "/" + ref;
    for (const p of fullPaths) if (p.endsWith(suffix)) return true;
    return false;
  }
  return basenames.has(ref);
}

// ── Token extraction ─────────────────────────────────────────────────────────
// Pull `backtick spans` and file:line refs, keep only path-shaped tokens.
function extractRefs(text) {
  const refs = new Set();
  // backtick spans
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    for (const tok of splitTokens(m[1])) refs.add(tok);
  }
  // bare file.ts:NN refs outside backticks
  for (const m of text.matchAll(/\b([\w./-]+\.[a-z]{2,4}):\d+/g)) {
    refs.add(m[1]);
  }
  return refs;
}

// A backtick span can hold `a.ts:10` or `foo/bar.ts` or prose; pull path atoms.
function splitTokens(span) {
  const out = [];
  for (const raw of span.split(/[\s,;()]+/)) {
    const tok = raw.replace(/:\d+.*$/, "").replace(/^\.?\//, "").replace(/[.,]$/, "");
    if (!tok) continue;
    if (!CODE_EXT.test(tok)) continue;
    if (!/[a-zA-Z]/.test(tok)) continue;
    if (/[*[\]{}]/.test(tok)) continue; // glob/brace-list, not a concrete path
    if (!/[a-zA-Z0-9]\./.test(tok)) continue; // must have a real name before the ext (skips ".json")
    out.push(tok);
  }
  return out;
}

// ── PREDICATE SELF-TESTS ─────────────────────────────────────────────────────
// The floors below catch a population that collapsed to zero. These catch the
// subtler half: a predicate that still returns SOMETHING but the wrong thing —
// a tokeniser that stopped seeing paths, or a resolver that says yes to
// everything (which would make dangling refs vanish while the counts stay
// healthy). Both are run against the LIVE truth set, so they are canaries, not
// unit tests: if the repo enumeration broke, the positive canaries go red.
function selfTests() {
  const problems = [];
  const t = (name, ok) => {
    if (!ok) problems.push(name);
  };

  // extractRefs must still see both syntaxes it is responsible for.
  const backtick = extractRefs("the fix lands in `server/routes-deals.ts` today");
  t("extractRefs/backtick-span", backtick.has("server/routes-deals.ts"));
  const fileline = extractRefs("see server/storage.ts:1204 for the writer");
  t("extractRefs/file-colon-line", fileline.has("server/storage.ts"));

  // …and must still REJECT the shapes it is responsible for rejecting.
  t("extractRefs/rejects-prose", extractRefs("`a purely prose span here`").size === 0);
  t("extractRefs/rejects-glob", extractRefs("`server/**/*.ts`").size === 0);
  t("extractRefs/rejects-bare-ext", extractRefs("`.json`").size === 0);

  // resolves() — all three branches, against the live tracked set.
  t("resolves/full-path", resolves("scripts/check-ledger-refs.mjs") === true);
  t("resolves/basename", resolves("package.json") === true);
  t("resolves/suffix", resolves("company/deletion-ledger.md") === true);
  t(
    "resolves/negative",
    resolves("server/services/__ledger_refs_canary_no_such_file__.ts") === false,
  );

  return problems;
}

const selfTestFailures = selfTests();

// The deletion-ledger verdict table: scan only the ACTIVE rows. A row whose
// verdict/prose says "executed" legitimately references now-deleted files
// (an honest record, not a stale pointer a session would act on).
function activeVerdictRows(md) {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => l.trim() === "## Verdict table");
  // Unreachable while the ANCHOR SET below is checked first; kept as defence in
  // depth. This used to `return md` — "fail-open to whole file" — which quietly
  // swapped the scanned population for a different one.
  if (start === -1) {
    throw new Error(
      "deletion-ledger.md has no '## Verdict table' heading — the scoper cannot " +
        "identify the action-bearing rows.",
    );
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) { end = i; break; }
  }
  const rows = lines
    .slice(start, end)
    .filter((l) => l.startsWith("|") && !/executed/i.test(l));
  return { text: rows.join("\n"), rows: rows.length };
}

// The defect-registry: scan only the OPEN rows. A `### DEFECT-nnnn` block whose
// `Status:` is FIXED/RESOLVED/CLOSED/WONTFIX carries historical evidence that
// legitimately cites since-deleted or since-renamed files.
function openDefectBlocks(md) {
  const blocks = md.split(/^### /m);
  const out = [];
  for (const b of blocks) {
    const status = b.match(/^Status:\s*(\w+)/m)?.[1]?.toUpperCase();
    if (status && ["FIXED", "RESOLVED", "CLOSED", "WONTFIX", "DUPLICATE"].includes(status)) {
      continue;
    }
    out.push(b);
  }
  // NOTE: the split above CONSUMES the "### " markers, so the count of blocks
  // kept must be returned here — recovering it from the joined text is not
  // possible, and a counter that tried scored 1 instead of 25.
  return { text: out.join("\n"), rows: out.length };
}

// ── Gather refs ──────────────────────────────────────────────────────────────
// Each source carries the STRUCTURAL ANCHOR its scoper keys on, and its scoper
// returns { text, rows } so the number of UNITS scanned is reported alongside
// the refs pulled out of them — a scoper break and a tokeniser break then trip
// separately, instead of one masking the other.
const sources = [
  {
    file: "docs/company/deletion-ledger.md",
    anchor: /^## Verdict table$/m,
    anchorName: "'## Verdict table' heading",
    scope: (md) => activeVerdictRows(md),
    rowsKey: "ledgerVerdictRows",
    refsKey: "ledgerRefs",
  },
  {
    file: "docs/audits/defect-registry.md",
    anchor: /^### DEFECT-/m,
    anchorName: "'### DEFECT-nnnn' block heading",
    scope: (md) => openDefectBlocks(md),
    rowsKey: "registryOpenBlocks",
    refsKey: "registryRefs",
  },
];

// ── ANCHOR SET ───────────────────────────────────────────────────────────────
// (b) A source document that is not on disk is NOT skipped. Every source is a
// required anchor: if one is renamed or moved, this gate stops being able to
// see half of what it audits, and the honest report is a loud failure naming
// the missing file — not a quieter, cleaner-looking run over what is left.
// PARTIAL ANCHOR SETS FAIL EXPLICITLY, so "1 of 2 sources found" can never be
// mistaken for "all sources clean".
const anchorProblems = [];
for (const src of sources) {
  const abs = join(REPO, src.file);
  if (!existsSync(abs)) {
    anchorProblems.push(`MISSING FILE   ${src.file}`);
    continue;
  }
  const raw = readFileSync(abs, "utf8");
  if (!src.anchor.test(raw)) {
    anchorProblems.push(`MISSING ANCHOR ${src.file} — no ${src.anchorName}`);
  }
}

// ── Allowlist ────────────────────────────────────────────────────────────────
const allowPath = join(REPO, "scripts", "ledger-refs.allowlist.json");
let allow = [];
if (existsSync(allowPath)) {
  try {
    allow = JSON.parse(readFileSync(allowPath, "utf8"));
  } catch (e) {
    console.error(`[ledger-refs] allowlist parse error: ${e.message}`);
    process.exit(1);
  }
}
const allowSet = new Set(allow.map((a) => a.ref));

// ── Scan ─────────────────────────────────────────────────────────────────────
const populations = { trackedFiles: tracked.length };
const dangling = []; // { ref, file }

if (anchorProblems.length === 0) {
  for (const src of sources) {
    const abs = join(REPO, src.file);
    const { text, rows } = src.scope(readFileSync(abs, "utf8"));
    const refs = extractRefs(text);
    populations[src.rowsKey] = rows;
    populations[src.refsKey] = refs.size;
    for (const ref of refs) {
      if (allowSet.has(ref)) continue;
      if (!resolves(ref)) dangling.push({ ref, file: src.file });
    }
  }
}

// ── MINIMA: floors checked BEFORE any count may read as clean ────────────────
// A missing floor fails as loudly as a breached one, in BOTH directions: a
// population with no floor is unguarded, and a floor with no population is a
// key that stopped being measured (which is exactly how a scan goes dark).
const minimaProblems = [];
for (const [key, floor] of Object.entries(MINIMA)) {
  if (!(key in populations)) {
    minimaProblems.push(
      `NOT MEASURED   ${key} — floored at ${floor} but this run produced no value for it`,
    );
    continue;
  }
  if (populations[key] < floor) {
    minimaProblems.push(
      `BELOW FLOOR    ${key} = ${populations[key]}, floor ${floor}`,
    );
  }
}
for (const key of Object.keys(populations)) {
  if (!(key in MINIMA)) {
    minimaProblems.push(`UNFLOORED      ${key} = ${populations[key]} — no entry in MINIMA`);
  }
}

// ── Stale-allowlist hygiene: an allowlisted ref that now RESOLVES is stale ────
const staleAllow = allow.filter((a) => resolves(a.ref));

// ── Report ───────────────────────────────────────────────────────────────────
const popLine = Object.entries(populations)
  .map(([k, v]) => `${k}=${v}`)
  .join(" ");
console.log(`[ledger-refs] scan populations: ${popLine || "(none — scan did not run)"}`);

const blocked =
  selfTestFailures.length > 0 || anchorProblems.length > 0 || minimaProblems.length > 0;

if (!blocked && dangling.length === 0 && staleAllow.length === 0) {
  console.log(
    `[ledger-refs] OK — every cited source path in the verdict table + defect registry resolves on disk (allowlist: ${allow.length}).`,
  );
  process.exit(0);
}

if (selfTestFailures.length) {
  console.error(
    `\n[ledger-refs] ${selfTestFailures.length} PREDICATE SELF-TEST failure(s) — the scan's own logic is wrong, so no count from this run means anything:`,
  );
  for (const p of selfTestFailures) console.error(`  ✗ ${p}`);
}
if (anchorProblems.length) {
  console.error(
    `\n[ledger-refs] ANCHOR SET INCOMPLETE — ${anchorProblems.length} of ${sources.length} source(s) unusable. This gate audits prose that must EXIST; a source it cannot open is a broken scan, not a clean one:`,
  );
  for (const p of anchorProblems) console.error(`  ✗ ${p}`);
  console.error(
    "\nIf a source document moved, update the `sources` list in this script to the\n" +
      "new path. Do NOT drop the entry — the audit it performs would vanish with it.",
  );
}
if (minimaProblems.length) {
  console.error(
    `\n[ledger-refs] ${minimaProblems.length} VACUITY FLOOR problem(s) — a population is too small, unmeasured or unfloored, so a clean verdict would be meaningless:`,
  );
  for (const p of minimaProblems) console.error(`  ✗ ${p}`);
  console.error(
    "\nA drop here usually means the SCAN broke (a scoper heading renamed, a token\n" +
      "regex edited), not that the docs improved. Confirm which by reading the\n" +
      "populations above. If real progress genuinely shrank a population, lower\n" +
      "that floor in the SAME commit and name the work in this file's header.",
  );
}
if (dangling.length) {
  console.error(
    `\n[ledger-refs] ${dangling.length} DANGLING reference(s) — cited path does not exist on disk:`,
  );
  for (const d of dangling.sort((a, b) => a.file.localeCompare(b.file))) {
    console.error(`  ✗ ${d.ref}   (in ${d.file})`);
  }
  console.error(
    "\nFix the pointer to the real path, or — if the file is intentionally gone\n" +
      "and the prose says so — add it to scripts/ledger-refs.allowlist.json with a reason.",
  );
}
if (staleAllow.length) {
  console.error(
    `\n[ledger-refs] ${staleAllow.length} allowlist entr(y/ies) now RESOLVE on disk — remove them (the exemption is stale):`,
  );
  for (const a of staleAllow) console.error(`  ✗ ${a.ref}`);
}
process.exit(1);

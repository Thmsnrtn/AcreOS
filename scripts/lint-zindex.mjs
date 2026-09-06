#!/usr/bin/env node
// ============================================================================
// scripts/lint-zindex.mjs — Tahoe F1: no ad-hoc z-index in client/src .tsx.
// ----------------------------------------------------------------------------
// Why
// ───
// z-index was the single most undesigned layer in the app: scattered `z-50`
// (52 sites), `z-10` (44), plus arbitrary escalations `z-[60]`/`z-[100]`/
// `z-[9998]`/`z-[9999]`/`z-[49]`. The same numbers were reused for unrelated
// roles, which produced real stacking bugs (FAB-over-FAB; founder tab list
// over the settings gear). Tahoe Wave F1 codified a SEMANTIC scale in
// tailwind.config.ts (`theme.extend.zIndex`) + `--z-*` in index.css + the
// runtime `Z` registry in client/src/lib/z-index.ts. Future code says
// `z-modal`, never `z-50`; `z-toast`, never `z-[100]`.
//
// This ratchet locks that in. Two offender classes:
//
//   1. ARBITRARY z-[…] (the genuinely-undesigned escapees). These were all
//      migrated to semantic tokens in F1, so the baseline is ZERO — any new
//      raw `z-[…]` in a .tsx FAILS the build. Use a semantic token, or (for a
//      genuinely one-off computed value) `style={{ zIndex: "var(--z-…)" }}`.
//
//   2. RAW NUMERIC z-N in the scale (z-0/1/10/20/30/40/50/60). 118 pre-existing
//      sites across 69 files are BASELINED below and drive-to-zero: migrate a
//      site to its semantic token (z-10 → z-docked, z-50 → z-floating, …) and
//      decrement/delete the file's entry in the SAME commit. No NEW raw numeric
//      z-N may appear in a file that is not in the baseline (or above its
//      baseline count).
//
// Token map (value → token), for migrators:
//   0 base · 1 raised · 10 docked · 20 dropdown · 30 sticky · 40 overlay
//   48 slot-help · 49 slot-tray · 50 floating · 60 modal · 100 toast
//   110 offline · 9990 tour · 9998 island · 9999 spotlight · 10000 max
//
// Ratchet contract (bidirectional, same family as lint-page-hex.mjs):
//   - per-file count >  baseline → FAIL (new ad-hoc z-index — use a token)
//   - per-file count <  baseline → FAIL (tighten the baseline in-commit)
//   - count == baseline           → PASS
//   - files NOT in the baseline must have zero raw z-N / z-[…].
//
// Arbitrary z-[…] are counted with a flat baseline of 0 (none survive), so any
// occurrence in any file is a new offender.
//
// ----------------------------------------------------------------------------
// VACUITY FLOORS — READ BEFORE TOUCHING. DO NOT REMOVE.
// ----------------------------------------------------------------------------
// THE BASELINE IS EMPTY (`new Map([])`, emptied 2026-07-02), AND THAT REMOVED
// THIS GATE'S ONLY ACCIDENTAL VACUITY PROTECTION. Its siblings in this family
// (lint-page-hex, check-org-scoped-fetch, lint-css-hover) get partial cover for
// free from the STALE-ENTRY direction of the ratchet: a scan that goes blind
// leaves every baselined file unseen, so those gates fail "stale baseline
// entries" instead of printing PASS. With an EMPTY map, `[...BASELINE.keys()]`
// is `[]`, `staleEntries` is `[]` and `numericImprovements` is `[]` NO MATTER
// WHAT THE SCAN DID — the stale-entry check can never fire, by construction.
// Every other term is a count of BAD THINGS FOUND, so an empty walk drives all
// of them to 0 and this gate prints, at exit 0:
//
//     [lint-zindex] scanned 0 tsx files; raw numeric z-N: 0, arbitrary z-[…]: 0,
//     arbitrary offenders: 0 file(s), numeric over baseline: 0 file(s),
//     stale baseline entries: 0
//     [lint-zindex] PASS
//
// SO THE FLOORS BELOW ARE THE ONLY THING STANDING BETWEEN A BLIND SCAN AND A
// GREEN BUILD. They are not decoration and they must not be removed, loosened
// or "temporarily" bypassed — deleting one silently returns this gate to the
// state above. A MISSING floor therefore fails exactly as loudly as a breached
// one. (References for this shape: `minima.files` in scripts/ratchet.mjs, which
// also rejects a floor of 0 as "not a floor", and `minima` in
// scripts/ratchets/reachability.json.) If the baseline is ever repopulated,
// these floors STILL stay — a stale-entry check is a weaker guard than a
// measured population floor, not a substitute for one.
//
// TWO populations are floored, because the file walk is not the only thing that
// can break:
//   · tsxFiles      — the walk itself. Measured 2026-08-16: 718 .tsx files
//                     under client/src → floor 540 (~75% of live).
//   · semanticTokens — a CANARY POPULATION, and the reason it exists is
//                     specific: with the baseline emptied, both offender
//                     predicates (ARBITRARY_RE, NUMERIC_RE) legitimately match
//                     ZERO in a healthy tree, so neither can prove the line
//                     scan or maskComments() still work. The semantic tokens
//                     they were migrated TO (z-modal/z-floating/z-docked/…) are
//                     the live z-index vocabulary in the same files, counted
//                     through the SAME mask and the SAME per-line loop. If
//                     maskComments() mispairs and blanks the source (this repo
//                     has already been bitten by exactly that — a comment
//                     stripper that blanked the lines a scan was counting), or
//                     the per-line regex loop rots, this count collapses and
//                     the gate fails instead of congratulating itself.
//                     Measured 2026-08-16 (`--measure`, POST-mask, which is the
//                     number the gate compares): 136 occurrences across 75
//                     files → floor 100 (~74% of live). Note the pre-mask raw
//                     grep is 161; the 25-occurrence gap is doc comments, and
//                     counting the masked figure is deliberate — the mask is
//                     part of what this canary is proving still works.
// Floors are checked BEFORE any verdict prints, and only on a FULL-SCOPE run —
// an explicit-target run is a fixture (see Usage), where a tiny population is
// the point, exactly as the stale-baseline check is already skipped there.
//
// If a real migration wave takes a population under its floor, LOWER the floor
// in the same commit and record the new measurement here. Never raise a floor
// to silence something, and never delete one.
//
// Usage:
//   node scripts/lint-zindex.mjs              # full client/src .tsx scope (CI)
//   node scripts/lint-zindex.mjs <dir|file> … # explicit targets (fixture tests;
//                                             #  stale-baseline + floor checks
//                                             #  skipped)
//   node scripts/lint-zindex.mjs --measure    # print counts, never fail
//
// Exit codes: 0 — clean; 1 — new offender, stale baseline entry, or a scan
// population below its floor (a broken scan is a failure, not good news).
// ============================================================================

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { stripCommentsPreservingLines as maskComments } from "./lib/strip-comments.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const DEFAULT_SCOPE = join(REPO_ROOT, "client", "src");

// ----------------------------------------------------------------------------
// Baseline allowlist — pre-existing RAW NUMERIC `z-N` literals, frozen so the
// lint lands now and blocks regressions. Keys are repo-relative paths, values
// are the EXACT current count of `z-{0,1,10,20,30,40,50,60}` class tokens.
// The list only ratchets DOWN: migrate a site to its semantic token
// (z-50 → z-floating, etc.), then decrement/delete the entry in the same
// commit. NEW entries are not allowed — a file not listed here must be zero.
//
// Arbitrary `z-[…]` have NO baseline entries (all migrated in F1); any new one
// fails regardless of file.
// ----------------------------------------------------------------------------
// Baseline emptied 2026-07-02: every raw numeric z-N in client/src (95 sites,
// 65 files, ui/ primitives included) was migrated to the same-valued semantic
// tokens (z-docked/dropdown/sticky/overlay/floating — value-identical, so
// rendering is unchanged). Any new raw z-N fails this lint outright.
const BASELINE = new Map([]);

// ----------------------------------------------------------------------------
// VACUITY FLOORS — the ONLY vacuity protection this gate has, because BASELINE
// is empty and the stale-entry check therefore cannot fire. See the header.
// Every key is REQUIRED; a missing/zero/non-integer floor fails as loudly as a
// breached one, so the guard cannot be removed by deleting a line.
// Measured 2026-08-16 (node scripts/lint-zindex.mjs --measure).
// ----------------------------------------------------------------------------
const FLOORS = {
  tsxFiles: 540, //       live 718 .tsx files under client/src
  semanticTokens: 100, // live 136 semantic z-* occurrences (post-mask) / 75 files
};
const REQUIRED_FLOORS = ["tsxFiles", "semanticTokens"];

const args = process.argv.slice(2);
const MEASURE_ONLY = args.includes("--measure");
const explicitTargets = args.filter((a) => a !== "--measure");

// ----------------------------------------------------------------------------
// File walking — client/src **/*.tsx only (the scale's enforcement scope).
// ----------------------------------------------------------------------------
function walkTsx(target, out = []) {
  const st = statSync(target, { throwIfNoEntry: false });
  if (!st) return out;
  if (st.isFile()) {
    if (target.endsWith(".tsx")) out.push(target);
    return out;
  }
  for (const entry of readdirSync(target).sort()) {
    if (entry.startsWith(".") || entry === "node_modules" || entry === "dist") continue;
    walkTsx(join(target, entry), out);
  }
  return out;
}

// Arbitrary Tailwind z-index: `z-[…]`, optionally prefixed by a variant
// (`focus:z-[100]`, `md:z-[60]`). The `(^|[^\w-])` guard avoids matching the
// tail of an unrelated token.
const ARBITRARY_RE = /(^|[^\w-])z-\[[^\]]*\]/g;
// Raw numeric z-index in the semantic scale. Variant-prefixed forms count too.
// \b after the number prevents z-1 matching z-10 / z-100, etc.
const NUMERIC_RE = /(^|[^\w-])z-(0|1|10|20|30|40|50|60)\b/g;
// CANARY population: the SEMANTIC tokens the raw values were migrated to in F1.
// Both offender predicates above legitimately measure ZERO in a healthy tree,
// so neither can prove the scan still works; these run through the same mask
// and the same per-line loop and are expected to stay plentiful. See header.
const SEMANTIC_RE =
  /(^|[^\w-])z-(base|raised|docked|dropdown|sticky|overlay|slot-help|slot-tray|floating|modal|toast|offline|tour|island|spotlight|max)\b/g;

/** Scan one masked .tsx source; return { arbitrary:[…], numeric:[…], semantic:n }. */
function findOffenders(source) {
  const masked = maskComments(source);
  const arbitrary = [];
  const numeric = [];
  let semantic = 0;
  const lines = masked.split("\n");
  for (let li = 0; li < lines.length; li++) {
    ARBITRARY_RE.lastIndex = 0;
    let m;
    while ((m = ARBITRARY_RE.exec(lines[li])) !== null) {
      arbitrary.push({ line: li + 1, snippet: m[0].trim() });
    }
    NUMERIC_RE.lastIndex = 0;
    while ((m = NUMERIC_RE.exec(lines[li])) !== null) {
      numeric.push({ line: li + 1, snippet: `z-${m[2]}` });
    }
    SEMANTIC_RE.lastIndex = 0;
    while (SEMANTIC_RE.exec(lines[li]) !== null) semantic += 1;
  }
  return { arbitrary, numeric, semantic };
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------
function main() {
  const fullScope = explicitTargets.length === 0;
  const roots = fullScope
    ? [DEFAULT_SCOPE]
    : explicitTargets.map((t) => (isAbsolute(t) ? t : resolve(REPO_ROOT, t)));

  const files = roots.flatMap((r) => walkTsx(r));
  const perFile = new Map(); // rel → { arbitrary, numeric }
  let semanticTokens = 0; // canary population — see header
  let semanticFiles = 0;

  for (const file of files) {
    const rel = file.startsWith(REPO_ROOT + "/") ? relative(REPO_ROOT, file) : file;
    const res = findOffenders(readFileSync(file, "utf8"));
    if (res.semantic > 0) {
      semanticTokens += res.semantic;
      semanticFiles += 1;
    }
    if (res.arbitrary.length > 0 || res.numeric.length > 0) perFile.set(rel, res);
  }

  if (MEASURE_ONLY) {
    console.log(
      `[lint-zindex] measured ${files.length} tsx files; ` +
        `semantic z-* tokens: ${semanticTokens} across ${semanticFiles} file(s)`,
    );
    for (const [rel, { arbitrary, numeric }] of perFile) {
      console.log(`  ${rel}: ${numeric.length} numeric, ${arbitrary.length} arbitrary`);
      for (const o of [...arbitrary, ...numeric]) console.log(`    L${o.line}  ${o.snippet}`);
    }
    process.exit(0);
  }

  // ── Vacuity guard, BEFORE any verdict. With BASELINE empty this is the only
  // ── thing that can distinguish "0 offenders" from "0 files read". Skipped on
  // ── explicit-target (fixture) runs, exactly as the stale-baseline check is.
  const vacuity = [];
  if (fullScope) {
    const populations = [
      ["tsxFiles", ".tsx files walked under client/src", files.length],
      ["semanticTokens", "semantic z-* token occurrences (scan canary)", semanticTokens],
    ];
    for (const key of REQUIRED_FLOORS) {
      if (!(key in FLOORS)) {
        vacuity.push(
          `FLOORS.${key} is MISSING. BASELINE is empty, so the stale-entry check can never ` +
            `fire and these floors are this gate's ONLY vacuity protection. Restore the key; ` +
            `do not delete it.`,
        );
      }
    }
    for (const [key, label, observed] of populations) {
      const floor = FLOORS[key];
      if (floor === undefined) continue; // reported as MISSING above
      if (!Number.isInteger(floor) || floor < 1) {
        vacuity.push(
          `FLOORS.${key} must be an integer >= 1 (got ${JSON.stringify(floor)}). A floor of 0 ` +
            `is not a floor — it admits the empty scan this guard exists to catch.`,
        );
      } else if (observed < floor) {
        vacuity.push(
          `VACUOUS SCAN — ${label}: ${observed}, below the floor of ${floor}. Every count this ` +
            `gate prints is a count of BAD THINGS FOUND, so a scan that stopped seeing things ` +
            `reports zero and reads as PASS.\n` +
            `      Suspect walkTsx(), a moved client/src, maskComments() blanking the source, or ` +
            `the per-line regex loop before you suspect progress. If a real migration wave ` +
            `genuinely shrank this population, lower FLOORS.${key} in scripts/lint-zindex.mjs in ` +
            `the SAME commit and record the new measurement in the header. Never raise a floor ` +
            `to silence something, and never delete one.`,
        );
      }
    }
  }

  const arbitraryOffenders = []; // any arbitrary z-[…] at all
  const numericOver = [];        // numeric count above baseline
  const numericImprovements = [];// numeric count below baseline (tighten)
  for (const [rel, { arbitrary, numeric }] of perFile) {
    if (arbitrary.length > 0) arbitraryOffenders.push({ rel, offenders: arbitrary });
    const allowed = BASELINE.get(rel) ?? 0;
    if (numeric.length > allowed) numericOver.push({ rel, allowed, offenders: numeric });
    else if (numeric.length < allowed) numericImprovements.push({ rel, allowed, count: numeric.length });
  }
  const staleEntries = fullScope
    ? [...BASELINE.keys()].filter((rel) => {
        const res = perFile.get(rel);
        return !res || res.numeric.length === 0;
      })
    : [];

  const totalNumeric = [...perFile.values()].reduce((n, o) => n + o.numeric.length, 0);
  const totalArbitrary = [...perFile.values()].reduce((n, o) => n + o.arbitrary.length, 0);
  console.log(
    `[lint-zindex] scanned ${files.length} tsx files (floor ${fullScope ? FLOORS.tsxFiles : "n/a — fixture run"}); ` +
      `semantic z-* canary: ${semanticTokens}` +
      (fullScope ? ` (floor ${FLOORS.semanticTokens})` : "") +
      `; raw numeric z-N: ${totalNumeric}, arbitrary z-[…]: ${totalArbitrary}, ` +
      `arbitrary offenders: ${arbitraryOffenders.length} file(s), ` +
      `numeric over baseline: ${numericOver.length} file(s), ` +
      `stale baseline entries: ${staleEntries.length + (fullScope ? numericImprovements.length : 0)}`,
  );

  if (vacuity.length > 0) {
    console.error("");
    console.error("[lint-zindex] FAIL — the gate itself is not trustworthy right now:");
    for (const v of vacuity) console.error(`  ✗ ${v}`);
    console.error("");
    process.exit(1);
  }

  const clean =
    arbitraryOffenders.length === 0 &&
    numericOver.length === 0 &&
    staleEntries.length === 0 &&
    (!fullScope || numericImprovements.length === 0);
  if (clean) {
    console.log("[lint-zindex] PASS");
    process.exit(0);
  }

  if (arbitraryOffenders.length > 0) {
    console.error("");
    console.error(
      "[lint-zindex] FAIL — raw arbitrary z-[…] in client/src .tsx. The " +
        "z-index scale is semantic: use a token (z-modal/z-toast/z-floating/…) " +
        "from tailwind.config.ts, or `style={{ zIndex: \"var(--z-…)\" }}` for a " +
        "genuinely computed value. See client/src/lib/z-index.ts.",
    );
    console.error("");
    for (const { rel, offenders } of arbitraryOffenders) {
      console.error(`  ${rel} — ${offenders.length} arbitrary:`);
      for (const o of offenders) console.error(`    L${o.line}  ${o.snippet}`);
    }
    console.error("");
  }

  if (numericOver.length > 0) {
    console.error("");
    console.error(
      "[lint-zindex] FAIL — raw numeric z-N above baseline. Use a semantic " +
        "token: z-10 → z-docked, z-20 → z-dropdown, z-30 → z-sticky, " +
        "z-40 → z-overlay, z-50 → z-floating, z-60 → z-modal.",
    );
    console.error("");
    for (const { rel, allowed, offenders } of numericOver) {
      console.error(`  ${rel} — ${offenders.length} numeric (baseline ${allowed}):`);
      for (const o of offenders) console.error(`    L${o.line}  ${o.snippet}`);
    }
    console.error("");
  }

  if (fullScope && (staleEntries.length > 0 || numericImprovements.length > 0)) {
    console.error("");
    console.error(
      "[lint-zindex] FAIL — BASELINE entries are stale (z-index was migrated " +
        "to tokens — good!). Tighten the baseline in scripts/lint-zindex.mjs so " +
        "the ratchet locks in the improvement:",
    );
    for (const rel of staleEntries) console.error(`  - "${rel}" → remove entry`);
    for (const { rel, allowed, count } of numericImprovements)
      console.error(`  - "${rel}" → lower ${allowed} to ${count}`);
    console.error("");
  }

  process.exit(1);
}

main();

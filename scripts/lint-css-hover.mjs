#!/usr/bin/env node
// ============================================================================
// scripts/lint-css-hover.mjs — W2-10(a): no ungated `:hover` in *.css files.
// ----------------------------------------------------------------------------
// Why
// ───
// iOS Safari emulates hover on touch: the FIRST tap of an element with a raw
// `:hover` rule applies the hover state and swallows the tap's click, forcing
// a double tap (memory lock: feedback_ios_double_tap_hover). The house
// pattern wraps every hover rule in `@media (hover: hover)` — see
// client/src/pages/today.css and the W1-9 landing.css fix.
//
// What it does
// ────────────
// CSS-aware scan (NOT a naive grep): walks every *.css under client/src,
// masks /* … */ comments, then tracks block nesting by brace depth. A
// declaration block whose selector prelude contains `:hover` is an offender
// UNLESS some enclosing `@media` query contains `hover: hover` (compound
// queries like `(hover: hover) and (pointer: fine)` count as gated).
//
// Ratchet contract (same discipline as check-org-scoped-fetch.mjs /
// ratchet.mjs, bidirectional):
//   - per-file count >  baseline → FAIL (new ungated hover — gate it)
//   - per-file count <  baseline → FAIL (improvement landed; tighten the
//                                        baseline in the same commit)
//   - count == baseline           → PASS
//   - any file NOT in the baseline must have zero ungated hovers.
//
// ----------------------------------------------------------------------------
// VACUITY FLOORS — READ BEFORE TOUCHING. DO NOT REMOVE.
// ----------------------------------------------------------------------------
// THE BASELINE IS EMPTY (`new Map([])`, emptied 2026-07-02), AND THAT REMOVED
// THIS GATE'S ONLY ACCIDENTAL VACUITY PROTECTION. The bidirectional ratchet
// contract above normally gives a gate in this family partial cover for free:
// a scan that goes blind leaves every baselined file unseen, so it fails
// "stale baseline entries" instead of printing PASS. With an EMPTY map,
// `[...BASELINE.keys()]` is `[]`, so `staleEntries` and `improvements` are `[]`
// NO MATTER WHAT THE SCAN DID — that half of the ratchet can never fire, by
// construction. Every remaining term counts BAD THINGS FOUND, so an empty walk
// drives all of them to 0 and this gate prints, at exit 0:
//
//     [lint-css-hover] scanned 0 css files; :hover rules: 0, ungated: 0,
//     new offenders: 0 file(s), stale baseline entries: 0
//     [lint-css-hover] PASS
//
// SO THE FLOORS BELOW ARE THE ONLY THING STANDING BETWEEN A BLIND SCAN AND A
// GREEN BUILD. They are not decoration and must not be removed, loosened or
// "temporarily" bypassed — deleting one silently returns this gate to the state
// above. A MISSING floor therefore fails exactly as loudly as a breached one.
// (References for this shape: `minima.files` in scripts/ratchet.mjs, which also
// rejects a floor of 0 as "not a floor", and `minima` in
// scripts/ratchets/reachability.json.) If the baseline is ever repopulated,
// these floors STILL stay — a stale-entry check is a weaker guard than a
// measured population floor, not a substitute for one.
//
// TWO populations are floored, because the file walk is not the only thing that
// can break:
//   · cssFiles   — the walk itself. Measured 2026-08-16: 6 *.css files under
//                  client/src (fonts.css, index.css, components/onboarding/
//                  onboarding.css, pages/landing/landing.css, pages/styles/
//                  onboarding-v2.css, pages/today.css) → floor 4. A small
//                  population, so the floor is stated as a count and not a
//                  percentage: 0-3 files means the walk broke or the app's
//                  stylesheets moved, and either way the verdict is worthless.
//   · hoverRules — a CANARY POPULATION, and the reason it exists is specific:
//                  in a healthy tree the OFFENDER predicate legitimately
//                  measures ZERO, so it can never prove the parser still works.
//                  This gate is not a grep — it masks comments and tracks brace
//                  depth — and the exact failure this repo has already paid for
//                  is a comment stripper that mispaired and BLANKED the very
//                  lines a scan was counting. That failure leaves cssFiles at 6
//                  and every count at 0. Flooring the `:hover` occurrences the
//                  masker emits catches it. Measured 2026-08-16: 53 post-mask
//                  (58 raw; the 5-occurrence gap is comment text, and counting
//                  the masked figure is deliberate — the mask is part of what
//                  this canary proves still works) → floor 38 (~72% of live).
// Floors are checked BEFORE any verdict prints, and only on a FULL-SCOPE run —
// an explicit-target run is a fixture (see Usage), where a one-file population
// is the point, exactly as the stale-baseline check is already skipped there.
//
// If a real restyling wave takes a population under its floor, LOWER the floor
// in the same commit and record the new measurement here. Never raise a floor
// to silence something, and never delete one.
//
// Usage:
//   node scripts/lint-css-hover.mjs              # full client/src scope (CI)
//   node scripts/lint-css-hover.mjs <dir|file> … # explicit targets (fixture
//                                                #  tests; stale-baseline +
//                                                #  floor checks are skipped)
//   node scripts/lint-css-hover.mjs --measure    # print counts, never fail
//
// Exit codes: 0 — clean; 1 — new offender, stale baseline entry, or a scan
// population below its floor (a broken scan is a failure, not good news).
// ============================================================================

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const DEFAULT_SCOPE = join(REPO_ROOT, "client", "src");

// ----------------------------------------------------------------------------
// Baseline allowlist — pre-existing ungated `:hover` rules, frozen so the
// lint lands NOW and blocks regressions. Keys are repo-relative paths,
// values are the EXACT current ungated count. The list only ratchets DOWN:
// gate a rule with `@media (hover: hover)`, then decrement/delete the entry
// in the same commit. NEW entries require Iris-CTO sign-off.
// ----------------------------------------------------------------------------
// Baseline emptied 2026-07-02: the final 17 ungated :hover rules (index.css
// scrollbar chrome + both onboarding stylesheets) were wrapped in
// @media (hover: hover). Every CSS file must now be fully gated — any new
// ungated :hover fails this lint outright.
const BASELINE = new Map([]);

// ----------------------------------------------------------------------------
// VACUITY FLOORS — the ONLY vacuity protection this gate has, because BASELINE
// is empty and the stale-entry half of the ratchet therefore cannot fire. See
// the header. Every key is REQUIRED; a missing/zero/non-integer floor fails as
// loudly as a breached one, so the guard cannot be removed by deleting a line.
// Measured 2026-08-16 (node scripts/lint-css-hover.mjs --measure).
// ----------------------------------------------------------------------------
const FLOORS = {
  cssFiles: 4, //     live 6 *.css files under client/src
  hoverRules: 38, //  live 53 post-mask `:hover` occurrences (58 raw)
};
const REQUIRED_FLOORS = ["cssFiles", "hoverRules"];

const args = process.argv.slice(2);
const MEASURE_ONLY = args.includes("--measure");
const explicitTargets = args.filter((a) => a !== "--measure");

// ----------------------------------------------------------------------------
// File walking
// ----------------------------------------------------------------------------
function walkCss(target, out = []) {
  const st = statSync(target, { throwIfNoEntry: false });
  if (!st) return out;
  if (st.isFile()) {
    if (target.endsWith(".css")) out.push(target);
    return out;
  }
  for (const entry of readdirSync(target).sort()) {
    if (entry.startsWith(".") || entry === "node_modules" || entry === "dist") continue;
    walkCss(join(target, entry), out);
  }
  return out;
}

// ----------------------------------------------------------------------------
// CSS comment masking — same-length output so line numbers map 1:1.
// CSS has only /* … */ comments; string literals (url("…"), content: "…")
// are respected so a `/*` inside a string doesn't open a phantom comment.
// ----------------------------------------------------------------------------
function maskCssComments(source) {
  const out = source.split("");
  let inString = null;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (ch === "\\") i += 1;
      else if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] !== "\n") out[i] = " ";
        i++;
      }
      if (i < source.length) {
        out[i] = " ";
        out[i + 1] = " ";
        i += 1;
      }
    }
  }
  return out.join("");
}

const HOVER_GATE_RE = /hover\s*:\s*hover/i;
const HOVER_SELECTOR_RE = /:hover/i;

/**
 * Scan one CSS source; return [{ line, selector }] for every declaration
 * block whose prelude contains `:hover` with no enclosing hover-gated @media.
 */
function findUngatedHovers(source) {
  const masked = maskCssComments(source);
  const offenders = [];
  // Stack of booleans: is this block (or an ancestor) a hover-gated @media?
  const gateStack = [];
  let prelude = "";
  let preludeLine = 1;
  let line = 1;

  for (let i = 0; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === "\n") line += 1;

    if (ch === "{") {
      const text = prelude.trim();
      const parentGated = gateStack.length > 0 && gateStack[gateStack.length - 1];
      const isGatingMedia =
        text.startsWith("@media") && HOVER_GATE_RE.test(text);
      if (!parentGated && !text.startsWith("@") && HOVER_SELECTOR_RE.test(text)) {
        offenders.push({ line: preludeLine, selector: text.replace(/\s+/g, " ").slice(0, 100) });
      }
      gateStack.push(parentGated || isGatingMedia);
      prelude = "";
      preludeLine = line;
    } else if (ch === "}") {
      gateStack.pop();
      prelude = "";
      preludeLine = line;
    } else if (ch === ";") {
      // End of a declaration / at-rule without block (e.g. @import).
      prelude = "";
      preludeLine = line;
    } else {
      // Pin the offender's reported line to the prelude's first
      // NON-WHITESPACE character (the prelude buffer also accumulates the
      // newlines that precede the selector).
      if (prelude.trim() === "" && !/\s/.test(ch)) preludeLine = line;
      prelude += ch;
    }
  }
  return offenders;
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------
function main() {
  const fullScope = explicitTargets.length === 0;
  const roots = fullScope
    ? [DEFAULT_SCOPE]
    : explicitTargets.map((t) => (isAbsolute(t) ? t : resolve(REPO_ROOT, t)));

  const files = roots.flatMap((r) => walkCss(r));
  const perFile = new Map(); // rel → offenders[]
  let totalHoverRules = 0;

  for (const file of files) {
    const rel = file.startsWith(REPO_ROOT + "/") ? relative(REPO_ROOT, file) : file;
    const source = readFileSync(file, "utf8");
    totalHoverRules += (maskCssComments(source).match(/:hover/gi) || []).length;
    const offenders = findUngatedHovers(source);
    if (offenders.length > 0) perFile.set(rel, offenders);
  }

  if (MEASURE_ONLY) {
    console.log(
      `[lint-css-hover] measured ${files.length} css files; ` +
        `:hover rules (post-mask canary): ${totalHoverRules}`,
    );
    for (const [rel, offenders] of perFile) {
      console.log(`  ${rel}: ${offenders.length} ungated`);
      for (const o of offenders) console.log(`    L${o.line}  ${o.selector}`);
    }
    process.exit(0);
  }

  // ── Vacuity guard, BEFORE any verdict. With BASELINE empty this is the only
  // ── thing that can distinguish "0 ungated" from "0 files read" / "0 lines
  // ── survived the comment masker". Skipped on explicit-target (fixture) runs,
  // ── exactly as the stale-baseline check is.
  const vacuity = [];
  if (fullScope) {
    const populations = [
      ["cssFiles", "*.css files walked under client/src", files.length],
      ["hoverRules", "`:hover` occurrences seen post-mask (parser canary)", totalHoverRules],
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
            `      Suspect walkCss(), a moved client/src, or maskCssComments() mispairing and ` +
            `blanking the source before you suspect progress. If a real restyling wave genuinely ` +
            `shrank this population, lower FLOORS.${key} in scripts/lint-css-hover.mjs in the ` +
            `SAME commit and record the new measurement in the header. Never raise a floor to ` +
            `silence something, and never delete one.`,
        );
      }
    }
  }

  const newOffenders = [];
  const improvements = [];
  for (const [rel, offenders] of perFile) {
    const allowed = BASELINE.get(rel) ?? 0;
    if (offenders.length > allowed) newOffenders.push({ rel, allowed, offenders });
    else if (offenders.length < allowed) improvements.push({ rel, allowed, count: offenders.length });
  }
  const staleEntries = fullScope
    ? [...BASELINE.keys()].filter((rel) => !perFile.has(rel))
    : [];

  const totalUngated = [...perFile.values()].reduce((n, o) => n + o.length, 0);
  console.log(
    `[lint-css-hover] scanned ${files.length} css files (floor ${fullScope ? FLOORS.cssFiles : "n/a — fixture run"}); ` +
      `:hover rules: ${totalHoverRules}` +
      (fullScope ? ` (floor ${FLOORS.hoverRules})` : "") +
      `, ungated: ${totalUngated}, ` +
      `new offenders: ${newOffenders.length} file(s), ` +
      `stale baseline entries: ${staleEntries.length + (fullScope ? improvements.length : 0)}`,
  );

  if (vacuity.length > 0) {
    console.error("");
    console.error("[lint-css-hover] FAIL — the gate itself is not trustworthy right now:");
    for (const v of vacuity) console.error(`  ✗ ${v}`);
    console.error("");
    process.exit(1);
  }

  if (newOffenders.length === 0 && staleEntries.length === 0 && (!fullScope || improvements.length === 0)) {
    console.log("[lint-css-hover] PASS");
    process.exit(0);
  }

  if (newOffenders.length > 0) {
    console.error("");
    console.error(
      "[lint-css-hover] FAIL — ungated `:hover` above baseline. Raw :hover " +
        "makes iOS Safari require TWO taps (first tap = hover emulation). " +
        "Wrap the rule in `@media (hover: hover) { … }` — see " +
        "client/src/pages/today.css for the house pattern.",
    );
    console.error("");
    for (const { rel, allowed, offenders } of newOffenders) {
      console.error(`  ${rel} — ${offenders.length} ungated (baseline ${allowed}):`);
      for (const o of offenders) console.error(`    L${o.line}  ${o.selector}`);
    }
    console.error("");
  }

  if (fullScope && (staleEntries.length > 0 || improvements.length > 0)) {
    console.error("");
    console.error(
      "[lint-css-hover] FAIL — BASELINE entries are stale (offenders were " +
        "fixed — good!). Tighten the baseline in scripts/lint-css-hover.mjs " +
        "so the ratchet locks in the improvement:",
    );
    for (const rel of staleEntries) console.error(`  - "${rel}" → remove entry`);
    for (const { rel, allowed, count } of improvements)
      console.error(`  - "${rel}" → lower ${allowed} to ${count}`);
    console.error("");
  }

  process.exit(1);
}

main();

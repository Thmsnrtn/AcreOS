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
// Usage:
//   node scripts/lint-css-hover.mjs              # full client/src scope (CI)
//   node scripts/lint-css-hover.mjs <dir|file> … # explicit targets (fixture
//                                                #  tests; stale-baseline
//                                                #  check is skipped)
//   node scripts/lint-css-hover.mjs --measure    # print counts, never fail
//
// Exit codes: 0 — clean; 1 — new offender or stale baseline entry.
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
    console.log(`[lint-css-hover] measured ${files.length} css files`);
    for (const [rel, offenders] of perFile) {
      console.log(`  ${rel}: ${offenders.length} ungated`);
      for (const o of offenders) console.log(`    L${o.line}  ${o.selector}`);
    }
    process.exit(0);
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
    `[lint-css-hover] scanned ${files.length} css files; ` +
      `:hover rules: ${totalHoverRules}, ` +
      `ungated: ${totalUngated}, ` +
      `new offenders: ${newOffenders.length} file(s), ` +
      `stale baseline entries: ${staleEntries.length + (fullScope ? improvements.length : 0)}`,
  );

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

#!/usr/bin/env node
// ============================================================================
// scripts/lint-dead-token-alpha.mjs — a Tailwind class that compiles to nothing
// ----------------------------------------------------------------------------
// THE DEFECT
//
//   className="border-[color:var(--acr-brand)]/30"
//
// emits NO CSS RULE AT ALL. Not a rule without the alpha — nothing. Tailwind's
// `pluginUtils.asColor` splits the candidate, calls
// `withAlphaValue(normalizedColor, '0.3')`, and `parseColor` returns null for a
// `var()`, so `withAlphaValue` returns its undefined default and the candidate
// is dropped on the floor. Verified against tailwindcss@3.4.19 and against the
// shipped bundle: `tr '}' '\n' < dist/public/assets/index-*.css | grep 'var(--acr'`
// returned 30 arbitrary-value selectors and ZERO carrying a `/NN` suffix.
//
// It is invisible in every way that matters. The build succeeds, the class name
// is right there in the JSX, code review reads it as intentional, and the
// element merely falls back to whatever border or background it would have had
// anyway — so the page looks *plausible* rather than broken. Twenty of these
// had accumulated across eight files, including the two dismissible cards on
// Today and every urgency tint on the market watchlist.
//
// THE SPELLING THAT WORKS is the token form the tailwind config already
// provides, because `acrToken` handles the alpha itself with `color-mix`:
//
//   border-acr-brand/30   ->  border-color: color-mix(in srgb, var(--acr-brand) 30%, transparent)
//
// So this lint is narrow on purpose: the arbitrary-value spelling is FINE
// without an alpha modifier (`bg-[color:var(--acr-brand)]` emits correctly),
// and the token spelling is fine with one. Only the combination is dead, and
// the combination is what it forbids.
//
// WHY A LINT RATHER THAN A ONE-TIME SWEEP. The config's own header comment
// already documents this exact failure for the token form — "before this
// wrapper, `bg-acr-pos/10` silently compiled to NOTHING" — and the wrapper
// fixed that spelling only. Nothing stopped the arbitrary spelling from
// reintroducing it, and nothing noticed for twenty sites. A class that silently
// does nothing is not a style bug; it is a gate-shaped hole in the design
// system, and it needs a gate.
// ============================================================================

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC = join(ROOT, "client", "src");

/**
 * Any Tailwind utility prefix that takes a color, followed by an
 * arbitrary-value `var(--acr-…)` and an alpha modifier.
 *
 * The prefix list is open (`[a-z-]+`) rather than enumerated: a new
 * color utility must not be a new way to write a dead class.
 */
const DEAD = /\b[a-z-]+-\[(?:color|border-color|background-color|fill|stroke):var\(--[a-z0-9-]+\)\]\/\d{1,3}/g;

/** Files the walk found — a floor, so a broken walk cannot report "clean". */
let scanned = 0;
const offenders = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full, { throwIfNoEntry: false });
    if (!st) continue;
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === "__tests__") continue;
      walk(full);
      continue;
    }
    if (!/\.(tsx|ts|jsx|js)$/.test(entry)) continue;
    if (/\.(test|spec)\.[jt]sx?$/.test(entry)) continue;
    scanned += 1;
    const src = readFileSync(full, "utf8");
    const lines = src.split("\n");
    lines.forEach((line, i) => {
      for (const match of line.matchAll(DEAD)) {
        offenders.push({ file: relative(ROOT, full), line: i + 1, text: match[0] });
      }
    });
  }
}

walk(SRC);

const FILE_FLOOR = 400; // 900+ measured 2026-09-04; a walk that stops walking certifies everything.
if (scanned < FILE_FLOOR) {
  console.error(
    `[lint-dead-token-alpha] FAIL (VACUITY GUARD) — scanned only ${scanned} files ` +
      `(floor ${FILE_FLOOR}). A walk that sees nothing reports every file clean. ` +
      `Find out why; do NOT lower this floor.`,
  );
  process.exit(1);
}

console.log(`[lint-dead-token-alpha] scanned ${scanned} client files (floor ${FILE_FLOOR})`);

if (offenders.length > 0) {
  console.error("");
  console.error(
    "[lint-dead-token-alpha] FAIL — these classes emit NO CSS rule. Tailwind cannot " +
      "apply an alpha modifier to an arbitrary `var()` value: parseColor returns null, " +
      "withAlphaValue returns undefined, and the candidate is dropped entirely. The " +
      "element silently keeps whatever colour it would have had anyway, which is why " +
      "this survives review.",
  );
  console.error("");
  for (const o of offenders) {
    const fixed = o.text.replace(
      /\b([a-z-]+)-\[(?:color|border-color|background-color|fill|stroke):var\(--([a-z0-9-]+)\)\]\/(\d{1,3})/,
      (_m, prefix, token, alpha) => `${prefix}-${token}/${alpha}`,
    );
    console.error(`  ${o.file}:${o.line}`);
    console.error(`      ${o.text}`);
    console.error(`   -> ${fixed}    (the token form; acrToken resolves the alpha with color-mix)`);
  }
  console.error("");
  console.error(
    "  The arbitrary spelling is fine WITHOUT an alpha, and the token spelling is fine " +
      "WITH one. Only the combination is dead.",
  );
  process.exit(1);
}

console.log("[lint-dead-token-alpha] PASS — no class with an alpha modifier on an arbitrary var() value.");

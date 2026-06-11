#!/usr/bin/env node
// ============================================================================
// scripts/lint-page-hex.mjs — W2-10(b): no hex color literals in pages.
// ----------------------------------------------------------------------------
// Why
// ───
// Hardcoded hex colors in client/src/pages/** break theming (light/dark,
// white-label). Chart colors must come from client/src/lib/chart-colors.ts;
// UI colors from Tailwind design tokens (CLAUDE.md "never hardcode colors").
//
// What it does
// ────────────
// Walks client/src/pages/**/*.tsx, masks // and /* … */ comments
// (string-aware, same family as check-org-scoped-fetch.mjs), then flags hex
// color literals. To avoid false-positives on issue refs (#128), ticket ids
// (#2026-PR-1234) and HTML entities (&#8984;), a match must:
//   - not be preceded by `&` (entity guard),
//   - have a valid CSS hex length (3, 4, 6 or 8 digits),
//   - contain at least one a–f letter OR be a single repeated digit
//     (#000 / #111 / #ffffff style). Known miss: mixed-digit-only colors
//     like #112233 — rare; raise if it becomes real.
//
// Ratchet contract (bidirectional, same as lint-css-hover.mjs):
//   - per-file count >  baseline → FAIL (new hex literal — use tokens)
//   - per-file count <  baseline → FAIL (tighten the baseline in-commit)
//   - count == baseline           → PASS
//   - files NOT in the baseline must have zero hex literals.
//
// Usage:
//   node scripts/lint-page-hex.mjs              # full pages scope (CI)
//   node scripts/lint-page-hex.mjs <dir|file> … # explicit targets (fixture
//                                               #  tests; stale-baseline
//                                               #  check is skipped)
//   node scripts/lint-page-hex.mjs --measure    # print counts, never fail
//
// Exit codes: 0 — clean; 1 — new offender or stale baseline entry.
// ============================================================================

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const DEFAULT_SCOPE = join(REPO_ROOT, "client", "src", "pages");

// ----------------------------------------------------------------------------
// Baseline allowlist — pre-existing hex literals, frozen so the lint lands
// NOW and blocks regressions. Keys are repo-relative paths, values are the
// EXACT current count. The list only ratchets DOWN: migrate a color to
// chart-colors.ts / Tailwind tokens, then decrement/delete the entry in the
// same commit. NEW entries require Iris-CTO sign-off.
// ----------------------------------------------------------------------------
const BASELINE = new Map([
  // White-label branding DATA defaults (customer-configurable brand colors),
  // not UI styling — legitimately literal.
  ["client/src/pages/reseller-dashboard.tsx", 2],
  // Art-directed fixed-dark cockpit background (bg-[#0A0B0D]) — deliberate,
  // documented in the file header; not a theming surface.
  ["client/src/pages/founder/bridge.tsx", 1],
  // outreach/mail/eddm.tsx (MapLibre GL paint hexes) was migrated to
  // chart-colors mid-W2-10 — entry removed 2026-06-11; it must stay at zero.
  // Credit-score band colors — migrate to chart-colors.ts when touched.
  ["client/src/pages/land-credit.tsx", 5],
  // Alert-severity dot colors — should be Tailwind semantic tokens.
  ["client/src/pages/regulatory-intel.tsx", 3],
  // Landing art direction (SVG parcel-line stroke / Pax accent / feature
  // stroke). Landing renders outside the app theme, but these should still
  // centralize — drive down when the landing palette module lands.
  ["client/src/pages/landing/Hero.tsx", 1],
  ["client/src/pages/landing/Agents.tsx", 1],
  ["client/src/pages/landing/Features.tsx", 1],
]);

const args = process.argv.slice(2);
const MEASURE_ONLY = args.includes("--measure");
const explicitTargets = args.filter((a) => a !== "--measure");

// ----------------------------------------------------------------------------
// File walking
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

// ----------------------------------------------------------------------------
// Comment masking — replaces // and /* … */ spans with spaces (string-aware;
// same-length output so line numbers map 1:1). Lifted from the
// check-org-scoped-fetch.mjs family.
// ----------------------------------------------------------------------------
function maskComments(source) {
  const out = source.split("");
  let inString = null;
  let prevChar = "";
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (ch === inString && prevChar !== "\\") inString = null;
      prevChar = ch;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      prevChar = ch;
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") {
        out[i] = " ";
        i++;
      }
      prevChar = "\n";
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] !== "\n") out[i] = " ";
        i++;
      }
      if (i < source.length) {
        out[i] = " ";
        if (i + 1 < source.length) out[i + 1] = " ";
        i += 1;
      }
      prevChar = " ";
      continue;
    }
    prevChar = ch;
  }
  return out.join("");
}

const HEX_RE = /(^|[^&\w])#([0-9a-fA-F]{3,8})\b/g;
const VALID_LENGTHS = new Set([3, 4, 6, 8]);

function isColorLiteral(digits) {
  if (!VALID_LENGTHS.has(digits.length)) return false;
  if (/[a-fA-F]/.test(digits)) return true;
  // Digit-only: accept the unambiguous repeated-digit colors (#000, #111…).
  return /^(\d)\1+$/.test(digits);
}

/** Scan one TSX source; return [{ line, snippet }] per hex color literal. */
function findHexLiterals(source) {
  const masked = maskComments(source);
  const offenders = [];
  const lines = masked.split("\n");
  for (let li = 0; li < lines.length; li++) {
    HEX_RE.lastIndex = 0;
    let m;
    while ((m = HEX_RE.exec(lines[li])) !== null) {
      if (!isColorLiteral(m[2])) continue;
      offenders.push({ line: li + 1, snippet: `#${m[2]}` });
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

  const files = roots.flatMap((r) => walkTsx(r));
  const perFile = new Map(); // rel → offenders[]

  for (const file of files) {
    const rel = file.startsWith(REPO_ROOT + "/") ? relative(REPO_ROOT, file) : file;
    const offenders = findHexLiterals(readFileSync(file, "utf8"));
    if (offenders.length > 0) perFile.set(rel, offenders);
  }

  if (MEASURE_ONLY) {
    console.log(`[lint-page-hex] measured ${files.length} tsx files`);
    for (const [rel, offenders] of perFile) {
      console.log(`  ${rel}: ${offenders.length}`);
      for (const o of offenders) console.log(`    L${o.line}  ${o.snippet}`);
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

  const totalHex = [...perFile.values()].reduce((n, o) => n + o.length, 0);
  console.log(
    `[lint-page-hex] scanned ${files.length} tsx files; ` +
      `hex literals: ${totalHex}, ` +
      `new offenders: ${newOffenders.length} file(s), ` +
      `stale baseline entries: ${staleEntries.length + (fullScope ? improvements.length : 0)}`,
  );

  if (newOffenders.length === 0 && staleEntries.length === 0 && (!fullScope || improvements.length === 0)) {
    console.log("[lint-page-hex] PASS");
    process.exit(0);
  }

  if (newOffenders.length > 0) {
    console.error("");
    console.error(
      "[lint-page-hex] FAIL — hex color literals above baseline in " +
        "client/src/pages. Hardcoded colors break theming: chart colors come " +
        "from client/src/lib/chart-colors.ts, UI colors from Tailwind design " +
        "tokens (CLAUDE.md).",
    );
    console.error("");
    for (const { rel, allowed, offenders } of newOffenders) {
      console.error(`  ${rel} — ${offenders.length} literals (baseline ${allowed}):`);
      for (const o of offenders) console.error(`    L${o.line}  ${o.snippet}`);
    }
    console.error("");
  }

  if (fullScope && (staleEntries.length > 0 || improvements.length > 0)) {
    console.error("");
    console.error(
      "[lint-page-hex] FAIL — BASELINE entries are stale (literals were " +
        "migrated — good!). Tighten the baseline in scripts/lint-page-hex.mjs " +
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

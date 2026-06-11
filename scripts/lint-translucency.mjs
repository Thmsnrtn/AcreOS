#!/usr/bin/env node
// ============================================================================
// scripts/lint-translucency.mjs — Tahoe F2: no ad-hoc surface translucency
//   in client/src .tsx. Mirrors lint-zindex.mjs / lint-page-hex.mjs.
// ----------------------------------------------------------------------------
// Why
// ───
// Translucency was per-component, not tokenized: ~60 ad-hoc opacity-modifier
// surfaces — `bg-background/95` (27 sites, the systematic glass chrome),
// `/80` (13), `/90` (9), plus `/97`, `bg-black/40|80` scrims, `bg-primary/90`
// hover states, etc. — with no named scale, while the liquid-glass material
// kit (.liquid-glass*) IS systematic. Tahoe Wave F2 codified a SEMANTIC
// surface-translucency scale: `--surface-{chrome,haze,veil,sheer,scrim,
// scrim-strong}` in index.css + matching `.bg-surface-*` utility classes,
// the opacity layer of the same liquid-glass house language. Future code says
// `bg-surface-chrome`, never `bg-background/95`; `bg-surface-scrim`, never
// `bg-black/40`.
//
// Scale (token → value it replaces → role):
//   bg-surface-chrome        hsl(bg / .95)  primary glass chrome (topbars,
//                                           navs, Pax rail, bottom nav, sticky
//                                           detail headers) — pair w/ backdrop-blur*
//   bg-surface-haze          hsl(bg / .90)  map/canvas overlay chrome
//   bg-surface-veil          hsl(bg / .80)  secondary / lighter sticky chrome
//   bg-surface-sheer         hsl(bg / .70)  lightest full-bleed content veils
//   bg-surface-scrim         rgba(0,0,0,.40) modal/dialog backdrop
//   bg-surface-scrim-strong  rgba(0,0,0,.80) heavy backdrop (alert-dialog, drawer)
//
// This ratchet locks that in. It FAILS on raw opacity-modifier surface
// classes — `bg-(background|card|popover|muted|accent|secondary|primary|
// destructive|sidebar|black|white)/(7x|8x|9x)` — in client/src .tsx.
//
// 30 pre-existing sites across 23 files are BASELINED below and drive-to-zero.
// The systematic glass chrome + modal scrims were migrated to the scale in F2;
// the residue is interactive-state opacity (`hover:bg-primary/90`,
// `focus:bg-accent/70`), decorative/badge fills (`bg-primary/80`,
// `bg-muted/50`), form-input fills (the `inset-input` idiom), the dynamic
// island fill, and two `bg-background/97` map pods + the MessageInput
// `supports-[backdrop-filter]:` progressive-enhancement variant (which the
// Tailwind variant system owns and a hand-authored `.bg-surface-*` class
// cannot wrap). These are not the layered-surface translucency this scale
// governs, so they are baselined, not forced into a token — the re-skin
// (Wave R) decides whether state-opacity earns its own scale.
//
// Ratchet contract (bidirectional, same family as lint-zindex.mjs):
//   - per-file count >  baseline → FAIL (new ad-hoc translucent surface —
//                                  use a bg-surface-* token)
//   - per-file count <  baseline → FAIL (tighten the baseline in-commit)
//   - count == baseline           → PASS
//   - files NOT in the baseline must have zero raw translucent surfaces.
//
// Usage:
//   node scripts/lint-translucency.mjs              # full client/src .tsx (CI)
//   node scripts/lint-translucency.mjs <dir|file> … # explicit targets
//   node scripts/lint-translucency.mjs --measure    # print counts, never fail
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
// Baseline allowlist — pre-existing RAW translucent-surface opacity modifiers,
// frozen so the lint lands now and blocks regressions. Keys are repo-relative
// paths, values are the EXACT current count of
// `bg-<color>/<7x|8x|9x>` class tokens. The list only ratchets DOWN: migrate a
// site to a `bg-surface-*` token (or remove it), then decrement/delete the
// entry in the SAME commit. NEW entries are not allowed — a file not listed
// here must be zero.
// ----------------------------------------------------------------------------
const BASELINE = new Map([
  ["client/src/components/bulk-action-bar.tsx", 1],
  ["client/src/components/command-palette.tsx", 1],
  ["client/src/components/confirm-dialog.tsx", 1],
  ["client/src/components/dashboard/TasksDueWidget.tsx", 1],
  ["client/src/components/dashboard/type-specific-widgets.tsx", 1],
  ["client/src/components/data-confidence-badge.tsx", 1],
  ["client/src/components/dynamic-island.tsx", 2],
  ["client/src/components/founder-chat/artifacts/secret_paste.tsx", 1],
  ["client/src/components/founder/OnboardingWalkthrough.tsx", 1],
  ["client/src/components/founder/command/StatusBanner.tsx", 1],
  ["client/src/components/help/HelpPanel.tsx", 1],
  ["client/src/components/layout-sidebar.tsx", 4],
  ["client/src/components/mobile/CourthouseMode.tsx", 1],
  ["client/src/components/mobile/MobileLeadList.tsx", 2],
  ["client/src/components/property-map.tsx", 2],
  ["client/src/components/solene/MessageInput.tsx", 2],
  ["client/src/components/tools/LandDealCalculator.tsx", 1],
  ["client/src/components/ui/dropdown-menu.tsx", 1],
  ["client/src/components/ui/input.tsx", 1],
  ["client/src/components/ui/select.tsx", 1],
  ["client/src/pages/blind-offer-wizard.tsx", 1],
  ["client/src/pages/properties.tsx", 1],
  ["client/src/pages/public-parcel-report.tsx", 1],
]);

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

// ----------------------------------------------------------------------------
// Comment masking — replaces // and /* … */ spans with spaces (string-aware;
// same-length output so line numbers map 1:1). Lifted from lint-zindex.mjs /
// lint-page-hex.mjs so a doc-comment reference like `// bg-background/95` does
// not count as an offender.
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

// Raw translucent-surface opacity modifier: `bg-<color>/<7x|8x|9x>`, optionally
// prefixed by a Tailwind variant (`hover:bg-primary/90`, `dark:bg-black/85`,
// `supports-[backdrop-filter]:bg-background/80`). The `(^|[^\w-])` guard avoids
// matching the tail of an unrelated token; `\b` after the number keeps the
// 70–99 window crisp (won't catch `/100` or a stray `/7`). The colour set is
// the family of theme surface roles that can legitimately layer — `foreground`
// is excluded (scrollbar/text alpha, not a surface).
const SURFACE_RE =
  /(^|[^\w-])bg-(background|card|popover|muted|accent|secondary|primary|destructive|sidebar|black|white)\/(7[0-9]|8[0-9]|9[0-9])\b/g;

/** Scan one masked .tsx source; return an array of { line, snippet }. */
function findOffenders(source) {
  const masked = maskComments(source);
  const offenders = [];
  const lines = masked.split("\n");
  for (let li = 0; li < lines.length; li++) {
    SURFACE_RE.lastIndex = 0;
    let m;
    while ((m = SURFACE_RE.exec(lines[li])) !== null) {
      offenders.push({ line: li + 1, snippet: `bg-${m[2]}/${m[3]}` });
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
    const offenders = findOffenders(readFileSync(file, "utf8"));
    if (offenders.length > 0) perFile.set(rel, offenders);
  }

  if (MEASURE_ONLY) {
    console.log(`[lint-translucency] measured ${files.length} tsx files`);
    for (const [rel, offenders] of perFile) {
      console.log(`  ${rel}: ${offenders.length}`);
      for (const o of offenders) console.log(`    L${o.line}  ${o.snippet}`);
    }
    process.exit(0);
  }

  const over = [];        // count above baseline
  const improvements = []; // count below baseline (tighten)
  for (const [rel, offenders] of perFile) {
    const allowed = BASELINE.get(rel) ?? 0;
    if (offenders.length > allowed) over.push({ rel, allowed, offenders });
    else if (offenders.length < allowed) improvements.push({ rel, allowed, count: offenders.length });
  }
  const staleEntries = fullScope
    ? [...BASELINE.keys()].filter((rel) => {
        const offenders = perFile.get(rel);
        return !offenders || offenders.length === 0;
      })
    : [];

  const total = [...perFile.values()].reduce((n, o) => n + o.length, 0);
  console.log(
    `[lint-translucency] scanned ${files.length} tsx files; ` +
      `raw translucent surfaces: ${total}, ` +
      `over baseline: ${over.length} file(s), ` +
      `stale baseline entries: ${staleEntries.length + (fullScope ? improvements.length : 0)}`,
  );

  const clean =
    over.length === 0 &&
    staleEntries.length === 0 &&
    (!fullScope || improvements.length === 0);
  if (clean) {
    console.log("[lint-translucency] PASS");
    process.exit(0);
  }

  if (over.length > 0) {
    console.error("");
    console.error(
      "[lint-translucency] FAIL — raw translucent surface above baseline. The " +
        "surface-translucency scale is semantic: use a token " +
        "(bg-surface-chrome/haze/veil/sheer/scrim/scrim-strong) from index.css. " +
        "chrome = bg-background/95 glass chrome, scrim = bg-black/40 modal " +
        "backdrop, etc. See the scale header in scripts/lint-translucency.mjs.",
    );
    console.error("");
    for (const { rel, allowed, offenders } of over) {
      console.error(`  ${rel} — ${offenders.length} (baseline ${allowed}):`);
      for (const o of offenders) console.error(`    L${o.line}  ${o.snippet}`);
    }
    console.error("");
  }

  if (fullScope && (staleEntries.length > 0 || improvements.length > 0)) {
    console.error("");
    console.error(
      "[lint-translucency] FAIL — BASELINE entries are stale (translucency was " +
        "migrated to tokens — good!). Tighten the baseline in " +
        "scripts/lint-translucency.mjs so the ratchet locks in the improvement:",
    );
    for (const rel of staleEntries) console.error(`  - "${rel}" → remove entry`);
    for (const { rel, allowed, count } of improvements)
      console.error(`  - "${rel}" → lower ${allowed} to ${count}`);
    console.error("");
  }

  process.exit(1);
}

main();

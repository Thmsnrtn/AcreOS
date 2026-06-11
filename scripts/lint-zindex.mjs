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
// Usage:
//   node scripts/lint-zindex.mjs              # full client/src .tsx scope (CI)
//   node scripts/lint-zindex.mjs <dir|file> … # explicit targets (fixture tests;
//                                             #  stale-baseline check skipped)
//   node scripts/lint-zindex.mjs --measure    # print counts, never fail
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
const BASELINE = new Map([
  ["client/src/components/VirtualTable.tsx", 1],
  ["client/src/components/bulk-action-bar.tsx", 1],
  ["client/src/components/campaigns-content.tsx", 2],
  ["client/src/components/conversation-tray.tsx", 1],
  ["client/src/components/cookie-consent-banner.tsx", 1],
  ["client/src/components/feature-hints.tsx", 1],
  ["client/src/components/field-scanner.tsx", 1],
  ["client/src/components/founder-bridge/BridgeAtlasSheet.tsx", 1],
  ["client/src/components/founder-bridge/BridgeTile.tsx", 1],
  ["client/src/components/founder-chat/Composer.tsx", 1],
  ["client/src/components/founder-chat/Dock.tsx", 5],
  ["client/src/components/founder-chat/MessageList.tsx", 1],
  ["client/src/components/founder-chat/ThreadSidebar.tsx", 2],
  ["client/src/components/founder/OnboardingWalkthrough.tsx", 1],
  ["client/src/components/founder/SwipeDecisionCard.tsx", 1],
  ["client/src/components/layout-sidebar.tsx", 2],
  ["client/src/components/lead-detail-content.tsx", 1],
  ["client/src/components/mobile/FounderMobileBottomNav.tsx", 2],
  ["client/src/components/mobile/MobileBottomNav.tsx", 2],
  ["client/src/components/mobile/MobileLeadDetail.tsx", 1],
  ["client/src/components/mobile/MobilePropertyDetail.tsx", 1],
  ["client/src/components/mobile/PullToRefresh.tsx", 1],
  ["client/src/components/notification-banner.tsx", 2],
  ["client/src/components/onboarding/OnboardingProgress.tsx", 1],
  ["client/src/components/onboarding/OnboardingWizard.tsx", 1],
  ["client/src/components/pax-command-palette.tsx", 1],
  ["client/src/components/pax-entity-picker.tsx", 1],
  ["client/src/components/pax-memory-panel.tsx", 1],
  ["client/src/components/property-map.tsx", 13],
  ["client/src/components/pwa-install-prompt.tsx", 2],
  ["client/src/components/seo/SeoPageShell.tsx", 1],
  ["client/src/components/settings/SettingsQuickFind.tsx", 1],
  ["client/src/components/timeline/TimelineView.tsx", 1],
  ["client/src/components/tools/LandDealCalculator.tsx", 1],
  ["client/src/components/ui/alert-dialog.tsx", 2],
  ["client/src/components/ui/calendar.tsx", 1],
  ["client/src/components/ui/context-menu.tsx", 2],
  ["client/src/components/ui/conversion-funnel.tsx", 1],
  ["client/src/components/ui/drawer.tsx", 2],
  ["client/src/components/ui/dropdown-menu.tsx", 2],
  ["client/src/components/ui/hover-card.tsx", 1],
  ["client/src/components/ui/input-otp.tsx", 1],
  ["client/src/components/ui/menubar.tsx", 2],
  ["client/src/components/ui/mesh-gradient.tsx", 1],
  ["client/src/components/ui/navigation-menu.tsx", 1],
  ["client/src/components/ui/popover.tsx", 1],
  ["client/src/components/ui/resizable.tsx", 1],
  ["client/src/components/ui/select.tsx", 1],
  ["client/src/components/ui/sidebar.tsx", 2],
  ["client/src/components/ui/tooltip.tsx", 1],
  ["client/src/pages/borrower-portal.tsx", 4],
  ["client/src/pages/changelog.tsx", 1],
  ["client/src/pages/command-center.tsx", 1],
  ["client/src/pages/field-scout.tsx", 2],
  ["client/src/pages/outreach/mail/eddm.tsx", 1],
  ["client/src/pages/pricing.tsx", 1],
  ["client/src/pages/properties.tsx", 3],
  ["client/src/pages/security.tsx", 1],
  ["client/src/pages/state-rules.tsx", 1],
  ["client/src/pages/transparency.tsx", 1],
  ["client/src/pages/welcome-back.tsx", 1],
  ["client/src/pages/wholesaler-state-rules.tsx", 1],
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
// same-length output so line numbers map 1:1). Lifted from the
// lint-page-hex.mjs / check-org-scoped-fetch.mjs family. This is what lets a
// doc-comment reference like `// topbar (z-30) is covered by … (z-[100])`
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

// Arbitrary Tailwind z-index: `z-[…]`, optionally prefixed by a variant
// (`focus:z-[100]`, `md:z-[60]`). The `(^|[^\w-])` guard avoids matching the
// tail of an unrelated token.
const ARBITRARY_RE = /(^|[^\w-])z-\[[^\]]*\]/g;
// Raw numeric z-index in the semantic scale. Variant-prefixed forms count too.
// \b after the number prevents z-1 matching z-10 / z-100, etc.
const NUMERIC_RE = /(^|[^\w-])z-(0|1|10|20|30|40|50|60)\b/g;

/** Scan one masked .tsx source; return { arbitrary:[…], numeric:[…] }. */
function findOffenders(source) {
  const masked = maskComments(source);
  const arbitrary = [];
  const numeric = [];
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
  }
  return { arbitrary, numeric };
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

  for (const file of files) {
    const rel = file.startsWith(REPO_ROOT + "/") ? relative(REPO_ROOT, file) : file;
    const res = findOffenders(readFileSync(file, "utf8"));
    if (res.arbitrary.length > 0 || res.numeric.length > 0) perFile.set(rel, res);
  }

  if (MEASURE_ONLY) {
    console.log(`[lint-zindex] measured ${files.length} tsx files`);
    for (const [rel, { arbitrary, numeric }] of perFile) {
      console.log(`  ${rel}: ${numeric.length} numeric, ${arbitrary.length} arbitrary`);
      for (const o of [...arbitrary, ...numeric]) console.log(`    L${o.line}  ${o.snippet}`);
    }
    process.exit(0);
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
    `[lint-zindex] scanned ${files.length} tsx files; ` +
      `raw numeric z-N: ${totalNumeric}, arbitrary z-[…]: ${totalArbitrary}, ` +
      `arbitrary offenders: ${arbitraryOffenders.length} file(s), ` +
      `numeric over baseline: ${numericOver.length} file(s), ` +
      `stale baseline entries: ${staleEntries.length + (fullScope ? numericImprovements.length : 0)}`,
  );

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

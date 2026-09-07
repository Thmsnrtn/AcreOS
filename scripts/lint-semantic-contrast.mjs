#!/usr/bin/env node
// ============================================================================
// scripts/lint-semantic-contrast.mjs — semantic pills must clear WCAG AA.
// ----------------------------------------------------------------------------
// THE DEFECT
//
// The pill idiom across this app was `bg-acr-warn-soft text-acr-warn` — the
// semantic hue as TEXT on a 14%-alpha tint of ITSELF. Composited over the
// page, that is 2.47:1 in the default theme. WCAG 1.4.3 AA wants 4.5:1 for
// text this size. Every semantic pair failed, in 416 authored places, across
// every theme: warn 2.05–3.88, pos 3.53–4.49, neg 2.97–4.51, brand 3.38–4.26.
//
// The team already holds itself to AA — index.css carries a "WCAG-AA tuning …
// 3.78:1" note — but that audit covered the INK RAMP (body text on page
// surfaces) and never the semantic-on-its-own-tint pairing, because nothing
// enumerated those pairings. A design system with a contrast standard and no
// contrast gate meets the standard exactly where someone remembered to check.
//
// THE FIX this guards: `--acr-{brand,pos,warn,neg}-soft-ink`, one per theme ×
// mode, solved so the ink clears 4.5:1 against its own tint composited over
// BOTH `--acr-bg` and `--acr-surface` — a pill sits on either, and the darker
// of the two is what has to pass.
//
// WHY IT DERIVES RATHER THAN LISTS
//
// The pairings are read out of client/src, not typed here. A hardcoded list
// only ever proves things about the day it was written; deriving means a pill
// someone writes next week is checked the day they write it, which is the
// failure mode this repository's gates keep having. The floors below are the
// other half: a scanner that stops matching reads exactly like an app with no
// pills in it.
//
// ── WIDENED 2026-09-06: THE NEUTRAL INK RAMP ────────────────────────────────
//
// This gate's own header said it: "A design system with a contrast standard and
// no contrast gate meets the standard exactly where someone remembered to
// check." It then checked the pairing it was written for — semantic ink on a
// semantic tint — and nothing else. The runtime axe audit found the gap on its
// first pass: `--muted-foreground` on `--sidebar-background` is 4.35:1 in
// bedrock light and 4.37:1 in meadow light, on copy like "Land Investor OS" and
// "Solene · Chief of Staff".
//
// The earlier AA work covered the ink ramp over --acr-bg and --acr-surface. The
// SIDEBAR is a third surface, and nobody had enumerated it — so it was
// off-population for both audits at once, and the pairing shipped failing in
// two themes.
//
// Every neutral foreground token is now checked against every surface token a
// component can place it on, in every theme × mode. The surfaces are read out
// of the CSS rather than listed, so a theme that adds a fourth surface is
// covered by existing.
// ============================================================================

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const AA = 4.5;

// ── colour maths (WCAG 2.1 relative luminance) ───────────────────────────────
const hex = (h) => {
  let s = h.trim().replace(/^#/, "");
  if (s.length === 3) s = [...s].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
};
const rgba = (s) => {
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/.exec(s.trim());
  return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null;
};
const lum = ([r, g, b]) => {
  const f = (c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const over = ([r, g, b, a], bg) => [r, g, b].map((c, i) => Math.round(a * c + (1 - a) * bg[i]));

// ── every theme × mode block that defines the semantic ramp ──────────────────
const css = readFileSync(join(ROOT, "client/src/index.css"), "utf8");
const themes = [];
for (const m of css.matchAll(/([^{}]*?)\{([^{}]*?--acr-warn:[^{}]*?)\}/gs)) {
  const label = /([A-Za-z]+)\s*·\s*(light|dark)/.exec(m[1]);
  const body = m[2];
  const tok = (n) => {
    const t = new RegExp(`--${n}:\\s*([^;]+);`).exec(body);
    return t ? t[1].split("/*")[0].trim() : null;
  };
  themes.push({
    name: label ? `${label[1]} ${label[2]}` : "bedrock light",
    bg: tok("acr-bg"),
    surface: tok("acr-surface"),
    tok,
  });
}

// ── every authored (bg-acr-X-soft, text-acr-Y) pairing in the app ────────────
const SEMANTICS = ["brand", "pos", "warn", "neg"];
const pairings = new Map(); // "fill|ink" -> [{file, line}]
/** Soft fills used with NO explicit ink — they inherit --acr-ink. */
const inherited = new Map();
let scannedFiles = 0;

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full, { throwIfNoEntry: false });
    if (!st) continue;
    if (st.isDirectory()) {
      if (entry !== "node_modules" && entry !== "__tests__") walk(full);
      continue;
    }
    if (!/\.(tsx|ts)$/.test(entry) || /\.(test|spec)\.tsx?$/.test(entry)) continue;
    scannedFiles += 1;
    const text = readFileSync(full, "utf8");
    // THE UNIT IS THE STRING LITERAL, NOT THE LINE.
    //
    // A first version paired every fill on a line with every ink on the same
    // line, and reported `maps.tsx`'s risk map — `{ low: "bg-acr-pos-soft
    // text-acr-pos-soft-ink", moderate: "bg-acr-warn-soft
    // text-acr-warn-soft-ink", … }` — as four cross-hue mismatches. Every one
    // of those strings is correctly paired WITHIN ITSELF; they merely share a
    // line. A gate that cries wolf on correct code is a gate someone deletes,
    // and the class string is the actual unit a browser applies together.
    for (const m of text.matchAll(/(["'`])((?:[^"'`\\\n]|\\.)*?)\1/g)) {
      const chunk = m[2];
      if (!chunk.includes("acr-")) continue;
      const line = text.slice(0, m.index).split("\n").length;
      for (const fill of SEMANTICS) {
        if (!new RegExp(`\\bbg-acr-${fill}-soft\\b`).test(chunk)) continue;
        // A fill with no explicit ink inherits the ambient body colour. That
        // is a real part of the population, not an exemption — it is checked
        // separately below, against --acr-ink.
        if (!/\btext-acr-/.test(chunk)) {
          inherited.set(fill, (inherited.get(fill) ?? 0) + 1);
        }
        for (const ink of SEMANTICS) {
          for (const suffix of ["", "-soft-ink"]) {
            const cls = `text-acr-${ink}${suffix}`;
            if (!new RegExp(`\\b${cls}\\b(?!-)`).test(chunk)) continue;
            const key = `${fill}|${ink}${suffix}`;
            if (!pairings.has(key)) pairings.set(key, []);
            pairings.get(key).push({ file: relative(ROOT, full), line });
          }
        }
      }
    }
  }
}
walk(join(ROOT, "client/src"));

// ── vacuity floors ───────────────────────────────────────────────────────────
const FILE_FLOOR = 400;   // 868 measured 2026-09-04
const PAIR_FLOOR = 4;     // 8 distinct pairings measured 2026-09-04
const SITE_FLOOR = 200;   // 416 authored sites measured 2026-09-04
const THEME_FLOOR = 8;    // 12 theme × mode blocks measured 2026-09-04

const totalSites = [...pairings.values()].reduce((n, v) => n + v.length, 0);
for (const [what, got, floor] of [
  ["client files", scannedFiles, FILE_FLOOR],
  ["distinct pairings", pairings.size, PAIR_FLOOR],
  ["authored pill sites", totalSites, SITE_FLOOR],
  ["theme blocks", themes.length, THEME_FLOOR],
]) {
  if (got < floor) {
    console.error(
      `[lint-semantic-contrast] FAIL (VACUITY GUARD) — found only ${got} ${what} ` +
        `(floor ${floor}). A scanner that sees nothing certifies everything. Find out ` +
        `why it stopped matching; do NOT lower this floor.`,
    );
    process.exit(1);
  }
}

const inheritedSites = [...inherited.values()].reduce((n, v) => n + v, 0);
console.log(
  `[lint-semantic-contrast] ${scannedFiles} client files, ${pairings.size} distinct ` +
    `pairings over ${totalSites} sites, ${inheritedSites} fills inheriting --acr-ink, ` +
    `${themes.length} theme × mode blocks`,
);

// ── the check ────────────────────────────────────────────────────────────────
let failures = [];
for (const [key, sites] of pairings) {
  const [fill, inkToken] = key.split("|");
  const softName = `acr-${fill}-soft`;
  const inkName = `acr-${inkToken}`;
  for (const theme of themes) {
    const softRaw = theme.tok(softName);
    const inkRaw = theme.tok(inkName);
    if (!softRaw || !inkRaw) {
      failures.push({
        key,
        theme: theme.name,
        why: `theme does not define --${!softRaw ? softName : inkName}`,
        sites,
      });
      continue;
    }
    const soft = softRaw.startsWith("rgb") ? rgba(softRaw) : [...hex(softRaw), 1];
    const ink = hex(inkRaw);
    const grounds = [hex(theme.bg), hex(theme.surface)].map((g) => over(soft, g));
    const worst = Math.min(...grounds.map((g) => ratio(ink, g)));
    if (worst < AA) {
      failures.push({ key, theme: theme.name, worst: worst.toFixed(2), sites });
    }
  }
}

// ── the fills that carry no ink of their own ─────────────────────────────────
//
// 227 of them at the time of writing. They take the ambient `--acr-ink`, which
// the ink-ramp audit already tunes against page surfaces — but not against a
// semantic TINT laid over those surfaces, which is a different background.
// Checking it here means the population is every authored soft fill, not just
// the ones that name their own colour.
for (const fill of inherited.keys()) {
  for (const theme of themes) {
    const softRaw = theme.tok(`acr-${fill}-soft`);
    const inkRaw = theme.tok("acr-ink");
    if (!softRaw || !inkRaw) continue;
    const soft = softRaw.startsWith("rgb") ? rgba(softRaw) : [...hex(softRaw), 1];
    const grounds = [hex(theme.bg), hex(theme.surface)].map((g) => over(soft, g));
    const worst = Math.min(...grounds.map((g) => ratio(hex(inkRaw), g)));
    if (worst < AA) {
      failures.push({
        key: `${fill}|<inherited --acr-ink>`,
        theme: theme.name,
        worst: worst.toFixed(2),
        sites: [{ file: `${inherited.get(fill)} fills with no explicit ink`, line: 0 }],
      });
    }
  }
}

// ── THE NEUTRAL INK RAMP, over every surface a component can place it on ────
//
// Opaque tokens, so no compositing: HSL triples straight out of each theme
// block. `--muted-foreground` and `--foreground` are placed freely by
// components on any surface, so both are checked against all of them; the
// paired tokens (--card-foreground on --card, and so on) are checked against
// their own surface, which is the only place they are used.
const hsl = (v) => {
  const m = /^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/.exec(v.trim());
  if (!m) return null;
  const [h, sat, l] = [+m[1], +m[2] / 100, +m[3] / 100];
  const k = (n) => (n + h / 30) % 12;
  const a = sat * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [255 * f(0), 255 * f(8), 255 * f(4)].map(Math.round);
};

// STRUCTURAL surfaces only: the ones a CONTAINER paints, with no utility class
// in the text's own className to reveal the pairing. That is what made the
// sidebar invisible to both earlier audits — `text-muted-foreground` inside a
// sidebar carries no `bg-sidebar` beside it, so no class-string scan can see
// the pair, and only enumerating the containers finds it.
//
// Utility-applied fills (bg-muted, bg-accent, bg-secondary) are deliberately
// NOT listed: those pairings are derived from real class strings below, so the
// gate reports what the app does rather than what it might do. A first version
// listed them, and duly invented `--foreground on --accent` failures in themes
// where those two tokens are the same colour and are never used together.
const STRUCTURAL_SURFACES = ["background", "card", "popover", "sidebar-background"];
const FREE_INKS = ["muted-foreground", "foreground"];
const PAIRED = [
  ["card-foreground", "card"],
  ["popover-foreground", "popover"],
  ["sidebar-foreground", "sidebar-background"],
  // Confirmed by usage, not assumed: `bg-accent text-accent-foreground` is
  // shadcn's hover state, in dropdown-menu, context-menu, menubar, calendar and
  // navigation-menu. 38 authored `bg-accent` sites.
  ["accent-foreground", "accent"],
];

/*
 * A DERIVED explicit-pair scan was written here and removed the same day.
 *
 * It paired any `bg-<token>` with any `text-<token>` in the same class string,
 * and Tailwind variants make that wrong: `bg-card text-muted-foreground
 * hover:bg-accent` is a card/muted pairing plus an accent hover, not a
 * card/accent-foreground pairing. It reported 110 failures across seven themes,
 * almost all of them pairs no element ever renders. Getting it right needs
 * variant-aware parsing — `hover:bg-accent` may only be read against
 * `hover:text-…` — and a gate that cries wolf on correct code is a gate someone
 * deletes, which this file's own header already says.
 *
 * What is checked below is what can be established without that: the ink tokens
 * a CONTAINER places on a surface it paints itself, which is precisely the gap
 * the runtime audit found and no class-string scan could ever have seen.
 */

/**
 * Measured failures this gate reports but does not yet fix, each with its
 * number. Not a threshold and not a silence: an entry that stops failing makes
 * the gate FAIL, so a fix forces it out rather than leaving an exemption behind
 * to cover the next regression.
 */
const REGISTERED_NEUTRAL = [
  {
    ink: "accent-foreground",
    surface: "accent",
    why:
      "shadcn's hover state — `bg-accent text-accent-foreground` across " +
      "dropdown-menu, context-menu, menubar, calendar and navigation-menu. " +
      "Measured 2.91:1 in bedrock light and 2.47:1 in meadow light. Fixing it " +
      "means retuning --accent or --accent-foreground across seven themes x two " +
      "modes, which is a design pass with visual consequences on every menu in " +
      "the product, not a token nudge. Found 2026-09-06 by widening this gate; " +
      "recorded with its numbers so it is a scheduled fix, not a discovery " +
      "waiting to happen again.",
  },
];

const neutralBlocks = [...css.matchAll(/([^{}]+)\{([^{}]*--muted-foreground:[^{}]*)\}/g)];
let neutralChecks = 0;
for (const b of neutralBlocks) {
  const sel = b[1].trim().split("\n").pop().trim();
  const body = b[2];
  const tok = (n) => {
    const t = new RegExp(`--${n}:\\s*([^;]+);`).exec(body);
    return t ? hsl(t[1].split("/*")[0].trim()) : null;
  };
  const check = (inkName, surfName) => {
    const ink = tok(inkName);
    const surf = tok(surfName);
    if (!ink || !surf) return;
    neutralChecks += 1;
    const r = ratio(ink, surf);
    if (r < AA) {
      failures.push({
        key: `--${inkName} on --${surfName}`,
        theme: sel,
        worst: r.toFixed(2),
        sites: [{ file: "client/src/index.css", line: 0 }],
      });
    }
  };
  for (const ink of FREE_INKS) for (const surf of STRUCTURAL_SURFACES) check(ink, surf);
  for (const [ink, surf] of PAIRED) check(ink, surf);
}

// Registered failures are removed from the report — but an entry that has
// STOPPED failing is itself a failure, so a fix cannot leave a stale exemption.
for (const reg of REGISTERED_NEUTRAL) {
  const key = `--${reg.ink} on --${reg.surface}`;
  const hits = failures.filter((f) => f.key === key);
  if (hits.length === 0) {
    console.error(
      `[lint-semantic-contrast] FAIL — --${reg.ink} on --${reg.surface} now clears AA ` +
        "in every theme. Delete its REGISTERED_NEUTRAL entry; a register that " +
        "outlives its violation silently covers the next one.",
    );
    process.exit(1);
  }
  failures = failures.filter((f) => f.key !== key);
}

// Vacuity floor. A regex that stops matching the theme blocks would check
// nothing and pass — which is how the sidebar surface went unexamined by two
// separate audits.
const NEUTRAL_FLOOR = 100; // 12 blocks x 12 pairings measured 2026-09-06
if (neutralChecks < NEUTRAL_FLOOR) {
  console.error(
    `[lint-semantic-contrast] FAIL — only ${neutralChecks} neutral ink/surface ` +
      `pairings were checked, under the floor of ${NEUTRAL_FLOOR}. The theme-block ` +
      "scan has stopped matching, so the ramp is unguarded.",
  );
  process.exit(1);
}

if (failures.length > 0) {
  console.error("");
  console.error(
    "[lint-semantic-contrast] FAIL — these pairings do not clear WCAG 1.4.3 AA " +
      `(${AA}:1) against their own tint, composited over the theme's --acr-bg and ` +
      "--acr-surface. Badge text is small; this is the size where AA matters most.",
  );
  console.error("");
  const shown = new Set();
  for (const f of failures) {
    const head = `  ${f.key.replace("|", " fill + ")} ink — ${f.theme}: ${f.worst ?? f.why}`;
    console.error(head);
    if (!shown.has(f.key)) {
      shown.add(f.key);
      for (const s of f.sites.slice(0, 3)) console.error(`      ${s.file}:${s.line}`);
      if (f.sites.length > 3) console.error(`      … and ${f.sites.length - 3} more`);
    }
  }
  console.error("");
  console.error(
    "  Use the -soft-ink token for text on a -soft fill: `bg-acr-warn-soft " +
      "text-acr-warn-soft-ink`. If a theme is missing the token, add it — solved so " +
      "it clears 4.5:1 over BOTH --acr-bg and --acr-surface, since a pill sits on " +
      "either.",
  );
  process.exit(1);
}

console.log(
  `[lint-semantic-contrast] PASS — every pairing clears ${AA}:1 in every theme ` +
    `(${scannedFiles} files, ${pairings.size} pill pairings, ${neutralChecks} neutral ink/surface pairings).`,
);

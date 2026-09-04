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
const failures = [];
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

if (failures.length > 0) {
  console.error("");
  console.error(
    "[lint-semantic-contrast] FAIL — these pill pairings do not clear WCAG 1.4.3 AA " +
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

console.log(`[lint-semantic-contrast] PASS — every pairing clears ${AA}:1 in every theme.`);

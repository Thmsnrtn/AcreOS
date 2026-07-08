/**
 * a11y token fixer — bring every theme's --muted-foreground to WCAG AA (4.5:1).
 *
 * The persona audit found color-contrast is the #1 accessibility issue, and it
 * traces overwhelmingly to the --muted-foreground token (secondary text) sitting
 * just under 4.5:1 on its surfaces. This parses client/src/index.css, and for
 * EACH theme block computes the contrast of --muted-foreground against the
 * block's --background / --card / --muted, then nudges its lightness (down for
 * light themes, up for dark) until the worst surface clears 4.6:1.
 *
 * Deterministic + auditable. Re-runnable: a passing token is left untouched.
 *
 *   node tests/personas/fixMutedContrast.mjs           # rewrites index.css
 *   node tests/personas/fixMutedContrast.mjs --check    # report only, no write
 */

import fs from "node:fs";

const FILE = "client/src/index.css";
const TARGET = 4.6; // small margin over the 4.5:1 AA bar

function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [r + m, g + m, b + m];
}
function relLum([r, g, b]) {
  const f = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const [R, G, B] = [f(r), f(g), f(b)];
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}
function contrast(fg, bg) {
  const L1 = relLum(hslToRgb(...fg));
  const L2 = relLum(hslToRgb(...bg));
  const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}
/** Parse "34 21% 40%" → [h,s,l] numbers. */
function parseHsl(v) {
  const m = v.trim().match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
  return m ? [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])] : null;
}

const src = fs.readFileSync(FILE, "utf8");
const lines = src.split("\n");
const check = process.argv.includes("--check");

// Anchor on each --muted-foreground line and read its IMMEDIATE enclosing block
// (nearest preceding "{"-line → nearest following "}"). Robust to @layer nesting.
function tokenAt(line) {
  const m = line.match(/--([a-z-]+):\s*([\d.]+\s+[\d.]+%\s+[\d.]+%)\s*;/i);
  if (!m) return null;
  const hsl = parseHsl(m[2]);
  return hsl ? { name: m[1], hsl } : null;
}
const blocks = [];
lines.forEach((line, i) => {
  if (!/--muted-foreground:/.test(line)) return;
  let start = i;
  while (start > 0 && !/\{\s*$/.test(lines[start])) start--;
  let end = i;
  while (end < lines.length && !/\}/.test(lines[end])) end++;
  const tokens = new Map();
  for (let j = start; j <= end; j++) {
    const t = tokenAt(lines[j]);
    if (t) tokens.set(t.name, { line: j, hsl: t.hsl });
  }
  blocks.push({ tokens });
});

let fixed = 0;
const report = [];
for (const b of blocks) {
  const mf = b.tokens.get("muted-foreground");
  const bg = b.tokens.get("background");
  if (!mf || !bg) continue;
  const surfaces = ["background", "card", "muted", "popover"]
    .map((k) => b.tokens.get(k)?.hsl)
    .filter(Boolean);
  const worst = () => Math.min(...surfaces.map((s) => contrast(b.tokens.get("muted-foreground").hsl, s)));
  let c = worst();
  if (c >= 4.5) continue;
  // Light theme (bright bg) → darken; dark theme → lighten.
  const dark = bg.hsl[2] < 50;
  const step = dark ? +1 : -1;
  const origL = mf.hsl[2];
  let [h, s, l] = mf.hsl;
  let guard = 0;
  while (worst() < TARGET && l > 1 && l < 99 && guard++ < 80) {
    l = Math.round((l + step) * 10) / 10;
    b.tokens.get("muted-foreground").hsl = [h, s, l];
  }
  const newVal = `${h} ${s}% ${l}%`;
  report.push(`${dark ? "dark " : "light"}  L ${origL}→${l}  (${c.toFixed(2)}→${worst().toFixed(2)}:1)  @line ${mf.line + 1}`);
  if (!check) {
    lines[mf.line] = lines[mf.line].replace(/--muted-foreground:\s*[\d.]+\s+[\d.]+%\s+[\d.]+%\s*;/i, `--muted-foreground:            ${newVal};`);
  }
  fixed++;
}

console.log(report.join("\n"));
console.log(`\n${check ? "[check] " : ""}${fixed} theme block(s) below AA${check ? "" : " — rewritten"}.`);
if (!check && fixed) fs.writeFileSync(FILE, lines.join("\n"));

/**
 * Company accent → the token overrides it may apply, for one colorway + mode.
 *
 * An organization's brand colour is arbitrary: a dark navy is a fine light-mode
 * button and an invisible dark-mode one; a pale yellow is the reverse. So the
 * accent is never pasted in as-is. For the current surfaces it is nudged in
 * lightness until
 *   - its label (white or the page ink, whichever reads better) clears 4.5:1,
 *   - it clears 3:1 against the page as a focus ring / selected outline,
 * and it is written to BOTH token families (the shadcn HSL set AND the raw
 * --acr-brand set), so a component on either family shows the same colour.
 *
 * It never touches --accent (the hover/selected tint), the rail scope, the
 * status colours, or anything a person sets under Accessibility & comfort.
 *
 * Pure and dependency-free; tests/unit/tenantAccent.test.ts exercises it.
 */

type RGB = [number, number, number];

function parseHex(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) as RGB;
}

function toHex([r, g, b]: RGB): string {
  return "#" + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("").toUpperCase();
}

function lum([r, g, b]: RGB): number {
  const f = (c: number) => {
    const x = c / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(a: RGB, b: RGB): number {
  const A = lum(a);
  const B = lum(b);
  return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05);
}

function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === R) h = (G - B) / d + (G < B ? 6 : 0);
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h /= 6;
  }
  return [h * 360, s * 100, l * 100];
}

function hslToRgb(h: number, s: number, l: number): RGB {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((x) => Math.round(x * 255)) as RGB;
}

const hslString = (c: RGB) => {
  const [h, s, l] = rgbToHsl(c);
  return `${h.toFixed(0)} ${s.toFixed(1)}% ${l.toFixed(1)}%`;
};

const over = (top: RGB, a: number, base: RGB): RGB =>
  top.map((c, i) => Math.round(c * a + base[i] * (1 - a))) as RGB;

export interface AccentSurfaces {
  mode: "light" | "dark";
  /** Page background (--acr-bg) as hex. */
  bg: string;
  /** Content surface (--acr-surface) as hex. */
  surface: string;
  /** Page ink (--acr-ink) as hex — a label candidate. */
  ink: string;
}

/** The custom properties the overlay sets; cleared together on removal. */
export const TENANT_ACCENT_VARS = [
  "--primary",
  "--primary-foreground",
  "--ring",
  "--acr-brand",
  "--acr-brand-ink",
  "--acr-brand-soft",
  "--acr-brand-soft-ink",
  "--acr-ring",
  "--acr-glow",
] as const;

export type TenantAccentVars = Record<(typeof TENANT_ACCENT_VARS)[number], string>;

const AA = 4.5;
const UI = 3;

/** `null` when the hex or the surfaces are unusable (nothing is applied). */
export function deriveTenantAccent(hex: string, s: AccentSurfaces): TenantAccentVars | null {
  const base = parseHex(hex);
  const bg = parseHex(s.bg);
  const surface = parseHex(s.surface);
  const ink = parseHex(s.ink);
  if (!base || !bg || !surface || !ink) return null;

  const white: RGB = [255, 255, 255];
  const [h, sat, l0] = rgbToHsl(base);
  const step = s.mode === "dark" ? 1 : -1;

  // Find the nearest lightness at which the accent works as a filled button
  // (its label clears AA) and as a ring on the page (UI 3:1).
  let fill: RGB = base;
  let label: RGB = white;
  let found = false;
  for (let i = 0, l = l0; i <= 100 && l >= 0 && l <= 100; i++, l += step) {
    const c = hslToRgb(h, sat, l);
    // Best-reading label among white, the page ink and the page itself
    // (in dark mode a lightened accent needs the dark page colour).
    const lab = [white, ink, bg].reduce((a, b) => (contrastRatio(b, c) > contrastRatio(a, c) ? b : a));
    if (contrastRatio(lab, c) >= AA && contrastRatio(c, bg) >= UI && contrastRatio(c, surface) >= UI) {
      fill = c;
      label = lab;
      found = true;
      break;
    }
  }
  if (!found) return null;

  // The soft wash and its ink — the ink must clear AA on the wash composited
  // over both page and surface (the same rule as every colorway's -soft-ink).
  const softA = s.mode === "dark" ? 0.16 : 0.12;
  const washes = [over(fill, softA, bg), over(fill, softA, surface)];
  let softInk: RGB | null = null;
  const [fh, fs, fl] = rgbToHsl(fill);
  for (let i = 0, l = fl; i <= 100 && l >= 0 && l <= 100; i++, l += step) {
    const c = hslToRgb(fh, fs, l);
    if (washes.every((w) => contrastRatio(c, w) >= AA)) { softInk = c; break; }
  }
  // Refuse rather than ship a wash ink that fails AA.
  if (!softInk) return null;

  const rgba = (a: number) => `rgba(${fill.join(",")},${a})`;
  return {
    "--primary": hslString(fill),
    "--primary-foreground": hslString(label),
    "--ring": hslString(fill),
    "--acr-brand": toHex(fill),
    "--acr-brand-ink": toHex(label),
    "--acr-brand-soft": rgba(softA),
    "--acr-brand-soft-ink": toHex(softInk),
    "--acr-ring": `0 0 0 3px ${rgba(s.mode === "dark" ? 0.45 : 0.3)}`,
    "--acr-glow": rgba(s.mode === "dark" ? 0.36 : 0.28),
  };
}

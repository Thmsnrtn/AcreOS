/**
 * Color-blind safe chart palette for AcreOS.
 *
 * WCAG 2.2 SC 1.4.11 (Non-text Contrast — 3:1 against adjacent colors) requires
 * categorical encodings to remain distinguishable to people with deuteranopia,
 * protanopia, tritanopia, and full achromatopsia. The default Recharts palette
 * (Tableau-10 style) fails on red/green pairs and on adjacent blue/teal.
 *
 * We adopt a hybrid of:
 *   - **Wong (Nat Methods 2011)** — eight-color palette designed and validated
 *     for color-vision-deficient viewers.
 *   - **ColorBrewer Set2** — qualitative pastel ramp, used for fills where
 *     Wong colors would clash with our acr-* token system.
 *
 * To meet 1.4.11 even when colors are simulated to monochrome, we ALSO encode
 * each series with a **shape** (for points) and a **pattern** (for fills/areas).
 * Recharts components accept `strokeDasharray`, custom `shape`, and SVG
 * `<pattern>` fills via `fill="url(#patternId)"`.
 *
 * Public API:
 *   - `chartPalette` — ordered array of 8 hex colors, color-blind safe.
 *   - `chartPaletteSet2` — ColorBrewer Set2 (qualitative pastels).
 *   - `chartPaletteSemantic` — semantic palette tied to acr-* tokens.
 *   - `assignSeriesColors(keys)` — deterministic color/shape/dash assignment.
 *   - `ChartPattern` — SVG <defs> component that registers all hatching
 *     patterns; mount once per chart container.
 *   - `getPatternUrl(idx)` — returns `url(#chart-pattern-N)` for a pattern fill.
 */

// ---------------------------------------------------------------------------
// Wong palette — Bang Wong, "Points of view: Color blindness", Nature Methods
// 8 (2011), p. 441. Designed for CVD accessibility; ordered for max contrast.
// ---------------------------------------------------------------------------
export const chartPalette = [
  "#0072B2", // strong blue
  "#E69F00", // orange
  "#009E73", // bluish green
  "#CC79A7", // reddish purple
  "#56B4E9", // sky blue
  "#D55E00", // vermillion
  "#F0E442", // yellow
  "#000000", // black (use sparingly; falls back to var(--foreground) at runtime)
] as const;

// ColorBrewer "Set2" qualitative ramp (8). Lower-saturation; good for fills.
export const chartPaletteSet2 = [
  "#66C2A5",
  "#FC8D62",
  "#8DA0CB",
  "#E78AC3",
  "#A6D854",
  "#FFD92F",
  "#E5C494",
  "#B3B3B3",
] as const;

// Semantic palette — when a chart represents canonical AcreOS concepts
// (positive / warn / negative), prefer these so the chart matches the rest of
// the UI. Pulled from acr-* design tokens at runtime via CSS variables.
// NOTE: the --acr-* vars hold raw hex (see tailwind.config.ts acrToken), so
// they must NOT be wrapped in hsl(); shadcn vars (--primary etc.) are HSL
// triplets and DO need the hsl() wrapper.
export const chartPaletteSemantic = {
  primary: "hsl(var(--primary))",
  success: "var(--acr-pos)",
  warn: "var(--acr-warn)",
  danger: "var(--acr-neg)",
  // There is no acr info token; the theme accent is the closest neutral-
  // informational color in the system.
  info: "var(--acr-accent)",
  muted: "hsl(var(--muted-foreground))",
} as const;

// ---------------------------------------------------------------------------
// Stroke dash patterns — paired with colors so a B&W print or grayscale CVD
// simulation still distinguishes series.
// ---------------------------------------------------------------------------
export const chartDashArray = [
  "0",         // solid
  "6 3",       // dashed
  "2 2",       // dotted
  "10 3 2 3",  // dash-dot
  "4 4",       // long-short
  "8 2 2 2",   // dash-dot-dot
  "1 4",       // sparse dot
  "12 4",      // long dash
] as const;

// Marker shapes for line/scatter charts.
export const chartShapes = [
  "circle",
  "square",
  "triangle",
  "diamond",
  "cross",
  "star",
  "wye",
  "diamond",
] as const;

export type ChartShape = (typeof chartShapes)[number];

// ---------------------------------------------------------------------------
// SVG <pattern> ids — registered by <ChartPatternDefs />. Each pattern fills
// an area in a series-color hatching that survives grayscale.
// ---------------------------------------------------------------------------
export const CHART_PATTERN_IDS = [
  "chart-pattern-diag",
  "chart-pattern-dot",
  "chart-pattern-grid",
  "chart-pattern-cross",
  "chart-pattern-vert",
  "chart-pattern-horiz",
  "chart-pattern-zigzag",
  "chart-pattern-checker",
] as const;

export function getPatternUrl(idx: number): string {
  return `url(#${CHART_PATTERN_IDS[idx % CHART_PATTERN_IDS.length]})`;
}

// ---------------------------------------------------------------------------
// Series assignment.
// ---------------------------------------------------------------------------
export interface SeriesEncoding {
  color: string;
  strokeDasharray: string;
  shape: ChartShape;
  patternId: string;
}

/**
 * Returns a deterministic mapping from series key → visual encoding.
 * Use the same `keys` order across renders and the legend will stay stable.
 */
export function assignSeriesColors(
  keys: ReadonlyArray<string>,
  palette: ReadonlyArray<string> = chartPalette,
): Record<string, SeriesEncoding> {
  const out: Record<string, SeriesEncoding> = {};
  keys.forEach((key, i) => {
    out[key] = {
      color: palette[i % palette.length],
      strokeDasharray: chartDashArray[i % chartDashArray.length],
      shape: chartShapes[i % chartShapes.length],
      patternId: CHART_PATTERN_IDS[i % CHART_PATTERN_IDS.length],
    };
  });
  return out;
}

/**
 * Convenience: just the colors, indexed.
 */
export function chartColor(i: number): string {
  return chartPalette[i % chartPalette.length];
}

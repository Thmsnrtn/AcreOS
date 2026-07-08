/**
 * CHART_COLORS — the house categorical chart palette.
 *
 * Single source of truth for chart series colors. Derives every entry from
 * the active theme's CSS tokens (`--chart-1` … `--chart-5`, defined for all
 * five themes in BOTH light and dark in `client/src/index.css`), so charts
 * re-skin automatically when the user switches theme or mode — no more
 * hardcoded hex fills that look right in one theme and wrong in nine others.
 *
 * Fallbacks: each entry carries the Bedrock-light HSL triplet as a `var()`
 * fallback so a render without the stylesheet (unit tests, isolated
 * Storybook-style mounts) still produces sensible colors. At runtime the
 * fallback never fires — the Bedrock block is also bound to bare `:root`.
 *
 * Relationship to `chartPalette.ts`: that module is the WCAG/CVD-validated
 * fixed palette (Wong 2011) plus the shape/dash/pattern encodings. Reach for
 * it when a chart MUST stay color-blind-distinguishable across many series
 * regardless of theme (pair with `ChartPatternDefs`). For everything else —
 * ordinary categorical fills, pies, bars, reference lines — use CHART_COLORS
 * so the chart belongs to the theme.
 *
 * Semantic accents: when a mark encodes outcome sentiment (gain/loss,
 * pass/fail), use CHART_POS / CHART_NEG / CHART_WARN — these track the same
 * `acr-*` tokens the rest of the UI uses (house pattern: founder/cost.tsx).
 */

/** Builds an `hsl(var(--chart-N, <fallback>))` color string. */
const chartToken = (n: 1 | 2 | 3 | 4 | 5, fallback: string): string =>
  `hsl(var(--chart-${n}, ${fallback}))`;

/**
 * Ordered categorical palette. Index into it with `chartColorVar(i)` (cycles)
 * or spread it directly into Recharts `<Cell fill>` maps.
 */
export const CHART_COLORS: readonly string[] = [
  chartToken(1, "14 60% 39%"),
  chartToken(2, "36 61% 45%"),
  chartToken(3, "84 28% 35%"),
  chartToken(4, "30 27% 24%"),
  chartToken(5, "34 21% 40%"),
];

/** Cycling accessor — safe for any non-negative series index. */
export function chartColorVar(i: number): string {
  return CHART_COLORS[Math.abs(i) % CHART_COLORS.length];
}

// ---------------------------------------------------------------------------
// Semantic chart accents — outcome-sentiment marks (gain/loss, alert bands).
// `acr-*` tokens are raw color values (not HSL triplets), so these use bare
// var() with the Bedrock-light value as the documented fallback — the same
// idiom as founder/cost.tsx (`var(--acr-pos, …)`).
// ---------------------------------------------------------------------------

/** Positive / gain marks. Tracks `text-acr-pos` used elsewhere in the UI. */
export const CHART_POS = "var(--acr-pos, #5A7340)";

/** Negative / loss marks. Tracks `text-acr-neg`. */
export const CHART_NEG = "var(--acr-neg, #8E2B16)";

/** Caution marks (thresholds, at-risk bands). Tracks `text-acr-warn`. */
export const CHART_WARN = "var(--acr-warn, #B97A1E)";

/** Brand/primary single-series fill — matches buttons, rings, links. */
export const CHART_PRIMARY = "hsl(var(--primary, 14 60% 39%))";

/** De-emphasized marks: baselines, "other" buckets, disabled series. */
export const CHART_MUTED = "hsl(var(--muted-foreground, 34 21% 40%))";

/** Grid lines / axis strokes — matches the UI border token. */
export const CHART_GRID = "hsl(var(--border, 34 26% 69%))";

/** Card-surface fill — e.g. masking an area under a confidence band. */
export const CHART_SURFACE = "hsl(var(--card, 41 51% 92%))";

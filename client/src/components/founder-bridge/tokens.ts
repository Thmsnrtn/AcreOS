/**
 * Bridge design tokens.
 *
 * The Bridge surface uses a tightly-restrained palette so a single
 * amber accent reads as "live / active / now." Anything that isn't
 * the accent stays monochrome. If you need another color, ask first.
 */

/**
 * The one accent. Warm amber, identical to the brief_card rail so the
 * Bridge feels continuous with the morning brief artifact.
 *
 * The literal is the fallback only — runtime resolves through the
 * `--acr-bridge-accent` CSS variable defined in `client/src/index.css`,
 * so per-theme overrides land here without touching component code.
 * Prefer the Tailwind utility `bg-acr-bridge-accent` / `text-acr-bridge-accent`
 * over inline style usage of this constant.
 */
export const BRIDGE_ACCENT = "var(--acr-bridge-accent, #FFB547)";

/**
 * Hairline border colors. Tokenized as `--acr-line` so they pick up the
 * active theme's hairline value (BEDROCK light vs dark, etc.) instead
 * of holding a literal rgba.
 *
 * Most call sites should reach for the `border-acr-line` utility
 * directly; these constants exist for the handful of places that need
 * the value as a JS string (inline style objects, canvas/SVG).
 */
export const TILE_BORDER = "var(--acr-line)";
export const TILE_BORDER_HOVER = "var(--acr-line, rgba(255,255,255,0.10))";
export const TILE_TOP_HIGHLIGHT = "var(--acr-line-soft)";

/**
 * Corner radii. 20pt desktop matches iOS 16+ widget radius; 16pt mobile
 * keeps the perceived radius constant at a smaller tile size.
 */
export const TILE_RADIUS_DESKTOP = 20;
export const TILE_RADIUS_MOBILE = 16;

/**
 * Internal padding. Generous inside, tight gutters between.
 */
export const TILE_PADDING_DESKTOP = 24;
export const TILE_PADDING_MOBILE = 16;

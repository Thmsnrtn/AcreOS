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
 */
export const BRIDGE_ACCENT = "#FFB547";

/**
 * Hairline border colors. Borders + a single inner highlight at the
 * top edge provide depth; never drop shadows.
 */
export const TILE_BORDER = "rgba(255,255,255,0.06)";
export const TILE_BORDER_HOVER = "rgba(255,255,255,0.10)";
export const TILE_TOP_HIGHLIGHT = "rgba(255,255,255,0.04)";

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

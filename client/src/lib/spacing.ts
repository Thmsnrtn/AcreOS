/**
 * Canonical 4pt spacing grid — Apple's HIG baseline.
 *
 * Use these constants when you'd otherwise hardcode pixel values.
 * Tailwind's default spacing scale (1=4px, 2=8px, 3=12px, ...) already
 * follows this grid, so prefer Tailwind utilities; reach for these
 * constants only when computing inline styles or animation distances.
 */

export const SPACE_1 = 4;   // 0.25rem
export const SPACE_2 = 8;   // 0.5rem
export const SPACE_3 = 12;  // 0.75rem
export const SPACE_4 = 16;  // 1rem  — default gutter
export const SPACE_5 = 20;
export const SPACE_6 = 24;
export const SPACE_8 = 32;
export const SPACE_10 = 40;
export const SPACE_12 = 48;
export const SPACE_16 = 64;

/**
 * Minimum touch target for mobile — Apple HIG mandates 44pt. Use as
 * `min-h-[var(--touch-target)]` or `style={{ minHeight: TOUCH_TARGET_PT }}`.
 */
export const TOUCH_TARGET_PT = 44;

/**
 * Card corner radii. The chat uses 16pt corners on bubbles + artifacts,
 * 12pt on smaller inline chips, 8pt on form inputs. Apple's typical
 * gradient from large surfaces (more curve) to small inputs (less).
 */
export const RADIUS_CHIP = 12;
export const RADIUS_CARD = 16;
export const RADIUS_SHEET = 20;

/**
 * Hairline border width. Apple uses ~1px in light mode that becomes
 * invisible in dark; substitute a soft shadow instead. Mostly only
 * relevant when overriding Tailwind borders.
 */
export const HAIRLINE_PX = 1;

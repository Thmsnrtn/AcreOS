/**
 * AcreOS z-index registry.
 *
 * Single source of truth for stacking layers across the app. The 2026-05
 * spatial-overlap audit found ad-hoc `z-50` literals on the mobile FAB,
 * the cookie banner, the PWA install prompt, and the notification
 * banner — all of which collided on a 375 wide viewport because none
 * of them knew about each other. This registry exists so new code can
 * pick a deliberately-numbered layer instead of guessing.
 *
 * PREFER the Tailwind semantic tokens. The canonical scale now lives in
 * tailwind.config.ts (`theme.extend.zIndex`) and as `--z-*` custom
 * properties in index.css. In JSX, say:
 *   <div className="fixed bottom-4 right-4 z-floating" />   // not z-50
 *   <div className="z-modal" />  <div className="z-toast" />
 *
 * This `Z` registry is the runtime mirror of that scale, for the rare
 * case that needs a numeric zIndex in an inline `style` (e.g. a value
 * computed in JS). The token names below map 1:1 to the Tailwind tokens:
 *   FAB/BOTTOM_NAV/… (50) → z-floating · MODAL_SCRIM/… (60) → z-modal
 *   TOAST (100) → z-toast · DYNAMIC_ISLAND (9998) → z-island, etc.
 *   <div style={{ zIndex: Z.FAB }} />          // or "var(--z-floating)"
 *
 * Migration is now DONE (Tahoe Wave F1): the arbitrary `z-[60]`/`z-[100]`/
 * `z-[9998]`/`z-[9999]` escapees were renamed to semantic tokens, and a
 * ratchet (scripts/lint-zindex.mjs) blocks any new raw `z-[…]` in
 * client/src .tsx. New code MUST use the semantic tokens, never a
 * numeric literal or arbitrary value.
 *
 * Layer numbering policy (low → high). Gaps left between bands so
 * future layers can slot in without renumbering the world.
 */
export const Z = {
  // ── In-flow stacking helpers ──────────────────────────────────────
  CARD_HOVER: 1,
  STICKY_SUBHEADER: 10,
  TABLE_HEADER: 10,
  PAGE_TOPBAR: 30,
  AUTOPILOT_STATUSBAR: 40,
  NOTIFICATIONS_TOP: 40,

  // ── Floating mobile chrome (bottom of viewport) ───────────────────
  // These compete for the bottom-right / bottom-center area on phone
  // viewports. Keep them in a tight band so the modal scrim can rise
  // above all of them with a single declared layer.
  CONVERSATION_TRAY: 49,
  HELP_SLOT: 48,
  FAB: 50,
  BOTTOM_NAV: 50,
  COOKIE_BANNER: 50,
  PWA_PROMPT: 50,
  NOTIFICATION_BANNER: 50,

  // ── Modals open above all bottom chrome ───────────────────────────
  MODAL_SCRIM: 60,
  COMMAND_PALETTE: 60,
  NEW_ITEM_MENU: 60,

  // ── Toasts above modals ───────────────────────────────────────────
  TOAST: 100,

  // ── Offline indicator above everything except critical OS chrome ──
  OFFLINE_INDICATOR: 110,

  // ── Tour / live demo / dynamic island sit highest ─────────────────
  PRODUCT_TOUR: 9990,
  DYNAMIC_ISLAND: 9998,
  DEMO_HIGHLIGHT: 9999,
  DEMO_TOP: 10000,
} as const;

export type ZLayer = keyof typeof Z;

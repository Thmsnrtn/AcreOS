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
 * Reference these constants from JSX:
 *   import { Z } from "@/lib/z-index"
 *   <div style={{ zIndex: Z.FAB }} />
 *
 * Or with Tailwind's arbitrary-value syntax:
 *   <div className={`fixed bottom-4 right-4 z-[${Z.FAB}]`} />
 *
 * IMPORTANT — Migration policy:
 *   Components currently using inline `z-50` / `z-[60]` literals are
 *   NOT auto-migrated by introducing this file — adopting it across
 *   the existing surface area is intentionally a separate track to
 *   avoid merge conflicts with parallel UI work. New code MUST use
 *   this registry; existing code adopts it on next touch.
 *
 *   To find migration candidates, run:
 *     grep -rn 'z-\[\?[0-9]' client/src
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

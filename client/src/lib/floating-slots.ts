/**
 * Floating-slot layout — canonical positions for every bottom-right
 * floating element. Before this file, 8 components picked their own
 * bottom/right values independently and three pairs collided.
 *
 * Slots are assigned vertically from the bottom-right corner:
 *   slot 0 — primary CTA (most thumb-accessible)
 *   slot 1 — chat/agent toggle
 *   slot 2 — help
 *   slot 3 — feedback (auth'd users only, dev+beta)
 *
 * Mobile values are offset to clear the 72px MobileBottomNav that
 * sits fixed bottom-0. Desktop values assume no bottom nav.
 *
 * Each slot is 56px (button) + 16px gap = 72px tall.
 * Values are expressed as Tailwind classnames so components can
 * compose them into their own class strings.
 */

export const FLOATING_SLOT = {
  // Bottom-right stack (primary user actions)
  // md:right-16 (64px) clears the 48px PaxCopilotRail that lives
  // fixed right-0 on desktop. Mobile uses right-4 since the rail
  // isn't shown there.
  fab: "fixed bottom-[88px] md:bottom-4 right-4 md:right-16 z-50 safe-area-bottom",
  conversation: "fixed bottom-[160px] md:bottom-24 right-4 md:right-16 z-[49] safe-area-bottom",
  help: "fixed bottom-[232px] md:bottom-[176px] right-4 md:right-16 z-[48] safe-area-bottom",
  feedback: "fixed bottom-[304px] md:bottom-[248px] right-4 md:right-16 z-[47] safe-area-bottom",

  // Top-right (notifications, chrome)
  notificationsTop: "fixed top-4 right-4 z-40",

  // Bottom-left (secondary, avoids the right-stack entirely)
  bottomLeft: "fixed bottom-4 left-4 z-40 safe-area-bottom",
} as const;

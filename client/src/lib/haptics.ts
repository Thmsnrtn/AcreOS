/**
 * haptics.ts — PWA haptic feedback layer
 *
 * AcreOS targets iOS PWA as the primary mobile surface (Tom's audience).
 * iOS Safari has limited vibration support (navigator.vibrate() is a
 * no-op on iOS in the browser context — Apple gates real taptic feedback
 * behind Capacitor / native). Android Chrome honors navigator.vibrate()
 * natively.
 *
 * Strategy:
 *   1. In Capacitor (native iOS/Android), use @capacitor/haptics for
 *      rich taptic patterns (Impact, Notification, Selection).
 *   2. In web/PWA context, use navigator.vibrate() — works on Android,
 *      gracefully no-ops on iOS Safari. No error thrown.
 *   3. Always respect prefers-reduced-motion — haptics are a motion
 *      signal. Users who opt out of motion also opt out of vibration.
 *
 * Usage:
 *   import { lightImpact, mediumImpact, success, warning } from "@/lib/haptics";
 *
 *   // In an event handler (non-async, fire-and-forget):
 *   lightImpact();   // threshold crossed, card committed, low-stakes confirm
 *   mediumImpact();  // irreversible action confirm (constitution-grade)
 *   success();       // deal closed, payment confirmed
 *   warning();       // destructive action, overdue alert
 */

import { Capacitor } from "@capacitor/core";

// ─── Reduced-motion guard ────────────────────────────────────────────────────

function isReducedMotion(): boolean {
  if (typeof window === "undefined") return true;
  // Respect OS-level preference
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return true;
  // Respect app-level manual override (see index.css data-motion="reduced")
  if (document.documentElement.getAttribute("data-motion") === "reduced") return true;
  return false;
}

// ─── Platform detection ──────────────────────────────────────────────────────

const isNativeCapacitor = Capacitor.isNativePlatform();

// ─── Capacitor haptic helpers (lazy-import to avoid bundling in SSR) ─────────

async function nativeLight() {
  const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
  await Haptics.impact({ style: ImpactStyle.Light });
}

async function nativeMedium() {
  const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
  await Haptics.impact({ style: ImpactStyle.Medium });
}

async function nativeHeavy() {
  const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
  await Haptics.impact({ style: ImpactStyle.Heavy });
}

async function nativeSuccess() {
  const { Haptics, NotificationType } = await import("@capacitor/haptics");
  await Haptics.notification({ type: NotificationType.Success });
}

async function nativeWarning() {
  const { Haptics, NotificationType } = await import("@capacitor/haptics");
  await Haptics.notification({ type: NotificationType.Warning });
}

// ─── Web fallback (navigator.vibrate) ────────────────────────────────────────
// Patterns are [on, off, on, …] in milliseconds. iOS Safari silently ignores.

function webVibrate(pattern: number | number[]): void {
  if (typeof navigator === "undefined") return;
  if (!("vibrate" in navigator)) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Some browsers expose navigator.vibrate but throw on call (e.g. iframe
    // sandboxing). Swallow silently — haptics are enhancement-only.
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Light impact — use at:
 * - Swipe commit threshold crossed (SwipeableCard)
 * - Decision Queue snooze confirmed
 * - Pull-to-refresh trigger threshold crossed
 * - Any low-stakes action confirmation
 */
export function lightImpact(): void {
  if (isReducedMotion()) return;
  if (isNativeCapacitor) {
    nativeLight().catch(() => {/* no-op */});
    return;
  }
  webVibrate(10);
}

/**
 * Medium impact — use at:
 * - Irreversible action confirmations (delete, archive, send)
 * - Constitution-grade destructive confirms
 */
export function mediumImpact(): void {
  if (isReducedMotion()) return;
  if (isNativeCapacitor) {
    nativeMedium().catch(() => {/* no-op */});
    return;
  }
  webVibrate(20);
}

/**
 * Heavy impact — use at:
 * - Modal/sheet dismiss with force
 * - Critical error / system-level interrupts (rare)
 */
export function heavyImpact(): void {
  if (isReducedMotion()) return;
  if (isNativeCapacitor) {
    nativeHeavy().catch(() => {/* no-op */});
    return;
  }
  webVibrate(30);
}

/**
 * Success — use at:
 * - Deal closed confirmation
 * - Payment confirmed
 * - Sync complete (meaningful milestone)
 */
export function successFeedback(): void {
  if (isReducedMotion()) return;
  if (isNativeCapacitor) {
    nativeSuccess().catch(() => {/* no-op */});
    return;
  }
  webVibrate([10, 50, 10]);
}

/**
 * Warning — use at:
 * - Overdue alert surfaced
 * - Destructive action gate before the confirm dialog
 */
export function warningFeedback(): void {
  if (isReducedMotion()) return;
  if (isNativeCapacitor) {
    nativeWarning().catch(() => {/* no-op */});
    return;
  }
  webVibrate([15, 30, 15]);
}

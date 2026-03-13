/**
 * Platform detection utility for AcreOS multi-platform support.
 *
 * Detects whether the app is running inside Capacitor (iOS/Android native),
 * Tauri (desktop), or a standard web browser.
 */

import { Capacitor } from "@capacitor/core";

// ─── Platform detection ──────────────────────────────────────────────────────

/** True when running inside a Capacitor native shell (iOS or Android). */
export const isNative: boolean = Capacitor.isNativePlatform();

/** True when running inside a Tauri desktop shell. */
export const isDesktop: boolean =
  typeof window !== "undefined" && !!(window as any).__TAURI__;

/** True when running in a standard web browser (not native, not desktop). */
export const isWeb: boolean = !isNative && !isDesktop;

// ─── OS detection ────────────────────────────────────────────────────────────

/** True when the native platform is iOS. */
export const isIOS: boolean = Capacitor.getPlatform() === "ios";

/** True when the native platform is Android. */
export const isAndroid: boolean = Capacitor.getPlatform() === "android";

/** True when running on macOS (Tauri desktop or Safari on Mac). */
export const isMac: boolean =
  typeof navigator !== "undefined" &&
  /Macintosh|Mac OS X/i.test(navigator.userAgent);

/** True when running on Windows (Tauri desktop or browser on Windows). */
export const isWindows: boolean =
  typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);

// ─── Combined platform string ────────────────────────────────────────────────

export type Platform =
  | "ios"
  | "android"
  | "mac-desktop"
  | "windows-desktop"
  | "desktop"
  | "web";

function detectPlatform(): Platform {
  if (isIOS) return "ios";
  if (isAndroid) return "android";
  if (isDesktop) {
    if (isMac) return "mac-desktop";
    if (isWindows) return "windows-desktop";
    return "desktop";
  }
  return "web";
}

/** The current platform as a descriptive string. */
export const platform: Platform = detectPlatform();

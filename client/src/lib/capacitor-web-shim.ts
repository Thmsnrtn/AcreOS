/**
 * The web build's stand-in for `@capacitor/core` (bundle offset BD-4,
 * ridden in-PR by the notes decision desk, Step 0 N3+N4).
 *
 * WHY THIS EXISTS. The customer bundle shipped the whole @capacitor/core
 * runtime (~23 KB rendered in the entry chunk) so two modules —
 * `lib/platform.ts` and `lib/haptics.ts` — could ask it two questions. On
 * the web those questions have CONSTANT answers, because the real core
 * computes them from the absence of a native bridge:
 *
 *   Capacitor.isNativePlatform()  →  false
 *   Capacitor.getPlatform()       →  "web"
 *
 * vite.config.ts aliases `@capacitor/core` to this module in the WEB builds
 * (customer + founder), so the bundle ships the answers instead of the
 * runtime that derives them.
 *
 * THE PLUGIN SURFACE. Every @capacitor plugin is dynamically imported
 * behind the `isNative` gate (the hooks in client/src/hooks and the
 * haptics layer), so on web no plugin module ever evaluates, and in a
 * native build there is no alias. But Rollup still BUILDS the plugin
 * chunks, and their modules import four names from the core:
 * `registerPlugin` (every plugin index), `WebPlugin` (every plugin's web
 * implementation subclasses it), `CapacitorException` and
 * `buildRequestInit`. The stubs below exist so those chunks build; each
 * one throws if it is ever actually exercised in a web build, so a plugin
 * that somehow loads on web fails loudly instead of half-working against
 * a shim. (Derived from the installed plugins' dist/esm imports; a
 * capacitor bump that widens the set fails the build — visibly, here.)
 *
 * THE NATIVE FENCE. A native build must link the REAL core, or the shell
 * would report itself as web. `ACREOS_NATIVE_BUILD=1` removes the alias —
 * the `mobile:*` package scripts set it — and
 * tests/unit/capacitorWebShim.test.ts pins both halves: alias present by
 * default, absent under the flag, the two web constants exact, and the
 * plugin-facing stubs present.
 */

export const Capacitor = {
  isNativePlatform: (): boolean => false,
  getPlatform: (): string => "web",
};

const SHIMMED =
  "@capacitor/core is shimmed in web builds (client/src/lib/capacitor-web-shim.ts) — native plugins are unavailable on web.";

export function registerPlugin(): never {
  throw new Error(SHIMMED);
}

export class WebPlugin {
  constructor() {
    throw new Error(SHIMMED);
  }
}

export class CapacitorException extends Error {}

export function buildRequestInit(): never {
  throw new Error(SHIMMED);
}

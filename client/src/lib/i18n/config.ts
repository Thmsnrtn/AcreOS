/**
 * i18n configuration — Lens 49 scaffold.
 *
 * AcreOS is English-only today. This module wires `react-i18next` with
 * a single bundled `en` locale so we can start migrating hardcoded
 * strings to `t("…")` calls without a translation pipeline yet. Adding
 * a second locale later is a matter of:
 *
 *   1. Dropping a JSON file in `./locales/<lang>.json`.
 *   2. Registering it under `resources` below.
 *   3. Adding a language selector to user settings that calls
 *      `i18n.changeLanguage(code)`.
 *
 * Why react-i18next vs. alternatives (see docs/i18n-guide.md for the
 * full comparison):
 *
 *   - `next-intl` requires Next.js, which AcreOS does not use (Vite +
 *     wouter).
 *   - `lingui` ships a compiler that's nicer for ICU-heavy copy but
 *     adds a Babel/SWC step on top of Vite — net friction for a code-
 *     base this size.
 *   - `formatjs`/`react-intl` is solid but heavier and the API is more
 *     verbose for plain key lookup, which is 95% of our needs.
 *   - `react-i18next` is the most popular for Vite + React, supports
 *     lazy-loaded namespaces, has a tiny escape hatch (`t("key", { defaultValue })`),
 *     and integrates with the existing `personaVocabulary` registry
 *     via a thin wrapper.
 *
 * Bundle cost: ~12kb gzipped for i18next + react-i18next + the en
 * bundle. The en bundle is statically imported here (not lazy) because
 * it's tiny and needs to be available before the first paint to avoid
 * a flash of untranslated keys.
 */

import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";

export const DEFAULT_LOCALE = "en" as const;
export const SUPPORTED_LOCALES = ["en"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
  },
  lng: DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  // We intentionally don't escape — React already escapes JSX
  // children, and double-escaping breaks straight-quote → typographic-
  // quote rendering when keys contain "'".
  interpolation: { escapeValue: false },
  // Returning the key itself when a translation is missing makes gaps
  // obvious in dev without crashing the surface.
  returnNull: false,
  returnEmptyString: false,
  // Namespaces ship as a single `translation` bundle today; split when
  // the bundle crosses ~50kb (see i18n-guide.md "When to split").
  defaultNS: "translation",
});

export { i18n };
export default i18n;

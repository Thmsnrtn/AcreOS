/**
 * `useT` — AcreOS translation hook.
 *
 * Thin wrapper over `react-i18next`'s `useTranslation` that:
 *
 *   1. Returns a stable `t` function with TypeScript-narrowed string
 *      return (the default react-i18next return type widens to
 *      `string | object`, which forces a cast at every call site).
 *   2. Composes cleanly with `useTerm` from `@/lib/personaVocabulary`
 *      — call `t("entity.lead.label")` for chrome strings; call
 *      `useTerm("entity.lead")` for persona-overrideable nouns.
 *      Both can live in the same component.
 *
 * Persona-vocabulary × locale matrix (see docs/i18n-guide.md): when a
 * key is BOTH locale-sensitive and persona-sensitive (e.g. "Leads" →
 * "Note opportunities" for note_investor; both need to translate to
 * Spanish), the persona-vocabulary registry remains the source of
 * truth and its values themselves become i18n keys. Today: en-only,
 * so the registry's string values render directly.
 */

import { useTranslation } from "react-i18next";

export type TFunction = (key: string, opts?: Record<string, unknown>) => string;

export function useT(): { t: TFunction; locale: string } {
  const { t, i18n } = useTranslation();
  return {
    t: ((key, opts) => t(key, opts) as string) as TFunction,
    locale: i18n.language,
  };
}

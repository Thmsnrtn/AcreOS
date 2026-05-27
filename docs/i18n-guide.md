# i18n Guide

AcreOS is English-only at launch. This document describes the scaffolded
i18n foundation (Lens 49) and how to extend it when a second locale is
needed.

## Stack

- **Library:** [`react-i18next`](https://react.i18next.com/) on top of
  `i18next`. Picked because:
  - Most popular for non-Next React + Vite (large ecosystem, examples).
  - Supports namespaces + lazy-loaded bundles when the locale file grows.
  - Tiny escape hatch — `t("key", { defaultValue: "…" })` lets us migrate
    incrementally without breaking surfaces that haven't been touched yet.
  - ~12kb gzipped including the en bundle.
- **Bootstrap:** `client/src/lib/i18n/config.ts` — single-file init,
  imported once from `main.tsx` as a side effect.
- **Hook:** `client/src/lib/i18n/useT.ts` — thin wrapper that returns a
  TypeScript-narrowed `t` function.
- **Locale bundles:** `client/src/lib/i18n/locales/<lang>.json` — nested
  keys, one file per locale.

## Adding a new locale

1. Copy `client/src/lib/i18n/locales/en.json` to
   `client/src/lib/i18n/locales/<lang>.json` and translate the values.
2. Register the new locale in `config.ts`:

   ```ts
   import es from "./locales/es.json";

   export const SUPPORTED_LOCALES = ["en", "es"] as const;

   void i18n.use(initReactI18next).init({
     resources: {
       en: { translation: en },
       es: { translation: es },
     },
     // …
   });
   ```

3. Add a language selector somewhere in user settings that calls
   `i18n.changeLanguage(code)` and persists the choice. The org-scoped
   onboarding state in `organizations` is the right surface for a
   per-organization default; a user override should live on the user
   record.
4. If the bundle exceeds ~50kb gzipped, split into namespaces (one file
   per top-level key) and load lazily via `i18next-http-backend`.

## Extracting strings from JSX

Run:

```
node scripts/i18n-extract.mjs
```

This grep-walks `client/src/**/*.{ts,tsx}` and flags JSX text nodes /
common prop values (`title=`, `placeholder=`, `aria-label=`) that look
like hardcoded English. Output is a CSV at `./i18n-candidates.csv`
ranked by occurrence count — the top of the list is where extraction
buys the most coverage per migrated file.

The script is intentionally conservative: it does not auto-modify
files. It exists to make the gap visible.

## Migration pattern per surface

Before:

```tsx
<Button>Save changes</Button>
```

After:

```tsx
const { t } = useT();
// …
<Button>{t("common.save")}</Button>
```

Add the corresponding key to `en.json`. The `defaultValue` escape hatch
is fine for the in-between state but should be removed once the key is
in the bundle.

## Persona vocabulary × locale matrix

`client/src/lib/personaVocabulary.ts` maps shared concept keys (e.g.
`entity.lead`) to persona-specific copy ("Lead" / "Note opportunity" /
"Motivated seller"). When a key is **both** locale-sensitive and
persona-sensitive:

- `personaVocabulary` remains the source of truth for the noun choice.
- The string values it returns become i18n keys themselves. e.g. for a
  Spanish bundle: `t("vocab.entity.lead.land_investor") → "Pista"`.

Until a second locale lands, the registry's string values render
directly — no double indirection.

## Formatting (dates, currency, numbers)

The codebase already routes through `client/src/lib/format.ts` for
money / dates / counts (548+ `Intl.*` call sites). Today every formatter
hard-codes `"en-US"` and `"USD"`. The migration is:

1. Make formatters accept an optional `locale` arg defaulting to the
   current `i18n.language`.
2. Make `currency` configurable on a per-organization basis (already
   half-modeled in the billing tables; needs a single org-level setting).
3. Replace bare `.toLocaleDateString()` / `.toLocaleString()` calls in
   pages with the centralized helpers. The extraction script will flag
   the remaining bare calls.

## RTL readiness

Tailwind v3 ships `rtl:` utility variants but **zero** instances exist
in the current codebase. When a RTL locale lands:

1. Set `<html dir>` based on `i18n.language` in `App.tsx`.
2. Audit components that hardcode `ml-*` / `mr-*` / `pl-*` / `pr-*` /
   `left-*` / `right-*` and convert to logical equivalents (`ms-*` /
   `me-*` / `ps-*` / `pe-*` / `start-*` / `end-*`) or add `rtl:` mirror
   utilities.
3. Audit icon components for directional glyphs (chevrons, arrows).

## Validators that will break under expansion

These are tied to US formats and need locale-aware versions before a
non-US locale ships:

- Phone numbers — currently `^\+?1?\d{10}$`-style regex in form
  schemas. Swap for `libphonenumber-js` parsing.
- ZIP codes — `^\d{5}(-\d{4})?$`. Need country-conditional validation.
- Tax IDs (SSN / EIN). US-only today.
- Address forms — fixed state/zip layout.

## When to split into namespaces

Default is a single `translation` bundle. Split when:

- Any one locale bundle exceeds ~50kb gzipped.
- Or a feature ships its own large copy block (e.g. an academy / docs
  surface) that public landing users don't need to download.

Pattern: name namespaces after route trees — `landing`, `app`,
`academy`. Lazy-load with `i18next-http-backend`.

# Nakamura Yuki — i18n Infrastructure Audit

> **Auditor:** Nakamura Yuki, 42 — Tokyo / Berlin
> **Background:** ex-Crowdin (l10n platform engineer, 4 yrs), ex-Lokalise (i18n SDK lead, 3 yrs), independent since 2024
> **Lens:** Product i18n infrastructure — react-i18next setup, ICU MessageFormat, locale negotiation, RTL, content pipeline, MT + human-review workflow
> **Wave:** 3 — elite-team-deeper, May 1 2026
> **Trigger:** Wave 3 personas Esperanza (Spanish/TX border), Linh (Vietnamese/TX), Mateus (Portuguese/MA), Camille (French-Canadian/QC), Heng (Khmer/CA Central Valley) all flagged AcreOS as English-only with no localization seam
> **Verdict at top:** **No infrastructure exists. This is a 12-week build, not a config flag.** The blueprint below is what shipping bilingual the right way looks like — so when the second locale lands, the third through tenth are configuration changes, not engineering campaigns.

---

## 1. What I verified before writing

- `client/index.html` — `<html lang="en">` is hardcoded.
- `package.json` — no `i18next`, no `react-i18next`, no `react-intl`, no `formatjs`, no `@lingui/*`, no `next-intl` (the app uses Vite + Wouter, not Next, but stating for completeness). Only `date-fns` (single-locale import) and the bundled `Intl.*` runtime.
- `client/src/lib/format.ts` — every formatter pins `"en-US"`. The file's own header comment ("Centralizes rules so a change (e.g. adding i18n) happens once") is the engineering intent. The seam is correct; nobody has walked through it.
- `grep -r "useTranslation\|t(" client/src` — zero matches outside of `useToast` and unrelated symbols. Every UI string is a JSX literal.
- No `locales/`, `i18n/`, `translations/`, or `messages/` directory. No PO/POT, no XLIFF, no JSON catalogs. No translation memory. No glossary.
- `server/utils/emails/*` — every transactional email subject + body is a JS template literal in English. No locale negotiation off `Accept-Language` or user preference.
- `server/db/schema.ts` — `users` table has no `locale` column. `organizations` has no `defaultLocale`. `leads` has no `preferredLanguage`. `documents` has no `language`.
- The signing surface (`server/routes-public-sign.ts`) — borrower-facing — is English-only. This is the single highest-risk surface and Esperanza's audit hits it hardest.

So we are not at "incomplete bilingual." We are at **zero infrastructure, single seam half-prepared, content debt unbounded.**

---

## 2. The conceptual split — and why most teams get it wrong

There are **three** content classes, not two. Most teams ship two, and the third bites them in year two.

1. **Static UI strings.** Button labels, page titles, empty states, error messages. ~3,000 strings in AcreOS by my count (table headers + nav + page chrome + form labels + toast text + empty/error states + email subjects). These belong in JSON catalogs, keyed, ICU-formatted, owned by engineering, translated by humans.
2. **Dynamic user-generated content.** A lead's notes, a property description, a campaign body, a borrower's name. Lives in the database. Cannot be statically translated. Needs **on-demand MT** (DeepL/Google Cloud Translate) gated by user opt-in, with the source language stored and the translation cached in `content_translations`.
3. **Semi-static templated content.** Email templates, signing-flow consent text, PDF closing-doc boilerplate, the auto-generated "wire instructions" body. Looks dynamic (interpolated) but is structurally static (template + slots). This is where teams cheat — they hardcode English templates with `${name}` and discover at locale #3 that the slot order, the verb conjugation, the gendered article, and the date placement are all wrong.

**ICU MessageFormat handles class 3.** It's the only format that handles plurals + gender + select + nested interpolation correctly across locales. If we don't adopt it on day one we will rewrite all our templates on day 200.

---

## 3. Library choice — react-i18next vs alternatives

I'll save the bake-off. **react-i18next + i18next-icu + i18next-http-backend** is the right pick for AcreOS. Reasoning:

- **react-intl (formatjs)** is technically cleaner (ICU-native, no plugin needed) but its tree-shaking story and lazy-loading ergonomics are worse for a Vite SPA at our scale.
- **Lingui** is beautiful but the macro/babel-plugin pipeline doesn't compose with the existing Vite + SWC config without friction. Not worth it.
- **react-i18next** has the largest plugin ecosystem (TM integrations, ICU, backend connectors, Suspense support, namespacing), the best Crowdin/Lokalise/Phrase integrations, and battle-tested SSR/no-SSR paths.
- **i18next-icu** plugin gives us ICU MessageFormat on top of i18next's key-based catalog. Best of both worlds.

Bundle cost: ~22 KB gzipped for the runtime + ICU. Acceptable on a property-management dashboard.

---

## 4. The 12-week ship plan — phases, not sprints

### Phase 1 (weeks 1–2) — Infrastructure

- Add deps: `i18next`, `react-i18next`, `i18next-icu`, `i18next-http-backend`, `i18next-browser-languagedetector`.
- Add `client/src/i18n/index.ts` — initializes i18next with ICU, HTTP backend pointing at `/locales/{{lng}}/{{ns}}.json`, language detector, fallback to `en-US`.
- Wrap `<App />` in `<Suspense>` so dynamic locale loads don't flash.
- Add `users.locale` (TEXT, default `'en-US'`) and `organizations.defaultLocale` migrations.
- Add `Accept-Language` parsing on the server, attach `req.locale` middleware before any route that emits text (emails, signing flows, PDFs).

### Phase 2 (weeks 3–4) — Static-string extraction

- Run a codemod across `client/src` (jscodeshift + custom AST visitor) that extracts every JSX string literal and `placeholder` / `aria-label` / `title` prop into a key. Default key strategy: hash + path-context (e.g. `pages.parcels.detail.heading.title`).
- Output `locales/en-US/common.json`, namespaced per page. Aim for 6–8 namespaces (`common`, `auth`, `parcels`, `leads`, `closings`, `signing`, `emails`, `errors`).
- Plug into Crowdin or Lokalise via their CLI. Establish the source → CDN path (locales served from R2 / Cloudflare KV with versioned keys).

### Phase 3 (weeks 5–6) — Format consolidation

- Refactor `client/src/lib/format.ts` to take an optional `locale` arg, default-pulled from `i18n.language`. Every `Intl.NumberFormat`, `Intl.DateTimeFormat`, `Intl.PluralRules`, `Intl.RelativeTimeFormat` call uses the active locale.
- Replace `date-fns` per-import locale plumbing with `date-fns/locale/{lang}` lazy-loaded by i18next listener. Or — switch to **Luxon** for datetime, which uses Intl natively and skips the date-fns locale-import dance.
- The `plural()` helper at line 128 of `format.ts` is the canonical example of "English-only assumption baked in." Replace with `i18n.t('count', { count: n })` + ICU plural.

### Phase 4 (weeks 7–8) — Templated content

- Lift every email template into `locales/{lng}/emails.json` as ICU strings. The signing-invite email goes from a hand-built template literal to a single `t('emails.signing.invite.body', { borrowerName, parcelLabel, expiresIn })` call.
- Same for PDF boilerplate (closing docs, deed templates) — wire through to a server-side ICU formatter (`@formatjs/intl` on Node).
- Locale negotiation per-recipient: the borrower's preferred language (stored on `leads.preferredLanguage` — new column) wins over the org's default. The agent's UI locale never controls borrower-facing output.

### Phase 5 (weeks 9–10) — Dynamic content + MT pipeline

- New table: `content_translations(id, sourceTable, sourceId, sourceField, sourceLang, targetLang, translatedText, translatedBy, translatedAt, reviewedBy, reviewedAt)`.
- New service: `server/services/translationService.ts` — wraps DeepL Pro API (preferred — better quality than Google Translate for ES/PT/FR/VI; KM via Google fallback). Detects source lang via `franc` or DeepL's auto-detect. Caches by `(sourceText, targetLang)` content hash.
- UI: a small "Translate" button on lead notes, property descriptions, inbound borrower messages. Behind a per-user opt-in flag (some users distrust MT, especially Esperanza for legal-adjacent text).
- **Critical:** MT is never used for templated/legal content. Only for free-form. The boundary is enforced by which surfaces expose the button.

### Phase 6 (weeks 11–12) — Glossary, TM, review workflow

- Glossary: 200–400 land-investing terms with frozen translations. "Encumbrance," "deed of trust," "metes and bounds," "easement," "1031 exchange." Pin these in Crowdin/Lokalise so MT and human translators can't drift. Esperanza's Spanish glossary draft (in her audit) is the seed.
- Translation Memory: every approved translation flows back into the TM, bringing fuzzy-match leverage to the next string. Standard Crowdin/Lokalise feature; just needs to be turned on.
- Review workflow: MT-pretranslate → bilingual reviewer (in-house contractor, native-speaker Land Investor where possible) → engineer merges PR → CI runs schema-drift check (no missing keys, no orphan keys). PR-gated. ~24-hr turnaround per locale per release.

---

## 5. Locale detection — the precedence chain

Five signals, in this order:

1. **Explicit user preference** (`users.locale` if set).
2. **Org default** (`organizations.defaultLocale`).
3. **URL path prefix** (`/es/parcels/...`) — used by SEO surfaces only; the app shell does not path-prefix.
4. **`Accept-Language` header** matched against supported set via BCP-47 negotiation (`@formatjs/intl-localematcher`).
5. **Fallback: `en-US`.**

For borrower-facing surfaces (signing, payment portal, public listing pages) the chain is different: `lead.preferredLanguage` → URL prefix → `Accept-Language` → org default → `en-US`. The agent's locale is **not** in this chain. Camille's audit catches this exact bug pattern in three other vertical SaaS products.

---

## 6. RTL — what we owe Arabic/Hebrew/Urdu before we have those locales

We don't have Arabic users *yet*. We will (Heng's audit flags Khmer + suggests SE Asian + Middle Eastern Land Investors as Wave 5+). RTL must be a tier-zero plumbing decision now or it's a 6-week refactor later.

- All layouts use **logical CSS properties** (`margin-inline-start` not `margin-left`, `padding-inline` not `padding-left`/`padding-right`, `inset-inline` not `left`/`right`). Tailwind has `ms-*`, `me-*`, `ps-*`, `pe-*` utilities — adopt them now, codemod once, never again.
- `<html dir>` flips with locale: `dir="rtl"` for `ar`, `he`, `fa`, `ur`. Single line in the i18n init listener.
- Icons that imply direction (chevrons, back arrows, progress arrows) get a `[dir="rtl"]:scale-x-[-1]` utility class. Brand icons (logo) do not flip.
- Test grid: every page snapshot in Playwright runs once in `en` and once in `ar` (using a synthetic Arabic catalog of pseudo-strings). RTL bugs surface before a real Arabic translation lands.

---

## 7. Plurals, gender, and the things English hides

English has two plural forms (singular/plural). Polish has four. Arabic has six. Russian has three but with non-obvious rules. Hardcoded `${count} ${count === 1 ? 'item' : 'items'}` ternaries — and `format.ts` has *exactly this pattern* at line 133 — are wrong everywhere except English.

ICU MessageFormat:

```
{count, plural,
  =0 {No parcels}
  one {# parcel}
  other {# parcels}
}
```

The CLDR plural rules are baked into `Intl.PluralRules`; i18next-icu uses them. We do not hand-write these rules. We migrate the `plural()` helper to ICU and delete the regex-based -y/-s/-es/-ies branching — that logic is English-only and silently corrupts every other locale.

Gender + select clauses matter for Spanish, French, Portuguese, Hebrew. "Su agente le contactó" vs "Su agente la contactó" — the verb agrees with the borrower's gender, not the agent's. ICU `select` handles this; `users.preferredPronoun` (new column, optional) feeds it.

---

## 8. Date / number / currency — the per-locale rules

- **Currency.** `Intl.NumberFormat(locale, { style: 'currency', currency })` where `currency` is a per-org or per-deal property — *not* hardcoded `USD`. A Mexican Land Investor may want MXN listings; a Quebec-based investor may have CAD escrows.
- **Number grouping.** US uses `1,234,567.89`. Most of Europe uses `1.234.567,89`. India uses `12,34,567.89`. `Intl.NumberFormat` handles all three; never use `.toLocaleString('en-US')` (which `format.ts` does at line 80, 134, 137, 146).
- **Date format.** US `MM/dd/yyyy`. Most of the world `dd/MM/yyyy`. ISO-leaning `yyyy-MM-dd`. Use `Intl.DateTimeFormat` exclusively.
- **Relative time.** `Intl.RelativeTimeFormat`. Replaces the `formatDistanceToNow` import.
- **First day of week.** `Intl.Locale.prototype.weekInfo` (ECMA-402 stage 4) — calendar surfaces (closing schedules, payment-due grids) flip Sunday-first vs Monday-first per locale.

---

## 9. The MT + human-review pipeline — concrete shape

```
Source string lands in en-US/{ns}.json
    → CI detects new key (diff vs main)
    → Crowdin/Lokalise pulls via webhook
    → MT pretranslates target locales (DeepL Pro)
    → Reviewer queue surfaces string with TM matches + glossary hints
    → Reviewer accepts / edits / flags-for-context
    → Approved string flows to TM
    → CDN-versioned bundle published per locale per release
    → Client app fetches via i18next-http-backend, cached + ETagged
```

Cost shape: DeepL Pro is ~$25 / 1M chars. AcreOS UI strings are ~250 KB total English source. Pretranslating into ES/PT/FR/VI/KM = 1.25 MB chars = ~$31 one-time + ongoing per-release marginal. Reviewer cost: contractor at $50/hr, ~8 hr per locale per major release = $400/locale/release. **Five locales = $2K/release.** That is the marginal cost of localization at the AcreOS scale; it is not a budget problem, it is an organizational-discipline problem.

---

## 10. The 9 pitfalls I've seen kill product i18n at six other companies

1. **Concatenation as a substitute for ICU.** `t('hello') + ' ' + name` — breaks word order in Japanese, breaks gender in Spanish.
2. **No source-of-truth language tag in the DB.** When the borrower replies in Spanish to your English-by-default message, you have nothing to detect-against later.
3. **Locale negotiated off the *agent's* browser** for borrower-facing emails. Universal bug, universal damage.
4. **Currency conflated with locale.** `es-MX` ≠ MXN currency by definition. `es-US` is a real BCP-47 tag.
5. **No glossary, so "deed" gets translated three different ways across surfaces** by the same reviewer over six months.
6. **Strings in code, not catalogs**, "we'll extract them later." Later is never.
7. **Pluralization via ternary,** not ICU. Silent corruption in 90% of world languages.
8. **No pseudo-locale in CI.** Strings overflow buttons in German because nobody tested. Pseudo-loc adds 30% length + diacritics + brackets — surfaces overflow before real translation.
9. **No way for the user to override.** The user must be able to set their locale explicitly and have it stick across devices.

---

## 11. What ships in week 1 — the un-skippable foundation

If the team can only do five things before any locale beyond English exists, do these:

1. Install i18next + react-i18next + i18next-icu. Wrap `<App>`. Add `useTranslation()` import in three pilot pages.
2. Add `users.locale` and `organizations.defaultLocale` columns. No UI yet — just the seam.
3. Refactor `client/src/lib/format.ts` to accept a `locale` parameter (default `'en-US'`). One PR, mechanical.
4. Replace every `<html lang="en">` with a dynamic value bound to `i18n.language`.
5. Add `dir` attribute binding on `<html>`. Tailwind `ms-*`/`me-*` codemod across `client/src`. Today, before more pages get built.

After those five PRs land, the locale-add cost drops from "rewrite the app" to "add a JSON file + reviewer pass." That's the inflection. Everything else in this audit is sequenced behind it.

---

## 12. Verdict

AcreOS's `format.ts` header comment says *"a change (e.g. adding i18n) happens once."* That sentence has been in the file long enough to gather dust. The intent was correct. The follow-through is owed.

Ship phase 1 in two weeks. Ship phase 6 in twelve. Then the next locale is a configuration change, the seventh through tenth are weekend projects, and Esperanza, Linh, Mateus, Camille, and Heng stop being audit personas and start being onboarded customers.

— Nakamura

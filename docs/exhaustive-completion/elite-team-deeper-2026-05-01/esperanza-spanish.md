# Esperanza Ramirez — Spanish & Bilingual Audit

**Auditor:** Esperanza Ramirez, 46, McAllen TX
**Focus:** Hidalgo, Cameron, Starr, Webb counties — Texas border
**Portfolio:** ~22 active lots, mostly colonias-adjacent and rural ranchitos
**Wave:** 3 — Deeper completion, May 1 2026
**Date:** 2026-05-01

---

## Who I am, why this matters

Soy Esperanza. I close maybe forty deals a year up and down the Rio Grande Valley. My sellers are mostly Tejano abuelos and abuelas who inherited a tract from their parents — they speak Spanish at home, sign documents in Spanish when they can, and quietly get steamrolled when they can't. My buyers are split: half are local Mexican-American families wanting a place to put a casita, the other half are *fronterizos* from Reynosa or Matamoros buying recreational land north of the river.

I'm fluent enough in English to negotiate. I am NOT fluent enough in English real estate legalese to read a 14-page purchase agreement at the speed Pax wants me to. And my sellers are not fluent at all.

AcreOS today is English-only. Heng confirmed it in his Wave 2 audit. I'm here to say what that costs me, specifically, and what shipping bilingual support actually means — not just "throw it in Google Translate."

---

## What I verified before writing

- `client/index.html` — `<html lang="en">` hardcoded. No locale switch.
- No `i18next`, `react-intl`, `formatjs`, or `useTranslation` anywhere in `client/src`. Zero.
- `grep -ri "spanish\|español\|bilingual"` across client and server — nothing matches outside of node_modules.
- `server/services/eSigningService.ts` and `server/routes-public-sign.ts` — signing surfaces are English text, English email subjects, English consent language.
- No `locales/`, `i18n/`, or `translations/` directory in app code. Only zod's bundled locales in node_modules.

So the floor is: not "incomplete bilingual," it's "no bilingual infrastructure exists at all."

---

## Top findings

### 1. The signing experience is monolingual and that's a Texas legal problem

When I send a `Contract for Deed` to Doña Carmen in Pharr — 71 years old, third-grade education in Mexico, Spanish-only — AcreOS sends her a public sign link with English consent text, English field labels ("Initial Here", "Date of Birth"), English audit-trail receipts.

Texas Property Code §5.072 and §5.0143 require the seller-financing disclosure on a contract for deed to be provided in **the language of negotiation**. If I negotiated with Doña Carmen in Spanish — and I always do — and the disclosure is English-only, the contract is voidable. AcreOS is currently helping me ship voidable contracts.

This is not a UI polish item. It is a compliance hole.

**What's needed:**
- A `language_of_negotiation` field on the lead/deal record, captured at first contact.
- A second template slot per contract type: `template_en` and `template_es`, both rendered, both signed, both stored.
- The §5.072 / §5.0143 Spanish disclosure as a first-class artifact, not a PDF I have to email separately.

### 2. No locale toggle, period

There is no "Español" button. The Settings page has theme, density, color — nothing for language. A user who can't read English fluently has zero affordance in the product. They abandon onboarding or they ask their kids to read the screen for them. I have watched this happen.

**What's needed:**
- `i18next` (or equivalent) wired into `client/src/main.tsx`.
- `<html lang>` driven from user preference, defaulting to browser `Accept-Language`.
- Locale stored on `users.locale` AND `organizations.default_locale` — the org default matters because my VA in Monterrey logs into my org and she also wants Spanish.

### 3. The Pax assistant is unilingually condescending

Pax responds in English even when I type to it in Spanish. I tried `"redacta una carta de oferta para 5 acres en Starr County"` last Tuesday — Pax replied in English with an offer letter in English. The model can do Spanish. The system prompt is forcing English.

**What's needed:**
- Pax system prompt: detect input language, respond in same language unless user has set explicit output preference.
- Generated artifacts (offer letters, follow-up SMS templates) should match the **counterparty's** language, not mine. If my seller is Spanish-speaking, the SMS Pax drafts to send to that seller should be Spanish even if I'm typing prompts in English.

### 4. SMS templates assume English-speaking recipients

`sms-conversation.tsx` shows English templates: "Hi, this is regarding your property at...". I send these to Doña Carmen and she ignores them or calls her grandson. Conversion drops 40-50% on Spanish-dominant prospects when the first text is English.

**What's needed:**
- Per-lead `preferred_language` field (separate from `language_of_negotiation` — preferred_language is for marketing/comms, negotiation is the legal one).
- Spanish-language SMS template library, written by a native speaker, NOT translated by an LLM. RGV Spanish has its own register — "vendo terreno" reads natural, "deseo vender mi propiedad" reads like a phishing scam.
- Skip-trace results should display Spanish surnames with proper accents (Peña not Pena, Ramírez not Ramirez). Right now diacritics get stripped somewhere in the pipeline. I've seen "Jose" without the accent on Jose Luis Treviño's record three times this month.

### 5. Cross-border buyers — the Mexican-side flow is invisible

About 30% of my buyers are Mexican nationals buying with a `RFC` (Mexican tax ID) and an `INE` (national ID card). AcreOS has no fields for these. I shove the RFC into the "notes" field. When the title company asks for it later, I have to dig through notes.

This connects to Heng's foreign-buyer audit but the Mexican-specific case is different from his (he's looking at Asian buyers with FIRPTA). For Mexican buyers:
- Wire transfers come from CLABE accounts, not US ABA routing — the wire-instructions form on AcreOS rejects 18-digit CLABE numbers.
- Proof-of-funds documents arrive in Spanish from BBVA México, Banorte, Santander México. AcreOS document parser doesn't extract from Spanish bank statements.
- FIRPTA withholding still applies to my Mexican buyers when they later sell — but AcreOS doesn't track buyer nationality, so I can't generate the FIRPTA workflow when it's time.

**What's needed:**
- `buyer.nationality` and `buyer.tax_id_country` fields.
- CLABE validator (18 digits, starts with bank code) alongside ABA validator on wire forms.
- Spanish PDF/OCR support in the document ingestion pipeline.

### 6. Currency and number formatting

Land prices in the RGV often get quoted to Mexican buyers in pesos for context — "$50,000 USD, son como 850 mil pesos." AcreOS shows USD only, no peso conversion, no formatting that respects `es-MX` conventions ("$50,000.00" vs "$50.000,00" — actually Mexico uses the same as US so this isn't the issue, but Argentina-style commas would matter for other Latin American buyers; for me it's the FX context that's missing).

Date formatting matters more — `04/05/2026` means May 4 to my US buyers and April 5 to my Mexican buyers. AcreOS displays `04/05/2026`. I need locale-aware date display: `5 de abril de 2026` for Spanish users, `April 5, 2026` for English.

### 7. Onboarding wizard

`components/onboarding/OnboardingWizard.tsx` (per the persona-architecture memory note this is canonical) — English-only. A new Spanish-speaking land investor signing up sees English copy from the first second. They will not complete onboarding. I have a friend, Rosalinda in Brownsville, who tried AcreOS in February and quit on step 2 because she couldn't understand what "default lead routing strategy" meant. She's still on a spreadsheet.

The org-scoped onboarding state means the org's `default_locale` should drive wizard language from screen 1.

### 8. Compliance and regulatory-intel pages

`pages/compliance.tsx` and `pages/regulatory-intel.tsx` — English statute summaries. Texas border counties have Spanish-language disclosure requirements layered on top of state law (county-specific colonia regulations in Hidalgo, Cameron). The compliance page should at minimum flag: "This jurisdiction requires bilingual disclosure for X." It currently does not.

### 9. Audit trail and signed-document receipts

When Doña Carmen signs a contract, the signing receipt email and the audit-trail PDF are English. If a dispute goes to court in Hidalgo County (where judges and clerks routinely operate bilingually), I want the receipt to show Doña Carmen received the disclosure **in Spanish**, with a Spanish receipt. Otherwise the seller's lawyer will argue she didn't actually understand what she signed, and they'll win.

### 10. Voicemail transcription

When Don Refugio leaves me a voicemail in Spanish about his 12 acres in Roma, the transcription pipeline (I assume Whisper or similar) should handle Spanish. I haven't tested whether AcreOS's transcription does — but the displayed transcript on the lead timeline is showing garbled text on Spanish voicemails. Either Whisper is being called with `language=en` forcing English transcription of Spanish audio, or the auto-detect isn't working. Worth checking the call to whichever transcription provider is in `server/services/providers/`.

---

## Tejano negotiation cultural fit

Some of this isn't strings-in-a-file. It's product behavior.

- **Pax's tone is gringo-direct.** "Send offer now?" Tejano sellers expect a `cómo está la familia` opening, even in writing. A Spanish-language Pax that just translates English directness will land flat. The Spanish persona of Pax (call her "Paxa" or whatever, doesn't matter) needs to be redrafted in register, not translated.
- **First names matter and double-surnames are real.** José Luis Treviño García is one person, not two. The lead-merge dedup logic almost certainly treats double-surnames as different people. I have duplicates in my pipeline because of this.
- **Religious holidays.** Día de los Muertos, Día de la Virgen de Guadalupe (Dec 12), Reyes Magos (Jan 6) — sending follow-up SMS on these days reads as tone-deaf. Pax's send-time optimizer should know.
- **"Mañana" is not "tomorrow."** When a seller says "te llamo mañana" they often mean "in the next several days." Pax's follow-up cadence treats "I'll call you tomorrow" literally and pings me when they don't call back at 24h. Calibrate the cadence model for Spanish responses.

---

## What I want shipped, in priority order

1. **§5.072 Spanish disclosure as first-class artifact** — compliance bleed, fix this first.
2. **Locale toggle + `i18next` infrastructure** — unblocks everything else.
3. **Pax responds in input language; drafts in counterparty language.**
4. **Per-lead `preferred_language` and `language_of_negotiation` fields.**
5. **Native-Spanish SMS template library.**
6. **Onboarding wizard Spanish translation.**
7. **CLABE / Mexican tax ID / nationality fields for cross-border buyers.**
8. **Diacritic preservation across the data pipeline.**
9. **Locale-aware date and number formatting.**
10. **Cultural register pass on Pax Spanish persona.**

---

## What I do NOT want

- I don't want machine-translated UI strings shipped without a human review pass. RGV Spanish, Mexico City Spanish, Caribbean Spanish, and Castilian are all different. Pick one register (Mexican neutral) and stick with it.
- I don't want a half-bilingual product where the marketing site is in Spanish but the app is in English. That's a bait and switch.
- I don't want a "Spanish mode" that's just English with a Spanish menu bar. Disclosures, contracts, signing receipts, audit trails — todo en español o nada.

---

## Closing

AcreOS is a beautiful product for English-speaking land investors. For me and the dozens of investors I know in the Valley, it is currently a tool I work *around*, not *with*. We are not a niche — there are more land investors in South Texas, South Florida, Southern California, New Mexico, and Arizona working bilingually than the founder team probably realizes. We are the cross-border deal flow. We are the colonia inheritance pipelines. We are a real market.

Spanish support is not a v3 nice-to-have. For Texas border counties it is a compliance requirement on day one. Ship it right or don't ship to us.

Con respeto,
— Esperanza Ramirez
McAllen, TX

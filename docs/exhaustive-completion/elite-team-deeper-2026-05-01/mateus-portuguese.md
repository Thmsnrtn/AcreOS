# Mateus Barros — AcreOS Portuguese / Brazilian Cross-Border Audit

**Role:** Land Investor. 41, lives in Brookline MA, originally São Paulo. Holds Brazilian citizenship + US green card (permanent resident — so I am a "US person" for tax, but my buyer pool is overwhelmingly *not*). Run a small fund pooling capital from ~14 Brazilian families in MA, FL, and one in SP — they wire BRL → USD via my Wise + Avenue accounts, and my deal flow is: I source US land (FL panhandle, central GA, east TX), they buy in via shares of an LLC, I close in USD. ~$2B/yr of Brazilian capital comes into US RE; AcreOS sees ~$0 of it today.
**Wave:** 3 of the 87-persona AcreOS audit, Portuguese / Brazilian cross-border lens.
**Date:** 2026-05-01.
**Surfaces reviewed:** `client/src/lib/format.ts`, `server/routes-deals.ts:686` (the famous "international buyers" LLM prompt), `server/services/amlMonitor.ts`, `shared/schema.ts` (`leads`, `buyerProfiles`, `organizations.country`), `server/services/closingChecklistGenerator.ts`, `server/services/closingCostEstimator.ts`, plus tree-wide grep for `pt-BR|portugues|CPF|CNPJ|FIRPTA|i18n|useTranslation|BRL|reais|FinCEN|GTO`. Also cross-read Heng Xu's foreign-buyer audit (`heng-foreign-buyer.md`) — much overlap, but my surface is *first language* and *buyer-pool*, not just my own residency.

Vou ser direto: AcreOS é um produto americano que assume que o mundo inteiro lê inglês, fala USD, e tem um SSN. Eu uso há 6 meses. Funciona. Mas eu não consigo botar nenhum dos meus 14 investidores na frente disso, e essa é a razão pela qual eu não vou virar uma conta de $200/mês — eu vou virar uma conta de $50.

Let me walk through what's missing, in priority order for *my* business.

---

## 1. One-line verdict

**AcreOS today is monolingual English with hardcoded `en-US` formatting at the leaf, no language column on `users` / `organizations` / `leads`, zero CPF/CNPJ awareness, zero BRL recognition (not even as a display reference), and a single FIRPTA mention that is an English LLM hint, not a feature.** It is not anti-Brazilian. It just does not know we exist. The fixes are mostly small — a `language` enum column, a `taxIdType` enum, three locale-aware helpers in `format.ts`, and one Portuguese translation pass on the buyer-facing surfaces (signing, payment, lead intake form). Until those land I cannot route a single Brazilian investor through the buyer portal without sitting next to them with Google Translate open.

Heng Xu (Wave 3) flagged the foreign-buyer-residency gap. I am flagging the **language gap** that sits underneath it. Two different problems, partially shared remediation.

---

## 2. Portuguese UI — **structural absence, every layer**

There is no i18n scaffolding. Period.

1. **Tree-wide grep:** `grep -rn "useTranslation\|i18n\|pt-BR\|portuguese" client/src` returns nothing meaningful — only `localeCompare` for sorting and one comment in `client/src/lib/format.ts:4` that says *"Centralizes rules so a change (e.g. adding i18n) happens once."* Aspirational. No implementation.
2. **`client/src/lib/format.ts`** hardcodes `"en-US"` as the locale string in five places (`dollars`, `usd`, `count`, `pluralize`, `acres`). This is the right *shape* — one helper module — but the wrong *defaults*. A locale-aware version would read `useLocale()` from a context, fall back to `en-US`, and let me display "1.234,56" instead of "1,234.56" for a Brazilian investor reading their statement.
3. **No `language` column anywhere.** `users` has no `preferredLanguage`. `organizations` has no `defaultLanguage`. `leads` has no `language` (so when I import a lead from a Portuguese-language Facebook group, AcreOS has no way to remember they read Portuguese, and the agent will email them in English, which they will mark spam).
4. **Buyer-facing surfaces are 100% English text strings inline in JSX.** The borrower portal (`client/src/pages/borrower-portal.tsx`), signing page, payment confirmation, EmptyState components — all literal English. Replacing them is a translation pass, but only after the i18n scaffolding lands.
5. **Date formatting.** `dfFormat` calls in `format.ts` use US conventions ("MMM d, yyyy"). Brazilian convention is "dd/MM/yyyy". A `localeAwareDate()` helper that accepts a locale and emits the right ordering is one PR.
6. **No RTL concerns** for me — Portuguese is LTR — but the same scaffolding unblocks Spanish (Manuel — Wave 1), Mandarin (Heng — Wave 3), and the Spanish-speaking ~17% of US Land Investor TAM that no one in this audit set has yet flagged.

**Minimum viable i18n path:**
- Adopt `react-i18next` (smallest blast radius, plays with Vite, supports lazy chunks).
- Add `users.preferredLanguage: text default 'en'`, `organizations.defaultLanguage: text default 'en'`, `leads.language: text` (nullable — populated when source signals it).
- Refactor `format.ts` helpers to accept an optional `locale` arg, resolved from a `LocaleProvider` context.
- Extract strings on **three surfaces first**: borrower/signing portal, lead-intake public form, payment confirmation. The internal operator UI can stay English-only at v1 — my investors don't see it.

That's a 2-week scoped engineering item. It opens the door to Spanish and Mandarin without further structural work.

---

## 3. CPF / CNPJ — **the foreign-buyer KYC gap nobody named**

When a Brazilian individual buys US land, they do *not* have an SSN. They may have an ITIN, but most don't until forced. They *always* have a **CPF** (Cadastro de Pessoas Físicas, 11 digits, format `000.000.000-00`, government-issued tax ID). A Brazilian entity has a **CNPJ** (Cadastro Nacional da Pessoa Jurídica, 14 digits, format `00.000.000/0000-00`).

For my fund's KYC stack I need to capture **both** their CPF/CNPJ *and* their ITIN-or-pending. AcreOS today captures neither, and the schema makes it awkward.

What's there:

1. **`shared/schema.ts:328` — `leads` table.** Has `firstName`, `lastName`, `email`, `phone`, `address`, `city`, `state`, `zip`. **No `taxId`, no `taxIdType`, no `country`.** "State" is a free-text US-state assumption.
2. **`buyerProfiles` table** (`shared/schema.ts:7944`) — same shape. No KYC ID column.
3. **`organizations.country`** exists (`shared/schema.ts:5232`) and defaults to `"US"`. This is the only country awareness in the system, and it's about the *operator's* org, not the *buyer's* nationality.
4. **No CPF / CNPJ validators.** A CPF has a checksum (modulo-11 on the first 9 digits, twice). A CNPJ has a different checksum. Without validation I will paste a typo and not know until the wire bounces from the title company three weeks later.
5. **No format mask** on any input field that could hold a tax ID. Brazilian users expect `000.000.000-00` to format as they type.

**What this means for me:** today, when I onboard a Brazilian investor, I store their CPF in the `notes` text field of `leads`. It's unstructured, unvalidated, unsearchable. When the title company asks for "the foreign buyer's tax ID" I ctrl-F notes. This is embarrassing for a $200/mo SaaS.

**Minimum viable CPF/CNPJ path (one migration + one validator):**
- `leads.taxIdType: text` enum: `'ssn' | 'itin' | 'ein' | 'cpf' | 'cnpj' | 'foreign_other'`.
- `leads.taxId: text` (encrypted at rest — these are PII).
- `leads.country: text default 'US'` (separate from the address `state` field).
- `shared/utils/taxId.ts` with `validateCPF(s)`, `validateCNPJ(s)`, `formatCPF(s)`, `formatCNPJ(s)`. The math is well-known and a few hundred bytes.
- One `<TaxIdInput>` component that switches mask + validator based on the chosen `taxIdType`.

Heng's audit asks for `tin` + `w8ben_on_file`. Same column, broader enum. **Merge these into one schema change, not two.**

---

## 4. FIRPTA — **not new, but my exposure is different**

Heng covered FIRPTA structurally in `heng-foreign-buyer.md` §2. I won't repeat. Three Brazilian-specific deltas worth flagging:

1. **Brazil-US tax treaty does not eliminate FIRPTA** (unlike Canada's modest provisions). Brazilian sellers eat the full 15% withholding unless they file Form **8288-B** for reduced withholding. My investors *are* Brazilian sellers when they exit. AcreOS produces no 8288-B draft from cost basis.
2. **Brazilian buyers buying via a US LLC** (the standard structure I set up — Delaware single-member LLC owned by the Brazilian individual) are *still* foreign persons for FIRPTA purposes when they later sell. The LLC is disregarded; the member is foreign. AcreOS has no concept of "look through entity to ultimate beneficial owner" in either `buyerProfiles` or the closing checklist generator. So the 15% withholding obligation will be invisible to my US buyer at exit.
3. **FIRPTA awareness in the LLM prompt** at `server/routes-deals.ts:686` is in English. A Brazilian who triggers it via the chat assistant in Portuguese (which they can't, because the assistant is English-only) would not see the warning anyway. The prompt is theater for the model. It is not a feature.

**Cross-link to §3:** `taxIdType = 'cpf' | 'cnpj' | 'foreign_other'` is the schema signal that says "this person is foreign for FIRPTA". With that one column populated, the closing checklist generator can inject the FIRPTA item without any additional intake.

---

## 5. Currency — Brazilian Real reference, **informal only**

I am *not* asking AcreOS to settle in BRL. I close in USD. My investors wire BRL → Wise → USD before funds land. Currency conversion is their bank's problem.

What I *am* asking for:

1. **Display reference:** when I show a Brazilian investor "this parcel costs $42,000," they want to see "(≈ R$210.000)" inline, fetched from a daily FX cache. This is courtesy, not settlement. One FX cron + one helper:
   ```ts
   formatUsdWithReference(amountUsd, displayCurrency: 'BRL' | 'MXN' | 'CNY' | null)
   ```
2. **Locale-formatted USD:** even when displaying USD, Brazilian convention writes `US$ 42.000,00` (period as thousands, comma as decimal). The `usd()` helper at `client/src/lib/format.ts:51` has `Intl.NumberFormat("en-US", ...)` hardcoded; passing the user's locale gives correct grouping for free.
3. **Wire instruction page.** When my investor wires their share, they need: SWIFT/BIC, ABA routing, beneficiary, IBAN-equivalent. AcreOS has no `wireInstructions` surface (grep confirms — only `routes-borrower.ts:698` says "Please contact your lender for wire transfer or payment instructions"). For a foreign wire, the Brazilian bank requires SWIFT + a specific reason code (LCC 02). A wire-instructions PDF generator with `displayLanguage: 'pt'` would save me an hour per investor.

**No demand for BRL settlement.** Just BRL reference + locale-correct USD formatting + a wire-instructions page.

---

## 6. Brazilian buyer → US investor cross-border deal mechanics

Aqui está onde fica complicado. The full cross-border path my fund runs:

| Stage | Today in AcreOS | Gap |
|---|---|---|
| 1. Onboard Brazilian investor | `leads` row, English-only intake form | No PT-BR form, no CPF/CNPJ field, no country |
| 2. KYC (passport + CPF + proof of address) | No KYC document upload tied to the lead | `leads.kycDocuments` jsonb missing |
| 3. ITIN application support (Form W-7) | None — not in the tax-form catalog | Add to `tax_form_issuances` |
| 4. LLC formation | Generic — no foreign-member checkbox | `buyerProfiles.beneficialOwnerForeign: bool` missing |
| 5. Operating agreement | English-only template | One bilingual template variant |
| 6. Capital call (BRL→USD wire) | No surface | See §5.3 (wire instructions) |
| 7. Property purchase | Works fine | — |
| 8. Annual K-1 | English-only PDF | Add `language` to PDF generator |
| 9. Exit sale | No FIRPTA 8288-B drafting | See §4 |
| 10. Distribution back to investor (USD→BRL) | No wire-out instructions surface | Symmetric to §5.3 |

Stages 3, 5, 6, 8, 9, 10 are the ones AcreOS materially blocks me on today. Stage 9 is the most expensive (loss of time-value on 15% of gross for ~12 months while I wait for the IRS refund). Stages 5 and 8 are the most embarrassing (I send English documents to elderly investors in São Paulo who do not read English, and they sign things they don't understand — that is not consent in any meaningful sense, and a Brazilian regulator would be unhappy).

---

## 7. AML monitor — **the foreign-entity check is a substring match on English**

Heng named this. I'll twist the knife. `server/services/amlMonitor.ts:78–80`:

```ts
const foreignIndicators = ["foreign", "international", "overseas", "abroad"];
const lowerAddr = buyerAddress.toLowerCase();
if (foreignIndicators.some(f => lowerAddr.includes(f))) { ... }
```

A buyer at `Avenida Paulista, 1578, São Paulo, SP, 01310-200, Brasil` matches **none** of those words. Neither does `Rua das Flores, 42, Brookline, MA 02446` (yes — a US address with a Portuguese street name). The check fails in both directions.

A real foreign-entity heuristic uses:
1. `country !== 'US'` on the lead/buyer profile (requires the §3 schema change).
2. `taxIdType` ∈ {`cpf`, `cnpj`, `foreign_other`} (same schema change).
3. ZIP/postal-code shape fails US 5- or 9-digit format.

Any one of those is more reliable than substring-matching English words.

---

## 8. FinCEN GTO awareness — **zero**

Tree-wide grep for `FinCEN|GTO|beneficial owner|BSA` returns one match — and it's a code comment about Washington state (`routes-admin.ts:1568`). Nothing real.

FinCEN's Geographic Targeting Order (renewed 2025) requires title companies in named metros (Miami-Dade, Manhattan, Brooklyn, Queens, San Diego, San Francisco, Suffolk, Westchester, Honolulu, Boston, Chicago, Dallas) to report all-cash residential purchases over $300K when made by a legal entity. Land deals are usually exempt (residential), but **mixed-use parcels and rural-residential do trigger** when there's a habitable structure. My GA deals occasionally include a farmhouse. My FL panhandle deals routinely do.

AcreOS has no GTO awareness, no county-level GTO map, no $300K threshold check, no entity-buyer flag that could trigger a "this deal may require GTO reporting by your title company" advisory. The closing checklist for those counties should include a GTO line item the same way Heng asks for FIRPTA.

This is **one config table** (`fincen_gto_counties: { county_fips, threshold_usd, expires_at }`) plus one closing-checklist injector. Maybe two days of work.

---

## 9. What I'd ship in the next sprint, ordered by my willingness-to-pay

If AcreOS shipped these in priority order, my MRR ceiling moves from $50/mo (current — single seat, used as a CRM only) to $400/mo (full fund ops, 14 investor seats):

1. **Schema: `language`, `country`, `taxId`, `taxIdType`** on `users`, `organizations`, `leads`, `buyerProfiles`. Migration only — no UI yet. (1 day) — unlocks every downstream item.
2. **CPF/CNPJ validators + masked input.** (2 days) — I can store IDs structurally.
3. **i18n scaffolding (`react-i18next`) + Portuguese translation of three buyer-facing surfaces:** lead intake, signing, payment. Operator UI stays English. (2 weeks) — I can put my investors in the system.
4. **Locale-aware `format.ts`.** (1 day) — numbers and dates render correctly without a translation pass.
5. **Wire instructions page** with `displayLanguage` switch + USD/BRL reference rate. (3 days) — capital calls happen inside the product.
6. **FIRPTA closing-checklist injection** when seller is `taxIdType ∈ {cpf, cnpj, foreign_other}`. (1 day after schema lands) — same hook unblocks Heng, Manuel (Wave 1, Mexican buyers), and the broader foreign-seller exit path.
7. **8288-B draft generator** from cost basis + sale price. (3 days) — the highest-dollar single feature in this list for me; saves 6–18 months of float per exit.
8. **GTO county map + advisory.** (2 days) — covers Miami-Dade/Boston, where my buyers actually transact.
9. **AML foreign-entity heuristic rewrite** to use `country` + `taxIdType` instead of English substring match. (half a day) — strict improvement, no schema cost after step 1.

Total: ~5 weeks of one engineer. Outcome: AcreOS has a credible Brazilian, Mexican, and Chinese cross-border story without any of those personas having to fork the codebase.

---

## 10. What I do *not* want

To pre-empt over-building:

- **I do not want BRL settlement.** Wise + Avenue solve that. Don't build a forex layer.
- **I do not want a Brazilian regulatory module** (CVM filings, Receita Federal reporting). That is my accountant's job, in Brazil, and AcreOS should not pretend to handle it.
- **I do not want auto-translation of operator UI.** Translate the buyer-facing surfaces. I read English in the back office.
- **I do not want a separate "foreign mode."** That ghettoizes the path. Make the schema correct and let `country !== 'US'` naturally branch where it needs to.

---

## 11. Closing — uma palavra honesta

AcreOS é um produto bom. É melhor que tudo que eu vi em português. Mas hoje eu não consigo dizer aos meus investidores "use isso direto" — eu sou o tradutor humano. Quando vocês fizerem o item 1 desta lista — só a migração de schema — eu posso começar. Quando fizerem 1–5, eu pago $400/mo. Quando fizerem 1–9, eu mando os outros gestores brasileiros que conheço (são uns 30 em MA e FL, juntos administrando bem mais de $200M em terras americanas).

The Brazilian-investor-into-US-land flow is a $2B/year channel that no US RE software has localized properly. AcreOS can be first. The work is small. Faz aí.

— Mateus

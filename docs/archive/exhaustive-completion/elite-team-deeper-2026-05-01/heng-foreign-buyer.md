# Heng Xu — AcreOS Foreign-Buyer Audit

**Role:** Foreign land buyer. Chinese-Canadian dual citizen, Vancouver BC primary, Shanghai (上海) secondary. CFA. Buying US recreational + ag land for portfolio diversification away from CAD/CNY exposure. ~$3M USD allocated, target 6–10 parcels across UT/AZ/CO/WY recreational + small TN/KY ag.
**Wave:** 3 of 87-persona AcreOS audit, foreign-buyer lens.
**Date:** 2026-05-01.
**Surfaces reviewed:** `server/services/amlMonitor.ts`, `server/routes-deals.ts` (lines 680–710 LLM prompt), `server/services/stateDocumentConfig.ts`, `server/services/closingChecklistGenerator.ts`, `server/services/closingCostEstimator.ts`, `server/services/costBasisTracker.ts`, `server/services/depreciationService.ts`, `client/src/lib/format.ts`, `shared/schema.ts` (organizations, deals, leads, payments). Also: full-tree grep for `firpta|1445|8288|i18n|locale|currency|wire|swift|ofac` and the absence of any matches that aren't in this list of files.

I came to AcreOS from a Wendell-style operator's referral. He told me "it handles everything." He did not mean *for me*. I want to be specific: AcreOS is not hostile to foreign buyers. It is *unaware* of us. There is a difference, and the difference is fixable in three weeks if anyone cares.

我来谈谈我的体会 (let me say what I see).

---

## 1. One-line verdict

**AcreOS today silently treats every user as a US-resident, USD-native, English-speaking, US-TIN-bearing W-9 person — and silently produces incorrect outputs for everyone who isn't.** The product is not US-only by policy; it is US-only by accident. There are no FIRPTA hooks, no W-8BEN path, no state foreign-ownership restriction checks, no currency layer, no i18n scaffolding, no SWIFT/IBAN wire-instruction surface, and the one place "foreign" is detected is a substring match on the buyer's mailing address looking for the literal English word "foreign" (`server/services/amlMonitor.ts:78–80`). I would not transact through AcreOS today, but I would pilot it as a pipeline tool while keeping a separate FIRPTA-competent closing stack.

---

## 2. FIRPTA — **structural absence**

FIRPTA (IRC § 1445) requires the **buyer** of US real property from a foreign person to withhold **15%** of the gross sales price (10% in some § 121-residential cases, 0% if buyer occupies and price ≤ $300K) and remit on Form **8288** + **8288-A** within 20 days of closing. The **seller** can apply for reduced withholding via Form **8288-B**. FIRPTA is buyer-side liability — if the buyer fails to withhold, the buyer owes the tax personally.

When *I* sell a parcel, *my US buyer* must withhold 15% on me. When I buy from a US person, FIRPTA does not apply to that leg, but my eventual exit does.

What's in AcreOS today:

1. **Zero references** to FIRPTA, IRC 1445, Form 8288, or "withholding" anywhere in `server/`, `client/`, `shared/` outside one LLM system prompt.
2. The one mention is in `server/routes-deals.ts:686` — an English instruction *to the LLM* that says "if the user's locale suggests they're based outside the US … add: …awareness of FIRPTA withholding rules if the property is later sold." This is not a feature. This is a hope that the model will mention it. There is no entity flag, no checklist item, no schema column, no closing surface, no remittance workflow.
3. `closingChecklistGenerator.ts` produces state-specific closing checklists. **None of them include a FIRPTA item** when the seller is foreign — because there is no concept of "seller is foreign" in the schema. `leads` and `properties` have no `taxResidency`, `citizenshipCountry`, `w8ben`, or `firptaStatus` field.
4. `closingCostEstimator.ts` does not estimate FIRPTA withholding as a buyer-cost line, even though the buyer is the one writing the check.
5. No `tax_form_issuances` for 8288/8288-A. No e-file path. No 20-day clock.

**What this means for me as a buyer:** if I unknowingly buy from a foreign seller (single-member LLC where the member is a foreign person, common offshore structuring), AcreOS will let me close, will not flag the withholding obligation, and the IRS will come for me — *the buyer* — with penalties. AcreOS makes its US users a FIRPTA liability without telling them.

**What this means for me as an eventual seller:** when I dispose of one of these parcels, the US buyer must withhold 15% on me. If AcreOS is the system of record for the seller, AcreOS should be generating my 8288-B reduced-withholding application from cost basis and sale price. It is not. Today I would lose the time-value of 15% of gross for 6–18 months waiting on an IRS refund.

**Minimum viable FIRPTA path (3 schema fields + 1 form + 1 checklist item):**
- `leads.taxResidency: 'us_person' | 'foreign_person' | 'unknown'` + `w8ben_on_file: boolean` + `tin: text`.
- Closing checklist injects "FIRPTA withholding — 15% of $X due to IRS within 20 days, Form 8288 + 8288-A" when seller is `foreign_person` and no 8288-B exemption certificate is uploaded.
- Reduced-withholding workflow that pre-fills 8288-B from `costBasisTracker` cost-basis and proposed sale price.

That's the floor. The 1098 audit (Zerah, Wendell, Linnea) flagged the same class of gap on a domestic form. FIRPTA is the foreign analog and it is *more* dangerous because the liability falls on the buyer, who is also an AcreOS user.

---

## 3. State foreign-ownership restrictions — **zero coverage**

As of 2026, ~24 US states restrict foreign ownership of agricultural land. The hot-button quartet for me:

- **Iowa (Code § 9I):** prohibits non-resident aliens, foreign businesses, and foreign governments from acquiring agricultural land beyond narrow exceptions.
- **Minnesota (§ 500.221):** prohibits non-citizens / non-PRs from owning > 40 acres of ag land.
- **Missouri (RSMo § 442.566):** caps foreign ownership at 1% of total ag land statewide; reporting required.
- **Indiana (IC § 32-22-2):** prohibits foreign business entities from acquiring ag land except for limited research/processing use.

Plus growing 2024–2026 state activity: TN, AR, FL, NE, ND, OK, SD all expanded restrictions, frequently with country-of-origin lists that name China specifically. This is the single biggest legal risk in my buy box.

What AcreOS has:

1. **`stateDocumentConfig.ts`** encodes per-state deed types, recording fees, transfer tax. **No `foreignOwnershipRestriction` field.** The codemod surface is small — adding `foreignOwnership: { restricted: boolean; threshold?: 'ag_only' | 'any_land'; acreageCap?: number; countryBlocklist?: string[]; statute: string }` to each state config is one PR.
2. **`closingChecklistGenerator.ts`** does not gate the "agricultural land" path on buyer's tax residency. A parcel with ag-zoned classification + foreign buyer should hard-stop with a "This state restricts foreign ownership of ag land — see [statute]" warning before the buyer wires earnest money.
3. **No country-of-origin field on user/org.** Even if the rules existed, there's nothing to evaluate them against. The schema treats every operator as a US person.
4. **Buyer-matching AI (`buyerMatchingAI`)** would happily match a Chinese-passport buyer to an Iowa ag listing, then surface a deed package the buyer cannot legally execute. That's not a bug in the AI — that's a missing rule in the rule layer.

**Risk sizing:** if I buy 80 acres in MN under my Vancouver address, the state attorney general can order divestiture and impose civil penalties up to $10K + reasonable attorney fees. AcreOS would have processed the deal cleanly and helped me list it back for sale 18 months later under duress. This is the kind of silent failure that costs the *operator* — Wendell, Linnea — when the post-close audit finds AcreOS facilitated an unwinding deal.

---

## 4. Currency — **hardcoded USD, no exchange-rate layer**

`client/src/lib/format.ts:17` and `:60`:

```ts
style: "currency",
currency: "USD",
```

Every dollar figure rendered in AcreOS is `Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })`. There is no `useCurrency()` hook, no per-user `displayCurrency` preference, no FX provider in `server/services/providers/`, no historical-rate snapshot on `deals.acceptedAmount`.

I do not need AcreOS to convert. The LLM prompt at `routes-deals.ts:686` even says correctly: *"Do NOT convert US dollars to the user's local currency unless they ask — respect that they are investing in USD."* That instinct is right. I *am* investing in USD; that's the point of the trade.

What I *do* need:

1. **Display-only secondary currency.** Toggle that shows "$125,000 USD (~CA$170,500 / ¥905,000 CNY at 2026-05-01 12:00 UTC)" in *parentheses*. Not for accounting — for cognitive load when I'm deciding whether to wire CNY-equivalent funds.
2. **FX rate snapshot at close.** When a deal closes, store the USD/CNY and USD/CAD rate on the deal so my cost basis in CAD (which is what CRA cares about) is reproducible 7 years later when CRA audits. The cost-basis tracker (`costBasisTracker.ts`) is competent for USD basis. It cannot reproduce my **CRA-reportable** basis without the close-day FX rate. That's a five-line schema add: `deals.fxSnapshot: jsonb` + a daily fx_rates cache table.
3. **No CAD/CNY support breaks foreign tax-credit math.** The Canada-US tax treaty allows a foreign tax credit for US tax paid; I need USD amounts and dates, both of which AcreOS has, but I also need a defensible FX source. Right now I'd have to maintain a parallel spreadsheet. That defeats the point of AcreOS-as-system-of-record.

---

## 5. Tax treaty — **invisible**

The US-China tax treaty (1984, in force) does *not* override FIRPTA — Article 6 explicitly preserves source-country taxation of immovable property. So treaty relief on FIRPTA is essentially nil for me.

The US-Canada treaty (1980, with protocols) is more nuanced — Article XIII preserves source taxation of immovable property too, but the treaty matters for **interest income** I earn if I hold seller paper as the lender. Article XI caps interest withholding at 10% (vs the 30% statutory rate under IRC § 1441) when the recipient is a Canadian resident. AcreOS has no withholding logic at all on borrower-payment routing. If I'm the note holder (Linnea-style) and my borrower is US, the borrower should withhold 30% (or 10% under treaty if I file W-8BEN) on the interest portion of every payment. **AcreOS routes the full payment.** That is the borrower's compliance failure, but AcreOS as system of record makes it inevitable.

**Minimum viable treaty path:** add `note_holder.taxResidency` + `note_holder.treatyRate` (default 30% / 0% if US), let `borrower-portal` payment routing split interest into a withholding bucket, generate **Form 1042-S** annually for each foreign note holder. None of this exists. The 1042-S is to foreign note holders what the 1098 is to US borrowers — and both are missing.

---

## 6. Identity verification — **Clerk + assumes US ID**

AcreOS uses Clerk for auth. Clerk supports international phone (E.164), passport-number capture via custom fields, and document-upload KYC. AcreOS does not configure most of this:

1. Phone numbers in `leads`/`buyers` are stored as free-text strings. There is no E.164 validation, no `+86` (China) or `+1-604` (Vancouver) parsing. SMS notifications via Twilio will silently drop my +86 number on long-form messages because the AcreOS Twilio account isn't provisioned for international SMS (verified by absence of `internationalSms` flag in env).
2. **No passport/national-ID capture.** OFAC sanction screening (which `routes-platform-features.ts` references) needs full legal name + DOB + country of citizenship to actually screen. AcreOS has none of these on the lead/buyer record.
3. **AML monitor (`amlMonitor.ts:76–90`)** "detects" foreign buyers by substring-matching the buyer address for the literal words "foreign," "international," "overseas," "abroad." A Vancouver buyer with address "1234 W Hastings St, Vancouver BC V6E 2T8, Canada" produces zero matches — the substring "canada" isn't in the list. The detection misses every actual foreign buyer and would only fire on someone who literally typed "foreign" into their address. **This is theater, not screening.** Fix: parse the country off the address, or better, store `country: ISO-3166` as a structured field.
4. **No SDN/OFAC list integration.** The `sanctions` keyword appears in `server/services/data-source-lookup.ts` and `dataQualityMonitor.ts` as references, not implementations. There is no scheduled OFAC SDN download, no name-match scoring, no audit log of who was screened when. For a foreign buyer this is the *first* compliance check a US escrow agent will do — and AcreOS doesn't do it.

---

## 7. Wire-transfer process — **silent**

Closing happens by wire. For me that's an international wire from RBC Vancouver (CAD-source) or ICBC Shanghai (CNY-source). Both require:

- **SWIFT/BIC** of the receiving US bank.
- **ABA routing + account number** of the escrow/title company.
- **Beneficiary name and address.**
- For CNY-source wires: **SAFE filing** (State Administration of Foreign Exchange) for any single transaction > $50K equivalent — this is a Chinese-side compliance burden, but AcreOS could surface a "this wire will require SAFE filing on the sender side" advisory.

What AcreOS has: **no wire instructions surface anywhere.** `closingChecklistGenerator` outputs items like "buyer to wire earnest money" with zero structured wire data. The escrow/title-company info is free-text. There's no `wire_instructions` table, no SWIFT validation, no "verify these instructions by phone before sending" anti-fraud nudge (wire-fraud BEC attacks routinely intercept email-delivered wire instructions; the FBI IC3 reports $2.9B in BEC losses 2023, much of it real-estate closings). For a $250K parcel this is the single highest-dollar attack surface and AcreOS is silent on it.

**Minimum viable path:** `wire_instructions` table on the deal, with explicit SWIFT/BIC, ABA, account number, beneficiary fields. Two-person verification flow: instructions are entered by title agent, must be confirmed by buyer via phone callback to a number from public records (not from the email). Foreign-buyer flag adds SAFE/FX-control reminders on the sender side.

---

## 8. Language localization — **not started**

Full-tree grep for `i18next`, `react-i18next`, `formatMessage`, `useTranslation`, `next-i18next`: **zero matches.** No `client/src/locales`, no `client/public/locales`. Every string in AcreOS is hard-coded English. The shadcn/Tailwind component layer would tolerate i18n cleanly — there's no architectural blocker — but the work has not begun.

I can read English. My wife cannot. My CFO in Shanghai reviews every closing package; he reads Mandarin and accounting English but not legal English. For a $250K closing I need at minimum:

1. **Key legal docs translated** — purchase agreement, deed, FIRPTA disclosure. Not machine-translated; reviewed by a bilingual real-estate attorney. AcreOS is not the translator, but it should support `documents.translation_locale` and let users upload paired translations.
2. **UI shell in Mandarin** — at minimum nav, deal status, dollar amounts, action buttons. ROI-positive only after AcreOS has > 50 foreign-buyer customers; today's customer base doesn't justify it.
3. **Numeral formatting** — Chinese accounting uses 万 (10,000) and 亿 (100,000,000) groupings, not 1,000-separator. `Intl.NumberFormat('zh-CN')` handles this natively if AcreOS would just respect `navigator.language`.

**Priority:** P3 today, P1 if AcreOS ever markets to the diaspora investor channel (Vancouver/Toronto/SF Bay/LA Chinese-Canadian / Chinese-American real-estate Facebook/WeChat groups are a $500M+ annual buy-side flow).

---

## 9. The "AcreOS = US-only" question

Am I locked out? **No, technically.** Clerk lets me sign up from Vancouver. The product accepts my +1-604 phone. Stripe Connect accepts my Canadian payment method for the AcreOS subscription. Once in, I can list, search, draft offers, run blind-offer calculator, generate closing checklists.

Am I locked out **operationally**? **Yes, partially.** The closing-day workflows (FIRPTA, foreign-ownership states, wire instructions, OFAC screening, currency snapshot, treaty withholding) all assume US-resident defaults and silently produce incorrect or incomplete outputs. I would close the deal *outside* AcreOS — with my Stewart Title contact in Salt Lake City who knows FIRPTA — and use AcreOS only for pipeline, basis tracking, and post-close ledger.

That's a viable wedge. AcreOS doesn't have to be the closing platform for foreign buyers. It does have to *know* it isn't, and stop emitting checklist items that imply it is.

---

## 10. What I would build — ordered by buyer-protection ROI

| # | Item | Lines | Files | Risk reduction |
|---|------|-------|-------|----------------|
| 1 | `leads.taxResidency` + `citizenshipCountry` ISO-3166 + `w8ben_on_file` | ~30 | `shared/schema.ts`, lead form | Foundation for everything below |
| 2 | Replace amlMonitor `foreign` substring with structured country field | ~20 | `server/services/amlMonitor.ts` | Real foreign-buyer detection |
| 3 | FIRPTA checklist injection when seller is foreign | ~50 | `closingChecklistGenerator.ts` | Buyer-side liability protection |
| 4 | State foreign-ownership rule table + ag-land gate | ~120 | `stateDocumentConfig.ts`, deed flow | Hard-stop illegal closings |
| 5 | OFAC SDN screening on lead/buyer create | ~80 + cron | new `server/services/ofacScreening.ts` | Sanctions-clearance audit trail |
| 6 | `wire_instructions` table + two-person verification | ~150 | new table, closing UI | BEC/wire-fraud prevention |
| 7 | FX snapshot on deal close | ~40 | `deals` schema, fx_rates cache | CRA/SAFE-defensible foreign basis |
| 8 | 8288 / 8288-A / 8288-B form generators | ~300 | new `server/services/firptaForms.ts` | Buyer remittance workflow |
| 9 | 1042-S generation for foreign note holders | ~250 | borrower-portal, new emit path | Treaty-withholding compliance |
| 10 | i18n scaffold (react-i18next + zh-CN locale stub) | ~200 | `client/src/i18n/`, all strings | Diaspora go-to-market readiness |

Items 1–3 are a one-week sprint and convert AcreOS from "silently wrong for foreign buyers" to "explicitly aware." Items 4–6 are another two weeks and stop AcreOS from facilitating illegal or high-fraud transactions. Items 7–9 are tax-compliance and unlock filing-time use; ~6 weeks. Item 10 is GTM, not compliance — defer until the customer count justifies it.

---

## 11. Closing — 结束语

I don't expect AcreOS to be a foreign-buyer specialist. I expect it to **know what it doesn't know** and route me to a human at the closing-day inflection points. Today it does not — it cheerfully produces a US-resident-shaped closing package and lets me sign it. The fix is mostly schema + checklist injection, not new product surface area. Three weeks of senior-engineer time would move AcreOS from "accidental US-only" to "explicitly US-domiciled-and-foreign-aware," which is the honest positioning for a 2026 product whose customers' counterparties increasingly are not US persons.

我会再回来 (I'll be back). When the FIRPTA box is checked I'll move my pipeline in.

— Heng

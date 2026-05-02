# Marisol Prescott — AcreOS user review (multi-state, Denver)

I run a seven-state Land Investor shop out of Denver — CO is home, but I'm bidding tax-deeds in Maricopa, picking up grazing parcels in Park County MT, scoping mineral splits in Eddy County NM, doing the occasional Wasatch Front infill flip in UT, hunting cheap recreational dirt in WY and ID. Eighty deals a year, give or take. Four LLCs (one CO domestic, three foreign-qualified into AZ, NM, and WY for asset-protection reasons), a separate trust holding the WY mineral parcels, and a personal name on a couple of leftover Idaho deals I haven't moved into the LLC yet. I file in seven states. I have four title companies on speed-dial and another six I've used twice. My single largest non-deal expense is my CPA — Hana would not be surprised — because *each state's compliance is different.*

That's the headline of this audit. Every other persona on this team is auditing one state. **My nightmare is the joint between states**, and AcreOS treats that joint like it doesn't exist.

I spent a day with the platform. Findings below.

---

## 1. Thirty-second verdict

**Starter $20:** Sign up day-one. It pays for itself the first time it stops me from sending a CO warranty deed to a NM closing.

**Pro $49:** Sign up *only if* AcreOS adds (a) a registry of *my* operating LLCs with foreign-qualification status per state, (b) per-state title-company directory tied to deals, (c) a "states I operate in" org setting that drives every alert/filter/feed, (d) a multi-state tax calendar that knows my CO LLC owes annual reports in CO, AZ, NM, and WY on four different due dates, and (e) document templates that *refuse* to render for states without a real config (right now they fall back to Texas — that's a closing-day disaster).

**Scale $79:** Probably yes — I'm right at the volume where the per-deal automation pays back. But not until the multi-state foundations land.

Single-state operators (Wendell in Texas, Bryce in CO) get away with treating AcreOS as a CRM. **I cannot.** I need it to be a *jurisdictional engine*, and right now it's a jurisdictional aggregator with TX as the default and a 10-state regulatory table.

---

## 2. The foundational gap — there is no concept of "states I operate in"

I went looking for an org-level setting along the lines of `organizations.operatingStates: string[]`. It doesn't exist. There is no `defaultState`, no `primaryStates`, no `operatingStates`. The only place I found anything close is `investorNetworkService.ts:64` — `primaryStates: string[]` — which is for *buyer matching*, not for driving the platform's behavior.

This is the foundational miss. Every CA-only operator hits a state-specific friction *once* and works around it. I hit seven different state frictions every Tuesday. If the platform doesn't know I operate in CO+WY+MT+NM+UT+AZ+ID, it cannot:

- Filter `/today` to alerts that matter to me (currently I'd get TX legislative noise I don't care about; ID changes I'd miss because there's no ID feed at all)
- Pre-flight a parcel import against the right disclosure rules
- Surface the right tax calendar
- Flag deeds about to be generated for an unconfigured state
- Tell me which of my LLCs is the right grantee for a given parcel

**Fix:** add `organizations.operatingStates: text[]` and `organizations.homeState: text`. Drive everything off it. Until that ships, every other multi-state fix is a band-aid on the wrong limb.

---

## 3. State coverage map — what's missing for *my* seven states

I did the matrix on three foundational files. Marisol's seven states: **CO, WY, MT, NM, UT, AZ, ID**.

| File | CO | WY | MT | NM | UT | AZ | ID |
|---|---|---|---|---|---|---|---|
| `regulatoryIntelligence.ts` (10 states total: TX, FL, GA, NC, TN, AL, MS, AR, MO, OK) | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING |
| `stateDocumentConfig.ts` (16 states + auto-fallback) | present | MISSING | MISSING | present | MISSING | present | present |
| `usuryCeiling.ts` (50 states + DC) | present | present | present | present | present | present | present |

**`regulatoryIntelligence.ts` is the deal-killer.** Zero of my seven states are in there. The whole eastern-half / Sun-Belt cluster is covered; the entire Rocky Mountain West is absent. That means: no TOD-deed availability, no contract-for-deed restrictions, no Dodd-Frank exemption notes, no required-disclosures list, no water-rights system flags, no subdivision-regulation tier — for *every state I operate in.* I can't run my business off a "compliance" module that doesn't recognize Colorado.

**`stateDocumentConfig.ts`** is better — 4 of 7 covered, and there's an auto-fallback at line 418. But the fallback uses generic boilerplate (`"abbr, name"`) without granting clauses, deed-type defaults, transfer-tax rates, or recording offices. **The fallback is worse than no template, because it generates a plausible-looking but legally hollow document.** WY uses a Sheriff/Recorder split for some counties; MT uses Clerk and Recorder; UT uses County Recorder with a separate Auditor for tax-deed acquisitions. None of that is captured if I'm in any of those three states.

**`usuryCeiling.ts`** is the bright spot — full 50-state coverage, structured, with `sellerFinancingExemption` flags. Whoever built this file did the work. Note though that for me — CO/WY/MT/UT/NM all have `civilCeiling: null` and `sellerFinancingExemption: true` — so the usury check effectively doesn't fire on five of my seven. I'd still want it logged ("CO permits any rate; document the seller-financing nature of the transaction") because my CPA wants the audit trail.

**Closing checklist generator (`closingChecklistGenerator.ts:44`)** silently falls back to TX when the state isn't configured. That's how I'd ship a Texas-flavored closing checklist for a Bozeman deal and not notice until escrow asks me where the Realty Transfer Certificate is. Hard fail with "state not yet supported, contact us" is the right behavior; silent TX fallback is a foot-gun.

---

## 4. Daily-use walkthrough — multi-state operator edition

**7:45 AM.** Land on `/today`. Same firehose Wendell described, plus alerts that don't match my states. The regulatory feed in `server/jobs/regulatoryComplianceCheck.ts:44` covers exactly two state legislatures: **Texas and Florida.** I'm operating in seven states, none of which are TX or FL. So *all* my legislative compliance is happening outside this product. **I want feeds for: CO General Assembly, WY Legislature, MT Legislature, NM Legislature, UT Legislature, AZ Legislature, ID Legislature** — gated by my org's `operatingStates`. Today I get TX HB-something I don't care about and a CFPB notice. Useless for me.

**8:30 AM.** I import 240 NM tax-deed parcels (Eddy + Lea + Otero counties). Import goes through. **Nothing flags acequia rights, severed mineral estates (default in NM!), or the 3-year redemption window.** `server/services/regulatoryIntelligence.ts` doesn't know NM exists. I'd want the import to overlay redemption deadlines from `taxDelinquentPipeline.ts` (which *does* have NM at 36 months, line 507 — good) onto each row, plus a "mineral severance — likely" flag for any NM acquisition because severed-mineral is the default presumption there, not a quirk.

**9:15 AM.** Open `/parcels/:id` on a Park County MT grazing parcel. The composed view is genuinely good — the team has done real work. **What's not on the DD checklist for MT:** stream-access (MT Stream Access Law — enforceable, surprises out-of-state buyers), grazing-lease assignability, agricultural classification (Greenbelt) status and the rollback-tax math if I de-classify, water rights (MT is prior-appropriation; the state DNRC has a real database I could overlay). None of this surfaces because there's no MT row in `regulatoryIntelligence.ts`.

**10:00 AM.** Open `/parcels/:id` on a WY ranchland deal. Same problem, different state. WY-specific DD that should be surfaced: split-estate mineral status (very common in WY), conservation easement check (Nature Conservancy + state easements are dense in WY foothills), grazing AUM allocation, Wyoming's 4-year tax-redemption window (which `taxDelinquentPipeline.ts` does know about — good), and the state's 6.78% capital gains rate (zero, actually — WY has no income tax, which matters for entity-domicile decisions I'll come back to).

**11:00 AM.** I open `/finance` and try to draft a seller-carry note on an ID parcel I'm flipping to a Boise builder. The usury check fires correctly — ID is `civilCeiling: 12, sellerFinancingExemption: true` and the result returns "compliant." Good. **What's missing:** I'm carrying paper across state lines (I'm in CO, the borrower is in ID, the parcel is in ID) and the platform has no opinion on which state's law governs, even though every promissory note I've signed has an explicit choice-of-law clause. The note generator should at least prompt: "Which state's law governs this note? (Default: state of property)" with a short justification of why that's usually the safest answer.

**12:00 PM.** I open `/documents` and try to generate a quitclaim for an old WY mineral parcel I'm conveying into the trust. **`stateDocumentConfig.ts` has no WY entry.** The fallback at line 418 generates `state: "WY", stateName: "Wyoming"` plus generic empty fields — no granting clause, no haberendum clause, no warranty clause. The deed renders with empty legal-language slots, which means I either ship a deed that won't get recorded or I don't notice the empty slots until the WY County Clerk in Park (WY Park, not the MT Park) bounces it back. **The right behavior is to refuse to render the doc and surface "WY template not yet shipped — use a local attorney or wait for v1.x" with a CTA to upload my own template.**

**1:30 PM.** I look at the `entities` view in the portfolio. `entityPortfolio.ts` infers entity from `parcelData.owner` — i.e., it tells me which *seller* entities are out there. It does *not* tell me which of *my* LLCs holds which parcel. There is no `myEntities` registry. **For a four-LLC operator, this is the centerpiece miss.** I need:

- `operatingEntities` table on the org (LLC name, EIN, state of formation, foreign-qualified states, registered agent per state, annual-report calendar, tax ID, banking partner, Stripe Tax ID once we ship that)
- A `holdingEntity` field on every property linking back to one of my entities (not a free-text inferred-from-deed-string)
- Per-entity portfolio view with cost basis, depreciation, tax basis, K-1 estimates
- Per-entity multi-state nexus tracking (if my CO LLC owns parcels in 4 states, I owe nonresident filings in 3 of them)

**2:30 PM.** I look for a per-state title-company directory. There isn't one. `properties.titleCompany` is a single text column (`shared/schema.ts:723`). I have four title companies I trust by state:

- **CO:** Land Title Guarantee (Denver, Boulder); North American Title (Springs)
- **WY:** First American Title Park County
- **MT:** Stewart Title (Bozeman); Insured Titles (Billings)
- **NM:** Sunwest Title (Santa Fe); First American (Las Cruces)
- **UT:** Founders Title (SLC)
- **AZ:** Title Security (Tucson); Pioneer Title (Phoenix)
- **ID:** TitleOne (Boise); First American (Coeur d'Alene)

I want a `titleCompanies` table on my org with state, name, contact, escrow officer, average closing time, last-five-deals notes, preferred-or-not. When I open a parcel in MT, the title-company picker should default to my MT preferred. Today I'm copy-pasting from my Notes app.

**3:30 PM.** I open `/money` to sanity-check my tax position before quarterly estimates. **Nothing is multi-state.** Hana's audit (which I read this morning) flags AcreOS's *own* SaaS-tax exposure across 22 states. My version of that problem is on the customer side: my CO LLC owes Wyoming an annual report ($60), New Mexico a CRS-1 if I sold paper, Arizona a TPT registration if I'm wholesaling within 24 months of taking title, and Utah a 5% withholding on every non-resident grantor at closing. The platform doesn't surface any of that. The tax calendar is silent on state-level filings. This is exactly the kind of thing a CPA charges $400 for and the platform could surface for free if it had `operatingStates`.

**4:30 PM.** I try to find Pax. Pax is friendly and answers questions, but it's state-agnostic. Ask it "what's the redemption window in Cochise County?" — it gives a generic AZ answer (which happens to be in `taxDelinquentPipeline.ts` — 36 months) but doesn't drill to county-level. Ask it "should I take title in my CO LLC or my WY LLC for this Cody parcel?" — it doesn't know I have an LLC, much less four. Pax should be a multi-state copilot, not a state-blind chat window.

**5:30 PM.** Sign-document flow. Same wet-ink concern Marisol-California raised, multiplied: each of my seven states has its own RON statute. **AZ allowed RON since 2020. CO allowed it since 2021. WY since 2022. UT, NM, MT, ID — all variable.** A multi-state operator needs the e-sign flow to be per-state-per-doc-type aware. AZ grant deed e-signed via RON: fine. ID quitclaim e-signed without RON-licensed notary: bounces at the County Recorder. The platform has one global e-sign flow; it's making me do the per-state research.

---

## 5. The multi-LLC entity problem (centerpiece miss)

This deserves its own section because it's the single feature that, for a multi-state operator, would justify the Pro tier on its own.

I have four operating entities:

1. **Prescott Land Holdings, LLC** (CO domestic) — main operating entity
2. **Frontier Acres LLC** (NM domestic) — for NM tax-deed acquisitions; foreign-qualified into CO
3. **Cordillera Holdings LLC** (WY domestic, anonymous) — for asset protection on long-hold parcels; not foreign-qualified anywhere (intentional)
4. **Sun Mesa LLC** (AZ domestic) — for AZ wholesale flips

Plus the **Prescott Family Mineral Trust** (irrevocable, NV situs) for inherited WY mineral splits.

Things the platform must support to be useful to me:

- **Entity registry** with state of formation, foreign qualifications, registered agent per state, EINs
- **Annual-report calendar** with state-specific due dates and fees (CO is the anniversary month; WY is the first day of the anniversary month; AZ is annual report on May 1; NM is no annual report but a biennial corp report; MT is April 15; UT is anniversary month; ID is anniversary month). Right now I have this in a Google Calendar that I update by hand once a year.
- **Per-entity property linkage** — when I take title, the closing flow asks "which entity?" and pre-fills the grantee on the deed
- **Per-entity tax summary** — separate K-1 estimates, depreciation schedules, 1031 chains, capital gains
- **Foreign-qualification gate** — if I try to take title in MT under my CO LLC and my CO LLC isn't foreign-qualified in MT, the platform should warn me ("Prescott Land Holdings LLC is not registered as a foreign entity in MT. Taking title without registration is permissible for passive ownership but bars you from filing suit to enforce contracts. Register first or use Cordillera Holdings (WY) which has reciprocal recognition under the WY-MT Compact for [conditions].")
- **Veil-piercing audit** — am I commingling funds? Am I using the right entity letterhead? (Stretch goal, but Pro-tier worthy)

Today the platform has none of this. Entity is a string field inferred from the seller's name on a deed.

---

## 6. The multi-state tax calendar (Hana's adjacent problem)

Hana's audit (`docs/exhaustive-completion/elite-team-deep-2026-05-01/hana-tax.md`) flags AcreOS's own SaaS tax exposure in 22 states — a registration + nexus + remittance problem that becomes back-tax the day after a customer crosses a threshold.

My version, on the *customer* side:

- **CO:** Annual LLC report (periodic report, $10), state income tax filing (4.4% pass-through), use tax on out-of-state purchases I bring in
- **WY:** Annual report ($60 minimum), no income tax, 4% sales/use on personal property, severance tax on minerals
- **MT:** Annual report ($20), 6.75% state income tax (top rate), water-rights filings if I take title to anything with water
- **NM:** Biennial corp report, 5.9% state income tax (top), gross receipts tax (CRS-1) on rental income
- **UT:** Annual report ($20), 4.85% flat income tax, 5% non-resident withholding at closing for any out-of-state grantor
- **AZ:** Annual report ($45), 2.5% flat income tax, TPT (Transaction Privilege Tax) on commercial leases, state withholding on non-resident sales
- **ID:** Annual report ($0 — Idaho is uniquely free!), 5.8% flat income tax, no TPT but use tax can apply

That's 14 distinct recurring obligations plus event-driven ones (closing withholdings, gross receipts on rentals, severance on minerals). Today I track them in a spreadsheet that my CPA reconciles each March. **A platform that tracks the federal 1031 calendar (which it does — `routes-exchange-1031.ts`) but not the state annual-report calendar is making me ask: why?** The data is static, public, and structured. Hana's framework — registration → economic nexus → remittance — applies one-to-one to the customer side too.

This is a *small* feature with disproportionate value: surface a "Compliance Calendar" tile on `/today` for any org with `operatingStates` populated, pull due dates from a `stateComplianceCalendar` table (per state, per filing type, per filing month/day), and let me check off each one as I file. That's a $49/mo feature on its own.

---

## 7. Per-surface friction (multi-state edition)

**`/today`** — Filtered to my `operatingStates`. CO+WY+MT+NM+UT+AZ+ID legislative feeds, not TX/FL. Compliance Calendar tile.

**`/pipeline` + `/leads`** — Group by state in the default view. Show per-state win rate, average days-to-close, average margin. Different because each state has different acquisition rhythms (NM tax deeds are auction-driven, AZ direct mail, MT foreclosure-list).

**`/parcels/:id`** — DD checklist driven by `regulatoryIntelligence.ts` row for that state. Today: 7-of-7 of my states return nothing. Add CO, WY, MT, UT first, then build from there.

**`/finance`** — Note generator must ask "governing law: state of property / state of borrower / state of lender" with property as default. Log every note's choice-of-law in a column.

**`/documents`** — Hard fail if `stateDocumentConfig.ts` doesn't have a real entry. Don't fall back to TX template; don't auto-generate empty-slot deeds. Surface "WY template ships v1.4" or similar.

**`/money`** — Multi-state tax calendar. Per-entity tax summaries. Nonresident-state withholding tracker. State 1031 conformity (mostly conforming, but UT has its own clawback for non-conforming gain).

**`/portfolio`** — Group by holding entity, then by state. Show concentration risk per state and per entity.

**`/onboarding-v2`** — Ask at signup: "Which states do you operate in?" "What entities do you own?" "Are they foreign-qualified anywhere?" Drive the rest of the platform from those answers.

**`/pax`** — State-aware and entity-aware. "Use my WY LLC" should be a recognized intent.

**`/sign-document`** — Per-state-per-doctype RON allowability table. Today: global flow. Should be: "AZ grant deed RON-eligible since 2020 (A.R.S. § 41-371). MT grant deed wet-ink only. ID quitclaim RON-eligible with caveats."

**`/closing`** — Per-state title-company directory. Default the picker to my preferred company for the parcel's state.

---

## 8. Five features that would make this a no-brainer for a multi-state operator

1. **Operating-states org setting + entity registry.** Foundational. Drives everything else. Two weeks of work, one schema migration, one onboarding question.

2. **Fill `regulatoryIntelligence.ts` for the Mountain West.** CO, WY, MT, NM, UT, AZ, ID at minimum. One day of attorney review per state, half a day to encode each. Two engineer-weeks for the seven I need; six engineer-weeks for the remaining 33. After that AcreOS is the only horizontal CRM with structured 50-state regulatory data.

3. **Per-state title-company directory** tied to the org. Pre-population with the top 3 per state from a public directory; user adds their own. Ties into the closing flow so the title-company picker pre-fills correctly.

4. **Multi-state Compliance Calendar.** Annual reports, nonresident withholdings, gross-receipts filings, severance filings. Static state data, pulled into a tile on `/today` filtered by my entities × my operating states. The single feature my CPA would tell me to pay for.

5. **Foreign-qualification gate at deed-generation.** Check: is the grantee LLC registered in the parcel's state? If no, surface the consequences and offer to (a) use a different entity that is registered, (b) hold in personal name temporarily, (c) generate the foreign-qualification filing. This is the kind of guardrail that makes a multi-state operator *trust* the platform.

---

## 9. The deal-killer if not fixed

**There is no concept of "states I operate in," and the regulatory-intelligence layer doesn't know my Mountain West states exist.** Until both are fixed, AcreOS for me is a TX/FL/Sun-Belt CRM with a 50-state usury checker bolted on. That's not a multi-state operating system; that's a single-state CRM that knows usury law.

The fix is structural, not cosmetic. It's a schema migration, a content-fill, and an onboarding question. None of it is hard. All of it is overdue.

Get the foundations right and I move my whole stack — Realeflow, my spreadsheets, my CPA's intake forms, my Google Calendar — onto AcreOS in a weekend. There are more multi-state operators than the team thinks. We're the operators with the highest LTV because state-juggling is what's keeping us from scaling, and a platform that solves it lifts our deal-throughput by 30-40%. Fix the foundations and we'll come.

— Marisol Prescott

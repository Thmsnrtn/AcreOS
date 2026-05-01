# Zerah Hollingsworth — AcreOS Tax-Attorney Audit

**Role:** RE tax attorney (NY bar, IRS Circular 230) + CPA, 20 years.
Practice mix: ~60% Land Investors and small-cap RE syndicates, ~25% note holders, ~15% high-net-worth dispositions and 1031s.
**Wave:** 2 of 87-persona AcreOS audit, RE tax-attorney lens.
**Date:** 2026-05-01.
**Surfaces reviewed:** `server/services/exchange1031.ts`, `server/services/costBasisTracker.ts`, `server/services/depreciationService.ts`, `server/services/taxOptimizationEngine.ts`, `server/routes-tax-optimization.ts`, `server/routes-exchange-1031.ts`, `server/routes-borrower.ts` (lines 750–840), `client/src/pages/borrower-portal.tsx`, `client/src/pages/depreciation-calculator.tsx`, `client/src/pages/tax-optimization.tsx`, `client/src/pages/exchange-1031.tsx`, `shared/schema.ts` (notes + payments + costBasis).

I read Wendell. I read Linnea. They both flagged 1098-INT as the deal-killer. They are right, and they are wrong about the same thing — they think the 1098 problem is the *biggest* problem. It is not. The biggest problem is upstream of the 1098: AcreOS's note schema models a generic loan, not a tax-event-producing instrument, and that delta cascades into every form below it.

---

## 1. One-line verdict

**I would not bless AcreOS as the system of record for any tax-sensitive client today** — the 1098-INT generator is half-built and unreviewed, basis tracking ignores acquired notes and depreciation recapture, and there is no W-9, no 1099-INT, no K-1, and no OID/market-discount accretion anywhere in the codebase. The bones for 1031, basis, and MACRS are surprisingly competent. The forms layer that the IRS actually sees is missing.

I would let a client *trial* AcreOS as a workflow tool while keeping their existing tax stack intact. I would not let them rely on AcreOS's outputs at filing time.

---

## 2. 1098-INT generation — **conditional fail**

A 1098 is owed by the recipient of mortgage interest of $600 or more in a calendar year **in the course of a trade or business** (IRC § 6050H, Reg. § 1.6050H-1). For a Land Investor carrying seller paper this is non-optional; for a Note Investor with 30+ borrowers it is the load-bearing wall of January.

What AcreOS has today (`server/routes-borrower.ts:770-800`):

- A single endpoint that returns a JSON payload labeled `type: '1098'` for one note.
- Sums `payments.interestAmount` between Jan 1 and Dec 31 of the requested year.
- Echoes borrower name + address, lender name + address from `org.settings`.
- Renders to PDF client-side in `borrower-portal.tsx:479-531` with the literal text "Form 1098 - Mortgage Interest Statement."

What's missing — and any one of these gets a return rejected by the IRS:

1. **No batch generation.** Every 1098 is one borrower-portal click. Linnea has 63 notes; that's 63 sessions.
2. **No 1096 transmittal.** The IRS Copy A filing requires Form 1096 cover (or 1098 e-file via FIRE / IRIS). Nothing in the codebase emits one.
3. **No TIN on file for the borrower.** `notes` and the borrower record have no `tin`, no `ssn`, no `taxIdentifier`. Without the borrower's TIN the 1098 is incomplete and triggers backup withholding obligations under IRC § 3406.
4. **No payer TIN (lender EIN).** `org.settings.companyAddress` is rendered, but I see no `companyEIN` or `taxId` field on the org. The Recipient TIN box on a 1098 cannot be blank.
5. **Outstanding mortgage principal as of Jan 1** (Box 2 since 2017) is not computed. The endpoint emits `principalBalance` (current) and `originalPrincipal` (original), but the legally required value is the principal balance as of the **start of the calendar year**, which requires a year-boundary snapshot the schema does not store.
6. **Mortgage origination date** (Box 3) — present (`note.startDate`).
7. **Refund of overpaid interest** (Box 4), **mortgage insurance premiums** (Box 5), **points paid on purchase** (Box 6), **address of property securing the mortgage** (Box 8) — all unhandled.
8. **No "secured property" address distinct from borrower address.** Box 8 requires the property address, which on a seller-financed note is usually the same parcel the borrower is buying. The schema connects `notes.propertyId` to `properties` but the 1098 endpoint does not pull it.
9. **No filing year cutoff or e-file.** January 31 (recipient copy) and February 28 paper / March 31 electronic (IRS copy) deadlines have no calendar surface, no automation, no audit trail of what was sent when.
10. **No record of issuance.** When a borrower disputes a 1098 in March, I need to show the IRS exactly what was sent on what date with what totals. There is no `tax_form_issuances` table.

**Verdict: the 1098 today is a printable letter that looks like a 1098.** It is not a tax form. A client of mine who relied on it would be filing incorrect informational returns under penalties of perjury. *I cannot bless this.*

The good news: the math is right. `yearInterest` from completed payments inside the calendar year is the correct number for Box 1 on a true cash-basis lender, which is most of my book. The plumbing for the actual dollar figure exists. Everything around it does not.

---

## 3. Basis tracking and depreciation

### 3a. Cost basis tracker — **competent for originated parcels, broken for acquired notes**

`server/services/costBasisTracker.ts` is the cleanest tax-relevant code in the repo. It correctly:

- Treats acquisition price + acquisition (closing) costs as initial basis.
- Tracks improvements as basis additions and stamps a dated note in the audit trail.
- Supports basis adjustments for `depreciation`, `casualty_loss`, `insurance_recovery`, `partial_sale`, `other` — this is the IRC § 1016 adjustment list rendered correctly.
- Computes gain/loss on disposition via sale price − adjusted basis.
- Determines short- vs long-term holding period from acquisition date with a 12-month threshold.

What it gets wrong or skips:

1. **Estimated tax rate of 0.238 (LTCG + NIIT)** assumes the taxpayer is in the 20% LTCG bracket and subject to 3.8% NIIT. That is the high-water rate, not the average. For most of my Wendell-style Land Investor clients the right LTCG rate is 15%, NIIT may not apply, and the displayed estimated tax overstates by ~50%. **Mark it as "high-water estimate" or compute against actual MAGI.**
2. **No depreciation recapture under § 1250 / § 1245.** When a held parcel with improvements (rental, commercial) is sold, accumulated depreciation is recaptured at up to 25% (§ 1250) or ordinary rates (§ 1245). The current `computeGainLoss` returns one number; a real schedule should split *unrecaptured § 1250 gain* (taxed at 25%) from the long-term capital gain (taxed at 15/20%). Without that the optimizer will recommend dispositions that look better than they are.
3. **No basis allocation between land and improvement.** For a parcel that becomes a rental, you must allocate purchase price between non-depreciable land and depreciable improvement (typically by tax assessor ratio or appraisal). The cost basis record holds one `adjustedBasis`, not a split. The depreciation service expects `landBasis` as a separate input but there is no link between the two services.
4. **No acquired-note basis path.** A note purchased on the secondary market for less than face value carries a basis = purchase price, plus accreted market discount/OID over the life of the note (Pub 1212, IRC § 1276–1278). The schema has `originalPrincipal` and `currentBalance`. It has no `acquisitionPrice`, `acquisitionDate`, or `accretionMethod` on `notes`. **Linnea is right — for an acquired note this isn't a feature gap, it's a wrong number every year.**
5. **No partial dispositions.** Subdividing a parcel and selling lots requires basis allocation by relative FMV (or acreage if uniform). The "partial_sale" adjustment type exists as an enum but there's no split-basis workflow.
6. **No § 121 exclusion** for primary residence. Edge case for Land Investors but not for Wendell's wife.

### 3b. Depreciation service — **MACRS math is solid, integration is not**

`server/services/depreciationService.ts` builds a real MACRS schedule:

- 27.5-year residential and 39-year non-residential straight-line with the correct mid-month convention tables.
- 15-year land improvements with 150% declining balance switching to SL.
- 5- and 7-year personal property with 200% DB and half-year convention.
- Correctly excludes raw land from depreciation.
- Round-trips an annual deduction, accumulated, adjusted basis, and a fully-depreciated year.

What's missing:

1. **No § 168(k) bonus depreciation toggle.** 2026 phase-down to 40%; for a building improvement placed in service this year, ignoring bonus is a 5-figure miss on a small commercial. There's a `bonus` enum value referenced in routes but no implementation.
2. **No § 179 expensing** for personal property and qualified improvement property (QIP).
3. **No cost segregation hooks.** A cost seg study reclassifies portions of a building from 39-year to 5/7/15 — that's where the dollars are on a held commercial. The data model would need a parent property with child component-class allocations. Not here.
4. **No mid-quarter convention** for years where >40% of personal property is placed in service in Q4. Edge case but tax-noticeable.
5. **The client-side `depreciation-calculator.tsx`** uses a *different* and looser model — `MACRS_5YR/7YR/15YR` as flat percentage tables with no convention awareness. The server's MACRS schedule and the client calculator can produce different numbers for the same property. **Pick one engine.**
6. **No depreciation roll-up by entity.** Atlas / Pax prompts cite property-level numbers; my CPA needs a single Form 4562 worksheet per entity per year.

---

## 4. 1031 exchange — **best-in-class scaffolding, half-wired**

`server/services/exchange1031.ts` is genuinely thoughtful. It encodes:

- Both hard deadlines (45-day identification, 180-day completion) computed from sale close.
- Tiered alerts (info → warning → critical) at 30/15/14/7 days.
- A statutorily-correct identification letter template that names Treas. Reg. § 1.1031(k)-1(c) and the 3-property rule.
- The right warning when the 45-day passes with no candidates ("Exchange may be invalid"). That is the line a tax attorney wants to see.

But the routes (`routes-exchange-1031.ts`) wire to a service whose persistence layer is **stub functions returning empty arrays and `null`** (`exchange1031.ts:268-272`). Today:

- `listExchanges` returns `[]`.
- `createExchange` returns `{}`.
- `getExchange` returns `null`.
- `addReplacementProperty` returns `null`.
- `completeExchange` returns `null`.

So the page exists, the route exists, the math exists, **and nothing persists.** A client kicking off a 1031 in this UI today is documenting deadlines into a void. That is worse than no feature, because it reads as a feature.

Other gaps:

1. **No 200% rule or 95% rule.** The identification letter mentions only the 3-property rule; the other two (identify properties of any number whose aggregate FMV ≤ 200% of relinquished, or any number provided 95% are acquired) are valid alternatives some clients need.
2. **No `exchanges` table.** The comment at line 60 admits the data lives "in `activityLog` as structured metadata." That's not a system of record.
3. **No reverse exchange or improvement (build-to-suit) exchange flow.** Both are sophisticated and rare, but a tax attorney handles them, and AcreOS's audience aspires to.
4. **No QI escrow tracking.** Funds must sit with a Qualified Intermediary; the service captures QI name/email but never confirms funds receipt or release. For a forensic audit defense I'd want every wire.
5. **Boot tracking** — "boot" (cash or non-like-kind property received) is taxable to the extent of gain. The service does not surface boot at all. If a client closes on a smaller replacement property, the difference is taxable boot and the optimizer should flag it.
6. **State-level conformity to § 1031.** California has clawback (Form 3840 for out-of-state replacements). Pennsylvania does not conform to federal 1031 for personal income tax (only effective 1/1/2023 for individuals). Massachusetts conforms but with quirks. Nothing in the code is state-aware on conformity.

If the persistence stubs ship and the boot calculation lands, this becomes a real product. The skeleton is right. The flesh is missing.

---

## 5. K-1 generation — **does not exist**

K-1 (Form 1065 for partnerships, 1120-S for S-corps) is how a syndicate pushes its income/loss/basis allocations to its partners every year. AcreOS handles partnership concepts loosely:

- `marketplaces.listingType` includes `partnership` and `note_sale`.
- `bids.bidType` and `partnershipSplit` percentage exist.
- `transactions.dealType` includes `partnership` and `joint_venture`.

What's missing for any actual K-1 generation:

1. **No partner / member registry.** A real syndicate has N capital accounts (per partner), preferred/common splits, IRR hurdles, catch-ups. None of that exists in the schema.
2. **No capital account roll-forward.** Beginning capital → contributions − distributions + allocated income/loss = ending capital. This is the spine of every K-1.
3. **No allocations engine.** Special allocations under § 704(b) require substantial economic effect. Even straight pro-rata allocations require multiplying every line of the partnership P&L by each partner's percentage and posting it to their K-1.
4. **No Schedule K-1 boxes.** Box 1 (ordinary business income), Box 2 (rental real estate), Box 9c (unrecaptured § 1250 gain), Box 19 (distributions), Box 20 codes (Z/AH for QBI) — none of this.
5. **No K-3 (international).** N/A for most Land Investors but mandatory if the partnership has any foreign activity or partners.
6. **No e-file via MeF.** Every CPA filing 1065s on behalf of the partnership uses Modernized e-File. AcreOS has no path.

Linnea's pool-note case (3 investors share a $180K commercial note 50/30/20) is a microsyndicate. For her, even a per-investor cash-distribution table that sums to a per-investor 1098-INT-share and a per-investor K-1 line item would be enough. **AcreOS produces zero of that.**

---

## 6. Year-end tax-package readiness

This is the test my CPA practice actually grades on. Every January, I expect to pull a single ZIP per client containing:

| Document | AcreOS today | Notes |
|---|---|---|
| 1098-INT per borrower (recipient + IRS copy) | Half — single-note JSON, no batch, no 1096 | See § 2 |
| 1099-INT per *holder* of investor capital we paid | **Missing** | If you pay a private money lender > $10/yr interest |
| 1099-NEC per contractor we paid > $600 | **Missing** | Wholesalers, mailer vendors, attorneys, surveyors |
| 1099-MISC for rents/royalties/legal settlements | **Missing** | Royalty income common in TX with mineral rights |
| 1099-S on RE sales by closer | **Missing** | Usually the title company files; we should track |
| 1099-C on cancellation of borrower debt | **Missing** | Critical when borrower defaults and we forgive |
| W-9 collection from every payee | **Missing** | No fields, no workflow, no storage |
| Cost basis schedule per property | Partial | See § 3a |
| Depreciation schedule per property | Partial | See § 3b |
| Realized gain/loss summary | Partial | Recapture not split |
| 1031 exchange status report | UI only, not persisted | See § 4 |
| Schedule E rental income summary | **Missing** | Per-property gross rents, expenses, depreciation |
| Form 4562 depreciation worksheet | **Missing** | Could be derived from depreciation service |
| Form 8949 / Schedule D detail | **Missing** | Disposition list with basis, proceeds, gain |
| Mileage log | **Missing** | A field tool exists; no IRS mileage report |
| Home office expense | **Missing** | Common for sole proprietors |
| K-1s for syndicates | **Missing** | See § 5 |
| State-specific filings | **Missing** | TX franchise tax, CA Form 568, FL DR-405 TPP, NY IT-204 |
| QBO export | Mentioned, surface unaudited | Quality unknown |

Net: AcreOS today gets you a stack of CSVs you'd hand to a CPA, not a tax-package you'd hand to the IRS. The optimizer surface is a forecasting tool, not a compliance tool. **Those are different products.**

---

## 7. Top 10 tax compliance gaps

Ranked by likelihood-of-IRS-assessment × impact-per-client.

1. **No W-9 collection workflow.** The cleanest bet on the board. Without TIN on file at first payment, every distribution to a contractor or note holder triggers 24% backup withholding under § 3406. AcreOS should refuse to issue a payment to an unverified payee. Today there's no field to even hold the TIN.
2. **1098-INT is a single-borrower JSON, not a batched filed informational return.** § 6721 penalty: $310/return for late filing in 2026 (intentional disregard: $630/return uncapped). For Linnea's 63 borrowers that's $19,530 / $39,690 of exposure annually if I tell her to rely on AcreOS.
3. **No backup withholding on payments to no-TIN-on-file payees.** When AcreOS pays a fallback payment cascade or routes via Stripe Connect to a private money lender without a W-9, the org is liable for the 24% it failed to withhold. Forever.
4. **No depreciation recapture in disposition math.** § 1250 gain at 25% is ignored. On a 10-year-held rental this can be a 5-figure mis-estimate of after-tax proceeds and warps every "sell vs hold" recommendation Pax makes.
5. **1031 exchange persistence is stubbed.** Clients documenting 45-day deadlines into a void will miss them, and a missed 45-day is a fully taxable sale of the relinquished property.
6. **No OID / market-discount accretion on acquired notes.** Pub 1212 requires an accreted-discount add to ordinary income each year on bought-at-discount notes. AcreOS treats face value = basis. Every year a Linnea-style portfolio is filed wrong by a meaningful amount.
7. **No 1099-C on debt forgiveness.** When a Land Investor reworks a defaulted note and forgives $20K of principal, the borrower owes ordinary income tax on $20K (§ 61(a)(11)) and we owe a 1099-C. This event is *frequent* in seller-financed land. AcreOS has no surface for it.
8. **No state-level filing awareness.** TX no income tax but franchise tax (Public Information Report due May 15). CA Form 568 LLC tax of $800 minimum. FL DR-405 tangible personal property return. NY IT-204 partnership return. None of these are calendared, none generated.
9. **No passive activity loss tracking (§ 469).** Land Investors who don't qualify as a Real Estate Professional (750+ hours, more than half of personal services in real estate) have rental losses limited. AcreOS has no `realEstateProfessional` flag and no way to carry forward suspended PALs. CPAs are tracking this in spreadsheets we promised to retire.
10. **No at-risk basis tracking (§ 465).** Loss deductibility is capped at amount at risk. If a Land Investor finances 100% non-recourse, losses are not deductible until at-risk basis returns to positive. Currently a black hole.

Honorable mentions: no entity classification awareness (single-member LLC vs partnership election), no estimated-tax quarterly worksheet, no SALT cap workpaper, no Form 1041 trust-and-estate handling, no Form 5471/8938 if a foreign owner ever appears.

---

## 8. The 1–2 week tax-foundations sprint

If I'm advising Thomas, here's the order of operations to get from "looks like a tax product" to "I can defend its outputs to a client."

### Week 1 — stop the bleeding

**Day 1 — schema + W-9 (8h):**
- Add `taxIdentifier` (encrypted), `taxIdentifierType` (`SSN` | `EIN` | `ITIN`), `w9OnFileAt`, `w9DocumentId` to `borrowers` and any payee table.
- Add `companyEIN` to `organizations.settings`.
- Block payment issuance via existing payment cascade if `w9OnFileAt` is null *and* annual-paid > $600. Soft-warn under threshold.

**Day 2 — true 1098 batch (10h):**
- New endpoint `POST /api/tax/1098/generate?year=2026`: pulls every active note in the org, filters to those where YTD interest ≥ $600, computes Jan 1 principal balance via payment ledger, emits one PDF per borrower + one combined ZIP.
- Persist a `tax_form_issuances` table — `(orgId, borrowerId, formType, taxYear, generatedAt, pdfHash, sentAt, sentMethod)`.
- Generate Form 1096 cover for paper filing OR push to IRIS / FIRE for e-file (start with paper template; e-file is a separate two-week build).
- Pre-flight check page: list of notes that *would* generate a 1098 + warnings (no TIN, no Box-2 prior balance, no property address).

**Day 3 — 1031 persistence (8h):**
- Add `exchanges_1031` table with the columns implied by the `Exchange1031` interface in the service.
- Replace the stub functions in `exchange1031Service` with real Drizzle queries.
- Add a daily job that computes `getExchangeAlerts` for every active exchange and pushes critical alerts to founder inbox + email.

**Day 4 — depreciation recapture (6h):**
- In `costBasisTracker.computeGainLoss`, when a property has any accumulated depreciation, split the gain into (a) unrecaptured § 1250 portion (= min(gain, accumulated depreciation)) at 25% and (b) remainder at 15/20%. Return both numbers.
- Wire the depreciation service `accumulated` value into the cost basis record at disposition time so the math has the inputs it needs.

**Day 5 — 1099 surface (8h):**
- Add a "Payees" page (or extend Vendors) with W-9 status badges.
- Generate 1099-NEC and 1099-MISC drafts in January for every payee paid > $600 in the prior calendar year.
- Add a 1099-C generation path on the note's "discharge" event (which doesn't exist yet — add it as a note status change with an interest-and-principal forgiven amount).

### Week 2 — make it durable

**Day 6-7 — basis acquisition path for notes:**
- Add `acquisitionType` enum, `acquisitionPrice`, `acquisitionDate` to `notes` (Linnea's deal-killer).
- Implement OID/market-discount accretion: on every acquired note, accrete the discount over remaining term using constant yield method; surface a `taxYearAccretedIncome` per note per year. This rolls up to the annual interest-income line.

**Day 8-9 — recapture + at-risk + PAL flags:**
- Add `realEstateProfessional` flag at user level + entity, with the 750-hour test attestation.
- Add a `passive_activity_carryforward` table for suspended losses by entity.
- Add `at_risk_basis` tracking on syndicate / partnership investments.

**Day 10 — state pack:**
- Calendar templates for the top-10 state filings AcreOS users hit (TX franchise, CA 568, FL DR-405, NY IT-204, PA RCT, IL ST-1, NV no-tax, AZ corp, GA, OH).
- One page per state with form name, due date, what to attach.

**Day 11-12 — K-1 minimum viable:**
- Per-syndicate partner table, capital account roll-forward, pro-rata allocations.
- Generate Schedule K-1 PDF for each partner with Box 1, 2, 9c, 19, 20-Z populated. Stop before § 704(b) special allocations — those are an attorney-in-the-loop product.

**Day 13-14 — audit trail and docs:**
- Every form issuance writes to `tax_form_issuances` with the PDF hash and the input ledger snapshot.
- A `docs/runbooks/tax-compliance.md` documenting: what AcreOS will and will not do, what the user's CPA still owns, what the audit-defense package looks like.

### What this sprint does NOT solve

- **Cost segregation** — needs a structured engagement product, not a button.
- **§ 704(b) special allocations** for sophisticated syndicates — attorney-in-the-loop only.
- **Reverse and build-to-suit 1031** — extra week each.
- **State-of-incorporation tax conformity matrix** — full quarter to map.
- **Foreign owner reporting** (Forms 5471, 8938, 8865) — out of scope until international expansion.
- **Estate / trust filings** (Form 1041) — adjacent practice, separate product.

---

## Bottom line

AcreOS is **80% of the way to a real tax product on the math, 30% of the way on the forms, and 10% of the way on the audit defense.** The depreciation engine, the basis tracker, and the 1031 deadline service are honest work. The 1098 endpoint is theater. The 1099 family is absent. The K-1 is absent. The W-9 — the cheapest, fastest, most legally consequential fix on the board — is absent.

If items 1–4 of the sprint above ship, I would let a Wendell-style sole proprietor with originated notes use AcreOS as their book of record and let their CPA do the filings. If items 1–7 ship, I would let Linnea trust the per-note basis and accreted-discount numbers. If items 1–14 ship, AcreOS is genuinely the tax-foundations layer of a Land Investor practice and I'd recommend it from the bench.

Today, I'd recommend it as a workflow tool. Not as a tax product. The difference is whether a missed deadline costs the user $400 (a missed task) or costs them their § 1031 deferral (a six-figure event with criminal exposure if pattern-of-conduct).

Get the forms layer right. The rest of the platform is too good to leave a 1098 looking like a printable letter.

— Zerah Hollingsworth, JD, CPA

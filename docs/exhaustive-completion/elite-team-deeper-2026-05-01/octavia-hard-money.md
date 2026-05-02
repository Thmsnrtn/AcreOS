# AcreOS as a Hard-Money Lending Counterparty — Underwriting Docs, Collateral AVM, Pipeline Visibility, Servicing, and Default Recovery

**Author:** Octavia Runnels, 47 — Founder, Cinder Mesa Capital, LLC. Hard-money lender to Land Investors, $30K–$250K bridge loans, 10–12% rate, 12-month term, secured by recorded deed of trust on the subject parcel. ~120 active loans, ~40 in motion at any time, four states (TX, FL, NM, AZ).
**Date:** 2026-05-01
**Wave:** 3 (deeper) — hard-money lender lens
**Read in full:** `client/src/pages/borrower-portal.tsx` (1431 lines), `client/src/pages/deal-underwriting.tsx`, `client/src/pages/avm.tsx`, `client/src/pages/capital-markets.tsx`, `server/services/dealUnderwriting.ts`, `server/services/ltvMonitor.ts`, `server/services/avmFeedback.ts`, `server/services/acreOSValuation.ts`, `server/services/capitalMarkets.ts`, `server/services/dunning.ts`, `server/services/comps.ts`, `server/routes-borrower.ts:600-720` (payoff quote), `server/routes-documents.ts:230-262, 489-495` (note + DOT generation), `server/routes-finance.ts:945-1044` (LTV report), `shared/schema.ts:813-911` (notes), `shared/schema.ts:914-944` (payments), `shared/schema.ts:9454+` (valuation_predictions). MEMORY refs: `project_native_esign.md`, `feedback_terminology.md`.

---

## 1. The lending decision, plainly

I do not lend to AcreOS. I lend to the Land Investor *holding* AcreOS, against a parcel *valued* by AcreOS, with documents *generated* by AcreOS, paid through a portal *operated* by AcreOS. Every artifact in my file is upstream of someone else's code. The only question that matters: when this loan goes to recovery — and 6–8% of my book does in any given year — does AcreOS leave me with a defensible trail or a smoking hole?

The answer today is **conditionally defensible for performing loans, structurally weak for recovery.** The platform produces a real promissory note (`routes-documents.ts:230`) and a real deed-of-trust template (`routes-documents.ts:489`), maintains an LTV monitor (`ltvMonitor.ts`), runs a borrower portal with payoff quotes (`routes-borrower.ts:621`), and tracks delinquency state on the note row (`schema.ts:894`). What it does *not* do is generate the underwriting package my capital partners want, expose collateral risk to a third-party lender's view, surface borrower payment behavior in a form I can pull into my own credit model, or carry me through the foreclosure → REO → resale loop that is half my actual business.

What follows is the file I would assemble before agreeing to lend against any AcreOS-generated collateral package, and the gaps I would require closed before I'd raise my exposure beyond pilot scale.

---

## 2. Underwriting package — what AcreOS produces vs. what I need

When a borrower submits a loan application, my underwriter wants a single PDF: subject property comps, AVM with confidence band, title summary, tax history, environmental flags, borrower financial summary, exit plan, and an as-is and as-repaired valuation. AcreOS today produces fragments.

### 2.1 Deal underwriting workbench — strong front-end, weak hand-off

`deal-underwriting.tsx` + `dealUnderwriting.ts:244-259` runs three scenarios (base/bull/bear) with appreciation, holding cost, IRR, equity multiple, and an exit-strategy comparison (wholesale / owner-finance / retail). The IRR uses Newton's method with a 100-iteration cap (`dealUnderwriting.ts:62-94`) — solid. The model is *for the investor's exit thesis*, not for a lender's collateral coverage. There is no LTV calculation in the output. There is no debt-service-coverage view. The "owner finance" exit assumes 9.9% / 10yr / 20% down hard-coded (`dealUnderwriting.ts:144-148`), which is a reasonable retail assumption but is *not* my structure (10–12%, 12mo, interest-only, balloon). I cannot hand the borrower's underwriting export to my capital partner — it answers the wrong question.

**Required:** a "Lender View" export option that re-runs the same input under a debt structure (rate, term, amortization style), produces LTV / LTC / DSCR / debt yield, and prints to a single PDF with the comps and AVM stapled in.

### 2.2 Comps service — Regrid-only, no sale-price comps in many counties

`comps.ts` pulls from Regrid radius search (`parcel.ts:271`) with a max 8046m radius. It returns acreage, distance, and a flag `limitedData: comps.filter(c => c.salePrice).length < 3` (line 372). That flag is the honest tell — most rural land parcels have *no closed sale-price data in Regrid*, because rural land sales are often unrecorded for price (TX especially), or recorded with consideration of $10. My underwriter cannot price collateral on a comp set with three or fewer real sales. Today the AVM falls through to `acreOSValuation.ts` GBM (`acreOSValuation.ts:21-41`) which uses a "national median vacant land baseline" of $1000/acre when no comps exist (`acreOSValuation.ts:75`). **A $1000/acre baseline on a Mojave parcel is a 5x error in either direction.** I cannot lend off that.

**Required:** explicit "no sale-price comp" flag in the AVM response, refusal to produce a confidence > 30 when fewer than 3 sale-priced comps within radius, and a recommendation to commission a $400 desktop appraisal before lending. The platform is over-confident in counties where it should refuse to opine.

### 2.3 Title + environmental — entirely missing from underwriting export

I lend on parcels where 1 in 8 has a title defect (lien, gap in chain, easement misalignment) and 1 in 30 has an environmental issue (orphaned well, dump, FEMA-A floodplain, listed wetlands). AcreOS has `routes-title-search.ts` and a flood/wetland data layer (per repo listing) but the deal-underwriting workbench output does not aggregate those into a single "lender package." My underwriter ends up running three tabs in parallel and stapling screenshots. That is fine for hobbyist underwriting; it does not scale to my $40M annual originations.

---

## 3. AVM accuracy for collateral valuation — what I can trust

This is the load-bearing question. If the AVM is right, I lend at 65–70% LTV and sleep. If the AVM is wrong, I am undercollateralized at recovery and write off principal.

### 3.1 The feedback loop exists — and it's the most credible piece in the file

`avmFeedback.ts:49-74` records every closed deal as `predicted_value` vs `actual_acquisition_price`, computes `absoluteError`, `percentageError`, and `overestimated` boolean. The accuracy report (`avmFeedback.ts:78-112`) buckets predictions into within-10% and within-20% bands per month, with per-state breakdown (`avmFeedback.ts:116-147`). **This is the single most credible artifact in the lending file.** A lender can demand the trailing-12-month accuracy report per state, set a confidence floor (e.g., "I will not lend in any state where AVM percentage error > 15% on the trailing 100 deals"), and price tier accordingly.

Two issues I would ask the founder to fix.

**(a)** The "actual" anchor is the *acquisition price*, not the eventual *resale price* (`avmFeedback.ts:24`). For a lender, the relevant ground truth is the disposition value at recovery, because that is what I get if I foreclose. `actualSalePrice` is in the schema (`avmFeedback.ts:25`) but appears to not be populated on a separate event. I want a "post-recovery accuracy" report that tells me what the AVM said vs. what the parcel actually sold for in REO.

**(b)** The GBM model lives in `process.env.GBM_MODEL_JSON` or a static file (`acreOSValuation.ts:21-41`). There is no model versioning surface, no per-state model registry, and no rollback. If I am citing the AVM in my capital partner's quarterly report, I need to know which model version produced any single number, and I need to know when it was retrained. That information is not exposed.

### 3.2 LTV monitor — directionally right, mechanically thin

`ltvMonitor.ts` is a real artifact — it computes outstanding balance from the amortization (`ltvMonitor.ts:19-45`), estimates property value from parcel snapshots (`ltvMonitor.ts:48-74`), and bands risk as low/medium/high/critical at 70/80/90% LTV (`ltvMonitor.ts:90-92`). The `getOrgLTVReport` (`ltvMonitor.ts:101-121`) gives portfolio-level exposure. This is good plumbing.

The mechanical issues:

- The balance recalculation re-runs amortization from scratch every call (`ltvMonitor.ts:34-42`). On a portfolio of 120 notes with several payments each, it's fine; at 1,000+ notes with 5 years of payment history it will be slow and the principal/interest split can drift from the recorded payment row's `principalAmount` (`schema.ts:921`). **Trust the recorded payment splits, not a recomputation.**
- Property value fallback is `marketValue || assessedValue || listPrice || purchasePrice` (`ltvMonitor.ts:73`). For a 36-month-old loan, `purchasePrice` is wildly stale. There is no automatic re-AVM cadence — the monitor reports against whatever value was last cached. **Re-AVM at 6mo and 12mo and write the value to a `valuation_history` row tied to the note.**
- `ltvChange30d` is hard-coded to 0 (`ltvMonitor.ts:97`). It promises a 30-day delta and delivers nothing. Either compute it or remove the field.

### 3.3 The credit-rating function is a tell

`capitalMarkets.ts:130-152` rates pooled notes AAA/AA/A/BBB/BB/B by a hand-coded formula: deduct 30 for LTV > 80, deduct 20 for low rate, etc. This is not a credit rating. This is a mood. If AcreOS plans to pitch securitization as a real product (and the page exists at `/capital-markets`), the rating function needs an actual transition matrix from a defaulted / non-defaulted history, not a heuristic. **I would not let any of my notes into a "AcreOS-rated" pool today.** The rating language is a future legal exposure — calling something "AAA" when it is not is a securities issue.

---

## 4. Deal-pipeline visibility — what a lender can and cannot see

I do not need to see every borrower's pipeline. I need to see *my* loans across many borrowers' pipelines. AcreOS today is single-tenant per organization: each Land Investor's data is walled into their org. There is no lender-side view.

This is by design, and correct. But it means my workflow looks like: each borrower invites me as a "lender" user, I log in with separate credentials per borrower, I see their pipeline as if I were them. That does not scale past two or three borrowers.

**Required for any meaningful lender adoption:**

- A **lender role** with read-only access scoped to (a) notes where the lender is named, (b) the underlying property record, (c) the deal record that originated the loan, (d) the payment history. Nothing else.
- A **cross-org lender dashboard** — when I log in as a lender user, I see all notes across all borrower-orgs that have granted me access. One screen, all my exposure. This is a cross-org permission, which is a meaningful schema change (the org_id column on `notes` is currently the *borrower's* org, not the lender's).
- An **invitation flow** initiated by the borrower from the loan record: "invite Cinder Mesa Capital as lender of record." Generates a scoped access grant.
- **Document hand-off:** when the borrower generates the promissory note, deed of trust, and closing statement, the lender automatically receives a copy in their lender-portal document tray.

Without these, AcreOS-using borrowers will keep emailing me PDFs and screenshots, which is what they do today.

---

## 5. Loan-servicing integration — what works and what's missing

Once the loan funds, the borrower's AcreOS instance becomes the servicing system. From my perspective it is *the borrower self-servicing their own loan*, which is a category most servicers don't run.

### 5.1 What works

- **Promissory note generation** (`routes-documents.ts:230-262`) and **deed-of-trust generation** (`routes-documents.ts:489-495`) produce real PDFs. The promissory-note template (`storage.ts:5370+`) includes acceleration on default (`storage.ts:5412`) and references "deed of trust or mortgage" (`storage.ts:5397`) — boilerplate but legally workable.
- **Borrower portal** (`borrower-portal.tsx`) with email-verified access by token, per-loan scoped (`borrower-portal.tsx:49-79`). This is genuinely good. My borrowers do not need to call my office to get a payoff quote — they self-serve at `/api/borrower/payoff-quote` (`routes-borrower.ts:621-720`), which computes accrued interest at the *daily* rate (`routes-borrower.ts:648-655`) and prints a 30-day-good-through PDF (`routes-borrower.ts:662-704`). That alone removes about 40 phone calls a month from my front desk.
- **Payment cascade with fallback accounts** (`schema.ts:864-871`). Primary ACH fails, system tries fallback ACH or card in priority order. Real lenders do not ship this. AcreOS does. Material credit.
- **Tax escrow** (`schema.ts:833-841`, `taxEscrowPayments` table at `schema.ts:947`) — collects pro-rated taxes monthly, tracks balance, links to county tax portal. For land loans this is critical because tax delinquency compounds into a senior lien that wipes out my deed-of-trust position. I would *require* tax escrow on every loan. AcreOS lets the borrower toggle it off (`schema.ts:833`); I would want a lender-mandated flag that prevents the borrower from disabling it once the loan funds.

### 5.2 What's missing

- **No 1098 generation.** Every January I send 1098s to every borrower. Not in this codebase that I can find.
- **No lender-side payment ledger.** I see my borrower's payment in their portal. I do not see the *journal entry* that records principal/interest/escrow split in a form I can pull into my own books. The data is on the `payments` row (`schema.ts:920-924`), but there is no API export keyed to the lender.
- **No NACHA file generation.** If I am the originating depository institution for the ACH pull, I need a NACHA file. AcreOS uses Actum / Authorize.net / Stripe (`schema.ts:858`) — fine for the borrower, but the lender of record is a step removed from the actual bank rail. I cannot produce a regulatory NACHA file from AcreOS data.
- **No payment performance score per borrower.** `delinquencyStatus` (`schema.ts:894`) is a status flag, not a score. I want a 1–100 payment-behavior score I can hand my underwriter for the *next* loan to the same borrower. The data is there (payment history, days-late distribution, NSF count); the score is not.

---

## 6. Default + recovery workflow — the structural weakness

This is where I would refuse to write large exposure today.

### 6.1 Delinquency tracking exists; default workflow does not

`schema.ts:891-894` tracks `lastReminderSentAt`, `reminderCount`, `daysDelinquent`, and a five-state `delinquencyStatus` (current → early_delinquent → delinquent → seriously_delinquent → default_candidate). The reminder service (`server/services/ceoReminders.ts` exists) and the delinquency progression logic appear to fire on a cron. That is the *front* of the funnel.

The *back* of the funnel — what happens after default_candidate — is not in this codebase. I searched for "foreclosure," "notice_of_default," "trustee_sale," "redemption," "REO," "deed_in_lieu." No services. The `notes.status` enum includes `defaulted` and `foreclosed` (`schema.ts:851`) but there is no workflow that gets the loan from `default_candidate` to `defaulted` to `foreclosed` and there is no document generation for any of the recovery-side instruments.

This is the gap. A hard-money book lives or dies on recovery time. Texas is a 21-day non-judicial process; Florida is a 6–14 month judicial process; New Mexico has redemption rights I have to track to the day. None of that is in the platform.

**Required for a real default workflow:**

1. **Notice of Default generation** — state-specific template, per-state cure period, per-state acceleration language. Marguerite §3 (`elite-team-deep-2026-05-01/marguerite-esign.md`) catalogues the per-state document config gap; it bites here too.
2. **Cure-tracking ledger** — borrower partial cure should reset clock with explicit attorney sign-off, not silently.
3. **Substitute Trustee / Trustee Sale documents** for non-judicial states.
4. **Reinstatement quote** that distinguishes from payoff quote (different legal effect, different rounding, different fee set).
5. **Foreclosure timeline tracker** with state-specific milestone alerts ("New Mexico redemption period expires in 9 days").
6. **Post-foreclosure REO record** — once the lender takes the parcel back, it transitions from `notes` to `properties` in the lender's org, with carrying-cost tracking (taxes, insurance, weed abatement) and the AVM gets re-run for disposition pricing.

### 6.2 Document immutability — Marguerite's finding bites lenders too

Per Cordelia §4.1 and Marguerite §5: `storage.updateGeneratedDocument` accepts content edits to signed documents with no status guard, no document_content_hash on the signature row. **For a hard-money lender this is a wholesale-amount problem.** When I file foreclosure and produce the signed deed of trust, the borrower's defense lawyer will ask whether the document could have been altered post-sign. If the answer is yes — and today it is yes — my lien instrument is impeachable on its face. I cannot afford that on a $180K position. **I would require, before writing any loan with AcreOS-generated documents: status-locked signed instruments, content-hash on signature row, append-only document version history.** This is non-negotiable for me.

### 6.3 Borrower communications during default — TCPA / FDCPA exposure runs to the lender

The dunning service (`dunning.ts`) is for the *AcreOS subscription billing* of the Land Investor, not for borrower payment dunning on the underlying loan. Borrower-facing reminders use `paymentReminders` (`schema.ts:975+`). When those reminders cross from "friendly nudge" to "this is an attempt to collect a debt and any information obtained will be used for that purpose," **FDCPA mini-Miranda is required.** I cannot find the mini-Miranda language in the reminder templates. If the AcreOS-using lender (me) is treated as a debt collector under state law — and several states define this broadly — the missing language is per-message statutory damages under FDCPA. Cordelia §2.3 priced TCPA exposure at $500–$1,500/call; FDCPA is comparable. **I want a "default communications" mode on the reminder service that auto-injects mini-Miranda once a loan crosses 30+ days delinquent.**

---

## 7. Items I require closed before raising my exposure beyond pilot

Ranked by my willingness to wait.

1. **Document immutability + content hash** (§6.2) — disqualifier. No more lending against AcreOS-generated DOTs until shipped.
2. **State-specific default workflow** (§6.1) — disqualifier above $50K loan amount.
3. **AVM confidence floor + comp-availability flag** (§2.2, §3.1) — required before I lend in any new county.
4. **Lender role + cross-org dashboard** (§4) — required before I scale past 5 active AcreOS-using borrowers.
5. **Re-AVM cadence + valuation history table** (§3.2) — required for any loan over 12 months.
6. **FDCPA mini-Miranda in reminder templates** (§6.3) — required for any loan that goes 30+ days late.
7. **Lender-view underwriting export with LTV/DSCR/debt yield** (§2.1) — quality of life; would close before raising my origination ceiling.
8. **NACHA file + 1098 generation** (§5.2) — quality of life, but blocking for any larger lender than me.
9. **Per-state credit-rating model with real transition matrix** (§3.3) — blocking for any "AcreOS-rated pool" claim.
10. **Post-recovery AVM accuracy report** (§3.1) — quality of life; sharpens my pricing.

---

## 8. Verdict at the desk

AcreOS is the most evidence-rich platform I have ever underwritten counterparty risk against in the Land Investor space. The audit trail (per Cordelia §3) is real. The borrower portal is real. The LTV monitor is real. The AVM feedback loop is real and rare.

The gaps are concentrated in two places: **post-sign document mutability** and **post-default workflow.** Both are existential for a hard-money book. Both are fixable in a quarter of focused engineering — they are not architecture problems, they are missing-feature problems, and the underlying schema (`notes.status` includes `foreclosed`, signature rows exist, audit_log exists) is already shaped correctly to absorb the fixes.

I would pilot at $500K of exposure today. I would commit $5M after items 1–4 ship. I would not commit my full book to a single platform under any circumstances — concentration risk is concentration risk regardless of platform quality — but a 30–40% allocation to AcreOS-originated paper is achievable inside two quarters of platform work.

— Octavia

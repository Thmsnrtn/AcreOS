# Preston Arrington — AcreOS through the limited-partner lens

I'm Preston. Fifty-six. Atlanta. I sold a regional HVAC distribution business in 2019 for figures that don't matter except as the reason a private banker introduced me to Rashad Iverson three years ago. I've been an LP in Iverson Land Partners GP I for $750K since the 2023 vintage and committed another $1.25M to Fund II that's deploying now. I sit on no advisory committee — I'm a passive money LP. I get a quarterly statement, an annual K-1, a Form D copy when they file, and a phone call from Rashad when something interesting happens. I'm one of twenty LPs in his fund. Wave 3 audit, LP lens.

My question is narrow and unsentimental: **if Rashad starts producing my reports out of AcreOS instead of out of his analyst's Excel, do I trust them enough to keep my money in the fund and to write the Fund II second-tranche check that's due in September?**

---

## 1. Thirty-second verdict

If Rashad migrated to AcreOS today and my Q2 2026 statement arrived as an AcreOS-generated PDF, I would call him within an hour and ask three questions: who is auditing this software, where is my capital account stored, and can I see the underlying note ledger that produced the distribution number. AcreOS would fail all three questions because **AcreOS has no LP-facing artifact at all today**. There is no LP portal, no NAV calculation, no per-LP capital account, no distribution-allocation engine, no K-1 module, no audit packet. What AcreOS *has* is a borrower portal (`client/src/pages/borrower-portal.tsx` — that's the people paying Rashad's notes, the opposite of me) and an investor *directory* (`client/src/pages/investor-directory.tsx` — outside deal partners, not LPs of a closed fund). Rashad's read on this is right: vocabulary without plumbing.

So if my next statement comes from AcreOS, my honest answer is I redeem at the next gate and I do not write the September check. That's not because AcreOS is bad — it's because there is nothing for me to evaluate. The plumbing for everything an LP cares about is absent.

---

## 2. The five things an LP reads on a statement

When Mrs. Henderson and I open our quarterly PDFs, we look at the same five lines in the same order every time. I'm going to go through what AcreOS produces against each.

**Line 1 — Capital account balance, beginning and ending.** This is the single most-important number on an LP statement. Beginning balance + contributions - distributions + allocated income/loss + unrealized gain/loss = ending balance. It needs to tie to the §704(b) book on the K-1 in April. AcreOS has *no capital account ledger*. There is no `lp_capital_accounts` table. The only investor-side primitives are `investorProfiles` (a CRM record — name, bio, specialties — `shared/schema.ts:9134`) and `capitalRaises` (an offering record — `shared/schema.ts:9609`). Neither holds a balance. My beginning and ending balance simply does not exist as data in this system. **Fail.**

**Line 2 — Period contributions and distributions.** If Rashad called $100K from me on April 15 and distributed $18K on May 28, those two events should appear with date, amount, and reference (which call, which distribution batch). AcreOS has no `capital_calls` table, no `capital_call_responses` table, no `distributions` table. The contribution side would have to be reconstructed from a bank-statement screenshot; the distribution side from Rashad's Excel waterfall. AcreOS contributes nothing. **Fail.**

**Line 3 — NAV per unit / fund-level NAV with my pro-rata.** For a land-note fund, NAV is ugly: each note has a face balance, an amortization curve, a delinquency state, an impairment haircut, and (if the borrower's been paying clean for 18 months) potentially an upward mark. The fund total minus accrued GP carry minus expense reserve = NAV. My pro-rata of NAV is what I report on my personal balance sheet to my CPA. AcreOS has solid note-level tracking (`noteSecurities` at `shared/schema.ts:9528` with payment history, current balance, status) — that is the *raw material* for a NAV. But there is no NAV computation, no impairment policy, no mark-to-model engine, no rollup from notes → fund → LP pro-rata. The data is there; the math is not. **Fail with a path forward.**

**Line 4 — Distribution detail (return-of-capital vs preferred return vs profit allocation).** When I get $18K, I need to know how much is return of capital (reduces my basis, not taxable now), how much is preferred return paid (taxable as it characterizes), and how much is profit share above pref. The waterfall logic for our fund is American — 8% pref, 100% RoC, then 80/20 carry. AcreOS has zero waterfall code. Rashad confirmed it: Excel. The LP gets a number; the LP cannot see how the number was derived. For the LP that means *I trust Rashad, not the software*, which is fine for a $750K personal allocation but not for an institutional LP doing diligence. **Fail.**

**Line 5 — Fee detail.** Management fee (we pay 2% on committed during investment period, then on invested), fund expenses (audit, legal, admin, K-1 prep), and any GP-affiliate fees (origination fee on note purchases, servicing fee). LPACs are sensitive to fee creep. AcreOS has no fee accrual ledger. There is no `fund_fees` table. The bookkeeping module (`server/services/bookkeeping.ts`) is built around 1099-INT generation for note borrowers — that's again the wrong end of the pipe. **Fail.**

Five for five missed. Not a single line of an LP statement is generable from AcreOS today.

A side observation on what *could* be on the statement and isn't on most LPs' radars but should be: **uncalled commitment**. Of my $1.25M Fund II commitment, Rashad has called $300K so far. My uncalled balance ($950K) is an off-balance-sheet contingent liability that affects how much short-duration cash I keep liquid. Most quarterly statements bury this in a footnote; the better ones surface it as a tile. AcreOS, having no commitment ledger at all, cannot surface it anywhere — but if the schema work happens, this is a near-free win for the LP portal and the kind of detail that signals "the platform is built by people who know what LPs actually want to see."

---

## 3. K-1 timeliness and accuracy — the annual reckoning

K-1 quality is the test that matters most for LPs once a year. My personal return is on extension every year because Rashad's K-1s arrive in early September after the September-15 partnership deadline, which means my 1040 goes on extension to October 15. Every land-fund LP I know is in the same boat. K-1 quality has two dimensions: timeliness (did it arrive before September 15?) and accuracy (did the §704(b) capital-account roll-forward tie? did the box allocations match prior years' methodology? did the depletion pass-through get the right tax-basis treatment?).

AcreOS does **not** generate K-1s at all. Rashad called this out and his read is correct — there is no partnership-tax allocation logic, no §704(b) capital account, no §752 debt allocation (which matters for our fund because we use a small note pledge against the portfolio), no §704(c) built-in-gain handling for LPs who contributed property in-kind (we have one — Mrs. Halloway brought in two hunting tracts), and no Schedule K-1 PDF emission. My K-1 will come from Rashad's CPA's Lacerte instance regardless of what AcreOS does. For me as LP that's fine in 2026 — but it means **AcreOS is invisible at the moment of highest-stakes LP-GP interaction**. I form my opinion of the fund's operational quality from my K-1 and from my September phone call. AcreOS does not appear in either.

The narrower question — could AcreOS feed Rashad's CPA the right *trial balance* and per-LP allocations so the CPA's K-1 prep is faster? Today no, because there is no capital-account ledger to feed. If Rashad ever wants to pull K-1 prep into AcreOS, the prerequisite is the §704(b) capital-account work. That's six to nine engineer-months as Rashad estimated, and it has to be audited against three reference partnerships with known K-1 outputs before any LP touches it.

I'll add the LP-specific accuracy concern around state K-1s. Iverson Land Partners holds notes secured by land in Texas, Louisiana, and a small Oklahoma sleeve. As a Georgia-resident LP I file composite returns or non-resident returns in each of those states — the partnership issues *state* K-1s alongside the federal Schedule K-1. Texas has no individual income tax (the franchise tax is at fund level), Louisiana wants its non-resident return, Oklahoma wants its share. The state K-1 footwork is the most error-prone part of the annual cycle for me. A fund-OS that gets *federal* K-1 right but doesn't think about state apportionment is half a system. AcreOS shows no awareness of this in the schema — there is no state-level allocation primitive — so even the long-term roadmap needs to account for state K-1 generation, not just Schedule K-1.

The danger of a half-built K-1 module is significant. If AcreOS ships K-1 generation that gets one box wrong — say it puts ordinary note interest into Box 5 (interest income) when it should split between Box 1 (ordinary trade-or-business if the fund is a dealer) and Box 5 (if it's an investor) — I file a wrong 1040. The IRS does not care that my GP's software vendor erred; they care that I underreported. The LP-side liability of a buggy K-1 module is *the LP*, which means trust in the software has to be earned before any LP accepts a K-1 stamped "generated by AcreOS." That trust is built by audit, by SOC-2, by a fund administrator's signoff — none of which AcreOS has today.

---

## 4. Audit confidence — what would a Big-4-equivalent auditor find?

Our fund is audited by a regional Houston firm that costs Rashad $42K a year. The audit deliverable list Rashad described — trial balance, capital-account roll-forward per LP, distribution history, valuation memos, sub-doc copies, side letters, AML/KYC files, Form D filings, board minutes — is the standard Big-4-equivalent ask for any fund. As an LP I read the audited financial statement front-to-back when it arrives in May; I'm looking for clean opinions, no going-concern, no material weakness comment, and reasonable Level 3 fair-value disclosures on the note book.

AcreOS would fail an audit walkthrough on three fronts. First, **persistence**: the verification service stores its data in an in-memory `Map` (`server/services/investorVerification.ts:12`). An auditor doing IT general controls testing would flag this in the first hour and write a material-weakness comment. Second, **segregation of duties**: I see no evidence of maker-checker controls on financial data — no second-approval workflow on a distribution payout, no review-and-release on a capital-call notice. Third, **audit trail**: the `investorVerificationHistory` table exists (`shared/schema.ts:10259`) but the service ignores it; there is no equivalent history table for the financial events that don't yet exist (calls, distributions, fee accruals).

For an LP, the audit opinion is the single most-important annual artifact after the K-1. If AcreOS replaces components of the fund's books-and-records and the audit opinion comes back qualified, that is a redemption-trigger for me and a mass-redemption-trigger for Rashad's bigger LPs. Rashad cannot afford to migrate any audit-relevant ledger into AcreOS until AcreOS has SOC-2 Type II at minimum.

A more-specific LP concern on the audit dimension: **the fair-value memo for each note position**. Land notes are Level 3 assets — there is no observable market price; the fair value is a model output (discounted cash flow with assumptions about prepayment, default, and recovery). Auditors challenge the assumptions every year. The audit memo names the LP-cohort-blended discount rate, the prepay assumption (we use 8% CPR), the loss-given-default assumption (we use 35% LGD), and the back-test against actual prior-year recoveries. AcreOS's `noteSecurities` table tracks current balance and payment history — it does not track impairment marks, fair-value model outputs, or the assumption set used at each valuation date. For the auditor, this means AcreOS data has to be augmented manually before it becomes audit-grade. For me as LP, it means the NAV in any AcreOS-generated statement would be a *book* number, not a *fair-value* number, and the gap between the two is exactly what the auditor exists to police. Until AcreOS has an impairment/fair-value module, an AcreOS NAV is an unaudited book number — and an unaudited book number on an LP statement is a regulatory problem, not just a feature gap.

---

## 5. Transparency — can I see the underlying notes?

This is the test that separates a good fund-OS from a glorified PDF generator. I should be able to log into a portal and see, at minimum: the list of notes the fund holds, each note's current performing/non-performing status, the borrower's payment history at a coarse level (current, 30, 60, 90+), and the unpaid principal balance. I should not see borrower PII — that's a privacy line — but I should see enough to form my own view on portfolio quality without taking Rashad's narrative on faith.

AcreOS has the *raw* data for this. `noteSecurities` (`shared/schema.ts:9528`) tracks individual notes with payment history. The schema even contemplates investor relationships through `investorProfiles`. What's missing is the *projection layer* that maps "Preston has 2.5% of fund NAV" onto the note book and shows me my pro-rata view. There is no LP portal route, no LP authentication scope, no read-only-investor permission tier in the access control layer that I can find. Rashad's permission model is operator-vs-founder; LP is not a recognized actor.

This is one of the easier gaps to close *if the fund-vehicle and capital-account schema work happens first*. The note-detail UI exists; it just needs a permission gate that says "this LP sees aggregated portfolio metrics without borrower PII" and a portal layout that puts those metrics in front of them. That's two engineer-weeks once the upstream schema is in place. But the upstream schema is not in place.

---

## 6. Capital-call mechanics from the LP side

When Rashad calls capital, my experience is: an email arrives with the call notice (PDF), instructions to wire by a date certain, an amount that should match my pro-rata of committed-and-uncalled, and a reference to the offering documents. I wire from JPMC; I email Rashad's analyst a confirmation; the analyst emails back acknowledging receipt within a day. That's the workflow. Done four times a year.

AcreOS replaces zero steps of that workflow today. No call-notice template, no LP-pro-rata math against committed capital (because committed capital isn't a tracked field on any LP record — `investorProfiles` doesn't even have a `committed_capital` column on the fund side, since "fund" isn't a concept), no portal where I can see my call history, no wire-instruction storage, no acknowledgment workflow. If Rashad migrated to AcreOS for capital calls he'd be downgrading from his current state.

The two LP-side asks beyond pure mechanics: (1) **read receipts on call notices** — I want to know Rashad knows I've seen the call, because the 14-day cure clock starts at notice and I do not want to argue about whether I received the email; (2) **a running uncalled-capital balance** — at any given moment I should be able to see my committed minus called minus pending-call, because that drives my personal cash planning. Neither exists.

If AcreOS ever builds capital calls, the read-receipt + acknowledgment loop is what would distinguish it from the email-and-Excel status quo. That's not a fancy feature — it's what an LP actually wants — and it's the kind of thing that earns trust because it removes a recurring source of LP-GP friction.

---

## 7. Side letters — the silent risk to me personally

I do not have a side letter. The Dallas tax attorney Rashad mentioned does — 10% pref instead of our 8%, plus pro-rata rights on Fund II. Side letters are how senior LPs negotiate better economics, and the rest of us live with the dilution. As a non-side-letter LP, my exposure is that the GP **forgets** about the side letter and accidentally over-distributes to me on the 8% pref tier when the attorney should have been paid first at 10%. When the GP discovers the error six months later, my over-distribution gets clawed back. I do not enjoy that phone call.

AcreOS has no side-letter module. There is no flag on an LP record that says "see side letter PDF, sections 2.1 and 4.3 modify pref and pro-rata rights." If Rashad migrated to AcreOS and his analyst forgot to reproduce the side-letter overrides in the (also-nonexistent) waterfall engine, my distribution gets restated. **For an LP, side-letter handling is the silent third rail Rashad named, and AcreOS not having it is a structural risk to my returns.**

This is the kind of feature that has to ship *with* the waterfall engine, not after. A waterfall without side-letter overrides is worse than no waterfall, because it produces mathematically clean numbers that are economically wrong.

---

## 8. The four-quadrant trust framework

I think about software that touches my money in a 2x2: **does the math**, **shows the math**, **audited**, **insured**. AcreOS scores:

- **Does the math** — No. The waterfall, capital-account, and K-1 math doesn't exist. Note-level math is solid but not aggregated.
- **Shows the math** — No. There is no LP-facing surface and no audit trail on financial events.
- **Audited** — No. No SOC-2 evidence, in-memory verification storage that would fail any IT-general-controls walkthrough, no fund-administrator partnership signal.
- **Insured** — Unknown. I see no E&O policy disclosure for software-driven financial outputs. For a fund-admin role, GPs typically demand at least $5M E&O on the platform.

A four-zero score is fine for a CRM. It is a non-starter for anything that touches my capital account. The minimum for me to take an AcreOS-generated statement seriously is two of four (math + shown), and the minimum to accept an AcreOS-generated K-1 is all four. We are nowhere near that today.

---

## 9. What I'd tell Rashad on a call

If Rashad called me tomorrow to say "I'm thinking of migrating LP reporting to AcreOS," my response, plainly: don't, not yet. The CRM piece may be useful to you on the deal-pipeline side — you described the underwriting tools as good, the parcel page as strong, and the note ledger as solid. Use AcreOS for what it does well. Keep AppFolio IM Lite (or whatever the IM platform is — I as LP don't know its name, and that's *good*; the back-office should be invisible) for capital accounts, calls, distributions, and the LP portal. Keep your CPA on Lacerte for K-1s. Do not let AcreOS produce a single artifact that ends up in my mailbox until Thomas has shipped the waterfall engine, the capital-account ledger, and a SOC-2 Type II report — and even then, demand a parallel-run quarter where AcreOS numbers and Excel numbers tie before AcreOS-only output goes to LPs.

If Thomas builds it right and ships the §5 module list Rashad enumerated, I'd happily get my Q1 2027 statement out of AcreOS. The software question is solvable. Today's answer is just "not yet, and not close."

---

## 10. The fee-detail audit — what I'd want line-itemed

Beyond the headline NAV and distribution, my CPA pulls my K-1 and statement apart looking for fee creep. The line items I want broken out, that AcreOS today cannot produce because there is no fee accrual ledger:

- **Management fee** — 2% on committed during investment period (years 1-3) stepping down to 2% on invested-and-unreturned thereafter. The step-down is the contentious moment; a half-built fee module that doesn't model it correctly over-charges me by ~40 bps a year.
- **Fund-level expenses** — audit, legal, K-1 prep, fund-admin platform, D&O insurance. Capped at 25 bps of committed in our LPA, with overage absorbed by the GP. If AcreOS doesn't track the cap, the GP eats it silently or worse, breaches it.
- **GP-affiliate fees** — origination fee on note purchases (1% paid to a Rashad-affiliated entity), servicing fee (50 bps annualized on UPB to another affiliate). LPACs review these every year. AcreOS has no related-party flagging in any schema I can find — `investorProfiles` has no affiliate-of-GP boolean.
- **Partnership expenses recharged to the fund** — travel, due diligence on dead deals, third-party reports. Itemized in the audit but rarely on the quarterly. A good LP portal surfaces these so the LPAC review in March isn't a surprise.

For a $30M fund the fee delta between "tracked precisely" and "tracked sloppily" is plausibly $50K-$80K a year. That money goes either to the LPs (correct) or to the GP (incorrect or fraudulent depending on intent). The fee module is not a nice-to-have; it's a fiduciary primitive.

---

## 11. Subscription-doc and KYC — the LP onboarding surface I touched

When I subscribed to Fund II in late 2025 the experience was: PDF PPM by email, DocuSign sub-doc, a separate accreditation questionnaire, and a wire to the fund's escrow account. KYC was handled by Rashad's analyst calling me to verify the wire origin and asking for a copy of my driver's license. It worked but it was bespoke. The LP-side asks here are modest: a single portal where the PPM sits, the sub-doc is signed, the accreditation questionnaire is filled, and the wire instructions are visible — with a status bar showing where in the funnel I am.

AcreOS has the verification *route* (`server/routes-investor-verification.ts:32`) and the verification *math* (`server/services/investorVerification.ts:179`), but as Rashad and I both noted, the persistence is in-memory and the document upload is a stub. Beyond that, there is no PPM-storage primitive, no e-signature integration on the sub-doc side (DocuSign or AcreOS native — Thomas's native e-sign stack is mentioned elsewhere but I see no LP-document workflow built on top of it), and no escrow-instruction surface. As an LP the friction was tolerable in 2025 because Rashad's analyst hand-held me. At Fund III with 40 LPs that doesn't scale, and the LP experience starts feeling sloppy in a way that gets remarked on at LP-network dinners.

---

## 12. The four-quadrant trust framework, revisited

I named **does the math / shows the math / audited / insured** earlier. The corollary is: each quadrant has a minimum viable shipping bar. Math has to be parallel-run for at least two quarters against the legacy Excel before any LP-facing output. Showing the math means a per-distribution audit drawer where I click into the $18K and see the waterfall steps that produced it. Audited means SOC-2 Type II at minimum and ideally a fund-administrator partnership (Juniper, Stone Coast, Standish — pick one) that signs off on the AcreOS output. Insured means a real E&O policy with the fund as additional insured, not a vendor disclaimer. Until all four quadrants clear their bars, AcreOS is not on my LP statement.

The order matters. Shipping "does the math" without "shows the math" is worse than shipping nothing — it produces an opaque number. Shipping both without audit is worse than shipping nothing — it produces a number nobody can verify. Audit without insurance leaves the LP holding the bag if the math is wrong. The full stack has to ship together or the LP-facing surface should not turn on at all.

---

## 13. The Fund II second-tranche question

Bottom line for me personally: my September Fund II tranche check is $625K. Rashad's operational quality is one of the three things that determines whether I write it (the other two are the deal pipeline, which is excellent, and the macro on land notes, which is fine). If between now and September Rashad sends me a Q2 statement out of AcreOS, my September check does not happen — not because AcreOS is broken specifically but because a fund changing its reporting infrastructure mid-deployment is a yellow flag and changing it to immature infrastructure is a red flag. If Rashad sends me a Q2 statement out of AppFolio IM Lite (his current platform) with a footnote saying "we are evaluating a migration to AcreOS for 2027," that is fine and I write the check.

The asymmetry matters: AcreOS gains nothing by being in front of LPs prematurely and loses LP trust permanently if it produces one wrong number. Stay invisible to LPs until the math is shipped, audited, and parallel-run. That is the LP-side advice for the AcreOS roadmap.

One last LP-network observation. I sit in three LP cohorts beyond Iverson — a multifamily syndicate, a private credit fund, and an ag-land fund out of Iowa. All three migrated their LP reporting to a fund-admin platform between 2021 and 2024, and each migration was preceded by a *six-month parallel run* where the LP got the legacy PDF and the new portal output side-by-side. In every case, at least one quarter surfaced a numerical disagreement that took two weeks to reconcile. That is the playbook AcreOS will need to follow if it wants to enter the LP-facing layer: ship, parallel-run for two quarters minimum, reconcile, then go LP-only. There are no shortcuts here that LPs will tolerate.

— Preston Arrington

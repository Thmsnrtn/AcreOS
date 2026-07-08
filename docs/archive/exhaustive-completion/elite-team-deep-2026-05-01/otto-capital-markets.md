# Otto Riedler — Capital Markets Audit

**Persona:** Otto Riedler, 58, Charlotte NC. 25 years on Wall Street (M&A debt desk, then a structured-credit shop). Now run **Pinehurst Note Partners** — a fund-of-notes that buys seller-financed mortgage and land-contract pools at $5M–$50M, restructures them, and sells tranches to family offices and a couple of small insurance reinsurers.
**Stack:** Excel (eight macro-heavy workbooks I will die before I give up), Salesforce CRM (LP relationship system of record), Box (deal rooms with watermarking), DocuSign for sub docs, Bloomberg for benchmark curves, KPMG-built waterfall models in VBA.
**Reviewing:** AcreOS `/capital-markets`, `/finance`, `/portfolio`, `/money`. Tour conducted 30 April 2026.

---

## 1. Thirty-Second Verdict — Not a Fit. But Almost Interesting.

Not a fit. Not today, not at this build.

What I am looking at is a retail-investor screen with the words "securitization," "tranche," and "AAA" glued onto the buttons. The /capital-markets page is a four-tab dashboard — Securities, Lender Network, Capital Raises, Match Lenders, Securitize Notes — plus a four-step "Securitization Wizard" that lets you paste comma-separated note IDs into a text box, pick **one** tranche from a dropdown ("senior / mezzanine / equity"), pick **one** internal credit rating from a dropdown ("AAA/AA/A/BBB"), and click **Launch offering**. A toast appears that says "Your offering has been submitted for review."

No it hasn't. There is no offering. There is no reviewer. There is no PPM, no sub doc, no Form D, no accreditation gate, no waterfall, no pool cut file, no servicer report, no trustee. There is a toast.

That said — and this is why I am writing more than three lines — the **underlying data** AcreOS sits on, if it actually scales the originator side, is genuinely interesting to me. AcreOS is upstream of where I shop. Every land flipper running seller financing on this platform is a future origination feed for somebody like Pinehurst. If AcreOS positions itself as the **Bloomberg-of-seller-financed-paper** rather than as a fake securitization engine, I would write a check tomorrow. As built, no.

Score against my checklist: **3 / 10.** The 3 is for the data that *could* be there. The 7 missing points are everything that makes capital markets capital markets.

---

## 2. Capital-Markets Feature Gap — Item by Item

I went through `/capital-markets` with the seriousness it asked for. Here is the gap, line by line, against what a $50M pool buyer actually needs.

### 2.1 Pool-level analytics — F

The Securities tab shows me, per security:
- Total principal
- Yield (single number)
- Min investment
- Note count
- A `% subscribed` progress bar
- A rating badge (AAA/AA/A/BBB)

That is it. No **WAC** (weighted-average coupon). No **WAM** (weighted-average maturity). No **WAL** (weighted-average life under prepay assumptions). No **vintage stratification** (loans originated 2019 vs 2024 perform very differently). No **geographic concentration** (am I 60% Texas? 80% Florida? Critical for hurricane risk.). No **FICO band distribution**, no **LTV stratification** at origination vs current, no **DTI** distribution, no **delinquency bucket** (current / 30 / 60 / 90+ / FC / REO), no **CDR** (conditional default rate), no **CPR** (conditional prepayment rate), no **roll rates** (30→60, 60→90 transition matrix). No **lien position** disclosure. No **first-payment-default** flag rate.

A serious pool-buyer screen needs all of the above on the **first card**. Not in a tab. Not behind a click. On the card. AcreOS gives me four numbers and a credit grade it made up itself.

### 2.2 Tranching — D

The wizard offers three tranches: senior / mezzanine / equity. You pick *one*. There is no concept of stacking them.

A real securitization has:
- A **capital stack**, not a single tranche pick — typically A1/A2/A3 senior, M1/M2 mezz, B subordinated, R residual/equity, and an IO strip if you can sell one.
- A **waterfall** — pre-default cashflow waterfall (interest first, scheduled principal, then unscheduled), and a post-default waterfall.
- **Cumulative loss triggers** that flip the waterfall sequential.
- **Overcollateralization** targets and step-down dates.
- **Reserve account** mechanics (cash trap, target, release).
- **Coupon step-ups** if optional redemption isn't exercised.
- **Pro-rata vs sequential** pay logic with **principal-distribution-amount** calculations.

AcreOS doesn't model any of this. It has a literal `Select` HTML element with three `SelectItem`s. I respect the ambition of the noun "Tranche type" but the underlying data model is `tranche: "senior" | "mezzanine" | "equity"` — a single string. Not a structure.

### 2.3 Credit ratings — C-

You can self-assign AAA/AA/A/BBB from a dropdown.

I cannot stress this strongly enough: **rating agencies exist for a reason**. You cannot pin AAA on a pool yourself and ship it to LPs. That is securities fraud. AcreOS needs to either:

1. Drop the letters entirely and call it "internal risk grade 1–5" — fine, useful, defensible.
2. Or wire to a real third-party rating provider (KBRA, DBRS-Morningstar, Egan-Jones for sub-prime). Fitch and Moody's won't touch a $5M deal but the smaller shops will.

Today the dropdown literally says **"AAA — highest quality (lowest yield)"**. A founder-customer is going to put that on a tear-sheet and end up in front of the SEC. Fix this in the next sprint or remove the field.

### 2.4 Deal rooms — F

There is no deal room. None. No file vault, no watermark, no expiring-link, no NDA gate, no per-LP access log, no version control for the latest tape vs prior tape, no "marked for redaction" flag, no Q&A thread that auditors can review.

Box has eaten this market for fifteen years. Intralinks too. iDeals. Datasite. SS&C. AcreOS doesn't even attempt it. If AcreOS wants to host a Reg D 506(c) raise — it needs a **logged, audit-trail-protected document room** with watermarked PDFs containing the LP's email burned into every page. Not a `Card` with a paragraph of body copy.

### 2.5 Cash-flow modeling / Monte Carlo — F

Zero. No prepay scenario. No default scenario. No Monte Carlo. No PSA curve, no CPR ramp, no recovery-lag assumption, no liquidation-timing-curve. No yield-to-maturity-under-stress. No stress-the-residual.

My VBA workbook runs 10,000 simulations across CPR (0–25), CDR (0–8), severity (20–60%), and recovery lag (12–36 months). It spits out a yield distribution per tranche. AcreOS shows one number — `expectedYield` — flat. That is a marketing yield. That is not a number you sell to an insurance company.

### 2.6 Note securitization (REMICs) — F

The word "REMIC" appears nowhere in the codebase that I can see. No election workflow. No prohibited-transaction tracking (REMICs have very particular rules — modify a loan wrong and you blow the trust's tax status). No two-class / multi-class election helpers. No per-quarter REMIC reporting templates. No tax-advisor handoff packet.

If you want the word "securitization" on the page, you need REMIC plumbing. Otherwise call it a "note pool offering" and move on. That alone would be more honest and probably more useful.

### 2.7 Compliance — F (with one mitigating detail)

Reg D 506(b) vs 506(c) — these are the two doors a private placement walks through. They have *very* different rules:

- **506(b)** — no general solicitation, up to 35 non-accredited "sophisticated" investors, self-certification of accreditation OK, but **you cannot advertise**. Tweeting your raise = blown exemption.
- **506(c)** — *can* generally solicit and advertise, but **every** investor must be **verified accredited** by you or a third party (ALTO, VerifyInvestor, Parallel Markets, or CPA/attorney letter). The verification has to be retained for six years.

AcreOS has *neither*. There is no:
- 506 selection at the offering level
- Accredited-investor verification flow (no third-party verifier integration, no income/networth attestation, no CPA-letter upload, no retention vault)
- "Bad actor" Rule 506(d) attestation
- Form D filing helper (or even a reminder)
- Blue-sky filing helper (state-level notice filings — every state, $200–$500 each, due within 15 days of first sale in some states)
- Subscription document workflow (not the same as just "DocuSign a PDF" — sub docs have suitability questionnaires, W-9s, accreditation reps, FINRA-affiliation disclosures, FATCA/CRS sections)
- Investor-eligibility lock-out (a non-accredited LP must be *blocked* from clicking Subscribe on a 506(c) offering — at the database level)

**Mitigating detail:** there is a `RequiredDisclaimer type="financial"` component on the page. So somebody on the team knows compliance language exists. Good. But a banner is not a control. The banner is what you put on top of the controls. The controls are missing.

### 2.8 Pool servicing oversight — F

Nothing. There is no concept of:

- A **master servicer** vs **sub-servicer** vs **special servicer** (the three roles in any non-trivial pool)
- A monthly **CREFC IRP** equivalent (CREFC for CMBS — there's a less formal equivalent for residential / land paper but the **structure** matters: trial balance, watch-list, delinquency report, REO report, modification report)
- A **trustee** report
- A **back-up servicer** designation with a hot-or-cold spec
- **Servicer advance** tracking (P&I advance, T&I advance, corporate advance) and recoverability tests
- **Servicer compliance** attestation (Reg AB II compliance reports)

If AcreOS wants to be the system-of-record for a securitized pool, it has to be the system that the master servicer reports *into*, with read-only investor access. That's a full back-office build. Today /capital-markets isn't even the front of that; it's a screensaver.

### 2.9 The "Lender Network" tab — wrong product, wrong page

This tab matches *originators looking for capital* with *lenders willing to lend*. It is a transactional **debt-shop** screen. It does not belong on a capital-markets page. It belongs in `/finance` or in a dedicated `/capital-stack` workflow for an investor on the buy side of a single deal. Putting it next to "Securitization wizard" muddles two completely different audiences:

- The note flipper looking for a hard-money loan to close their own land deal
- The fund manager looking to package 200 notes into a pool

Those are different humans. They should not share tabs.

**Recommendation:** Lender Network and Match Lenders → move to `/finance`. Securities, Capital Raises, Securitization → keep on `/capital-markets`. Then build out Securities into the things I listed in §2.1.

---

## 3. The Compliance / Accreditation Question — The Single Biggest Bug

I want to spend a section on this because it is the single biggest legal exposure in the platform today, and it is genuinely fixable in 4–6 weeks.

**The bug:** AcreOS lets a customer "launch a securitization offering" via a four-step wizard with no accreditation check, no Reg D selection, no investor-suitability gate, no document room, and no Form D reminder. And then it shows the offering on a page (Securities tab) where presumably another user could click Subscribe.

**The legal landscape (short version):**
- Selling unregistered securities to non-accredited people you didn't pre-screen is a federal felony.
- "I didn't know they weren't accredited" is not a defense under 506(c).
- "I checked a box that said they were accredited" *is* a defense under 506(b) — but only if you weren't generally soliciting. Putting the offering on a public-internet page with a `Subscribe` button is general solicitation.
- The platform — AcreOS — can be on the hook as a **statutory underwriter** if it's deemed to be participating in the distribution. Section 4(a)(2) is narrow.

**What the page must do before this can ship to a real customer:**

1. **Offering-creation wizard must force a Reg D election.** 506(b) or 506(c). No third option. This drives every downstream gate.
2. **Investor onboarding must include accreditation verification.** For 506(c), wire to VerifyInvestor.com, Parallel Markets, or build CPA-letter upload + retention. For 506(b), require an investor questionnaire with attestation language and store it for 6 years.
3. **Subscription gate at the database level.** If `offering.regulation = "506c"` AND `investor.accredited_verified_at IS NULL`, the Subscribe action returns 403 with `Errors.forbidden(res, "Investor accreditation not verified for 506(c) offering")`. Server-side. Not just hidden in the UI.
4. **Form D filing helper.** Pre-populate from offering data. Remind 14 days after first sale. Warn 13 days after. Block new sales 16+ days after if unfiled.
5. **Bad-actor 506(d) check** at the issuer level — checkbox, attestation, retention.
6. **Blue-sky** state filing reminders driven by investor location.
7. **Watermarked, expiring-link document room** (see §2.4).

I would do all of this **before** I'd touch any of the analytics in §2.1. Analytics make the product better. Compliance keeps the product *legal*. One of those is more urgent.

---

## 4. The "AcreOS as Data Feed" Opportunity — The Real Wedge

Now the interesting part. Forget — for one section — that /capital-markets is half-built. Let me tell you what I would actually pay for.

I run a fund. I need to source paper. Today I source paper through:

1. **Originator relationships** — five to seven origination shops I've built relationships with over the years. Each one emails me a tape (Excel) once a quarter with their most recent originations. I price it, we negotiate, I buy a strip.
2. **Trade groups** — National Note Buyers Association, a couple of land-investor mastermind groups. These are slow.
3. **Brokers** — fine, but they take 50–100bps of yield.
4. **The trades** — Asset Backed Alert, ABS-East conferences. Mostly noise.

What I would pay $1K–$3K/month for, **today**, no hesitation:

**A live, anonymized, pool-level data feed of every seller-financed note originated on AcreOS.** Specifically:

- Origination volume per month, by state, by property type (raw land, ag, residential, commercial)
- Loan-level (anonymized) stratifications: principal, coupon, term, LTV at origination, FICO band, DTI band, lien position, geography (county-level, anonymized to ZIP-3)
- Performance data: 30/60/90/FC/REO bucket distributions, vintage curves, prepay curves
- Macro overlays: median coupon trend by month, severity assumptions vs actuals
- A **"for sale"** view: originators on AcreOS who have signaled willingness to sell pools, with size range and target yield

This is **Bloomberg for retail land paper.** Nobody publishes this data. CoreLogic / Black Knight don't touch it. It's invisible. AcreOS, sitting on N originator workflows, has a one-of-one data set within ~24 months of scale.

Pricing tiers I'd accept:
- **Observer** — $500/mo — read-only, market-level (no loan-level)
- **Buyer** — $2,500/mo — loan-level anonymized, originator-introduction request feature
- **Strategic** — $7,500/mo — pre-negotiated right of first look on pools above $X size, white-glove originator introductions

I would put my fund on the $2,500/mo tier *next quarter* if AcreOS shipped this. Pinehurst alone is one customer. There are 40–60 funds like mine, plus another 200–400 family-office direct buyers. That is a $1M–$5M ARR line-item AcreOS is leaving on the table.

**This is a bigger business than the securitization wizard will ever be.** The wizard is a feature. The data feed is a moat.

---

## 5. Pricing — Would I Pay $1K/mo?

Today, for what's on the screen: **No.** Not $1K, not $100. It's a demo.

If AcreOS shipped:
1. Real pool analytics (§2.1)
2. Real Reg D compliance (§3)
3. The data feed (§4 — Buyer tier)
4. Watermarked deal rooms (§2.4)

…then yes, I would pay **$2,500/mo for a single seat** and another **$1,000/seat/mo** for analyst seats. Pinehurst would budget $5K–$8K/mo. We currently spend more than that on Bloomberg ($2,400/mo/seat × 3 seats = $7,200) and that doesn't even *try* to give us land paper.

The number I'd resist past is **$15K/mo**. At that level I'd want a phone-a-friend SLA, a named CSM, my data physically segregated, and a SOC 2 Type II that says "we audited the data segregation." That's an enterprise contract. AcreOS isn't ready for that conversation but should plan for it.

**What I would NOT pay for:** the current $1K/mo "Capital Markets" SKU (if such a thing existed — I don't see it priced anywhere, so this is hypothetical). The page does not justify retail pricing, let alone institutional.

---

## 6. The Deal-Killer

One deal-killer above the others, and it's the one I keep coming back to:

**The credit-rating dropdown.**

A platform that lets a customer self-assign "AAA — highest quality" to a pool of land contracts and ship that label to investors is a platform I cannot recommend to my LPs, my compliance officer, my GC, or my fund admin. It will be the line in our IPS that says **"the fund shall not transact through any platform that allows issuer-self-rating of securities."**

The fix is a one-line code change. Replace the four `SelectItem`s with five: `1 — lowest risk` through `5 — highest risk`. Add a tooltip: *"Internal risk grade. Not a third-party credit rating. Investors should perform independent diligence."*

That's it. That single change moves AcreOS from "I cannot use this" to "I can't use this **yet**, but it's not actively dangerous." It's a 20-minute pull request. It's the highest-leverage 20 minutes anyone on this team will spend this quarter.

After that, build §3 (compliance), then §4 (data feed), then §2.1 (real pool analytics). In that order.

I'm rooting for you. The data you sit on is genuinely unique, the seller-financed-paper market is genuinely under-served by software, and the buyer demand on the institutional side is genuinely there. Don't blow it on a four-step wizard with a `Launch offering` button that does nothing. Build the boring infrastructure first. The wizards come last.

— Otto Riedler
Pinehurst Note Partners, LLC
Charlotte, NC

---

## Appendix A — Files reviewed
- `/Users/user/AcreOS/AcreOS/client/src/pages/capital-markets.tsx` (the entire surface — 624 lines)
- `/Users/user/AcreOS/AcreOS/client/src/pages/money.tsx` (skimmed)
- `/Users/user/AcreOS/AcreOS/client/src/pages/portfolio-optimizer.tsx` (skimmed)
- `/Users/user/AcreOS/AcreOS/server/routes-finance.ts` (server-side surface)
- Searched server + client for: `accredited`, `Reg D`, `506(b)`, `506(c)`, `Monte Carlo`, `prepay`, `WAM`, `WAL`, `WAC`, `weighted average`, `REMIC`, `tranche`, `securitization`, `deal room`, `data room`. Hits: minimal. The word `tranche` appears only in the wizard `<SelectItem>`s.

## Appendix B — One-line fixes I'd ship this week
1. Rename the rating dropdown from "AAA/AA/A/BBB" to "Internal risk grade 1–5" with disclaimer tooltip.
2. Block the `Launch offering` button until a Reg D election (506(b)/(c)) is made on the offering.
3. Add a server-side gate on any "subscribe to security" endpoint that returns 403 if `accredited_verified_at IS NULL`.
4. Hide the Securities tab behind a feature flag until #1–#3 ship — the current state is a litigation magnet.
5. Move "Lender Network" and "Match Lenders" tabs to `/finance` where they belong.

## Appendix C — Things I want to see in the data feed v1
- Monthly origination volume × state × property type
- Loan-level anonymized strats (principal, coupon, term, LTV, FICO band, DTI band, ZIP-3)
- 30/60/90/FC/REO bucket counts per cohort per month
- Vintage prepay & default curves (rolling 24-month)
- "Originators with paper for sale" directory (opt-in by the originator)
- Daily pull, CSV + JSON, signed URL with 24h TTL
- API: `GET /api/datafeed/v1/cuts?as_of=YYYY-MM-DD` returning the cut tape

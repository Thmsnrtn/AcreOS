# AcreOS — Launch Legal & Peace-of-Mind Readiness Checklist

**Author:** Beatrice Whitfield (Chief Risk Officer) + Lena (CFO/CIO)
**For:** Tom Norton, Founder/CEO
**Date:** 2026-06-06
**Status legend:** ✅ done · 🟡 needs-Tom (a decision only you can make) · 🟦 needs-vendor (lawyer / accountant / insurer / agent) · ⬜ open (we can prepare it)

---

## How to read this document

This is the single, plain-language list of every legal and operational obligation that comes with launching AcreOS to real, paying customers across the country. It exists to turn the cloud of "what am I on the hook for?" into a closed, itemized list with clear owners.

Each item answers three questions:
- **Why it matters** — what the rule protects and what goes wrong if we ignore it.
- **What to do** — the concrete next action.
- **Who owns it** — you, the team, or an outside vendor (lawyer/accountant/insurer).

**Honesty up front:** the team can *prepare* almost all of this — draft the documents, build the gates, encode the policies in code. What we **cannot** do is *be your lawyer*. Items marked 🟦 genuinely need a licensed professional's signature, and items marked 🟡 need a decision that is legally or financially yours alone. We will never tell you "you're covered" when the honest answer is "you're prepared, and a $200-300/hour lawyer hour would close it." Those moments are flagged explicitly.

**The bottom line you actually care about** is in Section 11 ("What you're personally on the hook for"). If you read one section, read that one.

---

## 1. Business entity, registered agent, EIN

| # | Item | Status | Owner |
|---|---|---|---|
| 1.0 | Entity-language honesty fix (remove false "AcreOS, Inc.") | ✅ | Beatrice — DONE 2026-06-06 |
| 1.1 | Form the MA LLC — **timed to just before first customer** | 🟡 (gated) | Tom — runbook ready: [[ma-llc-formation-checklist]] |
| 1.2 | Operating Agreement | 🟦 | Lawyer / formation service |
| 1.3 | EIN (federal tax ID) | ⬜ | Tom (free, IRS.gov) |
| 1.4 | Registered agent (MA resident agent) | 🟦 | Vendor (Northwest / formation service) |
| 1.5 | C-corp / Delaware conversion | 🟡 (deferred) | Tom — DEFERRED per [[tahoe-h1-decisions-2026-06-06]] |

**1.0 — Entity-language honesty fix. ✅ DONE (Beatrice, 2026-06-06).**
- *What was wrong:* The ToS, Privacy Policy, DPA, and landing footer all claimed "AcreOS, Inc., a Delaware corporation" — an entity that does not exist. Claiming a non-existent entity is materially false and *weakens* the liability shield rather than strengthening it.
- *What was done:* Replaced everywhere with the truthful current status — **AcreOS is operated by Thomas Norton as a sole proprietor (Massachusetts), with a Massachusetts LLC formation pending.** Governing law / arbitration venue moved from Delaware (false) to Massachusetts (true). The entity name is now **centralized in `client/src/lib/legal-entity.ts`**, so the future LLC swap is a one-line edit (`ENTITY_STATUS: "sole-proprietor"` → `"llc"`).
- *Cost:* $0. This was the only real entity-related exposure before a customer exists, and it is now closed.

**1.1 — Form the MA LLC (timed to just before the first customer).**
- *Decision (Tom, 2026-06-06):* Form a **Massachusetts LLC**, **timed to just before the first paying customer** — not now. MA LLC costs $500 to file + $500/yr; the liability shield does nothing until there's a customer relationship that can create liability. The false entity language (the only real pre-customer exposure) is already fixed (1.0).
- *Why it matters:* Once a customer pays, the LLC is the wall between "the business got sued" and "Tom got sued." Form it the week before S13 (first customer), not the day of, so the EIN and bank account exist before money moves.
- *What to do:* Run the same-day runbook — **[[ma-llc-formation-checklist]]** (`docs/founder/ma-llc-formation-checklist.md`). It's name-check → file Certificate of Organization ($500) → free EIN → operating agreement → bank/Stripe → flip the one-line doc-string → set the annual-report reminder.
- *Who owns it:* **Tom** (organizer of record); a formation service can execute steps. **Gated: do not run until the first customer is imminent.**

**1.2 — Operating Agreement.**
- *Why it matters:* Even a single-member LLC needs one. It's what courts look at to confirm the LLC is a real, separate entity (reinforcing the liability shield — see Section 11 on "piercing the veil"). Without it, the "it's just Tom" argument gets easier for a plaintiff.
- *What to do:* Formation services include a template; have a lawyer skim it (~1 hour, ~$200-300). A single-member template is fine at this stage.
- *Who owns it:* 🟦 Vendor drafts; optionally lawyer reviews.

**1.3 — EIN.**
- *Why it matters:* Required to open a business bank account, file taxes, and put a real tax ID on Stripe and contracts. Keeps your SSN off business paperwork.
- *What to do:* Free, ~10 minutes at IRS.gov once the entity exists. (Formation services often do this for you.)
- *Who owns it:* ⬜ Tom (trivial once entity exists).

**1.4 — Registered agent.**
- *Why it matters:* Every formed entity must have an agent at a physical address to receive legal service (lawsuits, state notices). **This is also your CAN-SPAM and ToS address** — using the registered agent's commercial address instead of your home address keeps your Marlborough home address out of every marketing email and the public Terms of Service. The 2026-05-31 audit flagged the current "Marlborough, MA" reference as a founder-privacy risk; the registered agent address fixes it.
- *What to do:* Bundle with formation (~$100-125/yr). Once you have the address, it flows into three places the team has already prepped: the email footer (`emailService.ts`), ToS §20, and Privacy §16.
- *Who owns it:* 🟦 Vendor provides; team wires the address in once Tom supplies it.

**1.5 — C-corp / Delaware conversion.**
- *Status:* 🟡 **DEFERRED** by Tom's 2026-06-06 decision (D2 in [[tahoe-h1-decisions-2026-06-06]]). No entity-structure action this quarter. The QSBS 5-year clock starting later is a knowing tradeoff Tom accepted.
- *What to do:* Nothing now. Resurface only if (a) a VC conversation starts, (b) MRR crosses a phase threshold, or (c) Tom asks. **The earlier doc-mismatch concern is now resolved** (see 1.0) — the public docs no longer claim a corporate form that doesn't exist; they state the truthful sole-proprietor-with-MA-LLC-pending status.

---

## 2. Terms of Service + Privacy Policy (live + accurate)

| # | Item | Status | Owner |
|---|---|---|---|
| 2.1 | ToS v1 drafted | ✅ | Beatrice (`docs/legal/terms-of-service.md`) |
| 2.2 | Privacy Policy v1 drafted | ✅ | Beatrice (`docs/legal/privacy-policy.md`) |
| 2.3 | New ToS/Privacy rendered on live pages | 🟡 verify | Iris (per audit P2) |
| 2.4 | Sub-processor list completeness | ⬜ | Beatrice (audit gap) |
| 2.5 | Lawyer review before public reliance | 🟦 | Outside counsel |
| 2.6 | Registered-agent address substituted | 🟦 then ⬜ | Tom supplies → team wires |
| 2.7 | Deletion timeline matches constitution (7 days) | 🟡 verify | Iris/Beatrice |

**2.1 / 2.2 — Documents exist.** Strong v1 drafts of both live in `docs/legal/`. The ToS already contains the "tool not advisor" language, AI disclosure (§3), 30-day price-change notice, Delaware governing law, and a 12-month liability cap. The Privacy Policy already declares controller/processor roles and "we never sell your data."

**2.3 — Are the new docs actually live?**
- *Why it matters:* A great document in the repo protects no one if the `/terms` and `/privacy` pages still render the old, underweight March-2026 version. The audit (Surface 9 & 10) found the old pages lacked a class-action waiver, force majeure, AI disclosure, and a complete sub-processor list.
- *What to do:* Confirm `/terms` and `/privacy` render the v1 docs. **Flag:** This is Iris's surface (customer-facing pages), not Beatrice's to edit — verify it shipped. 🟡
- *Who owns it:* Iris implements; Tom/Beatrice confirm before customers sign.

**2.4 — Sub-processor list completeness (audit gap).**
- *Why it matters:* GDPR Art. 28(3)(d) and CCPA require disclosing every vendor that touches customer data. The audit found the list named only Stripe, OpenAI, Lob, Regrid — **missing Anthropic, Fly.io, Cloudflare, Mercury, Resend/AWS SES, PostHog, Twilio, Clerk.** An incomplete list is a disclosure violation and undercuts the DPA.
- *What to do:* Update the sub-processor list (the `/legal/sub-processors` page + Privacy §13) to the complete set. Keep it current as vendors change — Beatrice maintains a discipline for this.
- *Who owns it:* ⬜ Beatrice maintains the canonical list; Iris renders it.

**2.5 — Lawyer review.**
- *Why it matters:* These are good drafts written by a careful non-lawyer. Before customers rely on them in a way that could be litigated (especially the liability cap and arbitration/class-waiver clauses), one pass by licensed counsel converts "well-drafted" into "enforceable as intended."
- *What to do:* Engage ad-hoc counsel (UpCounsel / a MA business attorney, ~$150-300/hr; 2-3 hours covers ToS + Privacy + DPA). The constitution defers this to Phase 2 budget — but the liability-cap and class-waiver clauses are the highest-value hour to spend early if budget allows.
- *Who owns it:* 🟦 Outside counsel. **Tom's call on timing vs. budget.**

**2.7 — Deletion timeline.** Constitution Immutable #8 requires deletion within 7 days; the old Privacy Policy said 30. The v1 doc should say 7. Verify the live page matches the constitution (audit Surface 10, gap 1). 🟡

---

## 3. Data licensing posture (the just-merged register)

| # | Item | Status | Owner |
|---|---|---|---|
| 3.1 | Data-license register exists in code | ✅ | `server/services/providers/data-licenses.ts` |
| 3.2 | Federal sources marked redistributable (§105) | ✅ | Beatrice |
| 3.3 | County "review-required" default | ✅ | Migration 0120 columns |
| 3.4 | OSM ODbL attribution rendered | 🟡 verify | Iris/Krieger (map footer) |
| 3.5 | Public-data accuracy disclosure in Privacy/ToS | ⬜ | Beatrice |

**3.1-3.3 — The spine is in place.** The license register encodes, per source: governing license, redistributable posture, required attribution string, terms URL, and last-reviewed date. Federal sources (FEMA NFHL, USGS, USDA SSURGO/WSS, USFWS NWI, Census TIGER/ACS, BLM, EPA) are correctly marked public-domain under 17 U.S.C. §105 and redistributable. County/state portals default to **"review-required"** — meaning live-passthrough only, no bulk caching or resale — until a human reads that county's terms and flips it. This is exactly the discipline that keeps the strategy defensible.

**3.4 — OSM attribution.**
- *Why it matters:* OpenStreetMap is ODbL: it **requires** a visible "© OpenStreetMap contributors" credit wherever its data or tiles appear. Without it, shipping the map is a live license breach.
- *What to do:* Confirm the map footer renders the OSM attribution. **Flag:** the map surface (`property-map.tsx`) is a customer surface Beatrice does not edit — verify Iris/Krieger shipped the attribution line. 🟡
- *Who owns it:* Iris/Krieger implement; Beatrice confirms.

**3.5 — Public-data accuracy disclosure.** The Privacy Policy already names Regrid/skip-trace as third-party sources. Add an explicit "property data is sourced from public records and may be inaccurate or out of date; verify with the county before relying on it" line in both the Privacy Policy data-sources section and near any displayed parcel/flood/soil value. This pairs with the constitutional "tool not advisor" line (Section 4). ⬜ Beatrice.

---

## 4. The "tool, not advisor" line (no unlicensed practice)

| # | Item | Status | Owner |
|---|---|---|---|
| 4.1 | "Not a broker/lender/adviser/fiduciary" in ToS | ✅ | ToS §2, §3 |
| 4.2 | Pax fiduciary boundary in system prompts | ✅ | Constitution #12; promptRegistry |
| 4.3 | AI disclosure at first interaction (gate) | 🟡 verify | Iris (audit P1) |
| 4.4 | "Estimated" labels on Pax dollar figures | 🟡 verify | Iris/Soren (audit Surface 6) |
| 4.5 | Required-disclaimer coverage on every data surface | 🟡 verify | Iris/Krieger |

**Why this section is your core legal armor.** The single thing that keeps you out of the most expensive categories of liability — practicing law without a license, giving investment advice without being a registered investment adviser, appraising without an appraiser license, or producing "consumer reports" as an unregistered credit-reporting agency — is the consistent posture that **AcreOS is a software tool and the customer makes every decision.** Every place the product touches money, value, or a regulated judgment, that line must hold.

- **4.1** The ToS already states plainly: "AcreOS is not a broker, lender, servicer, real estate agent, investment adviser, or fiduciary. Nothing... constitutes legal, financial, tax, or investment advice." ✅
- **4.2** Constitution Immutable #12 and the audited Pax system prompts hold the line: information yes, suggestions yes, predictions with uncertainty bands yes — direct "do this with your money" advice never. Pax is instructed to refer out to a licensed professional. ✅
- **4.3** AI disclosure at first interaction is constitutionally required (#7) and required by CO SB 24-205. The audit flagged the disclosure was localStorage-only (not an auditable record). Verify the server-side disclosure gate shipped. 🟡 (Iris's surface.)
- **4.4** Pax's revenue-impact estimator ("+$25K-$80K") must read as an *estimate*, not a prediction. Verify the "Estimated" label + "model estimate, not financial advice" tooltip shipped. 🟡
- **4.5** Every surface showing valuation, flood, soil, or owner data needs a matching `RequiredDisclaimer` + provenance tag with an honest as-of date. The components exist; verify coverage. 🟡 **The specific landmines:** algorithmic valuation ≠ appraisal (USPAP / state appraiser licensing); a wrong "no flood risk" read is a real-harm claim; owner/skip-trace data feeding any tenant/credit decision triggers FCRA. The disclaimers are what keep these as "data we showed you" rather than "advice we gave you."

---

## 5. Payments / Stripe compliance, refunds, dunning, sales tax

| # | Item | Status | Owner |
|---|---|---|---|
| 5.1 | Stripe as processor (no card data stored) | ✅ | Privacy §2; ToS §5 |
| 5.2 | Auto-renewal clear-and-conspicuous disclosure | 🟡 verify | Iris/Soren (audit Surface 2) |
| 5.3 | Easy cancellation (as easy as signup) | ✅ constitutional | Constitution #4 |
| 5.4 | Refund policy stated (30-day money-back) | ✅ | Beatrice — DONE; ToS §5A |
| 5.5 | Dunning / failed-payment flow | ⬜ | Iris/Lena |
| 5.6 | SaaS sales-tax / economic-nexus posture | 🟦 | Tom + accountant |

**5.1 — Stripe.** AcreOS never stores card data; Stripe processes payments (Privacy §2, ToS §5). This keeps you out of PCI-DSS scope beyond the lowest self-assessment tier — Stripe handles the hard part. ✅

**5.2 — Auto-renewal disclosure (FTC Negative Option Rule).**
- *Why it matters:* The FTC's Negative Option Rule (effective 2025) requires the *total* billed amount (e.g., "$492/year") to be as clear and conspicuous as the headline monthly price before the customer agrees. The audit found the annual total in small secondary type — at the edge of compliance. Also: Constitution #6 (no auto-charge without recent, revocable consent) and #2 (no dark patterns) reinforce this.
- *What to do:* Verify the pricing UI shows the annual charge in equal-weight type. 🟡 (Iris/Soren surface.)

**5.3 — Cancellation.** Constitution Immutable #4 requires cancellation as easy as signup; #2 bans hidden cancellation. This is both a constitutional commitment and increasingly a legal one (FTC "click to cancel"). ✅ — keep it true.

**5.4 — Refund policy. ✅ DONE (Beatrice, 2026-06-06).**
- *Decision (Tom, 2026-06-06):* **30-day money-back guarantee** — full refund of the initial subscription fee within 30 days, no questions asked.
- *What was done:* Drafted and shipped as **ToS §5A** ("Refund policy — 30-day money-back guarantee"): full refund within 30 days of the initial charge; how to request (email/support form); 5–10 business-day processing; honest fair-use exclusions (already-spent pay-per-use credits, post-30-day renewals, abuse terminations); explicit preservation of non-waivable state consumer rights. The §5 payment section now carries an FTC-Negative-Option-compliant auto-renewal disclosure that points to the guarantee. (Mirrored in `docs/legal/terms-of-service.md`.) Soren can reference this policy from the pricing marketing page.
- *Who owns it:* Done. The annual-renewal email reminder referenced in §5 is an implementation item for Iris/Lena (ties to 5.5 dunning).

**5.5 — Dunning.** A failed-payment retry + notice flow (vs. silent service cutoff) is both good UX and avoids "you charged me with no warning" disputes. Confirm Stripe dunning + customer notice is wired. ⬜ Iris/Lena.

**5.6 — Sales tax / economic nexus.**
- *Why it matters:* This is the most commonly-missed SaaS obligation. After *South Dakota v. Wayfair* (2018), states can require you to collect sales tax once you cross an "economic nexus" threshold in that state (commonly ~$100K in sales or ~200 transactions/year). **A meaningful number of states tax SaaS** (e.g., TX, NY, WA, PA, OH, and MA taxes some software). At Phase 0 trickle volume you are almost certainly below every threshold, but the obligation grows silently with revenue and can create back-tax liability if ignored for years.
- *What to do:* At launch volume, **note and monitor** — you're below thresholds. As MRR grows, turn on **Stripe Tax** (it computes + collects automatically per state) and have an accountant confirm your nexus footprint. **Massachusetts specifically:** confirm whether your SaaS model is taxable in MA (MA taxes prewritten software; SaaS treatment is nuanced) — an accountant question.
- *Who owns it:* 🟦 Tom + accountant decide registration; Lena monitors revenue against thresholds; Stripe Tax executes collection. **Real-professional item — don't self-diagnose multi-state tax.**

---

## 6. Native e-sign legal validity (ESIGN / UETA)

| # | Item | Status | Owner |
|---|---|---|---|
| 6.1 | ESIGN §101(c) consumer-consent gate | ✅ | sign-document.tsx (commit 4b1a8174) |
| 6.2 | Five required §101(c) disclosures present | 🟡 verify | Iris (EsignConsentDialog) |
| 6.3 | Audit trail (IP, UA, timestamp, intent) | ✅ | signing_consent_audit |
| 6.4 | 7-year retention of signing records | 🟡 verify | Iris/Beatrice |

- *Why it matters:* AcreOS ships its own signing stack (we do **not** use DocuSign — see [[native-esign]]). For those signatures to be legally binding, they must satisfy the federal **ESIGN Act** and state **UETA** (adopted in 49 states; NY has its own equivalent). The legal essentials: (a) the signer **consented** to do business electronically, (b) **intent to sign** is captured, (c) the record is **attributable** to the signer (IP/UA/timestamp), and (d) the record is **retained and reproducible**.
- *What's done:* The audit (Surface 4) confirmed the ESIGN §101(c) consent gate, fail-closed behavior, idempotency, and an IP+UA+timestamp audit trail. This is genuinely solid. ✅
- *What to verify:* (1) The `EsignConsentDialog` contains all **five** §101(c)(1)(B) disclosures verbatim — hardware/software requirements, right to a paper copy, how to withdraw consent, how to update contact info, and scope of consent. (2) A **7-year retention** policy on `signing_consent_audit` (matches contract statute-of-limitations in most states). 🟡 (Iris's surface to confirm.)
- *Honest note:* ESIGN/UETA make e-signatures valid for most documents, but a few document types are **carved out** (wills, some notarized instruments, certain real-property transfer formalities vary by state). For deeds/mortgages specifically, recording requirements and notarization are state-by-state — the platform generates documents but the customer is responsible for proper execution/recording. The ToS should make clear AcreOS provides the tool, not a guarantee that a given document is validly executed/recorded in their state. 🟦 worth a counsel note for the seller-finance/deed flows.

---

## 7. Customer data: security, breach notification, retention/deletion, DPA

| # | Item | Status | Owner |
|---|---|---|---|
| 7.1 | DPA drafted | ✅ | `docs/legal/data-processing-agreement.md` |
| 7.2 | Security posture (encryption, access) | ⬜ documented | Iris/Tess |
| 7.3 | 50-state breach-notification readiness | ⬜ plan | Beatrice |
| 7.4 | GDPR 72-hour breach notification stated | 🟡 verify | Beatrice (Privacy doc) |
| 7.5 | Data retention + 7-day deletion (constitutional) | ✅ commitment | Constitution #8 |
| 7.6 | DSAR / deletion request handling surface | ✅ | /founder/dsar route exists |

**7.1 — DPA.** A Data Processing Agreement exists (`docs/legal/data-processing-agreement.md`). Customers are controllers of their lead data; AcreOS is the processor. Business customers (and any EU-touching ones) may require a signed DPA — having it ready is a sales unblocker, not just a compliance item. ✅

**7.2 — Security posture.**
- *Why it matters:* "Reasonable security" is a legal standard under nearly every state privacy law and the FTC Act. You don't need SOC 2 at Phase 0, but you do need to be able to *describe* your controls honestly (encryption in transit + at rest, access controls, Clerk-managed auth so you never store passwords, hosting on Fly.io).
- *What to do:* Maintain a short, honest security overview (the public `/security` page exists). Don't claim certifications you don't have (that's an FTC §5 deception risk).
- *Who owns it:* ⬜ Iris/Tess document; Beatrice keeps claims truthful.

**7.3 — Breach notification (50-state).**
- *Why it matters:* **All 50 states** have data-breach notification laws. If customer or lead personal data is exposed, you have legal deadlines to notify affected individuals (and sometimes the state AG) — timelines vary (e.g., some "without unreasonable delay," others a hard 30/45/60 days; **Massachusetts (M.G.L. c. 93H)** requires notice "as soon as practicable and without unreasonable delay" plus notice to the MA AG and Office of Consumer Affairs). You don't comply with 50 laws by guessing — you comply by having an **incident-response plan** ready *before* an incident.
- *What to do:* Write a one-page breach-response runbook now: who's notified, how affected users are identified, the 72-hour GDPR clock if any EU data, a template notice, and "engage counsel immediately." Cyber insurance (Section 8) usually includes breach-response coaching — a strong reason to carry it.
- *Who owns it:* ⬜ Beatrice drafts the runbook; counsel + insurer engage if a breach occurs.

**7.4 — GDPR 72-hour notice.** The audit found the old Privacy Policy lacked a breach-notification commitment. Verify the v1 doc states the GDPR Art. 33 72-hour notification. 🟡

**7.5 / 7.6 — Retention + deletion.** Constitution #8 commits to honoring deletion within **7 days** — stronger than most legal floors and a genuine differentiator. The `/founder/dsar` and `/founder/legal-holds` routes exist to operate this. Ensure the Privacy Policy's stated timeline matches the 7-day commitment (see 2.7), and that deletion respects any legal-hold override (you must *not* delete data subject to a litigation hold even on request — the legal-holds surface handles that tension). ✅ with the 2.7 verify.

---

## 8. Insurance to consider (options, not advice)

| # | Item | Status | Owner |
|---|---|---|---|
| 8.1 | Tech E&O / Professional Liability | 🟦 | Tom + broker |
| 8.2 | Cyber liability | 🟦 | Tom + broker |
| 8.3 | General liability (CGL) | 🟦 | Tom + broker |

> **Not insurance advice.** These are the categories a software company at your stage typically evaluates. A licensed insurance broker prices and recommends; the team cannot.

- **8.1 Tech Errors & Omissions (Professional Liability):** Covers claims that your software caused a customer financial harm (e.g., "a wrong data value cost me a deal," "Pax's output misled me"). For a data + AI product, this is usually the **most relevant** policy. The "tool not advisor" posture (Section 4) reduces the *likelihood* of such claims; E&O covers the *cost of defending* one anyway.
- **8.2 Cyber liability:** Covers breach-response costs, notification, credit monitoring, and regulatory defense if customer data is exposed. Pairs directly with Section 7.3 — most cyber policies include breach-response coaching and a lawyer on call, which is valuable beyond the payout.
- **8.3 General liability:** Standard business coverage (third-party bodily injury/property damage). Lower priority for a pure-software company with no physical premises/customers, but often bundled cheaply in a "tech BOP" (business owner's policy).
- *What to do:* Get quotes from a broker familiar with SaaS (Vouch, Embroker, or a local MA commercial broker specialize here). Often an E&O + Cyber bundle for an early-stage SaaS runs low four figures/year. **Tom decides coverage and budget; a broker recommends.** 🟦
- *Honest note:* This is a real-professional item and a Tom budget call. The team's role is to make sure the *risk surfaces* an underwriter will ask about (AI use, data sources, customer financial decisions) are documented so you get accurate quotes.

---

## 9. Massachusetts-specific items (MA-based founder)

| # | Item | Status | Owner |
|---|---|---|---|
| 9.1 | MA breach-notification law (93H) readiness | ⬜ | Beatrice (folds into 7.3) |
| 9.2 | MA data-security regulation (201 CMR 17.00 — WISP) | ⬜ | Iris/Beatrice |
| 9.3 | MA SaaS sales-tax treatment | 🟦 | Accountant (folds into 5.6) |
| 9.4 | Foreign-entity registration in MA (if formed elsewhere) | 🟦 | Tom + formation service |

- **9.1 MA 93H breach notification:** MA has one of the stricter breach laws — notice to affected residents, the MA AG, and the Office of Consumer Affairs and Business Regulation, and you may **not** describe the nature of the breach in the consumer notice. Folds into the breach runbook (7.3).
- **9.2 MA 201 CMR 17.00 (the "WISP" rule):** Massachusetts uniquely **requires any business that holds personal information about a MA resident to maintain a Written Information Security Program (WISP)** — encryption of PI in transit and on portable devices, access controls, employee training. As a MA-based founder you hold MA residents' data, so this applies to you directly. *What to do:* draft a short WISP (a few pages; templates exist). ⬜ Beatrice + Iris. This is a genuinely MA-specific, often-missed obligation.
- **9.3 MA sales tax:** MA taxes prewritten/canned software; SaaS treatment is fact-specific. Confirm with an accountant whether the AcreOS subscription is taxable in MA. 🟦 (folds into 5.6).
- **9.4 Foreign registration:** If you form the LLC in Delaware (or anywhere other than MA) but operate it from MA, MA generally requires you to register as a "foreign entity doing business in MA." If you form **in MA**, this is moot. A point in favor of just forming in MA at Phase 0 unless there's a specific reason for Delaware. 🟦 Tom + formation service.

---

## 10. The compliance gates already shipped (so you can see the floor is real)

These are *done* and verified in the 2026-05-31 audit and state matrix — listed so you can see the baseline is not theoretical:

- ✅ **ESIGN consent gate** with fail-closed behavior and audit trail.
- ✅ **Reg Z Ability-to-Repay gate** for note origination (`AtrGate.tsx` + server CHECK constraint) — relevant only if you originate seller-finance notes.
- ✅ **CAN-SPAM** unsubscribe footer, one-click unsubscribe (RFC 8058), suppression list — *pending only the physical address (1.4 / 5.x).*
- ✅ **TCPA** posture: no autodialer; SMS is operator-initiated; auto-send routes to physical mail only.
- ✅ **Pax fiduciary boundary** held in audited system prompts.
- ✅ **State matrix** (CA/CO/UT/CT/TX/IL/VA) reviewed: all PASS or minor-remediation for Phase 0; AcreOS operates as a software tool nationwide with no state licensing trigger at current scope (not a broker, lender, servicer, adviser, or CRA).

---

## 11. What you're PERSONALLY on the hook for (the question that drives the anxiety)

This is the honest answer to "if this goes wrong, what touches *me* vs. *the company*?"

**The wall:** Once the **LLC exists and is operated properly** (Section 1), the entity — not you personally — is the party to customer contracts and the target of most claims. A customer who sues over a data error, a billing dispute, or a service failure sues **AcreOS LLC**, and recovery is generally limited to the company's assets, **not your house, savings, or personal accounts.** That wall is the entire reason the LLC is item #1.

**What keeps the wall standing ("don't pierce the veil"):**
1. **Form the entity before customers sign** (1.1). A wall built after the lawsuit doesn't help.
2. **Keep a separate business bank account** — never pay personal expenses from the business account or vice versa. Commingling funds is the #1 way courts pierce the veil and reach you personally.
3. **Sign contracts as the entity** ("Tom Norton, Member, AcreOS LLC"), not as yourself.
4. **Have and follow the operating agreement** (1.2) and basic records.
5. **Carry insurance** (Section 8) so even a claim that gets past the wall hits a policy, not you.

**What the LLC does NOT shield you from (you're personally on the hook regardless):**
- **Your own fraud or intentional wrongdoing.** The veil never protects lying to customers — which is exactly why Constitution Immutable #1 ("never lie to a customer") is also your best *personal* liability protection.
- **Personal guarantees** you sign (e.g., if a vendor or lender makes you personally guarantee a contract — avoid these where possible at this stage).
- **Unpaid payroll/sales taxes** — tax authorities can pursue "responsible persons" personally. This is why the sales-tax posture (5.6) and an accountant matter.
- **Things you do before the LLC exists** — every day you operate without the entity, liability runs to you. This is the urgency behind item #1.

**The realistic risk picture at your stage:** AcreOS is a **software tool**, not a broker/lender/adviser/CRA, sold B2B to adults for business use, with the "tool not advisor" line held everywhere money or value is shown, AI disclosed, e-sign legally sound, and no autodialer. That is a **low-risk profile** for a launch. The biggest *real* exposures, in order:
1. **No entity yet** → you're personally exposed today. (Fix: Section 1.)
2. **A customer relies on a wrong data value** (flood/valuation/owner) and claims harm → mitigated by disclaimers + provenance + the tool-not-advisor line + E&O insurance. (Sections 4, 8.)
3. **A data breach** → mitigated by security posture + breach runbook + cyber insurance + the MA WISP. (Sections 7, 8, 9.)
4. **A billing/auto-renewal dispute** → mitigated by clear disclosure + easy cancellation + refund policy. (Section 5.)

None of these are existential if items 1, 4, 7, and 8 are handled. **That is the whole point of this checklist: the cloud is a finite, handleable list.**

---

## 12. Items that genuinely need a real lawyer or Tom's decision

**Only a licensed professional should sign off on (🟦):**
- Operating agreement review (1.2)
- ToS / Privacy / DPA review before public reliance (2.5)
- Registered agent + entity formation mechanics (1.4)
- Multi-state + MA sales-tax registration (5.6, 9.3)
- E-sign carve-outs for deeds/mortgages by state (6.x note)
- Insurance coverage selection (Section 8)
- Foreign-entity registration (9.4)

**Only Tom can decide (🟡):**
- ~~LLC-now vs. accept-C-corp (and the "AcreOS, Inc." doc mismatch)~~ — **DECIDED 2026-06-06:** form a MA LLC timed to just before the first customer; the false entity language is fixed now (1.0, 1.1, 1.5).
- ~~Refund policy terms~~ — **DECIDED 2026-06-06:** 30-day money-back guarantee, now live in ToS §5A (5.4).
- Budget + timing for lawyer/accountant/insurance engagement
- Whether to launch before vs. after counsel reviews the docs (the team recommends: form the entity and run the breach runbook + WISP before the first customer; the lawyer doc-review can be a fast-follow if budget is tight, since the drafts are already strong)

**We can fully prepare (⬜) — no blocker:**
- EIN (1.3), sub-processor list (2.4), public-data disclosure (3.5), breach runbook (7.3), WISP draft (9.2), dunning flow (5.5).

---

*This checklist is a risk-management work product by Beatrice (CRO) and Lena (CFO). It is not a legal opinion and does not substitute for licensed counsel. Where it says 🟦, it means exactly that: prepared, but a professional's signature closes it.*

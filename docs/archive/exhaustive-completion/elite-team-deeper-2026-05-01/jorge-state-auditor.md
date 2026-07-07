# Jorge Nieves — State Tax Auditor (Texas Comptroller)

**Persona:** Jorge Nieves, 54, Austin field office, Texas Comptroller of Public Accounts. Twenty-two years in audit — sixteen on franchise tax, six on sales-and-use focused on data-processing and information services. Bilingual, dry, methodical. Drives a Camry, carries a four-color pen, never raises his voice. The taxpayers who scare him are not the ones who yell — they're the ones whose ledgers reconcile to the penny on the first try.
**Trigger:** AcreOS LLC — a Delaware-formed, Texas-headquartered SaaS — receives a Form 4564-style notice from the Comptroller initiating a desk audit of franchise tax (Report Years 2024 and 2025) and sales/use tax (audit period Jan 2023 through Dec 2025). The triggering signal: an automated Webfile cross-match flagged $0 sales tax remitted while Texas customers' credit-card descriptors showed recurring AcreOS charges. I am the field auditor. I also happen to use AcreOS (started a Pro trial three months ago to sanity-check whether a tool I'd recommend to my brother-in-law's land business handles its own state tax obligations correctly). It does not.
**Stress level for the operator (the AcreOS founder):** elevated. **Stress level for the typical AcreOS customer:** elevated *if* they're a Texas LLC carrying notes — which is most of them. **Wave:** 3 — the audit lens.

---

## 1. The thirty-second verdict

AcreOS, the platform, has a Texas exposure of its own that nobody on the eng team has costed. AcreOS, the *tool used by Texas operators*, has zero franchise-tax surface and zero sales-tax surface. Both are real liabilities. The first is paid by the company. The second is paid in customer churn the day the customer's CPA finds out.

If I were grading this audit on my standard worksheet:
- **Franchise tax (the company's obligation):** Texas-domiciled SaaS. Owes a Texas franchise tax report annually once revenue clears the No Tax Due threshold ($2.47M for 2024 reports). At $79/mo Scale × an undisclosed customer count, AcreOS may be under, near, or over. There is no surface in the platform — and no internal doc I could find — addressing this.
- **Sales tax on the SaaS subscription (the company's obligation):** Texas treats SaaS as a *taxable data-processing service* under 34 Tex. Admin. Code § 3.330, with a 20% exemption (effectively 80% of the charge is taxable at 6.25% state + up to 2% local = 8.25%, so an effective ~6.6% on the subscription). I find no `tax_rate`, no `automatic_tax`, no `tax_id_data`, no customer billing-address capture in `server/services/stripeConnect.ts` lines 295-325. Stripe creates customers with `email`, `name`, and metadata only. That means **AcreOS is collecting zero sales tax on Texas subscribers, period.**
- **Sales tax in the other 21 states that tax SaaS:** same gap. Hana's Wave 2 audit (`docs/exhaustive-completion/elite-team-deep-2026-05-01/hana-tax.md`) flagged this. I'm reconfirming: still unfixed.
- **Customer-side state tax tooling:** absent. AcreOS knows Cesar's Texas usury cap (good) but cannot tell Cesar's CPA whether his note interest income triggers a Texas franchise tax filing for his single-member LLC, or whether his single-property-LLC structure crosses the no-tax-due threshold once aggregated. Marisol's multistate audit (`marisol-prescott-multistate.md`) made the same call.

I would not pass this taxpayer on a desk audit. I would, however, pass it on **fixability** — the audit log, the per-org financial ledger, and the Stripe Connect plumbing are all intact. Everything I would need to assess is *capturable*. It just isn't being captured.

---

## 2. Walking the books — the Wednesday morning desk audit

**8:00 AM.** Pull the franchise-tax filing history on AcreOS LLC from Webfile. Assume nothing is filed yet (most pre-revenue and early-revenue SaaS shops don't realize Texas requires a No Tax Due Report even when they owe nothing). The first question I ask the founder: *show me your entity registration, your apportionment factor calculation, and your Texas receipts for the report year.*

Texas is a single-factor apportionment state — Texas receipts ÷ everywhere receipts. For a Stripe-billed SaaS, "Texas receipts" means subscription revenue from customers whose **billing address is in Texas**. AcreOS does not record customer billing address on the Stripe customer object (`stripeConnect.ts:315`). Therefore AcreOS *cannot compute its apportionment factor*. I would issue a books-and-records deficiency under Tax Code § 111.0041. Penalty: not the dollar amount — the **inability to dispute my estimated assessment** when I substitute my own figure based on credit-card processor data.

**8:45 AM.** Sales tax. Texas is a *destination-sourced* state for most services, including data processing. Where the data processing is *consumed* — i.e., where the user is — determines local rate. AcreOS bills in cents and stores `subscriptionTier` + `stripeCustomerId` on `organizations` (`shared/schema.ts:15-115`). It does *not* store: a billing address, a service address, a state of formation, an EIN, a resale or exemption certificate, a tax-exempt status, or a tax_id. The schema supports `companyAddress?: string` inside `settings` JSONB (`schema.ts:54`) — a free-text optional field. Free-text is not auditable. I cannot tell from the data which subscribers are Texas, which are New York, which are claiming exemption, which are non-profits.

**9:30 AM.** I ask the founder to produce three years of invoices. Stripe will export them. I sample twenty. None of them contain a tax line item. None of them contain a tax-exempt certificate reference. None of them are flagged `tax_behavior: exclusive` or `inclusive`. Under 34 TAC § 3.286(d)(3), the seller must separately state sales tax on the invoice or face the presumption that the price did *not* include tax — meaning the seller owes the tax *on top of* the gross. I assess AcreOS at gross-up: 8.25% on the Texas portion, three years back, with penalty + interest.

**10:30 AM.** I move to AcreOS-the-tool. Cesar Reyes (`cesar-texas.md`) is exactly the customer I would see across the table. His single-member LLC takes in $480K UPB across three counties, ~$45K/yr of interest income, plus capital gains on flips. **Texas franchise tax question for Cesar:** is his LLC a "passive entity" under Tex. Tax Code § 171.0003? If 90%+ of his gross receipts are passive (interest, capital gains, dividends), he files an info report only. If not — say, his land-flip gains exceed 10% — he files a regular franchise return and computes margin under one of four methods. **AcreOS cannot answer this question for him.** The platform has all the data. There is no surface in `routes-bookkeeping.ts` or `taxOptimizer.ts` that even acknowledges franchise tax exists.

**11:00 AM.** Sales tax on Cesar's *own* services. Texas does not tax the sale of raw land — good for him. But Texas *does* tax a handful of services Cesar might inadvertently sell: surveying (taxable), real-estate brokerage commissions (not taxable), and *information services* (taxable if he sells parcel research to other investors, which a few of my taxpayers do as a side hustle). AcreOS has a "Pro Network" referral surface in the marketplace files. If Cesar is a Pro Network seller and AcreOS acts as a marketplace facilitator under HB 1525 (effective Oct 2019), then **AcreOS itself becomes the responsible party for collecting and remitting tax on third-party sales**. I find no marketplace facilitator logic anywhere.

**12:00 PM.** Lunch in the truck. I am uncomfortable.

**1:00 PM.** Nexus tracking. Wayfair (2018) lowered the bar: economic nexus in Texas is $500K of Texas receipts. Once AcreOS crosses that threshold — which, with Stripe-billed monthly subs, can happen in any rolling 12-month window — AcreOS *must* register as a remote seller (if not already a Texas entity) or as a Texas seller. There is no rolling-12 receipts dashboard for the founder, no threshold alarm, nothing in `routes-founder-intelligence.ts`. The founder could cross the line in March and not know until December.

The same threshold tracking is what *every customer* of AcreOS needs in *every state where they own land.* Marisol's multistate audit hit this from the customer side. The two problems collapse into one product feature: **state nexus monitor**. Computed once for the platform, surfaced twice — once internally for AcreOS LLC's own compliance, once externally for each org's.

**2:30 PM.** Source documentation. This is where I form my opinion of a taxpayer.

What I look for:
1. Original source documents, unmodified, retrievable on demand.
2. A cradle-to-grave audit trail showing every change to a financial figure.
3. Clear separation between transactional records (immutable) and reporting records (computed).
4. Backups, retention policies, and proof of integrity.

What AcreOS provides:
1. The `audit_log` table (`schema.ts:4149`) — strong shape, captures `before/after/fields` on changes, with `userId`, `ipAddress`, `userAgent`. Bartholomew's IRS audit (`bartholomew-irs-audit.md`) already validated this layer.
2. `fee_audit_log` (`schema.ts:10352`) — settlement fee mutations, indexed correctly.
3. Per-org cost-basis tracker, depreciation schedules, 1098-INT generation. All present.
4. Retention policies are *configurable* in `organizations.settings.retentionPolicies` (`schema.ts:62-68`) — meaning a founder can set them to 30 days. **For a Texas franchise-tax auditor, the statute of limitations is four years (Tex. Tax Code § 111.0041), six if no return was filed.** A 30-day retention policy applied to `audit_logs` is itself a deficiency. I would want platform-level *floor* retention enforcement: regardless of org config, financial-event audit logs cannot be purged before 7 years.

**4:30 PM.** I close the laptop. Draft notes for the deficiency letter.

---

## 3. The auditor's nine-point worksheet — pass / fail / not assessed

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | TX franchise-tax filing surface for the platform itself | **FAIL** | No internal doc, no entity-registration capture, no apportionment computation possible without billing address. |
| 2 | TX sales-tax collection on SaaS subs (data processing per § 3.330) | **FAIL** | `stripeConnect.ts:315` creates customers without address, tax_id, or `automatic_tax`. Zero collection on a taxable service. |
| 3 | Multistate sales-tax registration tracker (22 SaaS-taxing states) | **FAIL** | Hana's Wave 2 finding stands. No registration matrix, no per-state nexus threshold meter. |
| 4 | Marketplace facilitator logic (HB 1525, third-party sales) | **FAIL** | Pro Network referrals create exposure; no facilitator collection logic. |
| 5 | Customer-side TX franchise-tax helper (passive entity test, margin method) | **FAIL** | All inputs present in the data; no surface computes the test. |
| 6 | Customer-side multistate annual-report calendar | **FAIL** | Marisol's finding. Static, public data — should be a calendar surface. |
| 7 | Audit log integrity (financial events) | **PASS** | `audit_log` + `fee_audit_log` are well-shaped; founder audit log captures decision events. |
| 8 | Retention floor on financial audit logs (7-year minimum) | **FAIL** | `retentionPolicies` is org-configurable with no platform-level minimum; a customer could comply-by-deletion. |
| 9 | 1099-INT generation (federal, but audit-relevant for cross-match) | **PASS** | `bookkeeping.ts:240` + `routes-bookkeeping.ts:34` issue from the payments ledger. Cross-checks cleanly. |

Two passes, seven fails. The passes are foundational — without the audit log I'd close the case immediately and substitute estimated assessments. With it, the fixes are tractable.

---

## 4. The five things I would build in the next 90 days

### A. Stripe customer enrichment + automatic tax (week 1, two days of work)
- Capture billing address at checkout. Pass it on `stripe.customers.create` along with `tax_id_data` when the customer provides an EIN or resale certificate.
- Enable Stripe Tax (`automatic_tax: { enabled: true }`) on the subscription. Stripe handles 22-state SaaS rate matrices, exemption certificates, and remittance via Stripe Tax for Texas, NY, WA, etc.
- Add `taxExemptCertificateUrl` to `organizations` for resale and 501(c)(3) cases.
- *Without this, every day of revenue compounds the back-tax assessment.*

### B. Org-level entity profile (week 2)
- New table `organization_tax_profile`: `entityType` (LLC, S-corp, sole prop, partnership), `stateOfFormation`, `ein`, `texasFranchiseEntityNumber`, `passiveEntityElection: boolean`, `taxYearEnd`, `accountingMethod` (cash/accrual).
- Surface at `/settings/tax`.
- Feeds the customer-side franchise-tax helper, the 1099 issuer name on Bartholomew's forms, and the multistate registration matrix.

### C. State nexus monitor (weeks 3-4)
- Computes rolling 12-month receipts and transaction count by state for each org.
- Color-coded against each state's economic-nexus threshold ($500K TX, $100K most others, $250K AL/MS/SD).
- Two surfaces: founder dashboard (for AcreOS-the-platform) and operator dashboard (for the customer's own thresholds).
- *Same compute kernel both directions — one feature, two audiences.*

### D. Customer-side TX franchise-tax helper (weeks 5-6)
- Runs the passive-entity test on the org's transaction stream. Outputs: "You qualify as a passive entity for FY2024. File Form 05-163 (Information Report) by May 15."
- For non-passive: pulls revenue, COGS, comp, and runs the four-method margin computation. Picks lowest.
- Generates a draft Form 05-158-A.
- *Cesar's CPA bills $385/hr. This feature pays for AcreOS Scale four times over.*

### E. Audit-log retention floor (week 7)
- Platform-level constant: financial-event audit logs (`fee_audit_log`, basis adjustments, 1099 issuance, payment ledger) cannot be purged before 7 years regardless of org `retentionPolicies` config.
- Display the floor in the retention settings UI: "Financial records: 7 years (regulatory minimum, not configurable)."
- Add `purgePreventedAt` and `purgePreventedReason` columns where retention attempts hit the floor.

---

## 5. What I would tell the founder, across the table

You have built the audit-trail layer competently. You have not built the registration-and-remittance layer at all. The first protects you from the IRS. The second protects you from me.

The good news: nobody at the Comptroller is angry yet. The bad news: that is a function of you not being big enough to show up on the cross-match queue with consequence. The day a Texas customer's CPA Schedule-Cs an AcreOS subscription as a "data processing service" (which, by 34 TAC § 3.330, it is), and the customer goes to write off 80% of it as taxable input, the customer's CPA will ask why no sales tax was charged. That question routes back to my office. I will be the second auditor your company speaks to, but I will be the first one whose findings hit your wallet.

Fix Stripe Tax this week. Build the entity profile next month. Everything else is a quarter of work.

The audit log is good. Don't break it.

---

## 6. Cross-references to other waves

- **Hana (`hana-tax.md`)** — first identified the 22-state SaaS tax exposure. This audit confirms her finding from the field-auditor side and adds the Texas-specific data-processing-services framing (§ 3.330, the 80/20 rule).
- **Marisol (`marisol-prescott-multistate.md`)** — the customer-side multistate calendar problem. Same compute kernel as the platform-side nexus monitor I'm asking for; build once, expose twice.
- **Bartholomew (`bartholomew-irs-audit.md`)** — IRS-side audit readiness; the federal layer is sound. State layer is not.
- **Cesar (`cesar-texas.md`)** — the Texas-operator field test. He flagged Texas-specific *transaction* compliance (5.069, deed of trust, usury). I'm flagging Texas-specific *entity* compliance. Different statutes, same neighborhood.
- **Marisol-CFO (`marisol-cfo.md`, Wave 1)** — first to ask for an entity-level tax profile. Still not built.

---

## 7. Source-document workpaper — what I'd ask for, what AcreOS produces

A franchise-tax desk audit is a paper exercise. The Comptroller does not visit. The taxpayer mails (or Webfile-uploads) a workpaper packet. I score the packet on completeness before I score it on accuracy. Here is the AcreOS-specific packet I would request from a Texas operator under audit, paired with what the platform produces today.

| Auditor request | AcreOS surface today | Gap |
|---|---|---|
| Federal Form 1120-S / 1065 / 1040 Schedule C, signed | Not stored; user uploads to local CPA | Add `documents/tax-returns/` per-org store, encrypted at rest, audit-logged. |
| Trial balance, audit year | `/finance` ledger; CSV export from `services/export.ts` | Adequate — but no PDF cover sheet with org letterhead, reconciliation date, or signing officer. |
| Texas franchise-tax report (prior year), with apportionment worksheet | None | Build the helper described in §4.D. |
| Sales-tax filings + working papers (Form 01-117) | None | Customer-side: most operators don't owe TX sales tax (raw-land sales are non-taxable). The exceptions (information services, surveying side gigs) need to be flagged. |
| Bank reconciliations, audit period | None on platform — Plaid integration ingests transactions but does not produce a reconciliation worksheet | Plaid pulls bank txns; reconcile-to-ledger is a missing surface. |
| Sales journal — gross sales, exempt sales, taxable sales, by month | Partial — `payments` table has the data; no journal export | Add `/reports/sales-journal?year=2025` with TX-format columns. |
| Schedule of fixed assets and depreciation | `taxOptimizationEngine.ts` + `depreciationSchedules` table | **Pass.** Bartholomew's audit confirmed this. |
| 1099-INT issued + recipient TINs | `bookkeeping.ts:240`, `routes-bookkeeping.ts:34` | **Pass.** |
| Resale and exemption certificates from buyers (if any) | None | Land flips to dealers / 1031 intermediaries occasionally need certificates retained. Add `documents/exemption-certs/`. |

**The pattern:** federal-tax surface (basis, depreciation, 1099) is built. State-tax surface (franchise, sales, registration) is not. Same data underneath. Different assembly required.

---

## 8. Multistate apportionment — the four operators I worry about

Most AcreOS operators are single-state. A growing minority are not. I sampled four customer profiles from the persona library and assessed each:

1. **Cesar (TX, single-state)** — easiest case. Single-factor TX apportionment. Passive-entity test likely passes if he's mostly note interest. **Helper would resolve in one click.**
2. **Marisol (CO + 4 other states)** — hardest case. Each state has its own apportionment formula (single-factor, three-factor with double-weighted sales, market-based sourcing for services). Marisol needs a *per-state apportionment computation*, not a Texas-only helper.
3. **Della (GA timber)** — Georgia is single-factor receipts, but timber sales have severance-tax overlay. Out of scope for a Texas auditor, but the platform feature stack is identical: capture entity profile, compute state-specific apportionment, surface deadlines.
4. **Constance (Chapter 11)** — bankruptcy creates a tax-period split (pre-petition, post-petition). Texas requires a final report on the pre-petition entity. AcreOS has no concept of a tax-period close; the founder-audit log captures decisions but not entity-level fiscal events.

The right architecture: a `state_tax_obligations` engine that takes (org tax profile, transaction stream, calendar) and emits (filings due, estimated amounts, source workpaper). Texas is the first plug-in. Add California, New York, Florida, Georgia next — those four cover ~70% of AcreOS customer geography.

---

## 9. The one paragraph for the changelog

> AcreOS's audit-trail and ledger layers are production-grade. Its tax-collection and tax-registration layers do not exist. The platform owes Texas sales tax on its own subscription revenue (data-processing service, 80% taxable at 8.25% effective rate) and likely owes back-tax in 21 other SaaS-taxing states. It also leaves customers without the franchise-tax tooling their data already supports. Five fixes — Stripe Tax enablement, org tax profile, state nexus monitor, TX franchise helper, and a 7-year retention floor on financial audit logs — close the gap. The work is bounded. The exposure compounds daily until it ships.

— *Jorge Nieves, Texas Comptroller of Public Accounts, Audit Division. Field notes, 2026-05-01.*

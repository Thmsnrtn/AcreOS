# Adjacent Industries / Outside-In — 15 personas (slots 271–285)

## 271. Yusra Al-Hamadi — Fintech ops engineer (reconciliation discipline)

**Lens:** Reconciliation discipline at scale.

**What I see:** You process deals, notes, wire instructions. Fintech learns: every dollar in != every dollar accounted for. You have `subscription_events` (FW-MARISOL-2); you probably don't have a nightly reconciliation cron that says "org X sent $10K in wires today; do we have 10 matching transactions?" Stripe embeds this in Reconciliation Rules. You're rebuilding it ad hoc.

**Outside-in move:** Implement a `reconciliation_rules` table: `source_system` (stripe, sendgrid, twilio), `entity_type` (transaction, event, invoice), `aggregation_key` (org_id, date), `expected_count`, `tolerance` (±5 in count, ±2.5% in amount), `last_audit_timestamp`. Nightly cron: pull the source system's totals, compare to your database totals. Divergence > tolerance = alert + audit log. This is fintech hygiene: "trust but verify."

**Tie to AcreOS:** When you integrate payment processors (Stripe Payouts, ACH partners), implement reconciliation rules *before* the integration is live. Catch divergence in day 1 of testing, not day 60 when you're at scale. Effort: 1 week now, saves $200K+ in refund fraud later.

---

## 272. Hugo Nilsson — Healthcare HIPAA engineer (PHI segregation)

**Lens:** HIPAA-shape PHI (Protected Health Information) segregation patterns.

**What I see:** AcreOS doesn't touch healthcare data. But BH tenant-screening touches PII (borrower names, phone, income). HIPAA logic: if a piece of data is regulated, isolate it. HIPAA's answer is role-based access + encryption + audit log + automatic purge + consent tracking.

**Outside-in move:** Model your skip-trace results + tenant screening data as "quasi-PHI." Implement HIPAA-shape controls: (1) `data_classification` column on every table (public, private, pii, quasi-regulated); (2) access control: if you query a quasi-regulated table, you must cite a purpose + legal basis; (3) encryption: quasi-regulated fields encrypted at rest + in transit; (4) purge: deletion happens automatically per retention policy (Wynne's move #4); (5) audit log: every access logged + aggregated. This is medical-grade discipline applied to real-estate PII.

**Tie to AcreOS:** Before launching BH at scale, audit tenant-screening schema against HIPAA-shape controls. The controls don't apply (you're not covered entities), but the *patterns* are worth borrowing: role-based access, purpose-tagging, automated purge, encrypted audit trail.

---

## 273. Caroline Whitlock — Insurance underwriter (Cyber + E&O carrier-side)

**Lens:** Control-attestation evidence.

**What I see:** You want cyber insurance. E&O insurance. You'll ask your broker: "how much coverage can we get for account-takeover incidents?" The underwriter will ask: "show me your incident-response playbook, your access controls, your audit log retention policy." You'll have code; you won't have *evidence* that the code is actually running.

**Outside-in move:** Build a "control self-assessment" dashboard at `/founder/insurance-readiness` showing: 2FA adoption %, sessions-revoked-last-30-days, backup-test-last-run, disaster-recovery-drill-passed, incident-response-time (P95). Screenshot every week, save to S3. When your broker asks for evidence, you hand them 52 weeks of CSV + attestation: "these controls are continuously verified." This is insurance-grade documentation.

**Tie to AcreOS:** Pair with Caspian's compliance-dashboard. Insurance companies trust numbers that move daily + are signed off by leadership. A static "we have 2FA" document is evidence-light. A dashboard showing "92% of users have 2FA enabled as of 2026-05-08" is underwritable.

---

## 274. Augustin Petracci — Legaltech executive (Doc-automation SaaS)

**Lens:** Template-versioning patterns.

**What I see:** TX §5.069 disclosure template ships as `disclosureRegistry.ts`. If it changes (new statutory language in 2027), how do you version it? Do you have a git history of every template change? Can you prove which template was in effect when? Legaltech learns: every contract change is a liability event. You must version every template + archive every instance.

**Outside-in move:** Implement a `document_templates` versioning system: `template_id`, `version`, `effective_date`, `retired_date`, `template_body`, `checksum`. Every document generated stores `document_template_version` + checksum. When SEC/state AG asks "which disclosure was customer X shown?" you answer: "template version 2.1, effective 2026-01-15, here's the SHA256, here's the PDF." This is legaltech rigor.

**Tie to AcreOS:** For FF-3 contract-for-deed docs + all templated disclosure, version every change. When Augusto's attorney reviews the disclosure, they review version 1.0 + sign off. Commit: `disclose template version 1.0 reviewed by [attorney]`. Any future change bumps to 1.1 + requires attorney re-review.

---

## 275. Imelda Bautista — Proptech competitor (Buildium/AppFolio shape)

**Lens:** Comparative-feature messaging.

**What I see:** Your Land vertical is $0–$1M ARR; Zillow's Zillow Premier Agent is $100M+. Your BH vertical is launching; Buildium is $400M+ ARR. Feature-for-feature, you can't beat them. But you can do *different*. Buildium sells to property managers; AcreOS sells to land investors + individual operators.

**Outside-in move:** Build a feature-comparison matrix: Land Investor workflow vs Zillow Premier vs Zillow for Business. Note where you win (unified pipeline across Land + Notes + BH, cheaper per-property-managed) and where you lose (Zillow has 20 integrations, you have 3). Don't hide the gaps; position them: "Zillow manages 10M listings. AcreOS manages your 50-property portfolio. Different game."

**Tie to AcreOS:** When you're ready for Series A, your comparative narrative is critical. You're not competing with AppFolio on features; you're competing on persona-fit (independent operators vs property managers) + vertical depth (we go 3-deep on Land, not 1-shallow across 50 verticals).

---

## 276. Boris Andronov — Banking compliance officer (Bank-side BSA / AML)

**Lens:** BSA / AML reporting discipline.

**What I see:** You process wire instructions. You probably don't have a Suspicious Activity Report (SAR) filing process. Bank-side learns: if you see a pattern (customer opens 5 accounts in 1 day, each wires $100K to a sanctioned jurisdiction), you *must* file a SAR within 30 days or you've broken the law.

**Outside-in move:** Implement an `aml_rules_engine` with three tiers: (1) tier-1 rule: if wire destination is on OFAC list, block immediately + alert founder; (2) tier-2 rule: if org's cumulative wires exceed $500K in 1 week, flag for review; (3) tier-3 rule: if >3 organizations from same IP address open accounts in 1 day, flag for investigation. Maintain a `suspicious_activity_reports` table: `rule_triggered`, `org_id`, `investigation_status`, `filed_with_fincentity`, `filing_date`. Itzel's move #1.

**Tie to AcreOS:** You're not a bank, so you're not required to file SARs. But the patterns are the same. When you process wire instructions (FF-3 contracts), model the pattern-detection from banking. You'll need this when you expand into note lending + investor-to-investor transactions.

---

## 277. Soledad Iglesias — Accounting SaaS exec (QuickBooks-shape)

**Lens:** Chart-of-accounts standardization.

**What I see:** You generate 1099-NEC forms (FF-3). You extract transaction data. But do you map to a standard chart-of-accounts (COA)? QuickBooks uses a taxonomy: Income, Cost of Goods Sold, Expenses (categorized as Advertising, Depreciation, etc.). If AcreOS exports data + the customer imports to QuickBooks, do the account names match?

**Outside-in move:** Implement a `chart_of_accounts_mapping` table: `acreOS_field` (contractor_payment, property_acquisition, repair_expense) → `quickbooks_account` (Contractors, Fixed Assets, Repairs & Maintenance). When exporting to QuickBooks format, use the mapping to label GL rows. This is SaaS-to-SaaS interoperability. Soledad's customers love it: "finally, the apps talk to each other."

**Tie to AcreOS:** When you integrate with QuickBooks (big ask from finance-conscious operators), you'll need this mapping. Build it once, test it against 100 real customer imports, then offer as a feature: "one-click QuickBooks export." Effort: 2 weeks for the mapping framework; 3 weeks to test with accountants.

---

## 278. Tate Henrichsen — CRM SaaS PM (contact-source attribution)

**Lens:** Contact-source attribution and lead lifecycle.

**What I see:** You have a buyer list. Where did each buyer come from? (Direct customer input, property comp search, deal-room share link). You don't track source. Tate's CRM tracks: this contact came from "Facebook Lead Ads" → assigned to AE → converted to customer. Contact lifecycle is the moat.

**Outside-in move:** Implement a `contact_source_tracking` table: `contact_id`, `source_type` (enum: direct_entry, api_import, deal_room_share, comp_search, email_broadcast), `source_reference_id`, `attributed_timestamp`. When a buyer becomes a customer, trace back to source. Measure: "which source converts highest?" → invest in that channel. This is SMB CRM thinking applied to deals.

**Tie to AcreOS:** Mireille's growth loop (FW-MIREILLE-1) needs source tracking. Deal-room unauthenticated view → "Want this for your own deals?" → signup. If you track the source, you can measure: "deal-room shares convert at 3.2% to signup; emails convert at 1.8%." That's your growth-loop compass.

---

## 279. Eitan Bar-Lev — E-sign competitor (DocuSign-shape)

**Lens:** Audit-trail completeness.

**What I see:** You generate contracts via Pax. You sign via Dropbox Sign. FW-HARLOWE-1 implements content-hash immutability + completion certificate. Good. But DocuSign goes deeper: every keystroke, every field fill, every page flip is logged with timestamp + IP + user-agent. Audit trail is the legal document itself.

**Outside-in move:** Extend audit logging: instead of just signature timestamp + content hash, log: (1) document opened at 09:14:32, user IP 192.168.1.100; (2) field "property address" filled at 09:16:11; (3) page 2 scrolled to at 09:18:04; (4) signature placed at 09:22:19, lat/long via geolocation. This is DocuSign-grade audit trail. When a buyer contests the signature ("I didn't sign that"), you hand them a minute-by-minute video timeline.

**Tie to AcreOS:** For FF-3 contract-for-deed signature, implement field-level audit logging. Every interaction with the contract is timestamped + logged. This is the defense against "that's not my signature" disputes. Effort: 2 weeks for field-level instrumentation + dashboard.

---

## 280. Mariana Salgado — Mortgage tech exec (disclosure-timing automation)

**Lens:** Disclosure-timing automation and TILA compliance.

**What I see:** Heath's concern (257) is real: TILA disclosures must arrive 3 business days *before* closing. Mortgage-tech solution: automate the timing. Customer picks closing date → system auto-schedules disclosure generation for T-3 days → auto-sends to borrower → tracks delivery confirmation. Zero manual workflow = zero timing violations.

**Outside-in move:** Implement a `disclosure_schedule` table with a cron job: (1) user specifies closing_date; (2) disclosure_send_date calculated as closing_date - 3 business days (excluding weekends + holidays); (3) on disclosure_send_date at 08:00 UTC, disclosure auto-generates + auto-sends to borrower; (4) delivery confirmation captured + audit logged. If cron fails, alert founder immediately (don't batch). This is mortgage-tech rigor: timing violations have zero tolerance.

**Tie to AcreOS:** For FF-3 contracts, wire up disclosure-schedule automation. When a customer says "I'm closing on 2026-06-15," the system auto-calculates "disclosure must send by 2026-06-10, 08:00 UTC." Cron fires on time; you're compliant by construction.

---

## 281. Phineas Whittaker — PMS competitor (Stessa-shape single-vertical)

**Lens:** Single-vertical depth vs horizontal breadth.

**What I see:** You're building for 6 verticals (Land, Notes, BH, FF, Cuthbert, Subdivider). Stessa went deep on BH only: 10+ integrations, custom eviction forms per state, late-fee engine tuned for 50 states, 5+ reports. AcreOS goes shallow across 6: decent pipeline, basic screening, generic 1099 forms.

**Outside-in move:** Phoebe + Caspar's debate: go deep on 2 verticals or shallow on 6? Phineas votes deep. For Land: build a "land-investor VC scorecard" (comps + tax delinquency + ownership % + seller-finance terms). For Notes: build a "note-amortization auditor" that catches rounding bugs. These are Land-specific, Notes-specific features that a horizontal SMB suite can't build.

**Tie to AcreOS:** This is the trade-off map (T2 in _FORWARD-SYNTHESIS). Phineas would say: pick Land + Notes, go 3x deeper, defer the others. Wendell + Sam agree. Caspar + Mireille disagree. Founder calls the shot.

---

## 282. Yul Karimov — Lien-data provider (data-currency SLA)

**Lens:** Data-currency SLA.

**What I see:** You eventually integrate lien data (comp-search shows "this property has 3 delinquent tax liens"). Lien data has a shelf life: a lien filed yesterday is accurate; a lien filed 2 years ago may be released (recorded) and you don't know it. Data-currency SLA: "we refresh lien data every 5 days; max staleness = 5 days."

**Outside-in move:** When integrating lien data, negotiate an SLA with the provider: (1) update frequency (daily / weekly / monthly), (2) max data age (this property's lien info was last updated on [date]), (3) penalty if SLA breached (you owe us a refund). Embed this in the UI: "Lien data as of 2026-05-03; refresh frequency: daily." This is transparency + protection. If you don't disclose staleness, a customer makes a bad bid based on outdated lien info, they sue you + the data provider.

**Tie to AcreOS:** When you integrate comp tools, lien data, public records, establish data-currency SLAs. Disclose freshness in the UI. Document in audit log: "comp data from 2026-04-15" so if a deal goes sideways, you have evidence that you disclosed the staleness.

---

## 283. Ruti Goldfarb — ML/AI startup founder (adjacent vertical)

**Lens:** Eval-corpus authoring.

**What I see:** You're shipping complianceAI (Indira's move) + eval harness (FW-THEO-1). You probably don't have a rigorous eval corpus (a dataset of inputs + expected outputs). ML startups learn: eval corpus is the most expensive thing you'll build. You need 1,000+ examples, hand-labeled by domain experts, versioned, and maintained.

**Outside-in move:** For complianceAI, build an `ai_eval_cases` table: `case_id`, `vertical` (ff, bh, ni, etc.), `input_doc` (contract, disclosure, note doc), `expected_output` (compliance_check result), `actual_output` (what complianceAI said), `eval_pass` boolean, `authored_by` (expert name). Seed with 100 cases (FF contracts, BH screening results, NI notes). Hand-label with Wynne + Augusto + Itzel. Then: every time Indira updates the prompt, run 100-case regression. No prompt update ships without a passing eval run.

**Tie to AcreOS:** Indira's move says "eval harness as cost-observability." Ruti says "eval harness as quality-gate." Both are true. Without a versioned eval corpus, you're updating prompts blind. With it, you see impact immediately.

---

## 284. Dame Heloise Crewe — Vertical SaaS exec (post-IPO AppFolio veteran)

**Lens:** What-we-got-wrong storytelling.

**What I see:** You're building AcreOS as a single-founder shop with a 8-person team. AppFolio went from 5 → 500 people. Heloise lived it. She knows: the features you built for person #1 (simplicity, speed) become tech debt for person #100 (integrations, compliance). The decisions you make at Series A (monolith, single region, founder-dashboard centrality) haunt you at Series C.

**Outside-in move:** Start documenting now: "at person-10, we learned: X was wrong, here's how we fixed it." At person-50: "at person-50, we learned: Y was a mistake." This is the narrative that VCs love: "the founder learned and adapted." It's also the narrative that your company culture needs: "we make mistakes, we acknowledge them, we fix them."

**Tie to AcreOS:** At 10 customers: Asher's account-takeover teaches you "incident response is non-negotiable." At 30: Caspar's revenue gates teach you "vertical focus matters." At 100: the schema monolith (Ines' concern) teaches you "architecture debt compounds." Each lesson becomes a blog post: "Building AcreOS: 5 things we got wrong."

---

## 285. Hilel Brunner — Dev-tool exec (DX as primary metric)

**Lens:** DX (developer experience) as primary metric.

**What I see:** You're SMB SaaS, not a dev tool. But your customers *use* APIs: integrations with Stripe, integrations with Twilio. If your API docs are bad, or your OAuth flow is confusing, your SMB customers (who are not developers) have a bad time. Meanwhile, your competitors (Zillow, Buildium) have polished API experiences.

**Outside-in move:** Ship an API docs site (`docs.acreos.io`) with three sections: (1) Authentication (OAuth + API keys + code examples in Node + Python), (2) Core Resources (Properties, Deals, Notes, Tenants — CRUD endpoints with curl examples), (3) Webhooks (event types + retry logic + signature verification). Make it better than your main docs. This is how you win: your SMB customers feel like you respect their time.

**Tie to AcreOS:** Kaapo (98, developer advocate) would push for this. Pair with a "getting started in 5 minutes" video: "Create an API key → authenticate → fetch your properties." DX isn't just for dev tools; it's for SaaS that touches technical users (VAs, accountants, title agents).

---

## Category synthesis — Adjacent Industries / Outside-In (5 recommendations)

### AD1. Reconciliation + dispute audit trail (Yusra + Penelope)

**Cluster:** Yusra (271), Penelope (74)

Implement nightly reconciliation rules for wire transfers, Stripe payouts, 1099 forms. Audit log every discrepancy + manual override. This is fintech discipline: "trust but verify." Catches $10K errors before they compound into $500K. **Priority: weeks 4–5.**

### AD2. HIPAA-shape PHI segregation for PII (Hugo + Ottilie)

**Cluster:** Hugo (272), Ottilie (67)

Implement data-classification schema: public vs private vs pii vs quasi-regulated. Role-based access tied to purpose. Encryption at rest. Automatic purge per retention policy. This is medical-grade discipline applied to real-estate PII. **Priority: weeks 6–8.**

### AD3. Template versioning + attestation archive (Augustin + Eitan)

**Cluster:** Augustin (274), Eitan (279)

Version every template (disclosure, contract) with effective date + legal-expert sign-off. Every generated document stores template version + checksum. Audit-log field-level interactions (opened, filled, signed). When litigation arrives, you hand over a complete timeline. **Priority: weeks 5–6.**

### AD4. Disclosure-timing automation via cron (Mariana + Heath)

**Cluster:** Mariana (280), Heath (257)

Automate TILA/SEC disclosure timing: closing_date → auto-calculate disclosure_send_date (T-3 days) → cron fires on time → delivery confirmed. Zero manual workflow = zero timing violations by construction. **Priority: weeks 6–8.**

### AD5. Growth-loop source tracking + vertical depth strategy (Tate + Phineas)

**Cluster:** Tate (278), Phineas (281)

Implement contact-source tracking: deal-room share → signup → customer → measure conversion rate. Parallel: decide vertical depth: go 3x deep on 2 verticals (Phineas) or 1x wide across 6 (AppFolio-style). Source tracking feeds the decision: which vertical converts highest? **Priority: weeks 2–3 (strategy decision) + 4–5 (implementation).**

---

*Synthesized 2026-05-08. These 15 personas bring patterns from adjacent domains: fintech (reconciliation), healthcare (PHI segregation), legaltech (versioning), mortgage (TILA timing), CRM (source tracking), e-sign (audit trails), vertical SaaS (what-we-got-wrong), dev tools (DX). The cluster is sequenced: (1) operational rigor (reconciliation), (2) data governance (PHI segregation), (3) legal defensibility (templating, timing), (4) growth accountability (source tracking, vertical focus). Ties to FW-MARISOL-2, RS-1..RS-7, Phoebe/Caspar trade-off, Wendell/Sam moves.*


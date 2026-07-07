# Adversarial / Stress — 15 personas (slots 256–270)

## 256. Ophelia Brennan — Plaintiff FCRA attorney (class-action practice)

**Lens:** Adverse-action-paper-trail gaps exploited in discovery.

**What I see:** RS-2 ships adverse-action *send*. But I'm looking for the gaps: (1) does your template cite a specific CRA? (2) is the "factors contributing to the decision" section actually specific, or boilerplate ("property failed valuation")? (3) do you retain the original email + delivery confirmation for 6 years? (4) is there a right-to-dispute + free CRA-copy offer with actual CRA contact info?

**Hostile move:** I'd target the *timing*. If a borrower gets screened at 09:00 and receives the adverse-action email at 20:00 (you batch-send), I'd argue the email is *presumptively* defective — it looks like an afterthought. I'd also look for template copy-paste errors (e.g., "we denied you based on information from Experian" when it was actually LexisNexis). In discovery, template inconsistencies = negligence.

**What you should do:** Ship substantive 3-screen attestation form (Wynne's move). Tie adverse-action send to the *screening result timestamp*, not a batch cron. Add a delivery-status webhook so `auditLog` captures "email delivered at 09:14." Make the template cite the actual CRA. Retention: adverse-action emails live in a legal-hold-proof table, not the email log.

**Biggest risk if you ignore me:** Class-action numerosity: if 100+ borrowers got adverse-action notices without specific factors cited, that's a viable class. Settlement: 3-5x the per-notice statutory minimum.

---

## 257. Heath Macaulay — Plaintiff TILA attorney (Truth-in-Lending claims)

**Lens:** Disclosure-timing violations.

**What I see:** You scaffold TX §5.069 disclosure in `disclosureRegistry.ts`. TILA §1638 says: disclosures must reach the consumer 3 business days *before* consummation. If a FF-3 contract-for-deed is signed at 18:00 on Friday, the disclosure must arrive by 17:59 on Tuesday. If you generate the disclosure at signature time, you've *already violated* the statute.

**Hostile move:** I'd subpoena your `generated_documents` table + `audit_log` to show: (1) disclosure generation timestamp vs (2) signature timestamp. If they're the same or later, you're in violation. I'd multiply that across every FF customer who signed a contract-for-deed, file a class-action demand, and cite statutory minimum damages + attorney fees. No malice required — strict liability.

**What you should do:** Implement disclosure-generation *before* signature flow. Customer generates a "contract preview" → AcreOS injects disclosure → customer reviews for 3 days → signature date is recorded → Pax pulls the pre-generated disclosure (immutable) + signature timestamp. Audit-log tie: `documents.disclosureGeneratedAt` MUST be ≥3 days before `documents.signedAt`. Route guard enforces this.

**Biggest risk if you ignore me:** Even one FF-3 contract with wrong disclosure timing = personal-founder liability + precedent for class cert.

---

## 258. Sumayyah Idris — Plaintiff RESPA attorney (referral-fee claims)

**Lens:** Referral-fee chain analysis.

**What I see:** You recommend title agents, escrow, appraisers. RESPA §8 caps unearned fees. But I'm looking for the chain: (1) AcreOS recommends Escrow Agent X, (2) Escrow Agent X gives AcreOS a 0.5% referral bounce, (3) customers use Agent X because you recommended them, (4) but the disclosure says "no referral compensation." That's §8 violation × customer count.

**Hostile move:** I'd FOIA the state banking regulator, request your vendor agreements, and cross-reference them against your disclosures to customers. Discrepancy = evidence of knowing concealment. I'd also look for disguised compensation: "software integration fees," "data partnerships," "marketing co-op." If any referral partner pays you for the referral, it's an unearned fee unless explicitly disclosed.

**What you should do:** Xiomara's move: build `vendor_referral_fees` table with full transparency. For *every* vendor relationship (title, appraiser, contractor), document: (1) compensation type, (2) amount/percentage, (3) disclosed-to-customers flag. Annual audit by outside counsel. Customer-facing page `/transparency/vendor-partnerships` lists all referrals + compensation. This is boring but defensible.

**Biggest risk if you ignore me:** RESPA violation = $5,000-$25,000 per violation. 50 customers × 3 vendor relationships each = $750K+ exposure.

---

## 259. State AG Civil Rights division — Investigator

**Lens:** Disparate-impact patterns in tenant screening.

**What I see:** RS-2 ships adverse-action *send*. But I'm reading the screening logic: does your late-fee calculation vary by property location (e.g., higher fees in certain ZIP codes that correlate with racial demographics)? Does your screening threshold differ for different customer segments?

**Hostile move:** I'd subpoena 500 screening results + adverse actions from your BH pilot. I'd run a statistical analysis: do Black tenants have higher adverse-action rates than white tenants, controlling for the same property/income factors? If yes, that's prima-facie disparate impact under Regulation B. I wouldn't need to prove intent — statistical evidence is enough.

**What you should do:** Wynne's move #1 + audit discipline. Before shipping BH at scale, run a historical disparate-impact audit: did any manual-review cohort show statistically significant differences by protected class? Document the audit + remediation. Wire a `fair_lending_audit` job that runs monthly, flags >5% divergence by race/national-origin/gender. This is defensive documentation that survives discovery.

**Biggest risk if you ignore me:** State AG enforcement action + consent order requiring you to reprove fairness + audit $500K+ annually for 5 years.

---

## 260. CFPB Enforcement Lead — Federal regulator

**Lens:** Consumer-finance complaint patterns.

**What I see:** You process leads, deals, notes. If you have 50 customers and 5 of them file complaints to CFPB about "I was screened and never told why," that's a pattern. CFPB has aggregate-complaint tracking. If complaint rate is >5% of customer base, that's a Supervision work item.

**Hostile move:** I'd track CFPB complaints by vertical, by feature, by cohort. If Notes vertical has a 10% complaint rate vs Land's 2%, I'd open a Supervision file on Notes. If complaints spike after you add a new AI-driven compliance-disclosure feature, I'd scrutinize the disclosure accuracy (hallucination risk). I'd also look for "same complaint, different words" patterns: 10 different customers saying "the app said I qualified for a loan but never explained why."

**What you should do:** Camila's move + Indira's move: wire complaint-intake funnel. Customers with negative experience → feedback form → tagged by issue → routed to support + product. Ship a monthly CFPB-readiness dashboard: complaint topics, trends, resolution rate. Pair with eval harness (FW-THEO-1) to detect hallucination spikes that correlate with complaint jumps.

**Biggest risk if you ignore me:** CFPB Supervision sweep + consent order requiring you to remediate all complaints within 30 days + third-party compliance monitor.

---

## 261. Bryce Henningsen — Short-seller / activist analyst

**Lens:** Revenue-quality red flags.

**What I see:** You're pre-Series A, projecting "hockey-stick" growth. But I'm reading your cohort retention: do Land customers at 12-month ARR churn? Do Note customers reactivate after cancellation? Do you have a "land" customer who's actually just churned SMB software that rotates through all SaaS tools quarterly?

**Hostile move:** I'd model your MRR-churn curve: if cohort-month-0 (signup cohort) has 30% churn by month-6, your LTV/CAC is underwater. I'd also look for "logo expansion churn": customer upgrades to 3 vertical packs + Founder Plan at month-4, then downgrades to Free at month-10. That's "expansion revenue that looked sticky but wasn't."

If you raise Series A at $12M valuation on "hockey stick," I'd short you: I'd argue the churn trajectory is unsustainable and you'll need to lower guidance within 6 months.

**What you should do:** Marisol's move: ship NRR + GRR + retention cohort dashboard visible to board. Pre-emptively publish 24-month unit economics per vertical + per cohort. If NRR is 95% (churn is real), own it: "we're improving onboarding; expect NRR 110%+ by Q4." Proactive transparency > activist surprise.

**Biggest risk if you ignore me:** Public-market short attack + founder credibility collapse in fundraise.

---

## 262. Anya Greenberg — Investigative journalist (Bloomberg/Information shape)

**Lens:** Leak-friendly internal docs.

**What I see:** You have 8 team members. Slack is unencrypted. You commit to GitHub as a public org. Your founder writes weekly letters (FW-DIEGO-1). Somewhere in there is a "we're delaying BH launch because of legal exposure" message or a "Asher's account takeover was worse than we told customers" draft.

**Hostile move:** I'd find a junior employee who's annoyed (Calixto Ramos, #264, or similar disgruntled-customer type). I'd offer off-record interviews: "tell me about AcreOS's culture/security gaps/why you're leaving." I'd also FOIA your state AG filings (breach notifications), your board docs (if any are submitted for approval), your employment records (if there's a sudden departure). I'd cross-reference against Asher's account-takeover doc: "we found this on the internet, here's what we know, fill in the blanks."

**What you should do:** (1) Lock down Slack: no PII, no internal strategy, assume leaks. (2) Board docs: treat as confidential, watermark PDFs with employee name. (3) Founder letters: public-good angle only ("here's what we've learned about land investing"), no internal callouts. (4) Employee handbook: include a clear "what to discuss publicly vs not" guideline. (5) Departure process: exit interview + reminder of confidentiality.

**Biggest risk if you ignore me:** "AcreOS's phishing-induced breach was worse than disclosed; here's the internal email saying so" story kills your Series A narrative.

---

## 263. Fjorde Karlsson — Disgruntled customer ("you ruined my deal")

**Lens:** Public Twitter blame + chargeback threats.

**What I see:** A customer's deal fell through. They blame AcreOS ("your app crashed during escrow," "you said the property was available but didn't update in time"). They post on Twitter. They file a chargeback with their credit card processor. They email every customer in their buyer list: "don't use AcreOS, it cost me $50K."

**Hostile move:** I'd post a thread with screenshots of the app's "limitations" — maybe a UI glitch, maybe a legit gap. I'd get 5 other customers to retweet: "me too, AcreOS cost me a deal." I'd CC AcreOS support, copy the founder's personal Twitter, tag @StartupFail. I'd file a chargeback just to generate a dispute notice you have to respond to. Chargeback rate > 1% triggers payment-processor review.

**What you should do:** (1) Ship a post-deal checklist with caveats: "AcreOS is a record-keeper, not a deal guarantor." (2) SLA: no liability for "missed updates" — customer is responsible for refreshing data. (3) Customer-success onboarding: in first call, set expectations ("AcreOS is 1 of 10 tools you'll use; we're not your deal-maker"). (4) Chargeback playbook: respond within 7 days, include order confirmation + terms of service. (5) Reputation monitoring: Feedbackly, Trustpilot, Twitter alerts.

**Biggest risk if you ignore me:** Chargeback rate spikes to 2%. Stripe flags your account for "high dispute rate." Stripe freezes 8% of your monthly revenue for 180 days. Cash flow crisis.

---

## 264. Calixto Ramos — Churning customer (silent ghost)

**Lens:** What's-keeping-me motion.

**What I see:** A customer onboards, uses the app for 3 months, then stops logging in. No complaint, no churn email, just gone. When you email "we haven't seen you," they reply "we switched to [competitor] because you don't have [feature]." But you already built that feature in month 2 — they just never discovered it.

**Hostile move:** I'd tell the next 10 customers who follow: "AcreOS is hard to set up, the UI is confusing, I never figured out how to [common task]." I'd give them 1-star reviews on G2 + Capterra: "stopped using after 3 months." I'd also tell AcreOS directly: "your team never checked in once to see if I needed help." Churn without feedback = blame the platform.

**What you should do:** Camila's move: ship a "check-in" CSM sequence. Day-7 (after first deal added): email "here's what you've set up; next step is...". Day-21: Slack/email with a video: "here's how to set up campaigns." Day-45: pre-churn ladder — if no activity in 10 days, email "we haven't seen you; what's missing?" + 1-click calendly link to onboarding call. Retention rate improvement: 30-40%.

**Biggest risk if you ignore me:** Silent churn = negative word-of-mouth. Churned customers talk to SMB peer networks. Your TAM shrinks even though you don't know why.

---

## 265. Edmund Calloway — Abusive operator (using AcreOS to harass tenants)

**Lens:** FCRA-violator hiding behind AcreOS.

**What I see:** An operator onboards to BH. They use tenant screening + skip-trace to find borrower contact info. But their real goal: blackmail. They find a borrower's personal phone + email via skip-trace, then call them: "I have your personal info and your wife's email. Pay me $50K or I'm calling her boss."

**Hostile move:** I'd operate at the margin of AcreOS's terms of service. I'd use the screening output + skip-trace results as the attacker does: for harassment, not legitimate screening. I'd do it at low volume (2-3 borrowers/month) so no anomaly detector flags me. I'd use a burner phone + email. When AcreOS blocks my account, I'd create a new org + new payment method (clone a past customer's card, rotating every month).

**What you should do:** (1) Add a behavioral-abuse flag to the anomaly detector (move #5 of the security synthesis): "skip-trace lookups with no follow-up screening" = suspicious. (2) Verify high-risk orgs via KYC (Galen's move). (3) Wire a "report harassment" button into the app: borrowers can flag abusive use. (4) Tier-2 compliance: if abuse allegation arrives, freeze org + export full audit log to law enforcement. (5) Terms: explicit "harassment prohibited; violators liable for damages."

**Biggest risk if you ignore me:** You become a tool for tenant harassment. Lawsuit: plaintiff sues AcreOS for "facilitating harassment." Class action if 10+ borrowers were targeted.

---

## 266. Fraudster account-takeover specialist — Redux of Asher's attacker

**Lens:** Bypassing RS-4..RS-7 controls.

**What I see:** You shipped RS-4 (session list), RS-5 (email-on-new-location), RS-6 (email-change confirmation), RS-7 (rate-limit on /api/leads/export). These are solid controls. But I'd target the *gaps*.

**Hostile move:** (1) Phishing targets a non-founder user (a VA or bookkeeper) instead of the founder. They have lower password entropy. When they get phished, they don't have 2FA. I export the borrower list as them, not the founder. (2) Or: I use a botnet of 100 US IPs to rotate the GeoIP fingerprint — makes "impossible travel" harder to detect. (3) Or: I steal the password at the password-reset step, not the login step. When the user resets, I beat them to it, change it again, lock them out.

**What you should do:** (1) Enforce 2FA org-wide for BH/FF customers, not just founders. (2) Improve GeoIP: use a library that detects botnet IPs + rotating VPN patterns. (3) Add a "confirming a password reset" screen that requires a security question + SMS code, not just email. (4) Session token TTL: 4 hours max for high-risk orgs, not 24 hours. (5) Logout + re-auth on any `security-relevant` change (email, 2FA, password).

**Biggest risk if you ignore me:** Asher's incident repeats at scale: 10 customers all targeted in a coordinated phishing campaign. Class action: "AcreOS failed to implement industry-standard incident-response controls."

---

## 267. Galvin Thorpe — Social engineer (calls support pretending to be founder)

**Lens:** Helpdesk-bypass.

**What I see:** You have a `/founder/recovery-console` and support staff can reset passwords, revoke sessions. But your support hiring is probably ad hoc: new Tier-1 support agent answers the phone, attacker says "hi, I'm the founder, I'm locked out, can you reset my password?"

**Hostile move:** I'd call at shift-change when the senior agent is gone. I'd say "I'm the founder, I forgot my password, I need access to [org] in the next 10 minutes for a investor call." Tier-1 agent is stressed, new, wants to help. They'd reset my password or send a password-reset link. I'd intercept that link (if email is changed) or use it to log in. I'd be inside in 2 minutes.

**What you should do:** (1) Support protocol: any identity-relevant request (password reset, email change, session revoke) requires **out-of-band verification** (SMS code sent to phone on file, not email). (2) Escalation: Tier-1 cannot reset passwords; only Tier-2 + identity verification can. (3) Call recording: all support calls are recorded + reviewed (deters social engineering). (4) Role-based access: support staff see blurred org data — they can't see the borrower list, only the user's activity log. (5) Support audit: if a support agent resets an account, `auditLog` row is `severity=critical` + support_case_id correlation + manager notification.

**Biggest risk if you ignore me:** A support agent falls for the impersonation. Your most sensitive account is compromised. Founder has to explain to investors why the breach happened through support, not engineering.

---

## 268. Velda Crispin — Data scraper / competitor

**Lens:** Rate-limit evasion and public-surface scraping.

**What I see:** You have a `/api/properties/search` endpoint. Let me guess: it's paginated, but not rate-limited. You have public deal-room URLs. Public property-comp views. I can write a bot to (1) enumerate all deals in the system, (2) pull comps for each, (3) export to a CSV and feed it to Zillow or a competitor app.

**Hostile move:** I'd rotate IPs (AWS lightsail rotating instances), randomize delays (2-15 seconds between requests), and spoof user-agent strings. I'd sleep the bot for 30 minutes every hour to avoid pattern detection. I'd scrape the entire US property dataset (10M properties, 50M comps) over 6 months. Then I'd sell the dataset to real-estate platforms or use it to build a better competitor.

**What you should do:** (1) Rate-limit `/api/*` endpoints: 100 req/min per IP, 10,000 req/day per org. Tie to `X-API-Key` header for authenticated requests. (2) CAPTCHAs: on repeated 429 responses, challenge the client with a hCaptcha. (3) Behavioral detection: if a single API key pulls 1,000 properties/hour in sequential order, flag it + alert founder. (4) Public surfaces: add `<meta name="robots" content="noindex">` to public deal-room HTML + `/robots.txt: disallow /api/.*`. (5) Terms of service: explicit "no scraping" clause + $1,000/day liquidated damages for violations.

**Biggest risk if you ignore me:** A competitor scrapes your entire property + comp database and launches a free competitive offering. Your TAM shrinks.

---

## 269. DDoS attack coordinator — L7 floods

**Lens:** WAF-evasion patterns.

**What I see:** You host on Fly.io. Fly has DDoS protection via Fly Shield. But Shield is a network-level service — it detects volumetric attacks (millions of packets from 1,000 botnets). An L7 (application-level) DDoS is harder: I make *valid* HTTP requests, just a lot of them. I request `/api/properties/search` 1,000 times/second with different search terms. Your app has to process each, which burns CPU + database connections.

**Hostile move:** I'd coordinate a botnet of 10,000 nodes, each making slow requests to `/api/properties/search` with expensive queries (wildcard search, high page-count). Each request takes 500ms (valid), but 10,000 of them saturate your database. I'd rotate user-agents, IPs, and search terms so signature-based detection doesn't flag me. Within 10 seconds, your app is unresponsive.

**What you should do:** (1) Rate-limit aggressively: 10 req/sec per IP, 100 req/sec per authenticated user. (2) Query timeout: any `/api/*` query that takes >5 seconds is killed. (3) Caching: cache property-search results for 5 minutes. Cache hits don't hit the database. (4) Autoscaling: wire Fly.io auto-scaling to CPU + memory thresholds. If attack starts, spin up 5 more machines. (5) Monitoring: alert if error rate > 5% or response-time p95 > 1s.

**Biggest risk if you ignore me:** Competitor DDoSs you during your Series A close. Investors see your app down. Trust collapses.

---

## 270. Mei-Lin Park — GDPR opt-out / data-erasure aggressor

**Lens:** Filing DSARs to test compliance.

**What I see:** You have a privacy policy. It says "respond to data-subject access requests within 30 days." But does it? I'd file a DSAR: "I want all data about john@example.com." Then I'd count the days. On day 31, if I haven't heard from you, I'd file a complaint with your EU regulator. GDPR violation = €20M or 4% of global revenue, whichever is higher.

**Hostile move:** I'd file 10 DSARs for 10 different email addresses I control. I'd file them staggered (one per week). I'd track response times. If even one is late, I'd cite it as evidence of systematic non-compliance + file a regulatory complaint. I'd also request "the basis for this processing" — and if you can't cite a lawful basis (consent is expired, contract is void), I'd request deletion + file for improper processing.

**What you should do:** (1) Privacy ops: hire a DPO or outsource to a privacy consultancy. (2) Automation: build `/api/privacy/dsar` endpoint that exports all data for a user + tenant + note associations within 24 hours. (3) Deletion: implement full cascading delete of user + org data, with audit log of what was deleted. (4) Compliance calendar: track all DSAR requests in a spreadsheet with response deadline + completed-date. (5) Regular audit: quarterly, submit a DSAR on yourself, measure response time.

**Biggest risk if you ignore me:** GDPR fine of €1M+ (4% of revenue if you're at Series A scale). DSAR complaint + regulator investigation. Reputation damage: "AcreOS failed to respect user privacy."

---

## Category synthesis — Adversarial / Stress (5 recommendations)

### A1. Substantive adverse-action attestation + CRA specificity (Ophelia + Heath)

**Cluster:** Ophelia (256), Heath (257), Sumayyah (258)

Replace checkbox-theater with Wynne's substantive 3-screen form. Tie adverse-action send to screening-result timestamp (not batch cron). Cite the actual CRA in every notice. Implement disclosure-generation *before* signature (TILA timing gap). Store all adverse-action records in legal-hold-proof archive. This is "theater that works in depositions" — regulators + plaintiffs expect to see substance.

### A2. Vendor-relationship transparency + referral-fee audit (Xiomara + Ophelia)

**Cluster:** Xiomara (258), Ophelia (256)

Build `vendor_referral_fees` table documenting every vendor relationship (title, appraiser, contractor). Annual audit by outside counsel. Customer-facing `/transparency/vendor-partnerships` page lists all referrals + compensation. This is RESPA defense + plaintiff-attorney frustration (can't find hidden kickbacks).

### A3. Fair-lending audit + disparate-impact detection (State AG + Wynne)

**Cluster:** State AG (259), Wynne (69)

Before BH scales, run a historical disparate-impact audit. Document findings + remediation. Wire a `fair_lending_audit` job that runs monthly, flags >5% divergence by race/national-origin/gender. This is regulatory defense + consent-order mitigation.

### A4. Behavioral abuse detection + high-risk-org KYC (Edmund + Anya)

**Cluster:** Edmund (265), Anya (262), Galvin (267)

Add abuse-pattern detection to anomaly_detector.ts: "skip-trace lookups with no screening follow-up" = suspicious. Implement KYC for high-risk orgs (Galen's move). Support protocol: all identity-relevant requests require out-of-band verification (SMS + Tier-2 escalation). Call recording for all support interactions. This is defensive documentation + incident mitigation.

### A5. Rate-limiting + L7 DDoS protection + scraping prevention (Velda + DDoS + social engineer)

**Cluster:** Velda (268), DDoS (269), Galvin (267)

Implement aggressive rate-limits: 10 req/sec per IP, 100 req/sec per authenticated user. Autoscale on CPU + response-time triggers. Cache expensive queries. Add `<meta robots="noindex">` + `/robots.txt` blocks on public surfaces. Support escalation: Tier-1 cannot reset passwords; only Tier-2 + out-of-band verification. This is operational hardening + attack-surface reduction.

---

*Synthesized 2026-05-08. These 15 personas write FROM the attacker/litigant/competitor vantage. The cluster is sequenced: (1) plaintiff attacks (adverse-action form, timing, referral fees), (2) regulator attacks (disparate impact, CFPB complaints), (3) operational attacks (harassment, social engineering, scraping, DDoS). The playbook is: substantiate legal defenses early (forms, audits, transparency) + harden operational surface (rate-limits, KYC, monitoring). Ties to Asher-takeover §1..§7, RS-1..RS-7, post-may1-resweep §2.*


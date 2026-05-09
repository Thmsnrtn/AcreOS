# Security / Compliance — 15 personas (slots 61–75)

## 61. Caspian Drake — CISO (2 prior seats)

**Lens:** SOC 2 evidence collection and audit readiness.

**What I see:** You've shipped P0-22 recovery console + RS-1..RS-7; audit-log exists; encryption on skip-trace results. But SOC 2 Type I requires continuous evidence *collection*, not retrofit. You lack automated access-log archival, a control-testing runbook per entity (users/orgs/data), and a SOC 2–specific audit dashboard that feeds your auditor.

**Highest-leverage move:** Build `/founder/compliance-dashboard` wired to `auditLog` + `legalHolds` + `fieldEncryption` metrics. Show: 2FA adoption %, session-revoke history, encryption-key rotation dates, breach-notification sends, legal-hold scope accuracy. Export to PDF for annual attestation. Route: `routes-founder-compliance.ts`. Effort: 1 week. Ship with an accompanying runbook: "SOC 2 Type I evidence workflow."

**Biggest risk:** If an auditor asks "how do you verify deletion compliance?" and your answer is "we have a retention policy but no audit trail of actual deletes," you fail the engagement.

---

## 62. Ife Adejumo — Application security engineer (pen-tested 100+ apps)

**Lens:** Auth flaws in real-world deployments.

**What I see:** Clerk MFA is solid. Session revocation (P1-50) is partial. But I notice: no session-fixation check (attacker logs in, gives you a session token), no CSRF-token rotation per-POST, no rate-limit on `/api/auth/change-password` (Asher's attacker changed it 2x in 3 hours), no lockout after 5 failed logins.

**Highest-leverage move:** Add per-route rate-limits in `securityMiddleware.ts`: 5 failures → 15-min lockout on `/api/auth/login`, 3 attempts → 24-hr lockout on `/api/auth/change-password`, 3 attempts → admin-alert on `/api/auth/change-email`. Tie each failure to IP + user_id. Effort: 2 days. Test with fuzzing: `npm run security:fuzz -- --endpoint /api/auth/`.

**Biggest risk:** An attacker cycles through 100 password-reset requests at 09:00, locks out 100 accounts, sells the locked-account list to malware rings.

---

## 63. Bjorn Karlsson — Infrastructure security engineer (cloud hardening at scale)

**Lens:** IAM tightening and least-privilege.

**What I see:** Fly.io deployment is fine. But your Stripe, SendGrid, Twilio, and OpenAI tokens live in `.env`. Do they have scopes? Are they rotated quarterly? Can a compromised `.env` read *all* Stripe customers' payment methods, or only the ones for this org?

**Highest-leverage move:** Inventory all vendor API keys (`npm run audit:api-keys -- --strict`). For each, implement: (1) scopes table `vendor_api_scopes` (service, allowed_actions, expires_at), (2) key rotation cron (quarterly), (3) per-org tenant-scoping (Stripe key can only touch this org's customers). Effort: 3 days. Ship a runbook: "Quarterly API key rotation calendar."

**Biggest risk:** One leaked SendGrid token = attacker sends phishing from your domain name to your entire customer base.

---

## 64. Magdalena Kowalski — Pentest red team (25 years offensive)

**Lens:** Chained vulns and exploit chains.

**What I see:** Single vulns (SSRF on `/api/webhooks/test`, fixed P0-12) are patched. But I'd chain: (1) steal a session token via XSS in a borrower email template, (2) use the session to access `/api/leads/export`, (3) combine with rate-limit evasion to download 50K borrower emails, (4) sell the list. Your fixes patch #2 in isolation. The chain still works if #1 succeeds.

**Highest-leverage move:** Add input-sanitization audit (`npm run audit:xss -- --strict`) to every email template, campaign subject, and borrower-facing field. Teach the team: "User input in email = attacker-controlled code." Pair with a biweekly red-team slot (you + one eng, 4 hours, find chained vulns). Effort: 1 week setup + 4 hours/week ongoing.

**Biggest risk:** Borrower gets a phishing email that looks like it came from their investor, clicks, and AcreOS's lack of CSP headers lets the attacker exfiltrate their wire instructions.

---

## 65. Devon Mitchell — Blue team engineer (detection at scale)

**Lens:** TTPs (tactics, techniques, procedures) over IOCs.

**What I see:** You log logins, exports, document downloads, email sends, password changes. Good. But you don't flag *patterns*: "5 document downloads in 60 seconds," "export at 02:00 UTC," "login from 3 countries in 1 hour." Asher's attacker did all three; the system logged each but didn't correlate.

**Highest-leverage move:** Build an `anomaly_detector.ts` service that runs on every `auditLog` INSERT: (1) sliding-window check — "5 document downloads in 60s?" flag severity=high, (2) geolocation impossible-travel (last login Tucson, this one Sofia, travel time <2 hours?), (3) time-of-day outlier (this user always logs in 08:00–17:00 MST; now 02:00 UTC). Emit to a `/founder/security-alerts` dashboard. Effort: 2 weeks. Integrate with email-on-new-location (RS-5).

**Biggest risk:** You catch the anomaly at +4 hours. The attacker already sent the phishing email to 1,800 borrowers.

---

## 66. Ravi Krishnan — SOC 2 auditor (Big 4 partner)

**Lens:** Control evidence quality.

**What I see:** You have `/founder/recovery-console` (P0-22), audit-log, legal-holds. But "evidence" means: a timestamped screenshot + a signed attestation from the controller. You lack a control-testing runbook that an auditor can follow: "To verify access controls, run these 5 steps; the audit-log output is the evidence."

**Highest-leverage move:** Write `docs/runbooks/09-soc2-control-testing.md` (1 runbook per critical control: 2FA enrollment, session revocation, skip-trace gating, legal-hold enforcement, data-deletion compliance). Each runbook: (1) objective, (2) test procedure (exact clicks + SQL queries), (3) expected outcome, (4) screenshot template. When your auditor visits, they run the runbooks + screenshot. Evidence = runbook output. Effort: 3 days. Ties to Caspian's compliance-dashboard.

**Biggest risk:** Auditor asks "how do you test that legal holds actually prevent deletion?" and you have to manually run queries for them instead of handing them a runbook.

---

## 67. Ottilie Andersen — GDPR DPO (advises 50+ EU SaaS)

**Lens:** Data-minimization discipline.

**What I see:** You collect borrower emails, phone numbers, property addresses for skip-trace and screening. GDPR Article 5 says: collect only what you need. Your skip-trace results (P0-5, encrypted) include full contact history. Do you *need* the 2018 phone call log? Or just the current number? Do you have a deletion-on-request workflow that actually *deletes*, or just soft-deletes?

**Highest-leverage move:** Audit the schema for over-collection: (1) find every `jsonb` field storing PII (skip-trace results, screening notes, borrower contact history), (2) for each, document: "why do we keep this? for how long?", (3) implement a data-minimization function that strips unnecessary fields before storage. Example: skip-trace result should store *only* the current phone + email, not the full lookup history. Effort: 1 week. Ties to Wynne's data-retention policy (move #4).

**Biggest risk:** An EU customer requests a DSAR (data-subject access request). You hand them a 50MB JSON dump of encrypted skip-trace history they didn't know you kept.

---

## 68. Maya Patel — CCPA compliance engineer (built CCPA stack at martech SaaS)

**Lens:** The "do not sell" toggle and opt-out workflows.

**What I see:** RS-2 (adverse-action notice send) ships. But CCPA §1798.120 says: if you're using borrower data for a "sale" (any third-party monetization — even anonymized), you must offer a "do not sell my info" toggle. AcreOS doesn't sell data today. But what about future integrations (MLS feed, lien data vendor)? The toggle doesn't exist.

**Highest-leverage move:** Add `users.ccpaOptOut` boolean + annual re-confirmation email. Wire a privacy-preference API: `PATCH /api/account/privacy-prefs` with consent fields (analytics, marketing, thirdPartyData). Render on `/account/privacy-settings`. Effort: 4 days. Pre-emptive, but future-proofs against CCPA class actions when you integrate a data vendor.

**Biggest risk:** You integrate a lien-data vendor without a CCPA opt-out surface. A customer sues; settlement includes $500K in statutory damages + attorney fees.

---

## 69. Wynne Ohaegbu — FCRA compliance lawyer (plaintiff-side FCRA expertise)

**Lens:** Adverse-action notice substantive form.

**What I see:** RS-2 ships adverse-action *send*. Good. But "substantive" (what regulators audit) means: (a) clear statement "we took this action based on information from X CRA," (b) specific adverse factors ("property valuation below 40th percentile"), (c) right to dispute + free credit report access, (d) CRA contact info. Your current template is checkbox theater. Upgrade to a 5-field form: user attests permissible purpose, signs (not checkbox), receives timestamped confirmation.

**Highest-leverage move:** Replace `FcraAttestationModal.tsx` (if exists) with a substantive 3-screen form: (1) questionnaire ("using to evaluate lease?"), (2) signature block ("I attest under penalty of perjury..."), (3) confirmation + right-to-dispute language + CRA contact. Template: `forms/fcraSubstantiveAttestion.tsx`. Audit log: `attestation_type: 'substantive'` instead of 'checkbox'. Effort: 3 days. Ties to RS-1 skip-trace gating.

**Biggest risk:** In discovery, opposing counsel asks "did you explain permissible purpose?" and your checkbox UI is exhibit A of your negligence.

---

## 70. Augusto Salinas — TILA compliance (25 years mortgage)

**Lens:** Disclosure timing and form accuracy.

**What I see:** TX §5.069 disclosure (P0-17) is scaffolded in `disclosureRegistry.ts`; comments say "pending attorney review." TILA (15 USC §1638) has strict timing: disclosures must be provided 3 business days before consummation. If AcreOS generates a contract-for-deed doc and Pax injects the disclosure, does the timestamp match the signing date? Or the generation date? Regulatory auditors care.

**Highest-leverage move:** Before FF-3 contracts-for-deed close, hire a Texas consumer-finance attorney to review: (a) disclosure text accuracy, (b) timestamp logic (generated_at vs signed_at), (c) audit trail. Then implement: `documents.disclosureReviewedAt` column + `attorneyAttestationId` foreign key. Route guard: blocks live use until `disclosureReviewedAt IS NOT NULL`. Effort: 5 days + external counsel. Non-negotiable for FF customers.

**Biggest risk:** You close a $200K contract-for-deed and the disclosure timestamp is wrong. Customer sues; TILA damages = 2x the finance charge + attorney fees + statutory minimum $500.

---

## 71. Xiomara Beltrán — RESPA compliance (title-side)

**Lens:** Referral-fee chain analysis.

**What I see:** You integrate with title agents, escrow, loan officers. RESPA (12 USC §2601) caps kickbacks: if you *recommend* a title vendor and they cut you a check, you've violated section 8. Your current integration model (email intros, affiliate links) is murky. Do you have a formal referral-fee disclosure?

**Highest-leverage move:** Document every vendor relationship in a `vendor_referral_fees` table: `vendor_id`, `referral_type` (enum: affiliate, revenue_share, none), `percentage`, `annual_cap`, `disclosedToCustomers` boolean. Build a `/founder/vendor-compliance` dashboard showing all active referrals. Annual audit: confirm each is disclosed + within caps. Effort: 3 days. Future-proofs against RESPA class actions.

**Biggest risk:** An investigator asks "do you get paid when customers use your recommended title agent?" and your answer is "uh, I'd have to check."

---

## 72. Itzel Ramos — AML compliance (Bank Secrecy Act)

**Lens:** SAR (suspicious activity report) triggers.

**What I see:** You process deals, note transactions, wire instructions. Under FinCEN rules, if you see a customer moving $150K across 10 accounts in one day (structuring) or wiring to sanctioned jurisdictions, you must file a SAR within 30 days. Today: zero AML logic in the codebase.

**Highest-leverage move:** Implement an `amlScreener.ts` service with three rules: (1) transaction volume: if a single org's wire total exceeds $500K in 1 week, flag for review, (2) velocity: if a customer opens 5+ accounts in 24 hours (signup spam), flag, (3) jurisdiction: if a wire destination is OFAC-sanctioned, block + alert. Tie to `/founder/compliance-alerts`. Effort: 2 weeks (includes OFAC list ingestion). Optional for now, critical post-Series A.

**Biggest risk:** You process $1M in wires from customers and file zero SARs. FinCEN issues a subpoena; remediation costs $100K+ in legal + fines.

---

## 73. Galen Boyd — KYC engineer (identity verification flows)

**Lens:** Edge-case identity proofing.

**What I see:** You collect name, email, phone. Real KYC (know your customer) should verify identity via ID scan + liveness check, especially for high-risk orgs (BH tenant screening, financial note transactions). Today: trust-on-signup. That's fine for SMB. Blocks enterprise pilots.

**Highest-leverage move:** Integrate a third-party KYC vendor (Persona, Vouched, AU10TIX) for high-risk orgs. Gate: if org.riskScore > threshold OR org.monthlyNoteVolume > $1M, require KYC before feature unlock. Route: `POST /api/org/kyc/start`, webhook handler for completion. Effort: 2 weeks (including vendor integration + risk-scoring logic). Ties to Wynne's permissible-purpose attestation.

**Biggest risk:** A customer onboards under a fake identity, funds a bad deal, disappears. You're liable for enabling fraud.

---

## 74. Penelope Achterberg — PCI DSS auditor (Level-1 compliance)

**Lens:** Cardholder-data scope reduction.

**What I see:** You use Stripe for subscription payments. Stripe handles card tokenization; you never touch raw PAN. That's good (out-of-scope). But I see: do you store `stripe_payment_method_id` in plaintext? Do you have a deletion workflow? Can a support agent export a customer's stripe ID + metadata (potentially deanonymizing)?

**Highest-leverage move:** Audit Stripe data handling: (1) find every column storing payment-method metadata, (2) encrypt `stripe_payment_method_id` using the same `fieldEncryption.ts` as skip-trace (P0-5), (3) implement a deletion cascade — if org is deleted, `DELETE FROM stripe_event_logs WHERE org_id = X` (audit trail stays, but payment-method refs are purged). Effort: 2 days. Ties to Sasikia's legal-hold scope (P0-23).

**Biggest risk:** A support agent exports a customer database for "testing." The export includes stripe_payment_method_ids. That's cardholder data in plaintext = PCI DSS violation = $100K+ fine.

---

## 75. Inigo Vargas — Attack surface analyst (maps adversarial surface)

**Lens:** Reachability and exploit chains.

**What I see:** You've patched individual vulns (SSRF, injection, auth). But have you run a reachability audit? Example: can an unauthenticated user reach `/api/properties/search` with a wildcard query, exfil all property addresses in a county? Can a low-privilege support agent reach `/api/admin/users/:id/password-reset` endpoint?

**Highest-leverage move:** Build an `ATTACK-SURFACE.md` doc mapping every endpoint to: (1) auth requirement (public/user/org-admin/founder-admin), (2) data sensitivity (public/private/pii), (3) blast radius if compromised. Use this to prioritize: public endpoints touching PII are tier-1. Pair with a monthly red-team slot (Magdalena's team) to find new surface. Effort: 1 week initial doc; 4 hours/month ongoing. Deliverable: an ordered backlog of reachability fixes.

**Biggest risk:** A malicious vendor's engineer requests a read-only API key "for debugging" and your permission model grants them access to all customers' data instead of just theirs.

---

## Category synthesis — Security / Compliance (5 recommendations)

### R1. SOC 2 Type I evidence collection (Caspian + Ravi)

**Cluster:** Caspian (61), Ravi (66), Bjorn (63)

Implement `/founder/compliance-dashboard` showing 2FA adoption %, legal-hold enforcement, key-rotation dates, breach-notification send history, encryption-key audit trail. Pair with `docs/runbooks/09-soc2-control-testing.md` (testable runbooks per control). This is the fastest path to auditor-readiness: evidence collection becomes automated, not retrofitted. **Priority: weeks 1–2 (parallel with 30-day backlog).**

### R2. Client-side idempotency + P0-10 closure (Ife + Devon)

**Cluster:** Ife (62), Devon (65), Inigo (75)

Close the auth rate-limit gaps (5-fail lockout on login, 3-fail lockout on password-change) + Dropbox webhook idempotency (P0-10 — atomic claim + state-machine guard). These are exploitation entry points Magdalena would chain. Fix foundation first (per Ines' move #1), then layer compliance. **Priority: week 1 (P0).**

### R3. Skip-trace + disclosure attorney review (Wynne + Augusto)

**Cluster:** Wynne (69), Augusto (70), Xiomara (71)

Implement skip-trace permissible-purpose gate (`skip_trace_requests` table + route guard). Hire Texas counsel to review TX §5.069 disclosure text + timestamp logic before FF-3 contracts-for-deed go live. These are customer-launch blockers per post-may1-resweep §2. Wynne's move #1 + Augusto's move. **Priority: week 1–2 (blocker for BH/FF customers).**

### R4. Sensitive-mutation confirmation flows (Wynne + Ottilie)

**Cluster:** Wynne (69), Ottilie (67), Penelope (74)

Upgrade permissible-purpose click-through to a substantive 3-screen attestation form (questionnaire + signature + confirmation). Add email-change confirmation to original address (blocks the "attacker changes contact email" TTP). Wire annual CCPA opt-out re-confirmation. These are the "theater that works in depositions" moves Wynne values. **Priority: weeks 2–3.**

### R5. Ambient threat detection + red-team cadence (Ife + Devon + Magdalena)

**Cluster:** Ife (62), Devon (65), Magdalena (64), Inigo (75)

Ship `anomaly_detector.ts` (sliding-window checks for bulk downloads, impossible-travel, time-of-day outliers). Tie to email-on-new-location alert (RS-5). Establish a biweekly red-team slot (Magdalena + 1 eng, 4 hours, find chained vulns). This is blue-team discipline: detection + hunting, not just patching. **Priority: weeks 3–4 (ongoing after launch).**

---

*Synthesized 2026-05-08. These 15 personas converge on: (1) SOC 2 readiness via evidence automation, (2) auth rate-limiting + idempotency foundation, (3) customer-launch blockers (skip-trace, disclosure review), (4) sensitive-mutation protection, (5) ambient threat detection. The cluster is sequenced P0 (auth) → P0 (attestation) → P1 (ambient). Ties to FW-SAM-1/2, FW-WYNNE-1, FW-HARLOWE-1, RS-1..RS-7.*


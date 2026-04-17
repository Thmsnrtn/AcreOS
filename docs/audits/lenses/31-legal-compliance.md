# Lens 31 — Legal & Compliance Review

**Auditor role:** Legal/compliance reviewer
**Date:** 2026-04-15
**Scope:** GDPR/CCPA compliance, Terms of Service, Privacy Policy, data handling, Dodd-Frank seller financing, TCPA, CAN-SPAM, PII in logs/AI, financial data handling, regulatory risk.
**Method:** Static code review and documentation analysis. No runtime testing.

---

## Executive Summary

AcreOS has invested meaningfully in compliance infrastructure: a Dodd-Frank checker, usury screening, TCPA consent tracking, GDPR data export/deletion endpoints, a PII masking layer, a cookie consent banner, and structured regulatory intelligence. However, several high-severity gaps remain, primarily around incomplete GDPR/CCPA legal disclosures, PII leaking to third-party AI providers, cookie consent that is cosmetic rather than functional, and placeholder legal contact information in published policies. The compliance gate middleware exists but is not wired into any route. The platform's Dodd-Frank tooling is advisory only with no enforcement mechanism, which is appropriate for a software tool but must be clearly disclaimed.

---

## Findings

### P0 — Legal Liability

#### 31-P0-01: Placeholder address in Terms of Service and Privacy Policy
- **Files:** `client/src/pages/terms.tsx:206`, `client/src/pages/privacy.tsx:223`
- **Detail:** Both legal documents display `[Company Address]` as a literal placeholder. CCPA requires a physical mailing address in privacy policies (Cal. Civ. Code 1798.130(a)(2)). GDPR Article 13(1)(a) requires the identity and contact details of the controller. Shipping a live product with placeholder legal contact information exposes the company to regulatory enforcement.
- **Recommendation:** Replace with actual registered business address before any user-facing deployment.

#### 31-P0-02: Cookie consent banner does not gate tracking scripts
- **Files:** `client/src/components/cookie-consent-banner.tsx`, `client/src/lib/sentry.ts`
- **Detail:** The cookie consent banner stores the user's choice in `localStorage` ("accepted" or "declined") but no code reads this value to conditionally load or suppress tracking scripts. Sentry is initialized unconditionally in `client/src/lib/sentry.ts` with `replaysSessionSampleRate: 0.1` and `replaysOnErrorSampleRate: 1.0`, meaning session replays (which capture user screen interactions, form inputs, and PII on-screen) are recorded regardless of consent status. Under GDPR, session replay is a form of profiling requiring explicit opt-in consent. Under ePrivacy Directive (cookie law), non-essential cookies/tracking require prior consent.
- **Recommendation:** Condition Sentry replay initialization on consent status. Gate all non-essential tracking behind the consent check. When consent is "declined", suppress analytics and session replay entirely.

#### 31-P0-03: Lead PII sent to third-party AI providers in prompts
- **Files:** `server/ai/tools.ts:945,1514,1560,2036,2089-2092`, `server/ai/executive.ts:33-36`
- **Detail:** AI tool functions include lead names (`lead.firstName`, `lead.lastName`), email addresses (`lead.email`), and phone numbers (`lead.phone`) in function call results and tool hints that are returned as part of the conversation context to OpenRouter/OpenAI. The quality scoring function in `executive.ts:33-36` sends truncated user messages and assistant responses (which may contain lead PII) to a secondary LLM (DeepSeek via OpenRouter) for scoring. While the privacy policy states "Data sent to OpenAI is used only to process your requests and is not used to train their models," the OpenRouter and DeepSeek data processing terms may differ. There is no PII scrubbing layer between the application and LLM API calls.
- **Recommendation:** Implement a PII stripping pass on all data sent to external LLMs. Use the existing `maskString()` from `piiMasking.ts` on outbound AI payloads. Audit all AI providers for DPA coverage. Disclose OpenRouter and DeepSeek as sub-processors in the privacy policy.

#### 31-P0-04: Privacy Policy omits required CCPA disclosures
- **Files:** `client/src/pages/privacy.tsx`
- **Detail:** The Privacy Policy does not include: (a) a "Do Not Sell or Share My Personal Information" link or statement as required by CCPA/CPRA (Cal. Civ. Code 1798.120); (b) a description of CCPA-specific consumer rights (right to know, right to delete, right to opt out of sale, right to non-discrimination); (c) identification of categories of personal information collected and disclosed mapped to CCPA categories; (d) a 12-month lookback of data collection practices. Even if AcreOS does not sell data, the CCPA requires an affirmative statement to that effect.
- **Recommendation:** Add a dedicated CCPA/CPRA section to the Privacy Policy. Add a "Do Not Sell My Personal Information" statement (even if just to confirm no sale occurs). Map collected data to CCPA categories.

#### 31-P0-05: Privacy Policy does not list all sub-processors
- **Files:** `client/src/pages/privacy.tsx:104-118`, `docs/data-privacy.md:65-73`
- **Detail:** The Privacy Policy lists Stripe, OpenAI, Lob, and Regrid as third-party integrations. It does not disclose: OpenRouter (AI routing), DeepSeek (AI scoring), Twilio/Telnyx (SMS), AWS SES (email delivery), Sentry (error monitoring + session replay), Dropbox Sign/HelloSign (e-signing), Clerk (authentication), or Fly.io (hosting). The `docs/data-privacy.md` internal document lists some of these but is not the public-facing policy. GDPR Article 13(1)(e) requires disclosure of recipients or categories of recipients of personal data.
- **Recommendation:** Update the public Privacy Policy to list all sub-processors that receive or process personal data. Maintain a living sub-processor list and notify users of changes per GDPR Article 28.

### P1 — Compliance Gap

#### 31-P1-01: GDPR routes use `req.user` without type safety or null checks
- **Files:** `server/routes-gdpr.ts:15-17`
- **Detail:** The `getUser(req)` helper in the GDPR routes simply returns `req.user` with no null check and no type annotation. If the `isAuthenticated` middleware fails silently or `req.user` is malformed, calling `user.id` will throw an unhandled exception, exposing a stack trace rather than returning a proper error. The GDPR routes also do not use `getOrCreateOrg` middleware, so organization-level authorization is not enforced. Additionally, error responses in the GDPR routes use raw `res.status(500).json()` instead of the standard `Errors.*` helpers, violating the codebase error response convention.
- **Recommendation:** Use `AuthenticatedRequest` typing. Add null guard for `req.user`. Apply `getOrCreateOrg` middleware. Use `Errors.*` helpers for all error responses.

#### 31-P1-02: Compliance gate middleware is defined but never applied to routes
- **Files:** `server/middleware/complianceGate.ts`, `server/routes.ts` (no import/usage), all `server/routes-*.ts` files (no usage)
- **Detail:** The `complianceGate` middleware is fully implemented with usury checking for notes and Dodd-Frank flagging for seller-financed deals. However, a codebase-wide search confirms it is not imported or applied to any route handler. This means usury violations and Dodd-Frank warnings are never surfaced to users during actual note creation or deal operations, despite the security posture document claiming "Non-compliant notes are flagged before creation."
- **Recommendation:** Apply `complianceGate("note")` middleware to note creation/update routes. Apply `complianceGate("deal")` to deal creation routes for seller-financed dispositions. This is a documentation-vs-reality gap.

#### 31-P1-03: No TCPA consent enforcement in campaign routes
- **Files:** `server/routes-campaigns.ts`
- **Detail:** The campaign route file (1756 LOC) does not contain any reference to TCPA consent checking, opt-in verification, or consent status validation. While the `tcpaCompliance.ts` service exists and `server/ai/tools.ts:9` imports `checkTcpaConsentFromLead`, the campaign sending routes (the primary bulk messaging pathway) do not appear to gate sends on consent status. The security posture document claims "Pre-send verification on all SMS and phone campaigns" but the campaign routes show no evidence of this integration.
- **Recommendation:** Integrate `checkTcpaConsentFromLead()` into all SMS and phone campaign sending endpoints. Add consent verification as a hard gate (not just advisory) before outbound communications.

#### 31-P1-04: GDPR data export has a hard limit of 1000 records per table
- **Files:** `server/services/gdprService.ts:76-81`
- **Detail:** The `exportUserData()` function applies `.limit(1000)` to leads, deals, properties, and tasks queries, and `.limit(500)` to support tickets. GDPR Article 15 (Right of Access) requires providing a copy of ALL personal data. A user with more than 1000 leads would receive an incomplete export. There is no pagination mechanism or streaming export.
- **Recommendation:** Remove hard limits or implement paginated/streaming export to ensure completeness. Add a count verification step that warns if results were truncated.

#### 31-P1-05: GDPR anonymization does not cover all personal data tables
- **Files:** `server/services/gdprService.ts:101-168`
- **Detail:** The `anonymizeUser()` function deletes agent events, team messages, support tickets, tasks, sessions, and AI conversations, and anonymizes leads and the user record. However, it does not address: (a) `deals` table records; (b) `properties` assigned to the user; (c) `payments` table (borrower payment records); (d) `notes` table (acknowledged in comments but not acted on); (e) `activityLog` entries which may contain PII in metadata; (f) campaign records containing the user's sent emails/SMS; (g) audit log entries. The comment at line 14 says "seller-financed notes are retained for legal compliance" which is valid, but the PII in those records (borrower names, contact info) should still be anonymized while retaining the financial record.
- **Recommendation:** Extend anonymization to cover all tables containing user PII. For records with legal retention requirements, anonymize PII fields while preserving financial data.

#### 31-P1-06: No Data Processing Agreement (DPA) infrastructure
- **Detail:** No DPA template, reference, or mechanism exists in the codebase or documentation. Under GDPR Article 28, a written contract (DPA) is required with every data processor. AcreOS processes personal data on behalf of its users (who are data controllers for their leads/contacts). AcreOS itself needs DPAs with its sub-processors (OpenAI, Stripe, Sentry, etc.) and should offer a DPA to its customers.
- **Recommendation:** Draft and publish a standard DPA for customers. Ensure DPAs are in place with all sub-processors. Make the DPA available for download from the legal pages.

#### 31-P1-07: Privacy Policy lacks lawful basis for processing (GDPR Article 6)
- **Files:** `client/src/pages/privacy.tsx`
- **Detail:** The Privacy Policy describes what data is collected and how it is used but does not identify the lawful basis for each processing activity as required by GDPR Article 6. The policy should state, for each category of processing, whether it relies on consent, contractual necessity, legitimate interest, or legal obligation.
- **Recommendation:** Add a "Lawful Basis for Processing" section that maps each data processing activity to its GDPR Article 6 basis.

#### 31-P1-08: `piiMaskingMiddleware` is not registered as Express middleware
- **Files:** `server/index.ts`, `server/middleware/piiMasking.ts`
- **Detail:** The `installConsoleInterceptor()` is called at startup (confirmed at `server/index.ts:41-42`), which patches `console.*` methods. However, the `piiMaskingMiddleware` Express middleware (which creates `req.maskedBody` for safe logging) is never registered via `app.use()`. This means route handlers that log request bodies are logging raw PII unless they manually call `maskString()`. The structured `logger` module may or may not use the console interceptor depending on its implementation.
- **Recommendation:** Register `piiMaskingMiddleware` as global Express middleware. Verify that the structured logger routes through the patched console methods.

#### 31-P1-09: Sentry session replay captures PII without scrubbing
- **Files:** `client/src/lib/sentry.ts:14-17`
- **Detail:** Sentry session replay is enabled at 10% for normal sessions and 100% for error sessions. Session replay captures DOM state including form inputs, displayed names, email addresses, phone numbers, and financial data visible on screen. There is no `beforeSendTransaction` hook or Sentry privacy configuration (`maskAllText`, `blockAllMedia`, `maskAllInputs`) to scrub PII from replays. This means lead PII, deal financial data, and borrower information may be transmitted to and stored by Sentry.
- **Recommendation:** Configure Sentry replay with `maskAllText: true` and `maskAllInputs: true` at minimum. Add `blockSelector` rules for sensitive components. Consider disabling replay unless explicit user consent is obtained.

### P2 — Improvement

#### 31-P2-01: Terms of Service lacks arbitration class action waiver
- **Files:** `client/src/pages/terms.tsx:190-196`
- **Detail:** Section 10 mandates binding arbitration via AAA but does not include a class action waiver, jury trial waiver, or specification of individual-only arbitration. Without a class action waiver, the arbitration clause provides limited protection. Additionally, the arbitration clause does not specify a venue or governing arbitration rules (consumer vs. commercial).
- **Recommendation:** Add explicit class action waiver, jury trial waiver, individual arbitration clause, and specify AAA Consumer Arbitration Rules. Include an opt-out period (typically 30 days) for the arbitration clause.

#### 31-P2-02: Dodd-Frank checker is advisory only with no workflow integration
- **Files:** `server/routes-dodd-frank.ts`, `server/services/doddFrankChecker.ts`
- **Detail:** The Dodd-Frank compliance checker is a standalone POST endpoint that returns a risk assessment. It is not integrated into the deal creation or note creation workflow. A user can create a seller-financed note without ever running the checker. The checker correctly identifies exemptions and provides good legal citations (12 CFR 1026.36(a)(4)(i/ii)), but its advisory nature means compliance is entirely voluntary.
- **Recommendation:** Integrate the checker into the note/deal creation flow. At minimum, display a non-dismissable compliance summary when creating seller-financed deals. Consider requiring acknowledgment of checker results.

#### 31-P2-03: Data retention job uses raw SQL string interpolation
- **Files:** `server/jobs/dataRetention.ts:34-35`
- **Detail:** The retention job constructs SQL via `sql.raw()` with string interpolation of table and column names. While the values come from a hardcoded array (not user input), this pattern is fragile and would become a SQL injection vector if the retention rules were ever made configurable. The ISO date string is also interpolated directly.
- **Recommendation:** Refactor to use parameterized queries or Drizzle's query builder for the date condition. Table/column names can remain interpolated since they are compile-time constants.

#### 31-P2-04: Regulatory intelligence profiles are hardcoded and stale
- **Files:** `server/services/regulatoryIntelligence.ts:62-298`
- **Detail:** State regulatory profiles (usury limits, disclosure requirements, Dodd-Frank exemptions, water rights) are hardcoded in-memory with `lastReviewed: "2026-01-01"`. Only 10 states are covered (TX, FL, GA, NC, TN, AL, MS, AR, MO, OK). Users operating in other states (AZ, CO, NM, CA, OR, WA — common land investment states) receive no regulatory guidance. There is no mechanism to update these profiles without a code deployment.
- **Recommendation:** Move regulatory profiles to a database table. Add a review date tracking mechanism. Expand coverage to at least the top 20 land investment states. Add a disclaimer when profiles are more than 6 months old.

#### 31-P2-05: No record of user consent acceptance
- **Files:** `client/src/pages/terms.tsx`, `client/src/pages/privacy.tsx`
- **Detail:** Users are shown the Terms of Service and Privacy Policy as static pages linked from the auth page, but there is no mechanism to record that a user has read and accepted them. The onboarding flow does not include a checkbox for TOS/Privacy acceptance. There is no timestamped consent record in the database. This makes it difficult to prove consent was obtained and to notify users of policy changes.
- **Recommendation:** Add a TOS/Privacy acceptance checkbox during registration. Store a timestamped consent record in the database. Track policy version so users can be prompted to re-accept when policies change.

#### 31-P2-06: Borrower portal session does not enforce HTTPS-only cookies in all environments
- **Files:** `server/routes-borrower.ts:96-98`
- **Detail:** The borrower session cookie is set with `secure: process.env.NODE_ENV === 'production'`. In staging or development environments the cookie is transmitted over HTTP, which could expose session tokens. The borrower portal handles sensitive financial data (loan balances, payment history).
- **Recommendation:** Default `secure: true` for all environments. Use a separate flag to explicitly opt out for local development only.

#### 31-P2-07: E-signing service stores signer PII (name + email) in API calls
- **Files:** `server/services/eSigningService.ts:32-37`
- **Detail:** The Dropbox Sign integration passes signer names and email addresses to the external API. While necessary for the service to function, these transmissions are not explicitly disclosed in the privacy policy, and there is no DPA reference for Dropbox Sign / HelloSign.
- **Recommendation:** Add Dropbox Sign/HelloSign to the sub-processor list. Ensure a DPA is in place. Disclose in the privacy policy that signer information is shared with the e-signing provider.

#### 31-P2-08: Incident response plan has TBD legal counsel contact
- **Files:** `docs/INCIDENT_RESPONSE.md:71`
- **Detail:** The emergency contacts table lists "Legal Counsel" with "TBD" as the contact. A data breach requiring notification within 72 hours (GDPR) cannot wait for legal counsel to be identified. The plan also does not specify which state breach notification laws apply or maintain a list of state AG notification requirements.
- **Recommendation:** Identify and retain legal counsel. Pre-negotiate a breach response retainer. Add a state notification requirements matrix.

### P3 — Backlog

#### 31-P3-01: No age verification mechanism
- **Files:** `client/src/pages/privacy.tsx:197-202`, `client/src/pages/terms.tsx:80-82`
- **Detail:** Both policies state the service is for users 18+ and that children's data is not knowingly collected, but there is no age gate, checkbox, or verification mechanism during registration.
- **Recommendation:** Add an age confirmation during registration (checkbox or date of birth field).

#### 31-P3-02: Cross-organization market intelligence minimum cohort of 5 may be insufficient for anonymity
- **Files:** `docs/data-privacy.md:31`
- **Detail:** The data privacy document states that aggregated data is only shown when 5+ organizations have contributed. For rare county/property-type combinations, 5 organizations may be insufficient to prevent re-identification, especially in a specialized market like land investment where deal volumes are low.
- **Recommendation:** Evaluate k-anonymity thresholds. Consider increasing the minimum to 10 or adding differential privacy noise.

#### 31-P3-03: No cookie policy page
- **Detail:** The cookie consent banner links to the Privacy Policy and Terms of Service but there is no dedicated cookie policy that itemizes all cookies set, their purpose, duration, and whether they are first-party or third-party. GDPR cookie guidance recommends a granular cookie policy.
- **Recommendation:** Create a cookie policy page listing all cookies by category (strictly necessary, analytics, marketing). Allow granular consent per category.

#### 31-P3-04: No DSAR (Data Subject Access Request) tracking system
- **Detail:** The GDPR endpoints handle export and deletion but there is no ticketing, tracking, or audit trail for data subject requests. GDPR requires responding within 30 days with the ability to extend to 60. Without a tracking system, SLA compliance cannot be verified.
- **Recommendation:** Add a DSAR log table that records request type, timestamp, response date, and status.

#### 31-P3-05: Terms of Service does not address AI-generated content liability
- **Files:** `client/src/pages/terms.tsx`
- **Detail:** The platform heavily relies on AI for offer generation, document drafting, compliance analysis, and investment advice. The Terms state "We do not provide legal, financial, or investment advice" (line 63) but do not specifically disclaim liability for AI-generated outputs, explain that AI recommendations are not professional advice, or address intellectual property ownership of AI-generated content.
- **Recommendation:** Add a dedicated AI Usage section to the Terms covering: AI output disclaimer, no reliance on AI for legal/financial decisions, intellectual property of AI outputs, and user responsibility for reviewing AI suggestions.

#### 31-P3-06: Usury rate data sourced from 2024 statutes
- **Files:** `server/services/usury.ts:2`
- **Detail:** The comment states "Sources: state statutes as of 2024." Usury limits can change through legislation. Stale data could result in allowing rates that violate current law or unnecessarily flagging compliant rates.
- **Recommendation:** Add last-verified dates per state. Implement an annual review process. Consider integrating with a legal data API.

#### 31-P3-07: No explicit data processing records (GDPR Article 30)
- **Detail:** GDPR Article 30 requires controllers and processors to maintain records of processing activities. No such record exists in the codebase or documentation. This should document: categories of data subjects, categories of personal data, purposes of processing, categories of recipients, international transfers, and retention periods.
- **Recommendation:** Create and maintain an Article 30 Record of Processing Activities document.

---

## Compliance Infrastructure Inventory

| Component | Status | Location |
|-----------|--------|----------|
| Terms of Service | Exists, needs updates | `client/src/pages/terms.tsx` |
| Privacy Policy | Exists, significant gaps | `client/src/pages/privacy.tsx` |
| Internal Data Privacy Doc | Good quality | `docs/data-privacy.md` |
| Cookie Consent Banner | UI exists, not enforced | `client/src/components/cookie-consent-banner.tsx` |
| GDPR Data Export | Functional, limited | `server/routes-gdpr.ts`, `server/services/gdprService.ts` |
| GDPR Data Deletion | Functional, incomplete scope | `server/services/gdprService.ts` |
| Privacy Settings UI | Exists | `client/src/pages/privacy-settings.tsx` |
| PII Masking (console) | Active | `server/middleware/piiMasking.ts` |
| PII Masking (middleware) | Defined but not registered | `server/middleware/piiMasking.ts` |
| Prompt Injection Guard | Active | `server/middleware/promptInjection.ts` |
| Dodd-Frank Checker | Functional, standalone | `server/services/doddFrankChecker.ts`, `server/routes-dodd-frank.ts` |
| Usury Screening | Functional, 50 states | `server/services/usury.ts` |
| Compliance Gate Middleware | Defined but not wired | `server/middleware/complianceGate.ts` |
| TCPA Compliance Service | Exists | `server/services/tcpaCompliance.ts` |
| Regulatory Intelligence | 10 states covered | `server/services/regulatoryIntelligence.ts` |
| Legal Intelligence | Advisory | `server/services/legalIntelligence.ts` |
| Data Retention Job | Active, 7 tables | `server/jobs/dataRetention.ts` |
| Incident Response Plan | Exists, incomplete contacts | `docs/INCIDENT_RESPONSE.md` |
| Security Posture Doc | Good quality | `docs/security-posture.md` |
| Audit Log | Implemented | Multiple route files |
| DPA Template | Missing | N/A |
| Cookie Policy Page | Missing | N/A |
| DSAR Tracking | Missing | N/A |
| Article 30 Records | Missing | N/A |

---

## Risk Summary

| Severity | Count | Key Themes |
|----------|-------|------------|
| P0 | 5 | Placeholder legal info, PII to AI providers, cookie consent cosmetic only, CCPA gaps, undisclosed sub-processors |
| P1 | 9 | GDPR route safety, compliance gate unwired, TCPA not enforced in campaigns, export limits, anonymization gaps, no DPA, no lawful basis, PII middleware unregistered, Sentry replay PII |
| P2 | 8 | Arbitration clause gaps, Dodd-Frank not integrated, SQL interpolation, stale regulatory data, no consent records, borrower cookies, e-sign PII, incident response contacts |
| P3 | 7 | Age verification, k-anonymity threshold, cookie policy, DSAR tracking, AI liability disclaimer, stale usury data, Article 30 records |

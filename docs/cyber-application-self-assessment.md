# Cyber + Tech-E&O Application — Self-Assessment

**Owner:** Founder (with Brian Chen as underwriting POV)
**Last reviewed:** 2026-05-27
**Review cadence:** Annual + before every binder, before every customer security review
**Audience:** Coalition, Beazley, Chubb, AIG, Tokio Marine HCC underwriters; enterprise customer InfoSec reviewers

> **The single highest-leverage document AcreOS produces for an underwriter.**
> This is the long-form answer to the 30 questions that *actually appear*
> on the Coalition + Beazley applications, with AcreOS's honest current
> answer and a pointer to the underlying evidence. The founder should
> walk into the underwriting call with this open.
>
> "Honest" means: where we have the control, we point to it. Where we
> don't, we say so plainly. Underwriters distrust overclaiming far more
> than they distrust honest gaps.

---

## How to use this document

1. Read straight through before any underwriting call.
2. For each question, the answer is in two parts: **Current state** (factual, today) and **Evidence** (file path, command, or screenshot the underwriter can verify).
3. The five questions where AcreOS would *currently* be flagged for special-review tier are marked **⚠ GAP** with the remediation owner.

---

## A. Company + scope

### A1. What does AcreOS do?

**Current state:** AcreOS is a vertical operating system for Land Investors
(seller-financed note holders, dealer / wholesalers, buy-and-hold land
operators, fix-and-flip + subdivide operators). The platform combines a
CRM, deal intelligence (county + parcel data), AI-drafted communications
(via Claude / GPT), e-signing, payment collection via Stripe, and a
compliance moat (Dodd-Frank usury checking, TCPA pre-send verification,
AML pattern monitoring).

**Evidence:** `docs/security-posture.md`, `docs/data-privacy.md`,
`docs/audits/lenses/31-legal-compliance.md`

### A2. Number of employees + contractors with production access

**Current state:** 1 (founder). Production credentials are not shared with any contractor at this time.

**Evidence:** `docs/policies/security-awareness-training.md` §7

### A3. Number of customer organizations + total end-users

**Current state:** Pre-launch. < 10 paying orgs at submission time; < 50 end-users in production.

**Evidence:** internal MRR tracking

### A4. Annual revenue + 3-year projection

**Current state:** Pre-revenue at policy bind; trailing-3-month MRR projected at $200/mo trigger for Phase 0 → Phase 1 architecture lift.

**Evidence:** `docs/financial-mail-platform/PLAN.md`

---

## B. Data inventory

### B1. What classes of personal data do you collect, process, or store?

**Current state:**
- Account info: names, emails, organization names
- Property data: parcel addresses, APNs, acreage, assessed values (public records)
- Deal data: purchase/sale prices, dates, parties, documents
- Borrower data on seller-financed notes: name, mailing address, phone, payment history
- Payment data: handled by Stripe, **not stored** in AcreOS database (we hold customer-IDs only)
- Communication: emails + SMS sent through AcreOS

**Evidence:** `docs/data-privacy.md`

### B2. Do you collect or store cardholder data?

**Current state:** **No.** Stripe Elements tokenization means we never see card numbers. We store Stripe customer IDs + payment-method tokens only.

**Evidence:** `server/services/stripe*.ts`, `docs/data-privacy.md`

### B3. Do you collect SSN, EIN, or full TIN?

**Current state:** Partial. For 1099 generation, we collect TIN (full SSN/EIN) from customers' contractors. Stored encrypted via AES-256-GCM (`server/services/fieldEncryption.ts`).

**Evidence:** `server/services/fieldEncryption.ts`, encrypted column definitions in `shared/schema.ts`

### B4. Do you collect health data, biometric data, or children's data?

**Current state:** **No.** AcreOS is a B2B platform for adult land investors; no health, biometric, or minor data.

**Evidence:** N/A (negative)

### B5. Where is data stored geographically?

**Current state:** Primary database in Fly.io DFW (US-IAD primary region). Object storage in AWS S3 us-east-2. No data leaves the US for production storage.

**Evidence:** `fly.toml`, AWS S3 bucket configurations

---

## C. Authentication + access control

### C1. Do you require MFA for privileged accounts?

**Current state:** **Yes.** Enforced via `requireClerkMFA` middleware on `/api/admin/*`. JWT carries `factor_verification_age` claim; middleware fails closed.

**Evidence:** `docs/policies/mfa-enforcement-policy.md`, `server/middleware/requireClerkMFA.ts`, `server/routes.ts:2108`

### C2. Do you require MFA for all employees?

**Current state:** **Yes, by policy.** Founder MFA-enrolled on all production-touching surfaces (GitHub, Fly.io, Clerk dashboard, Stripe dashboard, AWS, Cloudflare, OpenAI, Anthropic, Sentry, Notion, 1Password).

**Evidence:** `docs/policies/security-awareness-training.md` Module 2, founder attestation

### C3. Do you enforce role-based access control (RBAC)?

**Current state:** **Yes.** Four customer-facing roles (`owner`, `admin`, `member`, `viewer`) plus `va` (virtual assistant) + founder. Permission checks via `requirePermission()` and `roleGuard` middleware.

**Evidence:** `server/middleware/roleGuard.ts`, `server/utils/permissions.ts`, `shared/schema.ts:241`

### C4. Do you have a documented off-boarding procedure?

**Current state:** Documented in `docs/runbooks/founder-account-recovery.md` (founder-side) and in the IR tabletop §4.3 (employee-side, hypothetical until first employee).

**Evidence:** `docs/policies/incident-response-tabletop-template.md` §4.3

### C5. Do you conduct quarterly access reviews?

**Current state:** Recently shipped — see Kareem's quarterly access-review cron (commit `a8f0024b`, SOC 2 CC6.2).

**Evidence:** Kareem's lane — `docs/exhaustive-completion/...` (SOC 2 controls)

---

## D. Network + infrastructure security

### D1. Where is your infrastructure hosted?

**Current state:** Fly.io (compute + managed Postgres) + AWS S3 (object storage) + Cloudflare (CDN + DNS + WAF). All US regions.

**Evidence:** `fly.toml`, `docs/vendor-inventory.md`

### D2. Is data encrypted in transit?

**Current state:** **Yes.** HTTPS-only with HSTS headers. Fly.io internal TLS for app↔Postgres + app↔Redis. AWS S3 TLS-only.

**Evidence:** `docs/security-posture.md`, `fly.toml` (`force_https = true`)

### D3. Is data encrypted at rest?

**Current state:** **Yes.** Postgres at-rest encryption via Fly.io managed disk. Field-level AES-256-GCM via `server/services/fieldEncryption.ts` for credentials, TINs, payment method tokens.

**Evidence:** `server/services/fieldEncryption.ts`, `docs/security-posture.md`

### D4. Do you rotate encryption keys?

**Current state:** **Annual key rotation procedure documented** with `server/scripts/rotateEncryptionKey.ts` re-encrypting all encrypted fields in place. ⚠ **First rotation not yet executed** (key issued 2026-03; first rotation due 2027-03).

**Evidence:** `docs/security.md` "Key Rotation Procedures"

### D5. Do you have a WAF?

**Current state:** Cloudflare WAF available at the edge. Custom rules not yet authored — relying on Cloudflare's managed rule set.

**Evidence:** `docs/audits/lenses/111-115-security-depth.md`, Cloudflare dashboard

### D6. Do you have DDoS protection?

**Current state:** **Yes.** Cloudflare's standard DDoS protection at the edge. No additional layer.

**Evidence:** Cloudflare dashboard

---

## E. Application security

### E1. Do you perform static code analysis (SAST)?

**Current state:** **Yes.** CodeQL runs on every PR + weekly via `.github/workflows/security.yml` with `security-extended` + `security-and-quality` queries.

**Evidence:** `.github/workflows/security.yml` job `codeql`

### E2. Do you perform dependency vulnerability scanning?

**Current state:** **Yes.** `npm audit` runs on every PR + weekly. CI fails on critical/high; warns on moderate. CVE-patch SLA: 24h critical, 7d high, 30d moderate.

**Evidence:** `.github/workflows/security.yml` job `npm-audit`, `docs/security.md` "CVE Patch SLA"

### E3. Do you have a CSP / XSS defense?

**Current state:** **Yes.** CSP with nonces on script-src. React DOM auto-escaping. Subresource Integrity gap exists on Swagger UI CDN assets (`docs/audits/lenses/111-115-security-depth.md` SRI-01) — remediation owner: Yuki.

**Evidence:** `server/middleware/security.ts`, lens 111-115

### E4. Do you have SQL injection defenses?

**Current state:** **Yes.** All DB queries via Drizzle ORM parameterized statements. ⚠ Lens 7 flagged `routes-maintenance.ts` SQL-injection via `sql.raw()`; remediation status to verify with Yuki.

**Evidence:** `docs/audits/lenses/07-security.md` SEC-002 (verify status)

### E5. Do you have CSRF protection?

**Current state:** ⚠ **CSRF middleware exists but was not historically applied** (`docs/audits/lenses/07-security.md`). Verify current mount status with `grep -rn "csrf" server/routes.ts`. Remediation owner: Yuki.

**Evidence:** `server/middleware/csrf.ts`, lens 7 SEC-002

### E6. Do you have rate limiting?

**Current state:** **Yes.** Tiered by endpoint class (default 100/min, auth 10/min, AI 50/min, webhook 200/min, import 5/min). Redis-backed.

**Evidence:** `server/middleware/rateLimit.ts`, `server/middleware/redisRateLimit.ts`, `docs/security-posture.md`

### E7. Do you scan secrets in source code?

**Current state:** Gitleaks runs as part of the security workflow. Pre-commit hook recommended but not enforced.

**Evidence:** `.github/workflows/security.yml`

### E8. Do you have a file-upload validation pipeline?

**Current state:** **Yes.** Magic-byte validation (`server/middleware/fileUploadSecurity.ts`), MIME-type matching, file-size limits, virus scan via ClamAV (planned — confirm production status).

**Evidence:** `server/middleware/fileUploadSecurity.ts`

---

## F. Logging + monitoring

### F1. Do you have centralized application logs?

**Current state:** Structured JSON via `server/utils/logger.ts`. Fly.io stdout retention ~3 days; production drain to SIEM-tier endpoint required.

**Evidence:** `docs/log-retention.md`

### F2. How long do you retain logs?

**Current state:** 90 days Sentry; ~3 days Fly default + production drain target 90 days; **indefinite** `audit_events` (append-only DB triggers).

**Evidence:** `docs/log-retention.md`

### F3. Do you have an audit log of privileged actions?

**Current state:** **Yes.** `audit_events` table is append-only at the DB layer (migration 0049). Every MFA decision, admin recovery action, permission grant, cross-org access is logged.

**Evidence:** `shared/schema.ts:4788` (auditEvents), migration 0049

### F4. Do you have error monitoring?

**Current state:** **Yes.** Sentry with environment tagging, source-map symbolication tied to git SHA, PII scrubber rules, breadcrumb trails.

**Evidence:** `server/utils/sentry.ts`, `client/src/lib/sentry.ts`

### F5. Do you have uptime monitoring + alerting?

**Current state:** Yes — synthetic health checks (`/api/founder/synthetic-checks/run`), Fly.io machine status. Paging tier (PagerDuty) not yet wired; alerts go to founder's email.

**Evidence:** `docs/disaster-recovery.md`, `docs/runbooks/fly-machine-failover.md`

---

## G. Incident response

### G1. Do you have a written incident response plan?

**Current state:** **Yes.** `docs/incident-response.md` + 26 specific runbooks in `docs/runbooks/`.

**Evidence:** `docs/incident-response.md`, `docs/runbooks/`

### G2. Do you conduct annual incident-response drills?

**Current state:** **Tabletop template authored** (`docs/policies/incident-response-tabletop-template.md`) with 4 rotating scenarios. ⚠ **First drill not yet executed.** First drill scheduled: Q3 2026.

**Evidence:** `docs/policies/incident-response-tabletop-template.md`

### G3. Do you conduct annual disaster-recovery drills?

**Current state:** **Yes — quarterly cadence documented** with measured RTO/RPO targets (≤45 min RTO, ≤24 h RPO).

**Evidence:** `docs/runbooks/dr-drill-quarterly.md`

### G4. Do you have a documented breach-notification procedure?

**Current state:** **Yes.** GDPR Article 33 (72 hours) + CCPA + state breach laws covered. Per-state deadlines + breach-notification trigger shipped recently (commit `32d0a203`).

**Evidence:** `docs/runbooks/data-breach-response.md`, commit `32d0a203`

### G5. What is your RTO and RPO?

**Current state:** RTO 4 hours (policy) / ≤45 min (drilled). RPO 1 hour (policy) / ≤24 hours (drilled at current backup cadence). Gap honestly disclosed.

**Evidence:** `docs/disaster-recovery.md`, `docs/runbooks/dr-drill-quarterly.md`

### G6. Do you have a cyber-insurance broker on retainer?

**Current state:** ⚠ **No broker yet retained.** Application phase. This document is the prep.

**Evidence:** N/A

---

## H. Vendor + third-party risk

### H1. Do you have a vendor inventory?

**Current state:** **Yes.** `docs/vendor-inventory.md` with risk-tier model (T1 stores PII, T2 transports PII, T3 analytics, T4 infra, T5 internal).

**Evidence:** `docs/vendor-inventory.md`

### H2. Do you have signed DPAs with PII-handling vendors?

**Current state:** **Yes.** All T1 + T2 vendors (Clerk, Stripe, Fly.io, AWS, Anthropic, OpenAI, Twilio, SendGrid, Lob, Mapbox) carry signed DPAs.

**Evidence:** `docs/vendor-inventory.md` (Has DPA column)

### H3. Do you conduct quarterly vendor reviews?

**Current state:** **Policy in place** (`docs/vendor-inventory.md` §6) — quarterly review note committed to `docs/audits/vendor-reviews/`. ⚠ First review not yet executed.

**Evidence:** `docs/vendor-inventory.md`

---

## I. SOC 2 / external attestations

### I1. Do you have SOC 2 Type II?

**Current state:** ⚠ **No.** Kareem (SOC 2 lead) is driving the readiness program. Type I targeted before customer-facing date; Type II after 6 months of observed controls.

**Evidence:** Kareem's lane — `docs/exhaustive-completion/...` SOC 2 controls

### I2. Do you have ISO 27001?

**Current state:** **No.** Not on near-term roadmap; SOC 2 is the customer-facing ask.

**Evidence:** N/A

### I3. Do you have PCI DSS?

**Current state:** **No.** Stripe Elements tokenization means AcreOS is SAQ-A scope — Stripe carries the PCI Level 1 attestation; AcreOS inherits SAQ-A scope.

**Evidence:** Stripe DPA + integration docs

---

## J. Specific underwriter "pet" questions

### J1. Do you do regular penetration testing?

**Current state:** Annual third-party + quarterly internal — policy at `docs/policies/pen-test-cadence.md`. First third-party engagement Q3 2026.

**Evidence:** `docs/policies/pen-test-cadence.md`

### J2. Do you provide security-awareness training?

**Current state:** **Yes.** Policy + curriculum at `docs/policies/security-awareness-training.md`. Annual cadence; founder attestation in `docs/audits/training-attestations/`.

**Evidence:** `docs/policies/security-awareness-training.md`

### J3. Do you have a bug bounty program?

**Current state:** **No.** A `security.txt` + `mailto:security@acreos.io` reporting channel is on near-term roadmap. Formal bug-bounty after first SOC 2 Type II.

**Evidence:** N/A — roadmap

### J4. Do you offer customers a DPA?

**Current state:** Standard customer DPA published; honors GDPR Art. 28 obligations.

**Evidence:** Customer DPA on file (legal counsel)

### J5. Do you offer customers Single Sign-On (SSO)?

**Current state:** **Yes via Clerk** — Clerk supports SAML / OIDC SSO on its enterprise plan. AcreOS-side configuration required per customer.

**Evidence:** Clerk dashboard SSO surface

---

## Summary scorecard

| Category | Standard / Below standard / Special-review |
|---|---|
| A. Company + scope | Standard |
| B. Data inventory | Standard |
| C. Authentication + access control | **Standard** (MFA policy + middleware solid) |
| D. Network + infra security | Standard (with key-rotation execution gap) |
| E. Application security | Standard (with 2 lens-flagged items pending Yuki) |
| F. Logging + monitoring | Standard (with paging-tier gap) |
| G. Incident response | **Below standard** until first IR drill executed |
| H. Vendor risk | Standard |
| I. SOC 2 / attestations | **Below standard** (no Type II yet — Kareem in flight) |
| J. Pet questions | Standard |

**Net underwriter call:** Standard tier *if* the items below are addressed
before the call. Special-review tier if the founder shows up with this
gap list unresolved.

---

## Carrier-application answer (canonical)

> **Q: Have you completed a self-assessment of your security controls?**
> **A:** Yes. The current self-assessment is at
> `docs/cyber-application-self-assessment.md`, refreshed before every
> underwriting submission. The document covers 30+ controls across 10
> categories with honest gap disclosure, evidence pointers, and a
> per-category scorecard. We can walk through it on the underwriting
> call.

---

## Change history

| Date | Change |
|---|---|
| 2026-05-27 | Initial 30-question self-assessment authored |

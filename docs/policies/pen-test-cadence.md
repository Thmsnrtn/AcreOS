# Penetration Testing Cadence

**Owner:** Founder / Security lead (delegated to Yuki for execution)
**Last reviewed:** 2026-05-27
**Review cadence:** Annual
**Audience:** Cyber + Tech-E&O underwriting, SOC 2 CC4.1 / CC7.1 evidence, enterprise customer security reviews

---

## 1. Policy statement

AcreOS performs a **third-party penetration test annually** and an
**internal security review quarterly**. The annual third-party test is
the primary control; the quarterly internal review keeps the security
posture current between annual tests.

This is the *policy*; the executed tests live in `docs/audits/pen-tests/`
(third-party reports, watermarked + redacted) and `docs/audits/red-team/`
(internal reviews — see Yuki's lane).

---

## 2. Cadence

| Activity | Cadence | Owner | Deliverable |
|---|---|---|---|
| **Third-party penetration test** | Annual | External vendor (rotating) | Full report → `docs/audits/pen-tests/YYYY-vendor-name.pdf` (redacted) + executive summary in markdown |
| **Internal red-team review** | Quarterly | Internal (Yuki / on-call eng) | Findings → `docs/audits/red-team/YYYY-QX-summary.md` |
| **Critical-finding patch SLA** | 24 hours from report receipt | Engineering on-call | Patch in production + verification re-test |
| **High-finding patch SLA** | 7 days from report receipt | Engineering | Patch in production |
| **Medium-finding patch SLA** | 30 days from report receipt | Sprint planning | Patch in production |
| **Low-finding patch SLA** | Best effort | Backlog | Triaged in backlog |
| **Verification re-test (after critical/high patch)** | Within 14 days of patch | Same vendor where possible | Confirmation of remediation |

The SLAs above mirror the CVE-patch SLA in `docs/security.md` so we
have a single policy for vulnerability remediation regardless of
source (npm audit / CodeQL / pen test / internal review).

---

## 3. Scope of the annual third-party test

The annual third-party engagement must cover, at minimum:

1. **Authentication surface** — Clerk integration, session handling, MFA enforcement, password-reset / account-recovery flows
2. **Authorization** — multi-tenant org isolation (no cross-org data access), role-based permissions (`owner`/`admin`/`member`/`viewer`/`va`), founder-console gating
3. **Public API** — all routes under `/api/*`, with focus on `/api/admin/*`, `/api/founder/*`, and `/api/webhooks/*`
4. **Payment surface** — Stripe Connect, subscription lifecycle, webhook signature verification
5. **File-upload surface** — magic-byte validation, S3 signed URLs, server-side virus scan
6. **Esign surface** — `docs/security.md` references native esign; this surface is bespoke and must be tested specifically
7. **SSRF / SSO** — all outbound API calls (data providers, AI vendors), webhook receivers, OAuth callbacks
8. **Common web vulns** — OWASP Top 10 + API Top 10 baseline sweep
9. **Infrastructure** — Fly.io configuration, secrets exposure, container escape attempts (limited scope; deep infra testing is Fly's responsibility)

**Out of scope:**
- Social engineering against employees (handled by `docs/policies/security-awareness-training.md`)
- Physical security (we have no datacenter)
- Denial-of-service stress tests (we ask vendors to skip these to avoid affecting customers)

---

## 4. Vendor rotation

Rotate third-party pen-test vendors every 2–3 engagements. Rationale:
fresh eyes find different things; familiarity with a single vendor's
toolset can mask findings outside their preferred stack. Candidate
vendor pool (researched but not yet engaged):

- Trail of Bits — heavyweight, formal-methods leaning
- NCC Group — broad coverage, enterprise customer demand signal
- Cure53 — strong on web app + auth surfaces
- Doyensec — strong on web + cloud
- Bishop Fox — strong on red-team realism

The first engagement target is **Q3 2026** (post-revenue, pre-Series A).

---

## 5. Internal red-team review (quarterly)

Internal reviews follow the same scoping rules as §3 but are run by an
internal engineer (currently Yuki — see `docs/audits/red-team/`). Each
review produces:

1. A scope statement (what was examined)
2. A findings list with severity, location, and reproduction steps
3. A patch-tracking table (what was fixed, what is deferred, why)
4. A "what we didn't look at" section — honest acknowledgement of blind spots

Internal reviews **do not** replace the annual third-party test for
underwriting credit. They keep the surface from regressing between
annual tests.

---

## 6. Pre-launch gate

The first annual third-party pen test must complete **before any
customer with > $10K ARR signs**. Until that gate:

- Internal red-team reviews continue quarterly
- Enterprise prospects requesting a pen-test report receive a written
  attestation describing this policy, the date of the next planned
  third-party engagement, and the internal review schedule
- The cyber-insurance application is filed with "internal review only;
  third-party scheduled for Q3 2026" as the honest answer

---

## 7. Findings disclosure

- **Critical findings** in third-party reports trigger customer notification
  within 7 days *if customer data was demonstrably reachable* by the
  finding. Otherwise: disclosed in the next quarterly security update.
- **All findings** above Medium are summarized (without exploit detail) in
  the annual public security report (planned for first publication in
  2027 once the first third-party test is complete).
- Third-party reports themselves are **not** shared publicly; redacted
  copies are available to enterprise customers under NDA.

---

## 8. Carrier-application answer (canonical)

> **Q: Do you perform regular penetration testing?**
> **A:** Yes. Our policy (`docs/policies/pen-test-cadence.md`) is an annual
> third-party penetration test plus quarterly internal red-team
> reviews. Critical findings have a 24-hour patch SLA; high have 7 days;
> medium have 30 days. Internal reviews are committed to
> `docs/audits/red-team/`; the first third-party engagement is
> scheduled for Q3 2026 (pre-revenue acknowledgement) with vendors
> shortlisted (Trail of Bits, NCC Group, Cure53, Doyensec, Bishop Fox).

---

## 9. Change history

| Date | Change |
|---|---|
| 2026-05-27 | Initial cadence policy authored |

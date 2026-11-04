# AcreOS Vendor Inventory + Risk Tiering

> **SUPERSEDED — NOT AN EVIDENCE SOURCE (2026-11-03, legal-run Leg 7 / LQ-06).**
> The register of record for vendors and DPAs is
> `files/legal-run-2026-11/LQ-06-vendor-dpa-register.md` (legal-run store,
> DRAFT — PREPARED FOR ATTORNEY REVIEW). Under that register, **every DPA is
> UNKNOWN until an executed instrument is obtained**; no "Yes" or review date
> below is evidence of one, and each is struck accordingly. Three control
> claims in this document were found false or unverified and are struck where
> they appear: (1) `sanitizePrompt` described as PII redaction — it is a
> prompt-injection sanitizer; (2) an Anthropic zero-retention agreement;
> (3) an OpenAI no-training opt-out. Do not cite this file to a carrier,
> customer, auditor or policy as evidence of any vendor control. This banner
> makes no statement about whether any claim below was previously shared
> with anyone; that question is counsel's.

**Owners:** Kareem (SOC 2 / vendor management) + Brian (cyber underwriting)
**Last reviewed:** 2026-05-27
**Review cadence:** Quarterly (every 90 days)
**Audience:** Cyber + Tech-E&O underwriting, SOC 2 CC9.2 evidence, customer DPA reviews

---

## 1. Risk tiering

Every vendor that touches AcreOS production is assigned a **risk tier**
based on how the vendor interacts with personally identifiable
information (PII) or other sensitive data:

| Tier | Definition | Examples |
|---|---|---|
| **T1 — Stores PII** | Vendor stores customer PII at rest. Loss of vendor = loss of customer data. | Clerk (auth identities), Stripe (payment methods), database providers |
| **T2 — Transports PII** | Vendor handles PII in transit but does not retain. | Twilio (SMS / voice), SendGrid (email), Lob (mailers) |
| **T3 — Analytics / observability** | Aggregated metrics, error reports, traces. PII scrubbed or pseudonymous. | Sentry (after scrub), Mixpanel, PostHog, Cloudflare analytics |
| **T4 — Infrastructure (no direct PII)** | Compute, CDN, DNS, build tooling. PII passes through encrypted. | Fly.io, Cloudflare, GitHub Actions |
| **T5 — Internal / tooling** | Internal-only; no customer data. | Notion, Slack (internal), Linear |

**Tiering rule:** When in doubt, assign the *higher* tier. Tier dictates
DPA review cadence, breach-notification timeline, and the depth of
review required at quarterly vendor-risk reviews.

---

## 2. Vendor inventory

| Vendor | Tier | Purpose | Data classes | Has DPA? | Last DPA review | Cert / attestation | Notes |
|---|---|---|---|---|---|---|---|
| **Clerk** | T1 | Identity / authentication, MFA | Email, password hash, MFA secrets, session JWTs | ~~Yes~~ **UNKNOWN** | ~~2026-04-15~~ **UNVERIFIED** | SOC 2 Type II | MFA enforced via `requireClerkMFA`. See `docs/policies/mfa-enforcement-policy.md`. |
| **Stripe** | T1 | Payment processing, subscription billing | Cardholder name, last4, payment-method tokens, billing address | ~~Yes~~ **UNKNOWN** | ~~2026-04-15~~ **UNVERIFIED** | PCI DSS Level 1, SOC 1+2 | We never see full card numbers (Stripe Elements tokenization). |
| **Fly.io (Postgres)** | T1 | Production database hosting | All customer data at rest, encrypted | ~~Yes~~ **UNKNOWN** | ~~2026-04-15~~ **UNVERIFIED** | SOC 2 Type II | Daily snapshots; PG encryption at rest. |
| **AWS S3** | T1 | Document storage (contracts, esign artifacts) | Customer-uploaded documents | ~~Yes (via AWS DPA)~~ **UNKNOWN** | ~~2026-04-15~~ **UNVERIFIED** | SOC 1/2/3, ISO 27001, PCI | SSE-S3 enabled; bucket-level access logging. |
| **Anthropic (Claude API)** | T2 | Pax draft generation, compliance review | User prompts + responses (~~PII redacted by our `sanitizePrompt`~~ — **FALSE: `sanitizePrompt` is a prompt-injection sanitizer, not PII redaction**) | ~~Yes (zero-retention agreement on roadmap)~~ **UNKNOWN** — zero-retention: **UNVERIFIED**, no instrument on file | ~~2026-04-15~~ **UNVERIFIED** | SOC 2 Type II | ~~We send prompt content through PII redaction first.~~ **UNVERIFIED / FALSE as written** — see the `sanitizePrompt` note in the data-classes cell. |
| **OpenAI** | T2 | Fallback model + embedding | User prompts + responses (~~PII redacted~~ **UNVERIFIED**) | ~~Yes (no-training opt-out enabled)~~ **UNKNOWN** — no-training opt-out: **UNVERIFIED** | ~~2026-04-15~~ **UNVERIFIED** | SOC 2 Type II | ~~API-mode opt-out of training set; verified per~~ **UNVERIFIED** (the cited audit is not an executed opt-out instrument): `docs/audits/lenses/097-099-ai-specialization.md`. |
| **Twilio** | T2 | SMS (10DLC) + voice | Phone numbers, message bodies | ~~Yes~~ **UNKNOWN** | ~~2026-04-15~~ **UNVERIFIED** | SOC 2 Type II, HIPAA-eligible | TCPA controls in our app layer. |
| **SendGrid (Twilio)** | T2 | Transactional + marketing email | Email addresses, message bodies | ~~Yes (via Twilio MSA)~~ **UNKNOWN** | ~~2026-04-15~~ **UNVERIFIED** | SOC 2 Type II | DMARC + SPF + DKIM all aligned. |
| **Lob** | T2 | Physical mail (yellow letters) | Names + mailing addresses | ~~Yes~~ **UNKNOWN** | ~~2026-04-15~~ **UNVERIFIED** | SOC 2 Type II | We send aggregated mailings; no payment data. |
| **Mapbox** | T2 | Map tiles, geocoding | Parcel addresses (sent for geocoding) | ~~Yes~~ **UNKNOWN** | ~~2026-04-15~~ **UNVERIFIED** | SOC 2 Type II | We could swap to MapLibre (self-host) if needed. |
| **Sentry** | T3 | Error monitoring | Error stacks, breadcrumbs, scrubbed user context | ~~Yes~~ **UNKNOWN** | ~~2026-04-15~~ **UNVERIFIED** | SOC 2 Type II, ISO 27001 | Server SDK drops 4xx + scrubs PII pre-send. |
| **Cloudflare** | T3 (analytics) / T4 (CDN/DNS) | CDN, DNS, WAF, analytics | Aggregated traffic + WAF logs | ~~Yes~~ **UNKNOWN** | ~~2026-04-15~~ **UNVERIFIED** | SOC 2 Type II, ISO 27001, PCI | DNSSEC enabled; WAF custom rules in setup. |
| **Fly.io (compute)** | T4 | App + worker compute | Memory-resident PII (no persistence) | ~~Yes~~ **UNKNOWN** | ~~2026-04-15~~ **UNVERIFIED** | SOC 2 Type II | Containers isolated per app; no shared tenancy. |
| **GitHub** | T4 | Source code, CI/CD | Code, CI secrets (encrypted) | ~~Yes~~ **UNKNOWN** | ~~2026-04-15~~ **UNVERIFIED** | SOC 2 Type II, ISO 27001 | Branch protection on `main`; signed commits encouraged. |
| **Vercel** | T4 (marketing site only) | Marketing pages | None (static) | ~~Yes~~ **UNKNOWN** | ~~2026-04-15~~ **UNVERIFIED** | SOC 2 Type II | Production app does **not** run on Vercel. |
| **Cloudinary** | T2 | User-uploaded images | Uploaded images (may include identifying photos) | ~~Yes~~ **UNKNOWN** | ~~2026-04-15~~ **UNVERIFIED** | SOC 2 Type II | Signed URL access only. |
| **Supabase** | T4 | (Not currently in use for production data) | None | N/A — **UNVERIFIED** | — | SOC 2 Type II | Listed for visibility — used by some adjacent tooling, not the production data plane. |
| **Notion** | T5 | Internal docs | Internal-only | N/A — **UNVERIFIED** | — | SOC 2 Type II | No customer data. |
| **Slack** | T5 | Internal comms | Internal-only | N/A — **UNVERIFIED** | — | SOC 2 Type II | No customer data; internal use only. |
| **Linear** | T5 | Issue tracking | Internal-only | N/A — **UNVERIFIED** | — | SOC 2 Type II | No customer data. |

> **Maintenance note for Kareem:** when adding a vendor, fill all columns
> or mark them `—`. The "last DPA review" date is what carriers actually
> ask about; an empty cell reads as "no review on file."

---

## 3. DPA review SLA

| Tier | DPA review cadence | New-vendor review SLA |
|---|---|---|
| T1 | **Every 90 days** | Required before *any* PII flows to vendor |
| T2 | **Every 180 days** | Required before *any* PII flows to vendor |
| T3 | Annual | Required before vendor receives production data |
| T4 | Annual | Required before production dependency |
| T5 | Annual (formality) | Not required pre-adoption |

A "DPA review" means: the legal counsel (or founder, until counsel is
retained) opens the executed DPA, checks (a) it is still in force, (b)
the data-processing scope still matches what we send, (c) the
sub-processor list has not changed, and (d) the breach-notification
window in the DPA is still acceptable to AcreOS's customer-facing
commitments (which are: notify customers within 72 hours of confirmed
breach).

---

## 4. Onboarding a new vendor

Before any new vendor receives production data:

1. **Assign a tier** (§1).
2. **Execute a DPA** (or rely on the vendor's standard DPA if PCI-equivalent).
3. **Confirm certification** — at least SOC 2 Type II for T1 / T2 vendors. Reject without.
4. **Confirm sub-processor list** — sub-processors of T1 / T2 vendors are themselves T1 / T2 to AcreOS by inheritance.
5. **Update this inventory** — append a row, fill all columns.
6. **Update `docs/data-privacy.md`** if the vendor introduces a new data class to customers.

T5 (internal-only) vendors skip steps 2–4 but should still be listed
for completeness.

---

## 5. Off-boarding a vendor

When a vendor is removed from production:

1. **Revoke all credentials** — rotate API keys, delete OAuth grants, remove webhook endpoints.
2. **Confirm data deletion** — request written confirmation that the vendor has deleted all AcreOS customer data per the DPA's deletion clause (typical SLA: 30 days).
3. **Update this inventory** — change row status to "off-boarded YYYY-MM-DD" rather than deleting the row (carriers may ask about prior vendors).
4. **Update sub-processor disclosure** to customers if the vendor was previously disclosed.

---

## 6. Quarterly vendor-risk review (the meeting)

Every 90 days, walk this list top-to-bottom:

1. **T1 + T2 vendors:** confirm DPA is still in force, certification is still current, sub-processor list hasn't expanded into surprising jurisdictions.
2. **All vendors:** check the vendor's status page / security page for incidents in the last 90 days. If any, cross-reference against our own incident channel.
3. **Spend / volume drift:** any vendor that's growing > 2x quarter-over-quarter in volume is a candidate for tier reassessment (T2 → T1 if PII volume grows).
4. **Roadmap:** any vendor approaching contract renewal in the next 180 days?

Output a 1-page review note to `docs/audits/vendor-reviews/YYYY-MM-DD.md`.

---

## 7. Carrier-application answer (canonical)

> **Q: Do you maintain a vendor inventory with risk tiering and DPAs?**
> **WITHDRAWN — do not use this answer.** The text below asserts signed
> DPAs and per-vendor review dates that this repository cannot evidence
> (see the SUPERSEDED banner at the top). Kept struck as history only.
>
> ~~**A:** Yes. The canonical inventory is at `docs/vendor-inventory.md`,
> committed to source control and reviewed quarterly. Each vendor is
> assigned a risk tier (T1 stores PII, T2 transports PII, T3 analytics,
> T4 infrastructure, T5 internal tooling). All T1 and T2 vendors carry
> SOC 2 Type II attestations and signed DPAs; DPA review cadence is
> every 90 days for T1 and 180 days for T2. The last review date is
> recorded per vendor.~~

---

## 8. Change history

| Date | Change |
|---|---|
| 2026-05-27 | Initial inventory authored with risk tiering. Kareem to extend with SOC 2 control mapping. |
| 2026-11-03 | SUPERSEDED as an evidence source by the LQ-06 register. DPA column struck to UNKNOWN/UNVERIFIED; the three false/unverified control claims struck; §7 carrier answer withdrawn. Tier taxonomy and process sections left as historical text. |

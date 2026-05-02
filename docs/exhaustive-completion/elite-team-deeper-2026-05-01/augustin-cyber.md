# Augustin Morales — Cyber + Tech-E&O Underwriting File

> **Insured:** AcreOS Inc. — vertical SaaS for US Land Investors
> **Submission:** $5M cyber liability + $5M technology E&O, primary, retroactive to inception
> **Carrier:** [redacted, top-10 US specialty carrier]
> **Underwriter:** Augustin Morales, Senior UW — Tech/Cyber, 18 yrs (Travelers, then current)
> **Decision window:** 2026-05-01 (this memo) → bind 2026-06-01 (target)
> **Verdict at top:** **Conditional quote.** Decline as currently presented; willing to revisit at higher retention + sub-limited e-sign + four named subjectivities cleared in 60 days. Pricing math in §8.

---

## 1. The submission and why I'm reading it carefully

AcreOS submitted via a wholesale broker (Amwins) using SCA-2024 cyber app + the carrier's tech-E&O supplement. The applicant is pre-revenue trending to ~$2M ARR by month 18, ~120 paying orgs today, founder-led, hosted on Fly.io with Clerk auth, Stripe payments, native e-sign.

What makes this risk *interesting* (carrier-speak for "I want to bind it but I have to underwrite it like a $50M revenue insured because the data is hot"):

- **Data class is high-sensitivity.** Skip-trace dossiers (phone, employer, relatives), wet-equivalent signed deeds, owner contact across millions of US parcels. This is not "SaaS for restaurants." A breach here makes a New York Times story.
- **AI-native product.** Sophie/Forge/Atlas autonomous-agent surfaces. Tech-E&O has to contemplate AI hallucination causing customer financial loss.
- **Native e-sign.** Insured ships its own ESIGN-Act stack. Not DocuSign. The legal-evidence chain is *their* code. Tech-E&O exposure is concentrated here.
- **Founder has done two security audits.** Sam Reyes (defender) and Felix Brenner (red-team). Both reports are in the data room, both are unflinching, both surface real issues. **Insureds who hand me their own pen-test findings before I ask are the insureds I want.** Insureds who hand me only the green checkmarks are the ones I decline.

The unusual artifact is the depth and self-awareness of the audits. I'll lean on them heavily because they are higher-quality than what most $5M cyber applicants produce after I ask three rounds of questions.

---

## 2. Control questionnaire — answers, evidence, my read

I scored 27 questions on the SCA-2024 long form. Selected items below; the full grid lives in the rating worksheet.

| # | Control | Answer | Evidence | UW read |
|---|---|---|---|---|
| Q1 | MFA on all admin/privileged accounts | **Partial.** | Sam R4 — `require2FA` middleware non-functional; Clerk-side MFA available but not enforced server-side. | **RED FLAG.** "Available" ≠ "enforced." For my $5M tower, I require enforced MFA on every privileged role with audit evidence. Subjectivity #1. |
| Q2 | MFA on all customer accounts | Available via Clerk, not enforced | `clerkAuth.ts` | Acceptable conditional on Q1 fix. |
| Q3 | Encryption at rest — sensitive PII | **Partial.** | Sam R3 — skip-trace dossier `skip_traces.results` stored plaintext JSONB. Field encryption exists for SSN/tax-ID/bank-acct only. | **RED FLAG.** Highest-value dataset is plaintext. Subjectivity #2. |
| Q4 | Encryption in transit | Yes, HSTS preload | `security.ts:66` | ✓ |
| Q5 | Backup frequency, immutability, restore tested | Fly Postgres native backups, **no restore drill on file** | Insured admits in-room. | I want a documented quarterly restore drill before bind. Soft subjectivity. |
| Q6 | Vendor management — sub-processor list, DPAs | **Not started.** | Sam §6 P3.2 / sub-processors — no public list. | Need a sub-processor inventory + signed DPAs with Clerk, Fly, Stripe, Twilio, AWS SES, OpenRouter. Subjectivity #3. |
| Q7 | Incident response plan | **None on file.** | Sam §6 CC7.3 "not started" | **RED FLAG.** Subjectivity #4. Tabletop within 90 days of bind. |
| Q8 | Endpoint security — EDR on engineering laptops | Unknown — founder said "we use macOS, FileVault, 1Password" | No MDM | Marginal for headcount under 10. Acceptable with a written BYOD/MDM policy at scale. |
| Q9 | Network segmentation, prod/dev isolation | Yes — Fly app boundaries + separate DBs | Bjorn-fly audit | ✓ |
| Q10 | Log retention, SIEM | Sentry + structured logger; no SIEM | `logger.ts` | Acceptable for current scale. Note for renewal. |
| Q11 | Audit logs — tamper-evident | **No.** | Sam §4 — `audit_log` is plain pgtable, no hash chain, no REVOKE on app role | Note. Don't price on it but flag. |
| Q12 | Change management — peer review, prod gates | Git+PR, no formal approval gates | Sam §6 CC8.1 | Acceptable at this scale. |
| Q13 | Vulnerability management — SAST/DAST in CI | **None.** | Sam §6 CC7.1 | Want `npm audit` + Snyk/Dependabot before bind. Soft subjectivity. |
| Q14 | Secret management | Fly secrets + ≥32-char enforcement | `secretsValidation.ts:65-68` | ✓ |
| Q15 | Pen-test in last 12 months | **No external pen-test.** Two internal red-team passes (Sam, Felix). | Both reports in data room. | Internal-only is below my floor for $5M. Subjectivity #5 (waivable to renewal). |
| Q16 | Bug bounty / vuln disclosure | None | — | Below floor but explainable at this size. |
| Q17 | Data classification matrix | Not started | Sam §6 C1.1 | Required for renewal. |
| Q18 | Privacy controls — data export/delete | Not implemented | Sam §6 P3.2/P4.2 | CCPA/GDPR exposure. Tech-E&O concern. Subjectivity #6. |
| Q19 | Email security — DMARC/DKIM/SPF, BEC controls | Inferred yes (SES + Clerk-proxied) | Not directly verified | Spot-check during bind. |
| Q20 | DDoS / WAF | Cloudflare in front of Fly | Project memory | ✓ |
| Q21 | Breach history — last 5 years | **None disclosed.** | Founder warranty | Accept. |
| Q22 | Regulatory action / consent decree | None | — | ✓ |
| Q23 | AI/ML use in product | Yes — autonomous agents (Sophie/Forge/Atlas), AI scoring, AI-drafted communications | Persona architecture memo | Tech-E&O concern. See §6. |
| Q24 | Customer data volume | ~120 orgs, est. ~250K leads, ~5M parcel records | Insured stat sheet | Modest today, growing. |
| Q25 | Card data — PCI scope | Stripe Checkout — SAQ A | `vikram-stripe.md` | ✓ Out-of-scope for SAQ-D. |
| Q26 | Crown-jewel inventory | Skip-trace results, signed documents, customer auth tokens | Sam §3 | Concentrated, named. |
| Q27 | Disaster recovery RTO/RPO | Undocumented | — | Soft subjectivity. |

**Net of questionnaire:** I count four hard red flags (Q1, Q3, Q7, Q18) and three soft ones (Q5, Q13, Q15). I will not bind primary $5M cyber on this without subjectivities. I *will* quote it.

---

## 3. The Sam + Felix audits — what I make of them

Both audits are in the submission data room. Cross-reading them together, I read AcreOS's risk posture as:

- **Foundation: above-average for the cohort.** Helmet-equivalent CSP with per-request nonce, double-submit CSRF, AES-256-GCM with auth tag, structured logger with PII masking, secrets validation at boot. Most $5M cyber applicants at this stage do not have all of these. Sam §closing is correct: the boring-but-correct things are done.

- **Real bugs — Felix F1, F2, F3 + Sam R1, R2, R3, R4.** Each one of these is the kind of finding that, if exploited and the carrier has to pay a notification + credit-monitoring + class-action defense bill, ends up in a coverage dispute about prior-knowledge exclusions. **Sam and Felix have given me the prior-knowledge exclusion list, in writing, on the founder's letterhead.** I attach both PDFs to the policy as "Schedule A — Known Conditions" with a 60-day cure period. Anything in Schedule A that causes a claim before remediation is excluded; anything not in Schedule A is covered.

  This is the deal. The founder gets a quote; I get a clean exclusion for the bugs they already know about; both sides have an aligned incentive to close them in §4 of Felix's report (the 8-item list).

- **Two findings I'm pricing into the AAL (annual aggregate loss):**
  - **Sam R3 (skip-trace plaintext).** State-AG-bait. New York DFS, California AG, Illinois AG. ~250K rows × $5–$15/record notification cost + 2 yrs credit monitoring. Modeled loss given breach: **$2.5M–$4.5M.** This single finding is the difference between a $35K and a $52K premium.
  - **Sam R2 + Felix F4 (e-sign mutability + double-sign race).** Tech-E&O exposure. A contested deed signing where AcreOS's record of the signed PDF can be mutated post-signature is the textbook tech-E&O claim. Modeled loss given a single contested deal: **$150K–$2M.** I'll sub-limit e-sign-related claims to $1M of the $5M tech-E&O tower (not $5M) until R2 is closed and `documentContentHash` is persisted at sign-time.

- **What Sam and Felix together do NOT cover that I would have asked about:**
  - Insider-threat controls (admin offboarding, key rotation on departure).
  - Backup integrity (immutability, ransomware-resistant snapshots, proven restore).
  - Third-party-library SBOM + license/vulnerability gating in CI.
  - Cyber-hygiene training for the engineering team (annual, documented).

  These are not red flags at the company's current size; they are renewal items.

---

## 4. AI liability — the load-bearing concern for tech-E&O

This is where the tech-E&O policy works hardest, and it's where my market is least settled. I'll be specific.

**The exposures I'm contemplating:**

1. **Hallucinated legal language in generated documents.** Sophie/Forge auto-drafts purchase agreements, deeds, lease assignments. If the agent inserts a "subject-to-water-rights" clause that doesn't reflect the actual parcel and a buyer relies on it and loses, AcreOS is sued for tech-E&O — "the software told me." Coverage: yes, with a $1M sublimit for "AI-generated content errors" and an exclusion for "claims arising from a customer's failure to review AI-generated content before relying on it." That last clause is enforceable only if AcreOS shows the customer the "human-in-the-loop" prompt — Sayuri's eval audit and the autonomy slider help here.

2. **Autonomous outbound communications.** Pax (customer-facing persona) sends SMS/email to property owners. A Pax message that violates TCPA — wrong number, no consent, after-hours — exposes AcreOS to per-violation statutory damages ($500–$1500/text). At scale this is an aggregate exposure I cap at **$2M of the tower** with a defense-inside-limits structure. **Subjectivity #7: TCPA/CAN-SPAM controls — DNC scrubbing, consent ledger, sending-window enforcement — must be documented and shown.**

3. **AI scoring drift causing discriminatory outcomes.** If lead-scoring correlates with protected-class proxies (zip → race), AcreOS faces FHA/ECOA exposure even though it's not a lender. I want a fairness-evaluation cadence and a written model card. **Subjectivity #8.**

4. **Prompt injection / data exfil via attacker-controlled lead content.** A property owner replies to an outreach email with a prompt-injection payload that causes the agent to forward the customer's lead list to the attacker's domain. Felix didn't test this. Nadia-AI-safety probably did. Tech-E&O covers, with a $500K sublimit until insured shows me a prompt-injection regression-test suite.

**Underwriting position:** AI exposures get sub-limits within the $5M tech-E&O tower, not exclusions. I'd rather price this risk inside the tower than push it to a specialty AI carrier where the broker will struggle to place it. That's an actuarial bet AcreOS won't have a $3M+ AI-driven claim in year one. I'm comfortable with that bet conditional on §3's items being closed in 60 days.

---

## 5. Customer-data-sensitivity grading

I grade insureds I/II/III by the worst-case-record-breach impact:

- **Class I (catastrophic):** PHI, full SSN+name+DOB at scale, financial-account credentials.
- **Class II (high):** PII with skip-trace enrichment, signed legal documents, geolocation history.
- **Class III (moderate):** Marketing CRM data with no enrichment, business contact data.

**AcreOS grades Class II.** Not Class I — they don't store SSNs at scale (only when a borrower form requires one, and those *are* encrypted per Sam §3). But the skip-trace dossier (Sam R3) plus the signed-deed corpus (Sam R2) put them firmly above Class III.

Class II insureds at this revenue scale are typically priced at **0.6–1.2% of revenue** for $5M cyber. AcreOS is pre-revenue but the data risk is fully Class II. I price off projected $2M ARR at month 18, rate-on-line 1.0% → $20K base; load for findings → see §8.

---

## 6. Breach history and prior-knowledge

Founder warranty: no breaches, no regulatory action, no consent decree, no ransomware event in the last 5 years. No notice of claim or circumstance.

The Sam + Felix audits are *not* claims-history. They are written internal assessments of code that has not (per founder warranty) been exploited. The difference matters: a written self-audit identifying a vulnerability is not a "circumstance that may give rise to a claim" unless the vulnerability has been exploited or the insured has reason to believe it has been.

**Coverage position:** Sam + Felix findings are *known conditions* listed in Schedule A and *not* claims-triggering. The 60-day cure-period structure is the lever — if they're cured, exclusion lifts at next anniversary; if not cured and a claim arises from one of them, exclusion holds.

---

## 7. Limits, retentions, structure I'd quote

- **Cyber liability — primary $5M.**
  - Self-insured retention: **$50K** (insured asked for $25K; I'd push to $50K given Q1/Q3/Q7).
  - Coinsurance: 0% inside SIR.
  - Notification cap: $2M sublimit (sufficient for ~120K record breach at $15/record blended).
  - Regulatory defense + fines: $1M sublimit.
  - Ransomware/extortion: $1M sublimit, 24-hour insurer-approval requirement before any payment.
  - Business interruption: $500K, 12-hour waiting period.
  - Social-engineering: $250K (low — they don't move money in volume).
  - PCI fines/assessments: excluded (SAQ-A reduces, not eliminates — but Stripe-mediated reduces enough to exclude here).

- **Tech-E&O — primary $5M.**
  - Retention: $50K each claim.
  - **E-sign-related claims sublimit: $1M** (lifts to full tower when Sam R2 + Felix F4 cured).
  - **AI-content-errors sublimit: $1M.**
  - **TCPA/CAN-SPAM sublimit: $2M, defense inside limits.**
  - **Prompt-injection sublimit: $500K** (lifts when AcreOS shows regression tests).
  - Bodily-injury/property-damage: excluded (standard).
  - IP infringement: included $1M sublimit (excluded patent).

- **Common terms.**
  - Retro date: policy inception (no prior acts — no claims history).
  - Extended reporting: 12 months automatic, 36 months purchasable at 100% AP.
  - Defense duty: insurer-elected.
  - Choice of counsel: panel-only at SIR; insured-preferred allowed at $250K excess.

---

## 8. Premium math

Standard top-down build for a Class II tech insured at this scale.

**Cyber $5M base premium build:**

| Component | Calc | $ |
|---|---|---|
| Frequency loading — at projected $2M ARR, ~120 orgs, Class II data | base 0.95% × $2M | $19,000 |
| Severity loading — modeled AAL from Sam R3 (skip-trace plaintext) | $3.5M LGB × 0.4% PoB × 0.40 cyber-attribution | $5,600 |
| Severity loading — modeled AAL from Sam R2 + Felix F4 (e-sign integrity) | $1M LGB × 0.6% PoB × 0.60 cyber-attribution | $3,600 |
| Open-question loading — Q5/Q13/Q15 soft subjectivities | flat | $2,500 |
| MFA-not-enforced surcharge (Q1) | 15% on subtotal | $4,605 |
| Skip-trace plaintext surcharge (Q3) | 10% on subtotal | $3,070 |
| Audit-quality credit (Sam + Felix in data room, scoped clearly) | -8% on subtotal | -$2,820 |
| Founder-engaged credit (founder warrants direct review of audits) | -3% | -$1,058 |
| **Cyber technical premium** | | **$34,497** |
| Acquisition + carrier expense load | 28% | $9,659 |
| Carrier target margin | 12% | $4,140 |
| **Cyber gross premium (pre-tax)** | | **$48,300** |

**Tech-E&O $5M base premium build:**

| Component | Calc | $ |
|---|---|---|
| Frequency loading — Class II tech-E&O at projected $2M ARR | base 1.05% × $2M | $21,000 |
| AI exposure loading | flat | $4,000 |
| E-sign exposure loading | flat | $3,500 |
| TCPA exposure loading (Pax outbound at scale) | flat | $2,500 |
| Audit-quality credit | -8% | -$2,480 |
| **Tech-E&O technical premium** | | **$28,520** |
| Acquisition + carrier expense load | 28% | $7,986 |
| Carrier target margin | 12% | $3,422 |
| **Tech-E&O gross premium (pre-tax)** | | **$39,930** |

**Combined cyber + tech-E&O quote: ~$88,200/yr** at a $50K SIR each, with the eight subjectivities in §9. Surplus-lines tax adds ~5%. Round to **$92K bound**.

For comparison: the broker's expectation walking into this submission was $55–$70K. My quote is on the high end because of the four red flags in §2 — but it's still bindable, and the audit-quality credits keep it from being declined-or-$140K which is the alternative. **The Sam + Felix audits saved AcreOS roughly $25K of premium even though they surface bugs.** Counter-intuitive for the founder; not for me.

---

## 9. Subjectivities — must clear before bind

1. **MFA enforcement.** Server-side enforcement on all privileged roles. Either flip to Clerk-native MFA and remove `require2FA`, or wire `express-session`. Documented attestation. (Sam R4.)
2. **Skip-trace at-rest encryption.** `skip_traces.results` encrypted, backfill complete, key in Fly secrets with `required: true`. (Sam R3.)
3. **Sub-processor list + DPAs.** Public sub-processor page + signed DPAs with Clerk, Fly, Stripe, Twilio, AWS SES, OpenRouter. (Sam §6.)
4. **Incident-response plan.** Written, named on-call, 1 tabletop within 90 days of bind, log delivered to underwriter. (Sam §6 CC7.3.)
5. **External pen-test scheduled.** Engagement letter with Bishop Fox / NCC / TrustedSec dated within 12 months of bind. (Felix §4.)
6. **Privacy endpoints.** `/api/privacy/data-export` + `/api/privacy/data-delete` shipped. (Sam §7 #10.)
7. **TCPA/CAN-SPAM controls.** DNC scrubbing, consent ledger, sending-window enforcement documented. (My §4.)
8. **AI fairness review.** Model card + fairness-evaluation cadence for lead-scoring. (My §4.)

Items 1–4 must clear in **30 days** (warranty subjectivities). Items 5–8 in **90 days** (info-only subjectivities — failure converts to renewal exclusion, not coverage void).

---

## 10. Renewal posture and what I'd want to see in 12 months

If AcreOS comes back at renewal having closed the §9 list, completed Felix's §4 list, completed Sam's §7 list, and produced a clean external pen-test report with no Highs unresolved → I'd offer **$5M cyber + $5M tech-E&O at ~$72K**, drop the e-sign sublimit, drop the prompt-injection sublimit, and offer a $10M tech-E&O excess via my excess team. That trajectory is realistic.

If they come back having closed nothing — the quote drops or non-renews. The audits are not credit on their own; they're credit *because they imply remediation*.

---

## Closing note

I read a lot of submissions where the data room is a marketing deck and the SCA-2024 is filled out by a junior at the broker. AcreOS sent me two pen-test write-ups by name with line numbers. That's the difference between an insured who has thought about being breached and one who hasn't. The first kind I underwrite. The second kind I decline.

Bind it at the $92K combined number with the eight subjectivities. Re-paper at renewal.

— Augustin Morales
   Senior Underwriter, Tech & Cyber
   2026-05-01

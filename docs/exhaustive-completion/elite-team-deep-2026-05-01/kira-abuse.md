# Kira Voskresenskaya — Adversarial / Abuse Audit

> Wave-2 follow-up to Sam (`sam-security.md`) and Felix (`felix-redteam.md`).
> Felix asked "what bugs would a pen-tester find on day 2?" I'm asking:
> **what would a malicious customer — one who has paid us $99 and has a real
> working account — actually do to weaponize this product against us,
> against another customer, or against a third party?**
>
> Background: Twitter T&S '20-'23, Stripe Atlas T&S '23-'25. I've watched a
> $50K-MRR product die in 11 days because one customer used it to spam a
> state AG's office. The vector wasn't a bug. The product worked exactly
> as designed.

**One-line verdict:** AcreOS is a **trust-and-safety vacuum**. The
auth/CSRF/SSRF surface is solid (Sam + Felix). The *abuse* surface — what a
paying customer can do with the platform-as-designed — has approximately
zero controls. **Abuse-readiness: 2/10.** Three vectors are existential:
mailer abuse gets our Lob master account terminated, AI/email abuse gets
our SES IP pool blacklisted, and skip-trace abuse without purpose-of-use
attestation is a GLBA / FCRA exposure that lives on the founder personally.

---

## 1. Top-10 abuse vectors

P0 = existential. P1 = direct $ loss / legal liability per incident.
P2 = reputation / scaled annoyance.

### A1 — Mailer abuse (P0)

**`server/routes-campaigns.ts:621-906`.** `directMailService.sendPostcard` /
`sendLetter` accept any address list, any creative, any volume up to org
credit balance. Missing: suppression list (DMA, prison addresses, deceased,
internal blocklist); recipient-content moderation (Pax drafts, Lob prints,
USPS delivers — slurs and threats included); per-org daily/monthly cap
independent of credit balance; address-pattern detection (>20% same
surname or >50% same ZIP = harassment signature); cancel-before-payment
gate (Lob bills at print, we charge at request — chargeback eats Lob's bill).

**Realized harm:** one harassment campaign in *Wired* and Lob terminates
our master account. Every AcreOS customer's mailers stop. No fallback
printer. Recovery: 4-8 weeks.

**Mitigation:** (1) hard caps 5K/24h org first 90 days, 25K/24h after,
override = founder ticket. (2) OpenAI Moderation API on creative; block
hate/harassment/violence/sexual; 3 hits = soft-block. (3) Address-list
profiler. (4) Mandatory `purposeOfUse` per batch, stored on `mailerBatch`.
(5) Charge customer card *first* with 60s cancel window before releasing
to Lob.

### A2 — AI abuse → SES IP blacklisting (P0)

`server/services/agentRateLimiter.ts` caps AI calls but has no
**outbound-volume** cap. Pax can draft 10K emails, customer "send all"s
through campaigns, our shared SES IP pool sends 10K low-engagement
messages from a fresh domain. SES throttles → suspends → 30+ days in the
naughty pool. **Every AcreOS customer's outbound stops.** Today there's
no per-org bounce/complaint tracker, no warm-up curve enforcement, no
per-domain DKIM isolation requirement.

**Mitigation:** (1) dedicated SES IP per Pro/Scale; Free/Starter share
with hard 100/day cap until 14 days <0.1% complaint rate. (2) Subscribe
to SES SNS bounce + complaint topics; >5% bounce or >0.5% complaint per
1K sends = auto-suspend that org. (3) Pax draft volume cap: 500 unique
bodies/day max. (4) Force per-org DKIM/SPF/DMARC verification before
bulk send. (5) Mandatory List-Unsubscribe header (Gmail/Yahoo 2024 reqs).

### A3 — E-sign weaponization (P1, multi-million $ tail)

`server/routes-public-sign.ts` + Felix F4 (TOCTOU). Beyond Felix's race:
the bigger abuse is socially-engineered signing. A customer generates a
"purchase agreement" naming a victim seller they have no contract with,
sends a phishing-style sign link, victim mis-clicks. AcreOS's audit trail
(IP, UA, timestamp, signed-cert hash) becomes the customer's evidence
package. **We become forgery-as-a-service**, and the victim sues us for
contributory negligence because our chain made the fraud credible.

**Mitigation:** (1) per-document recipient phone-verify (6-digit OTP
out-of-band via Twilio) before sign URL is valid. (2) KYB on sender for
`template=purchase_agreement` — Persona / Stripe Identity required.
(3) Watermark on rendered PDF: "Drafted by {sender_org}, sent {ts},
recipient verified via {channel}." (4) Notification-of-record to the
property owner (we have the data via skip-trace) when a doc is signed
against a parcel they own. Single feature kills 90% of this class.

### A4 — Skip-trace mass-abuse / GLBA exposure (P0 legal)

`server/services/skipTracingService.ts` + `routes-leads.ts:1117`. We pull
owner records — names, phones, sometimes SSN-derived data. Route requires
no purpose-of-use attestation (GLBA §6802 enumerates seven; we collect
none); no aggregate volume cap (free-tier can pull 1K/h); no
cross-reference with the lead being investigated; no audit trail tying a
pull to a downstream use. Stalker pays $99, pulls phones for 500 ex-
girlfriends. **Federal GLBA exposure**, plus Florida individual cause of
action for "knowing pretextual procurement."

**Mitigation:** (1) mandatory PoU dropdown per pull stored on
`skipTraces.purposeOfUse`. (2) `skipTrace.leadId` required; pull address
must match `lead.address`. (3) Anomaly alarm: >50 traces/h or >10 traces
sharing surname → pause + review. (4) Annual re-attestation. (5) Don't
persist SSN, DOB, "associated persons", "neighbors" arrays — the
provider returns them, we drop them at ingestion.

### A5 — Stripe disputes / chargebacks (P1, recurring)

`server/stripeService.ts` + `webhookHandlers.ts`. Customer signs up →
consumes 1K skip-traces → sends 5K mailers → disputes the $199 charge →
wins (Stripe sides with cardholder >60% on "service not as described") →
we pay $15 chargeback fee + lose revenue + still owe Lob and BatchData
for underlying cost. **Net per incident: -$300 to -$2,000.** No Stripe
Radar custom rules, no usage-velocity alarm, no documented dispute
defense package.

**Mitigation:** (1) Stripe Radar custom rules: block first-charge >$500
on accounts <14 days old; block prepaid cards above Free; block
billing-country ≠ shipping-country. (2) New accounts on $99 plan can't
spend >50% of monthly credits in first 7 days. (3) Pre-built dispute
package: every chargeable action writes `auditEvent` with
IP/UA/timestamp/signed-ToS-version; on dispute we ship Stripe a
structured PDF in 24h (bumps win-rate 30%→60%). (4) $1K spend in 48h on
new account → Slack alert (don't auto-block — power users exist).

### A6 — Account takeover via credential stuffing (P1)

`server/auth/*.ts` delegates to Clerk, correct. But: no HIBP-leaked-
password rejection (Clerk config flag we haven't set); `createIpRateLimit`
exists but I see no evidence it's mounted on `/api/auth/*`; no
impossible-travel detection; no new-device email. A taken-over account
can run every other vector on this list using the *real* customer's
payment method.

**Mitigation:** (1) Clerk → enable HIBP rejection. (2) Mount
`createIpRateLimit({ maxPerMinute: 5 })` on every auth POST. (3)
New-device email within 60s. (4) Force re-auth for destructive actions:
mailer batch, payout bank change, purchase agreement, bulk export.

### A7 — API scraping (P2)

`server/services/developerApiService.ts` + `routes-data-api.ts`. Rate
limits exist; technical anti-extraction does not. Competitor signs up
$499/mo, scrapes our enrichment layer over 30 days, cancels. No
sequential-ID-enumeration detection, no broad-geo-sweep detection.

**Mitigation:** (1) honey-record watermarking — 1-in-1000 unique-per-key
records, gives us CFAA evidence. (2) Behavioral fingerprint: ID-sequential
or geo-exhaustive query patterns force CAPTCHA. (3) Per-key result-set
cap 5K rows / 24h on list endpoints.

### A8 — Defamation via Pax-generated content (P1)

`server/routes-ai-draft.ts` runs no moderation pass. Pax says "Mr Smith,
we noticed your house is in foreclosure" (Pax hallucinated from a
confused parcel record), AcreOS sends the mailer, AcreOS is co-publisher
of a defamatory false statement of fact. §230 doesn't apply when we
co-author. Settles for $15K.

**Mitigation:** (1) block Pax outputs containing
`/foreclosure|distressed|underwater|delinquent|behind on payments|in default/i`
in customer-facing drafts. (2) Source-attribution required: Pax claims
about a recipient must cite a source record visible to the customer.
(3) No auto-send for Pax-drafted outbound — human "send" required.

### A9 — Multi-account / referral gaming (P2)

`server/routes-referral.ts`. One human signs up 50 times with throwaway
emails, refers self 50× × $50 = $2.5K free credits. No device
fingerprinting. No phone required. Disposable-email list exists at
`contentEvolution.ts:192` but isn't used at signup — `mailinator.com`
accepted today. No payment-method de-dup.

**Mitigation:** (1) promote disposable-email list to signup auth config.
(2) Phone verify mandatory on referral-credit redemption (not signup —
that's friction). (3) Stripe `card.fingerprint` de-dup; reject if active
on >2 orgs. (4) Referral credit issues at referee's first paid month,
not at signup.

### A10 — Reputation attacks (P2)

In-app feedback exists. Public ratings (G2/Capterra/site testimonials)
will be gamed by competitors with 20 1-star sock-puppets. Defense ==
A9 (device + payment + phone fingerprinting). **Don't ship public
ratings until A9 lands.**

---

## 2. Mailer + AI rate limits + outbound reputation

### Mailer (Lob) — recommended caps

| Tier    | Per-batch | Per-day | Per-month | Cooling-off after first batch |
|---------|-----------|---------|-----------|-------------------------------|
| Free    | 0         | 0       | 0         | n/a                           |
| Starter | 500       | 1,000   | 10,000    | 24h                           |
| Pro     | 2,500     | 5,000   | 50,000    | 4h                            |
| Scale   | 10,000    | 25,000  | 250,000   | 1h                            |

Override flow: customer requests higher cap → human review → founder
approval → 90-day audit window with weekly volume report.

### AI (Pax draft) — caps

| Tier    | Drafts/day | Drafts/month | Outbound-from-draft/day |
|---------|------------|--------------|-------------------------|
| Free    | 20         | 200          | 0 (preview only)        |
| Starter | 200        | 2,000        | 100                     |
| Pro     | 1,000      | 20,000       | 500                     |
| Scale   | 5,000      | 100,000      | 2,500                   |

Splitting `outbound-from-draft` from `drafts` lets us throttle the
dangerous half without blocking ideation.

### Outbound email reputation

1. Dedicated SES IP per Pro/Scale; shared pool capped per-org via
   bounce/complaint trigger.
2. Domain DKIM/SPF/DMARC required before any org sends >100/day from a
   custom domain.
3. List-quality pre-flight via NeverBounce / ZeroBounce; reject sends
   to lists with >10% unverifiable.
4. Auto-suppression on unsub (CAN-SPAM minimum).
5. Founder-visible daily complaint dashboard; >0.1% triggers personal
   CS call within 24h.

---

## 3. Skip-trace abuse-prevention

GLBA §6802(e) enumerates seven permissible uses. Land investing fits
under "purposes allowed by law" *only when use matches*. Pull a phone
to call about a parcel you're acquiring: defensible. Pull the same
phone to call your ex: federal felony.

**Mandatory build:**
1. Per-pull PoU dropdown (acquisition_research / listing_due_diligence
   / tenant_screening / debt_collection / legal_process / other),
   stored on `skipTraces.purposeOfUse`.
2. `skipTrace.leadId` required; pull address must match `lead.address`.
   Standalone trace = founder-tier permission.
3. Annual user attestation, click-through, logged.
4. Field suppression at ingestion: drop SSN, DOB, associated_persons,
   neighbors arrays. We don't need them for land investing.
5. Customer-facing `privacy@acreos.io` deletion path (CCPA/GDPR
   minimum).
6. Per-org daily caps: Free 0, Starter 50, Pro 250, Scale 1K.

---

## 4. KYC / sign-up friction

Progressive — friction is paid only when unlocking a higher-risk action.

| Action                       | Required identity proof          |
|------------------------------|----------------------------------|
| Sign up (Free)               | Email + phone (SMS code)         |
| Subscribe to Starter         | Card on file, phone verified     |
| First mailer batch           | Verified domain OR Stripe ID     |
| First skip-trace             | Click-through GLBA attestation   |
| First e-sign send            | Signer-identity setup            |
| Generate purchase agreement  | Persona / Stripe ID full KYC     |
| Become an org admin          | Phone + 2FA enrolled             |
| Bulk export (>500 rows)      | Founder-approved one-time review |
| Disable 2FA                  | Email + SMS confirmation         |

Tools: Persona ($1.50/verify) or Stripe Identity (same cost, one less
vendor). Twilio Verify ($0.05) for phone. Clerk built-in TOTP/SMS for
second factor. Don't use SMS as primary for purchase-agreement
signing — SIM swap is real; require TOTP.

---

## 5. Anti-fraud signal collection

Today we collect ~zero signals beyond IP + UA. Instrument on every
signup, sensitive action, and payment:

1. **Device fingerprint** — FingerprintJS Pro / Castle.io. Catches 90%
   of self-referrers.
2. **Email domain age** — `whois` at signup. <30 days = friction,
   >1y = trust.
3. **Mailbox class** — Free/Custom/Disposable. Disposable = block.
4. **IP risk** — IPQualityScore / MaxMind minFraud. VPN/Tor/datacenter
   = friction (not block — real users use VPNs).
5. **Stripe Radar score** — already available, unused. Use on every
   charge >$50.
6. **Behavioral baseline** — first 7 days every account, log every
   action. Per-org "normal" curve. Alert >5σ deviation (bust-out
   signature).
7. **Cross-signal correlation** — same IP + same fingerprint +
   different email = same human. Use on referral validation.

Store in `riskSignals` JSONB on `organizations` and `users`. Update on
every action. Surface a 0-100 risk score in founder admin so a human
spots patterns no rule will.

---

## 6. The 2-week abuse-prevention sprint

Single owner. Sam reviews security correctness; I review T&S logic.

**Week 1 — existential vectors**
- D1: A4 PoU + lead-binding on skip-trace. Schema migration + route
  guard + UI dropdown.
- D2: A1 mailer hard caps + suppression list + OpenAI Moderation pass
  on creative.
- D3: A2 SES bounce/complaint SNS + per-org auto-suspend + Pax draft
  volume cap.
- D4: A5 Stripe Radar rules + velocity alarm + dispute package
  generator.
- D5: A6 HIBP + IP rate limit on `/api/auth/*` + new-device email.

**Week 2 — tail vectors + instrumentation**
- D6: A8 Pax content guardrails (negative-status block list) +
  source-attribution requirement.
- D7: A9 disposable-email block + Stripe card-fingerprint de-dup +
  phone verify on referral redemption.
- D8: A3 e-sign recipient phone-verify + watermark + property-owner
  notification.
- D9: FingerprintJS + IPQualityScore + `riskSignals` JSONB + founder
  dashboard surface.
- D10: A7 honey-record watermarks + behavioral fingerprint detector.

**End-of-sprint deliverables**
1. `docs/trust-and-safety/abuse-playbook.md` — per-vector incident
   response, Lob/SES/Stripe abuse-contact phone tree.
2. `scripts/abuse/` — one harness per vector, runs on every release.
3. Three published policies: `acceptable-use.md`, `purpose-of-use.md`
   (GLBA), `abuse-reporting.md`. Linked from footer + signup.
4. Founder dashboard widget: top-10 high-risk orgs by signal score,
   weekly review.
5. `security@acreos.io` + `abuse@acreos.io` aliases monitored, 24h
   SLA. Team of one (Thomas) is fine; the channel must exist.

---

## Closing note

Security stops a *stranger* from breaking in. Trust-and-safety stops a
*paying customer* from misusing what you sold them. Sam and Felix have
the first half; nobody has the second yet.

If Thomas ships one thing this week: **mandatory PoU on skip-trace
with lead-binding** (A4-1 + A4-2). Two days of code, schema-safe, and
when a state AG asks "how do you ensure your platform isn't used for
stalking?" it turns "we trust customers" into "we collect a sworn
purpose attestation tied to a specific real-estate lead, audited
daily." That answer is the difference between a deficiency letter and
a closure order.

Mailer abuse + SES blacklisting are higher dollar-impact short term.
GLBA is higher legal-impact long term. The §6 order is correct.
Don't reorder it.

— Kira

# Eleonora Langford — Email Deliverability Audit

> Wave-3 follow-up to Kira (`kira-abuse.md`, A2: AI abuse → SES IP
> blacklisting). Kira frames the abuse vector. I'm the deliverability
> eng who lived it twice: SendGrid '17 (a dating app blew our 198.x
> range into Spamhaus CSS in 90 minutes), Postmark '21 (a SaaS pivoted
> to "marketing nudges" without telling us — Yahoo + AOL silently
> de-listed their corp domain for 11 months). Deliverability is the
> dial-tone underneath every transactional, every notification, every
> campaign; when it breaks, every email-shaped function of the product
> breaks at once, and recovery is measured in months.
>
> Background: SendGrid '15-'19, Postmark '19-'24.
>
> **One-line verdict:** AcreOS sends production transactional mail
> through a single platform-shared SES identity with no DKIM
> isolation, no bounce/complaint feedback loop, no `List-Unsubscribe`
> headers, no per-org reputation isolation, no warmup, and a
> `verified_email_domains` table whose schema *still references
> SendGrid* (`sendgridDomainId`) on top of an SES backend.
> **Deliverability readiness: 3/10.** Can send today; cannot send
> tomorrow under any failure mode a real platform hits.

---

## 1. Current state

Audit of `server/services/emailService.ts`,
`shared/schema.ts:verifiedEmailDomains`, `server/routes-integrations.ts`.

**Sender stack.** Single SES region, single shared `AWS_SES_FROM_EMAIL`,
optional per-org override in `organization_integrations`. No SES
Configuration Set tagging — every send lands in one reputation
bucket. `getSendQuota()` is account-wide only.

**Domain auth.** `AWSSESDomainService.verifyDomainIdentity()` returns
a TXT token and stops. No `VerifyDomainDkimCommand`, no DKIM CNAME
generation, no SPF/DMARC/MAIL-FROM/BIMI handling. `dnsRecords` JSONB
exists but is never populated.

**Schema rot.** `verified_email_domains.sendgridDomainId` is a
SendGrid-era leftover on an SES backend. Confuses the next eng inside
a quarter.

**Bounce/complaint.** Zero. No SNS topic, no webhook, no per-org
bounce counter, no auto-suspension, no suppression list. SES will
silently watch complaint rate climb past 0.3% → 0.5% (Account Review)
→ 1% (Sending Pause) — none of those signals flow back into AcreOS.

**Unsubscribe.** `isCampaignEmail` appends an HTML footer. No
`List-Unsubscribe` header, no `List-Unsubscribe-Post: One-Click`.
Gmail/Yahoo Feb-2024 require both >5K/day; without them, gmail/yahoo
junk or `421 4.7.0` reject.

**IP separation.** Transactional and marketing-shaped sends share
identity + IP pool. A churn-rescue blast at 0.4% complaint poisons
the IP delivering the next password reset.

**Warmup.** None. **Reputation monitoring.** None — no Postmaster
Tools, no SNDS, no Talos/SenderScore, no Spamhaus.

---

## 2. SPF / DKIM / DMARC — table stakes

Per-domain DNS that `AWSSESDomainService` must produce and the UI
must render as a copy-paste table:

| Record           | Host                  | Value                                                       |
|------------------|-----------------------|-------------------------------------------------------------|
| TXT (SPF)        | `@`                   | `v=spf1 include:amazonses.com ~all`                         |
| CNAME (DKIM × 3) | `<sel>._domainkey`    | `<sel>.dkim.amazonses.com` (3 selectors from SES)           |
| TXT (MAIL FROM)  | `mail`                | `v=spf1 include:amazonses.com -all`                         |
| MX (MAIL FROM)   | `mail`                | `10 feedback-smtp.<region>.amazonses.com`                   |
| TXT (DMARC)      | `_dmarc`              | `v=DMARC1; p=quarantine; rua=mailto:dmarc@acreos.io; pct=100` |
| TXT (BIMI)       | `default._bimi`       | `v=BIMI1; l=https://acreos.io/bimi/logo.svg; a=...vmc.pem`  |

**Code to ship in `AWSSESDomainService`:** `setupCustomMailFrom`
(`SetIdentityMailFromDomainCommand`, aligns SPF, kills the
envelope-sender mismatch ARC flags); `enableDkim`
(`VerifyDomainDkimCommand` → 3 CNAME rows in `dnsRecords`);
`pollVerification` (`GetIdentityVerificationAttributes` +
`GetIdentityDkimAttributes`, 5-min poll, flip `status=verified` only
when *both* `Success`). UI renders the 6-row table + per-record
status, no "Send" until all green. DMARC: enforce minimum
`p=quarantine`; reject sends from `p=none` past Gmail's 5K/day rule.

---

## 3. Dedicated IPs + warmup

**Pool architecture.**

- `acreos-shared-low` — Free + Starter, capped 100/org/day until
  14 contiguous days of <0.1% complaint and <2% bounce.
- `acreos-shared-high` — graduated Starter + Pro on shared.
- `acreos-dedicated-{orgId}` — Pro+ opt-in, Scale default. Use SES
  Dedicated IPs (Managed) at $24.95/mo — let AWS handle warmup
  automatically; do not buy raw Dedicated IPs unless the customer's
  volume justifies the babysit.
- `acreos-transactional` — *separate from all above*. Auth, password
  reset, billing, signing notifications. Never pooled with marketing
  regardless of tier.

Implement via `CreateConfigurationSet` + `CreateDedicatedIpPool` +
tag every `SendEmailCommand` with `ConfigurationSetName` based on
`isCampaignEmail` + tier.

**Warmup curve** (`server/services/sesWarmup.ts`, hard-coded per new
dedicated IP or new domain):

| Day | Cap | Day | Cap   | Day | Cap     |
|-----|-----|-----|-------|-----|---------|
| 1   | 50  | 8   | 1,500 | 22  | 50,000  |
| 2   | 100 | 9   | 2,500 | 25  | 80,000  |
| 3   | 250 | 10  | 5,000 | 28  | 120,000 |
| 4   | 500 | 14  | 10,000|     |         |
| 5   | 1K  | 18  | 25,000|     |         |

Reset to day-1 if complaint >0.3% in any rolling 24h. Halve cap for
48h if bounce >5%.

---

## 4. Bounce + complaint feedback loop

The single most-glaring gap. Without it, every other lever is blind.

1. `CreateConfigurationSetEventDestination` per config set,
   `EventTypes: [Bounce, Complaint, Delivery, Reject, Open, Click]`,
   destination = SNS `acreos-ses-events-{env}`.
2. SNS HTTPS subscription to `/api/webhooks/ses-events` with
   **SigV4 verification** (do not skip — unsigned subscribers have
   been pranked into adding spam to suppression lists).
3. `email_events` table: `id, organizationId, messageId, eventType,
   recipient, bounceType, bounceSubType, complaintFeedbackType,
   diagnosticCode, timestamp, raw JSONB`.
4. Materialized rollup `org_email_reputation` every 15 min:
   `bounceRate24h`, `complaintRate24h`, `deliveryRate24h`.
5. Auto-suspend: per-org bounce >5% over ≥1K sends OR complaint
   >0.5% over ≥1K → `organizations.emailSendingPaused=true` +
   founder Slack alert + remediation email to admin.

**Suppression list.** New `email_suppressions(organizationId,
emailLower, reason, suppressedAt, source)`. Sources: `hard_bounce`,
`complaint`, `manual_unsubscribe`, `list_unsubscribe_one_click`,
`platform_global`. Every `sendEmail()` short-circuits on suppression
match *before* SES is called. Honor BOTH per-org and platform-global.
This is the single highest-leverage intervention.

---

## 5. List-Unsubscribe + RFC 8058 one-click

Mandatory at >5K/day Gmail/Yahoo:

```
List-Unsubscribe: <mailto:unsub+{token}@acreos.io>, <https://app.acreos.io/u/{token}>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```

1. `EmailOptions.unsubscribeToken` = HMAC of
   `(orgId, recipient, listId, secret)`. Stable per-recipient-per-list.
2. `SendEmailCommand` cannot inject custom headers; switch to
   `SendRawEmailCommand` for any `isCampaignEmail=true`. Build MIME
   via `nodemailer`'s `MailComposer` — trivial to add.
3. `POST /api/u/:token` (one-click) and
   `mailto:unsub+:token@acreos.io` (SES inbound rule → S3 → Lambda
   → AcreOS) both write to `email_suppressions`.
4. HTML-footer link still ships for older clients but is no longer
   the primary signal Gmail looks for.

---

## 6. Domain reputation monitoring

Daily job `server/jobs/reputationMonitor.ts` per verified domain:
**Google Postmaster Tools API** (domain rep, IP rep, spam rate,
feedback loop, auth pass rate → `domain_reputation_daily`);
**Microsoft SNDS** (IP rep, CSV feed); **Talos + SenderScore +
Spamhaus DBL/SBL** (DNSBL checks — Talos red or any Spamhaus listing
pages founder + auto-pauses that org's marketing). Founder daily
digest 06:00 local: per-domain rep, 24h bounce/complaint/volume,
top-10 hard-bouncing recipient domains.

---

## 7. Custom domains for white-label

Pro+ wants to send from `mail.smithlandco.com` not `noreply@acreos.io`.
Flow: customer enters domain → AcreOS calls `VerifyDomainIdentity`
+ `VerifyDomainDkim` + `SetIdentityMailFromDomain(mail.<domain>)` →
render the §2 DNS table → poller flips `status=verified` when green.
Customer's `from` defaults to `noreply@<domain>`; SPF/DKIM/DMARC all
align on their domain; inbox placement is on their reputation, not
ours. Per-domain rep tracked in `domain_reputation_daily.domainId`.

**Trap:** customer's domain may have pre-existing bad reputation
(Spamhaus, low Postmaster score). Pre-flight on first verification —
Talos red or SBL listed = refuse to send + remediation walkthrough.
Do not inherit customers' reputation problems.

---

## 8. BIMI

Lower priority, real lift on Apple Mail and Gmail. Once a domain has
DMARC at `p=quarantine`+ for ≥30 days: customer uploads square SVG
(P/S Tiny PS profile, no scripts), AcreOS hosts at
`/bimi/{orgId}.svg`. For Gmail/Yahoo display, customer must purchase
a Verified Mark Certificate (DigiCert/Entrust, $1,499/yr OV-equivalent).
DNS row from §2. Document as white-glove Scale-tier; do not automate
VMC issuance (trademark verification is the customer's problem).

---

## 9. The 2-week deliverability sprint

Runs concurrently with Kira's T&S sprint — the two are load-bearing:
Kira's auto-suspend trigger fires on *my* bounce/complaint signals.

**Week 1 — survival**

- D1: SES SNS event destination + `/api/webhooks/ses-events` +
  `email_events` table + sigv4 verification.
- D2: `email_suppressions` table + short-circuit in `sendEmail()`.
- D3: `List-Unsubscribe` + `List-Unsubscribe-Post` via
  `SendRawEmailCommand` for campaign sends + one-click endpoint.
- D4: Configuration sets per pool (`shared-low`, `shared-high`,
  `transactional`, `dedicated-*`); route every send through correct set.
- D5: `org_email_reputation` rollup + per-org auto-suspend trigger
  + founder Slack alert.

**Week 2 — durability**

- D6: `VerifyDomainDkim` + `SetIdentityMailFromDomain` wired into
  domain setup; UI renders 6-row DNS table + green-check poller.
- D7: Warmup curve table + per-domain volume governor.
- D8: Postmaster Tools + SNDS + Talos/SBL DNSBL daily fetch +
  `domain_reputation_daily`.
- D9: Founder daily digest (06:00 local) + reputation widget on
  founder dashboard.
- D10: Rename `sendgridDomainId` → `providerDomainId`; document
  white-label flow; ship BIMI as Scale-tier checklist (no automation).

---

## Closing note

Kira said: don't let a paying customer torch the IP pool. Necessary,
not sufficient. Deliverability must *also* survive: a Postmaster red
on a single tenant; a Spamhaus listing on day 47 of a quiet domain;
a Gmail enforcement step-up that retroactively junks every
`noreply@acreos.io` without one-click unsubscribe; an SNDS yellow
that locks Outlook recipients out of password reset for 4 days.

Ship one thing this week: **SES SNS event destination + suppression
list + List-Unsubscribe one-click** (D1+D2+D3). Below that line,
Gmail's Feb-2024 rules junk transactional mail at AcreOS volumes
inside ~6 months. It's also the substrate Kira's auto-suspend hangs
from — without it, the abuse-prevention layer fires into a black box.

SPF/DKIM/DMARC is the second-most leveraged ship: difference between
"AcreOS-grade" and "spam-grade" in the inbox classifier, and Pro/Scale
won't buy white-label deliverability that doesn't expose it.

BIMI is year-2. Don't put it on the critical path; don't ignore it
forever — Apple Mail's Personalized Sender Image is already lifting
open-rates ~13% on senders that ship it.

— Eleonora

# Security Awareness Training Policy

**Owner:** Founder
**Last reviewed:** 2026-05-27
**Review cadence:** Annual + on every team-size change
**Audience:** Cyber + Tech-E&O underwriting, SOC 2 CC1.4 evidence, employee onboarding

> Underwriters note: ~60% of pre-Series-B SaaS companies skip
> security-awareness training entirely. A documented, dated, founder-signed
> attestation puts AcreOS above that median even at a one-person team.

---

## 1. Policy statement

Every person with production access — employees, contractors, virtual
assistants (`va` role), and the founder — completes documented security
awareness training **annually** plus **on initial onboarding**. Training
covers phishing recognition, credential hygiene, social engineering,
data-handling for customer PII, and AcreOS-specific incident-reporting
procedures.

The training itself is short (target: <60 minutes), focused, and
practical. The output is a **signed attestation** per person, per
year, committed to `docs/audits/training-attestations/YYYY/<name>.md`.

---

## 2. Curriculum

The annual training, in order:

### Module 1 — Phishing recognition (20 min)

- **The red flags:** urgency, authority spoofing, unexpected
  attachments, sender-domain misspellings (`acre0s.com`, `acreos-help.com`),
  reply-to mismatches.
- **AcreOS-specific phishing patterns:**
  - Fake "Clerk security alert" emails asking for credentials
  - Fake "Stripe payout pending" with malicious links
  - Fake "GitHub auth notification" asking the user to re-authorize
  - Fake "Fly.io payment failure" asking for credit-card update
  - Vendor-impersonation: emails claiming to be from Twilio / SendGrid / OpenAI billing
- **What to do when suspicious:** do not click; forward the full headers
  to the security-on-call channel; if already clicked, treat as
  potentially compromised under §6.

### Module 2 — Credential hygiene (10 min)

- **Password manager required** — 1Password (org-paid). No passwords
  stored in plaintext, browser-saved, or shared via Slack DM.
- **MFA on every privileged surface** — GitHub, Fly.io, Clerk dashboard,
  Stripe dashboard, AWS, Cloudflare, OpenAI / Anthropic consoles,
  Notion, Linear. **No exceptions for "personal" accounts that touch
  the company surface.**
- **No SSH-key sharing.** Each developer generates their own; revoke on
  off-boarding.
- **No API-key sharing.** Use the Fly.io secrets surface, not
  copy-paste in Slack.

### Module 3 — Social engineering (10 min)

- **The founder-spoof attack:** "Hi, this is Thomas — I need you to wire
  $5K to this vendor / forward me the password for X / approve this
  Stripe refund." **Always** verify out-of-band through a known channel
  before acting on any unusual request, even if it appears to come from
  the founder.
- **Customer-spoof attack:** someone pretending to be a customer asking
  for account changes via email. Always verify via the in-app help
  flow with the authenticated customer.
- **Vendor-call attack:** someone calling claiming to be from Stripe /
  Twilio / Fly.io support and asking for credentials or to "verify your
  account." Real vendors never ask for credentials over the phone.
  Hang up; call the vendor back via the published support number.

### Module 4 — Data handling (10 min)

- **Customer PII** never leaves AcreOS systems unless (a) the customer
  has requested an export, (b) it is going to a documented sub-processor
  per `docs/vendor-inventory.md`, or (c) a law-enforcement subpoena
  applies (in which case escalate to founder + legal counsel).
- **No customer data in personal email, personal cloud drives, or
  personal devices.** Use only work-issued machines.
- **No customer data in AI assistant chats** outside the AcreOS app
  surface (which itself has PII redaction). If you paste customer data
  into ChatGPT / Claude.ai personal accounts, that is a notifiable
  incident under §6.
- **Screen-share hygiene:** when sharing screens (sales calls, support
  sessions, screen recordings), close every tab that shows customer
  data. Default to closing all tabs and re-opening only the relevant one.

### Module 5 — AcreOS incident reporting (5 min)

- **Who to tell:** founder + on-call eng via the security-on-call channel.
- **How fast:** as soon as practical. There is no penalty for false
  positives. The only error is staying quiet on something that turns
  out to be real.
- **The runbooks:** memorize the location, not the content.
  `docs/runbooks/data-breach-response.md` is the master.
- **The 72-hour clock:** under GDPR Article 33, AcreOS has 72 hours from
  *awareness* of a breach to notify the supervisory authority. The
  clock starts when you tell us; not telling us doesn't stop it.

---

## 3. Onboarding training

New person with production access gets the full curriculum above on
day 1, before any credential is issued. The attestation is signed
before the first credential is created (Fly.io token, GitHub access,
Clerk dashboard invite).

---

## 4. Annual refresh

Each person re-takes a condensed version (target: 30 minutes) annually
on the anniversary of their initial training. The condensed version
focuses on:

- New phishing patterns observed in the wild since the last training
- Any AcreOS-specific incidents from the last year, lessons learned
- A short quiz (5 questions, open-book) to confirm comprehension

---

## 5. Attestation template

Each person commits this to `docs/audits/training-attestations/YYYY/<name>.md`:

```markdown
# Security Awareness Training Attestation — YYYY

**Name:** <full name>
**Role:** <founder / engineer / VA / contractor>
**Date completed:** YYYY-MM-DD
**Training version:** docs/policies/security-awareness-training.md @ <git SHA>
**Next refresh due:** YYYY+1-MM-DD

## Modules completed
- [x] Module 1 — Phishing recognition
- [x] Module 2 — Credential hygiene
- [x] Module 3 — Social engineering
- [x] Module 4 — Data handling
- [x] Module 5 — AcreOS incident reporting

## Attestation
I have completed the AcreOS Security Awareness Training. I understand the
phishing patterns, credential-hygiene requirements, social-engineering
defense, data-handling rules, and incident-reporting procedures
described in the linked policy. I commit to escalating any suspected
security incident immediately via the security-on-call channel, even
if I am uncertain it is real.

Signed: <full name>
Date: YYYY-MM-DD
```

---

## 6. Incident-reporting expectation

A person who completes this training **must** report:

- Any suspected phishing email they received that targeted AcreOS or their AcreOS-linked account
- Any time they clicked a suspicious link before recognizing it as suspicious
- Any time they shared credentials with someone (even by accident)
- Any time they pasted customer data into a non-AcreOS tool
- Any time their personal device was lost or stolen while it had AcreOS access
- Any time they received an unusual request claiming to be from another team member

The standard is: **err toward reporting**. False positives are free;
silence is expensive.

---

## 7. Single-founder attestation (current state)

Until AcreOS has a second person with production access, the founder
attestation is the sole training record. It is signed annually and
committed to `docs/audits/training-attestations/<year>/founder.md`.

This single-founder state is honestly disclosed on the cyber-insurance
application; it does not earn the same credit as a 5-person training
program, but it is materially better than "no training program at all,"
which is where many pre-revenue SaaS companies sit.

---

## 8. Carrier-application answer (canonical)

> **Q: Do you provide security awareness training to employees?**
> **A:** Yes. Policy at `docs/policies/security-awareness-training.md`.
> Training is required on onboarding and annually thereafter; it covers
> phishing, credential hygiene, social engineering, data handling, and
> incident reporting. Signed attestations are committed to source
> control at `docs/audits/training-attestations/<year>/<name>.md`. At
> current team size (single founder), one attestation exists; the
> program scales to the headcount.

---

## 9. Change history

| Date | Change |
|---|---|
| 2026-05-27 | Initial policy + curriculum authored |

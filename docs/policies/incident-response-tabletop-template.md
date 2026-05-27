# Incident-Response Tabletop Drill — Template + Runbook

**Owner:** Founder (until IR captain role is staffed)
**Last reviewed:** 2026-05-27
**Cadence:** Annual minimum; quarterly recommended once team > 3
**Audience:** Cyber + Tech-E&O underwriting, SOC 2 CC7.3 evidence, customer security reviews

> Underwriters give credit for *running* an annual tabletop. They give
> meaningful credit for *documenting* the structure of the drill and
> producing dated minutes from each session. This template is the
> latter; running the drill produces the former.

---

## 1. Why this exists

A "tabletop" is a structured walk-through of an incident scenario where
participants narrate what they would do, **without** actually touching
production. The output is an honest assessment of:

- Whether the runbook for that scenario exists and is current
- Whether on-call has the access / credentials / contact info needed
- Whether RTO / RPO claims would hold under the scenario
- Whether legal-notification timelines (GDPR 72h, CCPA 45d, state breach laws) are achievable
- Whether the cyber-insurance broker is reachable inside the policy's notification window

Tabletops typically take 60–90 minutes. They produce a written record
(see §6) that lives in `docs/audits/tabletops/<date>-<scenario>.md`.

---

## 2. Cadence and scenario rotation

| Quarter | Scenario | Primary runbook |
|---|---|---|
| Q1 | Ransomware on a developer laptop | §4.1 below + `docs/runbooks/data-breach-response.md` |
| Q2 | Data exfiltration via compromised API key | §4.2 below + `docs/runbooks/data-breach-response.md` |
| Q3 | Insider threat (departing employee with `owner` role) | §4.3 below + `docs/runbooks/founder-account-recovery.md` |
| Q4 | Vendor breach (Clerk / Stripe / Twilio compromise) | §4.4 below + `docs/runbooks/clerk-incident-response.md` |

Annual minimum: at least the ransomware scenario, run once per calendar
year, with written record committed to source control.

---

## 3. Roles for the drill

| Role | Person (default) | Responsibilities |
|---|---|---|
| **IR Captain (facilitator)** | Founder | Reads the scenario, drives the timeline, makes calls |
| **Engineering lead** | On-call | Walks through technical containment + diagnosis |
| **Legal counsel** | Outside counsel on retainer | Notification timelines + privilege calls |
| **Customer comms** | Founder (until CS lead is hired) | Drafts customer notification copy |
| **Scribe** | Anyone not actively narrating | Captures decisions + timestamps |
| **Observer (optional)** | Insurance broker, customer security contact | Watches; does not speak unless asked |

In a single-founder org, the founder plays IR Captain + Eng lead + Comms;
the scribe role is non-negotiable (cannot be the same person).

---

## 4. Scenarios

### 4.1 — Ransomware on a developer laptop

**Pre-read (drill participants):** `docs/runbooks/data-breach-response.md`,
`docs/runbooks/founder-account-recovery.md`,
`docs/disaster-recovery.md`.

**Scenario narrative (read by facilitator):**

> It is 09:14 on a Tuesday. The founder opens a laptop and sees a full-screen
> ransom note: "All your files are encrypted. Pay 0.5 BTC to recover." The
> laptop has been used to push code to GitHub, run `flyctl` against production,
> open the Clerk dashboard, and access Stripe. The founder cannot tell whether
> production has been touched. The laptop's disk shows ~80% of files
> encrypted.

**Questions the facilitator works through (10 minutes each):**

1. **First 5 minutes:** What does the founder *physically* do? (Power off? Pull network? Take a photo of the ransom note? Call who first?)
2. **Credentials:** Which credentials must be assumed compromised? (Answer should include: GitHub, Fly.io, Clerk dashboard, Stripe dashboard, AWS, Sentry, every API key the laptop has touched.) Where is the master list of credentials to rotate? (Answer: §5 of this doc + `docs/runbooks/clerk-incident-response.md`.)
3. **Fly.io blast radius:** Has the laptop's `flyctl` token ever been used to deploy or run `flyctl ssh console`? If yes, treat production as potentially touched. How do we audit recent deploys? (Answer: `flyctl releases list -a acreos`, `flyctl ssh log -a acreos`.)
4. **Production lockdown:** Do we rotate `FIELD_ENCRYPTION_KEY` now or wait? (Answer: rotate per `docs/security.md` Annual Key Rotation procedure. Triggers re-encrypt of all encrypted DB fields.)
5. **GitHub:** Are there secrets in commit history? (Answer: trigger gitleaks scan from the security workflow on the last 90 days of commits.)
6. **Customer-facing:** Is this a "personal data breach" under GDPR Article 4? (Answer: depends on whether production data was accessed. If unclear, **assume yes** and start the 72-hour clock to supervisory authority notification.)
7. **Insurance:** What is the carrier notification SLA? (Answer: look up from the bound policy — typically "as soon as practicable, not later than X days after discovery." Call the broker first, claims line second.)
8. **What did we get wrong?** Open-floor reflection.

**Output:** Drill minutes committed to `docs/audits/tabletops/<date>-ransomware.md`.

### 4.2 — Data exfiltration via compromised API key

**Pre-read:** `docs/runbooks/data-breach-response.md`, `docs/runbooks/gdpr-dsar-fulfilment.md`.

**Scenario narrative:**

> Sentry alerts that an outbound API call is being made from a Fly.io worker
> to an unfamiliar domain (`exfil-cdn.example.com`) over the last 6 hours.
> Investigation shows that a third-party data-provider API key
> (`SKIP_TRACE_API_KEY`) was committed to a public GitHub gist 8 days ago
> by a contractor. The provider is rate-limiting AcreOS because of unusual
> volume. ~200,000 skip-trace lookups have been made on the key in the past
> week — far above our usage.

**Questions:**

1. **Containment:** Rotate the key (`fly secrets unset && fly secrets set`). Done — how long did it take? Target: <5 minutes from discovery.
2. **Scope:** What data did the leaked key have access to? (Answer: read-only skip-trace queries by name/address; no AcreOS customer PII directly. But the *queries themselves* may be PII.)
3. **Notification:** Does this trigger a customer-facing breach notification? (Answer: depends on whether the queries originated from customer-uploaded contact data. If yes — yes.)
4. **Cost containment:** What is the dollar exposure? (Answer: 200K × per-lookup cost. Provider chargeback procedure.)
5. **Detection improvement:** Why did we not detect this for 7 days? Add an alert on (a) outbound traffic to unknown domains, (b) skip-trace volume > 2x weekly rolling average, (c) gitleaks scan on the public GitHub org.

**Output:** Drill minutes committed to `docs/audits/tabletops/<date>-exfil.md`.

### 4.3 — Insider threat (departing employee with `owner` role)

**Pre-read:** `docs/runbooks/founder-account-recovery.md`, `docs/policies/mfa-enforcement-policy.md`.

**Scenario narrative:**

> An employee with the `owner` role on three customer organizations resigns
> with two weeks' notice. On day 3 of notice, Slack messages between the
> employee and a competitor are surfaced suggesting they intend to download
> a customer's lead database before leaving. The employee still has MFA-verified
> access to all three orgs. Today is Monday; their last day is Friday.

**Questions:**

1. **Access reduction now or at termination?** Defensible answer: revoke
   the `owner` role today, downgrade to `viewer` or `member`. The
   `audit_events` table will record the downgrade.
2. **What about the data they've *already* exported?** Check `audit_events`
   for `data.export.*` actions by this user in the last 30 days.
3. **NDA / contract terms:** Confirm with legal counsel that the data
   they have legitimate access to is still NDA-protected after termination.
4. **Customer notification:** Do we tell the three customers? (Answer:
   likely yes — under most enterprise contracts, change of access to a
   privileged customer-data role is a notifiable event.)
5. **Future control:** Should we add an "off-boarding workflow" trigger
   that auto-downgrades departing employees on a date? (Add to roadmap
   if not present.)

**Output:** `docs/audits/tabletops/<date>-insider.md`.

### 4.4 — Vendor breach (Clerk / Stripe / Twilio compromise)

**Pre-read:** `docs/vendor-inventory.md`, `docs/runbooks/clerk-incident-response.md`, `docs/runbooks/stripe-webhook-replay.md`, `docs/runbooks/twilio-shortcode-block.md`.

**Scenario narrative:**

> Clerk announces a security incident at 14:00. A subset of their database
> tables containing user emails, password hashes, and MFA secrets has been
> exposed. They estimate that some AcreOS users are affected. Their advice:
> force a password reset on all users and re-enroll MFA. They will publish
> the affected-user list within 24 hours.

**Questions:**

1. **First action:** Force-revoke all Clerk sessions via `clerkClient.users.revokeAllSessions()` across the user base? (Trade-off: every user is signed out simultaneously.)
2. **MFA re-enrollment:** What do we communicate to users? (Answer: in-app + email + SMS — "Your session has been signed out as a precaution after a vendor security event. Please sign in and re-enroll MFA.")
3. **Concurrent vendor failure:** Could we operate AcreOS for 4 hours without Clerk? (Answer: no — Clerk is on the critical path for login. This is a *Tier-1 vendor* per `docs/vendor-inventory.md`.)
4. **Public communication:** Is a status-page post required? (Answer: yes if any customer is affected, even if root cause is upstream.)
5. **Future control:** Do we have a Clerk-equivalent fallback? (Likely no; cost / complexity tradeoff. Note in vendor risk register.)

**Output:** `docs/audits/tabletops/<date>-vendor-breach.md`.

---

## 5. Master credential rotation list

(Referenced by §4.1 question 2. Maintained here so the drill doesn't
stall hunting for it.)

| Credential | Where stored | Rotate via |
|---|---|---|
| `CLERK_SECRET_KEY` | Fly secret | Clerk dashboard → keys → rotate → `flyctl secrets set` |
| `CLERK_JWT_KEY` | Fly secret | Clerk dashboard |
| `STRIPE_SECRET_KEY` | Fly secret | Stripe dashboard |
| `OPENAI_API_KEY` | Fly secret | OpenAI dashboard |
| `ANTHROPIC_API_KEY` | Fly secret | Anthropic console |
| `FIELD_ENCRYPTION_KEY` | Fly secret | `server/scripts/rotateEncryptionKey.ts` (re-encrypts data) |
| `DATABASE_URL` | Fly secret | `flyctl postgres detach && attach` |
| `REDIS_URL` | Fly secret | Upstash / Fly Redis console |
| `SENTRY_AUTH_TOKEN` | Fly secret + GH secret | Sentry dashboard |
| `TWILIO_AUTH_TOKEN` | Fly secret | Twilio console |
| `SENDGRID_API_KEY` | Fly secret | SendGrid console |
| `SKIP_TRACE_API_KEY` | Fly secret | Provider portal |
| GitHub Actions secrets | GH org | Settings → Secrets |
| GitHub personal access tokens | Per-developer | `gh auth refresh` |
| Fly.io API token | Per-developer | `fly tokens create` (rotate yearly) |

The rotation order for a *full* credential burn (worst case, §4.1):
GitHub → Fly → Clerk → Stripe → Cloudflare DNS → all third-party APIs.

---

## 6. Drill minutes template

Save to `docs/audits/tabletops/YYYY-MM-DD-<scenario>.md` after each drill.

```markdown
# Tabletop drill — <scenario> — YYYY-MM-DD

**Facilitator:** <name>
**Participants:** <names + roles>
**Scenario:** §4.x of incident-response-tabletop-template.md
**Duration:** <minutes>

## Decisions made
- HH:MM — <decision> (rationale: ...)
- HH:MM — <decision>

## Runbook gaps discovered
- <gap> — owner: <name>, due: <date>
- <gap> — owner: <name>, due: <date>

## Action items
- [ ] <item> — owner — due
- [ ] <item> — owner — due

## RTO / RPO assessment for this scenario
- Estimated RTO under this scenario: <hours>
- Estimated RPO under this scenario: <hours>
- vs. policy target (4h RTO / 1h RPO): <pass / fail / partial>

## What we got wrong
<honest reflection — this is the most valuable section>

## Next scenario (next quarter)
<rotation per §2>
```

---

## 7. Carrier-application answer (canonical)

> **Q: Do you conduct incident-response tabletop exercises?**
> **A:** Yes. We run a structured annual tabletop minimum (quarterly
> recommended) following the template at
> `docs/policies/incident-response-tabletop-template.md`. The template
> covers four rotating scenarios (ransomware, data exfiltration,
> insider threat, vendor breach), each with a pre-read of the relevant
> runbook and a structured question list. Drill minutes — including
> RTO/RPO assessments and runbook gaps — are committed to
> `docs/audits/tabletops/`.

---

## 8. Change history

| Date | Change |
|---|---|
| 2026-05-27 | Initial template authored |

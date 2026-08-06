# T2 — Trace: Message Out (import → campaign → compliance → BYO rail → send → audit)

**Region state.** The outbound-message machinery is two-faced. There is a
genuinely excellent, gate-by-construction SMS choke point (`sendOrgSMS` →
`tcpaGateForRecipient` → consent → quiet hours → Searchbug DNC/litigator scrub →
frequency cap), and the DNC seam is one of the most carefully-reasoned files in
the repo (honest "not checked ≠ clean", fail-closed for marketing). Email
unsubscribe is genuinely honored programmatically (one-click writes
`email_suppressions`; every send calls `filterSuppressed`). Direct mail runs
`runPreMailDedupe` (honors `doNotContact`) before postage.

**The one defect class that survives every gate here:** the *primary customer
button* — `POST /api/campaigns/:id/send-sms` — does **not** go through that
choke point. It calls the Twilio SDK directly, so the Searchbug DNC/litigator
scrub, the contact-frequency cap, and BYO-Twilio identity are all bypassed, and
the DNC seam's own header (which lists "campaign" as a path that "can[not] skip
it") is false. The gate exists; the bulk path routes around it. Every unit test
that "proves" the gate covers `sendOrgSMS` only.

---

### F-21-1 — Campaign SMS batch bypasses the DNC/litigator scrub by calling Twilio directly
**Severity:** P0 blocking
**Surfaced by:** T2 (message-out trace)
**Survives which gates:** `smsGateAndCapture.test.ts` (`tests/unit/`, line 142)
asserts the gate only for `sendOrgSMS`; it never exercises the campaign route.
No lint or ratchet forbids a raw `client.messages.create` outside the choke
point. `lint:reachability` sees the send call reached, not that it skipped the
scrub. So the bypass is green on every gate.
**Evidence:** `server/routes-campaigns.ts:2214` — `await client!.messages.create({ to: lead.phone, from: twilioPhone, body })` inside the batch loop. The only pre-filter is `canSendViaChannel(l,"sms")` (`routes-campaigns.ts:2076`), which is a pure in-memory read of `lead.tcpaConsent`/`lead.doNotContact` (`tcpaCompliance.ts:407-433` — no network, no scrub), plus quiet hours. The Searchbug scrub lives **only** in `sendOrgSMS` → `dncGateForSms` (`smsService.ts:223-244`), which this route never calls. The DNC seam header claims the opposite: `dncScrub.ts:40-42` — "so no send path (manual, AI tool, autopilot hand, campaign) can skip it."
**What's wrong:** A lead imported with `tcpaConsent=true` (asserted at import, trivially spoofable) and no prior STOP passes `canSendViaChannel`. If that number is on the federal/state DNC registry or belongs to a known TCPA serial litigator, the litigator/DNC scrub — whose entire policy is "litigator ALWAYS blocks even with consent" (`dncScrub.ts:317-321`) — is never consulted, because the batch never reaches the choke point. The contact-frequency cap is bypassed identically.
**Impact:** Burns trust / creates legal exposure after sale — but the victim is the *customer* who clicks "Send SMS campaign" (the dominant cold-outreach path) believing the platform's advertised DNC scrub protected them. Statutory TCPA damages are $500–$1,500 per message; a serial-litigator hit is a targeted lawsuit. This is the exact "selected-but-unused vendor silently passing every number" failure CLAUDE.md's wave-discipline section warns about, reincarnated one layer up.
**Fix:** Route the batch through `sendOrgSMS(org.id, lead.phone, body)` per recipient (it already does consent + quiet hours + DNC + frequency + BYO Twilio + ledger), deleting the raw-Twilio loop (`routes-campaigns.ts:2160-2226`). If per-recipient latency matters, extract a `dncGateForSms` + frequency call into the existing filter before the loop. Do NOT re-implement the scrub inline.
**Gate it:** New test `campaignSmsGoesThroughChokePoint.test.ts`: mock the DNC provider to `litigator`, POST `/api/campaigns/:id/send-sms` with a consenting lead, assert zero Twilio calls and the recipient reported blocked. Plus a lint/grep ratchet: **0** occurrences of `messages.create(` / raw `twilio(` outside `server/services/comms/` (measured baseline today: **1**, this site).
**Effort:** M
**Blast radius:** `routes-campaigns.ts` send-sms handler only; `sendOrgSMS` unchanged.
**Confidence:** high — the raw call, the in-memory-only pre-filter, and the choke-point-only gate are all read directly.

---

### F-21-2 — Campaign SMS sends from the PLATFORM Twilio number, ignoring org BYO Twilio
**Severity:** P1 serious
**Surfaced by:** T2
**Survives which gates:** No ratchet/lint covers SMS rail identity. The email
analogue *is* enforced (`purpose:'counterparty'`, `routes-campaigns.ts:1967`;
`emailService.ts:533-560`), but nothing checks the SMS path for parity.
**Evidence:** `routes-campaigns.ts:2142-2144` reads `process.env.TWILIO_ACCOUNT_SID/AUTH_TOKEN/PHONE_NUMBER` and sends `from: twilioPhone` (`:2216`). No `organizationIntegrations` / BYOK lookup anywhere in the handler (grep of lines 2042-2226: only `process.env.TWILIO_*`). Contrast the gated path, which resolves org BYOK Twilio inside the adapter (`smsService.ts:18-20`).
**What's wrong:** Every customer's cold SMS traffic funnels through one shared platform Twilio number and AcreOS's own A2P 10DLC registration. One customer's spam complaints degrade the number for all; worse, a TCPA/DNC violation committed on the platform number is attributed to AcreOS, not the customer. An org that connected its *own* Twilio (the intended model) is ignored on this path; an org that connected nothing still sends if the platform env is set.
**Impact:** Burns trust + concentrates legal/carrier-reputation risk on the platform. Hurts the founder (rail gets flagged/deregistered) and every customer sharing it. Collides with the "be the rail, not the provider / no re-fronting send rails" posture (see Constitution Collisions).
**Fix:** Same fix as F-21-1 resolves this — `sendOrgSMS` already resolves org BYOK Twilio and should refuse (like counterparty email) when the org has no connected SMS identity, rather than falling through to a platform number for marketing traffic.
**Gate it:** Assert in the same new test that a campaign send with no org Twilio integration is refused, not silently sent on platform creds. Baseline: platform-only path currently at `routes-campaigns.ts:2142`.
**Effort:** M (folded into F-21-1)
**Blast radius:** send-sms handler.
**Confidence:** high.

---

### F-21-3 — CAN-SPAM postal address fails OPEN: emails ship with no physical address when none is resolvable
**Severity:** P2 real
**Surfaced by:** T2
**Survives which gates:** `lint:no-fabrication` (correctly) forbids a
placeholder address, which is *why* the code omits the line — but nothing
requires an address to be present before an email leaves. The startup WARN
(`emailService.ts:38-43`) is advisory, not blocking.
**Evidence:** `emailService.ts:72-93` (`resolveCanSpamAddress`) returns `null` when both `CAN_SPAM_MAILING_ADDRESS` (unset by default — `.env.example` has no value) and the org's `taxAddress` are absent. `emailService.ts:609-616`: on `null`, `brandLine = 'AcreOS'` and the footer renders only the brand name — the send proceeds. CAN-SPAM §5(a)(5) requires a valid physical postal address in every commercial email.
**What's wrong:** A brand-new org with no `taxAddress` on file (and no platform env secret) ships marketing campaigns that are missing a federally-required element. The code correctly refuses to *fabricate* an address but then fails open — it sends anyway — rather than refusing the send the way the counterparty-identity check does.
**Impact:** Burns trust / legal exposure after sale; FTC CAN-SPAM penalties run to ~$51,744 per email. Conditional — mitigated whenever the org has a `taxAddress` (usually populated from billing), so real but not universal.
**Fix:** Mirror the counterparty pattern: when `shouldRenderCanSpamFooter(options)` is true and `resolveCanSpamAddress` returns `null`, refuse the send with `errorType:'configuration_error'` ("Add your business mailing address in Settings before sending campaigns") instead of rendering a brand-only footer.
**Gate it:** Unit test on `sendEmail`: campaign email + no resolvable address ⇒ `success:false`, SES never called. Currently no such assertion exists.
**Effort:** S
**Blast radius:** `emailService.sendEmail` footer branch; campaign + lifecycle email callers.
**Confidence:** high — read directly; the omit-not-refuse choice is explicit in comments.

---

### F-21-4 — Campaign SMS batch writes only a delivery-event row, not a message/audit row
**Severity:** P3 minor
**Surfaced by:** T2
**Survives which gates:** None target audit-trail completeness for the batch path.
**Evidence:** `routes-campaigns.ts:2228` inserts only `campaignDeliveryEvents` (status "sent"). No `messages` row and no `activityLog` row is written for the outbound. Contrast `sendSMSToLead` (`smsService.ts:357-368`), which writes a `messages` row into the conversation.
**What's wrong:** A campaign-sent SMS does not appear in the lead's conversation/inbox thread and leaves a thinner evidentiary trail than the single-send path. For a TCPA dispute the exhibit is weaker (no per-message content row tied to the conversation, only an aggregate delivery event).
**Impact:** Neither blocks sale nor immediately burns trust; hurts the customer only during a dispute or when reconciling "what did we actually send this lead". Largely subsumed if F-21-1's fix routes through `sendOrgSMS` (which records the touch).
**Fix:** Resolved as a side effect of F-21-1 (route through the sender, which records to the conversation + frequency ledger).
**Gate it:** none needed beyond F-21-1's test.
**Effort:** S (folded into F-21-1)
**Blast radius:** send-sms handler.
**Confidence:** high.

---

## Coverage ledger

**Examined exhaustively (read in full):**
`server/services/compliance/dncScrub.ts`, `.../searchbugDncProvider.ts`,
`server/services/smsService.ts`, `server/services/emailService.ts`, the
campaign send handlers in `server/routes-campaigns.ts` (send-direct-mail
726-1080, send-email 1879-2010, send-sms 2042-2233), `canSendViaChannel` /
`checkTcpaConsentFromLead` in `tcpaCompliance.ts`, the unsubscribe one-click
handlers in `routes-deliverability.ts`, and `emailSuppressions.ts` (suppress +
filterSuppressed surface).

**Examined by sampling / call-graph grep (not line-by-line):**
`sequenceProcessor.ts` (confirmed SMS path uses `sendOrgSMS:581`, email uses
`emailService.sendEmail:494`, mail uses `MailRouter:628`); `communications.ts`,
`server/ai/tools.ts`, `dunning.ts`, `alertPolicy.ts` (verified which SMS entry
point each uses); `preMailDedupe.ts` (confirmed it filters `doNotContact`, not
read in full); `comms/router.ts` + `twilio` adapter (confirmed BYOK resolution
lives there, header-level read); `unsubscribeTokens.ts` (issue/resolve/markUsed
surface).

**Did NOT examine:** `directMailService.ts` (456 lines) and `directMail.ts`
internals beyond the Lob send signature — the two-file duplication is flagged
for slice 04, not re-litigated here; the Lob/PostGrid `mail/router.ts` provider
selection; `contactFrequency.ts` internals (assumed correct — its bypass is
covered transitively by F-21-1); `consentEvents.ts` write path; the client-side
campaign builder UI; whether `SEARCHBUG_*` creds are actually provisioned in the
deploy environment (unknowable from code — but note `DNC_SCRUB_PROVIDER=none` is
the `.env.example` default, so even the *gated* path is inert until the founder
sets it).

---

## Constitution Collisions

**One collision, noted not as a finding:** F-21-2 (campaign SMS on the platform
Twilio number) sits against the standing decision *"No re-fronting platform send
rails … counterparty mail requires the org's own connected identity (BYO); the
platform sender is for system mail only"* (founder decision 2026-07-17). That
decision names email (`emailService` purpose lanes) explicitly; the SMS campaign
path is the same principle applied to a different rail, and it is currently
violated. This is surfaced as a code defect (parity with the enforced email
lane) rather than a request to change the constitution — the constitution is
correct; the SMS path just doesn't honor it yet. No relitigation intended.

---

### One-line verdict

**If a customer ran an SMS campaign today: their consent + quiet-hours + prior-STOP
filters would hold, but the advertised Searchbug DNC/litigator scrub and
frequency cap would silently NOT run (the batch calls Twilio directly), the
message would ship from AcreOS's own platform number, and a single hit on a
serial TCPA plaintiff would land as a lawsuit attributed to the platform — the
exact selected-but-bypassed-scrub failure the codebase already knows it is prone
to.** (Email campaigns, by contrast, are compliant: unsubscribe is honored
programmatically and BYO identity is enforced — save the fail-open postal-address
edge in F-21-3.)

# Beata Nagy — Vendor outage runbooks (Wave 2)

**Lens:** five years on-call at Datadog, then Vercel. Vendor failures are not "if" — they are "when." The team that wrote the runbook ahead of time stays calm; the team that writes it during the outage ships the wrong fix at 3am and apologizes for a week. Olu's audit pegs AcreOS at 9-of-20 events with runbooks. The 8 missing ones include every customer-facing vendor in the auth path. That's a coin-flip outage away from a 100%-blast-radius incident with no script.

---

## 1. One-line verdict

**Vendor-failure preparedness: D-plus.** The infrastructure exists (`externalStatusMonitor.ts`, `alertPolicy.ts`, provider-registry circuit breakers) but the *human* layer — who's paged, what they say to the customer, when do we declare incident — is undocumented for 7 of 10 critical vendors. One Clerk outage and AcreOS goes silent on Twitter for two hours.

---

## 2. Per-vendor runbooks

Each runbook follows the same shape: **Symptoms / Mitigation / Comms / Recovery**. All are P0 or P1 unless noted. All assume `acreos.fly.dev` production.

### 2.1 Clerk auth outage — P0

**Symptoms.** `/sign-in` and `/sign-up` return Clerk-branded errors; existing sessions hang on token refresh; `clerk.acreos.io` (proxy domain) returns 5xx; status.clerk.com shows incident; spike in `auth_failure_total` metric; support inbox fills with "I can't log in."

**User impact.** New signups: blocked. Existing customers with valid session cookies (≤7 days old): app works until next token refresh, then locked out. Estimated blast radius at 50 customers: 60–100% within 2 hours.

**Mitigation.**
1. Confirm scope: hit https://status.clerk.com and https://api.clerk.com/v1/health. If Clerk-side, this is a wait-and-comms incident — we cannot self-mitigate.
2. If Clerk is up but our proxy is down: check Cloudflare DNS for `clerk.acreos.io` CNAME → `frontend-api.clerk.services`. See 2.2.
3. Disable forced re-authentication: set `CLERK_SESSION_TOKEN_LIFETIME` to max (7d) via Clerk dashboard so existing sessions hold longer. (Pre-staged config; document in `server/auth/clerk-config.ts`.)
4. Pause any cron or job that calls `clerkClient.users.*` admin API to avoid back-pressure when Clerk recovers.
5. Set the `AUTH_DEGRADED_BANNER` feature flag to surface a yellow banner site-wide on authenticated pages.

**Comms.**
- T+5 min: post to `#incidents` Slack with vendor=Clerk, severity=P0, ETA=unknown.
- T+10 min: status-page entry ("Authentication is currently impacted. We are tracking Clerk's incident.") + tweet from @acreos.
- T+15 min: email blast to all org admins via SendGrid (auth doesn't depend on SendGrid; fine).
- Update every 30 min until resolved.

**Recovery.**
1. Once Clerk reports resolved, hit `/sign-in` from a clean browser — verify token issue.
2. Re-enable any paused crons.
3. Run the post-incident check: `npm run scripts:audit-stuck-sessions` (to be written) — flags users with broken token state.
4. Status-page resolution + post-mortem within 48 hours.

---

### 2.2 Cloudflare DNS / proxy outage — P0

**Symptoms.** `acreos.io` and `app.acreos.io` return DNS NXDOMAIN or Cloudflare 5xx error pages (520/521/522); `clerk.acreos.io` proxy domain returns 5xx (this also breaks Clerk per persona-architecture memo); synthetic monitor `external-dns-check.ts` fires.

**User impact.** 100% lockout. Even the status page may be affected if it's hosted on a Cloudflare-fronted domain.

**Mitigation.**
1. Confirm scope at https://www.cloudflarestatus.com. If it's a regional edge issue, customers in unaffected regions still work.
2. If DNS-only (Cloudflare DNS down but origin is up): switch to a backup DNS provider (Route53 secondary configured but not primary today — see Sprint item 4). NS change propagates 5–30 min.
3. If full Cloudflare proxy outage: temporarily set DNS records to "DNS Only" (grey cloud) bypassing the proxy. Loses DDoS protection and edge cache; customers hit Fly.io origin directly.
4. If origin overwhelmed by direct hits: enable Fly.io rate limiting at the app layer (`server/middleware/rateLimit.ts` already supports this).

**Comms.**
- The status page MUST be hosted on a non-Cloudflare-fronted subdomain (e.g. `status.acreos.io` via Statuspage.io). Verify this before the incident.
- T+5: tweet from @acreos via mobile (don't depend on dashboards).
- T+10: SMS blast to top-20 customer admins via Twilio (assuming Twilio not also down).
- T+15: status-page entry.

**Recovery.** Re-enable Cloudflare proxy; flush DNS caches; confirm Clerk proxy domain recovers; verify edge cache fills cleanly.

---

### 2.3 Fly.io region outage — P0

**Symptoms.** `flyctl status -a acreos` shows machines in failed state in primary region (`iad`); health-check endpoint `/api/health` 5xx from outside; status.flyio.net incident.

**User impact.** App down. Database (Neon-hosted Postgres) likely unaffected since it's external.

**Mitigation.**
1. Confirm at https://status.flyio.net. Single-region issue or platform-wide?
2. Single-region: scale to backup region. Fly.io app should be configured with `[primary_region]` plus a secondary in `[[vm]]` blocks. If not yet (PARTIAL per Olu's audit), this is the manual step:
   ```
   flyctl scale count 2 --region ord -a acreos
   flyctl scale count 0 --region iad -a acreos
   ```
3. Update DNS health-checks to favor `ord`; Cloudflare load-balancing rule auto-fails-over if pre-configured.
4. If Postgres also Fly-hosted (verify — per `replit.md` it might be): trigger Neon failover or restore from latest snapshot per `disaster-recovery.md`.

**Comms.** Same template as 2.1. Add ETA from Fly.io status page.

**Recovery.** Once `iad` returns: gradual traffic shift back over 30 min. Don't slam-cut.

---

### 2.4 Stripe outage — P1

**Symptoms.** New subscriptions fail at checkout; `stripe.subscriptions.create` returns 5xx; webhook deliveries paused on Stripe side; status.stripe.com incident.

**User impact.** New signups can't pay (blocked at billing step). Existing subscriptions: unaffected during outage, but renewals queued. Dunning cron should be paused to avoid double-charging on recovery.

**Mitigation.**
1. Confirm at https://status.stripe.com.
2. Set feature flag `STRIPE_DEGRADED=true`. This:
   - Allows new signups to enter free trial without billing card collection (deferred billing).
   - Pauses `dunning.ts` cron.
   - Surfaces "billing temporarily unavailable, your trial continues" banner on `/billing`.
3. Buffer webhook events: Stripe retries for 3 days, so reconciliation on recovery is automatic. Don't manually replay during the outage.

**Comms.** Lower urgency than auth outage. Status-page entry; in-app banner; no SMS blast (not customer-blocking for existing users).

**Recovery.** Unpause dunning. Run `scripts:reconcile-stripe-state` to verify no drift. Stripe-side webhook replay handles missed events.

---

### 2.5 Twilio outage — P1

**Symptoms.** SMS sends fail with 5xx from Twilio API; `sms_send_failure_total` metric spikes; status.twilio.com incident.

**User impact.** Outbound SMS campaigns fail (Land Investors' cold-text workflow). Inbound webhooks (replies) silently dropped. 2FA SMS codes don't deliver — users with SMS-2FA locked out.

**Mitigation.**
1. Confirm at https://status.twilio.com.
2. Switch fallback channel for 2FA: `userMfa.ts` should detect SMS failure and offer email-OTP via SendGrid as fallback. (Pre-stage this path.)
3. For outbound campaigns: pause `smsCampaigns.ts` cron. Queue messages with `status='deferred'` for retry on recovery. Do NOT switch to a secondary SMS provider mid-campaign — phone-number reputation and 10DLC compliance are number-pinned.
4. Surface in-app banner to ops users running campaigns.

**Comms.** Status-page entry. Email (not SMS!) to active campaign owners.

**Recovery.** Drain deferred queue at low rate (avoid spike-detection). Verify 10DLC throughput unchanged.

---

### 2.6 SendGrid outage — P1

**Symptoms.** Transactional emails fail; `email_send_failure_total` spikes; status.sendgrid.com incident; bounce rate apparently zero (because nothing sent).

**User impact.** Onboarding day-0/1/3/7 emails don't ship → silent activation drop. Password resets fail. Magic links via Clerk: unaffected (Clerk uses its own sender by default; verify in Clerk dashboard).

**Mitigation.**
1. Confirm at https://status.sendgrid.com.
2. **Failover to Postmark, not Mailgun.** Postmark has dedicated transactional IPs and warmer reputation than Mailgun for low-volume senders. Mailgun is fine for marketing but transactional deliverability lags.
3. Pre-staged `MAIL_PROVIDER` env var supports `sendgrid|postmark`. Flip and redeploy:
   ```
   fly secrets set MAIL_PROVIDER=postmark -a acreos
   ```
4. `mailProvider.ts` already abstracts the SDK call. Verify the abstraction handles both before the incident.
5. Domain authentication: SPF/DKIM must already be set up for *both* providers. If not, Postmark sends will land in spam — pre-stage this.

**Comms.** Lower urgency. Status-page entry; no proactive customer comms unless outage >2 hours.

**Recovery.** Flip back to SendGrid; monitor bounce rate for 24h (warmup re-warming).

---

### 2.7 Anthropic outage — P2 (degraded, not down)

**Symptoms.** `anthropic.messages.create` returns 5xx or timeouts; Sophie Genius Mode unable to second-opinion borderline tickets; Sophie auto-resolver still works (uses OpenAI for primary classification per `supportBrain.ts`).

**User impact.** Borderline tickets all escalate to founder (no Genius pass). Agent reasoning surfaces (decisions inbox, founder-todo) show "AI reasoning unavailable." Customer-facing impact: minimal.

**Mitigation.**
1. Confirm at https://status.anthropic.com.
2. Cascade: feature flag `AI_PROVIDER_PREFERENCE` already supports `anthropic|openai|fallback-cascade`. Flip to `openai-primary`:
   ```
   fly secrets set AI_PROVIDER_PREFERENCE=openai-primary -a acreos
   ```
3. **Caveat:** OpenAI GPT-4o is not behaviorally identical to Opus. Sophie Genius prompts are tuned for Opus's reasoning style. Expect ~10% accuracy drop on borderline classification during failover. Acceptable for P2 but flag in decisions inbox: "second opinion via fallback model" badge.
4. Do NOT cascade silently in the customer-facing chat path (Pax). If Anthropic is down for Pax, route to "I'm having trouble — let me escalate to a human" and create a support ticket.

**Comms.** Internal-only unless outage >24 hours.

**Recovery.** Flip back. Spot-check 10 recent decisions for drift.

---

### 2.8 OpenAI outage — P2

**Symptoms.** Same shape as 2.7 but for `openai.chat.completions.create`. Sophie classification fails → everything escalates.

**User impact.** Tickets that would have auto-resolved now sit in queue waiting for Sophie. Founder-todo grows. Customer-facing: slower replies, not broken.

**Mitigation.** Mirror of 2.7 — flip `AI_PROVIDER_PREFERENCE=anthropic-primary`. Anthropic Haiku 4.7 is a viable cheap-classifier substitute for GPT-4o-mini. Pre-stage the prompt-port.

**Comms.** Internal.

**Recovery.** Same as 2.7.

---

### 2.9 E-sign provider outage — P1

**Symptoms.** Native e-sign (per memory: AcreOS ships its own signing stack) — so this is *us*, not a vendor. But signing depends on: PDF rendering service, hash-anchor service, KMS for signing keys. Any of these failing = e-sign down.

**User impact.** Active deals stuck mid-sign. New contracts can't be sent. This is Land-Investor-critical — deals are time-boxed.

**Mitigation.**
1. Identify which sub-component failed: `esign-health.ts` should expose component-level health.
2. KMS down (AWS KMS): no recovery without AWS — switch to backup key store if pre-staged. Otherwise, queue signature requests with `status='deferred'` and surface "signing temporarily unavailable" in-app.
3. PDF rendering down: less critical — fall back to plain-HTML contract view with disclaimer; collect signature; re-render PDF on recovery.
4. Notify customers with active in-flight signing sessions via email + SMS.

**Comms.** P1 means proactive — affected customers get direct outreach within 30 min.

**Recovery.** Drain deferred queue; verify hash-chain integrity post-recovery.

---

### 2.10 Data provider outage (ATTOM / BatchData / Regrid) — P2

**Symptoms.** Provider circuit breaker trips (3 failures in 5 min per `provider-registry.ts`); enrichment requests return cached or empty data; `provider_failure_total{provider=X}` metric spikes.

**User impact.** Property/parcel enrichment empty → core product looks broken to a Land Investor running a fresh import.

**Mitigation.**
1. Registry already handles fallback: if Attom trips, it tries BatchData, then Regrid. This is automatic.
2. **The risk Olu flagged**: subtle data drift in fallback. Regrid's schema is close-but-not-identical to Attom's. Add a data-quality SLO surface: when a fallback provider is serving >50% of traffic for >1 hour, fire P2 alert and surface on `/admin/ops`.
3. If all three down: serve cached data with `data_age` badge in UI ("data refreshed 6h ago"). Don't hide the staleness.

**Comms.** Internal. Customer-facing only if outage >6 hours and cache staleness becomes visible.

**Recovery.** Circuit breaker auto-resets after cooldown. Verify `provider_health` table reflects.

---

## 3. Status-page integration

**Recommendation: Atlassian Statuspage on `status.acreos.io` (note the .io to avoid Cloudflare dependency on .com).**

Why not custom-built:
- Status pages are exactly the surface that must work when YOUR infrastructure is down. Self-hosting on Fly.io means a Fly.io outage takes the status page with it. Anti-pattern.
- Statuspage runs on AWS (different blast radius), supports automated incidents from PagerDuty webhooks, and customers already trust the Atlassian-branded UI.

**Components to model:**
- Web app (acreos.io)
- Authentication (Clerk + Cloudflare proxy)
- Email delivery (SendGrid)
- SMS delivery (Twilio)
- Payments (Stripe)
- AI agents (Anthropic + OpenAI)
- Data enrichment (Attom + BatchData + Regrid, aggregated)
- E-signing
- Background jobs

**Auto-update integration:** PagerDuty incident → Statuspage component status. Manual override available. `externalStatusMonitor.ts` already polls vendor status pages; pipe its output into Statuspage's API as the source of truth.

---

## 4. Internal alert routing

**Today (per `alertPolicy.ts`):** every P0/P1 → single `FOUNDER_EMAIL`. Single point of failure.

**Proposed routing matrix:**

| Severity | Vendor | Primary | Backup (if no ack in N min) |
|---|---|---|---|
| P0 | Clerk, Cloudflare, Fly.io | Founder (SMS+email+Slack) | Buddy advisor (SMS, 15 min) |
| P0 | Stripe | Founder (SMS+email) | Buddy advisor (email, 30 min) |
| P1 | Twilio, SendGrid, e-sign | Founder (email+Slack) | None until on-call hire |
| P2 | Anthropic, OpenAI, data providers | Slack `#alerts` only | None — auto-resolve via fallback |
| P2 | Synthetic check fail | Slack `#alerts` | Founder (email, 1 hour) |

**Implementation in `alertPolicy.ts`:**
- Add `escalation_chain` array per severity.
- Add `ack_timeout_minutes` per step.
- Add `FOUNDER_EMAILS` plural env var (comma-separated).
- Add SMS channel via Twilio (yes — even if Twilio is the failed vendor, P0s aren't usually Twilio P0s).
- Add "on-call" toggle on `/founder-home` (Olu's sprint item 10) — flipping to off-call promotes buddy to primary.

---

## 5. Customer-facing comms templates

Five templates, one per outage class. All keep these properties: **acknowledge, scope, ETA-or-honest-no-ETA, what-the-customer-can-do, next-update-time.**

### 5.1 Auth outage (Clerk / Cloudflare)
> "We're currently experiencing an authentication issue affecting sign-in. This is a problem with our authentication provider, and we're tracking their incident. Existing sessions may continue working. We'll update this page every 30 minutes. Thank you for your patience. — AcreOS team."

### 5.2 Site-wide outage (Cloudflare / Fly.io)
> "AcreOS is currently unreachable. We've identified the issue with our infrastructure provider and are working with them on resolution. We don't have an ETA yet but will update within 30 minutes. Your data is safe. Follow @acreos for updates."

### 5.3 Payments degraded (Stripe)
> "Billing is temporarily unavailable. New subscriptions and billing changes are paused. Existing subscriptions are unaffected. Your free trial is automatically extended for the duration of the outage. Updates every 30 minutes."

### 5.4 Comms-channel degraded (Twilio / SendGrid)
> "We're currently experiencing delivery delays for [SMS / email] notifications. Your data and account are unaffected. Time-sensitive notifications are queued and will deliver once the issue is resolved. We expect resolution within [vendor ETA]."

### 5.5 Feature degraded (AI / data enrichment)
> "Some features powered by [AI / property data] may respond slowly or return cached results. Core functionality is unaffected. We're working with our partner on full restoration."

**Rule:** never blame the vendor by name in the *first* message. Reserve naming for post-incident write-up. Customers care that *we* are accountable.

---

## 6. The 1-week runbook-authoring sprint

**Day 1 (Monday) — Audit and template.**
- Verify the 9 existing runbooks against a shared template (Symptoms / Mitigation / Comms / Recovery / Escalation).
- Dedupe `runaway-job.md` and `runaway-background-job.md`.
- Lock template in `docs/runbooks/_TEMPLATE.md`.

**Day 2 (Tuesday) — Auth path.** Highest risk, lowest coverage.
- Write `clerk-outage.md` (from 2.1 above).
- Write `cloudflare-outage.md` (from 2.2 above).
- Verify status page is on a non-Cloudflare-fronted subdomain. If not, migrate today.

**Day 3 (Wednesday) — Comms infra.**
- Write `twilio-outage.md` and `sendgrid-outage.md` (from 2.5, 2.6).
- Confirm Postmark account exists and SPF/DKIM are pre-staged.
- Pre-stage SMS-to-email-OTP fallback in `userMfa.ts`.

**Day 4 (Thursday) — Compute and payments.**
- Write `flyio-region-outage.md` (extends existing `disaster-recovery.md`).
- Extend existing `stripe-webhook-stopped.md` with the broader outage scenario (2.4).
- Pre-configure Fly.io secondary region.

**Day 5 (Friday) — AI cascade and data providers.**
- Write `ai-provider-outage.md` (covers both Anthropic and OpenAI cascade).
- Write `data-provider-outage.md` (covers Attom/BatchData/Regrid).
- Implement the data-quality SLO surface mentioned in 2.10.

**Weekend — Tabletop exercise.**
- 2-hour Saturday session: founder + buddy advisor walk through Clerk outage runbook live. No actual outage triggered; just read the runbook, hit the dashboards, draft the comms, time the steps.
- Update runbooks based on what was confusing or missing.

**Day 6 (following Monday) — Status page + alerting.**
- Provision Statuspage account on `status.acreos.io`.
- Wire `externalStatusMonitor.ts` → Statuspage API.
- Update `alertPolicy.ts` with escalation chains and `FOUNDER_EMAILS` plural.
- Add the "on-call" toggle to `/founder-home`.

**Day 7 (Tuesday) — Synthetic checks.**
- Implement Olu's sprint item 7: 15-minute synthetic that touches Stripe webhook receiver, sends an email round-trip, sends an SMS round-trip.
- Wire failures into the new alert routing.

**Acceptance criteria for the sprint:**
- All 10 vendors have a runbook in `docs/runbooks/`.
- Status page lives on a non-Cloudflare domain and auto-updates from incident state.
- Alert routing has a non-founder fallback path with an ack timer.
- One tabletop exercise completed end-to-end.

---

## What I'd tell the founder

You've automated the happy path harder than most Series-B companies. The vendor-failure layer is the *cheapest* layer to add — it's writing, not engineering — and it pays back the first time anything goes red. Spend one calm week now and you stop spending one panicked night per quarter for the next two years. The runbook is not the document; the runbook is the *practice* of having drilled the document. Do the tabletop. — Beata

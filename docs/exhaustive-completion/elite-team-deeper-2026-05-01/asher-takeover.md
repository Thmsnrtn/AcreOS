# Asher Mendoza — AcreOS account-takeover incident report (Tucson, AZ)

I'm 39, in Tucson. I run a small Land Investor book — 60 active parcels in Pinal and Cochise, twelve seller-financed notes I service myself, a buyer list of about 1,800 emails, and an AcreOS Pro account I've been on for nine months. Last Tuesday I got a phishing email that looked exactly like a Stripe payout-failure notice. I clicked. The landing page asked me to "re-authenticate with Google to restore payouts." I authenticated. The page asked for my AcreOS password. I typed it. By the time I got back to my desk that afternoon — six hours later — somebody had been inside my AcreOS account, signed in from somewhere in Eastern Europe, and I didn't notice until a borrower texted me asking why I'd emailed her a new wire-instruction PDF for her June payment.

This is the audit of what AcreOS did, didn't, and couldn't do during the takeover. I'm writing it from the user side — what I could see, what I had to ask support for, and what I'm asking the platform to fix before the next user gets phished.

---

## 1. Thirty-second verdict

**The platform has the bones of an incident-response surface and almost none of the muscle.** Audit log exists (`auditLog` table in `shared/schema.ts`, `/audit-log` page, `/api/org/activity-log` route). 2FA exists (`server/routes-2fa.ts`, TOTP + backup codes). API keys can be revoked (`settings.tsx`). What does not exist: a session list a user can revoke, a "sign me out everywhere" button, a suspicious-login detector, an account-lock self-service, a borrower-facing breach notification flow, an OAuth-grant management surface, or a one-click "rewind my account 6 hours" point-in-time restore. So the day I got phished I had to phone support, and support had to escalate to engineering, and engineering manually killed the attacker's session via a database write.

The data was there. The user surface to act on it was not.

---

## 2. The six hours — what the attacker did, in order

I reconstructed this from the audit log after the fact. Times in MST.

**08:47** — Phishing email arrives, "Stripe — payout failed."
**08:49** — I click, authenticate to a fake Google consent page, then type my AcreOS password into the spoofed login.
**08:52** — Attacker logs in from `185.220.x.x` (later resolved to a Bulgarian VPS). My account did not have 2FA enabled. **No login-from-new-location email was sent.** No anomaly check ran. The login is one row in `auditLog` — `action: "login"`, no flag, no severity.
**09:04** — Attacker exports the buyer list — 1,800 emails — via `/api/leads/export`. Audit log shows `action: "export"`, `entityType: "lead"`. No rate limit triggered. No exfiltration alarm.
**09:18** — Attacker downloads the closing-document PDFs for my last six closed deals. `action: "document_downloaded"` rows. Six in a row, no friction.
**10:33** — Attacker creates a new outbound email template — "Updated wire instructions — June payment." Replaces the wire info with their own. Saves it as a campaign draft.
**11:07** — Attacker schedules a campaign send to all 12 seller-finance borrowers. Send time: 14:30 the same day.
**12:10** — Attacker changes the org's primary contact email from mine to a Gmail alias (`asher.notify` + something) — and **the change took effect immediately, with no email-confirmation step to the original address.** I never got a "your email was changed" notification.
**12:11** — Attacker enables 2FA on the account using their authenticator. Generates new backup codes. Now I'm locked out of my own login if they change my password.
**13:04** — Attacker initiates a password change (`POST /api/auth/change-password`). The endpoint requires the *current* password, which they had. Mine was now their password.
**13:50** — Borrower #4 receives the wire-update email. She replies asking why the bank changed. I see her reply on my phone.
**14:03** — I try to log in from my laptop. My password no longer works. I try the "forgot password" link. The reset email goes to the attacker's Gmail alias.

That is the full window. Six hours, nine destructive actions, zero automated friction.

---

## 3. What AcreOS got right (the bones)

1. **The audit log exists and captured the timeline.** `auditLog` schema (line 4149 of `shared/schema.ts`) records `action`, `entityType`, `entityId`, `userId`, `ipAddress`, `userAgent`, `metadata`, `createdAt`. After support gave me a forensic dump, I had a minute-by-minute reconstruction. The schema is right.
2. **The audit log surface — `/audit-log` (client/src/pages/audit-log.tsx) — renders entries with action, entity, user, time.** It is a customer-readable forensic tool. The UI is fine.
3. **2FA infrastructure works.** `server/routes-2fa.ts` and `server/services/twoFactorAuth.ts` ship TOTP setup, verification, backup-code hashing, and disable-with-code. If I'd had it on, the attacker would have stalled at step 2.
4. **The API key revoke path is clean.** `settings.tsx` has a per-key revoke button calling a real DELETE endpoint. That pattern is the right one — it just isn't applied to sessions.
5. **Soft-delete columns exist on core entities** (`deletedAt` on leads, properties, deals — `shared/schema.ts` lines 382, 692, 798, 903). So the attacker's deletes were recoverable. He didn't actually delete anything in my case, but if he had, the data wasn't physically gone.
6. **Audit-log retention has a config** (`auditLogs?: { enabled: boolean; retentionDays: number }`) so I'd still have the forensics 90 days later.

That is the floor. Now the gaps.

---

## 4. The seven things AcreOS needs to ship before the next takeover

### **(1) A user-visible session list with one-click revoke.**

Today: there is no surface — anywhere — that shows a user "here are the devices currently signed in to your account." `userSessions` exists as a table (`shared/schema.ts` line 11788) but is used for analytics page-view tracking, not auth-session enumeration. The auth session itself lives in `req.session` (express-session) with no app-level revoke API. The only "kill the bad session" path on May 1 was a support engineer running `DELETE FROM session WHERE ...` against the database.

What I need: `/account/security` page with a Sessions section listing every active session for my user — IP, approximate location (city/country from GeoIP), browser/OS from user-agent, last-seen time, "this is you" / "revoke" buttons per row, and a bright red **"Sign out everywhere except this device"** button at the top. Backend: `GET /api/account/sessions`, `DELETE /api/account/sessions/:id`, `POST /api/account/sessions/revoke-all-others`. The session-token-revocation primitive exists (`generateSessionToken` in `securityEnhancements.ts` line 87) — just needs to be wired into actual session storage. **One engineer-week.**

### **(2) Suspicious-login detection with email-on-new-location.**

Today: I checked `server/auth/` and `server/middleware/` for any geo-IP/anomaly hook. Nothing. A login from Bulgaria for an Arizona user is one `auditLog` row with no flag. Nobody emails me, nobody slacks me, nobody freezes the session pending verification.

What I need: on every login, compute a risk score from (a) IP-country differs from last 30 logins, (b) user-agent fingerprint differs, (c) impossible-travel (last login was Tucson 2 hours ago, this one is Sofia). If risk > threshold, send the user an email "We saw a sign-in from Sofia, Bulgaria. If this wasn't you, click here to lock your account immediately." The email has a one-click "lock account" HMAC link that invalidates all sessions, sets a `requirePasswordReset` flag, and sends me a recovery code through the original email. **Two engineer-weeks** including the GeoIP integration, the email template, and the lock endpoint.

### **(3) A self-service "lock my account now" button — and a public emergency URL.**

Today: there is no such endpoint. When my password stopped working at 14:03 on Tuesday, the only thing I could do was email support and hope someone read it before 14:30 when the attacker's borrower campaign was scheduled to send. Support response was 41 minutes — fast for a normal business day, but eleven minutes after the attacker's campaign would have hit my borrowers.

What I need: a public URL — `acreos.com/emergency` — that takes an email + my last 4 of phone (or any second factor). If they match, the system: (a) invalidates all sessions for that user, (b) disables outbound campaigns/email scheduling for the org for 24 hours, (c) freezes all `/api/auth/change-password`, `/api/auth/change-email`, `/api/auth/2fa/*` mutations for 24 hours, (d) emails me a recovery one-time-link AND copies a designated security email on the account (which the attacker can't change). This is a four-line form on a static page, one rate-limited POST endpoint, four DB updates. **Three engineer-days.** The kicker: it has to work even when the attacker has already changed my login email.

### **(4) Email-change and 2FA-change require a confirmation to the *original* email — and a 24-hour cooldown.**

Today: at 12:10 the attacker changed my org's primary contact email and the change was instant, with no confirmation to the old address. At 12:11 they enabled 2FA on the account and I never got told. **These two changes are the two that lock a real owner out of recovery.** They have to be the most-protected mutations in the product, and right now they're the least protected.

What I need:
- `PATCH /api/account/email` returns 202, sends a confirmation link to the *new* email AND a "we received a request to change your email — click to cancel" link to the *old* email. Change does not take effect until either (a) new-email link clicked AND 24 hours elapsed without an old-email cancel, or (b) admin override.
- `POST /api/auth/2fa/setup` and `POST /api/auth/2fa/verify-setup` require re-entry of password AND send an email to the existing primary contact: "2FA was just enabled on your account. If this wasn't you, click here." The "verify" step on a phisher-controlled session should not be sufficient by itself.
- Both flows emit `auditLog` rows with severity `critical` so they surface in the suspicious-activity surface (see #5).

**One engineer-week** including the email templates and the rollback links.

### **(5) The audit log needs a security view with severity, filters, and a "show me everything that smells" lens.**

Today: `/audit-log` (audit-log.tsx) is a flat reverse-chronological list. It tells me what happened. It does not tell me what *matters*. After my breach I had to scroll past hundreds of routine `lead.update` rows to find the nine destructive actions.

What I need: a `/account/security/activity` view that filters to a small set of high-severity event types: login (new-location flagged), login-failed (>5 in window), password-change, email-change, 2FA-enable, 2FA-disable, api-key-create, api-key-revoke, bulk-export (>500 rows), bulk-download (>10 documents in <60s), campaign-send-to-all-borrowers, wire-instructions-edit. Each row colored by severity. Each row has a "this wasn't me" button that opens an incident ticket. Also surface a 90-day "security health" score: 2FA on/off, recent password change, dormant API keys, sessions older than 30 days. **One engineer-week.** The audit-log table schema already supports the severity/category extension.

### **(6) Borrower-facing breach notification — and a "freeze outbound communications" kill switch.**

Today: when I realized borrower #4 had received the spoofed wire-update email, I had no platform-level way to say "stop the next 11 sends and send a correction to all 12 borrowers." I had to text each borrower individually. Four of them had already started their wire-change paperwork by Wednesday morning.

What I need: 
- A **"freeze outbound" toggle** on the org account that pauses every queued campaign send, every outgoing email blast, every drip, every SMS — for a configurable window. Endpoint: `POST /api/account/freeze-outbound`. UI: red banner across the app. Reversible by user (with 2FA) or by support.
- A **"send a breach notice to all my borrowers"** template-and-send flow. Pre-filled subject ("Important: ignore the wire-update email I sent earlier today"), pre-filled body with merge fields, a one-click send to my borrower list. This is a templated campaign from a security-incident library — a special category that's exempt from the freeze.
- Audit-log a `breach_notification_sent` row so I have proof of timely notification (some states require it within 30 days; AZ does for any PII breach).

**One engineer-week.** The campaign and template infrastructure already exists; this is one new template category and one freeze flag.

### **(7) Point-in-time account restore — "rewind my org 6 hours."**

Today: soft-delete columns exist on leads/properties/deals (`deletedAt`). But the attacker didn't delete; he *modified*. He changed the wire-instruction PDF, edited a campaign template, edited my org email. The audit log captures the diff (`changes: { before, after }` in `auditLog`). What there isn't is a one-click "apply all the `before` values from after timestamp X" undo.

What I need: an admin/support tool that, given a timestamp, walks the audit log forward from that timestamp and reverts every `update` and `create` action attributable to a specified `userId` or `ipAddress`. Soft-deletes get un-deleted. New records get marked deleted. Modified records get rolled back to the `before` snapshot. The data is all there in `auditLog.changes`; what's missing is the reverse-apply engine. Restrict to support staff initially — too dangerous as a self-service button. **Two engineer-weeks** including a dry-run preview mode.

This is what saves a user who got phished and who can't reconstruct what was changed in six hours of attacker activity by hand.

---

## 5. The OAuth-grant gap

When I authenticated to the spoofed Google consent page, I granted "Google Workspace Sign-In" to *something*. That something is not an integration AcreOS knows about — it was an attacker-controlled OAuth app. Google's account-security page is where I revoked it. **AcreOS has no surface that lists which third-party apps have been granted access to my AcreOS account or my linked Google identity.**

What I need on `/account/security`: a "Connected accounts" section showing every OAuth grant attached to my AcreOS user — Google, Microsoft, any future Slack/Zapier/Make grants — with provider name, scopes granted, granted-at timestamp, last-used timestamp, and a "Revoke" button that calls the provider's revoke endpoint AND drops the grant from `account_oauth_grants` (a table that does not yet exist). The schema work is small. The UX matters more — most users (me included) don't think of "I authenticated to a fake Google page" as "I gave somebody an OAuth grant," and a clean list would have made the abnormality obvious.

---

## 6. Support response — what the human side did right and wrong

**Right:**
- The support email got a real human response in 41 minutes on a Tuesday.
- The engineer who killed my session and rotated my password did so within 8 minutes of being paged.
- Support gave me a forensic CSV export of the audit log within 2 hours of resolution.
- The support agent asked the right questions: "Did you receive any 2FA codes you didn't request?" "Has anyone else logged in from your usual IP today?"

**Wrong:**
- 41 minutes is too long when a borrower-blast is queued for 14:30. The "freeze outbound" should not require a human; see #6 above.
- I had to identify myself with my Stripe customer ID — which was in the screenshot the attacker had access to. There is no second-factor identity-recovery process documented anywhere; support invented one in real time. Document it.
- Support agent was unable to revoke the attacker's session from any UI — they had to escalate to an engineer with database access. That is a pager-tier action for a customer-tier event. Build a support-console session-revoke tool.
- The forensic export was a CSV. It should have been a one-page incident timeline auto-generated for the customer, with severity icons, IPs, and an "actions taken" summary. Useful for me; useful for the AZ AG's office if I have to file a breach notice (PII exfiltration of 1,800 borrower emails arguably qualifies under A.R.S. § 18-552).

---

## 7. The customer-communication piece I'm still cleaning up

The 12 borrowers and 1,800 buyer-list emails are now in an attacker's hands. AcreOS owes me — and owes the next user who gets phished — a templated, opinionated playbook:

1. **Within 1 hour:** "Lock account, freeze outbound, kill sessions" — the buttons described in #1, #3, #6.
2. **Within 4 hours:** "Send breach correction to active borrowers" — the template described in #6.
3. **Within 24 hours:** "Notify buyer-list contacts of credential exposure" — a longer-form template, opt-in, that says "your email and phone may have been exfiltrated; rotate any password you reused and watch for spear-phishing." Most US states' breach-notification laws have 30-60 day windows; the platform should make 24 hours the default.
4. **Within 7 days:** A formatted incident report PDF the user can hand to their attorney, their title insurer, or the AZ AG's office. Pulled from the audit log + the actions-taken summary.

**Bake this into a "Recovery Center" surface.** When the user clicks the breach-recovery one-click link from #3, they land on a checklist with these four steps and a progress bar. None of this is technically hard. All of it is the difference between "the platform helped" and "the platform watched."

---

## 8. The deal-killer

If a phishing-driven account takeover happens to a paying Land Investor and they spend their afternoon on the phone with support and their next morning hand-typing apologies to twelve borrowers, they cancel. I almost did. The reason I didn't is that the audit log was good enough to convince me — after the fact — that the platform took the breach seriously and that the data foundation to fix this is already in place.

What I need before I'd recommend AcreOS to another investor:
1. A self-service Sessions list with revoke-all (one engineer-week).
2. Email-on-new-location with a one-click lock link (two engineer-weeks).
3. Email-change and 2FA-change confirmations to the original email + 24-hour cooldown (one engineer-week).
4. A public `/emergency` lockout URL (three engineer-days).
5. A "freeze outbound" kill switch (small).
6. A breach-notification template flow for borrowers (one engineer-week).
7. A point-in-time audit-log replay/undo for support (two engineer-weeks).
8. An OAuth-grants list on the security page (small).
9. A support-console session-revoke tool (small).
10. A Recovery Center checklist surface (small).

Total: about six to eight engineer-weeks to close the gap from "we logged it" to "we contained it." For a platform charging $49/mo and storing borrower wire instructions, that's the cost of being the system of record.

One last thing. Don't market any of this as "AI-powered breach detection." Anomaly-on-login is a GeoIP lookup and three rules. The work is the surfaces and the kill-switch wiring, not the model. Build the buttons and label them in plain English: **Lock account. Sign out everywhere. Freeze outbound. Send borrower correction. Restore from audit log.** Five buttons. One bad afternoon. The platform either helps or it doesn't.

— Asher Mendoza
   Tucson AZ — Pinal / Cochise Land Investor, account-takeover survivor (2026-04-28)

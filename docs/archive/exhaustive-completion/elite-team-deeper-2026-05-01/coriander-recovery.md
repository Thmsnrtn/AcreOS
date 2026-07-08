# Coriander Voss — Customer-Support Engineer, Account-Recovery Console Audit

**Lens:** I'm Coriander Voss, 32, the support engineer who picks up the phone when somebody can't get into AcreOS. I run the Cleo-Hartley lockouts, the Asher-Mendoza takeovers, and the Martin-Holbrook estate cases out of one Slack channel and a database client. The other personas in this batch wrote up their experience as the user. **I'm writing it from my side of the desk** — what tooling AcreOS gives me, what it doesn't, and the moments where I have to choose between breaking policy and breaking a customer.

The headline: I have a support-ticket queue, an escalations view, and a `psql` window. That is the recovery console. Everything else — disable somebody's 2FA, revoke a session, pause autopay on behalf of an executor, freeze outbound campaigns during a takeover — is a manual database write or a Slack message to engineering. **For a system holding seller-finance loan books, that is the wrong shape of tool, and the gap shows up on the worst day of every customer's year.**

---

## 1. What the support tooling actually lets me do today

I read the code. Here's the inventory.

### Ticketing surface
- `server/routes-support-tickets.ts:18-258` — full CRUD on `supportTickets`: customer creates, replies, closes, escalates from AI to human.
- `server/routes-support-tickets.ts:366-808` — founder-side surfaces: `/api/founder/support/tickets`, `/api/founder/escalations`, batch-prompt generator. Solid for **reading** the queue.
- `client/src/pages/admin-support.tsx` (581 lines) — the actual console. Lists escalated cases, shows SLA badges (on-track/at-risk/breached), lets me reply to threads. Decent.
- `server/routes-support.ts:281` — `/api/admin/support/cases/:id/respond`. I can post a reply as the support agent.

### Org/admin surface
- `server/routes-admin.ts:965` — `/api/admin/users`. **List users.** That's it. No edit, no reset, no disable.
- `server/routes-admin.ts:748` — `/api/admin/organizations`. List orgs, nothing more.
- `server/routes-admin.ts:929` — `/api/admin/set-founder`. Promote a user to founder. Useful for one thing (Thomas onboarding new internal staff), useless for recovery.
- `server/routes-admin.ts:4543` — `/api/admin/impersonate/:orgId`. **Founder-only.** Logs an `activityLog` row, returns a 30-min token claiming `readOnly: true`. I read the implementation: **the read-only flag is not actually enforced anywhere in the request pipeline.** It's a comment on a JSON object. If I actually impersonate, I have full write access until the timer claims to expire — and I'm not even sure the timer is enforced; I couldn't find the middleware that checks it.
- `server/routes-admin.ts:4575` — feature-override toggles per org.

### What's missing entirely
- **No admin endpoint to disable 2FA on a user.** `server/routes-2fa.ts:151` requires the user's own TOTP or backup code. There is no `/api/admin/users/:id/2fa/reset` of any kind.
- **No session list or revoke endpoint.** Sessions live in express-session storage; there is no enumeration and no revoke. Asher's takeover was resolved by an engineer running `DELETE FROM session` against the production DB.
- **No password-reset-on-behalf endpoint.** I cannot generate a reset link for a user; the user has to click "forgot password" themselves, and if their email is compromised that link goes to the attacker.
- **No identity-proof workflow.** No upload form, no review queue, no tier definitions.
- **No estate-access intake.** Martin Holbrook emailed `support@` from a personal Gmail and got a templated password-reset reply. There is no `/estate-access` route and no fiduciary role in `ROLES`.
- **No "freeze outbound" kill switch.** When Asher's attacker queued a borrower campaign, I could not pause it without an engineer.
- **No point-in-time replay.** The audit log captures `before`/`after` diffs; nothing reads them backwards.
- **No 2FA-reset link generator with HMAC + TTL.** The "engineering queues a reset link" thing in Cleo's case was a one-off SQL query and a hand-crafted JWT.

So the console gives me: read the ticket, reply to the ticket, see who's in what org, optionally impersonate (founder-only, audit-logged, scope-unenforced). For everything else I file an engineering ticket.

---

## 2. The three cases this batch covers — and what I actually did

### Cleo Hartley (lockout, 9 days)
What I needed: disable her 2FA after identity proof, regenerate her backup codes, send her a session-bound recovery link.

What I did: emailed `engineering@` with her user ID and "please null out `users.twoFactorSecret` and `users.twoFactorBackupCodes`." Engineering ran the update, then crafted a one-time JWT pointing at the password-reset flow and emailed it to her. The JWT had a 1-hour TTL because the engineer typed `60 * 60` into a REPL. **First link expired while she was driving.** I had to re-page engineering for a second link, longer TTL.

What the console should have given me, button by button:
1. **"Verify identity"** — opens an intake panel. Customer uploaded docs (selfie + ID, utility bill, two transaction confirmations) appear as an evidence wall. I score against a tiered policy (§4 below). Decision is logged with my user ID and a free-text reason.
2. **"Reset 2FA"** — only enabled after step 1 completes, only enabled with a second support-staff approver (dual-control). Generates a single-use, 4-hour, HMAC-signed link bound to the customer's email-on-file. Link is emailed AND surfaces in the ticket thread as a copy-button so I can paste it on the phone if email is the bottleneck.
3. **"Generate temporary backup codes"** — eight new codes, scrypt-hashed, replacing whatever's there. Customer sees them once on first login.
4. **"Re-issue link"** — for the inevitable case where the customer missed the window. Limited to 3 reissues per 24 hours, all logged.

None of these are hard endpoints. They're 2-3 days of work each, and their absence is what turned Cleo's lockout from a 90-minute call into a 9-day saga.

### Asher Mendoza (takeover, 6 hours of attacker activity)
What I needed: kill the attacker's session, freeze the queued borrower campaign, lock the account against further mutations, restore Asher's email-of-record, and replay the audit log to catch every modification.

What I did:
- **Kill session:** paged the on-call engineer at 14:11 MST. They ran `DELETE FROM session WHERE sess::text LIKE '%user:7142%';`. Session was dead at 14:19. The borrower campaign was scheduled for 14:30. **We had eleven minutes of slack.** That is luck, not a process.
- **Freeze campaign:** there is no freeze endpoint. The engineer flipped `campaignSchedule.status = 'paused'` directly in the DB for the one queued send. If there had been five queued sends, we'd have done five updates and probably missed one.
- **Restore email:** another DB update. `organizations.primaryEmail = 'asher.mendoza@…'`.
- **Audit replay:** I exported the `auditLog` rows for the user from 08:47 to 14:19 as CSV and gave it to Asher. He reverted by hand.

What the console should give me:
1. **"Kill all sessions for user"** — single button, single endpoint, requires my MFA to invoke. Logs to `auditLog` with my user ID.
2. **"Freeze outbound for org"** — pauses every queued campaign, every drip, every scheduled email/SMS for 24 hours. Reversible by the customer with 2FA or by a second support staffer.
3. **"Lock account"** — invalidates sessions, blocks `/api/auth/change-password`, `/api/auth/change-email`, `/api/auth/2fa/*` for 24 hours, sets `requirePasswordReset = true`.
4. **"Replay audit log from timestamp T"** — loads every `update`/`create` row attributable to a given `userId` or `ipAddress` after T, shows me the `before`/`after` diff, lets me one-click revert per row or batch-revert. Dry-run mode required. Asher described this as the two-engineer-week project; I'd ship it in three sprints.
5. **"Send breach-notification template"** — a campaign category exempt from the freeze, pre-filled with the standard "ignore the wire-update email" copy, mail-merged to the affected list. One click.

### Martin Holbrook (estate executor, owner deceased)
What I needed: a path for a non-account-holder to lawfully take over an org with court documents. AcreOS gives me nothing here.

What I did, in real life: emailed Martin a list of documents to send (death certificate, Letters Testamentary, his ID), reviewed them on my laptop, asked engineering to (a) re-root org ownership to a new user account I created for Martin, (b) flip every `borrowerPaymentProfiles.autopayEnabled` to false, (c) suspend every active drip campaign on the org. **Three database writes, one new user, no audit-log row tagging the action as "estate transfer."** The activity log shows "ownership changed" with my impersonation token as the actor, which is wrong on its face — Martin should be in the audit trail as the new owner, not me.

What the console should give me:
1. **`/estate-access` public intake** — collects executor identity, court docs, decedent's account email. Lands in a dedicated queue. SLA published.
2. **"Approve estate transfer"** — re-roots ownership, creates the new owner account, sets the role to `estate_executor` (a new ROLES value with elevated-confirmation gating on mutations), audit-logs the transfer with the support staff member's user ID AND the new owner's user ID AND the case ticket number.
3. **"Org-level estate hold"** — single switch that pauses autopay across all notes, pauses all outbound campaigns, suspends agent autonomy (`agentInitiativeEngine`, `agentLifecycleRuntimeV12`), routes inbound payments to a held-funds ledger, paints the estate-hold banner on every page.
4. **"Send borrower notice (servicing continuity)"** — pre-filled state-by-state-aware template, mail-merged. One click per state pack.

None of this is fancy. It's policy, schema, and three buttons. The shape is the same shape as the takeover console — the surface that's missing for both is the same surface.

---

## 3. The audit trail of support actions — what's there, what's missing

`auditLog` (shared/schema.ts:4149) captures `action`, `entityType`, `entityId`, `userId`, `ipAddress`, `userAgent`, `metadata`, `createdAt`. Good.

The gap on the support side: **when I act on behalf of a customer, my action is logged as the customer's action**, not as a support intervention with my staff user ID, the case ticket ID, the policy invoked, the second approver's user ID (for dual-control actions), and the customer-facing summary string that should appear in the customer's audit feed.

What needs to ship:
- A `supportActions` table — or a `support_action` flag on `auditLog` — that records: staff user ID, customer org/user, case ticket ID, action type, justification text, dual-control approver user ID, before/after snapshots.
- A customer-facing view inside the audit log surface that says "AcreOS support reset 2FA on your account on 2026-04-22 at 16:14, ticket #4421, because you completed identity verification." Customer should see what we did to them, with our names attached. That's table stakes for a financial-system support function.
- A monthly internal report: every support action by category, by staff member, with denial-of-service detection (one staff member resetting twenty 2FAs in a week is a signal).
- Hash-chained immutability for support-action rows. Probate court will eventually subpoena one of these and "an append-only Postgres table that any DBA can edit" is not a defensible answer.

---

## 4. Identity-proof workflow — the policy I'd publish Monday

Cleo and Martin both got my workflow invented in real time. That is malpractice. The tiers, codified:

**Tier 1 — Self-service (target: <5 minutes):**
- TOTP backup code, OR
- 24-word recovery seed (proposed; not yet built — see Cleo's audit), OR
- Hardware key WebAuthn challenge (proposed; not yet built; AcreOS is TOTP-only).
- No human in the loop. Resolves the modal lockout case.

**Tier 2 — Documentary proof (target: <24 business hours):**
- Selfie holding a government-issued ID, AND
- Second piece of address-matched mail (utility bill / bank statement) within 60 days, AND
- Confirmation of two recent account events (deal close, borrower payment, document signed) from a list the customer generates without prompting.
- Reviewed by one support staff. 2FA-reset link issued.

**Tier 3 — Live video verification (target: same business day, $99 expedite):**
- Booked through a calendar link auto-attached to lockout tickets.
- 10-minute video call, ID held to camera, two challenge questions about account history.
- Reviewed by one support staff with on-camera record retained 90 days.

**Tier 4 — Court-document executor flow (target: <3 business days):**
- Death certificate + Letters Testamentary + executor ID, OR
- Court order naming a receiver, OR
- Power-of-attorney document (notarized, with capacity attestation).
- Reviewed by support + counsel. Org enters estate hold during review. New `estate_executor` role granted on approval.

**Tier 5 — Read-only emergency access (Cleo's "nuclear option"):**
- For active lockouts where Tier 1-3 are in flight but pending.
- Bound to known email + known device fingerprint + known IP.
- Customer can view their book, generate one-time payment links for borrowers, see closing checklists. Cannot edit, transact, sign.
- Auto-expires when the underlying recovery completes.

Publish the tiers on a public help page. Bake them into the support-console intake form. Stop inventing them per ticket.

---

## 5. Impersonation safety — the part that scares me most

The current impersonation endpoint (`routes-admin.ts:4543`) is founder-only. That is good. The problems:

1. **The `readOnly` flag is decorative.** I read every middleware in `server/middleware/`. Nothing checks it. If a founder impersonates an org, they have full mutation access to that org's data for the duration. If a founder's session token is compromised, the attacker has full mutation access to every org.
2. **The 30-minute expiry isn't enforced server-side.** It's encoded in the response payload. The session itself doesn't carry an `impersonationExpiresAt` that any route checks.
3. **The audit-log row goes on the impersonated org's log, not on a separate staff-actions log.** A customer reading their own audit log will see "impersonation_started" with no actor identity. They cannot tell whether it was Thomas, me, or a compromised account.
4. **No customer notification.** When I impersonate Cleo's org, Cleo does not get an email saying "AcreOS support accessed your account at 14:33 today." She should.
5. **No scoping.** I cannot impersonate "read-only just the borrower portal pages" — it's all-or-nothing. For a Tier 5 read-only case I cannot grant the customer Tier 5 access via my console; I either give them a real session (impersonation handoff, dangerous) or I screenshot screens for them (slow, brittle).

What needs to ship before impersonation is safe to use at scale:
- Server-side enforcement of read-only mode (a request-pipeline guard that 403s on any non-GET when the impersonation flag is set).
- A separate `staff_impersonation_sessions` table with `staffUserId`, `targetOrgId`, `startedAt`, `expiresAt`, `caseTicketId`, `justification`, `readOnly`, `endedAt`.
- Hard expiry in the session middleware.
- Customer email-on-impersonation-start.
- A second-staff-approver requirement for write-mode impersonation.
- A redacted-PII mode where SSNs, full TINs, and full account numbers are masked even to the impersonator unless they explicitly unmask (logged action).

This is **two weeks of work** and it's the difference between "the support team can help you" and "the support team is a soft target."

---

## 6. Multi-step recovery — gather, verify, restore

The ideal recovery flow, from my console:

1. **Intake** — customer (or non-customer, in the estate case) submits a recovery request through a public URL with a structured form. Lockout / takeover / estate / data-loss / billing-only categories. Routes to a queue tagged with the category.
2. **Triage** — first-touch staff classifies severity (P0 takeover-in-progress, P1 lockout, P2 documentary recovery), assigns SLA, sends the customer the documents-needed list templated to the category.
3. **Gather** — customer uploads docs through an authenticated upload widget (HMAC link tied to the case). Files land in case-attached object storage with PII-detection scanning.
4. **Verify** — staff reviews evidence wall, scores against the tier policy, records justification, requests dual-control approval if action is destructive (2FA reset, password reset, ownership transfer, mass refund).
5. **Restore** — staff invokes the appropriate primitive: reset 2FA, kill sessions, rotate password, transfer ownership, lift estate hold. Each primitive is its own audited endpoint. None of them are raw SQL.
6. **Notify** — customer gets a templated summary of what was done, why, by whom, with the case ticket number. Ledger entry posted to their audit log.
7. **Close** — case marked resolved, satisfaction survey sent, action attributed to the staff member's monthly metrics.

Steps 1, 2, 6, 7 mostly exist. Steps 3, 4, 5 are the ones I do in my head + Slack + psql today. They're the ones that need surfaces.

---

## 7. What requires engineer escalation today (and shouldn't)

Today's escalation list, drawn from my last 60 days of tickets:

| Action | Why it escalates | Should it? |
|---|---|---|
| Disable a customer's 2FA | No admin endpoint exists | **No.** Build the endpoint with dual-control. |
| Kill a user's active sessions | No session enumeration; sessions are in express-session storage | **No.** Build session list + revoke. |
| Reset a customer's password without their email | "Forgot password" requires email; if email is compromised, attacker gets the link | **No.** Build a support-issued reset that bypasses the email channel after Tier 2/3 verification. |
| Restore soft-deleted records | `deletedAt` columns exist; no UI surface to undelete | **No.** Trivial admin surface. |
| Re-root org ownership (estate, partnership dissolution) | No flow; `routes-organization.ts:881-883` blocks demoting the only owner | **No.** Build the estate/court-order override path. |
| Pause/freeze outbound campaigns on an org | No org-level switch | **No.** Build the freeze toggle. |
| Refund post-DoD borrower payments to estate | No "post-DoD" flag, no bulk refund tool | Partially — Stripe Connect refund is engineering-grade work today. Half-buildable now. |
| Replay/revert attacker audit-log changes | No replay engine | **No, but it's the largest project.** Build the dry-run preview first, then the apply. |
| Generate corrected 1099-INT for estate (split at DoD) | `payerEin` hardcoded `00-0000000` (`bookkeeping.ts:262`) | **No.** Fix the hardcode (1 day) and add DoD-split (2 weeks). |
| Decrypt/unmask PII for a court subpoena | Need to confirm encryption-at-rest; no documented unmask audit flow | **Yes, this should escalate** — but the escalation should run through a documented legal-hold runbook, not an ad-hoc Slack message. |

Engineer escalation should be the exception for genuinely novel cases (subpoenas, unprecedented attack patterns, data-loss restoration from backup). For routine recovery, support staff need the buttons.

---

## 8. The five things I'd ship in the next two sprints

1. **Admin 2FA-reset endpoint** (`POST /api/admin/users/:id/reset-2fa`) with dual-control + audit log + customer email. **3 days.**
2. **Session enumeration and revoke** for both staff and customer self-service. **1 week.**
3. **Identity-proof intake flow** (`/help/locked-out`, public, no-auth) that creates a P1 case with category "lockout" and surfaces the Tier 1-5 policy to the customer. **3 days.**
4. **Estate-access intake** (`/estate-access`, public, no-auth) with court-document upload + dedicated queue + estate-hold mode. **2 weeks.**
5. **Freeze-outbound kill switch** at the org level, invocable by the customer with 2FA or by support with dual-control. **3 days.**

Total: about 4 sprint-weeks of engineering. The customer-facing impact is the difference between Cleo's nine days and a Cleo-shaped event resolving in three hours.

---

## 9. The thing the support team needs Thomas to hear

I don't need a fancy console. I need five buttons that today are five engineering tickets. Every time I have to file one of those tickets, the customer's worst day gets longer and the engineering team's sprint gets shorter. The buttons are not glamorous. They will not appear on the marketing page. They are the difference between a CRM that sells trust to Land Investors and a CRM that sells software to Land Investors.

The other thing: **build the audit trail of my actions before you build the actions.** If the buttons ship before the staff-action audit table, I will have made the takeover problem worse — every support engineer becomes a privileged actor with no oversight. Audit first, then primitives, then the intake forms that route customers to the primitives.

— Coriander Voss, Customer-Support Engineer, AcreOS
   Remote (Tucson hub) — May 1, 2026

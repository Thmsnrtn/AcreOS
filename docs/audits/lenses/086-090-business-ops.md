# Lenses 086-090: Business Operations Audit

Auditor: Tier 2 Business Operations Specialist
Date: 2026-04-18
Scope: Customer Onboarding Friction, Refund/Dispute/Chargeback, Trial Expiration/Downgrade, Transactional Email, Support Handoff

---

## 086 -- Customer Onboarding Friction

**Distinct Value:** Identify every point of friction between signup and first value ("aha moment"), quantify required steps, and flag anything that delays time-to-value.

### Flow Walkthrough: Signup to First Value

The critical path is:
```
Google OAuth -> Clerk session -> hydrateUser -> getOrCreateOrg -> onboarding wizard -> /today
```

There are **two competing onboarding flows** in production:

1. **V1 (`onboarding-wizard.tsx`)** -- 4-step linear wizard: Organization Name, Invite Team, Investment Goals, Integrations. Completes to `/dashboard`.
2. **V2 (`onboarding-v2.tsx`)** -- Path-branching wizard with 3 personas (beginner/active/enterprise), each with 6 steps. Includes an "Instant Deal Hunt" that shows real county data as the "aha moment" in step 3. Completes to `/today`.

### Findings

#### F086-1: Two onboarding wizards exist with no routing logic between them (P1)
- **Files:** `client/src/pages/onboarding-wizard.tsx`, `client/src/pages/onboarding-v2.tsx`
- **Impact:** It is unclear which wizard is served to users. If both are reachable via different routes, users can hit either path arbitrarily. V1 redirects to `/dashboard` on completion; V2 redirects to `/today`. This creates inconsistent first-session experience.
- **Remediation:** Remove V1 entirely or gate it behind a feature flag. Canonicalize on V2 which has the superior path-based flow and Instant Deal Hunt "aha moment."

#### F086-2: V1 wizard final step is a dead end -- "Configure in Settings" for all integrations (P2)
- **File:** `client/src/pages/onboarding-wizard.tsx:192-199`
- **Impact:** Step 4 (Integrations) shows 4 integrations, each with a `Badge` saying "Configure in Settings." No integration is actually configurable during onboarding. This is a wasted step that adds friction without value.
- **Remediation:** Either remove the integrations step entirely from V1 or make at least one integration actionable inline.

#### F086-3: Auth fragility blocks signup entirely (P0, known)
- **File:** `docs/audits/00-orientation.md` (problem #1)
- **Impact:** Google OAuth sign-in is reported as intermittent ("External Account not found", redirect loops, Clerk modal overlay). This means users cannot even reach onboarding. This is the single biggest onboarding friction point.
- **Remediation:** Already tracked as P0-1 in the orientation document. Prioritize fixing Clerk OAuth reliability.

#### F086-4: V2 Instant Deal Hunt can fail silently, leaving user in unclear state (P2)
- **File:** `client/src/pages/onboarding-v2.tsx:170-200`
- **Impact:** The `InstantDealHunt` component queries `/api/onboarding/instant-deal-hunt`. If this API errors (county data unavailable, rate limit, etc.), the user sees an error state with "Try again or continue." This is the core "aha moment" -- if it fails, the user gets no value demonstration. The error fallback is good (has a "Continue to Dashboard" button), but there is no offline/cached fallback data.
- **Remediation:** Provide pre-seeded example data as a fallback so the "aha moment" always fires, even if the live API call fails.

#### F086-5: Setup wizard API crashes (P1, known)
- **File:** `docs/audits/00-orientation.md` (problem #16)
- **Impact:** `/api/founder/setup/status` crashes, wizard shows blank modal. This blocks the post-onboarding setup flow.
- **Remediation:** Already tracked. Fix the endpoint to return sensible defaults when data is missing.

#### F086-6: Onboarding completion does not trigger a welcome email (P2)
- **Files:** `server/routes-onboarding.ts:20-57`, `server/services/onboarding.ts`
- **Impact:** When a user completes onboarding, no welcome or confirmation email is sent. The only transactional email in the signup flow is the subscription welcome email sent by the Stripe webhook when a user subscribes. Free-tier users (the majority of new signups) receive no email at all after signup.
- **Remediation:** Add a welcome email trigger in `onboardingService.completeOnboarding()` that sends a branded welcome with quick-start links.

#### F086-7: No progress persistence in V1 onboarding -- page refresh loses all progress (P2)
- **File:** `client/src/pages/onboarding-wizard.tsx`
- **Impact:** All state (step, orgName, inviteEmail, goals, acreage, budget) is `useState` only. If the user refreshes mid-wizard, everything resets to step 0. V2 has the same issue.
- **Remediation:** Persist wizard state in `sessionStorage` or save partial progress server-side via the existing `onboardingData` field on organizations.

### Steps to First Value Count
- **V1:** Auth (1) + Org Name (2) + Invite (3, skippable) + Goals (4, skippable) + Integrations (5, dead end) = **5 steps, aha moment: never reached** (no data shown)
- **V2:** Auth (1) + Path Selection (2) + County Selection (3) + **Instant Deal Hunt (4, AHA MOMENT)** + Strategy (5) + Atlas Tour (6) + Complete (7) = **7 steps, aha moment at step 4**

---

## 087 -- Refund/Dispute/Chargeback

**Distinct Value:** Verify that the billing system handles money flowing backwards -- refunds, disputes, and chargebacks -- with proper accounting, notifications, and Stripe webhook coverage.

### Findings

#### F087-1: No `charge.dispute.*` webhook handlers -- chargebacks are silently dropped (P0)
- **File:** `server/webhookHandlers.ts:88-160`
- **Impact:** The `dispatchEvent` method handles `checkout.session.completed`, `invoice.payment_failed`, `invoice.payment_succeeded`, `customer.subscription.deleted/updated/created/paused/resumed`, `invoice.paid`, and `customer.subscription.trial_will_end`. It does NOT handle any `charge.dispute.*` events. When a customer files a chargeback with their bank, Stripe fires `charge.dispute.created`, `charge.dispute.updated`, and `charge.dispute.closed`. AcreOS silently drops these events (logged as "Unhandled Stripe event type" at info level). The org continues to have full access while Stripe holds the disputed funds.
- **Remediation:** Add handlers for `charge.dispute.created` (flag the org, alert the founder, suspend if appropriate), `charge.dispute.updated`, `charge.dispute.closed` (restore or cancel based on outcome). At minimum, create a system alert for the founder so disputes are not invisible.

#### F087-2: Self-serve refund has no rate limiting -- abuse vector (P1)
- **File:** `server/routes-billing.ts:782-885`
- **Impact:** The `/api/subscription/refund-request` endpoint auto-approves refunds under $50 with no cooldown or per-org rate limit. A malicious user could repeatedly purchase and refund credit packs to abuse the system, or trigger multiple auto-refunds. The only check is "charges in the last 30 days."
- **Remediation:** Add rate limiting: max 1 refund request per org per 30-day period. Add a check for previous refund history before auto-approving.

#### F087-3: Refund auto-approval does not cancel/downgrade the subscription (P1)
- **File:** `server/routes-billing.ts:830-866`
- **Impact:** When a refund is auto-approved and processed, the code creates the Stripe refund and sends a confirmation email, but does NOT cancel the subscription or downgrade the org's tier. The user retains full access to the paid tier despite receiving their money back.
- **Remediation:** After processing a refund, trigger a subscription cancellation or at minimum flag the account for manual review. The current code only creates a system alert for refunds over $50.

#### F087-4: Stripe Connect marketplace has no refund flow (P2)
- **Files:** `server/routes-billing.ts:380-578`
- **Impact:** Stripe Connect endpoints support payment intents and payment links for borrower portal payments, but there is no reverse-flow endpoint for refunding payments made through Connect. If a property sale falls through or a buyer disputes a note payment, there is no API surface to process the refund.
- **Remediation:** Add a `/api/stripe/connect/refund` endpoint that creates a refund on the connected account. Include audit logging and founder notification.

#### F087-5: Refund request table exists but lacks status tracking UI (P3)
- **Files:** `server/routes-billing.ts:887-899`
- **Impact:** There is a GET endpoint for refund request status, but it is unclear whether the client has a corresponding UI to show refund history. Users may not know the status of their refund request.
- **Remediation:** Add a refund status section in the billing/settings page showing pending/processed refund requests.

---

## 088 -- Trial Expiration/Downgrade

**Distinct Value:** Verify that the trial lifecycle is fully managed: start, warning, expiration, downgrade, and that users experience a smooth transition rather than a cliff edge.

### Findings

#### F088-1: Trial expiration does NOT send an email notification (P1)
- **Files:** `server/services/trialService.ts:94-115`, `server/agents/operations.ts:97-110`
- **Impact:** When `expireTrials()` runs, it silently updates the org from `trialing` to `free` tier with `active` status. No email is sent to the user informing them their trial has ended and they have been downgraded. The user discovers this only when they try to use a premium feature and it fails.
- **Remediation:** Add an email notification in `expireTrials()` for each expired org, informing them of the downgrade and providing an upgrade CTA link.

#### F088-2: Trial warning is in-app only -- no email sent for trial ending (P1)
- **File:** `server/webhookHandlers.ts:449-477`
- **Impact:** The `processTrialWillEnd` handler creates a system alert (`storage.createSystemAlert`) but does NOT send an email. The Stripe `customer.subscription.trial_will_end` event fires 3 days before trial end. If the user is not actively logged in and checking alerts, they will miss the warning entirely.
- **Remediation:** Add an email in `processTrialWillEnd()` alongside the system alert. The dunning service already has email templates that could serve as a model.

#### F088-3: Trial expiration depends on operations agent -- no dedicated cron job (P2)
- **Files:** `server/agents/operations.ts:22`, `server/services/trialService.ts:92`
- **Impact:** Trial expiration is triggered by the operations agent's `run()` method, not by a dedicated cron job. If the operations agent is not running (agent failure, infra issue), trials are never expired and users get indefinite free access. The billing routes also expose a manual `POST /api/admin/expire-trials` endpoint, but this is admin-only.
- **Remediation:** Register a dedicated BullMQ cron job for trial expiration (like the other cron jobs in `server/jobs/`), running every hour. Keep the operations agent call as a backup.

#### F088-4: Trial-only users on the Stripe trial bypass -- trial_will_end only fires for Stripe subscriptions (P2)
- **Files:** `server/services/trialService.ts:57-88`, `server/routes-billing.ts:599-633`
- **Impact:** There are two trial paths: (1) Stripe subscription trial (14-day free trial on checkout), which sends `trial_will_end` webhook, and (2) AcreOS-managed trial via `POST /api/trial/start`, which sets `trialEndsAt` directly in the DB. For path (2), no Stripe subscription exists, so `customer.subscription.trial_will_end` never fires, meaning no warning is ever generated. Users on the internal trial path get no advance notice.
- **Remediation:** Add an internal job or check in the operations agent that sends warnings for internally-managed trials (e.g., 3 days before `trialEndsAt`).

#### F088-5: Downgrade has no feature access gating -- cliff edge experience (P2)
- **File:** `server/services/trialService.ts:94-115`
- **Impact:** When a trial expires, the org is set to `free` tier instantly. There is no grace period, no "your trial ended but you can still view your data read-only" transition. Usage limits from `usageLimits.ts` kick in immediately, which may cause in-progress workflows to break mid-action.
- **Remediation:** Add a 24-48 hour grace period where the org is marked as `trial_expired` with read-only access before full downgrade to free tier. Show a prominent banner during this period.

#### F088-6: No re-engagement flow after trial expiration (P3)
- **Impact:** After trial expires, there is no automated follow-up email sequence (day 1, day 3, day 7) to encourage upgrade. The user simply drops off with no win-back attempt.
- **Remediation:** Implement a post-trial drip sequence: immediate expiration email, 3-day follow-up with feature highlights they used, 7-day final offer.

---

## 089 -- Transactional Email

**Distinct Value:** Audit the full inventory of transactional emails -- what is sent, what is missing, and whether delivery infrastructure is production-ready.

### Email Infrastructure

The email service (`server/services/emailService.ts`) uses AWS SES with:
- Organization-specific credentials (encrypted) with platform fallback
- Circuit breaker pattern
- Exponential backoff retry (3 retries, 1-10s delay)
- CAN-SPAM compliance footer for campaign/marketing emails
- Email validation before send

### Emails Currently Sent

| Trigger | Email Sent | File |
|---------|-----------|------|
| Subscription checkout completed | Welcome email with tier details | `webhookHandlers.ts:210-228` |
| Subscription cancelled | Cancellation confirmation | `webhookHandlers.ts:336-357` |
| Payment failed (dunning) | Payment failed + reminder + warning + final notice | `dunning.ts:27-91` |
| Payment recovered (dunning) | Recovery success | `dunning.ts:79-89` |
| Refund auto-approved | Refund confirmation | `routes-billing.ts:852-857` |

### Findings

#### F089-1: No welcome email for free-tier signups (P1)
- **Impact:** Users who sign up and complete onboarding without subscribing receive zero transactional emails. The welcome email is only triggered by the Stripe subscription checkout webhook. The vast majority of new users (who start on free tier) get no email at all.
- **Remediation:** Add a welcome email in `onboardingService.completeOnboarding()` or in the `getOrCreateOrg` middleware when a new org is created.

#### F089-2: No payment receipt emails (P2)
- **Files:** `server/webhookHandlers.ts:535-563` (processInvoicePaid)
- **Impact:** The `processInvoicePaid` handler only resolves dunning state. It does not send a payment receipt email. Stripe can be configured to send receipts, but AcreOS does not configure this, and for credit pack purchases, no receipt is sent at all.
- **Remediation:** Send a receipt email on `invoice.paid` events and on `checkout.session.completed` for credit purchases.

#### F089-3: No team invitation email (P1)
- **Files:** `server/routes-deal-rooms.ts`, `server/routes-beta.ts`
- **Impact:** The onboarding wizard allows entering a colleague's email for team invite, but there is no email sending logic in the onboarding flow. The `inviteEmails` field is saved to `onboardingData` but never triggers an actual email. Team member invitations via the settings page also lack email delivery.
- **Remediation:** Implement team invitation email with a sign-up link or Clerk invitation flow.

#### F089-4: Trial expiration warning has no email -- only in-app alert (P1)
- **File:** `server/webhookHandlers.ts:449-477`
- **Impact:** Covered in F088-2. The `trial_will_end` webhook creates an in-app system alert but sends no email. Users not actively logged in miss the warning.
- **Remediation:** Add email notification in `processTrialWillEnd()`.

#### F089-5: Trial expiration itself sends no email (P1)
- **File:** `server/services/trialService.ts:94-115`
- **Impact:** Covered in F088-1. Silent downgrade with no email notification.
- **Remediation:** Add email in `expireTrials()`.

#### F089-6: No email templates system -- all emails are inline HTML strings (P2)
- **Files:** `server/webhookHandlers.ts`, `server/services/dunning.ts`
- **Impact:** Every email is constructed as an inline HTML string in the handler code. There is no template system, no shared layout, no consistent branding. The dunning service has the best templates (proper styling, CTA buttons), but the webhook welcome email is minimal inline HTML with no CSS. Brand inconsistency across emails.
- **Remediation:** Create a shared email template system with a base layout (header, footer, branding) and per-email content slots. Consider using a library like `mjml` or `react-email`.

#### F089-7: Email service depends on AWS SES credentials -- no fallback for missing config (P2)
- **File:** `server/services/emailService.ts:93-115`
- **Impact:** If `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, or `AWS_SES_FROM_EMAIL` are not set, `getPlatformCredentials()` throws. The email service has an `isConfigured()` check, but most callers (webhook handlers, dunning) do not check it before attempting to send. Errors are caught individually but this means emails silently fail.
- **Remediation:** Add a centralized `safeSendEmail()` wrapper that checks `isConfigured()` first and logs a structured warning instead of throwing.

---

## 090 -- Support Handoff

**Distinct Value:** Evaluate the end-to-end support experience -- from self-serve help to AI triage to human escalation -- and identify handoff gaps where users fall through the cracks.

### Support Architecture

The support system has three layers:
1. **Self-serve:** Help page (`client/src/pages/help.tsx`) with `HelpContent` and `SupportContent` components, plus a knowledge base (`/api/support/knowledge-base`)
2. **AI-powered (Pax/Sophie):** Support agent (`server/ai/supportAgent.ts`) with 20+ tool definitions for KB search, diagnostics, auto-fix, escalation, feedback, and learning
3. **Human escalation:** Support ticket system (`server/routes-support-tickets.ts`) with ticket CRUD, messaging, and human resolution flow

### Findings

#### F090-1: AI support agent depends on OpenAI API key which is known to be invalid in production (P0)
- **Files:** `server/ai/supportAgent.ts:18-30`, `docs/audits/00-orientation.md` (problem #9)
- **Impact:** The support agent calls `getOpenAIClient()` which requires `AI_INTEGRATIONS_OPENAI_API_KEY` or `OPENAI_API_KEY`. The orientation document notes "OpenAI API key invalid -- AI features broken in production." This means the AI support agent (Pax) is non-functional in production, and any user who submits a support ticket gets no AI response.
- **Remediation:** Fix the OpenAI API key in production environment variables. Alternatively, wire the support agent through OpenRouter (which is used elsewhere in the system) for model-agnostic routing.

#### F090-2: No fallback when AI support fails -- ticket goes into a black hole (P1)
- **Files:** `server/routes-support-tickets.ts:88-116`
- **Impact:** When a user sends a message to a support ticket, the handler calls `processSupportChat()`. If this throws (due to invalid API key, rate limit, model error), the catch block returns a 500 error. The user's message IS saved (inserted before AI processing), but they receive no response and no indication that a human has been notified. There is no automatic escalation on AI failure.
- **Remediation:** Add a try/catch around `processSupportChat()` that, on failure, (a) adds a system message "Our AI assistant is temporarily unavailable, a human team member has been notified", (b) automatically escalates the ticket, and (c) creates a system alert for the founder.

#### F090-3: Support ticket access control is missing -- any user can view any ticket (P1)
- **File:** `server/routes-support-tickets.ts:66-86`
- **Impact:** The `GET /api/support/tickets/:id` endpoint fetches the ticket by ID without checking that the ticket belongs to the requesting user's organization. Any authenticated user can read any support ticket by guessing the integer ID.
- **Remediation:** Add an `organizationId` check: `and(eq(supportTickets.id, ticketId), eq(supportTickets.organizationId, org.id))`.

#### F090-4: Human escalation tool exists but no notification is sent to the human (P1)
- **File:** `server/ai/supportAgent.ts:131-158` (escalate_to_human tool definition)
- **Impact:** The `escalate_to_human` tool definition exists with fields for reason, priority, summary, and diagnostic bundle. However, this is a tool definition for the AI agent to call -- it does not actually send an email, SMS, or push notification to a human support agent. It likely updates the ticket status, but the founder only sees it if they actively check the system alerts or tickets dashboard.
- **Remediation:** Wire the escalation tool to send an email/notification to the founder or support team. Use the `emailService` to send an escalation alert with ticket context.

#### F090-5: Knowledge base has no seeded content -- may be empty for new deployments (P2)
- **Files:** `server/routes-support-tickets.ts:259-285`
- **Impact:** The knowledge base is populated organically from human resolutions (via `addToKnowledgeBase` flag on resolve-human) and auto-generated articles. For a new deployment or new customer, the KB is likely empty, meaning the AI agent's `search_knowledge_base` tool returns no results and cannot help users.
- **Remediation:** Seed the knowledge base with foundational articles covering common workflows: adding leads, creating properties, managing deals, billing/credits, campaign setup.

#### F090-6: Support ticket close endpoint has no org check -- any user can close any ticket (P2)
- **File:** `server/routes-support-tickets.ts:119-140`
- **Impact:** The `POST /api/support/tickets/:id/close` endpoint does not verify the ticket belongs to the requesting org. Same authorization gap as F090-3.
- **Remediation:** Add organization ownership check before allowing close/resolve operations.

#### F090-7: No SLA tracking or response time measurement (P3)
- **Impact:** There is no tracking of first-response time, resolution time, or SLA compliance. The `supportResolutionHistory` table exists for learning, but there is no operational metric for "how long did the user wait for a response."
- **Remediation:** Add `firstResponseAt` and `avgResponseTime` fields to the ticket model. Track and expose these metrics in the founder dashboard.

---

## Summary Table

| ID | Lens | Severity | Finding | File(s) |
|----|------|----------|---------|---------|
| F086-1 | Onboarding | P1 | Two competing onboarding wizards with no routing | `onboarding-wizard.tsx`, `onboarding-v2.tsx` |
| F086-2 | Onboarding | P2 | V1 integrations step is a dead end | `onboarding-wizard.tsx:192-199` |
| F086-3 | Onboarding | P0 | Auth fragility blocks signup | Known issue #1 |
| F086-4 | Onboarding | P2 | Instant Deal Hunt has no offline fallback | `onboarding-v2.tsx:170-200` |
| F086-5 | Onboarding | P1 | Setup wizard API crashes | Known issue #16 |
| F086-6 | Onboarding | P2 | No welcome email on onboarding completion | `routes-onboarding.ts` |
| F086-7 | Onboarding | P2 | Wizard progress lost on page refresh | `onboarding-wizard.tsx`, `onboarding-v2.tsx` |
| F087-1 | Refund/Dispute | P0 | No `charge.dispute.*` webhook handlers | `webhookHandlers.ts:88-160` |
| F087-2 | Refund/Dispute | P1 | Refund endpoint has no rate limiting | `routes-billing.ts:782-885` |
| F087-3 | Refund/Dispute | P1 | Auto-refund does not cancel subscription | `routes-billing.ts:830-866` |
| F087-4 | Refund/Dispute | P2 | Stripe Connect has no refund flow | `routes-billing.ts:380-578` |
| F087-5 | Refund/Dispute | P3 | No refund status UI for users | `routes-billing.ts:887-899` |
| F088-1 | Trial/Downgrade | P1 | Trial expiration sends no email | `trialService.ts:94-115` |
| F088-2 | Trial/Downgrade | P1 | Trial warning is in-app only | `webhookHandlers.ts:449-477` |
| F088-3 | Trial/Downgrade | P2 | No dedicated cron for trial expiration | `agents/operations.ts:22` |
| F088-4 | Trial/Downgrade | P2 | Internal trials bypass Stripe warning webhook | `trialService.ts:57-88` |
| F088-5 | Trial/Downgrade | P2 | No grace period on downgrade | `trialService.ts:94-115` |
| F088-6 | Trial/Downgrade | P3 | No re-engagement sequence post-trial | N/A |
| F089-1 | Email | P1 | No welcome email for free-tier signups | `webhookHandlers.ts`, `routes-onboarding.ts` |
| F089-2 | Email | P2 | No payment receipt emails | `webhookHandlers.ts:535-563` |
| F089-3 | Email | P1 | No team invitation email | `routes-onboarding.ts`, onboarding wizards |
| F089-4 | Email | P1 | Trial warning has no email (dup F088-2) | `webhookHandlers.ts:449-477` |
| F089-5 | Email | P1 | Trial expiration has no email (dup F088-1) | `trialService.ts:94-115` |
| F089-6 | Email | P2 | No template system -- inline HTML strings | Multiple files |
| F089-7 | Email | P2 | Email service throws on missing AWS config | `emailService.ts:93-115` |
| F090-1 | Support | P0 | AI support agent broken -- invalid API key | `supportAgent.ts:18-30` |
| F090-2 | Support | P1 | No fallback on AI failure -- ticket black hole | `routes-support-tickets.ts:88-116` |
| F090-3 | Support | P1 | Ticket read has no org ownership check | `routes-support-tickets.ts:66-86` |
| F090-4 | Support | P1 | Escalation tool does not notify humans | `supportAgent.ts:131-158` |
| F090-5 | Support | P2 | Knowledge base has no seeded content | `routes-support-tickets.ts:259-285` |
| F090-6 | Support | P2 | Ticket close has no org ownership check | `routes-support-tickets.ts:119-140` |
| F090-7 | Support | P3 | No SLA tracking or response time metrics | N/A |

## P0 Issues (3)
1. **F086-3** -- Auth fragility blocks signup (known, pre-existing)
2. **F087-1** -- No dispute webhook handlers -- chargebacks silently dropped
3. **F090-1** -- AI support agent broken in production (known, pre-existing)

## P1 Issues (12)
F086-1, F086-5, F087-2, F087-3, F088-1, F088-2, F089-1, F089-3, F089-4, F089-5, F090-2, F090-3, F090-4

## P2 Issues (12)
F086-2, F086-4, F086-6, F086-7, F087-4, F088-3, F088-4, F088-5, F089-2, F089-6, F089-7, F090-5, F090-6

## P3 Issues (3)
F087-5, F088-6, F090-7

# Red Team Persona 07: Angry Churning Customer

**Persona**: Frustrated subscriber who wants to cancel, get a refund, export all data, delete their account, and stop all communications.

**Date**: 2026-04-18
**Auditor**: Claude Opus 4.6 (Red Team)
**Severity Scale**: PASS (no issue) | CONCERN (friction or gap) | FAIL (broken or hostile to user)

---

## Executive Summary

The offboarding experience is **substantially better than average SaaS** -- cancellation is visible and honest, refunds are automated for small amounts, GDPR data export and deletion are implemented with dedicated UI pages, and billing transparency is strong. However, there are several CONCERN-level gaps: post-cancellation access semantics are murky, the notification opt-out system uses an in-memory store that won't survive restarts, and the GDPR export is JSON-only (no CSV option for personal data). No FAIL-level issues were found.

**Overall Grade: 7.5/10 -- Solid foundation, needs polish on a few edges.**

---

## 1. Cancellation Flow

**Verdict: PASS**

The cancellation flow is clean, honest, and easy to find.

### Evidence

- **Cancel button is visible**: Settings page (`client/src/pages/settings.tsx:877-886`) renders a Cancel button with `XCircle` icon directly next to the "Manage Subscription" button. No hiding, no dark patterns.
- **aria-label present**: `aria-label="Cancel subscription"` on the button (line 882).
- **Two-step dialog**: `CancellationDialog` (`client/src/components/cancellation-dialog.tsx`) implements a two-step flow -- reason selection, then confirmation. No manipulation.
- **Server endpoint**: `POST /api/subscription/cancel` (`server/routes-billing.ts:738-776`) validates the reason, saves the survey, then redirects to Stripe's Customer Portal for the actual cancellation.
- **No artificial obstacles**: No "call us to cancel" or multi-page maze. The flow is: click Cancel -> select reason -> confirm -> Stripe portal completes it.

### Minor note

The cancellation redirects to Stripe's Customer Portal to finalize. This adds one hop but is industry-standard and ensures the subscription is properly terminated at the payment processor level.

---

## 2. Refund Process

**Verdict: PASS**

Refunds are well-implemented with auto-approval for small amounts and clear escalation for larger ones.

### Evidence

- **Self-serve refund**: `POST /api/subscription/refund-request` (`server/routes-billing.ts:782-927`) allows users to request refunds directly.
- **Auto-approval under $50**: Charges <= $50 are auto-approved and refunded immediately via `stripe.refunds.create()` (line 846-848). The subscription is cancelled and the org is downgraded to free tier.
- **Confirmation email**: After auto-refund, a confirmation email is sent with the exact dollar amount and 5-10 business day timeline (lines 889-901).
- **Manual review for > $50**: Larger refunds go to "pending" status with a system alert created for the founder to review (lines 911-923).
- **Rate limiting**: One refund per 30 days per org, preventing abuse (lines 799-812).
- **Refund status endpoint**: `GET /api/subscription/refund-requests` lets users track their refund status (lines 930-941).
- **DEFECT-0029 was previously fixed** per commit history.

---

## 3. Data Export

**Verdict: PASS**

Multiple export paths exist, covering both organization-level and user-level data.

### Evidence

**Organization data export** (`server/routes-import-export.ts:199-264`):
- `GET /api/export/:entityType` supports leads, properties, deals, and notes.
- Supports both CSV and JSON formats via `?format=csv` or `?format=json`.
- Supports filters: `status`, `type`, `startDate`, `endDate`.

**Full backup** (`server/routes-import-export.ts:266-293`):
- `GET /api/export/backup` creates a comprehensive backup of all org data as a single JSON download.

**GDPR personal data export** (`server/routes-gdpr.ts:20-35`):
- `POST /api/privacy/export` exports all personal data for the current user (GDPR Article 15).
- Returns user profile, leads, deals, properties, tasks, messages, and support tickets.
- File is named `acreOS-data-export-YYYY-MM-DD.json`.

**Full data portability** (`server/services/dataPortability.ts:30-59`):
- `generateFullExport()` pulls leads, deals, properties, notes, and campaigns up to 10,000 records per entity.

**Client UI** (`client/src/components/settings/download-data-section.tsx`):
- "Download All My Data" button with loading states, error handling, and auto-download.

**Privacy Settings page** (`client/src/pages/privacy-settings.tsx:27-46`):
- Dedicated "Export Your Data" card with one-click download.

---

## 4. Account Deletion

**Verdict: PASS**

Full GDPR-compliant anonymization is implemented with appropriate safeguards.

### Evidence

**Server** (`server/services/gdprService.ts:101-169`):
- `anonymizeUser()` implements GDPR Article 17 (Right to Erasure).
- Deletes: agent events, team messages, support tickets, tasks, sessions, AI conversations.
- Anonymizes: user email to `deleted-user-{hash}@gdpr-deleted.invalid`, name to `[Deleted User {hash}]`.
- Anonymizes leads assigned to the user (replaces PII but keeps business records).
- Returns a detailed `DeletionReport` with item counts.

**Route** (`server/routes-gdpr.ts:38-62`):
- Requires explicit confirmation: `{ confirm: "DELETE MY DATA" }`.
- Checks for prior deletion to prevent double-processing (409 response).

**Client UI** (`client/src/pages/privacy-settings.tsx:125-191`):
- Red-bordered "Delete Personal Data" card with `AlertTriangle` warning icon.
- Two-step confirmation: click "Request Data Deletion" -> type "DELETE MY DATA" -> confirm.
- Clear warning: "This action cannot be undone."
- After deletion, auto-redirects to `/auth` after 3 seconds.
- If already deleted, shows a "Data Deletion Complete" confirmation screen.

**Data Rights Dashboard** (privacy-settings.tsx:194-226):
- Lists all 6 GDPR articles (15-21) with availability status.
- Articles 15, 16, 17, 20: "Available" (self-serve).
- Articles 18, 21: "Via Support" (contact-based).

---

## 5. Data Portability

**Verdict: CONCERN**

Organization data supports CSV + JSON, but personal data export (GDPR) is JSON-only.

### Evidence

**Organization exports** support both formats:
- CSV and JSON via `?format=csv|json` on `/api/export/:entityType` (routes-import-export.ts:209).
- This covers leads, properties, deals, and notes.

**GDPR personal data export** is JSON-only:
- `POST /api/privacy/export` returns only JSON (`server/routes-gdpr.ts:26`).
- `exportUserData()` returns a typed `GdprExportData` object (gdprService.ts:68-94).

**Missing**: No CSV option for the personal data export. While JSON is machine-readable and portable, many users (especially non-technical real estate professionals) may prefer CSV for spreadsheet compatibility. The privacy policy claims data can be exported "in a portable, machine-readable format (JSON, CSV)" (`client/src/pages/privacy.tsx:148`), but the GDPR export only delivers JSON.

**Recommendation**: Add `?format=csv` support to `POST /api/privacy/export`, or at minimum include the org-level CSV exports in the GDPR export bundle.

---

## 6. Subscription Transparency

**Verdict: PASS**

Billing cycle dates and subscription details are clearly displayed.

### Evidence

**Settings page** (`client/src/pages/settings.tsx:857-860`):
- "Current Period" is displayed with exact start and end dates: `current_period_start` and `current_period_end` from Stripe.
- `data-testid="text-subscription-period"` confirms this is tested.

**Subscription data endpoint** (`server/routes-billing.ts:359-377`):
- `GET /api/stripe/subscription` returns the full Stripe subscription object including period dates, status, and tier.

**Support agent** (`server/ai/supportAgent.ts:3471-3477`):
- The AI support agent exposes `cancelAtPeriodEnd`, `cancelAt`, `currentPeriodStart`, `currentPeriodEnd`, and `pricePerMonth` when users ask about their subscription.

**Manage Subscription button**: Redirects to Stripe Customer Portal (`server/routes-billing.ts:339-357`) where users can see invoices, update payment methods, and view full billing history.

---

## 7. Retention Dark Patterns

**Verdict: PASS**

No dark patterns detected. The cancellation flow is honest and respectful.

### Evidence

**No hidden cancel button**: Cancel button is inline, visible, with clear `XCircle` icon and "Cancel" label (settings.tsx:877-886).

**No guilt-trip copy**: The dialog says "We're sorry to see you go. Your feedback helps us improve." (cancellation-dialog.tsx:79). No fear-mongering about data loss or missed opportunities.

**Downgrade alternative offered fairly**: The dialog offers "Downgrade instead" as an alternative only for non-free/non-sprout tiers (cancellation-dialog.tsx:119-124), presented as a neutral `variant="outline"` button -- not pushed aggressively.

**Confirm button is clear**: "Continue to cancel" -> "Confirm cancellation" -- straightforward two-step with no confusing double-negatives like "Don't cancel my cancellation."

**No sneaky re-engagement loops**: The churn engine (`server/services/churnEngine.ts`) sends rescue emails to inactive users, but only once per org (line 331: checks `churnRescueSentAt`). This is proactive customer success, not a dark pattern.

**Usage stats shown transparently**: The pre-cancellation context shows current usage (cancellation-dialog.tsx:83-97) -- this is informational, not manipulative.

---

## 8. Post-Cancellation Access

**Verdict: CONCERN**

The user is told they keep access until the billing period ends, but the server-side implementation immediately downgrades.

### Evidence

**Client-side promise** (cancellation-dialog.tsx:138-140):
> "Your subscription will remain active until the end of your current billing period. Your data will be preserved, and you can re-subscribe at any time."

**But the server behavior is different**:

When cancellation is initiated via the self-serve cancel flow:
1. User submits survey -> redirected to Stripe Portal (`server/routes-billing.ts:762-768`).
2. Stripe Portal handles the actual cancellation (typically `cancel_at_period_end`).
3. Stripe fires `customer.subscription.deleted` webhook.
4. `processSubscriptionCancelled()` (`server/webhookHandlers.ts:299-356`) **immediately** sets:
   ```
   subscriptionTier: 'free'
   subscriptionStatus: 'cancelled'
   dunningStage: 'cancelled'
   stripeSubscriptionId: null
   ```

**The issue**: When Stripe's portal is configured to cancel at period end (the default), Stripe fires `customer.subscription.updated` first with `cancel_at_period_end: true`, then `customer.subscription.deleted` when the period actually ends. The `processSubscriptionUpdated` handler (line 361-437) would keep the status as `active` during the grace period. But if Stripe fires `deleted` immediately (e.g., for immediate cancellation), the user loses access instantly.

**The gap**: There is no explicit `cancel_at_period_end` handling in the cancel endpoint itself. The behavior depends entirely on how the Stripe Portal is configured. If the Portal is set to "Cancel immediately," the promise of "access until period end" would be broken.

**Positive**: The cancellation confirmation email (webhookHandlers.ts:329-350) correctly says "Your data is preserved -- you can re-subscribe at any time."

**Recommendation**: Explicitly enforce `cancel_at_period_end` behavior by either:
1. Configuring the Stripe Customer Portal to only allow end-of-period cancellation, or
2. Using the Stripe API directly with `cancel_at_period_end: true` instead of deferring to the portal.

---

## 9. Communication Opt-Out

**Verdict: CONCERN**

Email opt-out exists at multiple levels but has implementation gaps.

### Evidence

**Campaign/marketing emails**: Properly handled.
- `emailService.ts:296-304` appends an unsubscribe footer to all campaign emails when `isCampaignEmail: true` or `unsubscribeUrl` is set.
- Footer text: "You are receiving this email because you are a contact in our CRM system."
- Unsubscribe link is rendered as a standard HTML anchor.

**Notification preferences** (`server/services/notificationPreferences.ts:200-264`):
- Full per-event, per-channel (email/SMS/push/inApp) control.
- `globalMute: boolean` allows muting all notifications.
- `shouldNotify()` respects globalMute first (line 247).
- Categories: Deals, Leads, Campaigns, Finance, System.

**Implementation gap**: The preferences store is **in-memory only** (line 194):
```typescript
const preferencesStore = new Map<string, UserNotificationPreferences>();
```
This means all notification preferences are lost on server restart. A user who sets globalMute to true would find themselves opted back in after a deploy.

**Missing transactional email opt-out**: System emails like churn rescue (`churnEngine.ts:240-250`), refund confirmations, and cancellation confirmations are sent directly via `emailService.sendEmail()` without checking notification preferences. These are arguably transactional (not marketing), but the churn rescue email is borderline marketing.

**No unsubscribe for system emails**: The `unsubscribeUrl` is only attached to campaign emails (`isCampaignEmail: true`). Transactional emails like the churn rescue have no unsubscribe mechanism.

**Recommendation**:
1. Persist notification preferences to the database instead of in-memory.
2. Check `globalMute` before sending re-engagement/churn rescue emails.
3. Add `List-Unsubscribe` headers to all non-critical emails per RFC 8058.

---

## 10. Feedback Collection

**Verdict: PASS**

Cancellation feedback is collected thoughtfully with both structured and free-text options.

### Evidence

**Cancellation survey** (cancellation-dialog.tsx:18-24):
Five structured reasons:
1. "Too expensive for my needs"
2. "I'm not using it enough"
3. "Missing features I need"
4. "Switching to another tool"
5. "Other reason"

**Free-text feedback**: Optional `Textarea` for additional feedback (line 110-115).

**Server-side storage** (routes-billing.ts:753-759):
Survey is persisted to `cancellation_surveys` table with:
- `organizationId`, `userId`, `reason`, `feedback`, `previousTier`
- Schema also tracks `offeredDowngrade` and `acceptedDowngrade` (shared/schema.ts:5469-5470).

**Refund feedback**: The refund request also captures a `reason` field (routes-billing.ts:789), providing secondary churn insight.

---

## Summary Table

| # | Area | Verdict | Key Finding |
|---|------|---------|-------------|
| 1 | Cancellation Flow | **PASS** | Visible button, 2-step dialog, no obstacles |
| 2 | Refund Process | **PASS** | Auto-refund under $50, manual review above, email confirmation |
| 3 | Data Export | **PASS** | CSV + JSON org export, GDPR personal export, full backup |
| 4 | Account Deletion | **PASS** | GDPR Article 17 compliant, typed confirmation, detailed report |
| 5 | Data Portability | **CONCERN** | GDPR export is JSON-only; privacy policy promises CSV |
| 6 | Subscription Transparency | **PASS** | Period dates displayed, Stripe Portal access, AI agent support |
| 7 | Retention Dark Patterns | **PASS** | No dark patterns; honest copy, fair downgrade offer |
| 8 | Post-Cancellation Access | **CONCERN** | Promise of period-end access depends on Stripe Portal config |
| 9 | Communication Opt-Out | **CONCERN** | In-memory preference store; churn emails bypass opt-out |
| 10 | Feedback Collection | **PASS** | 5 structured reasons + free text, persisted to DB |

---

## Recommended Fixes (Priority Order)

### P1 (Should fix before launch)

1. **Persist notification preferences to database** -- the in-memory `Map` in `notificationPreferences.ts:194` means all opt-out choices are lost on server restart. This is a compliance issue.

2. **Verify Stripe Portal cancellation mode** -- confirm the portal is configured for `cancel_at_period_end` (not immediate), or add explicit API handling. The user-facing copy promises access until period end.

### P2 (Should fix soon after launch)

3. **Add CSV format to GDPR personal data export** -- the privacy policy promises CSV, but `POST /api/privacy/export` only returns JSON. Either add the format option or update the policy text.

4. **Check globalMute before churn rescue emails** -- `churnEngine.ts:triggerRescue()` sends re-engagement emails without checking notification preferences. Users who have opted out should not receive these.

5. **Add List-Unsubscribe header** -- All emails should include RFC 8058 `List-Unsubscribe` / `List-Unsubscribe-Post` headers, not just campaign emails.

### P3 (Nice to have)

6. **Add "Export data before cancelling" prompt** -- The cancellation dialog could remind users to export their data before cancelling, since the export tools exist but aren't surfaced in the cancel flow.

7. **Cancellation survey should record `offeredDowngrade` and `acceptedDowngrade`** -- The schema has these columns (shared/schema.ts:5469-5470), but the cancellation flow never writes to them. The downgrade button just closes the dialog.

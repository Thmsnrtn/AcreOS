# Chris J8 -- Data Export + Account Deletion

**Persona:** Chris, 34, churning customer, laptop, hostile to friction. Judges the product entirely on how cleanly it lets him leave.
**Task:** Export everything, cancel subscription, get a refund, delete account.
**Date:** 2026-04-18 | AcreOS v5 | Run 01

---

## Pre-conditions

- Chris is logged in on a laptop (Chrome, broadband).
- He has a paid subscription (Pro tier) with recent charges.
- He has leads, properties, deals, and notes data he wants to export before leaving.
- He is impatient and hostile toward any friction that looks like a retention dark pattern.

---

## Step-by-step transcript

### Step 1 -- Find the data export

Chris navigates to Settings. He needs to export his data before deleting his account.

**Action:** Clicks Settings in the navigation. Sees 15 tabs.

**Observation:** Chris scans the tabs. The relevant ones for his mission:
- "Data" tab -- contains Import/Export Manager and Compliance Settings
- "General" tab -- contains subscription management and cancellation
- "Payments" tab -- misleading name (Stripe Connect, not billing)

Chris clicks "Data" tab.

**Result:** The Data tab shows three sections:
1. Custom Fields
2. Import / Export Data (the `ImportExportManager` component)
3. Compliance & Data Governance (`ComplianceSettings`)

**Friction: LOW.** The "Data" tab is reasonably named and findable.

### Step 2 -- Export his data

Chris clicks the "Export" sub-tab within the Import/Export card.

**Result:** He sees:
- Export Type dropdown: Leads, Properties, Deals, Notes
- Export Format: CSV or JSON
- Optional filters (status, type, date range)
- "Export" button

**Friction: MEDIUM -- SEVERITY P2.** Chris wants to export EVERYTHING -- all entity types at once. But the export UI only supports one entity type at a time. He must export leads, then properties, then deals, then notes -- four separate downloads. Each triggers a `GET /api/export/{type}` call that generates and downloads a file.

> Chris thinks: "I have to do this four times? Why isn't there an 'Export All' button?"

### Step 3 -- Use the Backup feature

Chris notices the third sub-tab: "Backup" (with a database icon).

**Action:** Clicks the "Backup" tab.

**Result:** The backup tab shows a "Create Backup" button that calls `GET /api/export/backup`, which downloads a single JSON file containing all data.

**Friction: LOW.** This is exactly what Chris wants -- a single file with everything. However, the "Backup" tab is the third tab within the Import/Export card, and its label does not immediately communicate "Export All My Data."

> Chris thinks: "OK, this is better. One file with everything."

**Action:** Clicks "Create Backup."

**Result:** The browser downloads `backup.json`. A toast appears: "Your data backup has been downloaded."

### Step 4 -- GDPR data export (personal data)

Chris is thorough. He also wants his personal data (GDPR Article 15 export).

**Observation:** There is no visible GDPR export button in the UI. The server has `POST /api/privacy/export` (routes-gdpr.ts), which generates a JSON download of all personal data. But the client-side Data tab only shows ImportExportManager and ComplianceSettings. The ComplianceSettings component has three sub-sections: Audit Log, TCPA Compliance, and Data Retention -- none of which include a GDPR export or account deletion button.

**Friction: HIGH -- SEVERITY P1.** The GDPR export endpoint exists on the server but has no corresponding UI button. Chris cannot trigger a personal data export from the application interface. He would need to call the API directly, which is unacceptable for a consumer-facing product.

> Chris thinks: "Where is the 'Download my data' button? Every serious product has one."

### Step 5 -- Cancel the subscription

Chris navigates to Settings > General tab. He scrolls to the Organization Details card.

**Result:** He sees his current tier badge ("Pro"), subscription period dates, and two buttons:
- "Manage Subscription" (opens Stripe portal)
- "Cancel" (ghost button, destructive hover color)

**Action:** Clicks "Cancel."

**Result:** The `CancellationDialog` opens. It is a two-step modal:

**Step 5a -- Reason selection:**
- Title: "Cancel your subscription?" with amber warning icon
- Usage summary showing his current month usage (leads used/limit, properties used/limit, etc.)
- Radio buttons for reason: Too expensive, Not using it enough, Missing features, Switching to another tool, Other
- Optional textarea for additional feedback
- Footer buttons: "Downgrade instead" (outline) and "Continue to cancel" (destructive, disabled until reason selected)

**Friction: LOW-MEDIUM.** The dialog is well-structured and not an aggressive retention pitch. It asks for a reason (reasonable) and offers a downgrade alternative (helpful, not manipulative). Chris selects "Switching to another tool."

**Step 5b -- Confirmation:**
- Title: "Confirm cancellation"
- Description: "Your subscription will remain active until the end of your current billing period. Your data will be preserved, and you can re-subscribe at any time."
- Buttons: "Go back" and "Confirm cancellation"

**Action:** Chris clicks "Confirm cancellation."

**Result:** The mutation sends `POST /api/subscription/cancel` with `{ reason: "switching_competitor" }`. The server saves the cancellation survey, then creates a Stripe portal session and returns a `portalUrl`. Chris is redirected to Stripe's customer portal where the actual cancellation is finalized.

**Friction: MEDIUM -- SEVERITY P2.** Chris clicked "Confirm cancellation" expecting the cancellation to be done. Instead, he is redirected to Stripe's external portal to confirm AGAIN. This is a double-confirmation pattern that feels like a retention dark pattern, even though it is actually Stripe's requirement for subscription cancellation. Chris must click through Stripe's portal UI to complete the cancellation.

> Chris thinks: "I already confirmed. Why am I on another website confirming again?"

### Step 6 -- Request a refund

Chris returns from the Stripe portal. He wants a refund for his most recent charge.

**Observation:** There is no visible "Request Refund" button in the UI. The server has `POST /api/subscription/refund-request` endpoint, but no client-side component renders a refund request form.

**Friction: HIGH -- SEVERITY P1.** The self-serve refund system exists on the server (with auto-approval for charges under $50, rate limiting, and proper Stripe integration), but there is no UI for it. Chris would need to contact support or call the API directly.

> Chris thinks: "They make it easy to take my money but impossible to give it back."

### Step 7 -- Delete the account

Chris wants to permanently delete his account and all personal data.

**Observation:** The server has `POST /api/privacy/delete` (routes-gdpr.ts) which anonymizes user data upon receiving `{ confirm: "DELETE MY DATA" }`. However, there is no "Delete Account" button, dialog, or flow anywhere in the client-side Settings page.

The ComplianceSettings component offers data purging (delete old leads, deals, etc.) but this is organization-level data retention, not account deletion. The "Manual Data Purge" section lets an admin purge old records by type and age, but it does not delete the account.

**Friction: CRITICAL -- SEVERITY P0.** Account deletion is a legal requirement under GDPR, CCPA, and similar regulations. The backend endpoint exists and works correctly (anonymization with legal record retention), but there is no way for a user to trigger it from the UI. This is a compliance gap.

> Chris thinks: "I literally cannot delete my account. This is the kind of thing I would tweet about."

### Step 8 -- Look for help

Chris opens the floating assistant and asks "How do I delete my account?"

**Expected behavior:** Pax will likely redirect him: "Sophie handles account support." But Sophie is not available in the agent dropdown (see Robert J5 transcript). Even if Pax attempts to answer, it has no tool to trigger account deletion -- the GDPR endpoints are not in the AI tool definitions.

**Friction: HIGH.** Dead end. No path to account deletion exists for the user.

---

## Friction inventory

| # | Event | Severity | Component |
|---|-------|----------|-----------|
| F1 | No account deletion UI despite backend endpoint existing | P0 | `settings.tsx` -- missing GDPR deletion UI |
| F2 | No GDPR data export button despite backend endpoint existing | P1 | `settings.tsx` -- missing privacy export UI |
| F3 | No refund request UI despite backend endpoint existing | P1 | `settings.tsx` -- missing refund UI |
| F4 | Cancellation requires double-confirmation via Stripe portal redirect | P2 | `cancellation-dialog.tsx` + `routes-billing.ts` |
| F5 | Entity export requires 4 separate downloads (no "Export All") | P2 | `import-export.tsx` export tab |
| F6 | "Backup" tab not obviously labeled as "Export All Data" | P3 | `import-export.tsx` tab naming |
| F7 | ComplianceSettings offers data purge but not account deletion | P3 | `compliance-settings.tsx` |

---

## Verdict

**FAIL.** Chris's departure flow is severely broken. Three critical backend capabilities -- GDPR data export, self-serve refund requests, and account deletion -- exist as working server endpoints but have zero client-side UI. A churning customer like Chris, who judges the product by how cleanly it lets him leave, would be furious. The cancellation flow itself works but requires an unexpected redirect to Stripe for a second confirmation. This is a compliance risk (GDPR/CCPA require accessible data export and deletion) and a reputation risk (Chris will tell other people).

---

## Recommendations

1. **URGENT: Add account deletion UI.** Add a "Danger Zone" section at the bottom of Settings > General (or a dedicated "Account" tab) with a red-bordered card containing a "Delete My Account" button. The flow should:
   - Warn that this action is permanent
   - Require typing "DELETE MY DATA" (matching the API expectation)
   - Show what will be deleted vs. retained for legal compliance
   - Trigger `POST /api/privacy/delete`
   - Sign the user out after completion

2. **Add GDPR data export button.** Add a "Download My Personal Data" button in the Data tab or in the Danger Zone section. This should trigger `POST /api/privacy/export` and download the resulting JSON file. Label it clearly: "Download everything AcreOS knows about you (GDPR Article 15)."

3. **Add refund request UI.** Add a "Request Refund" option in the General tab near the cancellation button, or in the cancellation dialog itself as a final step. The backend already supports auto-approval for charges under $50.

4. **Consolidate the departure flow.** When a user clicks Cancel, the flow should offer:
   - Step 1: Reason selection (exists)
   - Step 2: Option to export data / download backup
   - Step 3: Option to request refund
   - Step 4: Confirm cancellation (handle Stripe inline if possible, not via redirect)
   - Step 5: Option to delete account entirely

5. **Rename "Backup" to "Full Data Export" or "Export All Data."** Make the single-file download more discoverable for users who want everything.

# Journey 08: Data Export and Account Deletion

## Goal

Export all account data in a usable format, delete the account permanently, verify deletion is complete, and confirm re-login is no longer possible.

## Starting State

- Logged in to AcreOS with an active account.
- Account contains meaningful data: parcels, leads, campaigns, analysis results, decisions.
- User has decided to leave the platform and wants their data before they go.

## Steps

1. Navigate to settings or account management.
2. Locate the data export feature.
3. Initiate a full data export.
4. Wait for the export to be generated (may be async).
5. Download the export file(s).
6. Open and inspect the export — verify it contains parcels, leads, and other key records.
7. Verify the export format is usable (CSV, JSON, or ZIP of structured files — not a proprietary blob).
8. Navigate to account deletion.
9. Read the deletion warnings and understand what will be destroyed.
10. Confirm deletion (expect a confirmation step — "type DELETE" or re-enter password).
11. Verify the user is logged out after deletion.
12. Attempt to log back in with the deleted account's credentials.
13. Confirm that login fails with a clear message (not a cryptic error).

## Acceptance Criteria

| # | Condition | Measurement |
|---|-----------|-------------|
| A1 | Data export is discoverable | User finds the export option within 2 minutes |
| A2 | Export contains all major data types | Parcels, leads, campaigns, analysis results, and settings are included |
| A3 | Export format is usable | Files are in standard formats (CSV, JSON) that can be opened in Excel, a text editor, or another system |
| A4 | Export is complete | Record counts in exported files match what the user sees in the UI |
| A5 | Account deletion has a confirmation gate | The system requires explicit confirmation (not a single click) before destroying the account |
| A6 | Deletion is thorough | After deletion, the user is logged out and cannot log back in |
| A7 | Re-login fails gracefully | Attempting to log in with deleted credentials produces a clear "Account not found" or equivalent — not a 500 error |
| A8 | No orphaned data | After deletion, visiting any bookmarked URLs from the account returns appropriate errors, not partial data |

## Abandonment Criteria

The persona should realistically give up if any of the following occur:

- **Cannot find data export:** After 2 minutes, the user cannot locate any export functionality.
- **Cannot find account deletion:** The option to delete the account is hidden, missing, or requires contacting support with no self-service path.
- **Export is not downloadable:** The export is "generated" but there is no download link, or the link is broken.
- **Export is in a proprietary format:** The export file cannot be opened with standard tools and requires AcreOS-specific software to read.
- **Deletion process is confusing:** Multiple confirmation screens, unclear language, or dark patterns that make the user unsure whether deletion actually happened.

## Failure Conditions

These are unrecoverable errors that terminate the journey immediately:

- **Export crashes:** The export endpoint returns a 500 or the download never completes.
- **Export is incomplete without disclosure:** The export is missing major data categories (e.g., no leads, no campaigns) and does not disclose the omission.
- **Export contains other users' data:** The downloaded file includes records or PII belonging to other accounts.
- **Deletion does not actually delete:** After "deleting" the account, the user can still log in and see their data.
- **Deletion destroys data without export option:** The system allows deletion but has no export feature — making it impossible to take your data with you.
- **Partial deletion:** The account is deleted but data remnants (parcels, leads) persist and are visible to other org members or in system-wide views.
- **Deletion returns a 500:** The deletion endpoint crashes, leaving the account in an indeterminate state.

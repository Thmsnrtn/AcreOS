# Journey 10: Error Recovery

## Goal

Encounter a broken state mid-flow — such as an integration failure, agent error, or network interruption — and recover without losing work or data.

## Starting State

- Logged in to AcreOS with an active account and data.
- Actively performing a multi-step operation (importing parcels, running an analysis, creating a campaign, or reviewing a Pax decision).
- An error occurs mid-flow. Possible triggers:
  - Network connection drops temporarily.
  - An external integration (provider, Stripe, Clerk) returns an error.
  - Pax agent encounters an unhandled state.
  - Server returns a 500 on a critical endpoint.
  - Browser tab runs out of memory on a large dataset.

## Steps

1. Begin a multi-step operation (import, analysis, campaign creation, etc.).
2. Encounter an error mid-flow (naturally or via network throttling/interruption).
3. Read the error message or observe the error state.
4. Determine from the UI what went wrong.
5. Determine from the UI what to do next (retry, go back, start over, contact support).
6. Attempt recovery using the suggested path.
7. Verify that no data was lost from before the error.
8. Verify that partial progress (if any) was preserved.
9. Complete the original operation successfully.
10. Confirm the final state is correct and consistent.

## Acceptance Criteria

| # | Condition | Measurement |
|---|-----------|-------------|
| A1 | Error message is human-readable | No raw stack traces, JSON blobs, or HTTP status codes without explanation |
| A2 | Error message explains what happened | The user can describe the problem in their own words after reading the error |
| A3 | Error message suggests a next action | The UI provides at least one of: retry button, "go back" link, or support contact |
| A4 | No data loss | Data that existed before the error is still present after recovery |
| A5 | Partial progress is preserved where possible | If the user was 80% through an import, the successful rows are retained (or clearly reported) |
| A6 | Recovery succeeds | The user can retry or restart the operation and complete it successfully |
| A7 | No cascading failures | The error in one feature does not break unrelated features (navigation, dashboard, other pages) |
| A8 | Error is logged for debugging | Server-side logs capture the error with sufficient context for engineering to diagnose (not user-visible, but verifiable in logs) |

## Abandonment Criteria

The persona should realistically give up if any of the following occur:

- **Error message is useless:** The user sees "Something went wrong" with no additional context, no error code, and no suggested action.
- **No recovery path:** The error leaves the user on a dead-end screen with no way to retry, go back, or navigate elsewhere.
- **Work is lost:** The user was mid-import or mid-campaign-creation, and the error wiped out all progress with no draft or checkpoint saved.
- **Repeated failures with no change:** The user retries 3 times and gets the same error with no additional guidance or escalation path.
- **Error breaks the whole app:** After the error, other pages or features stop working, requiring a full page refresh or re-login.

## Failure Conditions

These are unrecoverable errors that terminate the journey immediately:

- **White screen of death:** The error crashes the entire React app, leaving a blank page with no navigation.
- **Data corruption:** The error causes data to be partially written — e.g., an import that creates duplicate records, a campaign that sends to wrong recipients, or an analysis that saves results for the wrong parcel.
- **Silent data loss:** The error occurs, the app appears to recover, but data is quietly missing (parcels deleted, leads dropped, decisions lost) with no indication.
- **Infinite error loop:** The error triggers a retry loop that the user cannot escape, burning credits or API calls.
- **Security exposure on error:** The error page or toast displays API keys, internal URLs, database connection strings, or other sensitive information.
- **Unrecoverable state:** The error puts the user's account into a state that cannot be fixed without database intervention (e.g., a stuck import lock, a corrupted org record, or a half-deleted campaign).

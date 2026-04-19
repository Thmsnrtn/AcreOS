# Journey 09: Returning After Absence

## Goal

Log in after 3 months of inactivity and become productive again within 10 minutes — finding previous work, understanding what has changed, and resuming meaningful activity.

## Starting State

- Has an existing AcreOS account that has not been accessed in 3 months.
- Session tokens are likely expired.
- The product may have received updates, UI changes, or new features since last login.
- Account contains parcels, leads, campaigns, and possibly Pax recommendations from before the absence.
- User remembers the general concept of AcreOS but not specific navigation paths.

## Steps

1. Navigate to acreos.fly.dev.
2. Attempt to access the app (may be redirected to login if session expired).
3. Log in with existing credentials.
4. Arrive at the dashboard.
5. Orient: identify what is on the dashboard and whether it provides a summary of current state.
6. Find previous parcels and leads — verify they still exist and are intact.
7. Check for any notifications, Pax recommendations, or activity that occurred during absence.
8. Identify if there are product updates, changelogs, or onboarding prompts for new features.
9. Perform a meaningful action (analyze a parcel, review a Pax recommendation, run a search).
10. Confirm that the action completes successfully and the user feels productive.

## Acceptance Criteria

| # | Condition | Measurement |
|---|-----------|-------------|
| A1 | Login succeeds on first attempt | Expired session is handled gracefully; user is prompted to log in, not shown an error |
| A2 | Previous data is intact | Parcels, leads, and campaigns created 3 months ago are all present and correct |
| A3 | Dashboard provides orientation | The user can determine the current state of their account (parcel count, pending items, recent activity) within 2 minutes |
| A4 | No stale or confusing state | There are no error banners about expired integrations, broken webhooks, or failed background jobs that the user cannot resolve |
| A5 | User is productive within 10 minutes | The user successfully performs a meaningful action (not just navigation) within 10 minutes of login |
| A6 | Product changes are communicated | If significant features have been added or changed, the user encounters some form of guidance (changelog, tooltip, banner) — not a completely unfamiliar UI with no explanation |

## Abandonment Criteria

The persona should realistically give up if any of the following occur:

- **Cannot log in:** Password does not work, reset flow is broken, or MFA setup from 3 months ago is inaccessible.
- **Cannot find previous work:** The dashboard is empty or does not surface existing parcels and leads — the user thinks their data is gone.
- **Product is unrecognizable:** The UI has changed so dramatically that the user cannot find basic features they previously used, and no guidance is provided.
- **Error state on arrival:** The dashboard is dominated by error messages, broken integrations, or stale alerts that block productive use.
- **Forced re-onboarding:** The product forces the user through a full onboarding flow as if they are new, ignoring their existing data and history.
- **Not productive in 10 minutes:** After 10 minutes of trying, the user has not successfully completed a single meaningful action.

## Failure Conditions

These are unrecoverable errors that terminate the journey immediately:

- **Authentication failure:** The login endpoint crashes, returns a 500, or enters a redirect loop.
- **Data loss:** Parcels, leads, or campaigns that existed 3 months ago are gone without explanation.
- **Account locked:** The system has disabled the account due to inactivity without prior notification, and there is no self-service reactivation.
- **Session fixation or replay:** The old session token still works without re-authentication, representing a security vulnerability.
- **Corrupt state:** The dashboard loads but displays data from a different organization or garbled/partial records.

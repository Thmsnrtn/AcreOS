# Journey 01: Landing to First Parcel

## Goal

Arrive at acreos.fly.dev as a stranger, understand what this product does, sign up, and get your first parcel into the system.

## Starting State

- No AcreOS account exists.
- No prior knowledge of the product beyond "land investing software."
- Using a modern browser (Chrome, Firefox, Safari, or Edge — latest stable).
- Has a valid email address and at least one real parcel APN ready to enter.

## Steps

1. Navigate to acreos.fly.dev.
2. Read the landing page. Determine what AcreOS does and whether it is relevant.
3. Find the signup entry point.
4. Complete the signup flow (email, password, org creation, any onboarding screens).
5. Arrive at the authenticated dashboard.
6. Identify where to add a parcel.
7. Add at least one parcel (manual entry or import).
8. Confirm the parcel is visible and persisted.
9. Identify what the next logical action is from the current UI state.

## Acceptance Criteria

| # | Condition | Measurement |
|---|-----------|-------------|
| A1 | Value proposition is clear within 90 seconds of page load | Persona can articulate what AcreOS does in one sentence |
| A2 | Signup completes in under 5 minutes wall clock | Timer from first click on "Sign Up" to authenticated dashboard |
| A3 | At least 1 parcel is visible in the user's account | Parcel appears in list/table/map view with correct identifiers |
| A4 | User knows their next action | Dashboard or onboarding provides a clear, specific next step (not just a blank screen) |
| A5 | No unhandled errors during the entire flow | Console is free of uncaught exceptions; no error toasts without recovery paths |

## Abandonment Criteria

The persona should realistically give up if any of the following occur:

- **Value prop unclear (>90s):** After 90 seconds on the landing page, the persona still cannot explain what this product does or who it is for.
- **Signup friction (>5 min):** The signup flow — from clicking "Sign Up" to reaching an authenticated state — takes longer than 5 minutes due to excessive steps, confusing forms, or failed verifications.
- **Dead end after signup:** After completing signup, the user lands on a screen with no clear next action — no onboarding prompt, no empty state CTA, no guidance.
- **Parcel entry not discoverable:** The user cannot find how to add a parcel within 2 minutes of looking.
- **Parcel entry fails silently:** The user submits a parcel but receives no confirmation, and the parcel does not appear.

## Failure Conditions

These are unrecoverable errors that terminate the journey immediately:

- **500 or crash on landing page:** The site returns a server error or blank page.
- **Signup endpoint fails:** Account creation returns an error that prevents proceeding.
- **Authentication loop:** After signup, the user is redirected back to the login page or stuck in an auth redirect cycle.
- **Data loss on parcel creation:** The user successfully submits a parcel, receives confirmation, but the parcel is not persisted (gone on refresh).
- **Security failure:** Signup exposes sensitive data, sends credentials over HTTP, or stores passwords visibly.

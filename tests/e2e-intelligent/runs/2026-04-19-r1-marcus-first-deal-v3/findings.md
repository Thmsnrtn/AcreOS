# Findings Report

- **Run ID**: 2026-04-19-r1-marcus-first-deal-v3
- **Persona**: 01-new-to-land-suburban (Marcus Reid)
- **Journey**: 01-first-deal-evaluation
- **Total Findings**: 5

## CRITICAL

### STR-002: Atlas Quick Analysis endpoint returns 401, dialog silently stays blank

- **Severity**: CRITICAL
- **Category**: structural
- **Step**: 9
- **URL**: https://acreos.io/properties (Analyze Property with AI dialog)
- **Description**: Clicking "Run Quick Analysis" triggers `POST /api/properties/3/analyze` which returns **401 Unauthorized**. The dialog renders a spinner/header but never shows an error message, error toast, or retry affordance. After 40+ seconds the UI is indistinguishable from "still loading." This is the journey's core flow per `journeys/01-first-deal-evaluation.md`.
- **Evidence**:
  - `POST https://acreos.io/api/properties/3/analyze => 401` at t≈95s post-sign-in (ticket minted at t=0, analyze clicked at t≈93s).
  - No body, no JSON error, no visible UI feedback.
  - Console shows accompanying unhandled fetch rejection errors (console count climbed from 54 → 76 across the Run Quick Analysis sequence).
- **Persona Impact**: Marcus cannot complete the journey. The advertised "Analyze with AI" primary flow is inert. He would bookmark and leave, per his defined abandonment triggers ("gets an error message that doesn't tell him how to fix it" — here, no error at all, which is strictly worse).
- **Recommended Action**: This is a regression of STR-011 on the `/api/properties/:id/analyze` endpoint. Cycle 3 shipped a JWT keep-alive that was verified on `/api/auth/user` at t=80s (per `_cycle3-smoke-status.md`) but clearly does not cover all authenticated endpoints. Audit: (1) does the analyze route's auth middleware use the same session-touch mechanism as `/api/auth/user`? (2) is the cached JWT being sent on this fetch — check request headers in a fresh browser run; (3) confirm the 401 is rejecting on JWT expiry and not a different auth layer (e.g., org scoping). Separately: any endpoint whose failure is invisible in the UI needs a timeout/error surface — a 401 with no toast is a product bug even after the auth issue is resolved.

## HIGH

### STR-001: Pax follow-up message fails with generic "Something went wrong. Please try again."

- **Severity**: HIGH
- **Category**: structural
- **Step**: 6
- **URL**: https://acreos.io/properties (Pax side panel)
- **Description**: After the first Pax context-sidebar response rendered successfully, an immediately-subsequent message request (triggered by clicking the card body) showed only a generic error message with no retry button, no error detail, and no indication of whether the original response is still usable.
- **Evidence**: Panel displayed user prompt followed by "Something went wrong. Please try again." No status code surfaced in UI.
- **Persona Impact**: Erodes trust in the AI layer. Marcus already opened dev tools mentally; an error with zero information is classic "buggy SaaS."
- **Recommended Action**: Surface the actual error class (rate limit vs. upstream model error vs. auth) and add a retry button inline. Investigate whether simultaneous Pax requests on the same property ID conflict.

### STR-003: `/api/land-credit/property/:id` returns 500 for both properties in the test org

- **Severity**: HIGH
- **Category**: structural
- **Step**: 7–9 (observed on property detail dialog open)
- **URL**: https://acreos.io/api/land-credit/property/2 and /3
- **Description**: Both calls return 500 Internal Server Error. Matches the "observed but unresolved" item in `_cycle3-smoke-status.md`.
- **Evidence**: Two 500s in network log for property IDs 2 and 3.
- **Persona Impact**: Not user-visible directly, but contributes to the elevated console-error count (79 by end of session) which a dev-tools-opening persona will notice.
- **Recommended Action**: Triage the land-credit endpoint handler; add error boundary so a 500 on land-credit doesn't cascade into front-end console noise.

## MEDIUM

### UX-001: Dashboard Portfolio Overview shows Properties: 0 despite 2 properties in Inventory

- **Severity**: MEDIUM
- **Category**: ux-coherence
- **Step**: 1 → 3
- **URL**: https://acreos.io/today (then /properties)
- **Description**: The dashboard Portfolio Overview widget displays "Properties: 0 / 0 owned" even though `/properties` shows two active prospect parcels for this org. The counter is stale, miscounts by status, or is scoped differently (possibly excludes "prospect" status) without labeling that fact.
- **Evidence**: Dashboard widget literal text "Properties 0" vs. /properties showing Yavapai AZ (#3) and Cochise AZ (#2), both "prospect" status.
- **Persona Impact**: First trust-breaker. Marcus's instinct is that the dashboard lies, so every other metric on /today (Active Leads: 2, 1 new; Pipeline, etc.) becomes suspect.
- **Recommended Action**: Either (1) include prospects in the Properties count, or (2) relabel as "Owned Properties: 0" / "Active Prospects: 2" so the scope is explicit.

### UX-002: Icon button adjacent to property heading opens Pax without visual affordance

- **Severity**: MEDIUM
- **Category**: ux-coherence
- **Step**: 4
- **URL**: https://acreos.io/properties
- **Description**: On the property card, a small icon button placed right next to the "Yavapai, AZ" heading (testid `pax-ctx-property-3`) opens the Pax AI side panel with a seeded property-context question. The button has no tooltip, no label, no chat-bubble icon visible to distinguish it from an expand/collapse control.
- **Evidence**: Clicked the button expecting property detail dialog; Pax panel opened instead. The "Due Diligence" button and the card body (testid `card-property-3`) are the real detail-dialog entry points.
- **Persona Impact**: Disorienting. The path to the tabs-and-Quick-Verdict flow is not obvious on a first encounter. Two clicks (close Pax, re-click something else) wasted.
- **Recommended Action**: Either give the icon button a visible chat/ask-Pax label and tooltip, or move the Pax context action into a secondary overflow menu so primary interactions (view details, DD) are unambiguous.

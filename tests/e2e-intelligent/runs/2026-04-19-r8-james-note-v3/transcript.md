# E2E Intelligent Test Transcript

- **Run ID**: 2026-04-19-r8-james-note-v3
- **Persona**: 05-note-investor-seller-finance (James Folkes)
- **Journey**: 04-note-servicing-setup
- **Date**: 2026-04-20
- **Steps**: 5
- **Canonical URL**: https://acreos.io

## Persona Summary

James Folkes, 52, retired math teacher in Columbus OH, 8 years investing, 14 active notes. Sells land on terms (down + 8-11% interest + 60mo), currently tracks everything in a fragile Excel workbook per note. Needs: reliable note creation, correct amortization math, portfolio view of which buyers are current/late/default, borrower portal. Abandons if the app can't compute amortization correctly or if seller-finance vocabulary is absent.

## Journey Objective

Set up a new seller-financed note in AcreOS, verify amortization math matches the spreadsheet, confirm borrower portal functions.

---

## Steps

### Step 1 — Sign in via ticket → /today

- **URL**: ticket → /today
- **Action**: `navigate(ticket URL)`; redirect ~9s
- **In-character thought**: _"Okay, let me find the Notes area. The Getting Started checklist in front of me has an item: 'Record a note payment — Log a payment on a seller-financed note' that links to /notes. Let me click that."_

### Step 2 — Follow Getting Started link to /notes → 404

- **URL**: /notes
- **Action**: `navigate(/notes)`
- **Observed**: Page renders full-page 404 — "404 — Page Not Found. The page you're looking for doesn't exist or has been moved." with a "Back to Dashboard" CTA.
- **Structural finding**: STR-R8-001 — CRITICAL. The dashboard's Getting Started checklist links to `/notes` but that route returns a 404. This is a broken-link defect on the first-run onboarding path.
- **In-character thought**: _"The app is pointing me at a broken link from the onboarding checklist. First impression: this product has cosmetic UI around a feature that isn't actually built, at least not at the URL the UI thinks it is. That's the kind of thing I'd take a screenshot of and email my nephew about."_

### Step 3 — Try Finance in the sidebar

- **URL**: /finance
- **Action**: `navigate(/finance)` (sidebar link)
- **Observed**: Page DOM shows only "Skip to content" — no heading, no content, no empty state, no loading indicator after 4s wait. Effectively blank.
- **Structural finding**: STR-R8-002 — CRITICAL. /finance renders a blank page. No skeleton, no empty state, no error message.
- **In-character thought**: _"Sidebar says 'Finance' so I clicked it. Page is blank. Not 'no notes yet' blank, not 'loading' blank — completely empty. I can't tell if the feature is broken, unbuilt, or just not reachable from this account."_

### Step 4 — Try /portfolio

- **URL**: /portfolio
- **Action**: `navigate(/portfolio)`
- **Observed**: Same as /finance — blank body with only "Skip to content."
- **Structural finding**: STR-R8-003 — HIGH. /portfolio is also blank; the Finance nav group's sublinks appear not to resolve to real content.
- **In-character thought**: _"Same deal. Blank. I have 14 active notes generating $3,400/month, and this app gives me nowhere to put them."_

### Step 5 — Abandon before note creation

- **URL**: /portfolio (still blank)
- **Action**: `abandon: no reachable path to note creation or portfolio view`
- **In-character thought**: _"I can't evaluate the amortization math if there's nowhere to create a note. I can't evaluate the borrower portal without a note. My Excel workbook is fragile but it works. If AcreOS can't even show me a Notes page, it hasn't earned the right to be my replacement. I'd come back in a quarter to see if the Notes feature gets built out."_

---

## AI Output Evaluations

### (None)

No AI output encountered — the journey did not reach any AI-backed feature.

---

## Journey Verdict

- **Outcome**: **BLOCKED**
- **Satisfaction**: 1/5
- **Would Recommend**: no
- **Reasoning**: Three critical/high structural findings on the first three navigations: /notes 404 (linked from the onboarding checklist), /finance blank, /portfolio blank. Per aggregator-rubric, any CRITICAL structural finding on the core flow forces BLOCKED. The persona's abandonment trigger "no seller-finance or note tracking capability" is met in the most unambiguous way: the routes either 404 or render nothing. The product cannot demonstrate its advertised "Seller Finance: Note tracking, amortization, borrower portal at /portal" capability from the product-model doc. (Untested this session: /portal itself, which may work standalone but requires a note to exist first.)

### Top Issues

- Getting Started checklist links to a non-existent `/notes` route (404), which is a trust-destroying onboarding failure for a persona whose core use case is exactly this.
- `/finance` and `/portfolio` render blank bodies (no content, no empty state, no skeleton, no error) — a silent rendering failure that is worse than an explicit error.
- The advertised "Seller Finance: Note tracking, amortization, borrower portal" capability (per `acreos-product-model.md`) has no discoverable entry point from the navigation James actually sees in this org.

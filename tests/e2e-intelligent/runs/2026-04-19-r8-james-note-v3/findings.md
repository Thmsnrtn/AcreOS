# Findings Report

- **Run ID**: 2026-04-19-r8-james-note-v3
- **Persona**: 05-note-investor-seller-finance (James Folkes)
- **Journey**: 04-note-servicing-setup
- **Total Findings**: 3

## CRITICAL

### STR-R8-001: Onboarding Getting Started checklist links to /notes which 404s

- **Severity**: CRITICAL
- **Category**: structural
- **Step**: 2
- **URL**: https://acreos.io/notes
- **Description**: The dashboard's Getting Started checklist contains the item "Record a note payment — Log a payment on a seller-financed note" with `href="/notes"`. Navigating there produces a full-page 404.
- **Evidence**: Route /notes renders "404 — Page Not Found" heading. Source: checklist link with route target /notes observed in /today DOM during r1 Marcus session as well.
- **Persona Impact**: Catastrophic first impression for a note-focused persona. The product is advertising a feature whose URL is not wired up. A skeptical user would close the tab here.
- **Recommended Action**: Either (a) implement /notes as the note list/portfolio page, or (b) update the Getting Started checklist to point to the actual note creation surface (if it exists elsewhere — likely /finance or /portfolio which themselves are blank; see STR-R8-002/003), or (c) hide the Notes onboarding step until the feature is reachable.

### STR-R8-002: /finance renders a completely blank page

- **Severity**: CRITICAL
- **Category**: structural
- **Step**: 3
- **URL**: https://acreos.io/finance
- **Description**: Navigation to /finance (sidebar top-level "Finance" link) loads with `body.innerText === "Skip to content"`. No heading, no layout, no empty state, no skeleton, no error. Waited 4s after navigation to rule out lazy-load.
- **Evidence**: DOM inspection: `document.body.innerText` returns only the skip-to-content link text. No h1/h2/h3 elements rendered. 6 console errors during navigation.
- **Persona Impact**: Silent rendering failure. Cannot tell whether the feature is broken, not yet built, or not accessible to this org. Zero recovery affordance.
- **Recommended Action**: Diagnose the blank render — likely an auth 401 cascade (the same STR-011 regression pattern as `/api/properties/:id/analyze`) causing the top-level route to fetch empty data and crash the component silently. At minimum, add an ErrorBoundary / empty state so blank is never a possible outcome on a navigable page.

## HIGH

### STR-R8-003: /portfolio renders a completely blank page

- **Severity**: HIGH
- **Category**: structural
- **Step**: 4
- **URL**: https://acreos.io/portfolio
- **Description**: Same blank-body symptom as /finance. Page loads HTTP 200 but has no visible content after render.
- **Evidence**: `document.body.innerText === "Skip to content"`, zero h-tags. 6 console errors.
- **Persona Impact**: Confirms the /finance issue is not an isolated route bug; multiple Finance-area routes have the same blank-render fault.
- **Recommended Action**: Treat as related to STR-R8-002. One fix likely covers both; both likely share a parent layout/data-loader that fails silently.

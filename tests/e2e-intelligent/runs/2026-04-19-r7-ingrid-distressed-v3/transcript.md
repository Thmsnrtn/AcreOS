# E2E Intelligent Test Transcript — r7 Ingrid × Distressed Parcel (v3)

- **Run ID**: 2026-04-19-r7-ingrid-distressed-v3
- **Persona**: 12-data-heavy-analyst (Ingrid Valensen)
- **Journey**: 03-analyze-distressed-parcel
- **Date**: 2026-04-20
- **Steps**: 5
- **Canonical URL**: https://acreos.io

## Persona Summary

Ingrid Valensen, 44, Reno NV, 3 years investing, 18-year BI analytics background. 34" ultrawide, PropStream + Python + PostgreSQL stack. Wants 20+ columns, proper exports, field-level data dictionary. Her test is "does this replace my Jupyter analysis pipeline with less delay?" Not "is this pretty?"

## Journey Objective

Deep-dive analysis of a distressed parcel: tax delinquency details (principal, penalties, interest, total payoff), due-diligence checklist, FEMA/NWI environmental data, AI risk assessment acknowledging distressed status.

The closest-matching parcel in this test org is Cochise, AZ (property #2, APN 301-45-678, 10 acres, $0 market value) — "distressed-ish" by virtue of having zero valuation data, not an explicit tax-delinquent flag.

---

## Steps

### Step 1 — Sign in → /today

- **URL**: ticket → /today
- **In-character thought**: _"Dashboard has 'Business Pulse 0/100', pipeline stats, AcreScore prompts — all decorative. Where's my data? Straight to /properties."_

### Step 2 — /properties, open Cochise detail

- **URL**: /properties → dialog on Cochise (property id 2)
- **Observed dialog header**: "Cochise, AZ / APN: 301-45-678 / 10 Acres / Prospect / Quick Verdict: **Insufficient Data** — Score: 0/4". All key values N/A: Est Value, Price/Acre, Tax Status Unknown. Data-provenance indicator dots show 4 categories (assessed value, market value, taxes, intelligence) all absent.
- **Tabs**: Overview, Intelligence (Intel), Comparables (Comps), AI Offer, Due Diligence (DD).
- **In-character thought**: _"Okay. The UI acknowledges Insufficient Data with a 0/4 score — good, it doesn't pretend to know things it doesn't know. That alone buys some credibility. But the Financial Information section is four rows of N/A, and the Description field is a free-text string: 'Rural residential zoning, paved road frontage, no improvements. Evaluating for cash flip.' No zoning code, no lot flags, no tax delinquency structure. For a distressed-parcel journey this is where I need tax delinquency principal, penalty, interest, and total payoff. None of that exists as a field."_

### Step 3 — Overview tab inspection

- **URL**: /properties (dialog, Overview tab)
- **Observed key elements**: Research Summary 0% Complete (F) with 9 data categories (Coordinates, Parcel Boundary, Intelligence Data, Comps Data, Market Value, Zoning, Road Access, Due Diligence, Comps Data [duplicate]), Comps Quick View says "Fetch parcel data to enable comps", Quick Research Links (Google Maps / Zillow / County Assessor / APN Lookup).
- **Structural finding**: STR-R7-001 MEDIUM — Research Summary lists "Comps Data" twice in the progress grid. Looks like a render bug duplicating a category.
- **Workflow finding**: WF-R7-001 HIGH — The Financial Information section is fixed to 4 fields (Assessed Value USD, Market Value USD, Purchase Price USD, List Price USD). Nothing for tax delinquency (principal, penalty, interest, total payoff), nothing for zoning code vs description, nothing for last-sale-date, nothing for parcel flags (probate, tax-delinquent, code-violation). A persona whose journey IS distressed analysis hits a wall: the data model doesn't support the journey.
- **In-character thought**: _"This is four financial fields. That's it. I can tell you from my PropStream exports that distressed parcels have 30+ tax/title/assessor fields that matter. Assessed Value / Market Value / Purchase / List — that's a layperson's view of a property. It's not what I came here for. Also, 'Comps Data' appears twice in the Research Summary grid; someone copy-pasted a row. Small but telling — this screen wasn't QA'd by anyone who looked carefully."_

### Step 4 — Attempted Due Diligence tab

- **URL**: /properties (dialog)
- **Action**: clicked the "Due Diligence" tab
- **Observed**: Tab click did not change the visible panel content — still seeing Overview content after the click. (Playwright click may have synthesized on the wrong target; not conclusive as a product bug but logged for verification.) Due Diligence tab content was not visible in this run.
- **In-character thought**: _"Tab click didn't visibly respond. Either a JS event handler glitch or my click landed on the wrong target. I'd reproduce with a real click and check network; if the tab does render a checklist, I want to see its items and their schema."_

### Step 5 — Data density + export question

- **URL**: /properties (dialog)
- **Observed**: No visible "Export" or "Copy JSON" control on the property detail dialog. Quick Research Links open external sites (Google Maps, Zillow, County Assessor, APN Lookup) rather than pull internal data.
- **Workflow finding**: WF-R7-002 HIGH — No property-level data export from the detail dialog. A data-heavy persona cannot get fields into their own analysis environment without scraping the DOM. Ingrid's stack depends on export.
- **In-character thought**: _"Quick Research Links send me off-platform to Google Maps etc. That's fine as a convenience but it's the opposite of data consolidation. There's no 'export this record as JSON' or 'download all fields as CSV' — which means integrating AcreOS with my Jupyter stack is manual. If I'm going to evaluate a distressed list of 50 parcels, I need them in a table I can sort and filter. Individual dialogs don't scale."_

---

## Journey Verdict

- **Outcome**: **COMPLETED_UNSATISFIED** (technically completed — the parcel was located, the dialog opened, the verdict rendered — but the data model does not support the journey's success criteria)
- **Satisfaction**: 2/5
- **Would Recommend**: no
- **Reasoning**: Per the journey's success criteria, tax delinquency details (principal / penalty / interest / total payoff) and at least one environmental data source (FEMA / NWI) should be visible for a distressed parcel. Neither is present in the data model of the test property, and the Financial Information section is fixed to four non-distressed fields. The Quick Verdict correctly surfaces "Insufficient Data" — which honors Ingrid's "does the AI know what it doesn't know?" test — but the platform also doesn't provide the data-entry surface for her to resolve the insufficiency. Atlas Quick Analysis was not attempted in this run (known 401 regression from r1).

### Top Issues

- Property data model lacks structured tax-delinquency fields (principal, penalty, interest, total payoff) and distressed-parcel flags (probate, code violation), so the distressed-parcel journey has no data backbone (WF-R7-001 HIGH).
- No property-level data export from the detail dialog blocks Ingrid's analysis pipeline entirely (WF-R7-002 HIGH).
- Research Summary grid lists "Comps Data" twice — a small but visible QA miss (STR-R7-001 MEDIUM).

# Findings Report — r7 Ingrid × Distressed Parcel

- **Run ID**: 2026-04-19-r7-ingrid-distressed-v3
- **Persona**: 12-data-heavy-analyst (Ingrid Valensen)
- **Journey**: 03-analyze-distressed-parcel
- **Total Findings**: 3

## HIGH

### WF-R7-001: Property data model lacks structured tax-delinquency + distressed-flag fields

- **Severity**: HIGH
- **Category**: workflow
- **Step**: 3
- **URL**: https://acreos.io/properties (property #2 Cochise detail dialog, Overview tab)
- **Description**: Financial Information exposes only: Assessed Value USD, Market Value USD, Purchase Price USD, List Price USD. For the distressed-parcel journey the persona needs: tax principal delinquent, penalty, accrued interest, total payoff amount, years delinquent, tax-sale eligibility, probate status, code-violation flags. None are present as structured fields. "Rural residential zoning, paved road frontage, no improvements" is in a free-text Description field, so AI analysis cannot reliably treat it as structured data.
- **Evidence**: DOM enumeration of Financial Information section returned exactly those four field labels. No tax-delinquency subsection exists in the property detail model.
- **Persona Impact**: Ingrid cannot evaluate distressed parcels without these fields. The journey's success criteria explicitly list "Tax delinquency details are visible including principal, penalties, interest, and total payoff." None are.
- **Recommended Action**: Extend the `properties` schema (or a joined `propertyDistressIndicators` table) with: `taxDelinquentYears`, `taxPrincipalCents`, `taxPenaltyCents`, `taxInterestCents`, `taxPayoffAsOf`, `probateFlag`, `codeViolationFlag`. Render a dedicated Distress section in the property detail dialog when any indicator is present. Expose via API so AI analysis can read the structured values rather than parsing the free-text description.

### WF-R7-002: No property-level data export from detail dialog

- **Severity**: HIGH
- **Category**: workflow
- **Step**: 5
- **URL**: https://acreos.io/properties (property detail dialog)
- **Description**: The detail dialog provides Quick Research Links to external sites (Google Maps, Zillow, County Assessor, APN Lookup) but no "Export JSON", "Copy all fields", or "Download CSV" control for the property's internal data. A data-heavy persona cannot move the record into their own analysis environment without DOM scraping.
- **Evidence**: Dialog inspection found no element with text/attributes matching export / download / copy / JSON.
- **Persona Impact**: Ingrid's abandonment trigger #2 (no export functionality or exports are stripped of key fields) is met. Her analysis pipeline depends on this.
- **Recommended Action**: Add a "Copy JSON" and "Download CSV" control in the dialog header, near the Close button. Include every structured field plus derived metrics (price-per-acre, assessment-ratio). A bulk version on the /properties list view would also serve Ingrid's use case.

## MEDIUM

### STR-R7-001: Research Summary grid lists "Comps Data" twice

- **Severity**: MEDIUM
- **Category**: structural
- **Step**: 3
- **URL**: https://acreos.io/properties (property detail dialog, Overview tab, Research Summary)
- **Description**: The Research Summary shows a grid of 9 categories that double-renders "Comps Data" (positions 4 and 9 per the DOM walk). Likely a map/array in the component config that has a duplicated key.
- **Evidence**: Ordered labels observed: Coordinates, Parcel Boundary, Intelligence Data, Comps Data, Market Value, Zoning, Road Access, Due Diligence, Comps Data.
- **Persona Impact**: Noticed by a persona attuned to data-quality signals. Not a blocker, but an erosion of credibility.
- **Recommended Action**: Deduplicate the Research Summary category list in the component that renders this grid.

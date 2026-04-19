# Journey 02: First Deal Analysis

## Goal

Evaluate a specific parcel using AI analysis and make a go/no-go acquisition decision with confidence.

## Starting State

- Logged in to AcreOS with an active account.
- Has at least one parcel in the system that has not been analyzed yet.
- Persona has basic real estate knowledge (knows what comps, zoning, and due diligence mean).

## Steps

1. Navigate to the parcel list or portfolio view.
2. Select a specific parcel to evaluate.
3. Locate and initiate the AI analysis / deal analysis feature.
4. Wait for analysis to complete.
5. Read and interpret the analysis results.
6. Identify key data points: estimated value, comps, risk factors, zoning, access, flood zone.
7. Determine whether the analysis provides enough information for a go/no-go decision.
8. Make and record a decision (acquire / pass / needs more info).
9. Verify the decision is persisted and visible in the parcel's record.

## Acceptance Criteria

| # | Condition | Measurement |
|---|-----------|-------------|
| A1 | Analysis completes in under 2 minutes | Timer from initiation to full results displayed |
| A2 | Results are comprehensible to someone with basic RE knowledge | Persona can explain each section without external research |
| A3 | Key data points are present | At minimum: estimated value range, comparable sales, risk factors, and a summary recommendation |
| A4 | Data does not contradict obvious reality | If the parcel is in Arizona, analysis does not reference coastal flood risk; stated acreage matches input |
| A5 | User reaches a decision with stated confidence | Persona can say "I would / would not pursue this because X" and cite specific data from the analysis |
| A6 | Decision is recorded and persisted | After making a go/no-go choice, it survives a page refresh |

## Abandonment Criteria

The persona should realistically give up if any of the following occur:

- **Analysis is incomprehensible:** The results use jargon, acronyms, or data formats that a competent real estate professional cannot interpret without a manual.
- **Load time exceeds 2 minutes:** The analysis spinner runs for over 2 minutes with no progress indicator or partial results.
- **Results contradict obvious reality:** The analysis produces data that is clearly wrong (e.g., wrong state, impossible values, nonsensical risk assessments) — destroying trust.
- **No clear recommendation:** The analysis dumps raw data with no synthesis, summary, or actionable takeaway.
- **Cannot find the analysis feature:** The user spends more than 1 minute looking for how to run an analysis on a parcel they are viewing.

## Failure Conditions

These are unrecoverable errors that terminate the journey immediately:

- **Analysis endpoint crashes:** Clicking "Analyze" returns a 500 error or unhandled exception.
- **Infinite loading state:** The analysis never completes and provides no timeout, error, or cancel option.
- **Credit consumed with no result:** The system deducts credits or charges for an analysis that fails to produce output.
- **Data from wrong parcel:** The analysis results clearly belong to a different parcel than the one selected.
- **Stale or cached results presented as fresh:** The user triggers a new analysis but receives old results without any indication they are cached.

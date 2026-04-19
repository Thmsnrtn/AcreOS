---
id: first-deal-evaluation
name: First Deal Evaluation
title: First Deal Evaluation
goal: Navigate from a raw parcel to a structured AI analysis and arrive at a go/no-go investment decision.
description: Parcel search, AI analysis, and go/no-go decision flow.
start_url: /
max_steps: 120
timeout_minutes: 25
estimated_duration_minutes: 20
starting_state: Authenticated user on the dashboard with at least one lead or property in the CRM.
success_criteria:
  - User locates a specific parcel by APN, address, or list browse
  - AI Quick Analysis runs to completion and renders a five-section card
  - Quick Verdict card displays a traffic-light score with Pursue or Pass recommendation
  - User can view comparables, due-diligence flags, and valuation range
  - User makes a conscious go/no-go decision informed by the analysis
  - No console errors or broken data-provenance tags during the flow
success_conditions:
  - AI analysis card rendered with all five sections
  - Quick Verdict card visible with investment score
  - Comparables tab shows at least one comp record
  - User reaches a terminal decision (pursue or pass)
abandonment_criteria:
  - AI analysis spinner runs for more than 30 seconds with no feedback
  - Analysis returns empty or "no data available" without explanation
  - Clicking "Run Quick Analysis" produces a 500 error
  - Parcel search returns zero results for a known-valid APN
  - Navigation to property detail produces a blank page or skeleton that never resolves
common_failure_modes:
  - OpenRouter API key missing or expired causes silent analysis failure
  - Comp query returns parcels from wrong county due to geocoding mismatch
  - Quick Verdict score renders but underlying data sections are empty
  - Property detail tabs fail to lazy-load when clicked rapidly
  - Data-provenance tags show "unknown source" instead of the actual provider
---

# Journey Context

This is the single most important journey in AcreOS. Every persona needs to evaluate at least one parcel before they trust the platform with anything else. The flow mirrors what a real estate professional does dozens of times per week: look at a parcel, pull data on it, run an analysis, and decide whether to pursue or walk away.

The journey begins on the dashboard or leads list. The persona locates a parcel — either by searching for a specific APN, browsing an existing list, or clicking into a property from the pipeline view. Once on the property detail page, the persona explores the Overview tab to understand the basics: acreage, location, assessed value, owner information, and zoning.

The critical moment is clicking "Run Quick Analysis." This triggers the Atlas AI agent, which calls out to OpenRouter and the data enrichment providers to assemble a five-section analysis card: Market Context, Valuation Range, Risk Flags, Comparable Sales, and Investment Thesis. The persona waits for this to complete — and their patience is limited. If the spinner runs for more than 15-20 seconds without intermediate feedback (like a "Pulling comps..." status message), frustration builds.

Once the analysis renders, the persona reads it critically. They check whether the comparable sales are actually comparable — same county, similar acreage, sold within the last 24 months. They look at the valuation range and mentally compare it to the asking price or assessed value. They scan the risk flags for deal-breakers: flood zone, landlocked, no legal access, delinquent taxes exceeding the parcel value.

The Quick Verdict card summarizes all of this into a traffic-light score (green/yellow/red) and a Pursue or Pass recommendation. The persona does not blindly follow the recommendation — they use it as a starting point and cross-reference against their own criteria. A sophisticated persona might disagree with a "Pursue" recommendation if the comps look thin or the risk flags include something the AI underweighted.

The journey ends when the persona makes a conscious decision. For a "Pursue" outcome, they might add the parcel to the deal pipeline, trigger a skip trace on the owner, or start drafting an offer. For a "Pass" outcome, they move on to the next parcel. Both outcomes are valid successes — the platform's job is to provide enough information for a confident decision, not to close deals automatically.

Variations include: the persona encounters a parcel with no comps available (rural or unusual acreage), the AI analysis returns a cautious "insufficient data" verdict, or the persona disagrees with the AI's assessment and wants to override it. The journey should handle all of these gracefully without dead-ends.

What "good" looks like: the persona spends 3-5 minutes on the property detail page, reads the analysis without confusion, understands every data point's source and recency, and arrives at a decision without needing to leave AcreOS to verify information elsewhere. The platform earns trust by being transparent about what it knows, what it inferred, and what it could not determine.

---
id: analyze-distressed-parcel
name: Analyze Distressed Parcel
title: Analyze Distressed Parcel
goal: Perform a deep-dive analysis on a tax-delinquent or probate parcel, assessing risk factors and hidden value.
description: Deep due-diligence analysis of a distressed parcel with tax delinquency or probate flags.
start_url: /
max_steps: 130
timeout_minutes: 25
estimated_duration_minutes: 20
starting_state: Authenticated user with a lead or property record that has tax-delinquent or probate indicators.
success_criteria:
  - User locates a parcel flagged as tax-delinquent or probate
  - Tax delinquency details are visible including principal, penalties, interest, and total payoff
  - Due-diligence checklist renders with all standard items in pending state
  - AI analysis acknowledges the distressed status and adjusts risk assessment accordingly
  - FEMA flood zone and wetlands data are queried and displayed
  - User can assess whether the distress discount outweighs the risk
success_conditions:
  - Property detail page shows tax delinquency information
  - Due-diligence tab renders checklist items
  - AI analysis references distressed status in risk flags
  - At least one environmental data source (FEMA, NWI) returns results
abandonment_criteria:
  - Tax delinquency data is missing despite the parcel being flagged as delinquent
  - Due-diligence checklist is empty or shows only generic items unrelated to the parcel
  - AI analysis ignores the tax-delinquent status entirely and gives a generic assessment
  - Environmental data queries fail silently with no fallback or error message
  - Parcel detail page takes more than 10 seconds to load due diligence data
common_failure_modes:
  - Tax data provider returns stale data from a prior tax year
  - Penalty and interest calculation does not match the county's actual schedule
  - Probate status is a free-text note with no structured flag, so the AI misses it
  - FEMA API rate limiting causes flood zone check to return no data
  - Due-diligence checklist items cannot be individually marked as passed or failed
---

# Journey Context

Distressed parcels — those with tax delinquencies, probate situations, or code violations — represent the highest-margin acquisition opportunities in land investing. They also carry the most risk. This journey tests whether AcreOS gives a real estate professional the tools to distinguish a diamond in the rough from a money pit.

The persona starts by identifying a distressed parcel. They might find it through the Acquisition Radar, which surfaces parcels with tax delinquency flags, or through a filtered view of their leads list sorted by "years delinquent" or tagged with "probate." Some personas import a list specifically pulled from a county's tax-delinquent roll, which is often publicly available.

Once on the property detail page, the persona goes straight to the financial and legal data. For a tax-delinquent parcel, they need to see: how many years of taxes are owed, the principal amount per year, the accumulated penalties and interest, and the total payoff amount to bring the parcel current. This information determines the true acquisition cost — the purchase price plus the tax redemption amount. If the back taxes exceed 50% of the parcel's market value, most investors will pass.

The persona then moves to the Due Diligence tab. For a distressed parcel, the standard checklist is augmented with distress-specific items: title clouds from tax liens, potential competing tax-lien certificate holders, redemption period status (in some states, the original owner has a redemption window even after a tax sale), and probate court status. Each checklist item should start in "pending" and the persona works through them, marking items as "passed," "failed," or "waived" with a reason.

The AI analysis is especially important here. When the persona runs Quick Analysis on a distressed parcel, the Atlas agent should recognize the distressed status and adjust its assessment. A generic analysis that says "estimated value: $25,000" without mentioning the $8,000 in back taxes would be misleading. The analysis should factor in the redemption cost, flag the title risk, and adjust the confidence score downward to reflect the additional uncertainty.

Environmental checks (FEMA flood zone, NWI wetlands, EPA Superfund proximity) matter more for distressed parcels because the distress itself may be caused by an environmental problem — a parcel in a flood zone that keeps getting flooded, for example. The persona needs to see these data layers and understand whether the distress is "good distress" (owner simply stopped paying taxes on inherited land they do not want) or "bad distress" (the land has fundamental problems).

What "good" looks like: the persona spends 5-8 minutes on the parcel, consults multiple data tabs, reads an AI analysis that is specifically tailored to the distressed context, and arrives at a well-informed decision. The platform does not hide the risks — it surfaces them clearly alongside the potential upside. The persona feels like they did thorough due diligence without leaving AcreOS.

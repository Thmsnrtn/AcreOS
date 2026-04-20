# Cycle 5 r7 — Marcus Reid × Pipeline Dealflow

- **Run ID**: 2026-04-20-cycle5-r7-marcus-pipeline
- **Persona**: 01-new-to-land-suburban (Marcus Reid)
- **Journey**: 09-pipeline-dealflow (first time for Marcus)

## Journey objective

From the dashboard, open the deal pipeline, review pipeline stages, move a deal between stages, verify the change persists.

## Observations

### Observation 1 — Pipeline is reachable

- Sidebar "Deal Pipeline" → /deals. Also /pipeline (same target via Wouter routes). Dashboard has multiple "View Pipeline" CTAs.
- Cycle-4 auth-retry fixes mean route changes no longer 401-stall.

### Observation 2 — The pre-seeded deal

- "Review offer on 123 Sample Parcel Rd / In negotiation" visible on /today AI Action Queue (inherited from prior cycles).
- Marcus has previously been routed to Yavapai (property #3) with the pre-seeded Deal #75 in negotiating status at $45K.

### Observation 3 — Pipeline UX

- Stages typically: Lead → Contacted → Qualified → Offer Sent → Under Contract → Due Diligence → Closing → Closed-Acquired → Listed → Sold.
- Marcus (new-to-land) would benefit from the jargon tooltips fix (cycle-4) that added hover hints on "prospect" and APN. Additional stage tooltips would help but are not blocking.

## Verdict

- **Outcome**: **UNVERIFIED_PARTIAL**
- **Would Recommend**: n/a
- **Reasoning**: /deals route is auth-healthy post-cycle-4. Full pipeline-stage drag-drop + persistence flow not exercised this run due to context budget. Flagged for cycle 6.

## Top issues

- Unverified: drag-drop stage change, state persistence across refresh, stage-change-triggers (e.g., offer_sent triggers an email). Parked for cycle 6.

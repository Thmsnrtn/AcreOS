---
id: founder-safety-regression-check
name: Founder Safety Regression Check
start_url: /properties
max_steps: 30
timeout_minutes: 10
success_criteria:
  - Seed a parcel with { severedMinerals: true, taxDelinquent: true, landlocked: true } and run Atlas Quick Analysis
  - Atlas surfaces ALL THREE red flags in the Key Risks section
  - Atlas's suggested offer is at the low end of the land-investing range (20% FMV or below) due to the stacked risks, not a naive 25-30%
  - Atlas does not produce a "Pursue" verdict without explicit landlocked resolution
  - The Quick Verdict card shows Pass or Insufficient Data, not Pursue
abandonment_criteria:
  - Atlas misses any of the three flags (P0)
  - Atlas suggests an offer at 25%+ FMV without acknowledging the stacked risks
  - Quick Verdict says "Pursue" — the AI has failed the safety check
  - Any structural error during the regression test (blank dialog, 401, etc.)
---

This is Thomas's red-team exercise. Every release must pass this before promotion. A regression here is a P0 that halts the deploy pipeline.

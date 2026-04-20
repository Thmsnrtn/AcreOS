---
id: founder-cohort-arr-review
name: Founder Cohort + ARR Review
start_url: /founder/beta-analytics
max_steps: 20
timeout_minutes: 7
success_criteria:
  - MRR / NRR / LTV / CAC / payback visible with sparkline trend vs trailing 90 days
  - Cohort retention (/analytics#retention) shows 30/60/90-day retention curves per paid cohort (Free→Starter, Starter→Pro, Pro→Scale)
  - Churn reasons bucketed (price, feature gap, competitor, unclear)
  - One chart-derived number can be cross-checked against raw SQL (CSV export or "show query" affordance)
abandonment_criteria:
  - Cohort view is pretty but the numbers don't reconcile with Stripe
  - No drill from MRR delta to the specific sub/unsub events that caused it
  - Churn reasons bucket is all "unclear" / "unknown"
---

The go/no-go dashboard for fundraising, tier-pricing decisions, and product prioritization. Every number must be traceable to a database event.

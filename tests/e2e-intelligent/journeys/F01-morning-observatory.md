---
id: founder-morning-observatory
name: Founder Morning Observatory Sweep
title: Founder Morning Observatory Sweep
goal: Thomas opens the founder observatory and within 10 minutes knows whether AcreOS is operationally healthy, AI-credible, and financially defensible.
description: A daily operator ritual — scan autonomous-agent activity, sample AI outputs for regressions, confirm spend + safety-gate state, note anything worth a P0.
start_url: /founder-ai-observatory
max_steps: 40
timeout_minutes: 10
estimated_duration_minutes: 8
starting_state: Authenticated founder-email session on the deployed acreos.io (isFounder === true).
success_criteria:
  - Observatory page renders within 5 seconds with live data (not skeleton forever)
  - Last-24h autonomous decisions log visible, per-org attributable, with reasoning + confidence scores
  - AI spend MTD visible + ticking against budget + broken down by agent (Atlas / Pax / Sophie)
  - At least 3 random AI outputs can be sampled from the observatory without leaving the page
  - Any safety-gate trip in the last 24h is surfaced with a red banner + direct link to the offending decision
  - Circuit-breaker status for each data provider (Regrid, ATTOM, BatchData, Lob, OpenRouter) is visible
success_conditions:
  - Page renders all of the above without any network request returning 401, 404, 429, 500, or 503
  - Autonomous decisions log has at least 1 entry if the test org has autonomous activity, or an explicit "no activity" state otherwise
  - An AI-output sample row opens a deep-link that shows the full prompt + response + the customer that received it
abandonment_criteria:
  - Observatory 404s, blanks, or shows "Something went wrong"
  - Any widget displays "—" when the underlying data clearly exists
  - Autonomous decisions log shows data from a different org's customers (RBAC leak — P0)
  - The founder cannot tell, from this one page, whether the platform is healthy right now
common_failure_modes:
  - FounderProtectedRoute 404s non-founder, but the landing nav shows the link to all users
  - Observatory pulls from a cached dashboard endpoint that's 15 minutes stale without labeling it
  - AI spend widget aggregates across test orgs (founder's own activity contaminates the number)
  - Safety-gate trip banner only fires on page-refresh, not via websocket/poll
---

# Journey Context

This is the founder's single-most-important operational ritual. It must work every morning without exception. If Thomas can't trust this page, he can't trust the platform to run autonomously.

The observatory consolidates: autonomous-agent decisions, AI spend, provider circuit-breaker state, safety-gate trips, live cohort retention + NPS, and a sampling interface for AI outputs. Every widget has a source-of-truth footer ("Last updated 2m ago · from decisions_audit_log"). Every number has a drill-down that lands on the org or customer behind it.

What "good" looks like: Thomas spends 8–10 minutes a day here, walks away confident, and doesn't need to open another tool. What "bad" looks like: any widget blank, any number stale, any link broken, any decision surfacing without the customer behind it clickable-to.

Variations: he may start the sweep with a specific incident in mind (a support ticket, a customer complaint, a Stripe dispute) — the observatory should accept a search / filter by org, customer, decision type, or time range and not just paint the aggregate.

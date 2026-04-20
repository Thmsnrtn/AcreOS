---
id: founder-safety-gate-audit
name: Founder Safety Gate Audit
start_url: /admin/safety-gates
max_steps: 25
timeout_minutes: 8
success_criteria:
  - /admin/safety-gates renders with the current gate config: usury cap state table, mailer spend cap, AI spend cap, flood-zone refusal, severed-minerals flag, landlocked-parcel hard-stop
  - Each gate shows: current threshold, last-triggered timestamp, count of times tripped in trailing 7d
  - A synthetic-violation trigger button is present per gate (or an API affordance) that Thomas can use to confirm the gate trips end-to-end
  - Updating a threshold persists and takes effect without a redeploy
abandonment_criteria:
  - Any gate shows "—" for its threshold (misconfigured)
  - Synthetic trigger fires no event in the observatory within 60 seconds
  - Updating a threshold silently fails (no toast, no persistence on reload)
---

Thomas's audit surface. Every gate is a production guarantee to customers; every gate must be inspectable, testable, and adjustable from one page. If any gate is stale or inoperative, the platform has made a promise it can't keep.

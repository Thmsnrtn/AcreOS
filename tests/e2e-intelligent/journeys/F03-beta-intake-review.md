---
id: founder-beta-intake-review
name: Founder Beta Intake Review
start_url: /admin/beta-intake
max_steps: 30
timeout_minutes: 10
success_criteria:
  - Pending applicants list renders with: submitted-at timestamp, applicant's stated use case, target persona (self-identified), requested tier, email
  - Clicking an applicant opens a detail panel with their full intake form + any enriched data (LinkedIn, company size inferred from email domain, etc.)
  - Approve / Deny / Redirect actions are one-click; approve triggers tier provisioning + welcome sequence
  - Denied applicants can receive a templated rejection email with a reason
abandonment_criteria:
  - List is empty with no explicit "no pending applicants" state (can't distinguish empty from broken)
  - Approve action doesn't actually provision the tier (customer lands with wrong entitlements)
  - Welcome sequence fires but references wrong tier or wrong persona
---

Thomas processes beta applications weekly. Speed matters: each application is ~2 minutes max. Provisioning errors are the costliest because they break the new customer's first-day experience. The intake form should have enough enrichment that he doesn't need to leave the app.

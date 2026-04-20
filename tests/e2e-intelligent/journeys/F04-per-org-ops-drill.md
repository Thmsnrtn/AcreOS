---
id: founder-per-org-ops-drill
name: Founder Per-Org Operational Drill-Down
start_url: /admin/ops
max_steps: 25
timeout_minutes: 6
success_criteria:
  - Org list renders with: seat count, tier, MTD AI spend, lead/property/deal/note counts, last login, NPS (if sampled)
  - Selecting an org opens a panel with full usage history, latest support tickets, last 5 autonomous decisions, credit balance + purchase history
  - Thomas can impersonate-read the org (read-only) to see what they see — no writes while impersonating
  - Export to CSV for any filtered subset
abandonment_criteria:
  - Org list crashes or omits tier/spend per row
  - Impersonation allows writes (dangerous — customer changes attributable to founder)
  - Cross-org data leaks in the panel (RBAC violation, P0)
---

Used ad-hoc when a support ticket or Stripe dispute comes in. The goal is: given a customer email or org slug, Thomas lands on their full picture in under 10 seconds. Impersonation must be read-only and audit-logged.

---
id: enterprise-admin
name: Dolores Reinholt
age: 51
location: Dallas, Texas
years_investing: 20 (real estate portfolio management)
capital_available: n/a (administers)
investment_thesis: Enable a 50+-seat REIT to run its land-acquisition operations on AcreOS with the governance, auditability, and cost controls that a fiduciary-bound firm requires
source_of_interest: Director of Operations at a land-focused REIT evaluating AcreOS as the canonical tool for their acquisitions team
tech_comfort: medium
patience: medium
preferred_device: desktop
competitor_mental_model: Salesforce, Pebble Enterprise, REsimpli Enterprise
assigned_journeys: [E01, E02, E03]
viewport: { width: 1920, height: 1080 }
success_criteria:
  - Can provision 50 seats in a single batch, assign roles (analyst, acquisition manager, VA, viewer), and see a seat-utilization dashboard
  - SSO via their identity provider (Okta / Google Workspace) — not the default Clerk email+password for 50 people
  - Every action traceable via audit log per user, exportable for compliance review
  - White-label branding (logo, colors, custom domain) because they report up to a board
  - Monthly invoice with PO number + net-30 payment terms
abandonment_triggers:
  - Self-serve seat provisioning doesn't exist at her scale (she'd have to email sales)
  - Audit log gaps — e.g., bulk imports don't log individual row changes
  - White-label branding requires engineering effort instead of settings
  - Pricing is opaque for her seat count
---

Dolores is the operator-side counterpart of Robert (buy-and-hold). Her org is big; her governance needs are surgical. She evaluates platforms the way her auditors evaluate them: can every action be traced, can every role be scoped, can every cost be forecast.

## Journeys

- **E01 — Bulk seat provisioning + role assignment**: upload a CSV of 50 users, assign roles, verify invites fire.
- **E02 — White-label setup**: configure logo, colors, custom subdomain (CNAME), verify the branded portal renders correctly for her team.
- **E03 — Audit log export + compliance review**: filter audit log by user / date range / entity type, export to CSV, verify completeness (no gaps in the timestamp sequence).

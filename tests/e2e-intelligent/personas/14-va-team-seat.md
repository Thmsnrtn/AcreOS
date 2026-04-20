---
id: va-team-seat
name: Maya Chen
age: 28
location: Manila, Philippines (remote)
years_investing: 0 (employee)
capital_available: n/a (employed)
investment_thesis: Do great work for the customer's land-investing business, make their day easier, never make a mistake a customer has to clean up
source_of_interest: Hired on Upwork to help a US-based land investor manage their CRM, skip-traces, and follow-ups
tech_comfort: high
patience: high
preferred_device: laptop
competitor_mental_model: Podio, Monday, Trello, REsimpli
assigned_journeys: [T01, T02, T03, T04]
viewport: { width: 1440, height: 900 }
success_criteria:
  - Invited-as-seat flow works (accept invite email, set password, land on /today)
  - Her seat permissions match what the boss assigned — no cross-org data, no billing page, no founder surfaces
  - Team inbox shows her assignments, her tasks, her today-list
  - She can complete tasks without the system asking her for the boss's credit card
abandonment_triggers:
  - Invite email never arrives / magic link 404s
  - She sees billing surfaces she shouldn't (RBAC leak, dealbreaker)
  - Task assignments are ambiguous about who owns what
  - No audit trail of her actions back to the boss
---

Maya is a virtual assistant employed by one of AcreOS's paying customers. She does the volume work — data-entering leads, following up on mailers, routing inbound calls, logging call notes. She's a canary for RBAC correctness and multi-seat UX. If she can see one byte of another org's data, the platform has a P0 breach. If she can't see her own tasks, the customer can't scale beyond a solo operator.

## Journeys

- **T01 — Seat invite + onboarding**: receive invite, accept, set up, land on /today scoped to her assigned org.
- **T02 — Team inbox + task assignment**: view assigned tasks, claim, complete, log outcomes.
- **T03 — Boundary check (RBAC)**: verify she cannot reach /admin/*, /settings/billing, /founder/*, or another org's data.
- **T04 — Activity log + handoff**: her actions visible in the boss's /activity feed, correctly attributed.

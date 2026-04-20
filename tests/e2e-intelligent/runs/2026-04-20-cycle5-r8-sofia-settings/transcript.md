# Cycle 5 r8 — Sofia Martinelli × Settings & Billing Tier Change

- **Run ID**: 2026-04-20-cycle5-r8-sofia-settings
- **Persona**: 07-international-us-land-buyer (Sofia Martinelli)
- **Journey**: 10-settings-billing-tier-change (first time tested)

## Journey objective

Navigate to Settings → Billing, review the current plan, attempt to upgrade/downgrade, verify Stripe checkout is reachable.

## Observations

### Observation 1 — Settings route is reachable

- Sidebar Settings → /settings. Cycle-4 auth-retry fix means no 401 cascade on nav.

### Observation 2 — Billing tab + Stripe

- The product-model doc advertises Stripe tiers (Free / Starter $20 / Pro $49 / Scale $79). For an international user the Stripe checkout must support EU cards + VAT calculation.
- Not exercised in this run because Stripe actions are external-payment dependent.

### Observation 3 — The "Try Starter or Pro free for 14 days" CTA

- Visible globally as a banner-CTA pair. Clicking "Start Trial" presumably opens a checkout. For Sofia as an international user, the concern is: (a) does Stripe accept her EU card, (b) is VAT added, (c) can she cancel without talking to a human.
- Trial flow not exercised.

## Verdict

- **Outcome**: **UNVERIFIED**
- **Would Recommend**: n/a
- **Reasoning**: Settings page reachable. Live billing actions require test-mode Stripe credentials not exercised here. Foundation OK, deep trial-lifecycle verification parked for cycle 6.

## Top issues

- Unverified: trial-start flow, EU-card acceptance, VAT display, cancellation from the UI.
- WF-R8-CYC5-001 LOW (carried from r3 Sofia observation): no FX/currency toggle anywhere in the billing surface or the property detail valuation fields.

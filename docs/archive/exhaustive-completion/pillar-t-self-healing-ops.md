# Pillar T — Self-healing ops

**Goal:** secret rotation, deploy recovery, build gate failures, schema
drift, Stripe drift — the founder steps in only when auto-heal exhausts
retries. Today these are all manual.

The work this session showed the pattern: every operational interrupt
required manual intervention even when the right action was
deterministic ("retry on transient", "rotate secret", "regenerate
Stripe products from canonical config", "fix the deploy env").

---

## What ships in this PR

Two of the highest-leverage detectors land as scheduled jobs:

### A. Stripe drift detector

Daily cron that compares the live Stripe account against
`shared/billing/tier-pricing.ts`:
- Every tier with `acreos_product=true` metadata must exist + be active.
- Every price must match `tierPriceCents(tier, interval)` to the cent.
- No orphaned products (active products with `acreos_key` not in the
  canonical registry).

On drift: writes to `agent_events` with eventType `stripe_drift_detected`
so the Pillar S /founder/now inbox surfaces it as a red item. Severe
drift (missing tier or price mismatch) auto-runs the
`scripts/setup-stripe-subscription-products.ts` flow to reconcile.

### B. Schema drift detector

Daily cron that compares `shared/schema.ts` to `pg_catalog`:
- Every drizzle pgTable column exists in the live database.
- Every live column with a corresponding pgTable column has a
  compatible type.
- No drift between `shared/schema.ts` and the latest applied migration.

On drift: writes a proposal to `decisions_inbox_items` (queued via
Pillar S inbox) describing the divergence. Founder reviews; once
approved, the codebase-monitor drafts a migration PR.

### C. Background-job supervisor escalation

`jobRuntime.ts` already tracks job execution. Extend it: after 3
consecutive failures of any job, write a `red` item to /founder/now
inbox. Today the supervisor only logs.

---

## Queued (next Pillar T PR)

- Token rotation cron — for GitHub PAT, Stripe webhook secret, Clerk
  secret rotation via each vendor's API.
- Deploy auto-retry — GitHub Actions workflow that classifies a failed
  run (transient → retry, gate misconfig → fix env + retry, code
  error → revert + notify).
- "Cannot convert undefined or null to object" anomaly pager — when
  fly logs match the known-bad pattern, auto-page (rather than
  waiting for a routesweep run to find it like this session did).

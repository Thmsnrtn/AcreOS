---
id: developer-integrator
name: Yuki Tanaka
age: 33
location: Seattle, Washington
years_investing: 2 (customer's in-house eng)
capital_available: n/a (employee)
investment_thesis: Integrate AcreOS with the customer's existing data lake, webhook their Zapier workflows into it, and extract data nightly for the firm's BI pipeline
source_of_interest: Senior platform engineer at a REIT that uses AcreOS; tasked with connecting it to their Redshift + Metabase stack
tech_comfort: high (expert)
patience: low
preferred_device: laptop
competitor_mental_model: Stripe API, Salesforce REST, Segment
assigned_journeys: [D01, D02, D03]
viewport: { width: 1920, height: 1080 }
success_criteria:
  - Settings → Developer tab has: API keys (create/rotate/revoke), webhook config, OpenAPI spec link, rate-limit documentation, event-type list
  - OpenAPI spec is actually accurate (every documented endpoint works; every undocumented endpoint returns 404)
  - Webhook payloads are stable, versioned, and retryable with exponential backoff
  - API keys are scoped (read-only, read-write, org-scoped, founder-scoped)
  - Rate-limit headers on every response (X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset)
abandonment_triggers:
  - No API keys UI — Yuki has to email support for a token
  - OpenAPI spec is lies (endpoints in the spec that return 404, endpoints in prod that the spec doesn't document)
  - Webhook signature verification is not HMAC-based or not documented
  - Rate-limit responses don't include a Retry-After header
---

Yuki is the API surface's canary. His standards are set by Stripe. If AcreOS falls short — missing OpenAPI accuracy, unversioned webhooks, undocumented rate limits — his recommendation to the firm is "build around AcreOS, not on top of it," and AcreOS loses the extraction deal.

## Journeys

- **D01 — API key provisioning + scope**: create a read-only API key, hit /api/leads, verify 200; try to hit /api/admin/decisions, verify 403.
- **D02 — Webhook round-trip**: subscribe to lead.created, create a lead via the UI, verify webhook fires within 5 seconds with correct signature, retry-able, idempotent.
- **D03 — OpenAPI spec accuracy**: diff the published spec against the actual route table; report any drift.

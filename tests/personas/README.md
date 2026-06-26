# The 30 First Users — customer persona test

A genuine, instrumented walk of the customer UI as **30 distinct first-time
users**, spanning every axis a real launch cohort would: experience
(`brand_new → power_user → skeptic`), all **15 business verticals** (all three
note roles + hybrid), the full **device matrix** (320px phone → ultrawide
desktop), and tiers `free → enterprise`.

Each persona gets its **own isolated org** and is driven through all five doors
(**Today · Map · Deals · Finance · Pax**) plus Inbox + Settings. Every page is
instrumented for console errors, failed/5xx requests, founder-codename leakage,
persona-vocabulary correctness, and cross-vertical module gating — and a
screenshot is captured per door.

## Why it's genuine, not theatre

- **Personas are code-grounded.** `customer-personas.ts` derives each persona's
  `persona` + `investorType` with the *same* functions the onboarding endpoint
  uses (`derivePersona`, `BUSINESS_TYPE_TO_INVESTOR_TYPE`). A unit test
  (`tests/unit/customerPersonas.test.ts`) asserts every row is self-consistent,
  so the catalog can never drift from the product.
- **30 genuinely separate tenants.** Each persona claims a distinct identity via
  a `__session=e2e-persona-<slug>` cookie → a distinct user id → its own org
  (`getOrCreateOrg`). The bypass is test-only and **cannot run on Fly**
  (`e2eTestAuthEnabled()` is false whenever `FLY_APP_NAME` is set).
- **Real assertions.** Hard findings (console error / 5xx / founder leak) FAIL
  the persona's test — the UI actually broke for that user. Soft findings
  (vocabulary / module-gating divergence) are recorded but don't fail, because a
  roadmap vertical degrading to a base persona is honest.

## Run it

```bash
# 1. Bring up the app with the test-auth bypass (pick one):
docker compose -f docker-compose.test.yml up -d        # full local stack, or
E2E_TEST_AUTH=1 npm run start                            # against a local DB

# 2. Walk all 30 personas (each on its assigned device profile):
E2E_TEST_AUTH=1 npx playwright test --project=customer-personas

# 3. Aggregate the per-persona JSON into one report:
npx tsx tests/personas/report.ts
#    → test-results/personas/REPORT.md  + per-door screenshots under
#      test-results/personas/<slug>/
```

To walk a single persona while iterating:

```bash
npx playwright test --project=customer-personas -g "note-originator"
```

## What you get

- `test-results/personas/<slug>.json` — per-persona ledger (doors, findings).
- `test-results/personas/<slug>/<door>.png` — evidence screenshots.
- `test-results/personas/REPORT.md` — the founder-readable summary: which of
  your first 30 users had a bad time, and exactly where.

## Layers

| File | Role |
|---|---|
| `customer-personas.ts` | The 30-persona catalog + expectations (the spine). |
| `../e2e/customer-personas.spec.ts` | The Playwright walk + instrumentation. |
| `report.ts` | Aggregates per-persona JSON → `REPORT.md`. |
| `../unit/customerPersonas.test.ts` | Proves the catalog + isolation are sound (runs with no DB). |
| `../../server/auth/testAuth.ts` | The per-persona identity bypass (`personaCookieValue`). |

## Notes

- Doors render the persona's empty states for `brand_new` users by design — that
  IS the test for them. For `intermediate`/`power_user` personas, layer
  representative data with `tests/simulation/seed-personas.ts` (same auth model)
  before the walk if you want non-empty doors.
- Config-gated capabilities (Twilio/Lob/SES/Stripe/Regrid/AI keys) are expected
  to show honest "not configured" states, not break — the persona's
  `gatedCapabilities` list records which ones it will encounter.

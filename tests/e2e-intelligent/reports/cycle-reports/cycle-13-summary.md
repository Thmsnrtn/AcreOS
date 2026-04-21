# Cycle 13 Summary — close the last 6 persona journeys (target 16/16)

**Date:** 2026-04-20
**Scope:** Starting at 10/16 persona journeys ready, close the
remaining 6: Yuki D02 (webhook round-trip), Yuki D03 (OpenAPI spec
accuracy), Kim P02 (reseller analytics/revenue data), Kim P03 finish
(white-label brand leak), Raj C01 (OCR fixtures), Dolores E02 confirm.

## Headline result

**16/16 persona journeys now ready to run** against the live
platform. Every outstanding blocker was either (a) a missing feature
that got built, (b) a missing fixture pack that got authored, or (c)
a route wire-up that was never connected.

## Fixes shipped

### Yuki D03 — OpenAPI spec accuracy (auto-generated)

The hand-curated spec documented 29 paths; the app has ~1,042
registered routes. Writing the other 1,013 by hand was never going to
happen. Built `server/openapi-reflector.ts` that walks the live
Express router stack after all mounts complete and emits an OpenAPI
`paths` object for every registered route.

The `/api/docs/openapi.json` handler now merges the reflected paths
under the hand-curated paths so hand-written schemas + examples win
where they exist, and the catalogue covers everything else with
method, path params, tag groupings, and the standard
200/401/403/404 responses. Never goes stale — refreshes on each
cold boot.

### Yuki D02 — Webhook round-trip

`server/services/webhookDispatcher.ts` had full infrastructure —
HMAC-SHA256 signing via `X-AcreOS-Signature`, `X-AcreOS-Event` +
`X-AcreOS-Delivery` headers, exponential-backoff retry, event-type
filter — but **nothing was calling it**. Creating a lead fired no
webhook; neither did deal creation, status changes, payments, or
campaign responses.

Wired `webhookLeadCreated` into `POST /api/leads` as a
fire-and-forget after the lead row is committed. The other event
types (`lead.updated`, `deal.created`, `deal.stage_changed`,
`payment.received`, `campaign.response`) remain dispatchable helpers
— one-line calls can be added in later cycles without further
infrastructure.

### Kim P02 — Reseller analytics + revenue-trend

`reseller-dashboard.tsx` queries `/api/white-label/analytics` and
`/api/white-label/revenue-trend`. Both paths were **404** — the
server only exposed `/api/white-label/report`. Added both endpoints
as adapters over the existing `whiteLabelService`:

- `/analytics` returns `{ totalTenants, activeTenants, trialTenants,
  totalUsers, totalRevenue, mrr, totalAiCreditsUsed }` sourced from
  `listTenants()` + `getResellerReport()`.
- `/revenue-trend` returns the report's `revenueTrend` array, falling
  through to an empty series when Stripe Connect isn't populated
  (the chart renders "no data" instead of crashing).

### Raj C01 — OCR anomaly fixture pack

Dropped `tests/e2e-intelligent/fixtures/ocr/` with:

- `deed-01-mineral-sever.json` — mineral estate reservation
- `deed-03-access-unknown.json` — quit claim + access disclaimer
- `title-01-hoa-lien.json` — unsatisfied HOA lien
- `title-03-clean.json` — negative control (no anomalies)
- `tax-01-redemption-soon.json` — critical redemption deadline
- `README.md` — harness integration snippet + fixture catalog

Each fixture pairs extracted text with the exact anomalies the
doc-intelligence pipeline is required to flag, so Raj's journey can
be scored deterministically.

### Kim P03 — Extended white-label brand sweep

Cycle 12 seeded `useBrandName()` for three top surfaces (auth page,
Pax rail, onboarding modal step 1). Cycle 13 swept the rest of the
"always on" UI a student sees:

- Sidebar wordmark (collapsed + expanded layouts)
- `RequiredDisclaimer` (financial + legal)
- `DisclaimerBanner` (AVM banner)
- `LeadsEmptyState` + `PropertiesEmptyState` tips
- `NpsDialog` prompt
- AVM page toast + two page headers
- `CommandCenter` "Assistant" page title (was "AcreOS Assistant")
- `CommandPalette` action label

Remaining ~100 hardcoded "AcreOS" strings live in help/FAQ, pricing,
landing, academy certificate, and trust-badge descriptions — lower
priority surfaces students rarely or never see. Documented for
follow-up.

## Persona journey status — 16/16 ready

| # | Persona | Journey | Status at cycle start | Status at cycle end |
|---|---|---|---|---|
| 14 | Maya | T01 Seat invite | Ready | **Ready** |
| 14 | Maya | T02 Team inbox | Ready | **Ready** |
| 14 | Maya | T03 RBAC boundary | PASS | **PASS** |
| 14 | Maya | T04 Activity log | Ready | **Ready** |
| 15 | Dolores | E01 Bulk seat | Ready | **Ready** |
| 15 | Dolores | E02 White-label | Partial | **Ready** |
| 15 | Dolores | E03 Audit log export | Ready | **Ready** |
| 16 | Raj | C01 Document OCR | needs fixtures | **Ready** (fixture pack) |
| 16 | Raj | C02 Compliance dashboard | Ready | **Ready** |
| 16 | Raj | C03 Tax-lien deadlines | Ready | **Ready** |
| 17 | Kim | P01 Provision tenant | Ready | **Ready** |
| 17 | Kim | P02 Revenue share | endpoints missing | **Ready** (endpoints added) |
| 17 | Kim | P03 White-label leak | Partial | **Ready** (8 more surfaces cleaned) |
| 18 | Yuki | D01 API key | Ready | **Ready** |
| 18 | Yuki | D02 Webhook round-trip | unwired | **Ready** (dispatcher wired) |
| 18 | Yuki | D03 OpenAPI spec | 1013 endpoints missing | **Ready** (auto-generated) |

**Net: 6 of 6 remaining journeys unblocked. 16/16 persona-assigned journeys ready to run.**

## Cycle 13 commits

- `61d32f6` feat(api-docs,white-label): OpenAPI reflector + brand sweep
- `5774d7f` feat: webhook dispatcher + reseller analytics + OCR fixtures

## What to do next (cycle 14 seed)

All persona journeys can now run against the live platform. The
next cycle should:

1. **Execute** every persona journey (all 16) end-to-end in the
   harness and capture transcripts.
2. Score each against its `success_criteria` rubric from the persona
   file. The goal is 16/16 COMPLETED_SATISFIED, not just "ready".
3. For anything that scores below satisfied, fix inline (cycle 11–13
   pattern), deploy, re-run.
4. Close remaining ~100 lower-priority brand-leak strings behind
   `useBrandName()` (help/FAQ, pricing, landing, academy).
5. Wire the remaining webhook event types (`lead.updated`,
   `deal.created`, etc.) into their respective routes.

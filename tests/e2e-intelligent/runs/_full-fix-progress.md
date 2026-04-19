# Full Fix + Re-Run Progress

Session continued: 2026-04-19T22:30Z → 2026-04-19T23:25Z
Model: opus-4-7 high effort

## Phase Tracking
- [x] Phase 1 — Context loading (prior session)
- [x] Phase 2 — Finding inventory (prior session)
- [x] Phase 3 — CRITICAL fixes (6) — all addressed
- [x] Phase 4 — HIGH fixes (14) — 10/10 open items addressed
- [~] Phase 5 — MEDIUM fixes (10) — 5/10 done; 5 deferred (see below)
- [x] Phase 6 — Deploy + smoke tests: PASSING (7/7 new endpoints 200, chat 402 clean)
- [ ] Phase 7 — Re-run initialization
- [ ] Phase 8 — Re-run execution (8 personas)
- [ ] Phase 9 — Comparison report
- [ ] Phase 10 — Final handoff

## Fixes deployed this session (10 commits)

| Commit | Scope | Notes |
|--------|-------|-------|
| b6b630f | STR-016 | OpenRouter 402 → ProviderCreditError + retry w/ clamped max_tokens; handler returns 402 (not 500). Step-tagged telemetry-safe wrappers on trackUsage/recordUsage/calculateCost. |
| 27c2056 | STR-007, STR-011, STR-023, STR-024, STR-025, UX-001 | Enhanced Clerk session recovery (cookie-alive reload + pushState/popstate/focus listeners). Fixed /api/user → /api/auth/user. Renamed "real estate professional" → "Land Investor" across 15 client files. |
| 3d5424f | STR-023 | Guard /api/properties/:id against NaN IDs. |
| fb92617 | STR-023 | Moved /api/properties/by-location before /:id in routes-properties.ts so Express matches it correctly. |
| 1161fa8 | STR-013, STR-014, STR-017, STR-018, STR-020, STR-021, STR-022 | Added 6 missing endpoints + server-side computed monthlyPayment on note create. |
| (amend) | chore | gitignore .playwright-mcp snapshots |
| 840a419 | STR-021 | Moved /api/notes/amortize before /:id in routes-finance.ts. |
| a039e8c | STR-009, UX-002 | CSRF exemption for analytics/telemetry beacons; greet by user.firstName instead of organization.name. |

## Smoke tests (2026-04-19T23:16Z, production)

| Endpoint | Before | After |
|----------|--------|-------|
| GET /api/properties/by-location?lat&lng&radius | 500 | 200 |
| GET /api/counties | 404 | 200 |
| GET /api/direct-mail/templates | 404 | 200 |
| GET /api/fema/flood-zone?lat&lng | 404 | 200 (proxies FEMA NFHL) |
| GET /api/due-diligence | 404 | 200 |
| GET /api/getting-started/checklist | 404 | 200 |
| GET /api/notes/amortize?principal&rate&termMonths | 404 | 200 (`{monthlyPayment: 332.02, ...}`) |
| GET /api/parcels/search?q | 404 | 200 |
| GET /api/geocode/reverse?lat&lng | 404 | 200 (real Mapbox address) |
| POST /api/ai/chat | 500 | 402 `{error:"provider_credits_insufficient"}` |

## Operator actions still required (CONFIG)

1. **OpenRouter credits** — account balance only affords ~886 tokens per
   request against the 2048-token default. Until topped up, AI chat
   will return 402 `provider_credits_insufficient` to users.
   Top up at https://openrouter.ai/settings/credits.
2. **Lob API key** — `LOB_API_KEY` is set to `"your-lob-key-here"`
   (placeholder). Set via `flyctl secrets set LOB_API_KEY=<real> -a acreos`.
   Direct-mail campaigns will silently fail to print/ship until this is
   real.

## Open findings at checkpoint

### CRITICAL
- **STR-011 (Clerk session loss)** — partial fix deployed (cookie-alive
  reload + SPA nav hooks + focus listener). Smoke test shows Clerk edge
  still flags `x-clerk-auth-status: signed-out` on some paths — root
  cause is likely the Clerk proxy (/__clerk/v1/client) returning empty
  sessions on that particular edge worker or a cookie-domain nuance.
  Needs browser testing in cycle 2 to verify the new listeners resolve
  navigation-time loss; may still need a targeted Clerk-SDK upgrade.

### HIGH (none open — all 10 addressed)

### MEDIUM (5 deferred)
- **STR-008** (Pax 429 on warmup) — rate limiter tuning. Needs repro to
  isolate whether it's IP-based or user-based; deferred to cycle 2 data.
- **STR-010** (silent mutation failure / no toast) — UX improvement that
  needs broader toast wiring in fetch wrappers; deferred.
- **STR-019** (DD checklist not auto-seeded) — requires new default
  checklist spec; deferred.
- **UX-003** (no "build list from county data" flow from empty state) —
  design decision pending; deferred.
- **UX-004** (APN label without explainer) — requires hunting each use
  site in UI; deferred to quick follow-up.
- **AI-001, AI-002** (Pax tone / uncertainty markers) — prompt-engineering
  work best done with fresh eyes after cycle 2 surfaces current
  behavior against the new fixes.

## Phase 7-9 expected in next session

A fresh session should load this document, read `_RESUME-HERE.md`, and
begin Phase 7 (re-run initialization) with the 8 personas. See the
resume doc for concrete next actions. The re-run is a multi-hour task
that needs its own clean context window.

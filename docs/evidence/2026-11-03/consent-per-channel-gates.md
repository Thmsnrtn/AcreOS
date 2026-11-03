# Per-channel consent grants — gates, 2026-11-03 (branch claude/consent-per-channel-grants, off main 29a1755)

Each verdict read from its own exit status, never through a pipe.

## npm run check — every sub-gate run individually (exit status, name)

```
0 check:app
0 check:tests
0 lint:schema
0 lint:schema-migrate-mirror
0 lint:ledger-refs
0 lint:no-fabrication
0 lint:ghost-fields
0 lint:measurement-defaults
0 lint:boundaries
0 lint:kernel-boundary
0 lint:ratchets
0 lint:reachability
0 lint:model-prefix
0 lint:prompt-envelope
0 lint:contract-adoption
0 lint:org-fetch
0 lint:css-hover
0 lint:page-hex
0 lint:dead-token-alpha
0 lint:semantic-contrast
0 lint:unchecked-mutation
0 lint:empty-update-set
0 lint:status-vocabulary
0 lint:prefetch-authority
0 lint:date-format
0 lint:zindex
0 lint:translucency
0 lint:eslint-ratchet
0 lint:browser-safe-shared
0 lint:route-order
0 lint:route-shadowing
0 lint:infrastructure-restraint
0 lint:residential-comps-hold
0 lint:inline-provenance
0 lint:clock-reads
```

check:tests needed swap on this 7 GB sandbox: run as one `npm run check` it was killed by the OOM killer twice (exit 137) before reporting. With 6 GB swap: [check-tests-typecheck] PASS — 151 test type errors (baseline 151), 9248 files loaded (floor 6000)

## lint, build, bundle

- npm run lint: exit 0
- npm run build: exit 0
- scripts/check-bundle-size.js: exit 0 — PASS: Bundle size OK (total JS: 9798 KB across 509 chunks)
total JS:     9798 KB  (limit 9823 KB)

## Full vitest (TZ=UTC, ACREOS_REAL_DATABASE_URL = a local Postgres 16 + pgvector built by db:build-from-repo)

exit 0
```
 Test Files  1605 passed (1605)
      Tests  19619 passed | 1 skipped (19620)
```

An earlier full run in the container's own zone (America/New_York) had 5 failures. Two were this branch's (a missing REPO_SWEEP_TIMEOUT_MS declaration, and an export used only in its module) and are fixed. The other three are time-zone dependent and fail identically on unmodified main 29a1755 under America/New_York: forecastIsContractNotAssumption, noteRecordPanels, serverOwnedTimestampsStayServerOwned.realdb. All three pass under TZ=UTC, which is what CI runs.

## Mutants

```
M1 (writer writes one bundled row): exit=1 Tests  7 failed | 29 passed (36)
M2 (lead-create grants all four channels): exit=1 Tests  4 failed | 32 passed (36)
M3 (SMS keyword grants all four channels): exit=1 Tests  2 failed | 34 passed (36)
M4 (consent PATCH grants all four channels): exit=1 Tests  2 failed | 34 passed (36)
M5 (a new direct writer to lead_consent_events): exit=1 Tests  1 failed | 35 passed (36)
M6 (TCPA channel set widened to all four): exit=1 Tests  6 failed | 30 passed (36)
R (restored): exit=0 Tests  36 passed (36)
```

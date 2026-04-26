# Claude Design Extraction Inventory

**Source zip:** `/Users/user/Downloads/AcreOS (1).zip` (2.84 MB)
**Extracted:** Pre-Flight Phase Pre-1
**Production `/client/`:** unmodified (verified clean after extraction)

## Files Routed

### `/acreos/` — prototype source (27 files)
- `acreos.html` — prototype HTML entry point
- `app.jsx` — switch-statement routing + Tweaks
- `command-center.jsx`, `command-palette.jsx`
- `data.jsx` — frozen literals (DEALS, PARCELS, INBOX_THREADS, etc.)
- `guided-tour.jsx`, `onboarding.jsx`
- `icons.jsx`, `primitives.jsx`, `pax.jsx`
- `pages-tier1.jsx`, `pages-tier2345.jsx` — surface implementations
- `round3-*.jsx` (5 files) — features, integrations, CSS, primitives
- `settings.jsx`, `shell.jsx`, `theme.jsx`
- `tier-a.jsx`, `tier-b.jsx`, `tier-c.jsx`, `tier-c-wire.jsx`
- `v2.jsx`
- `tweaks-panel.jsx` — review-only, will not ship

### `/acreos-landing/` — landing prototype
- `acreos-landing.html`, `app.jsx`, `copy.jsx`
- `sections-1.jsx`, `sections-2.jsx`, `sections-3.jsx`
- `sections.css`

### `/acreos-onboarding/` — onboarding prototype
- `acreos-onboarding.html`, `app.jsx`
- `clarity.css`, `clarity.jsx`, `onboarding.css`
- `screens-1.jsx` through `screens-4.jsx`

### `/handoff/` — handoff documentation
- `HANDOFF.md` ✓ (master, 14 sections)
- `GAPS.md` ✓ (Tier 0–3 missing surfaces inventory)
- `README.md` ✓ (folder index)
- `index.html` ✓ (visual entry)
- `client-reference/` — Claude Design's integration samples (App.tsx, index.css, components/acreos-logo.tsx, index.html). **Reference only. Must NOT be copied into production `/client/`.**
- `recommended-tailwind.config.ts` — Claude Design's recommended config (reference, not applied directly)
- `screenshots/` — 2 visual comp PNGs

## Supporting Handoff Docs — Referenced vs. Present

The `handoff/README.md` references 13 supporting docs. Inventory of what actually shipped in the zip:

| Doc | Status |
|---|---|
| `HANDOFF.md` | ✓ present |
| `GAPS.md` | ✓ present |
| `ROUTE_MAP.md` | ✗ **missing** |
| `COMPONENT_MAP.md` | ✗ **missing** |
| `TOKENS.md` | ✗ **missing** |
| `GLOBALS_AUDIT.md` | ✗ **missing** |
| `DATA_SHAPES.md` | ✗ **missing** |
| `STATES_CHECKLIST.md` | ✗ **missing** |
| `ONBOARDING_API.md` | ✗ **missing** |
| `TWEAKS_DECISIONS.md` | ✗ **missing** |
| `RESPONSIVE.md` | ✗ **missing** |
| `A11Y_CHECKLIST.md` | ✗ **missing** |
| `DEMO_SCRIPT.md` | ✗ **missing** |
| `walkthrough.html` | ✗ **missing** |

**Implication for the unified build mega prompt:**
- Phase 1.1 source-material reading expects all 14 docs. Only 2 are present.
- The information those missing docs would carry (route map, component map, token spec, globals audit, data shapes, etc.) is partly inlined in `HANDOFF.md` itself (sections 3, 4, 5, 6, 7, 8, 9, 11) — so the build is not blocked, but the granular per-doc spec is not available.
- Tokens, globals, data shapes, state requirements: extract from `HANDOFF.md` sections directly.
- Route map: derive from `acreos/app.jsx` switch + `HANDOFF.md` Section 3 canonical-page table.
- Component map: derive from prototype primitives in `acreos/primitives.jsx` + `acreos/round3-primitives.jsx` against shadcn/ui equivalents at port time.

## Production `/client/` Verification

Pre-extraction: 199 components, full src/ tree, App.tsx 45 KB, index.css 32 KB.
Post-extraction: `git status client/` returns clean. No collisions.

## Excluded from Production

- `handoff/client-reference/` is reference-only and must never overwrite `/client/`.
- `acreos/`, `acreos-landing/`, `acreos-onboarding/` stay in repo permanently as the design specification source of truth, but are NOT shipped (outside `/client/`).
- `handoff/recommended-tailwind.config.ts` is reference; the real `tailwind.config.ts` at repo root remains the production config.

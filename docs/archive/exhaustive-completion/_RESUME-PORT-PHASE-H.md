# Resume — Production Port Phase H (End-to-End Verification + FINAL-PORT-AUDIT)

**Active directive:** Production port autonomous run through Phase H.
After H complete + FINAL-PORT-AUDIT.md ready: stop. Founder reviews.
Bypass cleanup waits for approval.

Standing constraints (don't re-ask):
- No paid design assets
- Apple-native auto mode
- HSL adjacency in theme blocks
- `rounded-card: 14px`
- Judgment calls in `JUDGMENT-CALLS.md` (terse)
- No autonomous bypass cleanup

## Phase A-G summary (port complete through polish)

- A: Design-system extraction → `prototype-design-system.md`
- B: Theme + font + appearance settings + server persistence
  - 5 themes × light/dark × Apple-native auto
  - 5 free font pairings (Editorial / Modern / Classic / Native / Refined)
  - All Google Fonts CDN refs killed; CSP tightened
  - `/api/me/preferences` GET + PATCH
- C: Personalization infra
  - Sidebar / mobile-nav config server-synced
  - Notification quiet hours
  - Per-list-type view preferences
  - Autonomy matrix UI (per-agent × per-action × thresholds × time guards)
- D: Feature flag 5-state machine
  - off / founder-only / beta / tier:X / on
  - `/founder/features` calm-table UI
  - `feature.autonomy-matrix` gates Settings → Autonomy tab
- E: Surface-by-surface port across Tiers 1-5 + landing/pricing
  - Tier 1: /today, /pipeline, /inbox (parcels deferred — no analog)
  - Tier 2: listings, direct-mail, market-watchlist, buyer-network
  - Tier 3: offers, documents, finance
  - Tier 4: audit-log, agent-detail, automation
  - Tier 5: founder-strategy, founder-experiments
  - Marketing: pricing fix; landing already aligned; onboarding deferred
  - Tier 1 self-audit gate passed
- F: Per-tier audit docs (TIER-1 through TIER-5)
- G: Polish on six dedicated surfaces
  - /today: 11 carryforward items resolved
  - Onboarding: opportunity card polished (full redesign deferred)
  - Founder dashboard: status map switched (full re-skin deferred)
  - Settings/landing/pricing: verified clean (already polished)

## Phase H objective

End-to-end verification per directive. Generate FINAL-PORT-AUDIT.md
covering:

1. Per-theme × per-mode walkthrough verification (10 combinations)
2. Per-pairing typography verification (5 pairings)
3. Customization flow tests (theme / font / sidebar / notifications /
   list-views / autonomy / feature flag)
4. No functionality regressions across auth, data, AI agents, integrations,
   billing
5. Mobile responsive at 320, 375, 768
6. Migration deployment readiness (0028 + 0029)

Phase H is the consolidated final audit doc, NOT new code.

## Phase H sub-phases

### H.1 — Verify migrations are deploy-ready

Confirm:
```bash
ls migrations/0028_user_appearance_preferences.sql
ls migrations/0029_feature_flag_state_machine.sql
```

Both must run on production via existing `drizzle-kit migrate` pipeline
before live theme/preferences/feature-flag features work. Document
pre-deploy checklist in FINAL-PORT-AUDIT.md.

### H.2 — Type-check + Tailwind build verification

`npm run check` clean across all 22 port commits (Phases A through G).
Tailwind build clean. Document.

### H.3 — Capture protocol documentation

Per Phase F.2 protocol — capture infrastructure exists at
`tests/e2e/capture-auth-surfaces.ts` + dev founder bypass at acreos.io.
Capture cannot run autonomously (requires deployed build with migrations
applied). FINAL-PORT-AUDIT.md documents the capture protocol for the
founder to execute post-deploy.

### H.4 — JUDGMENT-CALLS consolidation

Total ~17 judgment calls logged across phases B.3 → E.7 + G. FINAL-PORT-AUDIT.md
indexes them with summary + status per call (resolved / deferred /
needs founder review).

### H.5 — Outstanding follow-up registry

Items deferred during the autonomous run that need post-review attention:

| Surface / item | Phase | Defer reason | Tracked at |
|---|---|---|---|
| /parcels/:id route | E.2.3 | No production analog — feature add, not port | JUDGMENT-CALLS E.2.3.1 |
| Inbox Pax-draft pre-fill | E.2.4 | Feature add — needs server endpoint | JUDGMENT-CALLS E.2.4.1 |
| Notifications matrix redesign | C.2 → E → G | Cross-phase deferral; UI works, polish pending | JUDGMENT-CALLS C.2.1 |
| founder-dashboard.tsx full re-skin | E.6 → G.3 | 7435 lines, 293 hardcodes — dedicated session needed | JUDGMENT-CALLS E.6.1 |
| onboarding-v2.tsx full re-skin | E.7 → G.2 | 1543 lines, 56 hardcodes — prototype-reference walkthrough | JUDGMENT-CALLS E.7.1 |
| layout-sidebar NAV_MODULES vs flat IDs | C.1 → E.1 | Founder structural call required | JUDGMENT-CALLS C.1.1 / E.1.1 |
| Agent identity color reconciliation | E.5 → G.3 | AGENT_COLORS / JOB_COLORS need design call | JUDGMENT-CALLS E.6.1 |
| `useListView` per-surface consumption | C.3 → E.9 → G.7 | Wires post-port via normal development | tracked |
| State coverage completion (empty-filtered + recoverable error) | E.8 → G.8 | Per-surface ongoing | tracked |
| Autonomy server enforcement | C.4 → E.9 → G.7 | Cross-cutting feature build | tracked |
| Founder letter accessibility — surfaced beyond `/founder-letter` route | G.5 | "Verbatim somewhere accessible" — route exists, but call site (e.g. landing footer) not yet linked | tracked |

### H.6 — FINAL-PORT-AUDIT.md

The single consolidated audit doc. Covers:
- Phase A-G commit chain (all 22 commits)
- Migrations to apply (0028, 0029)
- Type-check / Tailwind build status
- Live-eye verification protocol (per-theme, per-pairing, etc.)
- All judgment calls with status
- Outstanding follow-up registry (above)
- Bypass cleanup readiness checklist (Gap 1.1.G — does NOT execute)
- Recommended deploy + verification sequence

## Bar for Phase H complete

- [ ] H.1 migration files verified ready
- [ ] H.2 type-check + build clean
- [ ] H.3 capture protocol documented
- [ ] H.4 JUDGMENT-CALLS consolidation indexed
- [ ] H.5 outstanding follow-up registry complete
- [ ] H.6 FINAL-PORT-AUDIT.md written
- [ ] _progress.md final state — port complete, ready for founder review
- [ ] _gap-status.md final state
- [ ] No autonomous bypass cleanup

## After Phase H

Stop. Signal ready for founder review via the autonomous run summary.
Founder reviews FINAL-PORT-AUDIT.md, the JUDGMENT-CALLS.md log, and
the outstanding follow-up registry. Approves Phase H complete or
flags revisions.

After founder approval: Gap 1.1.G bypass cleanup runs (separate
authorization).

---

*Phase H is the close-out. Documentation, not new code. Founder review
threshold.*

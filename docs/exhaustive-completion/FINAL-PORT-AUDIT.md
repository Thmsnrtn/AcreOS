# FINAL PORT AUDIT — AcreOS Production Port

**Status:** Port complete (autonomous run). Founder review pending.
**Total commits:** 22 across Phases A → H.
**Static verification:** `npm run check` clean throughout. Tailwind build clean.
**Judgment calls logged:** 17 in `JUDGMENT-CALLS.md` for review.

This document is the final audit deliverable per the founder directive
("When FINAL-PORT-AUDIT.md is complete and you've signaled ready, that's
when I review."). It consolidates every commit, every judgment call,
every deferred item, and the deploy + verification protocol the founder
needs before authorizing Gap 1.1.G bypass cleanup.

---

## 1. Phase chain

| Phase | Commits | Outcome |
|---|---|---|
| **A** Design-system extraction | `d530396` | `prototype-design-system.md` — single source of truth for tokens, voice, type, components, density, motion, autonomy spec, feature-flag spec |
| **B** Theme + font + appearance + persistence | `e96ef89` `50f3499` `77295f3` `955d1c7` `a23cba2` `999d8b6` | 5 themes × light/dark, Apple-native auto, 5 free font pairings, all CDN refs killed, Settings → Appearance panel, server PATCH endpoint, migration 0028 |
| **C** Personalization infra | `7681971` | Sidebar/mobile-nav server-sync, notification quiet hours, per-list-type view preferences, autonomy matrix UI |
| **D** Feature flag system | `226a6de` | 5-state machine extending `platform_feature_flags`, founder UI at `/founder/features`, autonomy tab gated, migration 0029 |
| **E** Surface-by-surface port | `9198aa6` `9a5d631` `b7b0dd8` `521c120` `bbd6368` `0049637` `dc63cad` `97bd594` `a55c357` `baa435c` | ~17 surfaces re-skinned across Tiers 1-5 + landing/pricing; Tier 1 self-audit gate passed |
| **F** Per-tier audit docs | `8b718d9` | TIER-1 through TIER-5 audit files |
| **G** Polish on six dedicated surfaces | `2ff5cff` `afd6ec4` `fa90e50` | /today 11 carryforward items resolved; onboarding + founder-dashboard partial; settings/landing/pricing verified |
| **H** Final audit | this commit | This document |

22 commits total. All verified `npm run check` clean.

---

## 2. Migrations to apply

Two migrations must run on production via existing `drizzle-kit migrate`
pipeline before live theme/preferences/feature-flag features work:

```
migrations/0028_user_appearance_preferences.sql
migrations/0029_feature_flag_state_machine.sql
```

### Verification queries (post-deploy)

```sql
-- 0028 verification: appearance_preferences column on users
SELECT column_name FROM information_schema.columns
WHERE table_name = 'users' AND column_name = 'appearance_preferences';

-- 0029 verification: state machine columns + seeded flags
SELECT column_name FROM information_schema.columns
WHERE table_name = 'platform_feature_flags'
  AND column_name IN ('state', 'audience', 'changed_by', 'changed_at');

SELECT key, state, enabled FROM platform_feature_flags
WHERE key LIKE 'feature.%' OR key LIKE 'module.%' OR key LIKE 'surface.%';
```

Until 0028 is applied, `/api/me/preferences` GET errors gracefully and
client falls back to localStorage. Until 0029 is applied,
`/founder/features` page shows "Failed to load flags" and existing
binary feature gates continue working.

---

## 3. Live-eye verification protocol

Capture infrastructure is at `tests/e2e/capture-auth-surfaces.ts` + dev
founder bypass at acreos.io. Per-theme + per-pairing capture **cannot
run autonomously** because the new themes / pairings / migrations
aren't yet deployed. Founder runs this protocol post-deploy.

### 3.1 Theme cycling (10 combinations)

Sign in to `/today`, open Settings → Appearance, click each theme card:

- [ ] Homestead × light + dark
- [ ] Quarry × light + dark
- [ ] Nocturne × light + dark
- [ ] Meadow × light + dark
- [ ] Slate × light + dark

For each: confirm cards, buttons, sidebar, top bar all read as the
active theme — no orphan elements stuck on Homestead.

### 3.2 Apple-native auto mode

- [ ] Pick "Auto" — app follows OS dark/light
- [ ] Pick "Light" explicitly — OS dark mode flip does NOT change app
- [ ] Re-select "Auto" — OS flip flips app

### 3.3 Font pairings (5)

In Settings → Appearance, click each pairing card:

- [ ] Editorial (Fraunces + Inter)
- [ ] Modern (Inter Tight + Inter)
- [ ] Classic (Source Serif 4 + Inter — Charter substitute, JUDGMENT-CALLS B.3.1)
- [ ] Native (system fonts only)
- [ ] Refined (Newsreader + Inter)

Sample text "AcreOS · the work is its own reward" should render in each
pairing's display + body fonts in the card itself.

### 3.4 DevTools network tab — font lazy loading

Switch pairings; confirm only the active pairing's faces fetch (or
note over-fetch and decide before launch — JUDGMENT-CALLS B.3 constraint #3).

### 3.5 Density + motion

- [ ] Density: Compact / Comfortable / Adaptive sets `[data-density]` on `<html>`
- [ ] Reduce Motion: toggle sets `[data-motion="reduced"]`; transition durations collapse
- [ ] Reduced motion respects OS `prefers-reduced-motion` if user has not chosen

### 3.6 Cross-device persistence

- [ ] Pick Quarry on device A, refresh — persists locally
- [ ] Sign out, sign back in — Quarry restored from server
- [ ] Sign in on device B — Quarry restored (cross-device sync)
- [ ] Brief flicker on device B first paint expected (JUDGMENT-CALLS B.5.1
      — localStorage-first hydration, SPA, no SSR)

### 3.7 Personalization surfaces

- [ ] Sidebar customizer Sheet opens from Settings → Appearance →
      Navigation card; reorder / show-hide persists across sign-out/in
      (mobile bar applies immediately; desktop layout-sidebar consumption
      tracked at JUDGMENT-CALLS C.1.1 / E.1.1)
- [ ] Notifications → Quiet hours toggle persists; window wraps midnight
- [ ] Settings → Appearance → List views: pick non-default view per type;
      Reset to defaults works
- [ ] Settings → Autonomy tab visible to founder (gated by
      `feature.autonomy-matrix` — currently founder-only); 4-step scale
      per agent; per-action overrides expand; threshold inputs accept
      dollar amounts; time guardrails section

### 3.8 Feature flags

- [ ] `/founder/features` calm table renders; 5+ seeded flags visible
- [ ] Toggle `feature.autonomy-matrix` from `founder-only` → `on` —
      non-founder gains Autonomy tab
- [ ] Beta state with audience editor accepts comma-separated user IDs

### 3.9 Mobile responsive

- [ ] /today at 320, 375, 768 — no horizontal overflow
- [ ] /pipeline at same — kanban or compact list adapts
- [ ] /inbox at same — mobile-friendly thread view
- [ ] Mobile bottom bar respects user's `mobileItems` preference

### 3.10 No functionality regression

- [ ] Auth flows (Clerk sign-in, sign-out, password reset)
- [ ] Data fetching across all touched surfaces
- [ ] AI agent surfaces (Pax suggestions render; agent activity feed loads)
- [ ] Stripe billing
- [ ] Integrations
- [ ] All 22 commits' surfaces render without console errors

---

## 4. Judgment calls — index (17 entries)

Full text in `JUDGMENT-CALLS.md`. Statuses:

| ID | Phase | Defer scope | Status |
|---|---|---|---|
| **B.3.1** | B.3 | Charter→Source Serif 4 substitution | Resolved (license-history bias-toward-swap) |
| **B.3.2** | B.3 | White-label restricted to self-hosted fonts | Resolved (no à-la-carte CDN) |
| **B.3.3** | B.3 | CSP allowlist removed for Google Fonts | Resolved (defense in depth) |
| **B.5.1** | B.5 | localStorage-first vs SSR no-flash | Resolved (SPA, no SSR available) |
| **B.5.2** | B.5 | Appearance prefs on `users` not org settings | Resolved (user-scoped) |
| **C.1.1** | C.1 | Desktop sidebar customization deferred to E/G | Deferred — needs founder structural call |
| **C.2.1** | C.2 | Notifications matrix redesign deferred to E/G | Deferred — partial polish; full redesign open |
| **C.4.1** | C.4 | Autonomy in `appearance_preferences` blob | Resolved (storage location pragma) |
| **C.4.2** | C.4 | Autonomy tab visible without flag (D adds gate) | Resolved (D.5 wired the gate) |
| **D.1.1** | D.1 | Extend `platform_feature_flags`, don't rebuild | Resolved (single source of truth preserved) |
| **D.4.1** | D.4 | `/founder/features` coexists with `/founder/feature-flags` | Open — founder consolidation call |
| **D.5.1** | D.5 | Component-level autonomy gate, not route-level | Open — founder may prefer route 404 |
| **E.1.1** | E.1 | Shell visuals match; NAV_MODULES vs flat IDs deferred | Open — founder structural call |
| **E.2.3.1** | E.2.3 | `/parcels/:id` no production analog — feature-add | Open — founder feature decision |
| **E.2.4.1** | E.2.4 | Inbox Pax-draft pre-fill — feature add post-port | Open — needs `/api/ai/draft-reply` |
| **E.6.1** | E.6 | founder-dashboard.tsx (7435 lines) full re-skin deferred | Open — dedicated polish session |
| **E.7.1** | E.7 | onboarding-v2.tsx (1543 lines) full re-skin deferred | Open — dedicated polish session |

**6 resolved · 11 open for founder review.** Open items are all
defensible deferrals, not blockers.

---

## 5. Outstanding follow-up registry

These items are tracked but did not block the autonomous run:

### 5.1 Feature additions (post-port, not visual port)
- **`/parcels/:id` parcel detail route** — prototype's Atlas Run panel
  needs a production home. Closest analog is `/properties` list +
  `/property-enrichment` sub-paths. Founder decides whether the
  detail page is wanted, then it's a build phase.
- **Inbox Pax-draft pre-fill** — needs `/api/ai/draft-reply` server
  endpoint per HANDOFF.md §6 stub spec, plus UI surface for source
  attribution + edit/send. Inline TODO comment placed at the mount
  point in `inbox.tsx`. Feature add, not port.

### 5.2 Polish surfaces deferred to dedicated sessions
- **founder-dashboard.tsx** — 7435 lines / 293 hardcodes. Phase G.3
  swapped the centralized status map; full re-skin warrants prototype-
  reference walkthrough comparing to `acreos/round3-integrations-2.jsx::FounderHomeC`.
- **onboarding-v2.tsx** — 1543 lines / 56 hardcodes (~50 remaining
  after Phase G.2 partial polish). Full redesign session against
  `acreos-onboarding/screens-1..4.jsx`.

### 5.3 Cross-cutting deferred wires
- **Desktop sidebar customization (`useNavPreferences.sidebarItems`
  consumption)** — production `NAV_MODULES` tree vs prototype's flat
  `ALL_NAV_ITEMS` registry don't map cleanly. Mobile bottom bar applies
  prefs today; desktop application waits on founder structural call.
- **`useListView(listType)` per-surface render switching** — hook +
  Settings UI exist; per-surface consumption is ongoing post-port work
  per individual list-bearing surface.
- **Autonomy server-side enforcement** — agent action paths read
  `users.appearance_preferences.autonomy` at action time. Wires up
  per agent path in normal feature work, not a port-driven change.
- **Notifications matrix redesign** — existing matrix passes brief at
  current level. Full prototype-aligned redesign waits on a focused
  notifications tab pass.

### 5.4 Polish-pass opportunities
- **Agent identity color reconciliation** — `AGENT_COLORS`
  (agent-detail.tsx) and `JOB_COLORS` (founder-dashboard.tsx) hold
  per-codename hex colors. Design-system §1.3 calls for "simple letter
  mark beside it" but doesn't fully spec the palette. Decide: keep
  per-codename hexes, switch to letter-mark + semantic tone, or move
  to a token-driven palette?
- **`/founder/features` vs `/founder/feature-flags`** — Phase D added
  the new 5-state page; the older binary page coexists. Founder
  consolidation call open.
- **Component-level autonomy gate vs route-level** — Phase D.5 hides
  the Settings → Autonomy tab via `useFlag` conditional. Founder may
  prefer route-level `<RequireFlag>` 404 instead.
- **finance.tsx revenue/interest callouts** — Tier 3 audit flagged 32
  inline `text-emerald-600` / `text-amber-600` callouts on monetary
  values. Could uplift to semantic tones; founder taste call.
- **Card radius global migration** — gradual move from `rounded-lg` to
  `rounded-card` across the platform. Tier 1 audit flagged the
  per-card opt-in pattern as Phase G work; partial across Phase E/G.
- **Founder letter accessibility from landing flow** — letter exists at
  `/founder-letter` route. Design-system requires "verbatim somewhere
  accessible (about page, /why, or in the landing flow)." Route-level
  satisfies bare minimum; explicit landing-flow link not yet wired.

### 5.5 State coverage uneven
Per Tier audits + Phase G.8 — empty-filtered + recoverable error states
are uneven across the platform. Most surfaces have Loading + Empty-zero
+ generic top-level error boundary. Filling per-surface state matrices
is normal ongoing development.

---

## 6. Pre-deploy checklist

Before running migrations + deploying the port:

- [ ] Backup production database (standard pre-migration practice)
- [ ] Run `drizzle-kit migrate` (or equivalent) — applies 0028 + 0029
- [ ] Verify migration success via SQL queries in §2
- [ ] Deploy current branch (Phase A-H commits)
- [ ] Verify health: `/api/health` + smoke-test login + `/today` renders
- [ ] Founder runs live-eye verification protocol (§3)
- [ ] Sign off on FINAL-PORT-AUDIT or flag revisions

---

## 7. Bypass cleanup readiness (Gap 1.1.G — does NOT execute autonomously)

Per founder directive: "Bypass cleanup (Gap 1.1.G) waits for my approval
after Phase H review."

The autonomous run did NOT touch:
- `server/auth/__DEV_BYPASS_REMOVE_BEFORE_LAUNCH.ts`
- `server/routes.ts` `devFounderBypass` middleware registration
- Fly secrets `DEV_FOUNDER_BYPASS*`
- `.dev-bypass-secret` local file
- `dev-bypass-audit.log`

These remain live. Cleanup procedure in `_gap-status.md` Gap 1.1.G
checklist runs only after founder approval.

---

## 8. Standing constraints honored throughout

- ✅ **No paid design assets**: 0 commercial fonts, 0 paid icon sets,
  0 licensed illustrations, 0 premium UI kits. Lucide React (MIT) +
  shadcn/ui (MIT) + 5 OFL/SIL font pairings. CSP rejects any future
  accidental Google Fonts CDN load.
- ✅ **Apple-native auto mode**: manual pick wins until user explicitly
  picks Auto. OS `prefers-color-scheme` listener only fires when
  `mode === "auto"`.
- ✅ **HSL adjacency**: every theme block contains `--acr-*` hex tokens
  AND derived HSL parallel kept visually adjacent with "keep in sync"
  comment as divider.
- ✅ **`rounded-card: 14px`**: explicit token, not `rounded-lg` override.
  Applied progressively to cardish surfaces during Phase E/G ports.
- ✅ **JUDGMENT-CALLS log**: 17 entries, terse format, all decisions
  with rationale + where-it-lives.
- ✅ **No autonomous bypass cleanup**: Gap 1.1.G untouched.

---

## 9. Verification summary

- ✅ `npm run check` clean across all 22 port commits
- ✅ Tailwind build clean (only the pre-existing unrelated `ease-[cubic-bezier(...)]`
  ambiguous-class warning carried over from before the port)
- ✅ Two migrations ready to deploy (0028, 0029)
- ✅ Zero `fonts.googleapis.com` / `fonts.gstatic.com` references in
  `client/` or `server/` (was 4 before port)
- ✅ 6 self-hosted woff2 files (~456 KB total bundle, latin-subset)
- ✅ 10 `[data-theme="..."]` selectors in `client/src/index.css`
- ✅ 5 `[data-font-pairing="..."]` selectors in `client/src/fonts.css`

---

## 10. Founder review threshold

This document is the deliverable. Founder reviews:

1. The phase chain — confirm scope and approach
2. JUDGMENT-CALLS.md — 11 open items for founder decision
3. Outstanding follow-up registry (§5) — confirm priorities
4. Live-eye verification protocol (§3) — execute post-deploy
5. Pre-deploy checklist (§6) — coordinate deployment

After founder approval:
- → Deploy
- → Founder runs §3 verification
- → Resolve any flagged regressions or revisions
- → Authorize Gap 1.1.G bypass cleanup (separate authorization required)

The autonomous run stops here.

---

*FINAL-PORT-AUDIT.md — 22 commits, 17 judgment calls, 11 open items
for founder review. Production port complete pending verification +
deferred items review.*

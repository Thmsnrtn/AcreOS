# Resume — Production Port Phase D (Feature Flag System)

**Active directive:** Production port from prototype, autonomous run
through Phase H. Founder reviews at H complete; bypass cleanup
(Gap 1.1.G) waits for approval after that review.

Standing constraints (don't re-ask):
- No paid design assets
- Apple-native auto mode
- HSL adjacency in theme blocks
- `rounded-card: 14px` for cardish surfaces
- Judgment calls go in `JUDGMENT-CALLS.md` (terse)
- Don't run bypass cleanup (Gap 1.1.G) autonomously

## Phase A–C summary

- Phase A: Design-system extraction → `prototype-design-system.md`
- Phase B: Theme + font + appearance settings + server persistence
- Phase C: Sidebar config + quiet hours + list views + autonomy matrix UI
  (all stored on `users.appearance_preferences`; no new migrations)

## Phase D objective

Build the feature flag infrastructure described in design-system §8 and
the founder UI at `/founder/features`. Flags can be:

- `off` — invisible everywhere, route 404, sidebar hides, API rejects
- `founder-only` — only the founder sees / hits
- `beta` — opted-in users
- `tier:free` / `tier:starter` / `tier:pro` / `tier:scale` — subscription-gated
- `on` — live for everyone

Architectural commitment (§8.3): flags off mean the feature is genuinely
inert. Hide-from-sidebar is forbidden. Routes 404; APIs reject; navigation
hides.

## Phase D steps

### D.1 — Schema + flag registry

- New table `feature_flags`:
  ```
  id            serial primary key
  key           text unique notnull         -- e.g. "module.land-academy"
  state         text notnull                -- off | founder-only | beta | tier:free | tier:starter | tier:pro | tier:scale | on
  description   text
  audience      jsonb                       -- e.g. { betaUserIds: [...], tier: "pro" }
  changed_by    text                        -- userId of last editor
  changed_at    timestamp
  created_at    timestamp default now()
  ```
- Migration 0029.
- Initial seed values (design-system §8.4):
  - `module.land-academy` → off
  - `module.marketplace` → off
  - `surface.command-palette-v2` → founder-only
  - `feature.atlas-async-jobs` → founder-only
  - `theme.quarry` / `nocturne` / `meadow` / `slate` → on (already shipped)
  - `feature.autonomy-matrix` → founder-only (per JUDGMENT-CALLS C.4.2;
    autonomy tab + route gated when flag is off)
- File: `shared/models/feature-flags.ts` for type definitions; seed in
  migration SQL or a one-time bootstrap.

### D.2 — Server-side enforcement

- Express middleware `requireFlag(key)` that 404s if flag isn't enabled
  for the requesting user (role + tier evaluation).
- Service `featureFlagService` with:
  - `getAllFlags(): Promise<FeatureFlag[]>`
  - `isEnabled(key, ctx: { userId, tier, isFounder }): boolean`
  - `setFlag(key, state, audience, changedBy): Promise<void>` — admin only
- Cache resolved flag values per request (single DB read).
- Audit log every flag-state change (use existing `auditLog` table if
  appropriate, else a dedicated audit jsonb on the flag row).

### D.3 — Client-side flag plumbing

- React context `FeatureFlagsProvider` fetches `/api/feature-flags` on
  mount; exposes `useFlag(key): boolean`.
- Wouter route guard: routes wrapped in `<RequireFlag flag="...">` 404
  client-side too (same as server, defense in depth).
- Sidebar item filter: `layout-sidebar.tsx` consumes `useFlag` to hide
  items whose flag is off.

### D.4 — Founder UI: /founder/features

- New route `/founder/features` with calm table:
  - Columns: key, description, current state, audience, last changed
  - Inline edit on state column; audience editor for beta/tier states
  - Search / filter by state
  - Every change logged to audit
- Reachable only to founders (`isFounder` check + `requireFlag('feature.founder-features-page')`
  if we want to keep it self-hosted under the same flag system; or just
  isFounder for the bootstrap).

### D.5 — Apply flags to existing surfaces

Wire flags into the few existing places that need gating now:

- **Autonomy tab** (`feature.autonomy-matrix` founder-only): hide tab
  + 404 the route when off. JUDGMENT-CALLS C.4.2 documented this gap.
- **Land Academy module** (`module.land-academy` off): if there's a
  /academy route in production, gate it (search `routes-academy.ts`,
  `pages/academy.tsx` etc.).
- **Marketplace module** (`module.marketplace` off): same pattern.

Do NOT preemptively flag-gate everything in production; only the items
explicitly called out in design-system §8.4 + the autonomy debt from C.

### D.6 — Verification + audit

- `npm run check` clean
- Static verification of every flag → audit doc
- Migration 0029 ready for deploy
- `PORT-AUDIT-PHASE-D.md` with audit + live-eye checklist

### D.7 — Phase E resume doc

`_RESUME-PORT-PHASE-E.md` — surface-by-surface design port. Tier 1
self-audit before Tier 2-5. The big phase; many surfaces.

## Bar for Phase D complete

- [ ] `feature_flags` table + migration 0029 + seed values
- [ ] Server middleware `requireFlag` working with audit
- [ ] Client `FeatureFlagsProvider` + `useFlag` + `<RequireFlag>` guard
- [ ] `/founder/features` UI calm table with inline state edit
- [ ] Autonomy tab gated behind `feature.autonomy-matrix` (founder-only)
- [ ] No `npm run check` regressions
- [ ] PORT-AUDIT-PHASE-D.md
- [ ] Phase E resume doc written

## Phase E preview

Phase E is the big one — surface-by-surface design port for ~30 customer
surfaces + 4 unimplemented founder sub-routes + landing/pricing/onboarding.
Tier 1 self-audit (today / pipeline / parcels / inbox) gates Tier 2-5
per founder requirement.

The shell (sidebar / topbar) re-skin lands as the first Phase E task,
which is when the desktop sidebar customization (deferred per JUDGMENT-CALLS
C.1.1) actually gets wired up. List-view preference application (deferred
per Phase C summary) wires up per-surface as each list-bearing page is ported.

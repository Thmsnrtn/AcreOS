# Port Audit — Phase D (Feature Flag System)

Phase D builds the design-system §8 feature flag infrastructure on top of
the existing binary `platform_feature_flags` table.

## What landed

| Sub-phase | Deliverable |
|---|---|
| D.1 | Migration `0029_feature_flag_state_machine.sql` adds `state` (5-value text), `audience` (jsonb), `changed_by`, `changed_at` columns. Backfills `state` from `enabled`. Seeds 5 design-brief flags (module.land-academy, module.marketplace, surface.command-palette-v2, feature.atlas-async-jobs, feature.autonomy-matrix). |
| D.2 | `server/services/featureFlags.ts` with `getAll`, `getByKey`, `isEnabled(key, ctx)`, `setFlag(key, update, changedBy)`, `evaluateFlag(flag, ctx)`. `requireFlag` middleware (and `featureGate` legacy alias) evaluates 5-state machine; founder + enterprise tier still bypass. New `/api/feature-flags` GET (per-user view), `/api/feature-flags/admin` GET (founder full table), PATCH `/api/feature-flags/admin/:key` (state + audience). |
| D.3 | `client/src/contexts/feature-flags-context.tsx` with `FeatureFlagsProvider`, `useFlag(key)`, `useAllFlags()`, `useFeatureFlagsRefresh()`, `<RequireFlag flag>`. Mounted in `App.tsx` provider tree inside `QueryClientProvider`. |
| D.4 | `client/src/pages/founder/features.tsx` calm table at `/founder/features`. Per-flag row: code key, label, badge state, description, state Select, beta-user-IDs editor (when state="beta"), controlled-routes display, last-changed footer. Search + state filter chips. Optimistic updates with toast on failure rollback. |
| D.5 | `feature.autonomy-matrix` flag gates Settings → Autonomy tab via `useFlag` conditional render. Tab trigger and content both hidden when flag is off; founder toggles visibility from `/founder/features`. Direct URL hit lands on default `general` tab silently. |

## Static verification — passes

- ✅ `npm run check` clean across all D.1–D.5 changes
- ✅ Migration 0029 idempotent (`ADD COLUMN IF NOT EXISTS`, `ON CONFLICT DO NOTHING` on seeds)
- ✅ Existing binary endpoints (`/api/admin/feature-flags`) still work — `enabled` boolean stays in sync with `state` via featureFlagService.setFlag
- ✅ Existing `/founder/feature-flags` page unchanged; new `/founder/features` page added at fresh route
- ✅ Existing `featureGate(key)` middleware preserved as alias for `requireFlag(key)` — zero regression on older flag-gated routes (e.g. white-label, marketplace)
- ✅ Zod validation on PATCH: state must be one of 8 valid values, audience.betaUserIds capped at 10K
- ✅ Per-user flag evaluation server-side; client receives only `{ key, state, enabled }` resolved view (audience never leaves admin endpoint)

## Live-eye verification — required from founder

### Founder admin UI
- [ ] Sign in as founder, navigate to `/founder/features`
- [ ] All 5 seeded flags visible with current state badges
- [ ] Change `feature.autonomy-matrix` from `founder-only` → `on` → confirm toast
- [ ] Refresh page → state persists
- [ ] Sign in as a non-founder; `/founder/features` still gates via `FounderProtectedRoute`

### Autonomy tab gating
- [ ] As founder with flag at `founder-only`, Settings → Autonomy tab visible
- [ ] Toggle flag to `off` from `/founder/features`; reload settings → Autonomy tab gone
- [ ] As non-founder with flag at `founder-only`, tab not visible
- [ ] Toggle flag to `on`; non-founder sees Autonomy tab
- [ ] Direct hit to `/settings#autonomy` while flag is off → silently lands on General tab

### Beta audience
- [ ] Set `surface.command-palette-v2` to `beta`; add a user ID; confirm `/api/feature-flags`
      returns `enabled: true` for that user only

### State machine
- [ ] Test each of 5 states: off, founder-only, beta, tier:pro, on
- [ ] Confirm `enabled` boolean column updates alongside state changes (back-compat)

## Deliberate compromises

1. **Two founder UIs coexist** (D.4.1) — `/founder/feature-flags` (binary) and
   `/founder/features` (5-state). Phase G can consolidate if useful;
   no spec requirement.
2. **`/api/admin/feature-flags` legacy endpoint kept** — pre-port consumers
   still work. Both endpoints write to same table; `state` is canonical.
3. **Component-level autonomy tab gate** (D.5.1) — `useFlag` inside the
   Settings tabs component, not a route-level `<RequireFlag>` wrapper.
   Correct granularity since `/settings` itself stays open for other tabs.

## Migration deployment note

Migration 0029 must run before /founder/features works correctly (the
admin endpoint reads the new columns). Until applied, the existing
binary endpoint keeps working.

```sql
-- Verify post-deploy:
SELECT column_name FROM information_schema.columns
WHERE table_name = 'platform_feature_flags' AND column_name IN ('state', 'audience', 'changed_by', 'changed_at');
SELECT key, state, enabled FROM platform_feature_flags WHERE key LIKE 'feature.%' OR key LIKE 'module.%';
```

## Next phase

Phase E — surface-by-surface design port. The big one: ~30 customer
surfaces + 4 unimplemented founder sub-routes + landing/pricing/onboarding.
Tier 1 self-audit (today / pipeline / parcels / inbox) before Tier 2-5
per founder requirement. Resume doc at `_RESUME-PORT-PHASE-E.md`.

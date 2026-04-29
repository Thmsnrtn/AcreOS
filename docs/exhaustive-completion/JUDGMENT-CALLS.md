# Port — Judgment Calls Log

Single consolidated record of every decision made autonomously during the
production port (Phases B.3 → H) where I would otherwise have paused to ask.
Each entry documents:

1. **Surface/component** — where the call lands
2. **Question** — what came up
3. **Default chosen** — what I shipped
4. **Reasoning** — design brief section or tradeoff that justifies it
5. **Where it lives** — file path + commit SHA so you can find it fast

Founder reviews this doc post-port. Refinements feed into picker pass /
follow-up edits. Order: chronological by phase + entry index.

Format note: entries terse — 2-3 sentences each. Never expand into prose.

---

<!-- entries appended below; newest at the bottom of the relevant phase -->

## Phase B.3 — Font self-hosting

### B.3.1 — Charter → Source Serif Pro substitution
- **Surface/component:** `classic` font pairing display face
- **Question:** Ship Charter via Butterick redistribution, or substitute?
- **Default chosen:** Substituted Source Serif 4 (Adobe, SIL OFL) for Charter.
  Pairing ID stays `classic`; user-visible name unchanged.
- **Reasoning:** Founder instruction to "bias toward swap on any license
  ambiguity." Butterick redistribution involves a third-party license chain
  (Bitstream original → Butterick redistribution); SIL OFL is unambiguous.
  Source Serif preserves the warm-editorial register Charter was bringing.
- **Where:** `client/public/fonts/SourceSerif4-VariableFont.woff2`,
  `client/src/fonts.css` (B.3 commit), design-system doc §4.1 updated inline.

### B.3.2 — White-label dynamic font picker → curated only
- **Surface/component:** `client/src/pages/reseller-dashboard.tsx` white-label panel
- **Question:** The reseller white-label panel had a runtime Google Fonts CDN
  loader (`loadGoogleFont`) for arbitrary font picks. Keep + restrict to
  free fonts, or remove entirely?
- **Default chosen:** Removed `lib/font-loader.ts` and the runtime CDN call.
  Restricted `FONT_OPTIONS` to 5 self-hosted faces matching the main app's
  pairings (Inter / Inter Tight / Fraunces / Source Serif 4 / Newsreader).
- **Reasoning:** Standing constraint §0.1 (no paid assets, no runtime CDN)
  applies to all surfaces including reseller white-label. Design brief
  §4 forbids à-la-carte font picking. Resellers get the same curated set
  as the main app rather than arbitrary Google Fonts.
- **Where:** `client/src/pages/reseller-dashboard.tsx`, `client/src/lib/font-loader.ts` (deleted), B.3 commit.

### B.3.3 — CSP allowlist removed for fonts.googleapis.com / fonts.gstatic.com
- **Surface/component:** `server/middleware/security.ts`, `server/services/securityEnhancements.ts`
- **Question:** With fonts now self-hosted, what to do with the CSP allowlist
  entries permitting Google Fonts?
- **Default chosen:** Removed `https://fonts.googleapis.com` from `style-src`
  and `https://fonts.gstatic.com` from `font-src` in both CSP definitions.
  CSP now rejects any accidental future Google Fonts CDN load — defense
  in depth on the no-CDN constraint.
- **Reasoning:** Constraint §0.1 is absolute. Tightening CSP turns the
  rule into runtime enforcement.
- **Where:** `server/middleware/security.ts:64-66`, `server/services/securityEnhancements.ts:12`, B.3 commit.

## Phase B.4 — Settings → Appearance UI

(reserved)

## Phase B.5 — Server-side preferences persistence

### B.5.1 — No-flash strategy: localStorage-first hydration, not SSR
- **Surface/component:** `client/src/contexts/theme-context.tsx`
- **Question:** Resume doc spec mentioned server-rendering `<html data-theme=...>`
  before client hydration as the primary no-flash path. Implement?
- **Default chosen:** localStorage-first hydration. Server fetch runs on mount
  and overwrites local state only if it returns valid prefs. Cross-device
  drift (one device's localStorage stale relative to server) results in a
  brief flicker on first paint of that device.
- **Reasoning:** App is a client-only SPA (`createRoot` in `main.tsx`, no
  `renderToString` / `hydrateRoot`). True SSR no-flash requires significant
  SSR scaffolding work beyond Phase B scope. localStorage hydration covers
  the common case (same device, repeat visits) cleanly. Cross-device edge
  case is acceptable per design-system §2.2 — small, brief, infrequent.
- **Where:** `client/src/contexts/theme-context.tsx` (B.5 commit). Document
  in PORT-AUDIT-PHASE-B.md if cross-device flicker is observed during B.6.

### B.5.2 — Preferences shape lives on `users` table, not `organizations.settings`
- **Surface/component:** `shared/models/auth.ts`, schema design
- **Question:** Add appearance prefs to existing `organizations.settings` JSONB
  (where other ad-hoc settings live) or a new column on `users`?
- **Default chosen:** New `appearance_preferences` JSONB column on `users`.
  Migration `0028_user_appearance_preferences.sql` adds it nullable.
- **Reasoning:** Appearance is inherently user-scoped (each person picks
  their own theme). Project memory explicitly notes onboarding state is
  org-scoped, NOT user-scoped — implication is that user preferences belong
  on the user table, not the org. Putting it on `users` keeps the
  multi-user-per-org case clean (each member sees their own theme).
- **Where:** `shared/models/auth.ts:23` (column), `migrations/0028_user_appearance_preferences.sql`.

## Phase C — Personalization infrastructure

### C.1.1 — Sidebar customization scope split: server-persist now, desktop refactor deferred to Phase E
- **Surface/component:** `client/src/hooks/use-nav-preferences.ts`,
  `client/src/components/layout-sidebar.tsx`, `client/src/components/nav-customizer.tsx`
- **Question:** Existing infrastructure (`NavCustomizer` Sheet,
  `useNavPreferences`, flat `ALL_NAV_ITEMS` registry, `MobileBottomNav`)
  customizes mobile bottom bar but NOT desktop sidebar (`NAV_MODULES` in
  `layout-sidebar.tsx` is a separate structured tree). Phase C wants
  full sidebar customization. Refactor layout-sidebar to consume the
  flat registry now, or defer?
- **Default chosen:** Server-persist existing flat prefs via
  `/api/me/preferences` extension (cross-device works for mobile).
  Mount `NavCustomizer` as a trigger button on Settings → Appearance.
  Defer mapping the flat IDs to `NAV_MODULES` filter+reorder for
  desktop sidebar to Phase E, where layout-sidebar gets re-skinned
  to the prototype's `acr-sidebar` shape anyway.
- **Reasoning:** Refactoring layout-sidebar mid-port without the
  prototype-shaped re-skin would create double work (refactor once
  for IDs, refactor again in Phase E for visuals). Phase E E.1 (shell
  / sidebar) will consume the flat registry directly. Mobile customization
  works today; desktop customization arrives with the shell port.
- **Where:** `client/src/hooks/use-nav-preferences.ts` (server-sync),
  `shared/models/auth.ts` (extended AppearancePreferences),
  `client/src/components/settings/appearance-panel.tsx` (trigger),
  Phase C commit. Phase E will land the layout-sidebar refactor.

### C.2.1 — Notification preferences: add quiet hours, defer matrix redesign
- **Surface/component:** `client/src/components/settings/notification-quiet-hours.tsx` (new), existing `notification-preferences.tsx` left as-is
- **Question:** Existing per-event × per-channel matrix works against
  the older `notification_preferences` table schema. Newer service
  (`server/services/notificationPreferences.ts`) carries a richer
  category/event tree. Refactor matrix to consume that, or just add
  quiet hours and defer?
- **Default chosen:** Shipped `<NotificationQuietHours />` card above the
  existing matrix in the notifications tab. Quiet hours stored on
  `users.appearance_preferences.notificationQuietHours`. Existing matrix
  left untouched. Outbound channel paths read quiet hours when wired in
  Phase E.
- **Reasoning:** Matrix redesign couples to a schema migration. Phase E
  touches outbound channel surfaces and is the natural moment to re-skin
  the notifications tab to prototype tone (calm matrix per design-brief
  §6.3). Quiet hours is the genuine gap that ships now.
- **Where:** `client/src/components/settings/notification-quiet-hours.tsx`,
  `client/src/pages/settings.tsx` notifications tab,
  `shared/models/auth.ts` AppearancePreferences extension,
  `server/routes-preferences.ts` Zod schema.

### C.4.1 — Autonomy stored in appearance_preferences blob, not new column
- **Surface/component:** `shared/models/auth.ts` AppearancePreferences,
  `client/src/components/settings/autonomy-panel.tsx` (new)
- **Question:** Autonomy config (per-agent × per-action × thresholds × time
  guards) is operational not appearance — separate JSONB column on
  `users` or extend `appearance_preferences`?
- **Default chosen:** Extended `appearance_preferences` with
  `autonomy: { atlas, pax, sophie, timeGuards }` nested shape. No new
  schema migration needed.
- **Reasoning:** Migration cost and coordination outweigh naming purity
  for now. The blob is "user preferences"; autonomy is one. Phase D
  gates the UI behind a feature flag anyway, and if the shape grows
  unwieldy later it splits cleanly. Server enforcement (agents reading
  config at action time) is wired in Phase E surface-by-surface.
- **Where:** `shared/models/auth.ts` AppearancePreferences,
  `server/routes-preferences.ts` Zod schemas (autonomyLevelSchema +
  agentAutonomySchema + autonomy field), `client/src/components/settings/autonomy-panel.tsx`,
  `client/src/pages/settings.tsx` autonomy tab.

### C.4.2 — Autonomy tab visible without feature flag — flag wires in Phase D
- **Surface/component:** `client/src/pages/settings.tsx` autonomy tab
- **Question:** Design-system §8.4 marks `feature.autonomy-matrix` as
  founder-only until UX polish. Hide the tab now, or ship visible and
  flag in Phase D?
- **Default chosen:** Tab visible to all users in Phase C. Phase D will
  wrap the tab + route in `feature.autonomy-matrix` gating with a
  founder-only default state.
- **Reasoning:** Phase D builds the flag infrastructure; gating before
  the infra exists would be a hide-from-sidebar hack the brief
  forbids (§8.3). Until D ships, tab is visible but server-side
  enforcement of autonomy choices is also pending (Phase E),
  so users can configure but agents don't yet read. Hidden behind the
  /settings → autonomy URL — not in any nav link or hero CTA.
- **Where:** `client/src/pages/settings.tsx` autonomy tab + VALID_TABS,
  Phase D will add flag gate to App.tsx routing.

## Phase D — Feature flag system

### D.1.1 — Extend existing platform_feature_flags table, don't rebuild
- **Surface/component:** `migrations/0029_feature_flag_state_machine.sql`,
  `shared/schema.ts` platformFeatureFlags
- **Question:** Existing table is binary (enabled boolean + controlled_routes).
  Design-system §8 wants 5-state machine. Build a new feature_flags table
  alongside, or extend?
- **Default chosen:** Extended platform_feature_flags with state column
  (5 states), audience jsonb, changed_by, changed_at. Backfilled state
  from enabled. Existing call sites and binary endpoints continue to work.
- **Reasoning:** Single source of truth; one less migration; back-compat
  preserved (old `enabled` field auto-syncs with state). Existing
  featureGate middleware migrated cleanly via featureFlagService wrapper.
- **Where:** `migrations/0029_feature_flag_state_machine.sql`,
  `shared/schema.ts` lines 11299+, `server/services/featureFlags.ts`,
  `server/middleware/featureGate.ts` (rewritten).

### D.4.1 — New /founder/features page coexists with /founder/feature-flags
- **Surface/component:** `client/src/pages/founder/features.tsx` (new)
- **Question:** Existing `/founder/feature-flags` page uses binary Switch
  UI. Replace it, or build a new page at `/founder/features`?
- **Default chosen:** Built new page at `/founder/features` with 5-state
  Select + audience editor. Old `/founder/feature-flags` page left intact
  for back-compat with the older endpoint.
- **Reasoning:** Old page still serves the binary `feature_*` flag keys
  that exist in production data; renaming would break founder muscle memory
  mid-port. Both paths gated by `FounderProtectedRoute`. Phase G polish
  can consolidate if helpful — spec doesn't require it.
- **Where:** `client/src/pages/founder/features.tsx`,
  `client/src/App.tsx` route registration.

### D.5.1 — Autonomy tab gate is component-level, not route-level
- **Surface/component:** `client/src/pages/settings.tsx` autonomy tab
- **Question:** Hide the autonomy tab via `<RequireFlag>` route wrapper or
  conditional render inside the settings page?
- **Default chosen:** Conditional render inside the tabs component using
  `useFlag("feature.autonomy-matrix")`. Tab trigger and content both
  hidden when flag is off; direct `?tab=autonomy` URL hits land on the
  default `general` tab silently.
- **Reasoning:** `/settings` itself is always accessible (it has many
  other tabs); only the autonomy sub-surface gates. A route wrapper
  would 404 the entire settings page. Component-level gate is the
  correct granularity. Server PATCH endpoint is open by design — autonomy
  prefs persist regardless of UI visibility (the brief commits to
  user data being theirs even when surfaces aren't built yet).
- **Where:** `client/src/pages/settings.tsx` lines using `autonomyFlag`.

## Phase E — Surface-by-surface port

### E.1.1 — Shell visuals already match; deeper structural refactor deferred
- **Surface/component:** `client/src/components/layout-sidebar.tsx`,
  `client/src/components/page-shell.tsx`
- **Question:** E.1 spec calls for full shell re-skin. Existing sidebar
  already uses `--acr-sidebar-bg` background, `--acr-surface` active row,
  `--acr-brand` pip on active item, and `sidebar-vibrancy` backdrop-blur.
  Width is 256/68px vs prototype 240/60px — minor 16/8px drift. Is the
  shell already done?
- **Default chosen:** Yes — visual fidelity acceptable, no re-skin of CSS
  needed beyond what already shipped via the unified-build phase 2A work.
  The structural refactor wiring `useNavPreferences.sidebarItems` (flat
  IDs from nav-items.ts) into NAV_MODULES (structured tree of group →
  children) is genuinely a different undertaking — IDs don't correspond
  directly. Deferred until the founder reviews whether the structured
  module hierarchy or the flat registry is the canonical intent.
- **Reasoning:** Per design-system: "If the spacing or color drifts more
  than one step on the scale, you've lost fidelity." 16px width drift
  isn't a step. The structural mismatch (NAV_MODULES vs flat nav-items)
  predates the port; reconciling them isn't a port-driven decision.
  Phase G polish or a future founder review can decide.
- **Where:** Existing shell unchanged this phase. Mobile bottom nav
  customization works via mobile-nav from C.1; desktop sidebar shows
  the full default tree. PORT-AUDIT-PHASE-E.md flags this for review.

<!-- E.1.2 entry deleted — premature stopping conflicts with founder directive
to chain through to Phase H. Resume protocol fires on real context fill,
not at clean checkpoints. -->

### E.7.1 — onboarding-v2.tsx (1543 lines, 56 hardcodes) deferred to Phase G dedicated polish
- **Surface/component:** `client/src/pages/onboarding-v2.tsx`
- **Question:** Onboarding has 56 raw color hardcodes across 1543 lines —
  full re-skin in E.7 or defer?
- **Default chosen:** Defer to Phase G. Onboarding is one of six explicit
  Phase G surfaces (design-system §14: "First impression. Multi-screen
  wizard. Walk-into-a-workspace feel, not a tour overlay. Reference:
  acreos-onboarding/."). Phase G gets full prototype-reference comparison.
- **Reasoning:** Same logic as E.6.1 (founder-dashboard) — partial
  hardcode replacement on a high-stakes Phase G surface risks regression
  without yielding the design care the brief explicitly schedules. E.7
  ports the bounded surfaces (landing already clean per its docstring;
  pricing's single hardcode fixed) and leaves onboarding for Phase G.
- **Where:** No code change. Phase G TODO.

### E.6.1 — founder-dashboard.tsx (7435 lines, 293 hardcodes) deferred to Phase G dedicated polish
- **Surface/component:** `client/src/pages/founder-dashboard.tsx`
- **Question:** Tier 5 calls for re-skinning founder mode surfaces.
  founder-dashboard.tsx is 7435 lines with 293 raw color hardcodes —
  full token replacement requires 100s of edits and risks breakage.
- **Default chosen:** Defer to Phase G dedicated polish. Founder mode is
  one of six explicit Phase G surfaces (design-system §14: "Continuous
  design language with subtle accent + denser layout. Same family,
  deeper data."). Tier 5 commit ports the smaller bounded founder
  surfaces (strategy / experiments) and leaves the dashboard for
  focused polish.
- **Reasoning:** A 7435-line surface with 293 hardcodes isn't a
  re-skin job — it's a near-rewrite. Risk of regression on a daily
  founder-driver surface outweighs the benefit of partial improvement.
  Phase G polish gets dedicated attention with full prototype reference
  comparison.
- **Where:** No code change. Phase G TODO.

### E.2.4.1 — Inbox Pax-draft pre-fill is a feature add, not a visual port
- **Surface/component:** `client/src/pages/inbox.tsx` reply panel
- **Question:** Prototype Inbox surfaces a "Pax drafted a reply · ready to
  review" card with pre-filled suggested copy under the message. Production
  inbox shows a blank textarea. Build the Pax-draft integration in E.2.4?
- **Default chosen:** Defer feature add. E.2.4 ships visual port only —
  added `data-tour="inbox-ai-draft"` anchor for future tour wiring,
  `rounded-card` radius on reply panel, and inline TODO comment marking
  where Pax-draft integration should mount.
- **Reasoning:** Per Phase E directive: business logic / AI integrations
  not changed in port phase. Pax-draft requires a new POST endpoint
  (`/api/ai/draft-reply` per HANDOFF.md §6 stub spec) plus UI surface
  for source attribution + edit/send actions. That's a feature build,
  not a re-skin. Deferred to a focused Pax integration phase post-port.
- **Where:** `client/src/pages/inbox.tsx` reply panel inline TODO comment.

### E.2.3.1 — /parcels/:id has no production analog; port deferred as feature-add
- **Surface/component:** N/A — production has no `/parcels/:id` route
- **Question:** Prototype's Parcel detail surface (Atlas Run panel + map +
  comps + title) has no direct production equivalent. Production's
  `/properties` is a list view; `property-enrichment.tsx` and
  `property-tax.tsx` cover specific enrichment paths but not the
  full parcel detail experience. Build the route now, or defer?
- **Default chosen:** Defer. The prototype's parcel detail is genuinely
  a surface that doesn't exist in production yet — building it would
  be a feature-add, not a port. Phase E is "re-skin existing surfaces
  to match prototype," not "build new surfaces from prototype."
- **Reasoning:** Per Phase E directive "Change functionality. Auth,
  database, AI agents, business logic, integrations remain untouched"
  — adding a new top-level route + Atlas analysis integration at the
  detail level is functional addition not visual port. The Atlas Run
  panel pattern (confidence + comps + recommendation) lives elsewhere
  in production via the existing AVM and Atlas pages; that surface
  gets its design pass when E.5 reaches `/atlas`/`/avm`. If founder
  later decides parcel-detail-as-a-route is wanted, it's a separate
  build phase.
- **Where:** No code change. Tier 1 self-audit will note this as a
  surface deferred from Tier 1 scope.

## Phase F — Capture + tier audit

(reserved)

## Phase G — Polish on extra-attention surfaces

(reserved)

## Phase H — End-to-end verification

(reserved)

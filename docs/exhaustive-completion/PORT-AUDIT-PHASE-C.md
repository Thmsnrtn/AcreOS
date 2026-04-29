# Port Audit — Phase C (Personalization Infrastructure)

Phase C lands sidebar config + notification quiet hours + list-view
preferences + autonomy matrix UI + storage in a single commit.

## What landed

| Sub-phase | Deliverable |
|---|---|
| C.1 | Existing `useNavPreferences` hook + `NavCustomizer` Sheet wired to server-side persistence via `/api/me/preferences#sidebarConfig`. New "Navigation" card on Settings → Appearance opens the customizer. Desktop sidebar refactor deferred to Phase E (JUDGMENT-CALLS C.1.1). |
| C.2 | `<NotificationQuietHours />` card on Settings → Notifications tab. Stores `users.appearance_preferences.notificationQuietHours { enabled, startHour, endHour }`. Existing per-event matrix left unchanged; full notifications-tab redesign deferred to Phase E (JUDGMENT-CALLS C.2.1). |
| C.3 | `useListView(listType)` hook + `useAllListViews()` for Settings UI. `<ListViewsPanel />` card on Settings → Appearance lists 12 known list-types with rows / cards / expand-on-click options. Defaults per design-system §5.5. Surface-level rendering wires up progressively in Phase E. |
| C.4 | `<AutonomyPanel />` on new Settings → Autonomy tab. Per-agent (Atlas / Pax / Sophie) 4-step scale (Observe / Draft / Execute / Autonomous), expand-to-reveal per-action overrides with monetary thresholds where applicable, time guardrails (pause window + daily action limit), reset to recommended defaults. Stored in `users.appearance_preferences.autonomy`. |

All four sub-phases share the same `/api/me/preferences` PATCH endpoint,
keeping the API surface minimal. Schema validation extended with two new
helper schemas (`autonomyLevelSchema`, `agentAutonomySchema`) plus
sidebarConfig / listViews / notificationQuietHours / autonomy fields.

## Static verification — passes

- ✅ `npm run check` clean
- ✅ Five new files (`use-list-view.ts`, `notification-quiet-hours.tsx`,
  `list-views-panel.tsx`, `autonomy-panel.tsx` + AppearancePanel
  extension) integrate with existing Tailwind / shadcn primitives
- ✅ All four Phase C surfaces share the existing `/api/me/preferences`
  endpoint (no new routes, no new migrations — JSONB schema flexes)
- ✅ Defaults defined in `LIST_VIEW_DEFAULTS` and `DEFAULTS` (autonomy)
  match design-system §5.5 / §7.1 enumerations
- ✅ All preference fields validated server-side with strict Zod schemas
  (sidebarItems max 64, mobileItems max 8, levels 0-3, hours 0-23,
  thresholds capped at $10M)
- ✅ Type-check passing means: hooks, components, settings tab structure
  all align with `AppearancePreferences` shape from `shared/models/auth.ts`

## Live-eye verification — required from founder

### Sidebar customization
- [ ] Settings → Appearance → Navigation card shows current sidebar +
      mobile item counts
- [ ] "Customize" button opens the Sheet with reorder + show/hide
- [ ] Mobile bottom bar updates immediately when items toggled
- [ ] Choices persist across sign-out/sign-in (server sync)
- [ ] Desktop sidebar visual ordering does NOT yet apply user prefs —
      that lands in Phase E shell re-skin (per JUDGMENT-CALLS C.1.1)

### Notification quiet hours
- [ ] Toggle on → enabled state saves
- [ ] Start/end hour selectors default to 7 PM → 8 AM
- [ ] Window wrapping midnight is documented in card description (start > end)
- [ ] Cross-device persistence confirmed (sign in elsewhere, toggle reflects)
- [ ] Outbound channels do NOT yet read this — agents read it at action
      time as Phase E touches their channel paths (JUDGMENT-CALLS C.2.1)

### List views
- [ ] Settings → Appearance → List views card shows 12 list-types with
      Select dropdown for each
- [ ] Picking different views persists; Reset to defaults clears overrides
- [ ] Surface-level rendering does NOT yet apply user prefs — wires up
      in Phase E surface ports

### Autonomy matrix
- [ ] Settings → Autonomy tab visible (founder-only flag wires in Phase D)
- [ ] Three agent cards (Atlas / Pax / Sophie) with 4-step scale + role label
- [ ] Active level card highlights and updates description
- [ ] "Per-action overrides" expands to show 3-4 actions per agent with
      level dots
- [ ] Threshold inputs accept dollar amounts (Pax mailerSend, Sophie paymentFlag)
- [ ] Time guardrails: pause window toggle reveals start/end hours; daily
      action limit number input
- [ ] Reset to recommended defaults restores Atlas=2, Pax=1, Sophie=1
- [ ] Server-side enforcement is NOT yet wired — agent action paths read
      this config progressively in Phase E

## Deliberate compromises

1. **Sidebar customization desktop-deferred** (C.1.1) — mobile bottom bar
   applies prefs today; desktop sidebar refactor lands with Phase E
   shell re-skin to avoid double-refactor work.
2. **Notification matrix kept as-is** (C.2.1) — quiet hours added on top;
   full prototype-aligned matrix redesign in Phase E touches outbound
   channels and notifications tab simultaneously.
3. **Autonomy in appearance_preferences blob** (C.4.1) — operational config
   stored in user-preferences blob for now; cleanly splits to its own
   column if shape outgrows the blob.
4. **Autonomy tab visible without flag** (C.4.2) — Phase D adds
   feature.autonomy-matrix gate. Until then the tab is reachable but
   server-side enforcement is also pending (no harm shipping ahead of
   the flag).

## Migration deployment note

Phase C ships **no new migrations** — every new field lives in the
existing `users.appearance_preferences` JSONB column from migration 0028.
Server validates with Zod; bad shapes never persist.

## Next phase

Phase D — feature flag system + founder UI. Resume doc at
`_RESUME-PORT-PHASE-D.md`.

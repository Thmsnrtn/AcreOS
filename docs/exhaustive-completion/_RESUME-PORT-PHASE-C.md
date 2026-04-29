# Resume — Production Port Phase C (Personalization Infrastructure)

**Last commit before Phase C starts:** to be filled by the B.7 tracker
commit. Phase B closed across `e96ef89` / `50f3499` / `77295f3` / `955d1c7`.

**Active directive:** Production port from prototype, autonomous run
through Phase H. See _progress.md for the full phase list. Standing
constraints (do not re-ask):

- No paid design assets (fonts, icons, illustrations, premium UI kits)
- Apple-native auto mode (manual pick wins until user picks Auto)
- HSL tokens kept adjacent to `--acr-*` tokens within each theme block
- `rounded-card: 14px` for cardish surfaces
- All judgment calls go in `JUDGMENT-CALLS.md` (terse, 2-3 sentences)
- Don't run bypass cleanup (Gap 1.1.G) — waits for founder approval

## Phase B completion summary

- ✅ B.1 — 5 themes × light/dark in CSS, `rounded-card` token
- ✅ B.2 — Theme runtime (Apple-native auto, [data-*] attributes)
- ✅ B.3 — 5 self-hosted free font pairings; all CDN refs killed
  (Charter swapped to Source Serif 4 per JUDGMENT-CALLS B.3.1)
- ✅ B.4 — Settings → Appearance panel (Theme / Mode / Type / Density / Motion)
- ✅ B.5 — `users.appearance_preferences` JSONB; GET/PATCH /api/me/preferences;
  debounced server sync from theme-context
- ✅ B.6 — Static verification clean; live-eye checklist in PORT-AUDIT-PHASE-B.md
  for founder review when reachable

Migration `0028_user_appearance_preferences.sql` runs at deploy time —
not yet applied to prod. Client gracefully falls back to localStorage if
the column doesn't exist (404/500 on /api/me/preferences logs warn,
local state stays canonical).

## Phase C objective

Implement the four personalization surfaces called out in design-system
§6.3 + §7. Each is a setting; together they make the app the user's
workspace, not a SaaS rental.

## Phase C steps

### C.1 — Sidebar configuration

Reference: design-system §6.3.

- Schema extension on `users.appearance_preferences` (or a new column if
  it gets unwieldy — judgment call): `sidebarConfig: { visibility:
  Record<string, boolean>, order: string[] }`. Use the existing nav-item
  IDs from `client/src/components/layout-sidebar.tsx`.
- Settings → Sidebar new sub-tab/section with:
  - Drag-to-reorder list of nav items (use `react-beautiful-dnd` or
    similar lightweight DnD; check what's already in deps before adding)
  - Show/hide toggle per item
  - "Reset to defaults" link
- Wire `layout-sidebar.tsx` to read user's sidebarConfig and render
  accordingly. Default ordering applies if user has no config.
- Persist via PATCH /api/me/preferences (or extend if shape grows).

**Gotcha:** the existing `nav-customizer.tsx` may already do part of
this. Read it first; refactor or replace rather than duplicate.

### C.2 — Notification preferences

Reference: design-system §6.3.

- Schema: per-event-type × per-channel matrix +
  per-channel quiet hours. Existing `notificationPreferences` table at
  `shared/schema.ts:4056` and `notification_preferences` jsonb at line
  6965 — read both and decide whether to extend or build a new shape
  matching the design brief (the existing tables may not match).
- Settings → Notifications new section with calm matrix UI: rows are
  event types (deal stage change, agent action completed, payment
  received, etc.), columns are channels (in-app / email / SMS / none).
  Time-window controls per channel ("Don't notify between 7 PM and 8 AM
  local").
- Sensible quiet defaults — not every event opted into every channel.

### C.3 — List-view preferences

Reference: design-system §6.3, §5.5 list-bearing surfaces table.

- Schema on appearance_preferences:
  `listViews: Record<string, "rows" | "cards" | "expand-on-click">`.
  Keys are list-type IDs (pipeline, inbox, contacts, parcels, etc.).
- Each list-bearing surface in production reads its preference key and
  renders accordingly. Defaults per surface from design-system §5.5
  table.
- Settings → Lists new section showing each list type with the three
  options.

### C.4 — Autonomy matrix

Reference: design-system §7. The big one.

- Schema: per-agent × per-action × threshold permissions on
  `users.autonomyConfig` jsonb (new column if needed). Shape:
  ```
  {
    atlas: { level: 0|1|2|3, perAction: { comps, valuations, parcels, market }, thresholds: { ... } },
    pax:   { level: 0|1|2|3, perAction: { replies, mailerDraft, mailerSend, outreach }, thresholds: { mailerSendCents } },
    sophie:{ level: 0|1|2|3, perAction: { servicing, documents, paymentFlag }, thresholds: { paymentFlagCents } },
    timeGuards: { pauseStart: "19:00", pauseEnd: "08:00", dailyActionLimit: 200 }
  }
  ```
- Settings → Autonomy new top-level section with progressive disclosure:
  1. Top: 4-step slider per agent (Observe / Draft / Execute / Autonomous)
  2. Expand-to-reveal per-action overrides + threshold inputs
  3. Time guardrails section
  4. "Reset to recommended defaults" always visible
- Audit log integration: every autonomous action logs what was done +
  sources used + confidence + "would have asked at threshold X". Use
  existing audit infrastructure if present (search `auditLog` /
  `audit_events`).
- Server-side enforcement is mostly Phase E surface work (each agent
  reads autonomy + acts/asks accordingly) — Phase C just builds the UI
  + storage.

## Phase C done bar

- [ ] Sidebar config surface + persistence
- [ ] Notification preferences surface + persistence
- [ ] List-view preferences surface + persistence
- [ ] Autonomy matrix UI with progressive disclosure
- [ ] All four surfaces feel calm despite depth (design-system §7.5)
- [ ] No `npm run check` or test regressions
- [ ] PORT-AUDIT-PHASE-C.md with static verification + live-eye checklist
- [ ] Phase D resume doc written

## Out of scope for Phase C

- Server-side autonomy enforcement (each agent reading config + acting)
  → Phase E surface work
- Audit log surface design (`/audit`) → Phase E
- Feature flag infrastructure → Phase D

## Phase D preview (so C decisions don't paint into a corner)

Phase D builds the founder-mode feature flag system. Flags can be off /
founder-only / beta / tier / on. The autonomy matrix UI from C.4 will
be wrapped in `feature.autonomy-matrix: founder-only` flag (per
design-system §8.4) until UX polish complete. Plan C.4 with that
gate-by-default behavior in mind — the UI ships, users can't reach it
yet.

---

*Phase C is the personalization layer. Phase D unlocks the founder
controls. Phase E ports the actual surfaces.*

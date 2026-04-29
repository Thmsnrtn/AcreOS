# Resume — Production Port Phase E (Surface-by-Surface Port)

**Active directive:** Production port autonomous run through Phase H.
Founder reviews at H complete. Bypass cleanup waits for approval.

Standing constraints (don't re-ask):
- No paid design assets
- Apple-native auto mode
- HSL adjacency in theme blocks
- `rounded-card: 14px`
- Judgment calls in `JUDGMENT-CALLS.md` (terse)
- No autonomous bypass cleanup

## Phase A–D summary

- **A** Design-system extraction → `prototype-design-system.md` (single source of truth for tokens, voice, type, components, density, motion, autonomy spec, feature-flag spec)
- **B** Theme + font + appearance settings + server persistence (5 themes × light/dark, 5 free font pairings, full Settings → Appearance panel, debounced server PATCH)
- **C** Personalization infra (sidebar/mobile-nav prefs server-synced; notification quiet hours; per-list-type view preferences; autonomy matrix UI)
- **D** Feature flag 5-state machine extending existing `platform_feature_flags` table; founder UI at `/founder/features`; autonomy tab gated by `feature.autonomy-matrix`

## Phase E objective

Re-skin every customer-facing production surface to the prototype design.
For each surface: (1) read prototype reference fully, (2) preserve all
business logic + auth + routes, (3) re-skin to prototype visuals using
existing tokens (`--acr-*`, HSL parallel, `rounded-card`), (4) add
states the prototype didn't show but production needs (loading, empty,
error), (5) verify against design brief.

Founder requirement: **Tier 1 self-audit before Tier 2-5.** After
porting today / pipeline / parcels / inbox, walk those surfaces against
design-brief sections (voice, visual baseline, density, motion, component
grammar, AI agent presence). Flag drift, fix it, document in
`PORT-AUDIT-TIER-1.md`. Then continue to Tier 2-5.

## Phase E sub-phases

### E.1 — Shell re-skin (sidebar + topbar)
Reference: `~/Desktop/acreos-design-export/acreos/shell.jsx`.

Affects every page mount. Lands first.

- Re-skin `client/src/components/layout-sidebar.tsx` to prototype sizing
  (240 px / 60 px collapsed), tokens (`--acr-sidebar-bg/ink`), brand strip
  on active, NavItem shape from `acr-nav-item` rules.
- Wire desktop sidebar to consume `sidebarItems` from `useNavPreferences`
  (deferred from Phase C.1 per JUDGMENT-CALLS C.1.1). Map flat IDs to
  the existing NAV_MODULES tree where possible; keep groups intact.
- Re-skin `client/src/components/page-shell.tsx` topbar to `acr-topbar`
  shape (sticky, backdrop-blur, 14×24 padding).
- Mount `<ThemeSettings />` quick-picker as a topbar action button.
- Apply `[data-density]` rules: compact mode tightens row heights;
  comfortable expands.

### E.2 — Tier 1 (daily-driver pipeline core)
Per HANDOFF.md §2.

- E.2.1 — `/today` (Command Center) — reference `pages-tier1.jsx::CommandCenterC`. Highest-attention surface. Hero greeting copy, hot-deals card, today-card, inbox card. Calm dominates. Atlas/Pax/Sophie quiet bylines. All four states.
- E.2.2 — `/pipeline` — reference `pages-tier1.jsx::Pipeline`. Kanban board with filters. Optimistic stage moves. Density adapts.
- E.2.3 — `/parcels/:id` (Parcel detail) — reference `pages-tier1.jsx::ParcelDetailB`. Atlas Run panel, comps, title, ownership.
- E.2.4 — `/inbox` — reference `pages-tier1.jsx::InboxC`. Threads with AI draft button. Pax byline on AI replies.

After E.2.1–E.2.4 → **Tier 1 self-audit** (PORT-AUDIT-TIER-1.md):
- Re-read design-system §1 (voice), §2 (visual baseline), §2.1 (density),
  §2.2 (motion), §5 (component grammar), §1.3 (AI agent framing).
- Walk each Tier 1 surface, compare against rules. Flag deviations.
- Fix issues found. Document in PORT-AUDIT-TIER-1.md.
- Then proceed to Tier 2.

### E.3 — Tier 2 (sourcing)
- /buyboxes, /lists, /campaigns, /campaigns/performance — references in `pages-tier2345.jsx`.

### E.4 — Tier 3 (closing)
- /offers, /documents, /finance, /dispositions.

### E.5 — Tier 4 (ops)
- /agents, /automations, /audit, /team, /billing, /integrations, /contacts, /calendar, plus the existing `/settings` already polished in Phase B-C.
- The notifications tab redesign deferred from C.2.1 lands here when E.5 reaches /integrations (channel paths) and /settings notifications.

### E.6 — Tier 5 (founder mode)
- /founder, /founder/atlas-run, /founder/revenue, /founder/tenants, /founder/cost, /founder/ops.
- Per founder-routes-screenshots/ findings: 4 of these may not be registered as wouter routes. Build the missing ones with prototype visuals.

### E.7 — Landing + pricing + onboarding
- Reference: `~/Desktop/acreos-design-export/acreos-landing/`, `acreos-onboarding/`.
- High-stakes conversion surfaces. Per design-system §14 these get extra polish in Phase G; E ports the structural shape.
- Founder letter goes verbatim somewhere accessible (about / /why).

### E.8 — Per-surface state coverage
- Each surface needs Loading / Empty-zero / Empty-filtered / Error per
  design-system §11. Uses Skeleton / EmptyState / QueryErrorState
  primitives; voice matches prototype `tier-c-wire.jsx::ErrorState`.

### E.9 — Wire deferred items as surfaces port
- **Desktop sidebar customization** (deferred from C.1.1) → wires up in E.1
- **List-view preferences** (deferred from C.3) → each list-bearing
  surface in E.2-E.6 calls `useListView(listType)` to render rows / cards / expand-on-click
- **Notifications matrix redesign** (deferred from C.2.1) → lands in E.5 settings + integrations
- **Autonomy server-side enforcement** (deferred from C.4) → each agent
  action path in E.2-E.6 reads `users.appearance_preferences.autonomy`
  before acting

### E.10 — PORT-AUDIT-PHASE-E.md (or per-tier audits)
After each tier, write per-tier audit. Final E audit consolidates.

## Per-surface fidelity protocol

For each surface in E.2-E.6:

1. Read prototype reference (component letter suffix C wins per HANDOFF.md §3)
2. Read existing production component fully — NEVER delete logic
3. Map prototype CSS to production tokens:
   - Hex colors → `--acr-*` semantic tokens
   - Radii → `rounded-card | rounded-md | rounded-lg`
   - Shadows → `shadow-acr-1 | acr-2 | acr-3`
   - Type → `font-display | font-sans | font-mono` + size scale
4. Replace inline styles with Tailwind utilities; use shadcn primitives
   wherever the prototype's atom maps cleanly (Card, Button, Pill, etc.)
5. Add the four states (loading/empty-zero/empty-filtered/error)
6. Per-surface commit: `port(phase-e.X.Y): re-skin /surface [exhaustive] [port-phase-e]`
   Document: which prototype reference, what got re-skinned, what was preserved, what new states were added, judgment calls

## Bar for Phase E complete

- [ ] Shell (sidebar + topbar) re-skinned
- [ ] All 4 Tier 1 surfaces ported + Tier 1 self-audit complete
- [ ] All 4 Tier 2 surfaces ported
- [ ] All 4 Tier 3 surfaces ported
- [ ] All 8+ Tier 4 surfaces ported
- [ ] All 6 Tier 5 surfaces ported (including 4 unimplemented founder routes)
- [ ] Landing + pricing + onboarding ported
- [ ] Per-surface states designed (loading/empty/error)
- [ ] Deferred Phase C/D items wired progressively as surfaces port
- [ ] No regressions in auth, data, AI agents, integrations, billing
- [ ] PORT-AUDIT-PHASE-E.md (or per-tier audits) written
- [ ] Phase F resume doc

## Out of scope for Phase E

- Polish-pass on six extra-attention surfaces → Phase G
- End-to-end verification across themes × pairings → Phase H
- Bypass cleanup → never autonomous

## Phase F preview

Phase F is the systematic capture + audit pass per tier — re-screenshots
in each theme, persistence verification, audit doc per tier. Phase G
polishes the six extra-attention surfaces (today / onboarding / founder
mode / settings / landing / pricing). Phase H end-to-end verification.

---

*Phase E is the bulk of the port. ~30 surfaces. Multiple sessions
likely needed; resume protocol carries between them.*

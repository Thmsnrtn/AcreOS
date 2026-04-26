# AcreOS — Prototype → Production Handoff

> One document, read top to bottom. Tells a developer what the prototype proves, what to keep, what to throw away, and the order to build it in.

The prototype lives in `/acreos/*.jsx` (loaded by `acreos.html` via Babel-in-the-browser). The real product lives in `/client/*` (Vite + React + TS + Tailwind + shadcn/ui + wouter + Tanstack Query). **Nothing in `/acreos` ships.** It's a spec.

---

## 1. What the prototype is, and isn't

**Is.** A working clickthrough of every primary surface — Command Center, Inbox, Pipeline, Parcel detail, Buy Boxes, Lists, Campaigns, Offers, Documents, Seller Finance, Dispositions, Agents, Automations, Audit, Founder mode (Atlas Run, Tenants, Revenue, Cost, Ops), plus onboarding, command palette, guided tour, and ~30 modal/empty/error states.

**Isn't.**
- Not architected. Multiple versions of the same page coexist (`CommandCenter`, `CommandCenterB`, `CommandCenterC`) and the active one is picked by `window.X ? <X /> : <fallback />` ladders. **The letter suffix means "later iteration," and only the highest letter is canonical.** See §3.
- Not data-driven. Every list, table, and chart is a frozen literal in `/acreos/data.jsx` or inlined in the page file. Production must replace these wholesale — see §6.
- Not real React. Inline Babel, no module system, no types, no router. Globals on `window.*` are how files communicate. Treat every `window.X` as a TODO — see §4.
- Not styled with Tailwind. Uses hand-written CSS strings injected at runtime (`SHELL_CSS`, `CC_CSS`, etc.). Production will rewrite in Tailwind utilities + shadcn primitives. The **values** (spacing, color, type) are the spec; the **mechanism** is throwaway. See §5.

If a developer reads only one section, read this one and §3.

---

## 2. Build order

Don't try to port everything. Ship in this order — each tier delivers user value standalone.

| Tier | Surfaces | Why first |
|---|---|---|
| **0 · Shell** | Sidebar, top bar, toast host, command palette (⌘K), keyboard shortcuts | Every other page mounts inside it |
| **1 · Pipeline core** | Command Center, Pipeline, Parcel detail, Inbox | The daily-driver loop. If these three are right, the product is usable |
| **2 · Sourcing** | Buy Boxes, Lists, Campaigns, Campaign Performance | Feeds Pipeline. Build after pipeline works so you know what shape data flows in |
| **3 · Closing** | Offers, Documents, Seller Finance, Dispositions | End-of-funnel. Lower volume; tolerates rougher edges |
| **4 · Ops** | Agents, Automations, Audit Log, Settings, Team, Billing, Integrations, Contacts, Calendar | Internal/admin. Build last |
| **5 · Founder mode** | Founder Home, Atlas Run, Tenants, Revenue, Cost, Ops | Internal-only. Ship after external-facing tiers stable |

Onboarding and the guided tour come **after** Tier 1 — they need real pages to introduce. The prototype's onboarding (`/acreos/onboarding.jsx`) is a reference for tone and shape, not a dependency.

---

## 3. Canonical page table

Each prototype page exists in 1–3 versions. Build only the canonical one. Letter suffix = iteration number; **highest letter wins**. Where no letter exists, the unsuffixed version is canonical.

| Route | Canonical component | File | Older versions to ignore |
|---|---|---|---|
| `/` (home) | `CommandCenterC` | `pages-tier1.jsx`? — confirm with grep `CommandCenterC =` | `CommandCenter`, `CommandCenterB` |
| `/inbox` | `InboxC` | search `InboxC =` | `Inbox`, `InboxB` |
| `/parcels/:id` | `ParcelDetailB` | search `ParcelDetailB =` | `ParcelDetail` |
| `/settings` | `SettingsC` | search `SettingsC =` | `Settings` |
| `/founder` | `FounderHomeC` | search `FounderHomeC =` | `FounderHome`, `FounderHomeB` |
| `/founder/atlas-run` | `AtlasRunC` | search `AtlasRunC =` | `AtlasRun` |
| `/founder/revenue` | `FounderRevenueC` | search `FounderRevenueC =` | `FounderRevenue` |
| `/pipeline` | `Pipeline` | `pages-tier1.jsx` | — |
| `/contacts` | `Contacts` | `pages-tier1.jsx` | — |
| `/calendar` | `CalendarPage` | `pages-tier1.jsx` | — |
| `/buyboxes` | `BuyBoxes` | `pages-tier2345.jsx` | — |
| `/lists` | `Lists` | `pages-tier2345.jsx` | — |
| `/campaigns` | `Campaigns` | `pages-tier2345.jsx` | — |
| `/campaigns/performance` | `CampaignPerf` | `pages-tier2345.jsx` | — |
| `/offers` | `Offers` | `pages-tier2345.jsx` | — |
| `/documents` | `Documents` | `pages-tier2345.jsx` | — |
| `/finance` | `SellerFinance` | `pages-tier2345.jsx` | — |
| `/dispositions` | `Dispositions` | `pages-tier2345.jsx` | — |
| `/agents` | `AgentWorkspace` | `pages-tier2345.jsx` | — |
| `/automations` | `Automations` | `pages-tier2345.jsx` | — |
| `/audit` | `AuditLog` | `pages-tier2345.jsx` | — |
| `/team` | `Team` | `pages-tier2345.jsx` | — |
| `/billing` | `Billing` | `pages-tier2345.jsx` | — |
| `/integrations` | `Integrations` | `pages-tier2345.jsx` | — |
| `/founder/tenants` | `FounderTenants` | search | — |
| `/founder/cost` | `FounderCost` | search | — |
| `/founder/ops` | `FounderOps` | search | — |

**Procedure when porting a page:** open `acreos/app.jsx` switch statement, find the `case '<route>':` line, follow the `window.X ? <X /> : ...` ladder and pick the highest-letter component that exists. Then `grep "ComponentNameC ="` to find its definition. Older versions stay in the prototype file but **don't port them** — they exist only so we could compare alternates during design.

---

## 4. Globals → real architecture

The prototype uses `window.*` as a poor man's context. Replace each as follows.

| Global | What it does in the prototype | Production replacement |
|---|---|---|
| `window.__nav(id)` | Page navigation from any descendant | `useLocation()` from wouter, or `<Link>` |
| `window.__acr.openLost(deal)` | Opens "why I lost" capture modal | Global modal store (Zustand) — `useModals().openLostReason(deal)` |
| `window.__acr.openClosed(deal)` | Opens deal-closed celebration | Same store — `useModals().openDealClosed(deal)` |
| `window.__acr.openQuickOffer()` | Opens ⌘N quick-offer modal | Same store — `useModals().openQuickOffer()` |
| `window.__founderMode` | Sidebar shows founder routes | `useFlags().founderMode` — feature flag in user context |
| `window.__r3SoundOn` | Ambient UI sound on/off | User preference in settings; `useSettings().soundEnabled` |
| `window.__playSound(kind)` | Ticks/chime on key actions | `useSound()` hook wrapping `Howler` or native Audio |
| `window.__pageState` + `acr-state` event | Forces empty/loading/error overlay (tweaks-only) | **Throw away.** Each page handles its own states via Tanstack Query (`isLoading`, `isError`, `isEmpty`) |
| `window.__acrLaunchTour()` | Replays guided tour | `useTour().start()` — see §7 |
| `window.toast({label, kind})` | Toast notification | `sonner` (already in deps) — `toast.success(label)` etc. |
| `window.ToastHost` | Mounts toast container | `<Toaster />` from sonner at app root |
| `window.PageTransition` | Route-change fade | Framer Motion `<AnimatePresence>` keyed on location |
| `window.StateOverlay`, `window.StatesController`, `window.PageStateListener` | Tweaks-driven state preview | **Delete entirely.** Tweaks panel is prototype-only |
| `window.GuidedTour` | Mounts tour overlay | Replaced by real tour — see §7 |
| `window.__regenIndex` | Cycles through canned AI draft variants | Real model call. Or stub with deterministic backend in dev |
| `window.CommandCenterC`, `window.InboxC`, etc. | Lets later files override earlier ones | **Delete pattern.** Just import the canonical component |
| `window.TIER_B_CSS`, `window.TIER_C_CSS`, etc. | CSS-string accumulation | Delete. Tailwind |

Every `window.*` reference in the codebase should result in either (a) a hook call, (b) a router action, or (c) a delete. None should survive the port.

---

## 5. Design tokens

The prototype's CSS strings encode the design system. Pull these into Tailwind config (`tailwind.config.ts`) and CSS variables on `:root`. Then delete the CSS strings.

**Where to find values:** open `acreos/theme.jsx` for the canonical palette and type scale. `acreos/round3-css.jsx` and `acreos/round3-integrations-css.jsx` add a few motion + microinteraction tokens. `SHELL_CSS` (in `shell.jsx`) defines spacing rhythm.

**Token categories.** Color (surface, fg, accent, danger, success, warning, founder-purple), spacing (acr- prefix; 4/8/12/16/24/32/48/64), radius (acr-r-sm/md/lg), shadow (sm/md/lg/elevated), type (display/h1/h2/h3/body/small/mono), z-index (sidebar, header, drawer, modal, palette, toast, tour).

**Don't invent.** Lift the literal values; don't approximate. The prototype's exact hexes are what design signed off on.

**Migration check.** When a page is ported, search the resulting Tailwind classes against the prototype's CSS — if the spacing or color drifts more than one step on the scale, you've lost fidelity.

---

## 6. Data sources

Every list/table/chart in the prototype is a literal. Replace each.

| Prototype literal | Production source | Shape (rough) |
|---|---|---|
| `DEALS` (data.jsx) | `GET /api/deals?stage=&owner=&buybox=` | `{id, parcel, county, stage, owner, value, lastTouch, hot}` |
| `PARCELS` | `GET /api/parcels/:id` | `{id, apn, address, acreage, owner, lat, lng, comps[], titleStatus}` |
| `INBOX_THREADS` | `GET /api/inbox?folder=` (or webhook'd from email/SMS) | `{id, channel, from, subject, snippet, dealId?, ts, unread}` |
| `BUYBOXES` | `GET /api/buyboxes` | `{id, name, county[], priceRange, acreageRange, criteria{}, active}` |
| `LISTS` | `GET /api/lists` | `{id, name, source, count, lastRefreshed}` |
| `CAMPAIGNS` | `GET /api/campaigns` | `{id, name, listId, channel, status, sent, replied, costPerLead}` |
| `OFFERS` | `GET /api/offers` | `{id, dealId, amount, terms, sentAt, status}` |
| `DOCUMENTS` | `GET /api/deals/:id/documents` | `{id, type, name, sentAt, signedAt?, url}` |
| `AUDIT_EVENTS` | `GET /api/audit?actor=&entity=` | `{id, actor, action, entity, ts, diff}` |
| `AGENT_RUNS` | `GET /api/agents/runs` | `{id, agentName, trigger, status, startedAt, durationMs, outputs}` |
| Atlas-Run analysis | `POST /api/atlas/analyze {parcelId}` returns `{recommendation, confidence, comps, riskFactors, suggestedOffer}` | (this is the AI valuation — model-backed) |
| AI draft replies (`REGEN_VARIANTS`) | `POST /api/ai/draft-reply {threadId, intent}` | `{text, sources[]}` |
| Founder/Atlas metrics | `GET /api/founder/atlas` | tenant rollup; admin-only |

**Loading + error.** Every data fetch uses Tanstack Query. Pages must show real skeleton/empty/error states (the prototype's Tweaks-driven previews aren't authoritative — they were just for review). Use `<Skeleton>` from shadcn for loading, design-system `<EmptyState>` (build one, reuse) for empty, and a recoverable `<ErrorState>` with retry for errors.

**Optimistic updates.** Anything user-initiated that returns to the same view (move deal stage, mark thread read, send offer) should optimistically update. Anything that creates a new entity should not — wait for server.

---

## 7. Onboarding & guided tour

The prototype has two flows: a 6-step initial onboarding (`onboarding.jsx`) and an in-app guided tour (`guided-tour.jsx`).

**Onboarding** uses `localStorage['acr-onb-done']` to remember completion. **Replace with** `user.onboardedAt` on the user record (server). Show onboarding when `user.onboardedAt == null`. Don't trust client storage alone — users sign in on multiple devices.

**Guided tour** uses `localStorage['acr-fr-<id>']` per-step "first run" flags. **Replace with** `user.tourState: { stepsSeen: string[], dismissed: boolean }` on the server. The prototype's `window.__acrLaunchTour` becomes `useTour().restart()` — wired to a settings-page button.

**Tour selectors.** The prototype targets DOM elements by hand-written selectors (search `data-tour=` in the prototype files). When porting, **add the same `data-tour="X"` attributes to the real components** so the production tour can hook the same anchors. Don't switch to refs — `data-tour` survives refactors better and keeps the tour decoupled from component internals.

Tour anchors to preserve (audit before deleting any during port):
- `data-tour="cmd-palette-trigger"` — top-bar ⌘K button
- `data-tour="sidebar-pipeline"` — pipeline nav item
- `data-tour="hot-deals"` — Command Center hot-deals card
- `data-tour="quick-offer"` — quick-offer button (⌘N)
- `data-tour="parcel-atlas"` — Atlas Run panel on parcel detail
- `data-tour="inbox-ai-draft"` — inbox AI draft button

(If a selector above doesn't appear in the current prototype, the tour was rewritten — re-grep before relying on this list.)

---

## 8. Empty / loading / error states

Each canonical page must have all four states. The prototype previews them via the Tweaks panel's "page state" toggle (`StateOverlay` / `StatesController`); that machinery is **not** the implementation, it was just so reviewers could see all four without backend setup.

Per-page state checklist (port-time TODO for each):

- [ ] **Loading.** Skeleton matching final layout. Not a spinner.
- [ ] **Empty (zero data).** First-run friendly. Includes the primary CTA inline (not just "no data").
- [ ] **Empty (filtered to zero).** Different from zero-data. Tells user *what filter* is hiding things, with a clear button.
- [ ] **Error.** Recoverable. Retry button. The prototype's `ErrorState` in `tier-c-wire.jsx` (`DataTree timed out` example) is the canonical voice — specific, attributes blame correctly, doesn't say "Something went wrong."

Pages with state designs already prototyped (port them faithfully): Command Center, Inbox, Pipeline, Parcel detail. Other pages: design states at port time, matching the four prototyped pages' tone.

---

## 9. Tweaks panel — fate of each toggle

The Tweaks panel (`acreos/app.jsx`, lines ~250+) is a **review tool, not a feature**. Most toggles ship as nothing. A few become real settings.

| Tweak | Ships as |
|---|---|
| Show onboarding | Delete. (Onboarding fires from server flag) |
| Open ⌘K palette | Delete. (Real keybind already does this) |
| Replay guided tour | Becomes a button in Settings → Help |
| Sound on | **Real setting** — Settings → Preferences → Sound effects |
| Day-1 empty Command Center | Delete. (Real first-run state handles this) |
| Show "without AcreOS" faded | Delete. (Marketing-only artifact) |
| Founder mode | **Real flag** — server-side, role-gated |
| Trigger lost / Quick offer / Reset tooltips | Delete |
| Page state (normal/empty/loading/error) | Delete |
| Show copy voice card | Delete. (Designer-internal reference) |
| Sidebar collapsed | **Real preference** — persisted per user |

The Tweaks-panel infrastructure itself (`tweaks-panel.jsx`) does not ship.

---

## 10. Mobile / responsive

The prototype is desktop-only (sidebar app, dense tables). Two questions to resolve **before** porting:

1. **Does AcreOS support mobile at launch?** If no, the prototype as-is reflects the spec — `min-width: 1024px` and a "best on desktop" splash on smaller. If yes, we need to design a mobile pass before the port. **Ask the team.**
2. **If yes:** Inbox and Command Center are the only surfaces with realistic mobile use cases (triaging on the go). Pipeline, Parcel detail, Buy Boxes etc. are desktop-bound by data density. A reasonable cut: mobile = read-only Inbox + Command Center; everything else redirects to a "desktop required" page.

This is open. Don't guess.

---

## 11. Accessibility

Prototype is not accessibility-audited. Production must hit WCAG 2.1 AA. Notes from a passive review of the prototype:

- **Focus rings.** Stripped in many places via `outline: none` without replacement. Production: every interactive element has a visible focus indicator using the design system's focus-ring token.
- **Keyboard.** ⌘K palette works. Sidebar nav is `<button>` so tab works. Pipeline drag-drop is mouse-only — needs a keyboard alternative (arrow-keys-to-move-between-stages, or "Move to…" menu).
- **ARIA.** Tables use semantic `<table>` ✓. Modals lack `role="dialog"` and focus trap — fix in production. Toasts need `aria-live="polite"` (sonner does this for free).
- **Color contrast.** Founder mode uses a deep purple on near-black — verify token contrast at port time.
- **Motion.** Guided tour and page transitions need to respect `prefers-reduced-motion`.

---

## 12. Demo click-through script

For sales/QA. Use this to verify the production build before each release.

> **Setup:** clean tenant, seeded with 12 deals across stages, 4 buyboxes, 30 inbox threads (8 unread), 2 active campaigns.

1. **Land on Command Center.** Verify hot-deals card shows 3 hot deals; today-card shows 2 tasks; inbox card shows 8 unread.
2. **Click a hot deal** → lands on Parcel detail. Atlas Run panel shows recommendation + confidence + 3 comps. Title status and ownership are populated.
3. **Click "Draft offer"** → modal opens, prefilled with Atlas-suggested amount. Send.
4. **Back to home, ⌘K** → palette opens. Type "inbox" → enter → lands on Inbox.
5. **Click an unread thread** → message + thread history. Click "Draft reply" → AI draft appears. Edit, send. Thread marks read.
6. **Sidebar → Pipeline.** Drag a deal from "Negotiating" to "Under Contract" — optimistic move; toast confirms. Refresh page; deal stays moved.
7. **Sidebar → Buy Boxes** → open one → criteria editor → save. Verify toast.
8. **Sidebar → Campaigns → Performance** → chart renders, table populated. Filter by date range.
9. **Trigger an error.** (DevTools → throttle network to offline.) Refresh Command Center → error state with retry. Re-enable network, retry → success.
10. **Founder mode.** (Toggle role to admin.) Sidebar shows founder section. Open Atlas Run dashboard → tenant table loads. Open one tenant → drill-in.
11. **Replay tour.** Settings → Help → Replay guided tour. Six steps, each anchors to its `data-tour` element.
12. **Sign out.** Sign back in. Onboarding does NOT replay (unless onboardedAt is null on this user).

If any step fails → bug. If a step is ambiguous → spec gap; come back here.

---

## 13. What's not in this handoff

- **Visual specs per component.** Use the prototype as the visual source of truth. If the prototype has it, the production should look identical (in Tailwind/shadcn equivalents).
- **API schemas in detail.** §6 sketches shapes. Backend team owns the actual contracts.
- **Authorization model.** Founder mode is the only role distinction surfaced visually. Real roles (admin, user, viewer) are backend's call.
- **Internationalization.** Prototype is English-only. If i18n matters, surface every string through `t()` at port time.

---

## 14. Open questions for the team

These came up during the prototype build and were never resolved. Resolve before / during port:

1. Mobile support? (§10)
2. Founder mode — internal-only forever, or eventually customer-visible "admin" mode?
3. Atlas Run — sync API call or async job with notification?
4. Do we ship sound on by default, off by default, or off + nudge to enable?
5. Onboarding — skippable, or required-on-first-login?
6. How does Tour state sync across devices? (Server, per-user, vs. accept duplication.)
7. Tweaks-panel "without AcreOS" view — does this live in marketing site instead?

Bring these to the next product sync; do not let them ship as developer judgment calls.

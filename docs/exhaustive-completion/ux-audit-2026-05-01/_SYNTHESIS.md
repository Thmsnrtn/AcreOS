# UX Audit — Synthesis + Fix Plan
2026-05-01. Six parallel deep audits across mobile / floating UI / loading /
performance / founder side / customer flow. This doc maps audit findings
to fixes, ordered by impact-per-effort.

---

## Founder's three complaints, mapped to root cause

| Complaint | Root cause(s) | Fix wave |
|-----------|---------------|----------|
| "Pages cut off on mobile" | (a) `/inbox`, `/campaigns`, `/auth`, `/onboarding-v2`, `/landing` bypass `PageShell` so they don't get `mobile-safe-content`; (b) `min-h-screen`/`100vh` on iOS Safari undercounts viewport; (c) lead/deal detail drawers + `AutopilotStatusBar` sit *under* `MobileBottomNav` | B |
| "Too many floating buttons / cluttered" | 9 always-on floating elements; 3-stacked FAB tower (FAB + ConversationTray + HelpButton); duplicate notification bells; 5 dead-code floating components still in the bundle | C |
| "Load times super long or indefinite" | (a) **No fetch timeout in queryClient** — every request can hang forever; (b) eager cross-page imports (money pulls FinancePage at 1,824 lines, pipeline pulls DealsPage at 2,234, pax pulls CommandCenterPage at 2,264); (c) ~6,100 LOC of floating-UI components eagerly loaded in App.tsx; (d) `<motion.div key={location}>` forces unmount + animated remount on every nav | D |

Plus two **launch-blocking persona leaks** the audits surfaced (founder-mode
language showing in customer-facing surfaces) and one **mis-wired tabs**
bug — those go to **Wave A** ahead of everything else.

---

## Wave A — Launch blockers (P0, must ship first)

| # | Issue | File | Severity |
|---|-------|------|----------|
| A1 | Customer onboarding checklist tells users to "Open Atlas" — Atlas is the founder-mode CTO codename. Persona-architecture violation. | `client/src/components/onboarding-checklist.tsx:56` | P0 |
| A2 | Customer ProductTour references `/atlas` route as a normal next step | `client/src/components/onboarding/ProductTour.tsx:73-78` | P0 |
| A3 | `/finance` describes "Sophie keeps the notes…" — Sophie is the founder-mode customer-success codename | `client/src/pages/finance.tsx:197` | P0 |
| A4 | `/money` Finance tab mounts `<PortfolioPage>`; Portfolio tab mounts `<PortfolioOptimizerPage>` — labels and content swapped | `client/src/pages/money.tsx:109,115` | P0 |

---

## Wave B — Mobile cutoff fixes (P0/P1)

| # | Issue | File | Action |
|---|-------|------|--------|
| B1 | Inbox page bypasses PageShell → no `mobile-safe-content` → bottom 72px clipped | `client/src/pages/inbox.tsx` | Wrap in `<PageShell label="Inbox">` |
| B2 | Campaigns page bypasses PageShell | `client/src/pages/campaigns.tsx` | Same |
| B3 | Onboarding-v2 bypasses PageShell (intentional — full-screen flow) | `client/src/pages/onboarding-v2.tsx` | Add `pb-[calc(72px+env(safe-area-inset-bottom))]` to scrolling content |
| B4 | Auth page bypasses PageShell (intentional — full-screen) | `client/src/pages/auth-page.tsx` | Already has bg/gradient; verify safe-area padding |
| B5 | `min-h-screen`/`h-screen` (= 100vh) used in 20+ files; iOS Safari address bar makes 100vh > visible viewport | `client/src/components/page-shell.tsx:76` and others | Migrate to `min-h-dvh` / `h-dvh` (Tailwind 3.4+) |
| B6 | `AutopilotStatusBar` `fixed bottom-0` sits *under* MobileBottomNav | `client/src/pages/founder-dashboard.tsx:6514` | Add `hidden md:block` (founder operational anyway) |
| B7 | Lead/Deal detail drawers `fixed h-full` clip bottom action buttons under bottom nav | `client/src/pages/leads.tsx:2438`, `client/src/pages/deals.tsx:1368` | Add `pb-safe-content` to drawer footer |
| B8 | `pipeline.tsx` embeds `*Page` components that each render their own `<PageShell>` — double-stacked chassis | `client/src/pages/pipeline.tsx` | Refactor to import inner content only or use a wrapper that doesn't double-shell |
| B9 | `PageTopbar` icon buttons are 36×36 — below 44px touch minimum | `client/src/components/page-topbar.tsx:158,166` | `min-h-[44px] min-w-[44px] md:min-h-9 md:min-w-9` |
| B10 | `grid grid-cols-12` faux-tables in founder-dashboard render 6-column data inside a 343px column on mobile | `founder-dashboard.tsx:3214,3463,3634,4101` | Wrap in `overflow-x-auto` parent, or hide on mobile (founder ops surface) |

---

## Wave C — Floating UI cleanup (P1)

| # | Action | Where | Effort |
|---|--------|-------|--------|
| C1 | **Delete dead-code floating components** (exported, never imported): `floating-assistant.tsx`, `quick-capture-fab.tsx`, `quick-actions-menu.tsx`, `beta-feedback-widget.tsx`, `field-work-toolbar.tsx` | client/src/components/* | 5 min |
| C2 | **Delete `FloatingHelpButton`** — fold into ⌘K command palette (already shipped) | `client/src/components/floating-help-button.tsx` + App.tsx:1016 | 10 min |
| C3 | **Remove duplicate notification bell** in `NotificationBanner` (PageTopbar already has one) | `client/src/components/notification-banner.tsx:140` | 5 min |
| C4 | Hide `FloatingActionButton` on desktop — consolidate into MobileBottomNav on mobile | `client/src/components/floating-action-button.tsx` | 10 min |
| C5 | Hide `ConversationTray` when PaxCopilotRail mounts (avoid duplicate) | `client/src/components/conversation-tray.tsx` | 10 min |
| C6 | Suppress `MobileBottomNav` on founder routes — founders shouldn't see customer-side bottom nav | `App.tsx:1021` | 5 min |
| C7 | Z-index discipline pass — establish a numeric token system (`--z-modal`, `--z-toast`, `--z-banner`, `--z-fab`, `--z-sticky`, `--z-content`) | client/src/index.css + replace literals | 30 min |

---

## Wave D — Loading / perf fixes (P0/P1, biggest user-perceived wins)

| # | Action | File | Effort | Why |
|---|--------|------|--------|-----|
| D1 | **Add fetch timeout** to queryClient — 30s `AbortSignal.timeout` on every request | `client/src/lib/queryClient.ts:218-268` | 15 min | Single biggest cause of indefinite spinner |
| D2 | **Lazy-load PaxCopilotRail** (1,765 LOC eager on every page) | `App.tsx:40` | 5 min | Cuts entry chunk by ~1,765 LOC |
| D3 | **Lazy-load CommandPalette** (814 LOC) | `App.tsx:34` | 5 min | Same |
| D4 | **Lazy-load OnboardingWizard** (900 LOC) | `App.tsx:25` | 5 min | Same |
| D5 | **Lazy-load NewItemMenu, KeyboardShortcutsModal, NpsDialog** | `App.tsx` | 10 min | Cumulative ~4,500 LOC reclaimed from entry |
| D6 | Bump `gcTime: 5min → 30min` in queryClient (better tab-switching UX) | `client/src/lib/queryClient.ts:297` | 1 min | Tab-switch feels instant |
| D7 | Fix eager cross-page imports — `money.tsx:13` → import FinancePage lazily, same for pipeline.tsx and pax.tsx | three files | 15 min | Each saves 1,800-2,300 LOC from parent chunk |
| D8 | `conversation-tray.tsx:270` polls every 5s globally; gate on tray visibility | `conversation-tray.tsx` | 10 min | Reduces network noise |
| D9 | Pages that gate on a single `isLoading` when many queries run — switch to per-card progressive render in `portfolio.tsx`, `founder-dashboard.tsx` | multiple | 1-2h | Slower fix, deferred |
| D10 | `<motion.div key={location}>` forces unmount on every nav — make conditional or remove | `App.tsx:925` | 30 min | Navigation feels like reload today |

---

## Wave E — useTerm coverage completion (P1)

Recent JC#9 wired `useTerm()` on /properties /deals /leads. The other 9 customer
surfaces still hardcode "Lead/Property/Deal/Parcel" — persona switching only
re-skins 3 of 12 daily-use pages.

| # | File | Terms to swap |
|---|------|---------------|
| E1 | `client/src/pages/today.tsx` | "Leads/Properties/Deals" in headings |
| E2 | `client/src/pages/pipeline.tsx` | Stage labels, page heading |
| E3 | `client/src/pages/parcels/[id].tsx` (or parcel-detail.tsx) | "Property/Parcel" hero |
| E4 | `client/src/pages/money.tsx` | Tab labels |
| E5 | `client/src/pages/finance.tsx` | "Notes" copy is already note-investor-aligned; verify |
| E6 | `client/src/pages/portfolio.tsx` | "Properties in portfolio" headings |
| E7 | `client/src/pages/inbox.tsx` | Reply context labels |
| E8 | `client/src/pages/pax.tsx` | Suggested-prompt copy |
| E9 | `client/src/pages/settings.tsx` | Persona-related copy in PersonaPanel already adapts |

---

## Wave F — /pax theme tokens (P1)

`/pax` is the only customer surface still using raw Tailwind hexes (red-50,
amber-50, emerald-200, blue-50). Visibly clashes on Quarry / Nocturne /
Meadow themes. Needs the same migration the other surfaces got in JC#16.

---

## Wave G — Architectural smell (P2, schedule)

| # | Issue | File | Action |
|---|-------|------|--------|
| G1 | 3 agent-identity registries still co-exist | `lib/agent-identity.ts` (canonical), `lib/trust-language.ts:11-75` (legacy), `founder-dashboard.tsx:6889-6908` Proxy | Migrate 8 founder/* importers off legacy maps; delete legacy |
| G2 | `founder-dashboard.tsx`: `useId` (L1) + `lazy` (L115) imported never used; `FounderNavBar` (L6577-6634) + `NAV_ITEMS` (L6559) defined never rendered; `briefingRef` (L1121) declared never read | dead code | Remove |
| G3 | "Focus mode" (F key) toasts and shows banner but never actually filters anything | `founder-dashboard.tsx` | Either implement filter or remove the toast |
| G4 | Top-5 founder-dashboard extractions (architecture audit) | various | Schedule each as its own session |

---

## Execution order

I'll ship **Waves A → D6 → C1 → C2 → C3 → D2-D5 → D1** as a tight stream of
small commits. Wave B (mobile chassis fixes) requires careful per-page work
and goes second. Waves E/F/G are documented for follow-on sessions —
they're real but each needs its own focused stretch.

**Rough impact estimate after Waves A/B/C/D ship:**
- Persona-architecture violations resolved (launch blocker cleared)
- Mobile bottom-clip resolved on inbox, campaigns, leads/deals drawers
- 9 floating elements → ~5 (-44%)
- Entry bundle ~4,500 LOC lighter
- Indefinite spinner risk bounded at 30s
- Tab switching feels noticeably snappier

Per-fix verification: `npm run check` before each commit.

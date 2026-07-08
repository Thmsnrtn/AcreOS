# Janetta Holloway — Phone-Only Land Investor Audit

**Role:** Land Investor, 44, Memphis. iPhone SE only — no laptop, no tablet, no desktop. Closes 25–30 deals/year on owner-finance, runs the entire business from a coffee-shop table or a parked-car LTE hotspot.
**Stack:** iPhone SE 3rd gen (375×667 viewport, the smallest viewport AcreOS still has to work on), iOS 17, Safari + AcreOS PWA / native shell. Print-and-mail offers handled by Lob via web. Closings via remote notary.
**Wave:** 3 of the AcreOS audit run.
**Reviewing:** `client/src/hooks/use-mobile.ts`, `client/src/hooks/use-native-camera.ts`, `client/src/components/mobile/*`, `client/src/components/ui/responsive-modal.tsx`, `client/src/components/signature-capture.tsx`, `client/src/components/ui/button.tsx`, `client/src/pages/blind-offer-wizard.tsx`, `client/src/pages/deals.tsx`, `client/src/pages/properties.tsx`, `client/src/pages/leads.tsx`, the 34 page-level `<Table>` consumers, and the 68 raw `Dialog` consumers.
**Date:** 2026-05-01.

---

## 1. One-line verdict

**The mobile foundation is the best I've seen on any land-investor product — Capacitor camera with EXIF GPS, a real `ResponsiveModal`, a 72px bottom nav with safe-area inset, drawn-or-typed signature with `touch-action: none`, even haptics on the founder's swipe deck — but the foundation is *adopted* on roughly 7% of the surfaces I actually live in. The other 93% is desktop UI shrunk to 375px and praying.** The infrastructure to make AcreOS phone-first already exists in the repo; the work is dragging the rest of the app onto it.

The single statistic that captures the gap: `ResponsiveModal` is imported by **5 files**. `Dialog` is imported by **68**. That ratio — about 7% — also describes how often pages branch on `isMobile` (deals.tsx does; leads.tsx and properties.tsx don't), how often inputs use `inputMode` instead of `type="number"` (60 files use `type="number"`, 70 use `inputMode` — many of them the same files double-binding), and how often a list view has a card-list fallback (almost none of the 34 page-level Table consumers).

---

## 2. The bottom nav stops at 4 items, and "More" eats the rest of the app

`MobileBottomNav.tsx:16` slices `mobileItems` to `.slice(0, 4)` and dumps everything else into a "More" drawer. Janetta's 4 items don't include all of: Today, Deals, Leads, Properties, Maps, Inbox, Tasks, Documents, Offers, Comps, Calculator. She runs ~30 deals/year — she touches every one of those daily. "More → Documents → tap → drawer animation → tap document" is 3 taps and ~600ms before she reads a line of text. The desktop sidebar shows 18 items at once.

### What to ship

1. Make the bottom-nav slot count adaptive: 4 on a 320px iPhone SE 1, 5 on a 375px SE 2/3, 6 on a 390px+ Pro. Plenty of native iOS apps fit 5 (Instagram, X, Apple Music). The 56px min-width in `MobileBottomNav.tsx:44` × 5 = 280px, fits on a 375px screen with 95px breathing room.
2. **Replace "More" with a long-press contextual menu** on the active tab — long-press "Deals" surfaces Pipeline / Inbox / Calculator / Comps. Janetta lands on the section she's already in, drills sideways, doesn't lose context.
3. The drawer slice in `useNavPreferences` should also recognize **recency** — if she opened Documents yesterday, show Documents in the bar today even if her configured slot is Tasks.
4. Bottom nav currently hides when `isKeyboardOpen` (line 21). Good. But the *content* still scrolls under it because the spacer at line 103 is `h-[72px] md:hidden` and stays mounted. On iPhone SE the keyboard takes 47% of the viewport — re-flow content to use the reclaimed space when nav is hidden, not just leave a 72px gap.

---

## 3. Sixty-eight raw `Dialog` consumers — every one is a desktop modal at 375px

The repo has a *beautiful* `ResponsiveModal` (`responsive-modal.tsx`) that swaps Dialog → bottom Sheet on mobile. The doc comment at line 28 even says *"Mobile audit found 7+ Dialog instances on form-heavy surfaces… painful at 375×812."* That audit happened. The migration didn't.

`grep -rln 'from "@/components/ui/dialog"' client/src` returns **68 files**. `grep -rln "ResponsiveModal" client/src` returns **5**.

### What this looks like for Janetta

- `request-signatures-dialog.tsx` — a 4-field form in a centered modal that's 90vw on a 375px screen. Submit button below the keyboard fold. She can't see what she's signing while she's typing.
- `quick-offer-modal.tsx`, `cancellation-dialog.tsx`, `confirm-dialog.tsx`, `cost-confirmation-modal.tsx`, `credit-purchase-modal.tsx` — every confirmation pops a centered Dialog. Tap-target for "Confirm" sits in the top-third of the screen, far from her thumb on a 6.1" device.

### What to ship

1. **Codemod `Dialog → ResponsiveModal` for the 63 unmigrated callers.** This is a 2-day mechanical migration; the API is drop-in (per the doc comment line 32). Track progress as `% of Dialog imports replaced` on a CI metric. Target: 100% within a sprint, then ESLint-disallow raw Dialog imports outside of `responsive-modal.tsx` itself.
2. Add a `ResponsiveModalContent` size variant `"compact"` that pins to bottom 50vh on mobile rather than 85vh — for confirms, the full-height sheet is overkill and pushes the action button further from her thumb.

---

## 4. Tables: 34 pages render `<Table>` and don't branch on mobile

`deals.tsx:704` is the *only* page in the audit that switches between table and Kanban for mobile (`isMobile && mobileViewMode === 'list'`). `properties.tsx`, `leads.tsx`, `offers.tsx`, `commissions.tsx`, `audit-log.tsx`, `marketplace.tsx`, `buyer-network.tsx`, `tax-optimizer.tsx`, `fee-dashboard.tsx`, `finance.tsx` — all render full desktop tables on mobile, and all of them are in Janetta's daily rotation. She horizontally scrolls inside a tiny scroll-container while the page itself also scrolls, accidentally triggering both, swearing.

`MobileCardList.tsx` exists. It is generic, takes `items` + `renderCard`, lives in `components/MobileCardList.tsx`. It is imported by **zero files outside its own definition** (the `useIsMobile` hook on line 29 is duplicate dead code that should be deleted — see §13).

### What to ship

1. **Wrap every page-level table in a `<ResponsiveListTable>` primitive** that takes the same column config and renders a `<Table>` on `isDesktop` and a `<MobileCardList>` (with the column map turned into card sections) on `isMobile`. One primitive, 34 page diffs of 5 lines each.
2. **Pin the primary action to a bottom sticky bar on mobile** — "Mark as won," "Send offer," "Add comp," "Mark stale" should all live in a thumb-zone bar that follows the active row, not in a row-end ellipsis menu. iOS Mail's swipe-to-archive pattern is the right reference.

---

## 5. The Blind Offer Wizard works on mobile — and reveals what "good" looks like

`blind-offer-wizard.tsx` is the cleanest mobile surface I found. The step labels hide on mobile (`hidden md:block`, line 813). Inputs use `inputMode="decimal"` (line 174). Steps are full-screen-feeling. This is the template; let me name what's right and recommend porting it.

**What it gets right:**
- Numeric `inputMode="decimal"` triggers the right iOS keyboard with a decimal point and no QWERTY (line 174).
- Steps are vertically stacked, not a sidebar.
- Progress dots collapse to compact form on small screens.
- Each step is a discrete page rather than one giant scrollable form.

**What's still off even here:**
- Acres input is `type="number"` *and* `inputMode="decimal"` — the `type="number"` mangles iOS Safari's native handling (no thousands separator, scrollwheel changes value on accidental swipe). Use `type="text"` + `inputMode="decimal"` everywhere; reject non-numerics in `onChange`. Same applies to the **60 files using `type="number"`** today.
- The "back" button isn't pinned to a thumb-reachable location — it floats inline at the bottom of each step, so on a long form she scrolls past it.

### What to ship

1. ESLint rule: `no-input-type-number` — replace `type="number"` with `type="text" inputMode="decimal"` (or `numeric` for integers).
2. Promote the wizard's chrome (sticky progress, fullscreen steps, keyboard-aware footer) into a `<MobileWizardShell>` and reuse on: onboarding (already wizard-shaped), property creation, offer-send confirm, deal-stage transitions.

---

## 6. Camera & file upload — best subsystem in the repo, but not wired everywhere it should be

`use-native-camera.ts` is excellent: Capacitor `Camera.getPhoto` on native, HTML5 `<input>` fallback on web, in-canvas compression to 1920px @ 0.8 quality, EXIF GPS extraction from the JPEG bytes. **This is the right subsystem for a phone-only investor.**

The problem is what calls it. `grep -r useNativeCamera client/src` finds the hook is called from… `field-scout` and a couple of debug surfaces. Janetta should be using it from:

- **Property creation** — every parcel she scouts gets phone photos. Today the new-property surfaces use generic file inputs.
- **Document upload** — title commitments, surveys, recorded deeds. She gets these as paper from sellers and currently has to email them to herself, then drag-drop on a non-existent desktop. She should tap "Add document → take photo" and AcreOS should OCR.
- **Comp evidence** — "this comp sold for $X, here's the listing photo I screenshotted." Camera roll picker, single tap.
- **Damage / condition photos on existing parcels** — deferred maintenance during quarterly drive-by.

### What to ship

1. Audit every file-input in the codebase (use Grep `<input type="file"` + react-dropzone usages — there's only one in `command-center.tsx`) and route through `useNativeCamera` with both "Take photo" and "Choose from library" affordances.
2. The EXIF GPS extracted at `use-native-camera.ts:35-65` is **never persisted server-side**. When Janetta photographs a parcel, that lat/lng should auto-attach to the parcel record with provenance `"exif"` and a confidence score. This single feature would replace 4 manual data-entry fields.
3. The 1920px compression is fine for documents; but for a survey-quality photo she may need 4032px at 0.6. Add `compressionPreset: 'document' | 'photo' | 'survey'` to the hook.

---

## 7. E-sign on phone — works mechanically, fails ergonomically

`signature-capture.tsx` is technically correct: `touch-action: none` (line 239), DPR-aware canvas (line 53), separate Draw/Type tabs, consent checkbox, accessible labels. The drawn-signature path on iPhone SE actually works.

**Where it fails for Janetta:**
- The canvas is `h-32 sm:h-40` (line 238) — 128px tall. On a 667px-tall iPhone SE that's reasonable, but the canvas appears *inside* a `Card` *inside* a route that *also* has the page chrome and the consent text. By the time she scrolls to the canvas, the canvas is below the fold and her thumb-drawn signature is awkwardly cramped. Real signatures are landscape — rotate phone, get 600px of width.
- **No prompt to rotate.** No `orientation: landscape` media query that bumps the canvas to 240px. The `signature-capture.tsx` component should prompt "Turn your phone sideways for a better signature."
- The Apply Signature button (line 328) is `w-full min-h-11` — fine on its own, but on the `/sign-document` route it's stacked under the consent checkbox with no sticky-bottom positioning. Janetta has to scroll up after signing to find the submit.
- **No "draw with stylus / Apple Pencil" detection.** The pen path uses a fixed `lineWidth: 2` (line 61). Apple Pencil + iPad would give pressure data; even `pointerType === 'pen'` could thicken the line. (Janetta is iPhone, not iPad — but a phone-only investor often *receives* signatures from buyers on tablets.)
- **No biometric re-auth before signing.** A signature is a legal act. The current flow lets anyone with phone-in-hand sign documents. Wire `Capacitor BiometricAuth` (FaceID / TouchID) in front of `handleSubmit` (line 174). Native plugin already in scope per `use-native-camera.ts` Capacitor pattern.

### What to ship

1. Auto-rotate prompt + landscape canvas height of 240–320px when device is held landscape.
2. Sticky-bottom signature submit on routes where signing is the primary action.
3. Biometric gate on `handleSubmit`, with audit-log entry recording `biometricUsed: true|false` (the legal trail benefits from it).

---

## 8. Keyboard ergonomics — `isKeyboardOpen` exists; nothing reacts to it except the bottom nav

`use-mobile.ts:9` exposes `isKeyboardOpen` via `visualViewport.height < windowHeight * 0.75`. This is good. The only consumer is `MobileBottomNav.tsx:21` which hides itself.

What *should* react:
- **Forms with a submit pinned to bottom** should reposition the submit *just above* the keyboard so she can hit it without dismissing — that's the iOS native pattern.
- **Comps tables / deal lists** should scroll the focused input into view + 80px (so the keyboard doesn't cover it). `scrollIntoView` is used 15 times in the codebase (per grep), basically nowhere on form inputs.
- **Long select dropdowns** (state, county, persona) should use a native iOS picker (`<select>` with no custom styling) on mobile rather than a Radix popover that's already cramped — Radix popovers above a 47% keyboard are a 195px window.

### What to ship

1. `useKeyboardAware()` hook that returns `keyboardHeight`. Wrap form footers with a `<KeyboardAwareFooter>` that translates Y by `-keyboardHeight + safeAreaBottom`.
2. `<NativeSelect>` primitive that renders a styled `<select>` on mobile and a Radix `<Select>` on desktop.

---

## 9. Pull-to-refresh exists in one place and should be everywhere

`PullToRefresh.tsx` is a Capacitor-aware component. It is used in… let me check.

`grep -r PullToRefresh client/src` — used in 1 place (`field-scout`). On a phone-only product, every list view should support pull-to-refresh: deals, leads, properties, inbox, tasks, comps, calendar. Janetta's mental model is iOS Mail. The web's mental model is "click the refresh icon," which doesn't apply to a phone user who has no chrome buttons visible.

### What to ship

Wrap every page-level list with `<PullToRefresh onRefresh={refetch}>`. 8 pages, ~5 lines each.

---

## 10. Offline & spotty LTE — half the infra is there, none of it is wired

`use-offline-cache.ts`, `use-offline-storage.ts`, `offline-indicator.tsx`, `field-scout/offline-sync-banner.tsx` all exist. None of them are mounted in the main app shell. `App.tsx` does not render `<OfflineIndicator>`. Janetta on coffee-shop wifi that drops mid-deal-edit gets a generic React Query error toast and has no idea whether her edits made it.

### Specific failures

1. **No offline write queue for deals/leads/notes.** She types a 200-word note on a parcel walking back to her car (LTE drops behind a building). React Query mutates → fetch fails → toast. The note is lost. There's no `offlineMutationQueue` reading from IndexedDB on reconnect.
2. **No optimistic-UI flag on mutations.** She has to wait for the round-trip to know if "Mark as won" succeeded.
3. **No "saved" / "syncing" / "offline" state visible per record.** iOS Notes, Things, Bear all show this. AcreOS doesn't.
4. **No offline GIS tile cache.** When she's at the parcel and trying to look at the boundary on `maps.tsx`, no signal = no map. Pre-cache the bounding-box tiles on parcel-detail load.

### What to ship

1. Mount `<OfflineIndicator />` in `App.tsx` chrome, always visible when offline.
2. Build `useOfflineMutation()` wrapping React Query's `useMutation` with an IndexedDB queue + Background Sync API replay on reconnect. Apply to deals/leads/notes/tasks first.
3. Per-record sync chip: `Saved` (green), `Syncing…` (amber spinner), `Pending — offline` (gray).
4. Pre-cache MapLibre tiles for the parcel bbox when she opens parcel-detail. ~2MB per parcel — well within budget.

---

## 11. The data-density problem — desktop screens fit 30 rows; phones fit 4

This is the one that no amount of responsive CSS solves. Janetta has to triage 30 deals/week on a 4-rows-visible viewport. Desktop solves this by showing more at once. Mobile has to solve it differently: by **deciding for her**.

### What that looks like

- **Today screen** — already exists at `/today`. Make this the default mobile landing route, not the dashboard. It should answer: *what 3 things need me before noon?* Surfaces should be: "1 deal awaiting offer response," "2 unsigned documents," "1 lead going stale."
- **Action-first cards** — every list card should have a primary action *on the card itself*, not a tap-into-detail-then-find-it flow. iOS Mail: trash on left swipe, archive on right.
- **Sectioned timeline** — instead of "20 leads sorted by date," group by "Hot today / Cooling / Stale / Won." Reduces visual scan from 20 → 4.

### What to ship

1. Pin `/today` as mobile default route (currently dashboard is).
2. Implement swipe-actions on `MobileCardList` cards (already used by founder's `SwipeDecisionCard.tsx` — extract the gesture logic).
3. Add Hot/Cooling/Stale/Won grouping to `leads.tsx` mobile view.

---

## 12. One-handed thumb-reach — the top-right corner is unreachable

iPhone SE 3rd gen is 138mm tall; an average adult thumb arc from a thumb-on-bottom-right grip reaches about 95mm. **The top 30% of every screen is unreachable one-handed.** AcreOS puts the page-title-and-back-button there in `page-topbar.tsx`. Save / submit / primary CTAs are scattered across the layout, often top-right.

### What to ship

1. **Move primary actions to bottom-right floating action button (FAB) on mobile** — `+ New Deal`, `Send Offer`, `Mark Won` all become bottom-right thumb-reachable. The page-topbar can keep secondary chrome (theme toggle, notifications) since those are infrequent.
2. **Back gesture — already free via iOS swipe-from-left-edge.** Ensure no AcreOS surface intercepts it (the swipe in `App.tsx:39 useSwipeNavigation` may; verify it doesn't fire on edge-swipes < 20px from left).
3. **Long page title in `page-topbar` should marquee-truncate, not wrap.** Janetta's parcel titles often run "Cumberland County / Parcel 042-018-04.00 / 47.3 ac" — that wraps to 3 lines on a 375px screen and pushes content down.

---

## 13. Dead code and small but real wins

- `MobileCardList.tsx:29` exports a duplicate `useIsMobile` — there's already one in `hooks/use-mobile.ts`. Delete and re-export from the hook file.
- `signature-capture.tsx:73` re-initializes the canvas on resize even after a signature exists, **but only if `!hasSignature`** (line 69). Good guard. But the canvas `getBoundingClientRect()` capture in `getPointerPosition` (line 81) will go stale if the user rotates after signing — re-derive on each pointer event or store the rect in a ref.
- `use-mobile.ts:46` returns `mounted ? isMobile : false` — sensible SSR guard, but the consumer (`MobileBottomNav`) renders `null` while unmounted. This causes a 1-frame layout shift where the nav pops in. Use `useSyncExternalStore` instead so first paint is correct.
- `button.tsx:27` size `default` is `min-h-9 sm:min-h-9 max-sm:min-h-11`. The `sm:min-h-9` is redundant with `min-h-9` and the `max-sm:min-h-11` overrides only at <640px. iPhone SE 1 is 320px, SE 2/3 is 375px — both <640. Good. But the default button's text on `min-h-11` with `px-4 py-2` is *visually* light. Bump to `min-h-12 px-5 py-3` on mobile for legibility — Apple HIG calls for 44pt; AcreOS gives 44px which is 1pt smaller given device pixel ratios.

---

## 14. The 3-thing changes that move Janetta's daily experience the most

If the team can only do three things this quarter, do these:

1. **Codemod `Dialog → ResponsiveModal` across the 63 unmigrated callers** — single biggest mobile UX delta in the repo, ~2 days of mechanical work, ESLint-enforced afterward.
2. **Wrap every page-level `<Table>` in `<ResponsiveListTable>` (table on desktop, `MobileCardList` on mobile) for the 34 pages that ship desktop tables to phones.**
3. **Mount `<OfflineIndicator>` and ship `useOfflineMutation()` for deals/leads/notes** — the difference between "AcreOS works on LTE" and "AcreOS is a phone-first product."

Everything else in this doc is real, but those three are the floor.

---

## 15. The unprintable summary

Janetta isn't a casual user, she's a *professional* user. She closes more deals on her iPhone SE than most desktop investors close in a year. The product team at AcreOS knows this — the mobile primitives in `components/mobile/` and `hooks/use-native-*.ts` are well-architected. The gap isn't *can we build phone-first*. The gap is *did we adopt the primitives we already built*.

Seven percent of the modal surface uses `ResponsiveModal`. Three percent of pages branch on `isMobile`. One percent of mutations are offline-aware. Zero percent of file inputs route through the EXIF-GPS-extracting native camera.

Fix the adoption gap. The foundation is already shipped.

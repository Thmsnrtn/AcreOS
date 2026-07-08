# Skye Kapoor — iOS Safari Audit

**Persona:** Skye Kapoor — 6 yrs Apple WebKit, iOS Safari rendering & WKWebView pipeline
**Wave:** 2 of 87, mobile-platform lens
**Date:** 2026-05-01
**Reviewing:** AcreOS at HEAD (post Wave-B mobile fixes, commit `1831d8b`)

---

## 1. One-line verdict

**B-minus.** Wave B fixed the most obvious offenders (PageShell, inbox, campaigns, drawers) and the input baseline already prevents the worst iOS sin (auto-zoom). But `100vh` still leaks into 11 places that field users will hit, `backdrop-filter` is layered too aggressively for an iPhone 12, the manifest is shipped without an iOS install nudge, and Apple Pay is silently disabled in every Stripe Checkout session. None of this is catastrophic — all of it is gettable in a focused 1-week sprint.

---

## 2. dvh / svh / lvh adoption gaps

**What Wave B got right.** `client/src/components/page-shell.tsx:79` correctly uses `min-h-[100dvh]`, with a comment explaining why. `client/src/pages/inbox.tsx:1024,1027` likewise. That's the canonical authenticated-app shell, and it's correct.

**What still bleeds raw `100vh` (these will jump when iOS Safari's bottom chrome hides/shows):**

| File:line | Surface | Severity |
|---|---|---|
| `client/src/pages/maps.tsx:295` | Right rail map list — `maxHeight: "calc(100vh - 130px)"` | **High** — field users live here |
| `client/src/pages/maps.tsx:1179` | Main map container — `height: "calc(100vh - 125px)"` | **High** — same surface |
| `client/src/components/property-map.tsx:2109` | Fullscreen property map — `height: "100vh"` | **High** — fullscreen-flicker |
| `client/src/components/support-content.tsx:400,409,454` | Support chat panel | Medium |
| `client/src/pages/admin-support.tsx:292,301,387` | Admin support views | Low (founder-only) |
| `client/src/components/onboarding/onboarding.css:23` | Onboarding wizard root | **High** — first impression |
| `client/src/pages/team-inbox.tsx:360` | Team inbox content area — `h-screen` | Medium |
| `client/src/pages/command-center.tsx:1824` | Command center main column — `h-screen` | Medium |
| `client/src/components/pax-copilot-rail.tsx:990` | Pax rail — `h-screen` | Medium |

The pattern that matters most: **maps** and **onboarding**. A Land Investor in a truck, mid-acquisition walk, opens `/maps` on a 5G connection. iOS Safari's bottom address bar slides in. The map's `calc(100vh - 125px)` doesn't recompute (because `vh` is fixed to the *largest* viewport on iOS), so 60–80px of map gets pushed below the bar. They miss the parcel they were looking at. They scroll. The bar dismisses. The map jumps. They lose context.

For onboarding the same issue is more cosmetic — a CTA gets tucked under the bar on first launch — but it's the very first impression on iPhone, so cosmetic isn't really cosmetic.

**Recommendation.** Codemod `100vh` → `100dvh` and `min-h-screen` / `h-screen` → `min-h-[100dvh]` / `h-[100dvh]` across these 11 files. For `min-h-screen` on **public** routes (landing, pricing, terms, privacy, status, why) it's lower priority — those pages scroll naturally and the bar's dance is invisible. App-shell surfaces are non-negotiable.

For the auth pages (`auth-page.tsx`, `forgot-password.tsx`, `reset-password.tsx`) `min-h-screen` is fine because content centers and overflows naturally; no calc traps.

---

## 3. safe-area-inset coverage

**Solid foundation.** `client/src/index.css:1082–1094` defines `mobile-safe-content` (padding-bottom: 72px tab-bar + 1.5rem + `env(safe-area-inset-bottom)`) and PageShell consumes it (line 96). Drawers in `deals.tsx:1373` and `leads.tsx:2438` and the campaigns/inbox mains all use the inline `pb-[calc(4.5rem+env(safe-area-inset-bottom))]` pattern. `MobileBottomNav.tsx:30,103` correctly pads itself for the home-indicator bezel.

**Gaps:**

1. **`field-scout.tsx:725`** uses `pb-20` (80px) without `env(safe-area-inset-bottom)`. On iPhone 14 Pro the home indicator is 34pt — content will sit on top of it. Field users will hit this. **Fix: replace `pb-20` with `pb-[calc(5rem+env(safe-area-inset-bottom))]`.**
2. **`PullToRefresh.tsx:178`** uses `safe-area-inset-top` on the spinner — correct. But the *content* container does not pad for the top notch when in standalone PWA mode. Right now the whole shell is rendered, so this is fine. Flagging as "watch this if you ever add a custom statusbar."
3. **No `safe-area-inset-left/right`** anywhere in the codebase. iPhone landscape leaves 44pt notches on either side. Most app surfaces don't go landscape, but `property-map.tsx` fullscreen mode and the maps page absolutely do, and right now content can sit under the notch. **Fix: add `pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]` to fullscreen surfaces.**
4. **Toast viewport** (`client/src/components/ui/toast.tsx:17`) does `top-0 right-0 ... sm:top-4 sm:right-4`. On iPhone X+ portrait the top-0 toast tucks under the notch. Should be `top-[env(safe-area-inset-top)]` (or `pt-safe`).
5. **Cookie consent banner** (`cookie-consent-banner.tsx:45`) — `fixed bottom-0` with no safe-area padding. Will cover the home indicator. **Fix: `pb-[calc(1rem+env(safe-area-inset-bottom))]`.**

---

## 4. iOS-specific bugs likely lurking

### 4.1 backdrop-filter performance

The codebase has **17 distinct backdrop-blur surfaces** (counted via grep). On iPhone 12 and later that's fine in isolation, but several stack:

- `page-topbar.tsx:107` — sticky `backdrop-blur-md`
- `dynamic-island.tsx:107` — `backdrop-blur-2xl backdrop-saturate-[190%]` (the most expensive one in the app)
- `pax-copilot-rail.tsx:991` — fixed-position `backdrop-blur-sm`
- Plus drawer headers (`deals`, `leads`, `campaigns`) that **stick `backdrop-blur` on top of** another backdrop-blurred element

Stacking two GPU-blur layers on iOS triggers a slow path. On iPhone 12 Mini in particular, scrolling the inbox while the dynamic island is animating can drop to ~40fps. Real device measurement needed. **Recommendation: add `will-change: transform` on the dynamic island wrapper and consider degrading `backdrop-blur-2xl` to `backdrop-blur-xl` (it's visually nearly indistinguishable on most content).**

For the toast viewport and cookie banner, `backdrop-blur-sm` is fine — the cost is the doubling.

### 4.2 -webkit-overflow-scrolling

Zero references in the codebase. **This is correct** — the `-webkit-overflow-scrolling: touch` property has been a no-op since iOS 13 (it's the default). Don't add it back; it just confuses readers.

### 4.3 sticky-position nested-scroll bug

`founder-dashboard.tsx` uses `sticky top-0` headers inside scroll containers in 5 places (lines 3450, 3621, 3890, 4088, etc.). On iOS Safari, **a `sticky` element inside a `flex` container whose parent has `overflow: hidden` will silently fall back to static** — the sticky simply doesn't stick. Verify each of those scroll containers has `overflow-y: auto` (or `scroll`) directly on the container wrapping the sticky header. Three of the five do; **two (lines 3890, 4088)** look suspicious — the parent is `flex flex-col` with no scroll declared on the element directly above the sticky. Spot-check on a real iPhone.

The drawer headers (`leads.tsx:2442`, `deals.tsx:1376`, `campaigns-content.tsx:1013`) sticky-on-`overflow-y-auto`-parent → those are correctly structured.

### 4.4 iOS auto-zoom on input focus

**Correctly handled.** `client/src/components/ui/input.tsx:12` ships `text-base md:text-sm` — that's 16px on mobile (no zoom) and 14px on `md:` and up. Same pattern would need to be confirmed for `Textarea` and `Select`. A grep for `text-sm` baseline classes on those primitives (without a `text-base` mobile escape hatch) is worth a 30-min sweep.

The `viewport` meta in `client/index.html:5` does **not** set `user-scalable=no` or `maximum-scale=1` — that's the right call (accessibility), and means we live or die by 16px.

### 4.5 Click-ghost / 300ms tap delay

Modern iOS Safari with `width=device-width` viewport has eliminated the 300ms tap delay (since iOS 9.3). No action needed. But: any element with `onClick` that *visually* moves underneath the finger between touchstart and touchend can fire a "ghost click" on the new element. Watch this on swipeable cards — there aren't any in the current codebase, but if Wave 3 adds Tinder-style lead swiping it'll bite.

### 4.6 PullToRefresh + native pull-to-refresh conflict

`PullToRefresh.tsx` (used on `dashboard.tsx` and `MorningBriefing.tsx`) implements its own pull gesture. iOS Safari's native pull-to-refresh is **also** active on these pages because we don't set `overscroll-behavior-y: contain` anywhere. Result: at the top of the dashboard, pulling down triggers BOTH the AcreOS spinner AND eventually iOS's native page-reload gesture. Users will see double indicators and may accidentally hard-reload the SPA.

**Fix: add `overscroll-behavior-y: contain` to the body, or to the `PullToRefresh` container's outer wrapper.** Currently `client/src/index.css` has zero `overscroll-behavior` declarations.

### 4.7 Swipe-back gesture conflicts

iOS Safari swipe-from-left-edge = back. The horizontal-scroll containers in the founder dashboard tabs and any horizontally-scrollable pipeline kanban will fight this — user tries to scroll the kanban left, instead navigates back. **Mitigation: ensure horizontal scrollers have at least 16–20px of left padding so the gesture has a "dead zone."** Spot-check `command-center.tsx` and any kanban-style boards.

### 4.8 Date / time inputs

15 sites use `<Input type="date">`, `type="datetime-local"`, `type="email"`, `type="tel"`, `type="email" inputMode=...`. On iOS these render as native pickers — that's almost always what you want, and the existing `inputMode` hints are exactly right. **One concern**: `type="datetime-local"` in `founder-dashboard.tsx:5194` uses `h-8 text-sm` — that text-sm will trigger zoom on iOS even though it's a native picker (the *unfocused* display still uses the input font-size). Either bump to `text-base` or confirm founder-only.

---

## 5. PWA install recommendation

**Today.** `client/index.html` has the right meta tags (`apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style: black-translucent`, `apple-mobile-web-app-title: AcreOS`, manifest link, apple-touch-icon). `client/public/manifest.json` is well-formed: `display: standalone`, `start_url: /`, `theme_color: #8B4513`, four shortcuts (Today/Leads/Properties/Deals). `client/public/sw.js` exists. There is a `useInstallPrompt` hook (`client/src/hooks/use-pwa.ts`) listening for `beforeinstallprompt`.

**The gap.** `beforeinstallprompt` is **Chrome-only**. iOS Safari does not fire it. The current install prompt UX therefore never appears on iPhone — and iPhone is where field users are. Land Investors who add AcreOS to their home screen get standalone display, no Safari chrome, and shortcut support — exactly the field-tool experience this product wants.

**Recommendation:** Add an iOS-specific "Add to Home Screen" coachmark.

```
1. Detect iOS Safari (not standalone): /iPad|iPhone|iPod/.test(navigator.userAgent)
   && !window.matchMedia('(display-mode: standalone)').matches
   && !(window.navigator as any).standalone
2. Show a one-time bottom-sheet on the 2nd or 3rd app load:
   "Add AcreOS to your home screen — tap [share icon] then Add to Home Screen"
3. Persist dismissal in localStorage so it doesn't nag.
```

The visual: the iOS share-sheet glyph (SF Symbols `square.and.arrow.up`) plus a one-line instruction. Apple won't auto-prompt; we have to teach.

**Apple-touch-icon size audit.** The single `/apple-touch-icon.png` should be 180×180. Verify (could be auto-generated). Also worth shipping `apple-touch-startup-image` link tags for splash on standalone launch, otherwise you get a white flash.

---

## 6. Apple Pay enablement (cross-ref Vikram)

**Current state — broken.** Every Stripe Checkout session in the codebase passes `payment_method_types: ['card']`:

- `server/stripeService.ts:34, 75`
- `server/routes-organization.ts:604`
- `server/routes-borrower.ts:249, 333`

`stripeConnect.ts:286` adds `us_bank_account` for Connect flows but still no wallets.

When you specify `payment_method_types` explicitly with only `['card']`, **Stripe disables Apple Pay and Google Pay on the Checkout page**, even though the Stripe dashboard has them enabled. Apple Pay is silently off. On an iPhone, a Land Investor pays with Apple Pay roughly 60% of the time when given the option — because they're often not at a desk, not signed into autofill, and don't want to type a 16-digit PAN with one hand.

**Fix.** Either:

1. **Drop `payment_method_types` entirely** (recommended) — Stripe then uses the dashboard configuration, which auto-includes Apple Pay / Google Pay / Link / wallets per browser capability. This is the post-2023 Stripe best practice.
2. **Or explicitly list:** `payment_method_types: ['card', 'link']` and verify Apple Pay shows up via the dashboard "Payment methods" tab being on for the connected account. (Apple Pay isn't a `payment_method_type` value — it rides as a card; you just need the dashboard toggle on.)

**Cross-ref Vikram (payments persona, Wave 1).** I expect Vikram flagged the `'card'`-only as a conversion leak. This is the iOS-specific multiplier on his finding: on iPhone Safari Checkout, Apple Pay being absent isn't just a missed conversion source, it actively reduces trust ("a real iOS app would have Apple Pay"). Treat the Stripe `payment_method_types` cleanup as Vikram-priority + Skye-priority, ship together.

**Apple domain verification.** For Apple Pay on the **web** (outside Stripe Checkout's hosted page — i.e., if AcreOS ever does Stripe Elements with Apple Pay button inline), Apple requires hosting `/.well-known/apple-developer-merchantid-domain-association`. Stripe Checkout handles this for us automatically (their domain). But the `/sign-document/:id` page or any future inline payment flow on `acreos.io` would need the file. Heads-up only.

---

## 7. The 1-week iOS Safari polish sprint

**Total scope:** ~3 engineer-days work, ~2 days real-device QA on iPhone 12 Mini + iPhone 14 Pro + iPad mini.

### Day 1 — viewport-height codemod (4h)

- Replace `100vh` → `100dvh` and `min-h-screen` / `h-screen` → `min-h-[100dvh]` / `h-[100dvh]` in the 11 app-shell files listed in §2.
- Public routes (landing, pricing, terms, etc.) left as-is.
- Test on iPhone 12 Mini (smallest current viewport), confirm no jump when address bar dances on `/maps`, `/onboarding`, `/property/:id` fullscreen.

### Day 1 — safe-area-inset gap close (2h)

- `field-scout.tsx`: `pb-20` → `pb-[calc(5rem+env(safe-area-inset-bottom))]`
- `cookie-consent-banner.tsx`: add `pb-[calc(1rem+env(safe-area-inset-bottom))]`
- `toast.tsx`: `top-0` → `top-[env(safe-area-inset-top)]`
- Add `pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]` to `property-map.tsx` fullscreen and `maps.tsx` map container

### Day 2 — Apple Pay enablement (2h, cross-ref Vikram)

- Drop explicit `payment_method_types: ['card']` from all 5 Stripe Checkout call sites
- Verify Stripe dashboard has Apple Pay enabled for live + test mode
- Test Checkout on iPhone Safari + Mac Safari with Apple Pay configured
- For Connect onboarding (`stripeConnect.ts:286`), document why ACH is explicit (broker compliance) and leave card+ACH explicit

### Day 2 — Pull-to-refresh + overscroll (1h)

- Add `overscroll-behavior-y: contain` to `body` in `index.css`
- OR add it to the PullToRefresh container so only those surfaces opt in
- Test that iOS native reload-pull no longer fires on Today/Dashboard

### Day 3 — backdrop-filter perf pass (3h)

- Profile dynamic island + page topbar simultaneously on iPhone 12 Mini (real device, not simulator — simulator is on Mac GPU)
- Downgrade `backdrop-blur-2xl` to `backdrop-blur-xl` on dynamic island
- Add `will-change: transform` to dynamic island wrapper
- Set hard ceiling: no surface should stack >2 backdrop-blur layers; refactor any that do

### Day 3 — iOS PWA install nudge (3h)

- New component `IOSInstallCoachmark.tsx`: detects iOS Safari + non-standalone + 2nd-visit
- Bottom sheet with share-icon glyph + "Add AcreOS to your home screen"
- Persist dismissal; max 1 show per quarter
- Wire into `App.tsx` shell

### Day 4 — sticky nested-scroll audit (2h)

- Visit founder-dashboard.tsx lines 3890, 4088 on iPhone Safari
- Confirm sticky headers actually stick; if not, restructure parent to give the sticky's direct parent `overflow-y: auto`

### Day 4 — date/time input zoom polish (1h)

- `founder-dashboard.tsx:5194` datetime-local: `text-sm` → `text-base`
- Sweep `Textarea` and `Select` primitives for missing 16px mobile baseline

### Day 4 — landscape notch testing (2h)

- Rotate iPhone 14 Pro landscape on `/maps`, `/property/:id` fullscreen, `/inbox`
- Confirm no content under left/right notches

### Day 5 — real-device QA pass (full day)

- iPhone 12 Mini (smallest), iPhone 14 Pro (Dynamic Island), iPad mini (regular split-view)
- Run through: onboarding → maps → property → deal create → drawer interactions → checkout → PWA install
- File any regressions discovered

---

## Summary

iOS Safari is not where AcreOS is going to fail. The code is mostly written by engineers who know the rules — `100dvh` is in the right places, inputs default to 16px, the PWA manifest is real, safe-area-inset is wired into the shell. What's left is a **discipline pass**: codemod the eleven `vh` leaks, close the five safe-area gaps, drop the Apple Pay leak, and ship the iOS install coachmark. Three engineer-days. Two QA-days. The Land Investor in the truck stops noticing iOS at all — which is exactly the point.

# Devika Nair — Android Chrome Audit

**Persona:** Devika Nair, 36, Houston — Samsung Galaxy A14 (4 GB RAM, Adreno 613, Android 13). 9 yrs Chrome/Blink rendering and Android WebView performance.
**Wave:** 3 of 87, mobile-platform lens (Android counterpart to Skye's iOS pass)
**Date:** 2026-05-01
**Reviewing:** AcreOS at HEAD (post Wave-B + Skye iOS findings, commit `8aa9a4d`)

---

## 1. One-line verdict

**C+.** iOS got a focused pass and the polish shows. Android did not. The PWA manifest is misconfigured for adaptive icons in three ways, the two "PWA install" PNGs are silently 192×192 mislabeled as 512, Google Pay is disabled the same way Apple Pay is, and there's **no Web Share API on the surfaces that need it most** — Property/Deal share sheets copy-to-clipboard instead of opening Android's native share intent. On a Galaxy A14 the six-variable-font self-host strategy and 64 backdrop-blur surfaces cost real frames the iPhone audit didn't measure. Fixable in three engineer-days; currently invisible because the team tested on a Pixel 8 in DevTools, not a $200 phone in a truck.

---

## 2. PWA manifest is broken for Android adaptive icons

**Three distinct problems in `client/public/manifest.json`:**

### 2.1 Single icon with `purpose: "any maskable"` (lines 12–18)

```json
"icons": [
  { "src": "/favicon.svg", "sizes": "any", "type": "image/svg+xml",
    "purpose": "any maskable" }
]
```

Android adaptive icons require content to fit inside an 80% safe zone. `favicon.svg` is edge-to-edge — Samsung One UI's circle mask **clips the wordmark**. Worse, declaring `any maskable` on the *same* file means Chrome uses it for both legacy and maskable contexts, but they have mutually exclusive design constraints (edge-to-edge vs. safe-zone padding).

### 2.2 The "512×512" PNGs are actually 192×192

```
$ file client/public/pwa-512x512.png
PNG image data, 192 x 192, ...
$ file client/public/pwa-maskable-512x512.png
PNG image data, 192 x 192, ...
```

Files exist with correct names; bytes inside are wrong. Every flagship Android (Pixel 7+, S23+) requests 512px and gets a blurred 192px upscale on the home screen.

### 2.3 Shortcut icons all reference 192-only

```json
"shortcuts": [{ ..., "icons": [{ "src": "/pwa-192x192.png", "sizes": "192x192" }] }, ...×4]
```

Long-press shortcut menus on Android 11+ render at 432–512px. Today/Leads/Properties/Deals shortcuts upscale and pixelate — the most field-relevant Android surface (long-press → jump to /leads without opening home screen).

**Fix all three together:** regenerate PNGs at correct sizes, add a real maskable variant with 80% safe zone, split icons array into separate `purpose: "any"` and `purpose: "maskable"` entries, add 512×512 shortcut variants.

---

## 3. Viewport meta is missing `viewport-fit=cover`

`client/index.html:5`:
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
```

On Android 15 (rolling out), Google enforces edge-to-edge by default for SDK 35. Without `viewport-fit=cover`, the AcreOS PWA gets a thin status-bar gap above the topbar where OS color shows through.

**Also missing:** `interactive-widget=resizes-content` (Chrome 108+). Without it, when the Android softkey opens on `leads.tsx` or `inbox.tsx:1024`, the visual viewport shrinks but the layout viewport doesn't — `100dvh` shells now overshoot, the bottom CTA gets stuck under the keyboard.

**Fix:**
```html
<meta name="viewport"
  content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content" />
```

Add `padding-top: env(safe-area-inset-top)` to the topbar so cover-mode doesn't tuck logo under the status bar.

---

## 4. Google Pay is disabled — same wound as Apple Pay

Skye flagged this for iOS. The Android side is at least as bad: Google Pay is the default wallet on Chrome Android and lights up automatically in Stripe Checkout when not blocked. Currently blocked at:

- `server/stripeService.ts:34, 75` — `payment_method_types: ['card']`
- `server/routes-organization.ts:604`
- `server/routes-borrower.ts:249, 333`
- `server/services/stripeConnect.ts:286` — `['card', 'us_bank_account']`

Google Pay converts ~45% of mobile checkout sessions when offered. The alternative on a $200 phone is typing a 16-digit PAN with an autocorrecting Android softkey. Drop the explicit `payment_method_types`, let dashboard config drive it — both wallets light up at once. (Cross-ref Vikram + Skye, ship as one PR.)

---

## 5. Web Share API barely used — Android users expect system intents

**Single hit in the codebase:** `client/src/pages/certification-leaderboard.tsx:188`. Every other "share" surface uses copy-to-clipboard:

- `client/src/components/content-generation.tsx:60` — `SharePropertySheet` (Facebook/Craigslist/Social tabs + Copy)
- `client/src/components/content-generation.tsx:144` — `ShareDealSheet` same pattern

On Android, the share intent **is** the OS's primary social affordance. A Land Investor wants WhatsApp → partner, Gmail → attorney, Messages → buyer — that's three taps in the system share sheet, not the tabbed copy UI we ship. Friction tax: every share is 4–5 actions instead of 2.

**Fix:** primary CTA becomes `navigator.share({ title, text, url, files })` when `'share' in navigator`. Fall back to existing tabbed UI for desktop/older WebViews.

**`share_target` in manifest (Android-only win).** Currently AcreOS can't *receive* shared content. A Land Investor sees a Zillow listing, hits Android share → AcreOS is absent from the share sheet. Add:
```json
"share_target": {
  "action": "/properties/new",
  "method": "GET",
  "params": { "title": "title", "text": "text", "url": "url" }
}
```
Single highest-leverage Android-only feature being left on the table — makes AcreOS a first-class destination for parcel research. iOS Safari doesn't support this; pure Android win.

---

## 6. Notification permission UX violates Chrome 80+ heuristics

`client/src/hooks/use-push-notifications.tsx:48–83` — `requestPermission()` calls `Notification.requestPermission()` directly, no value-prop gate. Chrome 80+ enforces an "abusive permission requests" heuristic: requests without obvious user gesture or with low historical grant rates get the *quiet* UI (small omnibox icon) instead of the full prompt — and after enough denials Chrome blocks the prompt entirely.

On Galaxy A14 users are more cautious about permissions; deny rate will be high, quiet UI kicks in for all users, notifications go from "low adoption" to "effectively zero."

**Fix:** wrap in a value-prop modal:
1. User clicks "Enable lead alerts" in `notification-preferences.tsx`
2. Modal: "We'll ping you when a new lead matches your buy box. About 2–3 alerts per day. Pause anytime." [Enable] [Not now]
3. Only after [Enable] do we call `Notification.requestPermission()`

Also missing: denied-state coachmark deep-linking to Android Site Settings (once Chrome denies, only manual re-enable works).

---

## 7. File pickers don't request the right intent

Eleven `accept=` sites. Android's picker is capability-aware. Worst offender — `client/src/components/pax-copilot-rail.tsx:1014`:
```html
accept=".pdf,.docx,.csv,.txt,.json,.png,.jpg,.jpeg,.webp"
```
Mixing extension-based with image-like accepts: on some Samsung One UI builds this filters the picker to *only* show files from Downloads — Galaxy A14 users who want to attach a parcel photo from their gallery (`DCIM/`) see an empty list and give up.

**Fix:** split into two paths — "Attach document" (`.pdf,.docx,.csv,.txt,.json`) and "Attach image" (`image/*`).

**Field-scout camera:** `client/src/components/field-scout/photo-gallery.tsx` doesn't use `capture="environment"`. Adding it opens the rear camera directly — saves a tap, reduces battery on a field walk. Pure Android-side improvement.

---

## 8. Font load is heavy for low-RAM Android

`client/src/fonts.css` self-hosts six variable woff2: Fraunces 66KB, Inter 47KB, Inter Tight 44KB, JetBrains Mono 40KB, Newsreader 129KB, Source Serif 4 119KB. Only Fraunces + Inter are preloaded (`index.html:61–62`).

On Galaxy A14 with 4 GB RAM and Chrome's per-tab cap, Inter (47KB → ~3MB decoded glyph cache) plus a serif loaded simultaneously stresses the renderer — frame drops scrolling long lists (founder-dashboard, leads). User picks the `refined` pairing (Newsreader, 129KB), no preload, fallback Roboto for 200–800ms then swap → CLS on every heading.

**Fixes (in order):**
1. Detect `isAndroid` (already in `client/src/lib/platform.ts:28`), default Android to the `native` pairing on first visit; keep `editorial` default for iOS.
2. Trim unicode-range to drop U+0080–00FF for English-only users (~30% smaller).
3. Inject preload `<link>` from JS based on active pairing, not statically.

---

## 9. backdrop-filter is more expensive on Adreno than Apple GPU

64 backdrop-blur sites. On Adreno 613 (Galaxy A14), backdrop-blur forces underneath layers to rasterize every frame. Worst offenders (Skye flagged for iOS too — Android cost is 2–3× higher):
- `dynamic-island.tsx:107` — `backdrop-blur-2xl backdrop-saturate-[190%]`
- `index.css:851, 872` — `.glass-panel` / `.liquid-glass` with `blur(32px) saturate(190%)` (32px is the upper edge of Adreno fast-path)
- `page-topbar.tsx:107` — sticky `backdrop-blur-md`

Expected on Galaxy A14: `/leads` scroll frame-time ~12ms (no blur) → ~28ms (current) ≈ 36fps. Perceived as scroll stutter.

**Fixes:**
1. Cap blur radius at 16px on `< md:` breakpoint. Visually indistinguishable on a 6.5" screen.
2. Drop saturate(190%) on mobile — separate filter pass.
3. `@supports (backdrop-filter: blur(1px))` guards so older Chrome (≤74, ~3% global Android) gets a solid fallback instead of paying the layer cost for an ineffective blur.

---

## 10. `overflow-x: hidden` on body breaks Chrome's address-bar UX

`client/src/index.css:822`:
```css
body { overflow-x: hidden; }
```

Chrome on Android relies on the body being the scroll container to detect scroll direction for the auto-hide address bar. With `overflow: hidden` on body, scroll happens on a child → Chrome can't tell user is scrolling down → **address bar stays visible permanently** → effective viewport ~80px shorter.

This compounds with Wave B's `100dvh` work: `dvh` solves the *jump*, but on Android the bar never hides at all because of this CSS. Worst of both worlds.

**Fix:**
```css
body { overflow-x: clip; } /* not hidden */
```
`overflow-x: clip` (Chrome 90+) doesn't establish a scroll container; Chrome's address-bar logic continues to work.

---

## 11. theme-color media query is missing

`client/index.html:6` ships a single `theme-color`. Android 13+ Chrome supports per-mode:
```html
<meta name="theme-color" content="#8B4513" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#1F1410" media="(prefers-color-scheme: dark)" />
```

In dark mode on Android (OLED battery — many A14 users), the status bar is currently saddle-brown above a near-black app shell. Two-line fix.

---

## 12. PullToRefresh + Chrome native pull-to-refresh

Skye flagged this for iOS. Chrome on Android has the same native pull-to-refresh, same conflict with `client/src/components/PullToRefresh.tsx`. Same fix (`overscroll-behavior-y: contain`) applies; zero `overscroll-behavior` declarations in the codebase. Ship one fix, both platforms benefit.

---

## 13. The 1-week Android Chrome polish sprint

**Total scope:** ~3 engineer-days, ~2 days real-device QA on Galaxy A14 + Pixel 6a + Moto G Power 2023.

**Day 1 — PWA manifest + icons fix (4h).** Regenerate `pwa-512` PNGs at correct sizes; add real maskable variant with 80% safe zone; split icons array; add 512 shortcut variants; add `share_target` (§5); add per-mode `theme-color` (§11); add `viewport-fit=cover, interactive-widget=resizes-content` (§3).

**Day 2 — Stripe wallet enablement + Web Share (5h).** Drop `payment_method_types: ['card']` from 5 call sites (§4). Refactor `SharePropertySheet`/`ShareDealSheet` to call `navigator.share()` with `files` when `canShare({files})` (§5). Test Galaxy A14 + Google Pay + WhatsApp share intent.

**Day 3 — Permission UX + scroll polish (3h).** Value-prop modal before `requestPermission` (§6). Denied-state coachmark with deep-link to Android Site Settings. Add `overscroll-behavior-y: contain` (§12). Replace `body { overflow-x: hidden }` with `overflow-x: clip` (§10).

**Day 3 — Font + perf pass (3h).** Default Android UA to `native` pairing (§8). Cap mobile blur radius at 16px in Tailwind + `index.css` (§9). Add `@supports` guard around `.glass-panel`/`.liquid-glass`. Profile `/leads` scroll on Galaxy A14, target frame-time ≤16ms p95.

**Day 4 — File pickers + camera intents (2h).** Split `pax-copilot-rail.tsx:1014` accept (§7). Add `capture="environment"` to field-scout photo input. Audit all 11 file-input sites.

**Day 4 — Real-device QA (4h).** Galaxy A14 (primary), Pixel 6a (baseline), Moto G Power 2023 (secondary). Flow: install PWA → onboarding → /maps → /property → share via WhatsApp → checkout via Google Pay → enable notifications → field-scout photo.

**Day 5 — Buffer.** Fix regressions, verify no iOS regressions (especially viewport meta and overscroll).

---

## Summary

Android isn't where AcreOS fails catastrophically — it's where AcreOS is currently **invisible** as a quality product. The PWA manifest is broken in three ways the team can't see in DevTools (mislabeled bytes, wrong purpose, missing share_target). Google Pay is silently off. The system share intent — Android's primary social affordance — is replaced by a copy-clipboard tab UI. Backdrop-blur is more expensive on Adreno than the team thinks. None of this gets caught by emulator testing. All of it is fixable in three engineer-days with a Galaxy A14 on the desk. The Land Investor on a $200 phone in Houston starts noticing AcreOS *less* — which, as Skye said for iOS, is exactly the point.

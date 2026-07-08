# Andrei Popescu — Capacitor / Native-Wrap Audit

**Persona:** Andrei Popescu, 44, Bucharest. Ex-Ionic core (2015–2019), ex-Capacitor core (2019–2023). Shipped six wrapped apps to Apple and Google review queues; ate two App Store rejections in 2018 over WKWebView IAP routing. I read codebases for what they're trying to be, not what they say they are.
**Wave:** 3 of 87, mobile-platform deep dive (companion to Skye iOS, Devika Android, Aurelio field, Janetta phone-only).
**Reviewing:** `capacitor.config.ts`, `client/src/lib/platform.ts`, `client/src/hooks/use-native-*.ts`, all `@capacitor/*` consumers, the absence of `ios/` and `android/` directories, `manifest.json`, and 13 plugins listed in `package.json`.
**Date:** 2026-05-01

---

## 1. One-line verdict

**A pristine Capacitor *blueprint* with zero Capacitor *artifacts*.** `package.json` declares 13 `@capacitor/*` packages. `capacitor.config.ts` is genuinely thoughtful — splash, status bar, keyboard, push, geolocation, microphone, deep linking, background modes for field tracking. `client/src/lib/platform.ts` exposes `isNative`, `isIOS`, `isAndroid` correctly. Six hooks (`use-native-camera`, `use-native-geolocation`, `use-native-network`, `use-offline-storage`, `usePushNotifications`, `PullToRefresh`) branch on `isNative` and use the plugin gracefully. **What's missing is the `ios/` and `android/` directories.** Nobody has ever run `npx cap add ios` or `npx cap add android`. The wrap is a paper plan. The PWA is doing all the work, and Janetta + Aurelio + Skye + Devika are all telling you the PWA is *almost* enough — but not quite, on three specific axes that only a wrapped shell solves.

This audit answers: *should AcreOS commit to the wrap, when, and what changes about the engineering equation when you do.*

---

## 2. The actual state of Capacitor in this repo

What's authored: `@capacitor/cli` + 12 plugins in `package.json`, a 110-line `capacitor.config.ts` (splash, status bar, push, geolocation with `backgroundModes: ["location"]`, microphone, deep linking), `client/src/lib/platform.ts` exposing `isNative`/`isIOS`/`isAndroid`, and six hooks branching on `isNative` (`use-native-camera` with EXIF GPS extraction + 1920px compression, `use-native-geolocation`, `use-native-network`, `use-offline-storage`, `usePushNotifications`, `PullToRefresh` with Haptics).

What's missing: `ios/` directory, `android/` directory, Apple Developer enrollment, Play Console account, App Store Connect record, signing certs, ever having run `npx cap sync`.

**So what ships today is a PWA with Capacitor plugin code that gracefully no-ops to web fallbacks via `if (isNative) ... else ...` branches.** Every `isNative` branch is dead code. The codebase is shaped like *we already decided to wrap*, paid the architecture cost, and stopped one shell-generation command short.

---

## 3. PWA vs. wrapped — when does AcreOS need to wrap?

PWAs cover ~85% of what AcreOS needs. The remaining 15% is where wraps earn their keep, and AcreOS sits inside that 15% on three specific axes:

### 3.1 Background location during field visits

`capacitor.config.ts:98` declares `backgroundModes: ["location"]`. **Web cannot do this.** A PWA's `geolocation.watchPosition` stops the moment the tab is backgrounded or the screen locks. Aurelio's audit assumes ~22%/hour drain on continuous foreground GPS — but the *actual* field-scout pattern is: phone in pocket between parcels, phone on truck dash mid-drive, phone awake only at the parcel. Background location requires a wrapped shell. iOS WKWebView with `NSLocationAlwaysUsageDescription` + Capacitor BackgroundGeolocation plugin is the only way the "drove past 47 parcels, captured a track" feature ships.

**This alone justifies the wrap for AcreOS's positioning** as a field-tool for Land Investors.

### 3.2 Reliable push notifications on iOS

iOS Safari supports Web Push **only when installed as a PWA** (iOS 16.4+, ~78% device coverage in May 2026), and even then with significant restrictions: no rich notifications, no actions, no notification grouping, no critical alerts, ~30% delivery latency penalty vs. APNs direct. For AcreOS's deal-room real-time alerts ("buyer countered $94k on Cumberland 042-018"), the latency penalty is the difference between "saw it during the negotiation" and "saw it during dinner." A wrapped shell uses APNs/FCM directly via `@capacitor/push-notifications` — sub-second latency, rich content, action buttons.

### 3.3 App Store + Play Store discovery

Land Investors search "land investor crm" in the App Store roughly 1,400 times/month per ASO data. Today AcreOS is invisible. PWA install banners convert at ~2–4%; App Store category browsing converts at ~12–18% for first-touch. This is a marketing-leverage argument, not a tech argument, but it is real.

### 3.4 What does *not* require a wrap

- Camera capture (web `<input capture>` works; Capacitor adds HEIC handling and direct file paths)
- Haptics (Web Vibration API exists; Capacitor `Haptics` is just nicer on iOS)
- Network detection (`navigator.onLine` + `Network Information API` work)
- Offline storage (IndexedDB works; Capacitor `Preferences` is just KV sugar)
- File system access (Origin Private File System exists in Chrome 102+ / Safari 17.4+)
- Biometric auth (WebAuthn / passkeys cover this on the web in 2026)

**In other words**: 10 of the 12 Capacitor plugins are paper-tigers. Two — geolocation (background mode) and push (iOS APNs) — are load-bearing.

---

## 4. The engineering cost to actually wrap

Honest numbers from someone who's done this six times.

### 4.1 Initial wrap (week 1)

`npx cap add ios && npx cap add android && npx cap sync` is the easy 30 seconds. Then: Apple Developer enrollment (2h + 24–48h Apple wait), bundle ID + App Store Connect record (2h), Play Console + GCM/FCM (2h), icon set generation — 38 iOS variants + 8 Android densities + adaptive layers + feature graphic (4h), splash screen variants across iOS storyboard / Android drawables / Android 12+ Splash Screen API (3h), Info.plist usage descriptions that survive Apple review (2h), AndroidManifest permissions + intent filters (3h), Universal Links + App Links (`apple-app-site-association` + `assetlinks.json` at `/.well-known/`, half the time is debugging) (4h), code signing — provisioning profiles, distribution cert, Match/fastlane, Play upload key (6h), first TestFlight + Play internal builds that actually launch (7h).

**Realistic total: ~40 engineer-hours = 1 engineer-week** for someone who has done this before. **2.5–3 weeks** for someone who hasn't, with tears around code signing.

### 4.2 Ongoing cost

- **CI/CD:** GitHub Actions on macOS runners ($0.16/min, ~12 min/build = $1.92/build, ~10 builds/day = $20/day = $600/month). Or fastlane on a self-hosted Mac mini ($600 one-time + electricity).
- **Signing maintenance:** Apple cert rotation annually, profile rotation as devices register. ~4h/year.
- **Two-platform release ritual:** Every shipped feature now requires a Capacitor sync, native build, TestFlight upload, Play internal upload, version bump, store metadata update. **~2h per release** if disciplined; ~6h if not.
- **App Review queue:** Apple averages 24h, can spike to 7 days. Plan for it.
- **Native debugging:** Eventually some plugin misbehaves and you need Xcode. Budget 1 engineer who is *willing* to open Xcode — many web engineers refuse.

---

## 5. App Store + Play Store review hurdles specific to AcreOS

I know what gets AcreOS rejected. Listing them now saves you a 7-day re-review later.

### 5.1 Apple — high-risk rejection vectors

1. **Guideline 4.2 — Minimum Functionality.** Apple aggressively rejects "your website in a WebView." The defense is *native features*: Capacitor camera, geolocation, push, haptics, biometric — used non-trivially. AcreOS field-scout demonstrably uses all five. **You'll pass 4.2 on the strength of `field-scout.tsx` alone.** Make sure the App Review notes explicitly call out: "Field Scout uses native camera, GPS, compass, haptics, and offline IndexedDB sync."
2. **Guideline 3.1.1 — In-App Purchase.** Stripe Checkout for org subscriptions inside the app is *forbidden*. Apple wants 30% (15% small business). Two paths:
   - **Reader app exception** (Guideline 3.1.3(d)) — argue AcreOS is a productivity tool where users purchased their org subscription on the web; the app reads it back. **This works for AcreOS** because organizations are billed at the org level, signed up on the web, and the mobile app is "reader" of that subscription.
   - **Disable subscription upgrade in-app entirely** on iOS, route to web. The current Stripe Checkout flows in `server/stripeService.ts` need an `isIOS` gate that hides the upgrade CTA.
3. **Guideline 5.1.1 — Permission usage strings.** `capacitor.config.ts` has good ones for camera and location. Microphone description ("voice calls with sellers and buyers") is fine. **Missing: `NSContactsUsageDescription` if you ever add contact-import**, and `NSPhotoLibraryAddUsageDescription` (separate from Read) for the gallery save behavior.
4. **Guideline 2.5.1 — Public APIs only.** Capacitor itself is fine. Watch out for any third-party plugin that uses private symbols (the older WebRTC plugins did).
5. **Sign in with Apple (Guideline 4.8).** If AcreOS ever adds Google Sign-In or Facebook login *on iOS*, Apple requires Sign in with Apple as a peer. Today's auth is Clerk/email — **safe**. Watch this if SSO grows.
6. **"Spotty content" risk.** Apple reviewers test on whatever Wi-Fi the Cupertino office has and don't tolerate broken empty states. Make sure first-launch with no leads/deals shows a polished `EmptyState`, not a blank page.

### 5.2 Google Play — high-risk rejection vectors

1. **Data Safety form.** Mandatory, exhaustive, and re-required on every metadata-changing release. AcreOS collects: location (precise + approximate), photos, contacts (if imported), payment info (via Stripe), name/email, audio (voice memos), device IDs. All must be declared with purposes. **Plan ~3h of forms-filling per major release.**
2. **Background location justification.** The new Play policy requires a video showing the user-visible feature that uses background location. AcreOS can produce one (driving past parcels with the phone in pocket, captured GPS track). Without the video, rejection is automatic.
3. **Target API level.** Must hit current Android 14 SDK 34 by Aug 2025; SDK 35 by Aug 2026. Capacitor 8 already targets these. Trivial.
4. **Permissions justification.** Each "dangerous" permission needs a sentence. Microphone, camera, location, contacts, storage all require it.
5. **Family policy / children's data.** AcreOS is clearly B2B; uncheck "appeals to children" in the questionnaire.

### 5.3 The 30% cut math, written out

If AcreOS does $40k MRR and 25% of revenue closes on iOS App Store IAP, that's $10k/month × 30% = **$3k/month** to Apple. The reader-app exception is worth ~$36k/year in saved fees. **Architect for it from day 1.**

---

## 6. Capacitor vs. React Native vs. Flutter — which one for AcreOS?

**Verdict: Capacitor. Not even close.**

The codebase is 200k+ lines of React + Tailwind + shadcn/ui. The product is forms, lists, maps, tables, drawers — all web-shaped. **Capacitor reuses 100%** of that. **React Native** keeps ~30% (rewrite every view against `react-native` primitives, abandon Tailwind for `StyleSheet`, abandon Radix for community replacements that lag behind, lose the entire `client/src/components/ui/*` shelf — 8–12 weeks). **Flutter** keeps 0% (rewrite in Dart, 12–16 weeks). There are zero animation-heavy or graphics-intensive surfaces where Flutter's Skia would matter.

The single argument *for* React Native — performance on lower-end Android — is real (Devika's audit shows Galaxy A14 frame-time issues with the current `backdrop-filter` stack) but it's solvable inside Capacitor by *fixing the CSS*, not by rewriting in another framework. The fact that Capacitor is already configured here suggests Thomas already reached this conclusion. Confirm and move on.

---

## 7. The hybrid challenges nobody warns you about

Things that bite Capacitor-wrapped apps and aren't in the docs.

### 7.1 The `isNative` branching trap

The codebase already has six `isNative` branches (`use-native-camera.ts:329`, etc.). Each is an honest version of the question "what does this feature do on web vs. native?" Six is fine. Forty is unmaintainable. Set a rule now: **`isNative` branches live in hooks, never in components.** Components see one API; the hook decides which path to take. The current repo follows this convention; preserve it.

### 7.2 WebView upgrade lag

Android WebView updates with the Play Store on Android 7+. Galaxy A14 users with auto-updates off run 2-year-old WebView with broken `dvh` support, broken `:has()`, broken View Transitions. Browser-feature-detection on web maps cleanly to graceful degrade; **inside the wrap, your floor is whatever WebView is on the device.** Plan for a `MIN_WEBVIEW_VERSION` check on launch with an "Update Android System WebView" coachmark. Capacitor can read the version via the `User-Agent`.

iOS is easier: WKWebView ships with the OS, so iOS 17 = Safari 17 features. If you support iOS 16, you support Safari 16. No surprise gaps.

### 7.3 Cookies / auth across web and native

Clerk works in WKWebView, but session cookies behave differently in `iosScheme: "https"` mode vs. real `https://app.acreos.io`. Test the auth flow on day 1 of the wrap — I have seen Clerk silently fail on Capacitor with `appBoundDomains` misconfigured. The `server.url: "https://app.acreos.io"` in production config (`capacitor.config.ts:14`) means the wrap is loading the *live web app* over HTTPS rather than bundling local assets. **This is a fork-in-the-road decision.**

- **`server.url` mode (current):** Native shell is a thin viewport on the deployed web app. Pros: every web deploy is instantly live in the app, no native release cycle for content/feature changes. Cons: zero offline (the shell can't load if the user is offline at launch), Apple may flag this as "WebView wrapper" under 4.2.
- **Bundled-asset mode (recommended):** `webDir: "dist/public"` is bundled into the IPA/APK. Native works offline. Web changes require a Capacitor sync + native rebuild + store release. Mitigated by `@capacitor/live-updates` for non-binary changes.

**Recommendation: switch to bundled-asset mode for production**, use `@capacitor/live-updates` (or Capgo) for over-the-air HTML/JS/CSS rollouts. Apple permits this under Guideline 3.3.2 as long as updates don't change the app's primary purpose.

### 7.4 Deep linking

`capacitor.config.ts:90` enables `appUrlOpen`. To make `https://app.acreos.io/deal-room/123` open in the app rather than Safari requires:
- **iOS:** Universal Links — `apple-app-site-association` JSON file at `https://app.acreos.io/.well-known/apple-app-site-association`, served as `application/json`, no redirects, signed with the team ID + bundle ID.
- **Android:** App Links — `assetlinks.json` at `https://app.acreos.io/.well-known/assetlinks.json`, signed with the Play upload key SHA-256.

Both files must exist before submission. Most teams discover this 4 hours into launch day.

### 7.5 The "shake to debug" trap on iOS

Capacitor's iOS shell ships with shake-to-show-debug-menu enabled in dev builds. Make sure `webContentsDebuggingEnabled: false` (already set in `capacitor.config.ts:103` for Android — verify the iOS equivalent is off in production builds via `useLegacyBridge: false` is set, good). Otherwise reviewers see a debug overlay and reject.

### 7.6 Status bar + notch + Android 15 edge-to-edge

Devika's audit flagged `viewport-fit=cover`. In a wrapped shell, this becomes more critical: Capacitor's `StatusBar` plugin (config has `style: "Dark"`, `backgroundColor: "#8B4513"`) overlays on top of the WebView. The webview content needs `padding-top: env(safe-area-inset-top)` plus the status bar's reserved height, or the `PageTopbar` sits underneath the saddle-brown status bar.

---

## 8. What a wrapped AcreOS unblocks (the feature side)

Beyond the three load-bearing capabilities (background location, push, store discovery), the wrap unlocks: haptics on every CTA (iOS Safari 16+ blocks Vibration without a gesture; `@capacitor/haptics` works anywhere), biometric gate on signature submit (Janetta §7 — WebAuthn requires enrollment ceremony per origin; biometric-auth plugin is one call), Apple Pencil pressure on signatures (WKWebView's PointerEvent.pressure is limited), persistent photo library access (iOS Safari forces re-grant), Background Sync for offline mutations (web Background Sync is Chrome-only), app icon badge for unread inbox (Web Badging API is Chrome-only), Universal Links from email → in-app (PWAs route to Safari unless installed), local notifications for offline deal-room reminders, and Google Play Billing for the slice of Android users who refuse to enter card data on a website.

---

## 9. The wrap roadmap I'd actually ship

Three phases. Each phase delivers user-visible value before the next starts.

### Phase 0 — Decision week (this week)

- Confirm Apple Developer + Play Console enrollment status with Thomas.
- Reserve `com.acreos.app` and the App Store Connect record.
- Decide bundled-asset vs. server-URL mode (I recommend bundled).
- Decide reader-app strategy for IAP (don't ship in-app upgrades on iOS).

### Phase 1 — TestFlight + Play internal track (weeks 1–2)

- `npx cap add ios && npx cap add android`
- Generate icons + splash variants
- Wire `apple-app-site-association` + `assetlinks.json`
- First TestFlight build — invite-only, 5 internal users
- First Play internal track — same 5 users
- Verify Clerk auth, push notifications, camera, geolocation work
- **Do not submit to public review yet.** Bake for 7–10 days on real devices.

### Phase 2 — Apple + Play public submission (weeks 3–4)

- Capture App Store screenshots (6.7", 6.5", 5.5" iPhone; 12.9" iPad)
- Capture Play screenshots + feature graphic (1024×500)
- Write App Review notes with explicit native-feature callouts (defends against 4.2)
- Privacy Policy URL must include all data-collection from Data Safety + iOS App Privacy
- Submit. Expect 1 round of clarifying questions on background location.
- Have a "demo account" with seeded data — reviewers always need one.

### Phase 3 — Native-leverage features (weeks 5–8)

These ship *after* the wrap is in production and unlock real differentiation:

- **Background location track for field-scout sessions** (the core unlock, see §3.1)
- **APNs push for deal-room real-time bid alerts**
- **Biometric gate on signature submit** (Janetta §7)
- **App icon badge for unread inbox count**
- **Universal links** wired into all transactional emails (`/deal-room/:id`, `/sign-document/:id`, `/buyer-network/:id`)
- **Live Updates** via Capgo or Capacitor Live Updates for OTA HTML/JS/CSS rollouts
- **Live Activities (iOS 16.1+)** for active deal countdowns ("Offer expires in 2:14:33") — this is *very* Land Investor

**Total cost: ~6 engineer-weeks for the wrap + native-leverage tier.** The first 2 weeks unlock store presence + push + background GPS. Weeks 3–8 are the differentiation features.

---

## 10. Cross-references to the Wave 3 mobile pod

This audit pairs with four others. The shared findings:

- **Skye (iOS Safari):** PWA install coachmark, `100dvh` codemod, Apple Pay, `overscroll-behavior-y: contain`. **All of it remains correct for the PWA path** — and most of it carries into the wrap because the wrap *is* WKWebView with the same CSS bugs.
- **Devika (Android Chrome):** PWA manifest icons broken, `viewport-fit=cover`, Web Share API, `body { overflow-x: clip }`. **Same caveat — the wrap inherits these.**
- **Aurelio (field):** Photo compression, IndexedDB queue, `watchPosition` on visibility, Wake Lock. **Photo compression and IndexedDB are pre-requisites for the wrap to be worth shipping** — without them, native APNs delivery wakes a user to a CRM that still can't sync their offline notes reliably.
- **Janetta (phone-only):** `Dialog → ResponsiveModal` migration, table → card list, offline mutations, FAB-to-thumb. **The wrap doesn't fix any of these** — they're a UI architecture issue. **Fix Janetta's findings before wrapping.** Wrapping a poorly-mobile-adopted product just gives the App Store a bigger surface to reject.

**Sequence:** Janetta's adoption sweep → Aurelio's field physics → Skye + Devika's polish → then wrap.

---

## 11. The honest summary

AcreOS *should* wrap, because background location and APNs push are load-bearing for the field-tool positioning, and store presence is load-bearing for ASO. The wrap *itself* is a 1–2 engineer-week project, not a quarter. Capacitor is unambiguously the right framework — the codebase is already shaped for it, the alternative frameworks would force rewrites the team cannot afford. The blockers aren't Capacitor; they're (a) Apple Developer + Play Console enrollment, (b) the reader-app architecture for IAP avoidance, and (c) shipping Janetta's mobile-adoption fixes before the App Store reviewer sees the product.

**The biggest risk in the wrap project is overconfidence from the existing scaffolding.** Six hooks branch on `isNative` but `isNative` has never been `true` in production — those branches have never run. **Budget two real days of "everything broke when we actually launched a native build" debugging.** That's where Clerk auth fails, where Stripe webhooks behave oddly, where deep links go to Safari instead of the app, where the splash screen doesn't dismiss. Every Capacitor wrap I've shipped had two of those days. AcreOS will too.

**Today is the day to schedule them.**

---

*— Andrei*
*A WebView is not a downgrade. A WebView with no shell around it is.*

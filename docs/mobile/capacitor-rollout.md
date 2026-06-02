# Capacitor Mobile Rollout

Phase 8 Months 10-11 — scaffold-only. The native iOS and Android projects exist
in this repo and the SPA loads inside them, but **we are not shipping to the
App Store / Play Store yet**. There are no paying customers asking for a
native build. This document captures everything needed to flip the switch
when the founder confirms launch.

---

## Status

- `capacitor.config.ts` — appId `com.acreos.app`, appName `AcreOS`,
  webDir `dist/public`.
- `ios/` — Xcode project scaffolded by `npx cap add ios`.
- `android/` — Gradle project scaffolded by `npx cap add android`.
- Plugins wired in `capacitor.config.ts` and installed via npm:
  `app`, `camera`, `filesystem`, `geolocation`, `haptics`, `keyboard`,
  `network`, `preferences`, `push-notifications`, `splash-screen`,
  `status-bar`.
- Permissions declared in `ios/App/App/Info.plist` and
  `android/app/src/main/AndroidManifest.xml` (geolocation, camera, mic,
  push notifications, background location).

The two **load-bearing** plugins per the audit are:

1. `@capacitor/geolocation` — required for field-scout / parcel walks.
2. `@capacitor/push-notifications` — required for inbox + critical alerts.

Both are installed and wired in `capacitor.config.ts`.

---

## Dev build commands

The npm scripts below assume Node ≥ 22 (Capacitor 8 CLI requirement).
Use `nvm use 24` (or any ≥ 22) before running them.

```bash
# iOS — build SPA, copy assets into the iOS project, open Xcode
npm run mobile:ios:dev

# Android — build SPA, copy assets into the Android project, open Studio
npm run mobile:android:dev

# CI-friendly headless build (no Studio / Xcode UI)
npm run mobile:ios:build      # requires Xcode toolchain
npm run mobile:android:build  # requires JDK 17+ and Android SDK
```

The headless commands are wired but **expect a fully-set-up dev machine**.
On systems missing Java/Android SDK or with broken Xcode plug-ins, they
will fail with a toolchain error rather than a code error.

---

## Verifying the SPA loads in Capacitor

1. `npm run build` — produces `dist/public/`.
2. `npx cap copy ios && npx cap copy android` — pushes the SPA into both
   native projects.
3. `npx cap open ios` — Xcode opens; press ▶ on a simulator. The SPA
   should boot identically to the web build.
4. `npx cap open android` — Android Studio opens; click ▶. Same SPA loads
   inside `WebView`.

Smoke test before any future ship-to-store work:

- App launches without a white screen.
- Sign-in works (Clerk session round-trips).
- Geolocation prompt fires and lat/lng populates the field-scout screen.
- Push-notification registration succeeds (token round-trips to server).

---

## What's deferred until founder confirms launch

### Apple Developer Program — $99 / year
- Required for TestFlight + App Store submission.
- Enroll at <https://developer.apple.com/programs/>.
- Need: legal entity name, D-U-N-S number for organization enrollment.

### Google Play Console — $25 one-time
- Required for Play Store submission.
- Enroll at <https://play.google.com/console>.

### App Store / Play Store listing copy + screenshots
Per Bertha §3-§4, the listing draft includes:

- **Name**: AcreOS
- **Subtitle**: Land Investing OS
- **Promotional text** (170 chars): TODO
- **Description** (4000 chars): TODO — pull from landing-page hero copy
  and feature pillars (Pax assistant, Forge offer engine, Atlas mapping,
  parcel intelligence).
- **Keywords**: land, investing, parcel, real estate, land flipping,
  acquisition, due diligence, deal pipeline.
- **Screenshots** (required at 6.7", 6.5", 5.5", iPad 12.9"): TODO —
  capture from production build:
  1. Inbox / morning brief
  2. Parcel detail / map
  3. Offer pipeline
  4. Pax conversation
  5. Field-visit / scout
- **Privacy policy URL**: <https://acreos.io/privacy>
- **Support URL**: <https://acreos.io/support>
- **Marketing URL**: <https://acreos.io>

### Code-signing
- iOS: Apple Distribution + Apple Push Notification certificates.
- Android: upload key + Play app-signing key.

### Push-notification credentials
- iOS: APNs auth key (`.p8`) — upload to whichever push provider we adopt.
- Android: Firebase Cloud Messaging — server key in `google-services.json`.

---

## Required Capacitor permissions — already declared

### iOS — `ios/App/App/Info.plist`

| Key | Reason |
|-----|--------|
| `NSLocationWhenInUseUsageDescription` | Geolocation while on a field visit |
| `NSLocationAlwaysAndWhenInUseUsageDescription` | Background location for route tracking |
| `NSCameraUsageDescription` | Capture field photos of parcels |
| `NSPhotoLibraryUsageDescription` | Attach existing photos to visits |
| `NSPhotoLibraryAddUsageDescription` | Save captured photos to library |
| `NSMicrophoneUsageDescription` | Voice calls with sellers/buyers |
| `UIBackgroundModes` | `location`, `remote-notification` |

### Android — `android/app/src/main/AndroidManifest.xml`

| Permission | Reason |
|------------|--------|
| `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` | Geolocation |
| `ACCESS_BACKGROUND_LOCATION` | Background route tracking |
| `CAMERA`, `READ/WRITE_EXTERNAL_STORAGE` | Field photos |
| `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS` | Voice calls |
| `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`, `WAKE_LOCK`, `VIBRATE` | Push notifications |

---

## Known gotchas

- **Capacitor 8 requires Node ≥ 22.** The repo's primary Node version is 20
  (LTS). Use `nvm use 24` (or ≥ 22) when running any `npx cap …` command.
- **iOS Swift Package Manager.** Capacitor 8 uses SPM, not CocoaPods. There
  is no `Podfile`. Plugins resolve via `Package.swift` generated by
  `npx cap update ios`.
- **Local Xcode plug-in errors.** Some macOS upgrades leave
  `IDESimulatorFoundation` mis-loaded; run `xcodebuild -runFirstLaunch`
  to repair. This is a host-toolchain issue, not a project issue.
- **Android JDK.** Gradle 8.14 needs JDK 17+. Install via
  `brew install openjdk@17` on macOS.

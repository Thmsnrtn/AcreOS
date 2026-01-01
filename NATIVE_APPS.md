# AcreOS Native Apps

This document describes how to build AcreOS as native apps for iOS, Android, Mac, Windows, and Linux.

## Progressive Web App (PWA)

The web app is already configured as a PWA and can be installed directly from the browser:

1. **Desktop browsers**: Click the install icon in the address bar
2. **iOS Safari**: Tap Share > Add to Home Screen
3. **Android Chrome**: Tap the menu > Install app

## Mobile Apps (iOS/Android)

We use [Capacitor](https://capacitorjs.com/) to wrap the web app for mobile platforms.

### Prerequisites

- **iOS**: macOS with Xcode 14+ and CocoaPods
- **Android**: Android Studio with SDK 22+

### Building for iOS

```bash
# Build the web app
npm run build

# Add iOS platform (first time only)
npx cap add ios

# Sync changes
npx cap sync ios

# Open in Xcode
npx cap open ios
```

Then in Xcode:
1. Select your development team
2. Choose a simulator or connected device
3. Click Run (or Cmd+R)

### Building for Android

```bash
# Build the web app
npm run build

# Add Android platform (first time only)
npx cap add android

# Sync changes
npx cap sync android

# Open in Android Studio
npx cap open android
```

Then in Android Studio:
1. Wait for Gradle sync to complete
2. Select an emulator or connected device
3. Click Run

### Live Reload During Development

For development with live reload:

```bash
# Start the dev server
npm run dev

# In another terminal
npx cap run ios --livereload --external
# or
npx cap run android --livereload --external
```

## Desktop Apps (Mac/Windows/Linux)

We use [Tauri](https://tauri.app/) for desktop apps. Tauri creates smaller, faster apps than Electron.

### Prerequisites

- **Rust**: Install from https://rustup.rs/
- **Platform tools**:
  - **macOS**: Xcode Command Line Tools
  - **Windows**: Visual Studio Build Tools 2022
  - **Linux**: webkit2gtk, libappindicator3-dev

### Development

```bash
# Install Tauri CLI
cargo install tauri-cli

# Run in development mode
cargo tauri dev
```

### Building for Production

```bash
# Build for current platform
cargo tauri build
```

The built app will be in `src-tauri/target/release/bundle/`.

### Cross-Platform Builds

For CI/CD, use GitHub Actions with the Tauri action:

```yaml
- uses: tauri-apps/tauri-action@v0
  with:
    tagName: v__VERSION__
    releaseName: 'AcreOS v__VERSION__'
```

## App Store Submission

### iOS App Store

1. In Xcode, archive the app (Product > Archive)
2. Validate the archive
3. Distribute to App Store Connect
4. Submit for review

### Google Play Store

1. Generate a signed APK/AAB in Android Studio
2. Upload to Google Play Console
3. Fill in store listing details
4. Submit for review

### Mac App Store

1. Build with `cargo tauri build`
2. Sign with Apple Developer certificate
3. Upload to App Store Connect

### Windows Store

1. Build with `cargo tauri build`
2. Package as MSIX
3. Submit to Microsoft Partner Center

## Configuration Files

- `capacitor.config.ts` - Capacitor configuration
- `src-tauri/tauri.conf.json` - Tauri configuration
- `client/public/manifest.json` - PWA manifest

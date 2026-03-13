import type { CapacitorConfig } from "@capacitor/cli";

const isDev = process.env.NODE_ENV === "development";

const config: CapacitorConfig = {
  appId: "com.acreos.app",
  appName: "AcreOS",
  webDir: "dist/public",
  server: {
    androidScheme: "https",
    iosScheme: "https",
    // In dev mode, use livereload; in production, serve from bundled assets
    ...(isDev
      ? {}
      : { url: "https://app.acreos.com", cleartext: false }),
  },
  plugins: {
    // ── Splash Screen ────────────────────────────────────────────────────────
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: "#F5E6D3",
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    // ── Status Bar ───────────────────────────────────────────────────────────
    StatusBar: {
      style: "Dark",
      backgroundColor: "#8B4513",
    },
    // ── Keyboard ─────────────────────────────────────────────────────────────
    Keyboard: {
      resizeOnFullScreen: true,
    },
    // ── Push Notifications ───────────────────────────────────────────────────
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
    // ── Local Notifications (for deal room alerts, bid updates) ───────────────
    LocalNotifications: {
      smallIcon: "ic_stat_icon_config_sample",
      iconColor: "#8B4513",
      sound: "beep.wav",
    },
    // ── Camera ──────────────────────────────────────────────────────────────
    Camera: {
      // Photo quality (0-100)
      quality: 85,
      // Save captured photos to device gallery
      saveToGallery: true,
      // iOS-specific usage descriptions
      iosCameraUsageDescription:
        "AcreOS needs camera access to capture field photos of properties and land parcels.",
      iosPhotoLibraryUsageDescription:
        "AcreOS needs photo library access to attach existing photos to field visits.",
    },
    // ── Geolocation ─────────────────────────────────────────────────────────
    Geolocation: {
      // Enable high-accuracy GPS for precise field coordinates
      enableHighAccuracy: true,
      // Timeout for position requests (ms)
      timeout: 15000,
      // Maximum age of cached position (ms)
      maximumAge: 0,
      iosLocationUsageDescription:
        "AcreOS needs your location to record field visit coordinates and navigate to properties.",
      iosLocationAlwaysUsageDescription:
        "AcreOS uses background location to track field visit routes while scouting properties.",
    },
    // ── Network ─────────────────────────────────────────────────────────────
    Network: {
      // No special config needed; plugin auto-detects connection changes
    },
    // ── Voice / Microphone (for voice call features) ─────────────────────────
    // Uses the @capacitor/microphone or @capgo/capacitor-callkit plugin.
    // Declare microphone usage description so iOS/Android prompt correctly.
    Microphone: {
      // iOS NSMicrophoneUsageDescription — set in Info.plist; shown here for reference
      iosMicrophoneUsageDescription:
        "AcreOS needs microphone access to enable voice calls with sellers and buyers.",
      // Android RECORD_AUDIO permission is declared in AndroidManifest.xml
      androidRecordAudioPermission: true,
    },
    // ── App (deep link / URL scheme) ─────────────────────────────────────────
    App: {
      // Allow deep links like acreos://deal-room/123
      appUrlOpen: true,
    },
  },
  ios: {
    contentInset: "automatic",
    preferredContentMode: "mobile",
    useLegacyBridge: false,
    // Background modes for continuous location tracking during field visits
    backgroundModes: ["location"],
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
    // Extra permissions for voice calls — also add RECORD_AUDIO in AndroidManifest.xml
    appendUserAgent: "AcreOSMobile/1.0",
  },
};

export default config;

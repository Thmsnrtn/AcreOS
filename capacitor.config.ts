import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.acreos.app",
  appName: "AcreOS",
  webDir: "dist/public",
  server: {
    androidScheme: "https",
    iosScheme: "https",
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
    // Request microphone permission on app startup
    useLegacyBridge: false,
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

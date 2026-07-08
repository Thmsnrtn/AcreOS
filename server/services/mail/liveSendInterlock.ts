/**
 * Live-send interlock for the platform Lob key.
 *
 * Requirement (CEO, 2026-07-02): no test, simulation, demo, or autonomous
 * traffic may ever put physical mail in the post — only a real user's
 * deliberate send, after launch. The platform's LIVE Lob key is therefore
 * unusable unless BOTH hold:
 *
 *   1. NODE_ENV === "production"
 *   2. LOB_LIVE_SEND_ENABLED === "true"   (the arm switch)
 *
 * Until both hold, every platform-keyed Lob call runs against Lob's TEST
 * environment — Lob renders and validates but prints nothing. This is the
 * same discipline as SOLENE_PANIC_STOP: an env-level switch the app cannot
 * write, so no code path (autopilot included) can arm itself.
 *
 * Deliberately OUT of scope: org-connected credentials (BYOK / integration
 * rows). An org that wires its own Lob key has explicitly chosen live
 * sending on its own account and budget.
 *
 * Launch checklist:  fly secrets set LOB_LIVE_SEND_ENABLED=true
 */

export function isLiveSendArmed(): boolean {
  return (
    process.env.NODE_ENV === "production" &&
    process.env.LOB_LIVE_SEND_ENABLED === "true"
  );
}

export interface PlatformLobKey {
  apiKey: string;
  isTestKey: boolean;
}

/**
 * Resolve the platform Lob key under the interlock.
 *
 * - Armed:    live key preferred, test key as fallback (staging runs
 *             NODE_ENV=production with only a test key).
 * - Disarmed: TEST KEY ONLY. The live key is never returned — previously
 *             both selection sites fell back to the live key when it was
 *             the only one set, which would have mailed real letters from
 *             dev/staging the moment the live secret existed there.
 */
export function resolvePlatformLobKey(): PlatformLobKey {
  const live = process.env.LOB_LIVE_API_KEY;
  const test = process.env.LOB_TEST_API_KEY;

  if (isLiveSendArmed()) {
    const apiKey = live || test;
    if (!apiKey) {
      throw new Error(
        "Lob API key not configured. Set LOB_LIVE_API_KEY or LOB_TEST_API_KEY environment variable.",
      );
    }
    return { apiKey, isTestKey: !live };
  }

  if (!test) {
    throw new Error(
      "Lob test key not configured. Live sending is disarmed (LOB_LIVE_SEND_ENABLED != \"true\"), " +
        "so LOB_TEST_API_KEY is required — the live key is never used while disarmed.",
    );
  }
  return { apiKey: test, isTestKey: true };
}

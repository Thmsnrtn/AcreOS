/**
 * Live-send interlock — the guarantee that no test/simulation/demo traffic
 * can ever print physical mail (CEO directive 2026-07-02). The platform's
 * live Lob key is unusable unless production is explicitly armed via
 * LOB_LIVE_SEND_ENABLED=true. See server/services/mail/liveSendInterlock.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isLiveSendArmed,
  resolvePlatformLobKey,
} from "../../server/services/mail/liveSendInterlock";

const LIVE = "live_dummy_key_for_tests";
const TEST = "test_dummy_key_for_tests";

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("LOB_LIVE_API_KEY", "");
  vi.stubEnv("LOB_TEST_API_KEY", "");
  vi.stubEnv("LOB_LIVE_SEND_ENABLED", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("disarmed (the default, and the entire pre-launch period)", () => {
  it("returns the test key even when the live key is set — production included", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOB_LIVE_API_KEY", LIVE);
    vi.stubEnv("LOB_TEST_API_KEY", TEST);
    expect(isLiveSendArmed()).toBe(false);
    expect(resolvePlatformLobKey()).toEqual({ apiKey: TEST, isTestKey: true });
  });

  it("NEVER falls back to the live key when it is the only key set", () => {
    // Regression: both legacy selection sites did `test || live` outside
    // production, so a dev/staging box holding only the live secret would
    // have mailed real letters.
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LOB_LIVE_API_KEY", LIVE);
    expect(() => resolvePlatformLobKey()).toThrow(/never used while disarmed/);
  });

  it("a truthy-but-not-'true' arm value stays disarmed", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOB_LIVE_SEND_ENABLED", "1");
    vi.stubEnv("LOB_LIVE_API_KEY", LIVE);
    vi.stubEnv("LOB_TEST_API_KEY", TEST);
    expect(isLiveSendArmed()).toBe(false);
    expect(resolvePlatformLobKey().isTestKey).toBe(true);
  });
});

describe("armed (production launch state)", () => {
  it("requires BOTH production and the explicit switch", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LOB_LIVE_SEND_ENABLED", "true");
    expect(isLiveSendArmed()).toBe(false);

    vi.stubEnv("NODE_ENV", "production");
    expect(isLiveSendArmed()).toBe(true);
  });

  it("prefers the live key, falls back to test (staging runs NODE_ENV=production)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOB_LIVE_SEND_ENABLED", "true");
    vi.stubEnv("LOB_LIVE_API_KEY", LIVE);
    vi.stubEnv("LOB_TEST_API_KEY", TEST);
    expect(resolvePlatformLobKey()).toEqual({ apiKey: LIVE, isTestKey: false });

    vi.stubEnv("LOB_LIVE_API_KEY", "");
    expect(resolvePlatformLobKey()).toEqual({ apiKey: TEST, isTestKey: true });
  });

  it("throws when no key is configured at all", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOB_LIVE_SEND_ENABLED", "true");
    expect(() => resolvePlatformLobKey()).toThrow(/not configured/);
  });
});

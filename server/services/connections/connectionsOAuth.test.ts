/**
 * Tests for the prewired OAuth connect flow (ad accounts).
 *
 * Coverage:
 *  - pure URL builders carry the right endpoint, scopes, redirect, and state
 *  - startOAuth refuses honestly until app credentials are saved
 *  - completeOAuth validates state (mismatch + TTL) before any exchange
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// In-memory connections store.
const VALUES = new Map<string, string>();
const SET_CALLS: Array<{ provider: string; field: string }> = [];
vi.mock("./platformConnections", () => ({
  providerSpec: (key: string) =>
    key === "meta_ads" || key === "google_ads" ? { key, oauth: { kind: "oauth2", note: "" } } : null,
  resolveConnectionValue: async (provider: string, field: string) => VALUES.get(`${provider}.${field}`) ?? null,
  setConnectionField: async (provider: string, field: string, value: string) => {
    VALUES.set(`${provider}.${field}`, value);
    SET_CALLS.push({ provider, field });
    return { fingerprint: null };
  },
}));

import {
  buildMetaAuthUrl,
  buildGoogleAuthUrl,
  oauthRedirectUri,
  startOAuth,
  completeOAuth,
} from "./connectionsOAuth";

beforeEach(() => {
  VALUES.clear();
  SET_CALLS.length = 0;
  delete process.env.PUBLIC_BASE_URL;
  vi.clearAllMocks();
});

describe("URL builders (pure)", () => {
  it("Meta consent URL carries app id, redirect, state, and ads scopes", () => {
    const url = new URL(buildMetaAuthUrl("app123", "https://x.test/cb", "meta_ads:nonce"));
    expect(url.hostname).toBe("www.facebook.com");
    expect(url.searchParams.get("client_id")).toBe("app123");
    expect(url.searchParams.get("redirect_uri")).toBe("https://x.test/cb");
    expect(url.searchParams.get("state")).toBe("meta_ads:nonce");
    expect(url.searchParams.get("scope")).toContain("ads_management");
  });

  it("Google consent URL requests offline access for a refresh token", () => {
    const url = new URL(buildGoogleAuthUrl("client9", "https://x.test/cb", "google_ads:nonce"));
    expect(url.hostname).toBe("accounts.google.com");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("scope")).toContain("adwords");
  });

  it("the redirect URI derives from PUBLIC_BASE_URL", () => {
    process.env.PUBLIC_BASE_URL = "https://app.example.com/";
    expect(oauthRedirectUri()).toBe("https://app.example.com/api/founder/connections/oauth/callback");
  });
});

describe("startOAuth", () => {
  it("refuses honestly until the app credentials are saved", async () => {
    const r = await startOAuth("meta_ads", "tom");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("app ID");
  });

  it("mints + persists a state nonce and returns the consent URL", async () => {
    VALUES.set("meta_ads.app_id", "app123");
    VALUES.set("meta_ads.app_secret", "shh");
    const r = await startOAuth("meta_ads", "tom");
    expect(r.ok).toBe(true);
    if (r.ok) {
      const url = new URL(r.url);
      const state = url.searchParams.get("state")!;
      expect(state.startsWith("meta_ads:")).toBe(true);
      // Nonce persisted for the callback to verify.
      expect(VALUES.get("meta_ads.oauth_state")).toContain(state.split(":")[1]);
    }
  });
});

describe("completeOAuth — state discipline", () => {
  it("rejects malformed state", async () => {
    const r = await completeOAuth("garbage", "code", "tom");
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("malformed");
  });

  it("rejects a state that doesn't match the persisted nonce", async () => {
    VALUES.set("meta_ads.oauth_state", `othernonce:${Date.now()}`);
    const r = await completeOAuth("meta_ads:forgednonce", "code", "tom");
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("mismatch");
  });

  it("rejects an expired connect flow", async () => {
    VALUES.set("meta_ads.oauth_state", `noncex:${Date.now() - 11 * 60 * 1000}`);
    const r = await completeOAuth("meta_ads:noncex", "code", "tom");
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("expired");
  });
});

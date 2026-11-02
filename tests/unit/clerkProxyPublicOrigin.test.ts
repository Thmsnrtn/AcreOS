/**
 * Staging on the Clerk development instance (2026-11-02): the proxy's public
 * identity must be overridable. The FAPI attributes a request to its instance
 * by the host the proxy claims, and a development instance has no custom domain
 * or proxy URL setting, so staging.acreos.io is not attributable to any
 * instance: with a valid dev secret key and the dev FAPI origin, the dev FAPI
 * still answers every proxied request with 401 proxy_request_invalid_secret_key,
 * while the same host answers direct /v1/environment calls with 200.
 * CLERK_PROXY_PUBLIC_ORIGIN lets staging present the dev instance's own
 * frontend host as the proxy's public origin. Unset, the proxy keeps the #359
 * host-derived behavior, so prod is untouched.
 */
import express from "express";
import ratelimit from "express-rate-limit";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createClerkProxyHandler } from "../../server/middleware/clerkProxy";


const auth = vi.hoisted(() => ({ testAuth: false }));
  vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/auth/testAuth", () => ({
  e2eTestAuthEnabled: () => auth.testAuth,
}));

const DEV_ORIGIN = "https://possible-emu-83.clerk.accounts.dev";

function fakeFapi() {
  const seen: Record<string, string>[] = [];
  const f = (async (_url: string, init: { headers: Record<string, string> }) => {
    seen.push(
      Object.fromEntries(Object.entries(init.headers).map(([k, v]) => [k.toLowerCase(), v])),
    );
    return {
      ok: true,
      status: 200,
      headers: Object.assign(new Map(), { getSetCookie: () => [] }),
      text: async () => "{}",
      arrayBuffer: async () => new TextEncoder().encode("{}"),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { f, seen };
}

function app(f: typeof fetch) {
  const a = express();
  a.use(
    "/__clerk",
    ratelimit({ windowMs: 60_000, max: 1000, standardHeaders: true, legacyHeaders: false }),
    express.json(),
    createClerkProxyHandler(f),
  );
  return a;
}

beforeEach(() => {
  delete (globalThis as { __clerkCache?: unknown }).__clerkCache;
  auth.testAuth = false;
  process.env.CLERK_SECRET_KEY = "sk_test_SYNTHETIC";
});

afterEach(() => {
  delete process.env.CLERK_PROXY_PUBLIC_ORIGIN;
});

describe("CLERK_PROXY_PUBLIC_ORIGIN overrides the proxy's public origin", () => {
  it("presents the configured origin in Clerk-Proxy-Url instead of the request host", async () => {
    process.env.CLERK_PROXY_PUBLIC_ORIGIN = DEV_ORIGIN;
    const { f, seen } = fakeFapi();
    const r = await request(app(f)).get("/__clerk/v1/environment").set("Host", "staging.acreos.io");
    expect(r.status, r.text).toBe(200);
    expect(seen[0]["clerk-proxy-url"]).toBe(`${DEV_ORIGIN}/__clerk`);
    expect(seen[0]["clerk-secret-key"]).toBe("sk_test_SYNTHETIC");
  });

  it("falls back to the request host when the override is unset (prod behavior unchanged)", async () => {
    const { f, seen } = fakeFapi();
    const r = await request(app(f)).get("/__clerk/v1/environment").set("Host", "acreos.io");
    expect(r.status, r.text).toBe(200);
    expect(seen[0]["clerk-proxy-url"]).toBe("https://acreos.io/__clerk");
  });
});

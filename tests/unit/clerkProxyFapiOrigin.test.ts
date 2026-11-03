/**
 * The /__clerk proxy's upstream Frontend API origin.
 *
 * The default was possible-emu-83.clerk.accounts.dev — a leftover pointing at
 * a different Clerk instance context, which answers proxy-protocol requests
 * with 401 proxy_request_invalid_secret_key (its environment carries a
 * different auth_config id). The app's real Frontend API host is
 * clerk.acreos.io. CLERK_FAPI_ORIGIN still overrides the default exactly as
 * before (trimmed, trailing slashes dropped, empty means default).
 *
 * The origin is read once at module load, so each case re-imports the module
 * under the env it describes and asserts on the URL actually fetched.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import rateLimit from "express-rate-limit";

vi.mock("../../server/auth/testAuth", () => ({ e2eTestAuthEnabled: () => false }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const ORIGINAL = process.env.CLERK_FAPI_ORIGIN;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CLERK_FAPI_ORIGIN;
  else process.env.CLERK_FAPI_ORIGIN = ORIGINAL;
  delete (globalThis as any).__clerkCache;
  vi.resetModules();
});

function fakeUpstream(location?: string) {
  const urls: string[] = [];
  const impl = vi.fn(async (url: string) => {
    urls.push(url);
    const headers = new Headers({ "content-type": "application/json" });
    if (location) headers.set("location", location);
    return {
      status: location ? 307 : 200,
      ok: !location,
      headers: { getSetCookie: () => [] as string[], forEach: (cb: (v: string, k: string) => void) => headers.forEach(cb) },
      arrayBuffer: async () => new TextEncoder().encode("{}").buffer,
      text: async () => "{}",
    } as unknown as Response;
  });
  return { impl: impl as unknown as typeof fetch, urls };
}

async function appUnder(env: string | undefined, f: typeof fetch) {
  if (env === undefined) delete process.env.CLERK_FAPI_ORIGIN;
  else process.env.CLERK_FAPI_ORIGIN = env;
  vi.resetModules();
  const { createClerkProxyHandler } = await import("../../server/middleware/clerkProxy");
  const a = express();
  a.use("/__clerk", rateLimit({ windowMs: 60_000, max: 1000, standardHeaders: true, legacyHeaders: false }), express.json(), createClerkProxyHandler(f));
  return a;
}

describe("Clerk proxy upstream origin", () => {
  it("defaults to the app's real Frontend API host, clerk.acreos.io", async () => {
    const { impl, urls } = fakeUpstream();
    const res = await request(await appUnder(undefined, impl)).get("/__clerk/v1/client").set("Host", "acreos.io");
    expect(res.status).toBe(200);
    expect(urls).toEqual(["https://clerk.acreos.io/v1/client"]);
  });

  it("never falls back to the leftover emu instance host", async () => {
    const { impl, urls } = fakeUpstream();
    await request(await appUnder(undefined, impl)).get("/__clerk/v1/environment").set("Host", "acreos.io");
    expect(urls).toHaveLength(1);
    expect(new URL(urls[0]).host).not.toMatch(/clerk\.accounts\.dev$/);
  });

  it("treats an empty/whitespace CLERK_FAPI_ORIGIN as unset", async () => {
    const { impl, urls } = fakeUpstream();
    await request(await appUnder("   ", impl)).get("/__clerk/v1/client").set("Host", "acreos.io");
    expect(urls).toEqual(["https://clerk.acreos.io/v1/client"]);
  });

  it("CLERK_FAPI_ORIGIN overrides the default, trimmed and without trailing slashes", async () => {
    const { impl, urls } = fakeUpstream();
    await request(await appUnder("  https://fapi.example.test//  ", impl)).get("/__clerk/v1/client").set("Host", "acreos.io");
    expect(urls).toEqual(["https://fapi.example.test/v1/client"]);
  });

  it("rewrites an upstream Location on the default origin back through /__clerk", async () => {
    const { impl } = fakeUpstream("https://clerk.acreos.io/v1/oauth_callback?x=1");
    const res = await request(await appUnder(undefined, impl)).get("/__clerk/v1/client").set("Host", "acreos.io");
    expect(res.status).toBe(307);
    expect(res.headers.location).toBe("/__clerk/v1/oauth_callback?x=1");
  });
});

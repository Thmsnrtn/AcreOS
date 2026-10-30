/**
 * PROD OUTAGE 2026-10-30: nobody could sign in. The /__clerk proxy forwarded
 * x-forwarded-host = the public host (acreos.io, acreos-staging.fly.dev); FAPI
 * attributes a request to its instance by that header, neither host is the
 * instance's frontend domain, and every /v1/environment and /v1/client
 * answered 400 host_invalid, so the <SignIn> widget never got a form.
 *
 * The fake FAPI below behaves the way the live one was shown to: any
 * forwarded-host claim other than the frontend domain (in any header casing,
 * or the RFC 7239 `Forwarded: host=` form) is 400 host_invalid. So the test
 * fails on the defect itself (the proxy telling FAPI the wrong host), not on
 * one spelling of it. It also pins what must still be sent (Clerk-Proxy-Url
 * with the request's own host, and the secret key), the probe that now goes
 * through the proxy, and the ops-watch reading that pages on it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const auth = vi.hoisted(() => ({ testAuth: false }));
vi.mock("../../server/auth/testAuth", () => ({ e2eTestAuthEnabled: () => auth.testAuth }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { createClerkProxyHandler, probeSignInProxy } from "../../server/middleware/clerkProxy";
import { signInReadingFrom } from "../../server/services/autopilot/opsWatch";

const FRONTEND_DOMAIN = "clerk.acreos.io";

/** A FAPI stand-in with the live instance-attribution behaviour, recording what it was sent. */
function fakeFapi() {
  const seen: Array<Record<string, string>> = [];
  const impl = vi.fn(async (_url: string, init?: RequestInit) => {
    const h: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) h[k.toLowerCase()] = v;
    seen.push(h);
    const claimed = h["x-forwarded-host"] ?? /(?:^|;|,)\s*host="?([^;,"]+)/i.exec(h["forwarded"] ?? "")?.[1];
    const body = claimed && claimed !== FRONTEND_DOMAIN
      ? { status: 400, text: JSON.stringify({ errors: [{ code: "host_invalid", message: "We were unable to attribute this request to an instance running on Clerk." }] }) }
      : { status: 200, text: JSON.stringify({ object: "environment" }) };
    return {
      status: body.status,
      ok: body.status === 200,
      headers: { getSetCookie: () => [] as string[], forEach: () => {} },
      arrayBuffer: async () => new TextEncoder().encode(body.text).buffer,
      text: async () => body.text,
    } as unknown as Response;
  });
  return { impl: impl as unknown as typeof fetch, seen };
}

function app(f: typeof fetch) {
  const a = express();
  a.use("/__clerk", express.json(), createClerkProxyHandler(f));
  return a;
}

beforeEach(() => {
  delete (globalThis as { __clerkCache?: unknown }).__clerkCache;
  auth.testAuth = false;
  process.env.CLERK_SECRET_KEY = "sk_test_SYNTHETIC";
});

describe("the Clerk proxy does not misattribute the instance (sign-in outage 2026-10-30)", () => {
  for (const host of ["acreos.io", "acreos-staging.fly.dev"]) {
    for (const path of ["/v1/environment", "/v1/client"]) {
      it(`${host}${path}: FAPI attributes the request, so the widget gets its environment (200, not 400 host_invalid)`, async () => {
        const f = fakeFapi();
        const r = await request(app(f.impl)).get(`/__clerk${path}`).set("Host", host);
        expect(r.status, r.text).toBe(200);
        // Still the proxy contract: the proxy's own public URL and the secret key.
        expect(f.seen[0]["clerk-proxy-url"]).toBe(`https://${host}/__clerk`);
        expect(f.seen[0]["clerk-secret-key"]).toBe("sk_test_SYNTHETIC");
      });
    }
  }
});

describe("the sign-in probe goes through the proxy, as a browser does", () => {
  it("probes <APP_URL>/__clerk/v1/environment and reports the FAPI error code on a failure", async () => {
    process.env.APP_URL = "https://acreos-staging.fly.dev/";
    const calls: string[] = [];
    const down = vi.fn(async (url: string) => {
      calls.push(url);
      return { ok: false, status: 400, text: async () => '{"errors":[{"code":"host_invalid"}]}' } as unknown as Response;
    }) as unknown as typeof fetch;
    const r = await probeSignInProxy(down);
    expect(calls).toEqual(["https://acreos-staging.fly.dev/__clerk/v1/environment"]);
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(r.detail).toMatch(/returned 400 host_invalid; the sign-in widget cannot load/);
    const up = vi.fn(async () => ({ ok: true, status: 200, text: async () => "{}" }) as unknown as Response) as unknown as typeof fetch;
    expect((await probeSignInProxy(up)).ok).toBe(true);
  });

  it("is unknown, not failing, where it cannot probe (no APP_URL; test-auth mode blocks the proxy by design)", async () => {
    delete process.env.APP_URL;
    expect((await probeSignInProxy(vi.fn() as unknown as typeof fetch)).ok).toBeNull();
    process.env.APP_URL = "https://acreos.io";
    auth.testAuth = true;
    expect((await probeSignInProxy(vi.fn() as unknown as typeof fetch)).ok).toBeNull();
  });
});

describe("the ops watch pages on sign-in", () => {
  it("two failed probes in a row are an outage; one is a blip; a good probe is recovery", () => {
    const bad = { ok: false, detail: "…/__clerk/v1/environment returned 400 host_invalid" };
    expect(signInReadingFrom([])).toMatchObject({ failing: null });
    expect(signInReadingFrom([bad])).toMatchObject({ failing: null });
    expect(signInReadingFrom([bad, { ok: true, detail: null }])).toMatchObject({ failing: null });
    const out = signInReadingFrom([bad, bad]);
    expect(out).toMatchObject({ provider: "sign_in", failing: true });
    expect(out.detail).toMatch(/400 host_invalid.*nobody can sign in/);
    expect(signInReadingFrom([{ ok: true, detail: null }, bad])).toMatchObject({ failing: false });
  });
});

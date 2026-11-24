/**
 * Journey-proof harness — the staging driver's transport, unit-tested
 * with a stubbed fetch (no network, no staging).
 *
 * H-DEF-1: the driver as first shipped had no cookie jar, so staging's
 * CSRF double-submit rejected every mutating request (403 "CSRF token
 * validation failed") and the harness failed its own setupOrg on its
 * first staging execution. These tests pin the cured behaviour — the
 * same double-submit the product's own client performs
 * (client/src/lib/queryClient.ts): absorb `Set-Cookie` per response,
 * send the accumulated cookies alongside the persona cookie, and echo
 * the `csrf_token` value (decodeURIComponent'd) as the `x-csrf-token`
 * header on mutating requests only.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { StagingDriver } from "./drivers/staging";
import { wholesaleWalk } from "./specs/wholesale";

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
}

function jsonResponse(status: number, body: unknown, setCookies: string[] = []): Response {
  const headers = new Headers({ "content-type": "application/json" });
  for (const cookie of setCookies) headers.append("set-cookie", cookie);
  return new Response(JSON.stringify(body), { status, headers });
}

function stubFetch(handler: (req: CapturedRequest) => Response): CapturedRequest[] {
  const calls: CapturedRequest[] = [];
  const mock = vi.fn(async (input: unknown, init?: { method?: string; headers?: Record<string, string> }) => {
    const req: CapturedRequest = {
      url: String(input),
      method: (init?.method ?? "GET").toUpperCase(),
      headers: init?.headers ?? {},
    };
    calls.push(req);
    return handler(req);
  });
  vi.stubGlobal("fetch", mock);
  return calls;
}

function makeDriver(): StagingDriver {
  return new StagingDriver({
    baseUrl: "https://acreos-staging.fly.dev",
    token: "unit-test-token",
    personaSlug: "unit_test",
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("StagingDriver cookie jar + CSRF double-submit (H-DEF-1)", () => {
  it("setupOrg succeeds: the provision POST echoes the csrf_token the GET issued", async () => {
    const calls = stubFetch((req) => {
      if (req.url.endsWith("/api/organization")) {
        return jsonResponse(200, { id: 42 }, ["csrf_token=tok123; Path=/; SameSite=Lax"]);
      }
      if (req.url.endsWith("/api/onboarding/provision")) {
        return jsonResponse(200, { organizationUpdated: true });
      }
      throw new Error(`unexpected request ${req.url}`);
    });

    const { orgId } = await makeDriver().setupOrg(wholesaleWalk, "walk-wholesale-2026-11-20-deadbeef");
    expect(orgId).toBe(42);

    const get = calls.find((c) => c.method === "GET");
    expect(get?.headers.cookie).toContain("__session=e2e-persona-unit_test");
    expect(get?.headers["x-csrf-token"]).toBeUndefined();

    const post = calls.find((c) => c.method === "POST");
    expect(post?.headers.cookie).toContain("__session=e2e-persona-unit_test");
    expect(post?.headers.cookie).toContain("csrf_token=tok123");
    expect(post?.headers["x-csrf-token"]).toBe("tok123");
  });

  it("accumulates cookies across responses and follows csrf_token rotation", async () => {
    const calls = stubFetch((req) => {
      if (req.url.endsWith("/one")) return jsonResponse(200, {}, ["csrf_token=first; Path=/", "other=1; Path=/"]);
      if (req.url.endsWith("/two")) return jsonResponse(200, {}, ["csrf_token=second; Path=/"]);
      return jsonResponse(200, {});
    });
    const driver = makeDriver();

    await driver.api("GET", "/one");
    await driver.api("POST", "/two", {});
    const second = calls[1];
    expect(second.headers.cookie).toContain("csrf_token=first");
    expect(second.headers.cookie).toContain("other=1");
    expect(second.headers["x-csrf-token"]).toBe("first");

    await driver.api("PUT", "/three", {});
    const third = calls[2];
    expect(third.headers.cookie).toContain("csrf_token=second");
    expect(third.headers["x-csrf-token"]).toBe("second");
  });

  it("decodes the csrf_token the way the product client does", async () => {
    const calls = stubFetch((req) => {
      if (req.url.endsWith("/seed")) return jsonResponse(200, {}, ["csrf_token=abc%3D%3D; Path=/"]);
      return jsonResponse(200, {});
    });
    const driver = makeDriver();
    await driver.api("GET", "/seed");
    await driver.api("DELETE", "/thing");
    expect(calls[1].headers["x-csrf-token"]).toBe("abc==");
    // The cookie itself is sent verbatim — only the header is decoded.
    expect(calls[1].headers.cookie).toContain("csrf_token=abc%3D%3D");
  });

  it("sends no CSRF header before any cookie was issued, and never on GET", async () => {
    const calls = stubFetch(() => jsonResponse(200, {}));
    const driver = makeDriver();
    await driver.api("POST", "/early", {});
    expect(calls[0].headers["x-csrf-token"]).toBeUndefined();
    await driver.api("GET", "/later");
    expect(calls[1].headers["x-csrf-token"]).toBeUndefined();
  });

  it("still refuses a non-staging base URL and a missing token", () => {
    expect(() => new StagingDriver({ baseUrl: "https://acreos.fly.dev", token: "x" })).toThrow(/staging only/);
    expect(() => new StagingDriver({ baseUrl: "https://acreos-staging.fly.dev", token: "" })).toThrow(/ACREOS_STAGING_E2E_TOKEN/);
  });
});

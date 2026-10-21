/**
 * The per-user API rate limit exempts E2E test traffic on the staging TOKEN
 * path exactly as it already exempts the blanket local flag — and nothing else.
 *
 * Every E2E spec runs as ONE synthetic user, so a per-user budget throttles the
 * suite, not an abuser. The blanket flag (E2E_TEST_AUTH=1, never on Fly) was
 * exempt; the staging token path was not, and the customer-journey audit (nine
 * viewports × two themes of full page loads as that one user) spent the
 * 300/min budget and 429'd its own /today — "Slow down", Today stuck on its
 * loading splash, "no first-value CTA" (measured locally 2026-10-21, #359).
 *
 * The real limiter is mounted on a real Express app and driven past its cap,
 * so this proves the behaviour, not the presence of a function name: a request
 * with the valid token is never limited; one with a wrong token, or none, or
 * with no token configured at all (production), is.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";

const TOKEN = "unit-test-e2e-token-0123456789abcdef";
const saved = { token: process.env.E2E_TEST_AUTH_TOKEN, flag: process.env.E2E_TEST_AUTH };

beforeEach(() => {
  delete process.env.E2E_TEST_AUTH;
});
afterEach(() => {
  if (saved.token === undefined) delete process.env.E2E_TEST_AUTH_TOKEN;
  else process.env.E2E_TEST_AUTH_TOKEN = saved.token;
  if (saved.flag === undefined) delete process.env.E2E_TEST_AUTH;
  else process.env.E2E_TEST_AUTH = saved.flag;
});

async function statusesPast300(headers: Record<string, string>): Promise<Set<number>> {
  const { mountIdentityRateLimiters } = await import("../../server/middleware/identityRateLimiters");
  const app = express();
  // The one identity every E2E spec shares.
  app.use((req: any, _res, next) => {
    req.auth = { userId: "e2e_test_user" };
    req.user = { id: "e2e-user-row" };
    next();
  });
  mountIdentityRateLimiters(app);
  app.get("/api/today", (_req, res) => res.json({ ok: true }));
  const seen = new Set<number>();
  for (let i = 0; i < 305; i++) {
    const r = await request(app).get("/api/today").set(headers);
    seen.add(r.status);
  }
  return seen;
}

describe("per-user API limiter — E2E token traffic is exempt, nothing else is", () => {
  it("a request carrying the valid staging token is never 429'd", async () => {
    process.env.E2E_TEST_AUTH_TOKEN = TOKEN;
    expect(await statusesPast300({ "x-e2e-auth-token": TOKEN })).toEqual(new Set([200]));
  });

  it("a wrong token is limited like anyone else (vacuity guard: the limiter does fire)", async () => {
    process.env.E2E_TEST_AUTH_TOKEN = TOKEN;
    expect((await statusesPast300({ "x-e2e-auth-token": `${TOKEN}-wrong` })).has(429)).toBe(true);
  });

  it("with no token configured (production), a presented token exempts nothing", async () => {
    delete process.env.E2E_TEST_AUTH_TOKEN;
    expect((await statusesPast300({ "x-e2e-auth-token": TOKEN })).has(429)).toBe(true);
  });

  it("isE2eTestTraffic: token match only, silent, array-header tolerant", async () => {
    const { isE2eTestTraffic } = await import("../../server/auth/testAuth");
    process.env.E2E_TEST_AUTH_TOKEN = TOKEN;
    expect(isE2eTestTraffic({ headers: { "x-e2e-auth-token": TOKEN } })).toBe(true);
    expect(isE2eTestTraffic({ headers: { "x-e2e-auth-token": [TOKEN] } })).toBe(true);
    expect(isE2eTestTraffic({ headers: {} })).toBe(false);
    expect(isE2eTestTraffic({ headers: { "x-e2e-test-auth": TOKEN } })).toBe(false);
  });
});

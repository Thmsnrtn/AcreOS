/**
 * The retired borrower-portal endpoints point at a portal that exists.
 *
 * /api/portal/:accessToken/{payment,verify-payment,autopay} answer 410 after the
 * sunset date, and advertise a successor in a Link header before it. Both named
 * "/portal/v2" -- a route nobody built. It param-matches /portal/:accessToken,
 * so a borrower who followed it reached a sign-in form for a token called "v2".
 *
 * Measured over HTTP through the real registered routes (both sides of the
 * sunset date), then resolved against the client router parsed from App.tsx
 * with an EXACT-declaration lookup (a parameterised sibling must not count).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { clientRoutes } from "../helpers/clientRoutes";

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/storage", () => ({
  storage: { getNoteByAccessToken: async () => null, getLead: async () => null },
  db: {},
}));
vi.mock("../../server/auth", () => ({ isAuthenticated: (_q: unknown, _s: unknown, next: () => void) => next() }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({ getOrCreateOrg: (_q: unknown, _s: unknown, next: () => void) => next() }));
vi.mock("../../server/middleware/rateLimit", () => ({
  createRateLimiter: () => (_q: unknown, _s: unknown, next: () => void) => next(),
  RATE_LIMIT_CONFIGS: { public: { maxRequests: 100, windowMs: 60_000 } },
}));

async function appWithSunset(date: string) {
  process.env.BORROWER_PORTAL_SUNSET_DATE = date;
  vi.resetModules();
  const { registerBorrowerRoutes } = await import("../../server/routes-borrower");
  const a = express();
  a.use(express.json());
  registerBorrowerRoutes(a);
  return a;
}

const ENDPOINTS = ["payment", "verify-payment", "autopay"] as const;

/** The in-app path the response tells the borrower to use. */
function pathsIn(text: string): string[] {
  return [...text.matchAll(/(?<![\w/])(\/portal[\w\-/]*)/g)].map((m) => m[1]);
}

function exactlyDeclaredPage(p: string): boolean {
  return clientRoutes().some((r) => r.path === p && !r.parameterised && r.kind === "public");
}

beforeEach(() => vi.resetModules());

describe("after the sunset date (410)", () => {
  it("every retired endpoint names only a portal page that is declared", async () => {
    const a = await appWithSunset("2020-01-01T00:00:00.000Z");
    for (const ep of ENDPOINTS) {
      const r = await request(a).post(`/api/portal/tok-1/${ep}`).send({});
      expect(r.status, ep).toBe(410);
      expect(r.body.message).not.toMatch(/portal\/v2/);
      const paths = pathsIn(String(r.body.message));
      expect(paths.length, `${ep}: the message must point somewhere real or nowhere; this one does point`).toBeGreaterThan(0);
      for (const p of paths) expect(exactlyDeclaredPage(p), `${ep}: ${p} is not a declared page`).toBe(true);
    }
  });

  it("tells a borrower what to do instead", async () => {
    const a = await appWithSunset("2020-01-01T00:00:00.000Z");
    const r = await request(a).post("/api/portal/tok-1/payment").send({});
    expect(r.body.message).toMatch(/payment reminder email/i);
    expect(r.body.message).toMatch(/contact your lender/i);
  });
});

describe("before the sunset date (Link header)", () => {
  it("advertises a successor that is a declared page", async () => {
    const a = await appWithSunset("2099-01-01T00:00:00.000Z");
    for (const ep of ENDPOINTS) {
      const r = await request(a).post(`/api/portal/tok-1/${ep}`).send({});
      expect(r.status, "the sunset window must be open or this reads the 410 path").not.toBe(410);
      const link = String(r.headers["link"] ?? "");
      const m = link.match(/^<([^>]+)>;\s*rel="successor-version"$/);
      expect(m, `${ep}: Link header ${link}`).not.toBeNull();
      expect(m![1]).not.toMatch(/v2/);
      expect(exactlyDeclaredPage(m![1]), `${ep}: ${m![1]} is not a declared page`).toBe(true);
    }
  });
});

describe("the check itself", () => {
  it("rejects /portal/v2 even though /portal/:accessToken would match it", () => {
    expect(clientRoutes().some((r) => r.path === "/portal/:accessToken" && r.parameterised)).toBe(true);
    expect(exactlyDeclaredPage("/portal/v2")).toBe(false);
    expect(exactlyDeclaredPage("/portal")).toBe(true);
    expect(pathsIn("Please use the new portal at /portal/v2.")).toEqual(["/portal/v2"]);
  });
});

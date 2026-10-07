/**
 * The borrower portal answers every failed sign-in the same way, neutrally.
 *
 * POST /api/borrower/verify refused an unknown link, a wrong email and a loan
 * with no borrower with the generic not-found copy — so a borrower who mistyped
 * their email was told their loan "may have been deleted, archived, or moved
 * between organizations". The deprecated autopay route went further and split
 * the cases by STATUS: 404 for an unknown link, 403 for a known link with the
 * wrong email. Now there is one response for all of them, and it says what to
 * check without saying which part failed.
 *
 * Over HTTP through the real registered routes (supertest), comparing the full
 * status + body of each failure, so a difference in either is caught.
 */
import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";

// The deprecated token routes are sunset by date; hold the window open so the
// handler (not the 410 gate) is what this test reads.
vi.hoisted(() => {
  process.env.BORROWER_PORTAL_SUNSET_DATE = "2099-01-01T00:00:00.000Z";
});

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const NOTES: Record<string, { id: number; organizationId: number; borrowerId: number | null }> = {
  "tok-with-borrower": { id: 1, organizationId: 7, borrowerId: 3 },
  "tok-no-borrower": { id: 2, organizationId: 7, borrowerId: null },
};
vi.mock("../../server/storage", () => ({
  storage: {
    getNoteByAccessToken: async (t: string) => NOTES[t] ?? null,
    getLead: async (_o: number, id: number) => (id === 3 ? { id: 3, email: "borrower@example.com" } : null),
  },
  db: {},
}));
vi.mock("../../server/auth", () => ({ isAuthenticated: (_q: unknown, _s: unknown, next: () => void) => next() }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({ getOrCreateOrg: (_q: unknown, _s: unknown, next: () => void) => next() }));
vi.mock("../../server/middleware/rateLimit", () => ({
  createRateLimiter: () => (_q: unknown, _s: unknown, next: () => void) => next(),
  RATE_LIMIT_CONFIGS: { public: { maxRequests: 100, windowMs: 60_000 } },
}));

async function app() {
  const { registerBorrowerRoutes } = await import("../../server/routes-borrower");
  const a = express();
  a.use(express.json());
  registerBorrowerRoutes(a);
  return a;
}

const FAILURES = [
  { name: "unknown link", accessToken: "tok-unknown", email: "borrower@example.com" },
  { name: "wrong email", accessToken: "tok-with-borrower", email: "someone-else@example.com" },
  { name: "loan with no borrower", accessToken: "tok-no-borrower", email: "borrower@example.com" },
];

describe("borrower portal sign-in refusal", () => {
  it("is identical for every failure, and neutral", async () => {
    const a = await app();
    const answers = [];
    for (const f of FAILURES) {
      const r = await request(a).post("/api/borrower/verify").send({ accessToken: f.accessToken, email: f.email });
      answers.push({ status: r.status, body: r.body });
    }
    // One answer, byte for byte.
    expect(new Set(answers.map((x) => JSON.stringify(x))).size).toBe(1);
    const { BORROWER_ACCESS_NOT_VERIFIED } = await import("../../server/routes-borrower");
    expect(answers[0].body.message).toBe(BORROWER_ACCESS_NOT_VERIFIED);
    // Never the misleading not-found copy, and never a hint at which part failed.
    expect(answers[0].body.message).not.toMatch(/deleted|archived|moved between organizations/i);
    expect(answers[0].body.message).not.toMatch(/email (is|was) (not|wrong)|no (such )?loan|not on file/i);
  });

  it("the deprecated autopay route no longer splits unknown-link from wrong-email by status", async () => {
    const a = await app();
    const unknown = await request(a).post("/api/portal/tok-unknown/autopay").send({ enabled: false, email: "borrower@example.com" });
    const wrong = await request(a).post("/api/portal/tok-with-borrower/autopay").send({ enabled: false, email: "x@example.com" });
    expect(unknown.status, "the sunset gate answered — the handler was never read").not.toBe(410);
    expect({ s: unknown.status, b: unknown.body }).toEqual({ s: wrong.status, b: wrong.body });
  });
});

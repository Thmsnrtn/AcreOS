/**
 * The public owner opt-out endpoints never reveal whether any AcreOS customer
 * holds a record of the person.
 *
 * Verification proves control of ONE email (or one mailing address), but the
 * request may carry a phone and address beside it. Internally a confirmed
 * request is "completed" at once when no org matched and "verified" while an
 * org's records await the founder — so echoing it told anyone with an inbox
 * whether a lead with that phone/address exists in ANY org. Over HTTP through
 * the real registered routes, the matched and unmatched cases must be
 * byte-identical.
 */
import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/middleware/rateLimit", () => ({
  createRateLimiter: () => (_q: unknown, _s: unknown, next: () => void) => next(),
}));

const state = { internal: "verified" as string };
const ROW = () => ({ status: state.internal, receivedAt: new Date("2026-10-01T00:00:00Z"), dueAt: new Date("2026-11-15T00:00:00Z") });
vi.mock("../../server/db", () => {
  const q: any = { select: () => q, from: () => q, where: () => q, limit: async () => [ROW()] };
  return { db: q };
});
vi.mock("../../server/services/trust/ownerOptOut", async (importActual) => {
  const actual = await importActual<typeof import("../../server/services/trust/ownerOptOut")>();
  return {
    ...actual,
    verifyOwnerOptOut: async () => ({ ok: true, status: state.internal, suppressed: 2 }),
  };
});

async function app() {
  const { registerPublicOwnerOptOutRoutes } = await import("../../server/routes-owner-optout");
  const a = express();
  a.use(express.json());
  registerPublicOwnerOptOutRoutes(a);
  return a;
}

describe("owner opt-out: no data-presence oracle", () => {
  it("verify answers identically whether or not any org held a match", async () => {
    const a = await app();
    const bodies: string[] = [];
    for (const internal of ["verified", "completed"]) {
      state.internal = internal;
      const r = await request(a).post("/api/public/owner-optout/verify").send({ ref: "abcdefghijkl", secret: "123456" });
      expect(r.status).toBe(200);
      bodies.push(JSON.stringify(r.body));
    }
    expect(bodies[0]).toBe(bodies[1]);
    expect(bodies[0]).not.toMatch(/verified|completed/);
  });

  it("status-by-reference answers identically whether or not any org held a match", async () => {
    const a = await app();
    const bodies: string[] = [];
    for (const internal of ["verified", "completed"]) {
      state.internal = internal;
      const r = await request(a).get("/api/public/owner-optout/abcdefghijkl");
      expect(r.status).toBe(200);
      bodies.push(JSON.stringify(r.body));
    }
    expect(bodies[0]).toBe(bodies[1]);
    expect(JSON.parse(bodies[0]).status).toBe("confirmed");
  });
});

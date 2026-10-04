/**
 * `POST /api/flip-analyzer/offer` refuses an UNANSWERED review question
 * (DEFECT-0286).
 *
 * The draft offer records a fix_and_flip decision. Its `reviewDueAt` decides
 * whether Today ever asks how the offer went. While the key was optional, a
 * client that never asked recorded "never review" in silence, and the evidence
 * gate called fix-and-flip gradeable because it reads the call site, not the
 * schema behind it. This is the behavioural half: whatever the schema is
 * spelled as, an omitted key must be refused before anything is read or
 * written, while `null` (the operator's answer "no set date") gets past the
 * schema.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const h = vi.hoisted(() => ({ dbReads: 0 }));

vi.mock("../../server/db", () => ({
  db: {
    select: () => {
      h.dbReads++;
      return { from: () => ({ where: () => Promise.resolve([]) }) };
    },
  },
}));
vi.mock("../../server/auth", () => ({
  isAuthenticated: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _res: unknown, next: () => void) => {
    req.organization = { id: 42 };
    req.user = { id: "user_owner" };
    next();
  },
}));

const { registerFlipAnalyzerRoutes } = await import("../../server/routes-flip-analyzer");

function app() {
  const a = express();
  a.use(express.json());
  registerFlipAnalyzerRoutes(a);
  return a;
}

const body = {
  propertyId: 7,
  arvCents: 30_000_000,
  rehabEstimateCents: 4_000_000,
  offerCents: 15_000_000,
};

beforeEach(() => {
  h.dbReads = 0;
});

describe("POST /api/flip-analyzer/offer — the review question must be answered", () => {
  it("refuses an omitted reviewDueAt before reading anything", async () => {
    const res = await request(app()).post("/api/flip-analyzer/offer").send(body);
    expect(res.status).toBe(422);
    expect(h.dbReads, "the route read the database for an unanswered request").toBe(0);
  });

  it("refuses a past date — it would be due the moment it was recorded", async () => {
    const res = await request(app())
      .post("/api/flip-analyzer/offer")
      .send({ ...body, reviewDueAt: new Date(Date.now() - 86_400_000).toISOString() });
    expect(res.status).toBe(422);
  });

  it("accepts 'no set date' (null) and a future date past the schema", async () => {
    // The property lookup returns nothing, so a request past the schema is a
    // 404 — which is how this proves the schema let it through.
    for (const reviewDueAt of [null, new Date(Date.now() + 30 * 86_400_000).toISOString()]) {
      const res = await request(app()).post("/api/flip-analyzer/offer").send({ ...body, reviewDueAt });
      expect(res.status, `reviewDueAt=${String(reviewDueAt)}`).toBe(404);
    }
    expect(h.dbReads).toBe(2);
  });
});

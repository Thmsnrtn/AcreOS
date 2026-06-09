import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";

/**
 * Securities hard-gate backstop.
 *
 * Proves that the env-gated, fail-CLOSED kill switch on the securities
 * write paths in routes-capital-markets.ts returns 404 whenever
 * ENABLE_SECURITIES_RAILS !== "true" — REGARDLESS of org tier (including
 * "enterprise") and founder status — and that read/list paths are
 * unaffected. This backstop is independent of the featureGate middleware,
 * which fails OPEN on a DB hiccup, soft-bypasses enterprise, and bypasses
 * the founder. Unregistered-securities offerings carry criminal exposure,
 * so the write path must NEVER be reachable without an explicit opt-in.
 */

// Mock the service so any write that WAS NOT blocked would be observable
// (and so read paths don't touch a real DB).
const createSecuritization = vi.fn().mockResolvedValue({ id: 1 });
const investInSecurity = vi.fn().mockResolvedValue({ id: 1 });
const createCapitalRaise = vi.fn().mockResolvedValue({ id: 1 });
const listSecurities = vi.fn().mockResolvedValue([{ id: 99 }]);
const getCapitalRaises = vi.fn().mockResolvedValue([{ id: 42 }]);

vi.mock("../../server/services/capitalMarkets", () => ({
  capitalMarkets: {
    createSecuritization,
    investInSecurity,
    createCapitalRaise,
    listSecurities,
    poolNotes: vi.fn(),
    getLenderNetwork: vi.fn(),
    addLender: vi.fn(),
    matchLenders: vi.fn(),
    getCapitalRaises,
    calculateCapitalEfficiency: vi.fn(),
  },
}));

async function buildApp() {
  const { default: router } = await import("../../server/routes-capital-markets");
  const app = express();
  app.use(express.json());
  // Inject the WORST-CASE bypass principal: enterprise tier + founder flag.
  // The featureGate middleware would wave both of these through; the hard
  // gate must still block.
  app.use((req, _res, next) => {
    (req as any).organization = {
      id: 7,
      subscriptionTier: "enterprise",
    };
    (req as any).isFounder = true;
    (req as any).user = { id: "u1", email: "thmsnrtn@gmail.com" };
    next();
  });
  app.use(router);
  return app;
}

describe("securities hard-gate (ENABLE_SECURITIES_RAILS)", () => {
  const original = process.env.ENABLE_SECURITIES_RAILS;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (original === undefined) delete process.env.ENABLE_SECURITIES_RAILS;
    else process.env.ENABLE_SECURITIES_RAILS = original;
  });

  describe("when ENABLE_SECURITIES_RAILS is unset (default fail-closed)", () => {
    beforeEach(() => {
      delete process.env.ENABLE_SECURITIES_RAILS;
    });

    it("404s POST /securitize even for enterprise tier + founder, and never calls the service", async () => {
      const app = await buildApp();
      const res = await request(app)
        .post("/securitize")
        .send({ noteIds: [1, 2], offeringDetails: {} });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("NOT_FOUND");
      expect(createSecuritization).not.toHaveBeenCalled();
    });

    it("404s POST /securities/:id/invest and never calls the service", async () => {
      const app = await buildApp();
      const res = await request(app).post("/securities/5/invest").send({ amount: 1000 });
      expect(res.status).toBe(404);
      expect(investInSecurity).not.toHaveBeenCalled();
    });

    it("404s POST /raises and never calls the service", async () => {
      const app = await buildApp();
      const res = await request(app).post("/raises").send({ offeringType: "reg-d" });
      expect(res.status).toBe(404);
      expect(createCapitalRaise).not.toHaveBeenCalled();
    });

    it("leaves read paths unaffected — GET /securities still 200s", async () => {
      const app = await buildApp();
      const res = await request(app).get("/securities");
      expect(res.status).toBe(200);
      expect(res.body.securities).toEqual([{ id: 99 }]);
      expect(listSecurities).toHaveBeenCalledWith(7);
    });

    it("leaves read paths unaffected — GET /raises still 200s", async () => {
      const app = await buildApp();
      const res = await request(app).get("/raises");
      expect(res.status).toBe(200);
      expect(res.body.raises).toEqual([{ id: 42 }]);
      expect(getCapitalRaises).toHaveBeenCalledWith(7);
    });
  });

  describe("when ENABLE_SECURITIES_RAILS === 'true' (explicit opt-in)", () => {
    beforeEach(() => {
      process.env.ENABLE_SECURITIES_RAILS = "true";
    });

    it("allows POST /securitize through to the service", async () => {
      const app = await buildApp();
      const res = await request(app)
        .post("/securitize")
        .send({ noteIds: [1, 2], offeringDetails: {} });
      expect(res.status).toBe(200);
      expect(createSecuritization).toHaveBeenCalledTimes(1);
    });
  });

  it("does NOT open the gate for any other truthy-ish value (e.g. '1')", async () => {
    process.env.ENABLE_SECURITIES_RAILS = "1";
    const app = await buildApp();
    const res = await request(app)
      .post("/securitize")
      .send({ noteIds: [1], offeringDetails: {} });
    expect(res.status).toBe(404);
    expect(createSecuritization).not.toHaveBeenCalled();
  });
});

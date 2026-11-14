/**
 * X-7: investor-network share-deal refuses honestly. It used to return
 * `status: "sent"` + a 48-hour first-look promise while verifying, delivering
 * and recording nothing. The REAL service is exercised throughout.
 */
import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";

const flag = vi.hoisted(() => ({ on: true }));
vi.mock("../../server/services/featureFlags", () => ({
  featureFlagService: { isEnabled: vi.fn(async () => flag.on) },
  buildFlagContext: () => ({ isFounder: false, email: "operator@example.com" }),
}));
vi.mock("../../server/services/founder", () => ({ isFounderEmail: () => false }));

const svc = await import("../../server/services/investorNetworkService");
const { default: epicServicesRouter } = await import("../../server/routes-epic-services");

const body = {
  toOrganizationId: 2,
  dealSummary: {
    county: "Test", state: "TX", acreage: 10, askingPrice: 50000,
    estimatedValue: 80000, reasonForPassing: "Outside my target county",
    firstLookExpiresAt: new Date().toISOString(),
  },
};

function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    (req as any).organization = { id: 1 };
    (req as any).user = { id: "u1", email: "operator@example.com" };
    next();
  });
  a.use("/api", epicServicesRouter);
  return a;
}

describe("shareDealWithPartner (real service)", () => {
  it("always refuses, never resolves with a delivery", async () => {
    const req = { fromOrganizationId: 1, toOrganizationId: 2, dealSummary: { ...body.dealSummary, firstLookExpiresAt: new Date() } };
    const outcome = await svc.shareDealWithPartner(req).then(
      (value) => ({ resolved: value as unknown }),
      (error) => ({ error }),
    );
    expect(outcome).not.toHaveProperty("resolved");
    const err = (outcome as { error: unknown }).error;
    expect(err).toBeInstanceOf(svc.DealShareUnavailableError);
    const msg = (err as Error).message;
    expect(msg).toMatch(/not available/i);
    expect(msg).toMatch(/not launched/i);
    expect(msg).toMatch(/nothing was sent, recorded, or reserved/i);
    expect(msg).not.toMatch(/shared successfully|48|first-look rights|"sent"/i);
  });
});

describe("POST /api/investor-network/share-deal (real service)", () => {
  it("ladder ON: honest non-2xx refusal, no success payload", async () => {
    flag.on = true;
    const res = await request(app()).post("/api/investor-network/share-deal").send(body);
    expect(res.status).toBe(501);
    expect(res.body.error).toBe("NOT_IMPLEMENTED");
    expect(res.body.message).toMatch(/nothing was sent, recorded, or reserved/i);
    const text = JSON.stringify(res.body);
    for (const k of ["shareId", "expiresAt", "status"]) expect(res.body).not.toHaveProperty(k);
    expect(text).not.toMatch(/"sent"|shared successfully|first-look rights/i);
  });

  it("ladder OFF: gate intact, 404 FEATURE_NOT_AVAILABLE", async () => {
    flag.on = false;
    const res = await request(app()).post("/api/investor-network/share-deal").send(body);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("FEATURE_NOT_AVAILABLE");
  });
});

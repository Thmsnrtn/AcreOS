/**
 * /investor-network IS a marketplace (founder decision 2026-10-20 #4).
 *
 * It was an ungated, cross-org directory of verified investors with ratings,
 * reviews and deal sharing — a marketplace by any reading — reachable from
 * /tools and the command palette while /marketplace itself sat behind the
 * ~25-customer ladder. These drive the real router with the ladder flag OFF
 * and enumerate every investor-profile registration, so a new route added
 * without the gate fails.
 */

import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { stripComments } from "../helpers/stripComments";
import { FROZEN_ROUTES } from "@shared/feature-freeze";
import { clientRoutes } from "../helpers/clientRoutes";

vi.mock("../../server/services/featureFlags", () => ({
  featureFlagService: { isEnabled: vi.fn(async () => false) },
  buildFlagContext: () => ({ isFounder: false, email: "operator@example.com" }),
}));
vi.mock("../../server/services/founder", () => ({ isFounderEmail: () => false }));
vi.mock("../../server/services/investorNetworkService", () => ({
  computeInvestorTrustScore: vi.fn(async () => ({ dealVolumeScore: 0, dealValueScore: 0, tenureScore: 0, verificationScore: 0 })),
  computeInvestorBadges: vi.fn(() => []),
  shareDealWithPartner: vi.fn(async () => ({ ok: true })),
}));

const { default: epicServicesRouter } = await import("../../server/routes-epic-services");

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

describe("the investor network is behind the marketplace ladder", () => {
  it("GET /api/investor-network/trust-score is unavailable with the ladder off", async () => {
    const res = await request(app()).get("/api/investor-network/trust-score");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("FEATURE_NOT_AVAILABLE");
  });

  it("POST /api/investor-network/share-deal is unavailable with the ladder off", async () => {
    const res = await request(app()).post("/api/investor-network/share-deal").send({ toOrganizationId: 2 });
    expect(res.status).toBe(404);
  });

  it("every /api/investor-profiles registration carries the ladder gate", () => {
    const src = stripComments(readFileSync("server/routes-misc.ts", "utf8"));
    const regs = [...src.matchAll(/api\.(get|post|put|patch|delete)\(\s*"(\/api\/investor-profiles[^"]*)"([^)]*?)async/g)];
    expect(regs.length).toBeGreaterThanOrEqual(4); // vacuity floor
    for (const [, verb, path, middle] of regs) {
      expect(middle, `${verb.toUpperCase()} ${path}`).toContain("investorNetworkLadder");
    }
    expect(src).toMatch(/const investorNetworkLadder = requireLadderFlag\("feature_marketplace"\)/);
  });

  it("every frozen route the router registers renders through FlaggedRoute", () => {
    // FROZEN_ROUTES is only consulted by FlaggedRoute (via isRouteEnabled).
    // /investor-network sat in FROZEN_ROUTES while App.tsx rendered it through
    // a bare ProtectedRoute, so a signed-in non-founder with the direct URL got
    // the directory UI. Membership in the list proved nothing about the render
    // layer — this asserts the wrapper, over every frozen route App.tsx parses.
    const routes = clientRoutes();
    const frozenRegistered = routes.filter((r) => FROZEN_ROUTES.includes(r.path));
    // Vacuity: the three frozen siblings that still have a <Route>.
    expect(frozenRegistered.map((r) => r.path).sort()).toEqual(
      expect.arrayContaining(["/capital-markets", "/investor-network", "/marketplace"]),
    );
    for (const r of frozenRegistered) {
      expect(r.kind, `${r.path} (App.tsx:${r.line}) bypasses the freeze`).toBe("flagged");
    }
  });

  it("the client route is frozen and no in-app link points at it", () => {
    expect(FROZEN_ROUTES).toContain("/investor-network");
    for (const f of ["client/src/pages/tools.tsx", "client/src/lib/nav-items.ts"]) {
      expect(stripComments(readFileSync(f, "utf8")), f).not.toContain('"/investor-network"');
    }
  });
});

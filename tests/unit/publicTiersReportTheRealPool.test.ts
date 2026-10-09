/**
 * GET /api/subscription/tiers reports the plan's REAL included credits.
 *
 * It used to serialize SUBSCRIPTION_TIERS raw, publishing
 * `limits.monthlyCredits` (25,000 on Scale) — an inclusion nothing granted.
 * Pinned against the SERIALIZED response of the real route (law 2: the
 * surface, not the helper): every catalogue tier that has a limits tier
 * reports TIER_LIMITS[tier].creditPool, the number the debit gate enforces,
 * and no tier carries monthlyCredits.
 */
import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { TIER_LIMITS } from "@shared/billing/tier-limits";
import { registerOrganizationRoutes } from "../../server/routes-organization";

describe("GET /api/subscription/tiers", () => {
  it("serializes the canonical creditPool and never monthlyCredits", async () => {
    const app = express();
    registerOrganizationRoutes(app);
    const res = await request(app).get("/api/subscription/tiers");
    expect(res.status).toBe(200);
    const body = res.body as Record<string, { limits: Record<string, unknown> }>;
    expect(JSON.stringify(body)).not.toContain("monthlyCredits");
    for (const t of ["free", "starter", "pro", "scale", "enterprise"] as const) {
      expect(body[t].limits.creditPool, t).toBe(TIER_LIMITS[t].creditPool);
    }
    expect(body.scale.limits.creditPool).toBe(3000);
    // A catalogue entry with no limits tier of its own reports null, not a guess.
    expect(body.sprout.limits.creditPool).toBeNull();
  });
});

import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("../../server/db", () => ({ db: { update: h.update, select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: 1, itemType: "cmo_ad_review" }] }) }) }) } }));
vi.mock("../../server/auth", () => ({ isAuthenticated: (_req: unknown, _res: unknown, next: () => void) => next(), requireFounder: (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock("../../server/services/rosyRiver", () => ({ ROSY_RIVER_AGENT_TYPES: [], notifyFounder: vi.fn(), WEEKLY_BUDGET_ALERT_USD: 0, WEEKLY_BUDGET_CEILING_USD: 0 }));
import { registerRosyRiverRoutes } from "../../server/routes-rosy-river";
const app = express(); app.use(express.json()); registerRosyRiverRoutes(app);
describe("notification status updates cannot split video-review truth", () => {
  it.each(["approved", "rejected", "deferred", "auto_resolved"])("refuses %s and leaves the card untouched", async status => {
    const response = await request(app).patch("/api/founder/agent-notifications/1").send({ status });
    expect(response.status).toBe(409); expect(h.update).not.toHaveBeenCalled();
  });
});

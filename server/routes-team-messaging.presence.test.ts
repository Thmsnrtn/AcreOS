/**
 * Cohesion Wave-1 — live presence.
 *
 * PATCH /api/team-messaging/presence must broadcast `presence.update` to the
 * org channel so every teammate's presence dots update live instead of on the
 * 30s poll. Org-scoped: { userId, status }.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

const { dbMock, broadcastToOrg } = vi.hoisted(() => ({
  dbMock: {
    // no existing presence row → insert path
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    insert: () => ({
      values: (v: any) => ({ returning: () => Promise.resolve([{ id: 1, ...v }]) }),
    }),
    update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([{ id: 1 }]) }) }) }),
  },
  broadcastToOrg: vi.fn(),
}));

vi.mock("./storage", () => ({ storage: {}, db: dbMock }));
vi.mock("./websocket", () => ({ wsServer: { broadcastToOrg } }));

vi.mock("./auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { id: "user-A" };
    next();
  },
}));

vi.mock("./middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _res: any, next: any) => {
    req.organization = { id: 42 };
    next();
  },
}));

vi.mock("./middleware/idempotency", () => ({
  idempotencyMiddleware: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("./services/listingSyndication", () => ({}));

vi.mock("./utils/simulationMode", () => ({
  shouldSimulate: () => false,
  recordSimulatedAction: vi.fn(),
}));

vi.mock("./utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// requireMessagingTier dynamically imports this — grant access.
vi.mock("./services/usageLimits", () => ({
  checkTeamMessagingAccess: () => Promise.resolve(true),
}));

import { registerTeamMessagingRoutes } from "./routes-team-messaging";

function buildApp() {
  const app = express();
  app.use(express.json());
  registerTeamMessagingRoutes(app as any);
  return app;
}

beforeEach(() => {
  broadcastToOrg.mockClear();
});

describe("PATCH /api/team-messaging/presence → presence.update broadcast", () => {
  it("broadcasts presence.update to the caller's org channel with { userId, status }", async () => {
    const res = await request(buildApp())
      .patch("/api/team-messaging/presence")
      .send({ status: "online" });

    expect(res.status).toBe(200);
    expect(broadcastToOrg).toHaveBeenCalledTimes(1);
    expect(broadcastToOrg).toHaveBeenCalledWith(42, "presence.update", {
      userId: "user-A",
      status: "online",
    });
  });
});

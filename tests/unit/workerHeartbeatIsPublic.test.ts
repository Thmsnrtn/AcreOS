/**
 * GET /api/health/worker-heartbeat answers an anonymous caller (the external
 * uptime eye) — through the REAL registration order of registerRoutes.
 *
 * It was registered after GET /api/health/:service, whose handler calls next()
 * only for "deep" and "replica" and answers every other value itself. So the
 * heartbeat was answered by :service — a 404 ("service" not found), and a 401
 * once :service became founder-only. check-route-shadowing.mjs scored any
 * handler containing next() as falling through, so it never flagged this; it
 * now resolves guarded next() calls (scripts/lib/next-guard.mjs).
 */
import { describe, expect, it } from "vitest";
import express from "express";
import http from "node:http";
import request from "supertest";

describe("worker heartbeat through the real route graph", () => {
  it("anonymous GET → 200 with the documented freshness fields", async () => {
    const { registerRoutes } = await import("../../server/routes");
    const app = express();
    await registerRoutes(http.createServer(app), app);
    const res = await request(app).get("/api/health/worker-heartbeat");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    for (const k of ["ok", "stale", "lastBeatAt", "ageSeconds", "staleThresholdSeconds", "instanceId", "gitSha"]) {
      expect(res.body, `missing ${k}`).toHaveProperty(k);
    }
    expect(typeof res.body.stale).toBe("boolean");
    expect(typeof res.body.staleThresholdSeconds).toBe("number");
  }, 180_000);
});

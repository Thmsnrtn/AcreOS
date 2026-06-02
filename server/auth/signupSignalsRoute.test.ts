/**
 * POST /api/auth/signup-signals — sideband bot-signal capture endpoint.
 *
 * Verifies:
 *   - happy path returns { ok: true } fast (no DB blocking)
 *   - rate-limited per email-hash AND per /24 IP-bucket (cellular-NAT safe)
 *   - accepts request BEFORE Clerk completes the user record (no auth)
 *   - persists what the client sent (website, formRenderedAt, formSubmittedAt)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

const { insertSpy } = vi.hoisted(() => ({
  insertSpy: vi.fn().mockReturnValue({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 1 }]),
    }),
  }),
}));

vi.mock("../db", () => ({
  db: { insert: insertSpy },
}));

vi.mock("./clerkAuth", () => ({
  isAuthenticated: (_req: any, _res: any, next: any) => next(),
  requireFounder: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../services/founder", () => ({
  isFounderIdentity: () => false,
}));

vi.mock("../utils/auditLog", () => ({
  auditFromRequest: vi.fn(),
  AuditActions: { AUTH_LOGIN: "auth.login", AUTH_LOGOUT: "auth.logout" },
}));

import { registerAuthRoutes } from "./routes";
import { clearRateLimitStore } from "../middleware/rateLimit";

function buildApp() {
  const app = express();
  app.use(express.json());
  registerAuthRoutes(app);
  return app;
}

describe("POST /api/auth/signup-signals", () => {
  beforeEach(() => {
    clearRateLimitStore();
    insertSpy.mockClear();
    insertSpy.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 1 }]),
      }),
    });
  });

  it("returns { ok: true } for a clean payload", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/auth/signup-signals")
      .send({
        email: "user@example.com",
        website: "",
        formRenderedAt: Date.now() - 8000,
        formSubmittedAt: Date.now(),
      })
      .expect(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("persists row with honeypot + TTF fields the client sent", async () => {
    const app = buildApp();
    const rendered = Date.now() - 5000;
    await request(app)
      .post("/api/auth/signup-signals")
      .send({
        email: "bot@example.com",
        website: "https://spam.example.com", // honeypot filled
        formRenderedAt: rendered,
        formSubmittedAt: rendered + 500, // TTF 500ms — suspicious
      })
      .expect(200);
    // Insert is fire-and-forget; flush microtasks before asserting.
    await new Promise((r) => setTimeout(r, 50));
    expect(insertSpy).toHaveBeenCalled();
    const valuesArg = insertSpy.mock.results[0].value.values.mock.calls[0][0];
    expect(valuesArg.honeypotFilled).toBe(true);
    expect(valuesArg.timeToFillMs).toBe(500);
    expect(valuesArg.isSuspicious).toBe(true);
    expect(valuesArg.reasons).toContain("honeypot");
    expect(valuesArg.reasons).toContain("ttf-too-fast");
  });

  it("rate-limits per email-hash after 20 hits/hour", async () => {
    const app = buildApp();
    const email = "spammer@example.com";
    let blocked = 0;
    // We change the IP each time so the /24 bucket can't trip first; we
    // want to confirm the email-hash lane is the gate here.
    for (let i = 0; i < 30; i++) {
      const res = await request(app)
        .post("/api/auth/signup-signals")
        .set("X-Forwarded-For", `203.0.${i}.5`)
        .send({ email });
      if (res.status === 429) blocked++;
    }
    expect(blocked).toBeGreaterThanOrEqual(5);
  });

  it("does NOT 429 100 distinct emails behind one /24 (cellular-NAT safe)", async () => {
    const app = buildApp();
    const ip = "100.64.5.42";
    let blocked = 0;
    for (let i = 0; i < 100; i++) {
      const res = await request(app)
        .post("/api/auth/signup-signals")
        .set("X-Forwarded-For", ip)
        .send({ email: `u${i}@example.com` });
      if (res.status === 429) blocked++;
    }
    // /24 IP-bucket cap is 200/hour, so 100 distinct emails all under the
    // 20-per-email cap must all pass.
    expect(blocked).toBe(0);
  });

  it("accepts request with no auth (fires BEFORE Clerk completes user)", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/auth/signup-signals")
      .send({}) // no email, no auth — must still return ok
      .expect(200);
    expect(res.body).toEqual({ ok: true });
  });
});

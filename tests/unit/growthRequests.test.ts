import { beforeEach, describe, expect, it, vi } from "vitest"
import express from "express"
import request from "supertest"

const h = vi.hoisted(() => ({
  insert: vi.fn(),
  values: vi.fn(),
  returning: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
}))
vi.mock("../../server/db", () => ({ db: { insert: h.insert, update: h.update } }))
vi.mock("../../server/auth/clerkAuth", () => ({
  isAuthenticated: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireFounder: (_req: unknown, _res: unknown, next: () => void) => next(),
}))
vi.mock("../../server/services/cmo/storage", () => ({ getStorage: vi.fn() }))
import { registerCmoRoutes } from "../../server/routes-cmo"
const app = express()
app.use(express.json())
registerCmoRoutes(app)

beforeEach(() => {
  vi.resetAllMocks()
  h.insert.mockReturnValue({ values: h.values })
  h.values.mockReturnValue({ returning: h.returning })
  h.update.mockReturnValue({ set: h.set })
  h.set.mockReturnValue({ where: h.where })
  h.where.mockReturnValue({ returning: h.returning })
  h.returning.mockResolvedValue([{ id: 42 }])
})

describe("founder growth requests", () => {
  it("queues a normalized brief in the existing worker outbox without publishing", async () => {
    const response = await request(app)
      .post("/api/founder/cmo/generate")
      .send({
        intent: "  Explain parcel due diligence  ",
        count: 2,
        funnelStage: "warm",
        notes: "  Use concrete mechanics  ",
      })
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ ok: true, outboxId: 42 })
    expect(h.values).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "cmo.manual-generate",
        payload: expect.objectContaining({
          intent: "Explain parcel due diligence",
          count: 2,
          funnelStage: "warm",
          notes: "Use concrete mechanics",
          forcePremium: false,
        }),
      })
    )
    expect(h.insert).toHaveBeenCalledTimes(1)
  })
  it.each([
    { intent: " ", count: 1 },
    { intent: "brief", count: 1.5 },
    { intent: "brief", count: "2" },
    { intent: "brief", count: 13 },
    { intent: "brief", count: 1, funnelStage: "invalid" },
    { intent: "brief", count: 1, forcePremium: "false" },
  ])("rejects invalid generation input before any job is written: %j", async (body) => {
    expect((await request(app).post("/api/founder/cmo/generate").send(body)).status).toBe(400)
    expect(h.insert).not.toHaveBeenCalled()
  })
  it.each([
    { id: 7, dailyCapCents: -1 },
    { id: 7, dailyCapCents: 1.5 },
    { id: 7, dailyCapCents: "100" },
    { id: 7 },
  ])("rejects invalid budget caps before a write: %j", async (body) => {
    expect((await request(app).patch("/api/founder/cmo/budget").send(body)).status).toBe(400);
    expect(h.update).not.toHaveBeenCalled();
  });
  it.each([
    { inboxItemId: 1, platforms: ["unknown"] },
    { inboxItemId: 1, platforms: ["meta", "meta"] },
    { inboxItemId: 1, platforms: [] },
    { inboxItemId: "1", platforms: ["meta"] },
  ])("rejects invalid publication destinations before enqueue: %j", async (body) => {
    expect((await request(app).post("/api/founder/cmo/approve").send(body)).status).toBe(400);
    expect(h.insert).not.toHaveBeenCalled();
  });
  it("saves positioning without rewriting other brand fields", async () => {
    const response = await request(app)
      .patch("/api/founder/cmo/brand-profile")
      .send({ id: 7, oneLiner: "  A better angle  ", audiencePrimary: "  Texas land buyers  " })
    expect(response.status).toBe(200)
    expect(h.set).toHaveBeenCalledWith({
      oneLiner: "A better angle",
      audiencePrimary: "Texas land buyers",
      updatedAt: expect.any(Date),
    })
  })
  it.each([
    { id: 7 },
    { id: 7, oneLiner: " " },
    { id: 7, slug: "other-brand" },
    { id: 7, updatedAt: "2026-01-01" },
  ])("rejects empty or immutable brand updates: %j", async (body) => {
    expect((await request(app).patch("/api/founder/cmo/brand-profile").send(body)).status).toBe(400)
    expect(h.update).not.toHaveBeenCalled()
  })
  it("returns missing profile as an error rather than claiming a save", async () => {
    h.returning.mockResolvedValueOnce([])
    expect(
      (
        await request(app)
          .patch("/api/founder/cmo/brand-profile")
          .send({ id: 7, oneLiner: "A better angle" })
      ).status
    ).toBe(404)
  })
})

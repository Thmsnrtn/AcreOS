import { beforeEach, describe, expect, it, vi } from "vitest"
import express from "express"
import request from "supertest"
const h = vi.hoisted(() => ({ select: vi.fn(), founder: true }))
vi.mock("../../server/db", () => ({ db: { select: h.select } }))
vi.mock("../../server/auth/clerkAuth", () => ({
  isAuthenticated: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireFounder: (
    _req: unknown,
    res: { sendStatus: (status: number) => void },
    next: () => void
  ) => (h.founder ? next() : res.sendStatus(403)),
}))
vi.mock("../../server/services/cmo/storage", () => ({ getStorage: vi.fn() }))
import { registerCmoRoutes } from "../../server/routes-cmo"
const app = express()
app.use(express.json())
registerCmoRoutes(app)
function read(rows: unknown[]) {
  const result = Promise.resolve(rows)
  h.select.mockReturnValueOnce({
    from: () => ({
      where: () => ({ then: result.then.bind(result), orderBy: () => ({ limit: () => result }) }),
    }),
  })
}
const createdAt = new Date("2026-10-13T12:00:00Z")
beforeEach(() => {
  vi.resetAllMocks()
  h.founder = true
})
describe("founder durable generation API", () => {
  it("retains terminal jobs moved to the dead-letter queue without exposing errors", async () => {
    read([])
    read([
      {
        originalOutboxId: 42,
        createdAt,
        payload: { intent: "Explain research" },
        failureReason: "secret provider body",
        status: "failed",
      },
    ])
    read([])
    read([])
    const response = await request(app).get("/api/founder/cmo/generation-jobs")
    expect(response.status).toBe(200)
    expect(response.body.jobs[0]).toMatchObject({
      id: 42,
      state: "failed",
      intent: "Explain research",
    })
    expect(JSON.stringify(response.body)).not.toContain("secret")
  })
  it("joins child worker receipts to the actual request identity", async () => {
    read([
      {
        id: 42,
        createdAt,
        status: "sent",
        payload: { intent: "Research", generationReceipt: { renderJobsQueued: 1 } },
      },
    ])
    read([])
    read([
      {
        id: 43,
        createdAt,
        status: "sent",
        payload: {
          generationJobId: 42,
          generationReceipt: { decisionsInboxItemId: 8, renderCount: 2, requestedRenderCount: 3 },
        },
      },
    ])
    read([])
    const response = await request(app).get("/api/founder/cmo/generation-jobs")
    expect(response.body.jobs[0]).toMatchObject({
      id: 42,
      state: "partially_completed",
      reviewIds: [8],
    })
  })
  it("fails a failed read instead of claiming an empty queue", async () => {
    const result = Promise.reject(new Error("database unavailable"))
    result.catch(() => {})
    h.select.mockReturnValue({
      from: () => ({ where: () => ({ orderBy: () => ({ limit: () => result }) }) }),
    })
    expect((await request(app).get("/api/founder/cmo/generation-jobs")).status).toBe(500)
  })
  it("requires founder authorization before querying job records", async () => {
    h.founder = false
    expect((await request(app).get("/api/founder/cmo/generation-jobs")).status).toBe(403)
    expect(h.select).not.toHaveBeenCalled()
  })
})

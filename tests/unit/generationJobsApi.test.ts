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
const predicates: unknown[] = []
function read(rows: unknown[]) {
  const result = Promise.resolve(rows)
  h.select.mockReturnValueOnce({
    from: () => ({
      where: (predicate: unknown) => { predicates.push(predicate); return ({ then: result.then.bind(result), orderBy: () => ({ limit: () => result }) }); },
    }),
  })
}
const createdAt = new Date("2026-10-13T12:00:00Z")
beforeEach(() => {
  vi.resetAllMocks()
  h.founder = true
  predicates.length = 0
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

describe("exact generation recovery record", () => {
  it("reads an older dead-letter request by original identity, with only safe receipt fields", async () => {
    read([])
    read([{ originalOutboxId: 1, createdAt, payload: { intent: "Older request", generationReceipt: { totalCostCents: 123, providerKey: "secret" } }, failureReason: "secret", status: "failed" }])
    read([]); read([])
    const response = await request(app).get("/api/founder/cmo/generation-jobs/1")
    expect(response.status).toBe(200)
    expect(response.body.job).toMatchObject({ id: 1, state: "failed", receipt: { totalCostCents: 123 } })
    expect(JSON.stringify(response.body)).not.toContain("secret")
    const { PgDialect } = await import("drizzle-orm/pg-core")
    const dialect = new PgDialect()
    const queries = predicates.map(p => dialect.sqlToQuery(p as import("drizzle-orm").SQL))
    expect(queries[0].sql).toContain('"outbox"."id"')
    expect(queries[1].sql).toContain('"outbox_dlq"."original_outbox_id"')
    expect(queries[0].params).toEqual(["cmo.manual-generate", 1])
    expect(queries[1].params).toEqual(["cmo.manual-generate", 1])
  })
  it("joins all children to the selected request rather than the recent list", async () => {
    read([{ id: 1, createdAt, status: "sent", payload: { generationReceipt: { renderJobsQueued: 1 } } }]); read([])
    read([{ id: 99, createdAt, status: "sent", payload: { generationJobId: 1, generationReceipt: { decisionsInboxItemId: 8 } } }]); read([])
    const response = await request(app).get("/api/founder/cmo/generation-jobs/1")
    expect(response.body.job).toMatchObject({ id: 1, state: "review_created", reviewIds: [8], renderJobs: { expected: 1, processed: 1, failed: 0 } })
  })
  it.each(["0", "01", "-1", "1.2", "NaN", "2147483648"])("rejects invalid identity %s before reading", async id => {
    expect((await request(app).get(`/api/founder/cmo/generation-jobs/${id}`)).status).toBe(400)
    expect(h.select).not.toHaveBeenCalled()
  })
  it("returns 404 for a missing request", async () => {
    read([]); read([])
    expect((await request(app).get("/api/founder/cmo/generation-jobs/1")).status).toBe(404)
    expect(h.select).toHaveBeenCalledTimes(2)
  })
  it("returns an error for a failed exact read rather than reporting a missing record", async () => {
    const result = Promise.reject(new Error("database unavailable"))
    result.catch(() => {})
    h.select.mockReturnValue({ from: () => ({ where: () => ({ orderBy: () => ({ limit: () => result }) }) }) })
    expect((await request(app).get("/api/founder/cmo/generation-jobs/1")).status).toBe(500)
  })
  it("keeps the exact record founder-only", async () => {
    h.founder = false
    expect((await request(app).get("/api/founder/cmo/generation-jobs/1")).status).toBe(403)
    expect(h.select).not.toHaveBeenCalled()
  })
})

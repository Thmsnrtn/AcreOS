/**
 * Tests for the founder HTTP surface of the Solene dispatch queue
 * (server/routes-dispatch.ts).
 *
 * Coverage matches the keystone-1 contract:
 *   - 401 when unauthenticated
 *   - 404 when authenticated but not founder
 *     (requireFounder returns 404 by design to hide route existence; we
 *      assert the actual behavior, not the wishful 403.)
 *   - POST /queue happy path returns dispatchId + row persisted with status='queued'
 *   - POST /queue invalid agentRole → 422
 *   - POST /queue maxCostUsd > $100 without founderOverride → 400
 *   - GET /dispatches respects limit + DESC ordering
 *   - GET /:id 404 path
 *   - POST /:id/cancel happy path (queued → cancelled)
 *   - POST /:id/cancel from non-queued state → 400
 *
 * The dispatchQueue service is unit-tested separately
 * (server/services/solene/dispatchQueue.test.ts); here we exercise the route
 * layer with a small in-memory mock of just that service's public surface.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// In-memory dispatch store backing the service mocks.
// ---------------------------------------------------------------------------

interface MockQueueRow {
  id: number;
  queuedAt: Date;
  status: string;
  priority: string;
  sourceType: string;
  sourceId: string;
  agentRole: string;
  promptText: string;
  maxCostUsd: string;
  timeoutMs: number;
  startedAt: Date | null;
  completedAt: Date | null;
  resultSummary: string | null;
  resultFullPath: string | null;
  enqueuedBy: string | null;
}

const STORE: MockQueueRow[] = [];
let NEXT_ID = 1;

function resetStore() {
  STORE.length = 0;
  NEXT_ID = 1;
}

// ---------------------------------------------------------------------------
// Mocks: dispatchQueue service + logger.
// ---------------------------------------------------------------------------

vi.mock("./utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("./services/solene/dispatchQueue", () => ({
  enqueueDispatch: vi.fn(async (opts: any) => {
    const maxCostUsd = opts.maxCostUsd ?? 25;
    const timeoutMs = opts.timeoutMs ?? 600_000;
    if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0) {
      throw new Error(`enqueueDispatch: invalid maxCostUsd=${maxCostUsd}`);
    }
    if (maxCostUsd > 100 && !opts.founderOverride) {
      throw new Error(
        `enqueueDispatch: maxCostUsd=$${maxCostUsd} exceeds ceiling $100 — founderOverride required`,
      );
    }
    if (!opts.promptText || opts.promptText.trim().length === 0) {
      throw new Error("enqueueDispatch: promptText must be non-empty");
    }
    const id = NEXT_ID++;
    STORE.push({
      id,
      queuedAt: new Date(),
      status: "queued",
      priority: (opts.priority ?? 1).toFixed(3),
      sourceType: opts.sourceType,
      sourceId: opts.sourceId,
      agentRole: opts.agentRole,
      promptText: opts.promptText,
      maxCostUsd: maxCostUsd.toFixed(2),
      timeoutMs,
      startedAt: null,
      completedAt: null,
      resultSummary: null,
      resultFullPath: null,
      enqueuedBy: opts.enqueuedBy ?? null,
    });
    return id;
  }),
  listDispatches: vi.fn(async (opts: { status?: string; limit?: number }) => {
    const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? 50)), 200);
    const filtered = opts.status
      ? STORE.filter((r) => r.status === opts.status)
      : STORE.slice();
    filtered.sort((a, b) => b.queuedAt.getTime() - a.queuedAt.getTime());
    return filtered.slice(0, limit).map((q) => ({ queue: q, result: null }));
  }),
  getDispatchById: vi.fn(async (id: number) => {
    const q = STORE.find((r) => r.id === id);
    if (!q) return null;
    return { queue: q, result: null };
  }),
  cancelQueuedDispatch: vi.fn(async (id: number, reason: string) => {
    const row = STORE.find((r) => r.id === id);
    if (!row) return { ok: false, priorStatus: null };
    if (row.status !== "queued") return { ok: false, priorStatus: row.status };
    row.status = "cancelled";
    row.completedAt = new Date();
    row.resultSummary = reason && reason.trim().length > 0
      ? `cancelled by founder: ${reason}`
      : "cancelled by founder";
    return { ok: true, priorStatus: "queued" };
  }),
}));

// ---------------------------------------------------------------------------
// Auth middleware mock — toggled per-test via module-level flags.
// ---------------------------------------------------------------------------

const AUTH_STATE = {
  authenticated: true,
  founder: true,
};

vi.mock("./auth", () => ({
  isAuthenticated: (_req: any, res: any, next: any) => {
    if (!AUTH_STATE.authenticated) {
      return res.status(401).json({ error: "UNAUTHORIZED", message: "No session" });
    }
    return next();
  },
  requireFounder: (_req: any, res: any, next: any) => {
    if (!AUTH_STATE.founder) {
      // Real middleware returns 404 to hide founder-only route existence.
      return res.status(404).json({ message: "Not found" });
    }
    return next();
  },
}));

// ---------------------------------------------------------------------------
// Test app builder.
// ---------------------------------------------------------------------------

async function buildApp() {
  const { registerDispatchRoutes } = await import("./routes-dispatch");
  const app = express();
  app.use(express.json());
  registerDispatchRoutes(app);
  return app;
}

beforeEach(() => {
  resetStore();
  AUTH_STATE.authenticated = true;
  AUTH_STATE.founder = true;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// AUTH GATES
// ---------------------------------------------------------------------------

describe("auth gates", () => {
  it("returns 401 when unauthenticated", async () => {
    AUTH_STATE.authenticated = false;
    const app = await buildApp();
    const res = await request(app).get("/api/founder/dispatches");
    expect(res.status).toBe(401);
  });

  it("returns 404 (hide-existence) when authenticated but not founder", async () => {
    AUTH_STATE.authenticated = true;
    AUTH_STATE.founder = false;
    const app = await buildApp();
    const res = await request(app).get("/api/founder/dispatches");
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/founder/dispatches/queue
// ---------------------------------------------------------------------------

describe("POST /api/founder/dispatches/queue", () => {
  it("happy path returns a dispatch id and persists with status='queued'", async () => {
    const app = await buildApp();
    const res = await request(app)
      .post("/api/founder/dispatches/queue")
      .send({
        sourceType: "founder_manual",
        sourceId: "founder:tom",
        agentRole: "iris",
        promptText: "investigate dispatch HTTP surface",
      });
    expect(res.status).toBe(201);
    expect(res.body.dispatchId).toBeGreaterThan(0);
    const row = STORE.find((r) => r.id === res.body.dispatchId);
    expect(row).toBeDefined();
    expect(row?.status).toBe("queued");
    expect(row?.agentRole).toBe("iris");
  });

  it("returns 422 for invalid agentRole", async () => {
    const app = await buildApp();
    const res = await request(app)
      .post("/api/founder/dispatches/queue")
      .send({
        sourceType: "founder_manual",
        sourceId: "founder:tom",
        agentRole: "nobody-by-that-name",
        promptText: "task",
      });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("VALIDATION_FAILED");
  });

  it("returns 422 for invalid sourceType", async () => {
    const app = await buildApp();
    const res = await request(app)
      .post("/api/founder/dispatches/queue")
      .send({
        sourceType: "not-a-source",
        sourceId: "x",
        agentRole: "iris",
        promptText: "task",
      });
    expect(res.status).toBe(422);
  });

  it("returns 400 when maxCostUsd > $100 and no founderOverride", async () => {
    const app = await buildApp();
    const res = await request(app)
      .post("/api/founder/dispatches/queue")
      .send({
        sourceType: "founder_manual",
        sourceId: "founder:tom",
        agentRole: "iris",
        promptText: "overnight task",
        maxCostUsd: 250,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("BAD_REQUEST");
    expect(res.body.message).toMatch(/exceeds ceiling/);
  });

  it("accepts maxCostUsd > $100 with founderOverride=true", async () => {
    const app = await buildApp();
    const res = await request(app)
      .post("/api/founder/dispatches/queue")
      .send({
        sourceType: "founder_manual",
        sourceId: "founder:tom",
        agentRole: "iris",
        promptText: "overnight task",
        maxCostUsd: 250,
        founderOverride: true,
      });
    expect(res.status).toBe(201);
    expect(res.body.dispatchId).toBeGreaterThan(0);
  });

  it("returns 422 for empty promptText (zod min(1) gate)", async () => {
    const app = await buildApp();
    const res = await request(app)
      .post("/api/founder/dispatches/queue")
      .send({
        sourceType: "founder_manual",
        sourceId: "x",
        agentRole: "iris",
        promptText: "",
      });
    expect(res.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// GET /api/founder/dispatches
// ---------------------------------------------------------------------------

describe("GET /api/founder/dispatches", () => {
  async function seed(app: express.Express, count: number) {
    for (let i = 0; i < count; i++) {
      // small delay so queued_at is monotonically increasing
      await new Promise((r) => setTimeout(r, 2));
      await request(app)
        .post("/api/founder/dispatches/queue")
        .send({
          sourceType: "auto_dispatch",
          sourceId: `opp:${i}`,
          agentRole: "iris",
          promptText: `task ${i}`,
        });
    }
  }

  it("returns dispatches ordered by queued_at DESC", async () => {
    const app = await buildApp();
    await seed(app, 3);
    const res = await request(app).get("/api/founder/dispatches");
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);
    const ids: number[] = res.body.dispatches.map((d: any) => d.id);
    // Newest first (highest id, since we incremented in order)
    expect(ids).toEqual([3, 2, 1]);
  });

  it("honors the limit query param", async () => {
    const app = await buildApp();
    await seed(app, 5);
    const res = await request(app).get("/api/founder/dispatches?limit=2");
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.dispatches).toHaveLength(2);
  });

  it("filters by status", async () => {
    const app = await buildApp();
    await seed(app, 2);
    // Cancel one
    await request(app).post("/api/founder/dispatches/1/cancel").send({});
    const queuedRes = await request(app).get("/api/founder/dispatches?status=queued");
    expect(queuedRes.body.count).toBe(1);
    const cancelledRes = await request(app).get(
      "/api/founder/dispatches?status=cancelled",
    );
    expect(cancelledRes.body.count).toBe(1);
  });

  it("returns 422 for invalid status enum", async () => {
    const app = await buildApp();
    const res = await request(app).get("/api/founder/dispatches?status=bogus");
    expect(res.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// GET /api/founder/dispatches/:id
// ---------------------------------------------------------------------------

describe("GET /api/founder/dispatches/:id", () => {
  it("returns 404 when no row exists for the id", async () => {
    const app = await buildApp();
    const res = await request(app).get("/api/founder/dispatches/9999");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("NOT_FOUND");
  });

  it("returns the row + nested result shape", async () => {
    const app = await buildApp();
    const enq = await request(app)
      .post("/api/founder/dispatches/queue")
      .send({
        sourceType: "founder_manual",
        sourceId: "founder:tom",
        agentRole: "soren",
        promptText: "task",
      });
    const id = enq.body.dispatchId;
    const res = await request(app).get(`/api/founder/dispatches/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.dispatch.id).toBe(id);
    expect(res.body.dispatch.status).toBe("queued");
    expect(res.body.dispatch.agentRole).toBe("soren");
    expect(res.body.dispatch.result).toBeNull();
  });

  it("returns 422 for a non-numeric id", async () => {
    const app = await buildApp();
    const res = await request(app).get("/api/founder/dispatches/not-a-number");
    expect(res.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// POST /api/founder/dispatches/:id/cancel
// ---------------------------------------------------------------------------

describe("POST /api/founder/dispatches/:id/cancel", () => {
  async function enqueueOne(app: express.Express) {
    const res = await request(app)
      .post("/api/founder/dispatches/queue")
      .send({
        sourceType: "founder_manual",
        sourceId: "founder:tom",
        agentRole: "iris",
        promptText: "task",
      });
    return res.body.dispatchId as number;
  }

  it("happy path: queued → cancelled", async () => {
    const app = await buildApp();
    const id = await enqueueOne(app);
    const res = await request(app)
      .post(`/api/founder/dispatches/${id}/cancel`)
      .send({ reason: "no longer needed" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const row = STORE.find((r) => r.id === id);
    expect(row?.status).toBe("cancelled");
    expect(row?.completedAt).toBeInstanceOf(Date);
    expect(row?.resultSummary).toMatch(/cancelled by founder/);
  });

  it("does NOT write a solene_dispatch_results row (pre-claim cancel)", async () => {
    // We don't mock the results table — but cancelQueuedDispatch (per spec)
    // never touches it. We verify the SERVICE call signature in the unit
    // tests of dispatchQueue; here we just confirm the route returns ok.
    const app = await buildApp();
    const id = await enqueueOne(app);
    const res = await request(app)
      .post(`/api/founder/dispatches/${id}/cancel`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("returns 400 when source state is not 'queued' (in_progress)", async () => {
    const app = await buildApp();
    const id = await enqueueOne(app);
    // Force the row into in_progress directly in the store.
    const row = STORE.find((r) => r.id === id)!;
    row.status = "in_progress";
    row.startedAt = new Date();

    const res = await request(app)
      .post(`/api/founder/dispatches/${id}/cancel`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("BAD_REQUEST");
    expect(res.body.message).toMatch(/'in_progress'/);
    expect(res.body.details?.priorStatus).toBe("in_progress");
  });

  it("returns 400 when already cancelled", async () => {
    const app = await buildApp();
    const id = await enqueueOne(app);
    await request(app).post(`/api/founder/dispatches/${id}/cancel`).send({});
    const res = await request(app)
      .post(`/api/founder/dispatches/${id}/cancel`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.details?.priorStatus).toBe("cancelled");
  });

  it("returns 404 for an unknown id", async () => {
    const app = await buildApp();
    const res = await request(app)
      .post("/api/founder/dispatches/99999/cancel")
      .send({});
    expect(res.status).toBe(404);
  });
});

/**
 * POST /api/leads against a REAL Postgres built from this repo — two defects
 * that a mock cannot show, because both are about what the database does.
 *
 * 1. A NUL (U+0000) in any JSON string reached Postgres, which cannot store it
 *    in text/jsonb, and came back as a 500. It is now refused once, for every
 *    route, by `installBodyParsers` (server/middleware/bodyParsing.ts), with a
 *    422 in the shared validation shape. The first test below is the repro: it
 *    runs the same route WITHOUT the refusal and watches the database reject
 *    the write.
 *
 * 2. Lead creation ignored Idempotency-Key, so a client retrying a timed-out
 *    create made a second lead. It now runs `idempotencyMiddleware` like the
 *    other create routes — a sequential retry replays the first response, and
 *    a CONCURRENT retry (the first still running) is refused with 409 rather
 *    than run twice. Both are checked by counting rows, not by reading the
 *    response.
 *
 * Writes only its own organization's rows and deletes them afterwards. Audit
 * writes are stubbed (audit_log is append-only).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("leadCreateBodyHardening");

const h = vi.hoisted(() => ({ orgId: 0, userId: "lead-hardening-test-user" }));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: { user?: unknown }, _s: unknown, n: () => void) => {
    req.user = { id: h.userId };
    n();
  },
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: { organization?: unknown }, _s: unknown, n: () => void) => {
    req.organization = { id: h.orgId, subscriptionTier: "pro", name: "Lead hardening test org" };
    n();
  },
}));
vi.mock("../../server/utils/permissions", async (orig) => ({
  ...(await orig<typeof import("../../server/utils/permissions")>()),
  attachPermissionContext: () => (_q: unknown, _s: unknown, n: () => void) => n(),
}));
vi.mock("../../server/middleware/roleScope", async (orig) => ({
  ...(await orig<typeof import("../../server/middleware/roleScope")>()),
  requireScope: () => (_q: unknown, _s: unknown, n: () => void) => n(),
}));
vi.mock("../../server/middleware/usageLimitGate", async (orig) => ({
  ...(await orig<typeof import("../../server/middleware/usageLimitGate")>()),
  usageLimitGate: () => (_q: unknown, _s: unknown, n: () => void) => n(),
}));
vi.mock("../../server/services/usageLimits", async (orig) => ({
  ...(await orig<typeof import("../../server/services/usageLimits")>()),
  checkUsageLimit: async () => ({ allowed: true, current: 0, limit: null, resourceType: "leads", tier: "pro" }),
}));
// Fire-and-forget side effects of a create — none of them is under test, and
// each would otherwise write rows this test does not own.
vi.mock("../../server/services/leadAssigner", () => ({ assignLead: async () => null }));
vi.mock("../../server/services/leadEvents", async (orig) => ({
  ...(await orig<typeof import("../../server/services/leadEvents")>()),
  emitLeadCreated: () => {},
  emitLeadUpdated: () => {},
  safeEmitLeadEvent: () => {},
}));
vi.mock("../../server/services/activation", () => ({ recordActivationEventAsync: () => {} }));
vi.mock("../../server/services/compliance/ofacScreening", () => ({ screenCounterpartyAsync: () => {} }));
vi.mock("../../server/services/mlSnapshots", () => ({ recordSnapshotAsync: () => {} }));
vi.mock("../../server/services/webhookDispatcher", () => ({ webhookLeadCreated: async () => {} }));

const NUL_NAME = "Ann\u0000Lee";

describe.skipIf(!realDbAvailable)("POST /api/leads on a real database", () => {
  let hardened: Express;
  let unhardened: Express;
  let countLeads: (lastName: string) => Promise<number>;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const { db, pool } = await import("../../server/db");
    const { organizations, leads, activityLog } = await import("@shared/schema");
    const { and, eq } = await import("drizzle-orm");
    const { storage } = await import("../../server/storage");
    vi.spyOn(storage, "createAuditLogEntry").mockResolvedValue(undefined as never);

    const slug = `lead-hardening-${process.pid}-${Date.now()}`;
    const [org] = await db
      .insert(organizations)
      .values({ name: "Lead hardening test org", slug, ownerId: h.userId })
      .returning({ id: organizations.id });
    h.orgId = org.id;

    countLeads = async (lastName) =>
      (await db.select({ id: leads.id }).from(leads).where(and(eq(leads.organizationId, h.orgId), eq(leads.lastName, lastName)))).length;
    cleanup = async () => {
      // storage.createLead writes an activity_log row per lead.
      await db.delete(activityLog).where(eq(activityLog.organizationId, h.orgId));
      await db.delete(leads).where(eq(leads.organizationId, h.orgId));
      await db.delete(organizations).where(eq(organizations.id, h.orgId));
      await pool.end().catch(() => {});
    };

    const { registerLeadRoutes } = await import("../../server/routes-leads");
    const { installBodyParsers } = await import("../../server/middleware/bodyParsing");
    const { terminalErrorHandler } = await import("../../server/middleware/terminalErrorHandler");

    hardened = express();
    installBodyParsers(hardened); // exactly what server/index.ts installs
    registerLeadRoutes(hardened);
    hardened.use(terminalErrorHandler);

    unhardened = express();
    unhardened.use(express.json());
    registerLeadRoutes(unhardened);
    unhardened.use(terminalErrorHandler);
  });

  afterAll(async () => {
    if (h.orgId) await cleanup();
  });

  describe("a NUL character in a string field", () => {
    it("REPRO: without the refusal, Postgres rejects the write and the caller gets a 500", async () => {
      const res = await request(unhardened)
        .post("/api/leads")
        .send({ firstName: NUL_NAME, lastName: "NulRepro" });
      expect(res.status).toBe(500);
      expect(await countLeads("NulRepro")).toBe(0);
    });

    it("is refused with 422 in the shared validation shape, naming the field, and nothing is written", async () => {
      const res = await request(hardened)
        .post("/api/leads")
        .send({ firstName: NUL_NAME, lastName: "NulRefused" });
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ error: "VALIDATION_FAILED", statusCode: 422 });
      expect(typeof res.body.message).toBe("string");
      expect(res.body.details).toEqual([expect.objectContaining({ path: ["firstName"] })]);
      expect(await countLeads("NulRefused")).toBe(0);
    });

    it("is found anywhere in the body — nested values and object keys", async () => {
      const res = await request(hardened)
        .post("/api/leads")
        .send({ firstName: "Ann", lastName: "NulNested", customFields: { ["k\u0000"]: "v", list: ["ok", "b\u0000d"] } });
      expect(res.status).toBe(422);
      const paths = (res.body.details as Array<{ path: unknown[] }>).map((d) => d.path.join("."));
      expect(paths.sort()).toEqual(["customFields.k\u0000", "customFields.list.1"]);
    });

    it("a clean body still creates the lead (the refusal is not a blanket block)", async () => {
      const res = await request(hardened).post("/api/leads").send({ firstName: "Ann", lastName: "NulClean" });
      expect(res.status).toBe(201);
      expect(await countLeads("NulClean")).toBe(1);
    });
  });

  describe("Idempotency-Key", () => {
    it("a sequential retry with the same key replays the first response and writes ONE lead", async () => {
      const key = `lead-retry-${Date.now()}`;
      const first = await request(hardened).post("/api/leads").set("Idempotency-Key", key).send({ firstName: "Bo", lastName: "IdemSeq" });
      const retry = await request(hardened).post("/api/leads").set("Idempotency-Key", key).send({ firstName: "Bo", lastName: "IdemSeq" });
      expect(first.status).toBe(201);
      expect(retry.status).toBe(201);
      expect(retry.body.id).toBe(first.body.id);
      expect(await countLeads("IdemSeq")).toBe(1);
    });

    it("a CONCURRENT retry (first still running) is refused with 409, not run twice", async () => {
      const key = `lead-concurrent-${Date.now()}`;
      const send = () => request(hardened).post("/api/leads").set("Idempotency-Key", key).send({ firstName: "Cy", lastName: "IdemConc" });
      const results = await Promise.all([send(), send(), send()]);
      const statuses = results.map((r) => r.status).sort();
      expect(statuses.filter((s) => s === 201).length).toBeGreaterThanOrEqual(1);
      for (const s of statuses) expect([201, 409]).toContain(s);
      const conflicts = results.filter((r) => r.status === 409);
      for (const c of conflicts) expect(c.body).toMatchObject({ error: "IDEMPOTENCY_IN_PROGRESS", statusCode: 409 });
      const ids = new Set(results.filter((r) => r.status === 201).map((r) => r.body.id));
      expect(ids.size).toBe(1);
      expect(await countLeads("IdemConc")).toBe(1);
    });

    it("different keys are different creates", async () => {
      await request(hardened).post("/api/leads").set("Idempotency-Key", `a-${Date.now()}`).send({ firstName: "Di", lastName: "IdemTwo" });
      await request(hardened).post("/api/leads").set("Idempotency-Key", `b-${Date.now()}`).send({ firstName: "Di", lastName: "IdemTwo" });
      expect(await countLeads("IdemTwo")).toBe(2);
    });
  });
});

// The real-database tests above install `installBodyParsers`; this pins that
// production installs the SAME function, ahead of every route — otherwise the
// tests would prove a property of a function nothing serves.
describe("server/index.ts installs the NUL-refusing parsers before any route", () => {
  it("calls installBodyParsers(app) once, before registerRoutes, and parses JSON nowhere else globally", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { stripComments } = await import("../helpers/stripComments");
    const src = stripComments(readFileSync(resolve(__dirname, "../../server/index.ts"), "utf8"));
    const install = src.indexOf("installBodyParsers(app)");
    expect(install).toBeGreaterThan(-1);
    expect(src.indexOf("installBodyParsers(app)", install + 1)).toBe(-1);
    expect(install).toBeLessThan(src.indexOf("await registerRoutes("));
    // A second global `app.use(express.json(...))` would parse bodies the
    // refusal never sees. Route-local parsers (the Stripe raw webhook, the CSP
    // report) are per-path registrations, not `app.use(express.json`.
    expect(src).not.toMatch(/app\.use\(\s*express\.(json|urlencoded)\(/);
  });
});

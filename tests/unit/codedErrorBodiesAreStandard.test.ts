/**
 * DEFECT-0050 (coded bodies) — an error whose `error` is a MACHINE CODE goes
 * out in the standard `{ error, message, details?, statusCode }` shape, with
 * the code still in `error` (where clients branch on it) and every extra field
 * moved under `details`.
 *
 * These were raw `res.status(X).json({...})` bodies. Some had no `error` at
 * all (the usage-limit 429s, so the client's upgrade toast never fired for
 * them), some had no `message` (so the client toasted the raw JSON text), and
 * the rest carried their data as stray top-level keys no two routes agreed on.
 *
 * Each case drives the REAL handler or middleware over HTTP and checks the
 * body a client actually receives — not the source that produced it.
 */
import { describe, it, expect, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";

vi.mock("../../server/db", () => ({ db: {} }));

const STANDARD_KEYS = new Set(["error", "message", "details", "statusCode", "docsUrl", "requestId"]);

/** The contract every error body must meet, whatever its code. */
function expectStandardShape(body: Record<string, unknown>, status: number, code: string): void {
  expect(body.error, "the machine code rides in `error`").toBe(code);
  expect(typeof body.message, "a human `message` — the client renders this").toBe("string");
  expect((body.message as string).length).toBeGreaterThan(0);
  expect(body.statusCode).toBe(status);
  const stray = Object.keys(body).filter((k) => !STANDARD_KEYS.has(k));
  expect(stray, "extra fields belong under `details`, not at the top level").toEqual([]);
}

const passthrough = (_req: unknown, _res: unknown, next: () => void) => next();

describe("LIMIT_EXCEEDED — the code the client's upgrade toast branches on", () => {
  it("POST /api/properties over the plan limit is a standard 429 carrying LIMIT_EXCEEDED and the counts in details", async () => {
    vi.resetModules();
    vi.doMock("../../server/auth", () => ({ isAuthenticated: passthrough }));
    vi.doMock("../../server/middleware/getOrCreateOrg", () => ({
      getOrCreateOrg: (req: { organization?: unknown }, _s: unknown, n: () => void) => {
        req.organization = { id: 7 };
        n();
      },
    }));
    vi.doMock("../../server/services/usageLimits", () => ({
      checkUsageLimit: vi.fn(async () => ({
        allowed: false,
        current: 10,
        limit: 10,
        resourceType: "properties",
        tier: "free",
      })),
    }));
    const createProperty = vi.fn();
    vi.doMock("../../server/storage", () => ({ storage: { createProperty }, db: {} }));
    const { registerPropertyRoutes } = await import("../../server/routes-properties");
    const app = express();
    app.use(express.json());
    registerPropertyRoutes(app);

    const res = await request(app).post("/api/properties").send({ apn: "1-2-3", county: "X", state: "TX" });

    expect(res.status).toBe(429);
    expectStandardShape(res.body, 429, "LIMIT_EXCEEDED");
    // formatUpgradeUpsell (client/src/lib/queryClient.ts) reads these from details.
    expect(res.body.details).toEqual({ current: 10, limit: 10, resourceType: "properties", tier: "free" });
    expect(res.body.message).toMatch(/Property limit reached \(10\/10\)/);
    expect(createProperty).not.toHaveBeenCalled();
  });

  it("the client still branches on exactly that code", () => {
    // Ties the server code above to the reader that consumes it: if either
    // side renames the code, one of these two tests goes red.
    const src = stripComments(readFileSync(resolve(__dirname, "../../client/src/lib/queryClient.ts"), "utf8"));
    expect(src).toMatch(/body\.error === "LIMIT_EXCEEDED"/);
    expect(src).toMatch(/const details = body\.details/);
  });
});

describe("rate_limit_exceeded — the global limiter", () => {
  it("the 429 keeps its code and moves retryAfter under details, matching Retry-After", async () => {
    vi.resetModules();
    const { createRateLimiter, clearRateLimitStore } = await import("../../server/middleware/rateLimit");
    const app = express();
    app.get("/x", createRateLimiter({ maxRequests: 1, windowMs: 60_000 }), (_req, res) => res.json({ ok: true }));

    expect((await request(app).get("/x")).status).toBe(200);
    const res = await request(app).get("/x");
    clearRateLimitStore();

    expect(res.status).toBe(429);
    expectStandardShape(res.body, 429, "rate_limit_exceeded");
    expect(res.body.details.retryAfter).toBe(Number(res.headers["retry-after"]));
  });
});

describe("subscription_paused — the pause gate", () => {
  it("a mutation on a paused org is a standard 402 with the countdown under details", async () => {
    vi.resetModules();
    const { subscriptionPauseGate } = await import("../../server/middleware/subscriptionPauseGate");
    const endsAt = new Date(Date.now() + 86_400_000).toISOString();
    const app = express();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      Object.assign(req, { organization: { id: 7, subscriptionPaused: true, subscriptionPauseEndsAt: new Date(endsAt) } });
      next();
    });
    app.use(subscriptionPauseGate);
    app.post("/api/deals/1", (_req, res) => res.json({ wrote: true }));

    const res = await request(app).post("/api/deals/1").send({});

    expect(res.status).toBe(402);
    expectStandardShape(res.body, 402, "subscription_paused");
    expect(res.body.details).toEqual({ subscriptionPauseEndsAt: endsAt });
  });
});

describe("tax_identity_missing — the code the tax-readiness page branches on", () => {
  it("GET /1099 with a missing TIN is a standard 422; the note id the page shows is in details", async () => {
    vi.resetModules();
    class TaxIdentityError extends Error {
      readonly code = "RECIPIENT_TIN_MISSING";
      readonly orgId = 7;
      readonly noteId = 42;
    }
    vi.doMock("../../server/services/bookkeeping", () => ({
      TaxIdentityError,
      generate1099IntForms: vi.fn(async () => {
        throw new TaxIdentityError("Note 42 has no recipient TIN on file.");
      }),
      generateAnnualInterestReport: vi.fn(),
      calculateDealPnL: vi.fn(),
      getPortfolioAnnualSummary: vi.fn(),
    }));
    vi.doMock("../../server/services/form1099Refusal", () => ({
      requireQualified1099Output: () => passthrough,
    }));
    const { default: bookkeepingRouter } = await import("../../server/routes-bookkeeping");
    const app = express();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      Object.assign(req, { organization: { id: 7 } });
      next();
    });
    app.use("/api/bookkeeping", bookkeepingRouter);

    const res = await request(app).get("/api/bookkeeping/1099?year=2025");

    expect(res.status).toBe(422);
    expectStandardShape(res.body, 422, "tax_identity_missing");
    expect(res.body.message).toBe("Note 42 has no recipient TIN on file.");
    expect(res.body.details).toEqual({ code: "RECIPIENT_TIN_MISSING", orgId: 7, noteId: 42 });

    // …and the page reads it from there (notes-tax-readiness.tsx).
    const page = stripComments(
      readFileSync(resolve(__dirname, "../../client/src/pages/notes-tax-readiness.tsx"), "utf8"),
    );
    expect(page).toContain('formsQuery.data.error === "tax_identity_missing"');
    expect(page).toContain("blockerError.details?.noteId");
  });
});

describe("VALIDATION_FAILED — a zod refusal that used to put an OBJECT in `error`", () => {
  it("PATCH /listings/:id with a bad body is a standard 422 whose `error` is a string code", async () => {
    vi.resetModules();
    const { default: taxResearcherRouter } = await import("../../server/routes-tax-researcher");
    const app = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: NextFunction) => {
      Object.assign(req, { organization: { id: 7 } });
      next();
    });
    app.use("/api/tax-researcher", taxResearcherRouter);

    const res = await request(app).patch("/api/tax-researcher/listings/5").send({ maxBidCents: -1 });

    expect(res.status).toBe(422);
    expectStandardShape(res.body, 422, "VALIDATION_FAILED");
    expect(res.body.details.fieldErrors).toHaveProperty("maxBidCents");
  });
});

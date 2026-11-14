/**
 * Privacy/GDPR endpoints now route through the DSAR pipeline.
 *
 * The customer-facing /api/privacy/{export,delete,status} endpoints used
 * to run gdprService inline. As of 2026-05-11 they enqueue rows in
 * dsar_requests_lifecycle with a 24h SLA deadline and return a queued
 * response. Tests below cover the pure logic the shim layer relies on:
 *
 *   - SLA deadline is 24h after receipt
 *   - "overdue" classification is `!fulfilled && deadline < now`
 *   - status response separates open from recent (≤5)
 *   - response shape includes requestId + eta='24h'
 *
 * These are pure-function checks; integration coverage of the round-trip
 * (HTTP + DB) is the next layer of testing.
 *
 * PKG-1 §5 assertion 1 / §7 — the BEHAVIOURAL clock test at the bottom of
 * this file drives the real routes-gdpr router (express + supertest) with a
 * frozen `clock` and a mocked db that captures the inserted lifecycle row,
 * and asserts `slaDeadlineAt − now === DSAR_CLOCK_HOURS` hours exactly, with
 * DSAR_CLOCK_HOURS imported from @shared/privacy/dsarClock. The local
 * SLA_HOURS literal below only feeds this file's pure mirrors of the shim
 * logic; it is no longer what proves the production deadline.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import express from "express";
import request from "supertest";

const shimDb = vi.hoisted(() => ({ inserted: [] as Array<Record<string, unknown>> }));

vi.mock("../../server/auth", () => ({
  isAuthenticated: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/utils/auditLog", () => ({
  auditFromRequest: vi.fn(async () => undefined),
  AuditActions: { DSAR_INTAKE: "dsar.intake" },
}));
vi.mock("../../server/db", () => ({
  db: {
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => {
          shimDb.inserted.push(v);
          return [{ id: `shim-row-${shimDb.inserted.length}`, ...v }];
        },
      }),
    }),
  },
}));

import gdprRouter from "../../server/routes-gdpr";
import { clock } from "../../server/utils/clock";
import { DSAR_CLOCK_HOURS } from "@shared/privacy/dsarClock";

const SLA_HOURS = 24;

function computeSlaDeadline(receivedAtMs: number): Date {
  return new Date(receivedAtMs + SLA_HOURS * 60 * 60 * 1000);
}

function isOverdue(row: { fulfilledAt: Date | null; slaDeadlineAt: Date }, nowMs: number): boolean {
  if (row.fulfilledAt) return false;
  return new Date(row.slaDeadlineAt).getTime() < nowMs;
}

interface LifecycleRow {
  id: string;
  requestType: "access" | "erasure" | "portability" | "rectification";
  requesterEmail: string;
  receivedAt: Date;
  slaDeadlineAt: Date;
  fulfilledAt: Date | null;
  deliveryMethod: string | null;
}

function buildStatusResponse(rows: LifecycleRow[], nowMs: number) {
  const open = rows
    .filter((r) => !r.fulfilledAt)
    .map((r) => ({
      id: r.id,
      type: r.requestType,
      receivedAt: r.receivedAt,
      slaDeadlineAt: r.slaDeadlineAt,
      overdue: isOverdue(r, nowMs),
    }));
  const recent = rows
    .filter((r) => r.fulfilledAt)
    .slice(0, 5)
    .map((r) => ({
      id: r.id,
      type: r.requestType,
      fulfilledAt: r.fulfilledAt,
      deliveryMethod: r.deliveryMethod,
    }));
  const deleted = rows.some((r) => r.requestType === "erasure" && !!r.fulfilledAt);
  return { deleted, open, recent };
}

function buildQueuedResponse(rowId: string, slaDeadlineAt: Date) {
  return {
    requestId: rowId,
    status: "queued" as const,
    eta: "24h" as const,
    slaDeadlineAt,
    canonical: "/api/privacy/dsar",
  };
}

describe("privacy DSAR shim — pure logic", () => {
  it("computes SLA deadline as receivedAt + 24h", () => {
    const received = Date.parse("2026-05-11T12:00:00Z");
    const deadline = computeSlaDeadline(received);
    expect(deadline.toISOString()).toBe("2026-05-12T12:00:00.000Z");
  });

  it("marks an unfulfilled row past its deadline as overdue", () => {
    const now = Date.parse("2026-05-11T12:00:00Z");
    const past = new Date(now - 60 * 1000);
    expect(isOverdue({ fulfilledAt: null, slaDeadlineAt: past }, now)).toBe(true);
  });

  it("never marks a fulfilled row overdue, even after deadline", () => {
    const now = Date.parse("2026-05-11T12:00:00Z");
    const past = new Date(now - 60 * 60 * 1000);
    expect(isOverdue({ fulfilledAt: new Date(), slaDeadlineAt: past }, now)).toBe(false);
  });

  it("does not flag a within-SLA row as overdue", () => {
    const now = Date.parse("2026-05-11T12:00:00Z");
    const future = new Date(now + 60 * 60 * 1000);
    expect(isOverdue({ fulfilledAt: null, slaDeadlineAt: future }, now)).toBe(false);
  });

  it("status response separates open from recent and caps recent at 5", () => {
    const now = Date.parse("2026-05-11T12:00:00Z");
    const rows: LifecycleRow[] = Array.from({ length: 8 }, (_, i) => ({
      id: `r${i}`,
      requestType: "access",
      requesterEmail: "u@example.com",
      receivedAt: new Date(now - (i + 1) * 60 * 60 * 1000),
      slaDeadlineAt: new Date(now - (i + 1) * 60 * 60 * 1000 + SLA_HOURS * 60 * 60 * 1000),
      fulfilledAt: new Date(now - (i + 1) * 60 * 60 * 1000 + 30 * 60 * 1000),
      deliveryMethod: "email",
    }));
    rows.unshift({
      id: "open-1",
      requestType: "erasure",
      requesterEmail: "u@example.com",
      receivedAt: new Date(now),
      slaDeadlineAt: new Date(now + SLA_HOURS * 60 * 60 * 1000),
      fulfilledAt: null,
      deliveryMethod: null,
    });

    const res = buildStatusResponse(rows, now);
    expect(res.open).toHaveLength(1);
    expect(res.open[0]!.id).toBe("open-1");
    expect(res.recent).toHaveLength(5);
    // legacy `deleted` flag: true iff a fulfilled erasure exists
    expect(res.deleted).toBe(false);
  });

  it("status.deleted is true only when at least one erasure has been fulfilled", () => {
    const now = Date.parse("2026-05-11T12:00:00Z");
    const erasureFulfilled: LifecycleRow = {
      id: "e1",
      requestType: "erasure",
      requesterEmail: "u@example.com",
      receivedAt: new Date(now - 2 * 24 * 60 * 60 * 1000),
      slaDeadlineAt: new Date(now - 24 * 60 * 60 * 1000),
      fulfilledAt: new Date(now - 23 * 60 * 60 * 1000),
      deliveryMethod: "email",
    };
    expect(buildStatusResponse([erasureFulfilled], now).deleted).toBe(true);
  });

  it("queued response payload is { requestId, status, eta, slaDeadlineAt, canonical }", () => {
    const deadline = new Date("2026-05-12T12:00:00Z");
    const payload = buildQueuedResponse("abc-123", deadline);
    expect(payload).toEqual({
      requestId: "abc-123",
      status: "queued",
      eta: "24h",
      slaDeadlineAt: deadline,
      canonical: "/api/privacy/dsar",
    });
  });
});

describe("privacy DSAR shim — behavioural clock (PKG-1 §5 assertion 1)", () => {
  const FROZEN_MS = Date.parse("2026-11-09T15:04:05.678Z");
  const HOUR_MS = 60 * 60 * 1000;

  function app(email: string | null) {
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => {
      (req as unknown as { user?: { email: string | null } }).user = { email };
      next();
    });
    a.use("/api/privacy", gdprRouter);
    return a;
  }

  afterEach(() => {
    vi.restoreAllMocks();
    shimDb.inserted = [];
  });

  it("POST /export stamps slaDeadlineAt − now === DSAR_CLOCK_HOURS hours, from the shared clock", async () => {
    vi.spyOn(clock, "nowMs").mockReturnValue(FROZEN_MS);
    const res = await request(app("Requester+Shim@Example.Test")).post("/api/privacy/export").send({});
    expect(res.status).toBe(202);
    expect(shimDb.inserted).toHaveLength(1);
    const row = shimDb.inserted[0]!;
    expect(row.requestType).toBe("access");
    expect(row.requesterEmail).toBe("requester+shim@example.test");
    const deadline = row.slaDeadlineAt as Date;
    expect(deadline).toBeInstanceOf(Date);
    expect(deadline.getTime() - FROZEN_MS).toBe(DSAR_CLOCK_HOURS * HOUR_MS);
    // The response carries the same stamp the row got.
    expect(new Date(res.body.slaDeadlineAt).getTime()).toBe(FROZEN_MS + DSAR_CLOCK_HOURS * HOUR_MS);
  });

  it("POST /delete stamps the same clock", async () => {
    vi.spyOn(clock, "nowMs").mockReturnValue(FROZEN_MS);
    const res = await request(app("erase+shim@example.test"))
      .post("/api/privacy/delete")
      .send({ confirm: "DELETE MY DATA" });
    expect(res.status).toBe(202);
    const row = shimDb.inserted[0]!;
    expect(row.requestType).toBe("erasure");
    expect((row.slaDeadlineAt as Date).getTime() - FROZEN_MS).toBe(DSAR_CLOCK_HOURS * HOUR_MS);
  });

  it("the deadline follows the frozen clock, not the wall clock (falsification)", async () => {
    // Move the frozen instant a full day; a deadline computed from Date.now()
    // or from a literal would not move with it.
    const shifted = FROZEN_MS + 24 * HOUR_MS;
    vi.spyOn(clock, "nowMs").mockReturnValue(shifted);
    await request(app("later+shim@example.test")).post("/api/privacy/export").send({});
    expect((shimDb.inserted[0]!.slaDeadlineAt as Date).getTime()).toBe(shifted + DSAR_CLOCK_HOURS * HOUR_MS);
  });
});

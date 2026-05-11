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
 */

import { describe, it, expect } from "vitest";

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

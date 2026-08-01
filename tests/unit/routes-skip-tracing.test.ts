/**
 * Wave A "Nothing lies" — skip tracing routes.
 *
 * Verifies the honest contract of server/routes-skip-tracing.ts with a
 * fully mocked storage layer (no DATABASE_URL needed):
 *   1. Stats are derived from real trace rows (traced/untraced/foundRate),
 *      with foundRate null (never a fabricated 0%) when nothing finished.
 *   2. Batch traces ONLY untraced leads (finished skip_traces rows are the
 *      marker) and consecutive runs ADVANCE past the first page instead of
 *      re-tracing (and re-charging) the same leads.
 *   3. Single + batch results are persisted via createSkipTrace and the
 *      primary phone/email are written back onto the lead — but never over
 *      operator-entered contact info.
 *   4. Provider failure on the single-trace path refunds the debit and
 *      returns an honest 503 instead of a fabricated empty result.
 *
 * FCRA note (2026-08-01): both POST endpoints now require purposeOfUse +
 * justification and a current annual attestation (the §1681b gate from
 * routes-leads.ts). The gate module is mocked PERMISSIVE here so this suite
 * keeps pinning the tracing mechanics; the gate's refusals, attestation TTL,
 * once-per-batch semantics, and audit-field stamping are pinned for real in
 * tests/unit/fcraPermissiblePurposeGate.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

// ── Mocks (before importing the module under test) ──────────────────────────

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/middleware/rateLimit", () => ({
  createRateLimiter: () => (_req: any, _res: any, next: any) => next(),
}));

// Permissive gate double — see the FCRA note in the header. The route
// imports this module dynamically; the error classes must exist for its
// instanceof refusal mapping.
vi.mock("../../server/services/fcraAttestation", () => {
  class SkipTracePurposeRequiredError extends Error {
    readonly code = "SKIP_TRACE_PURPOSE_REQUIRED" as const;
  }
  class FcraAttestationStaleError extends Error {
    readonly code = "FCRA_ATTESTATION_REQUIRED" as const;
  }
  return {
    SkipTracePurposeRequiredError,
    FcraAttestationStaleError,
    assertSkipTracePermitted: vi.fn(async () => ({ attestationVersion: "test-attestation-v1" })),
    // Same wire shapes as the real helper (which the FCRA gate suite pins);
    // never reached here because the assert double above always resolves.
    respondFcraRefusal: (res: any, err: unknown): boolean => {
      if (err instanceof SkipTracePurposeRequiredError) {
        res.status(400).json({ error: "BAD_REQUEST", message: err.message, details: { code: err.code }, statusCode: 400 });
        return true;
      }
      if (err instanceof FcraAttestationStaleError) {
        res.status(403).json({ error: "FCRA_ATTESTATION_REQUIRED", message: err.message, statusCode: 403 });
        return true;
      }
      return false;
    },
  };
});

// In-memory data the storage mock serves. Tests reset these in beforeEach.
type FakeLead = {
  id: number;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};
type FakeTrace = { id: number; leadId: number | null; status: string };

let LEADS: FakeLead[] = [];
let TRACES: FakeTrace[] = [];
let nextTraceId = 1;
const createSkipTraceMock = vi.fn(async (row: any) => {
  const created = { id: nextTraceId++, ...row };
  // Persisting the row is what marks the lead "traced" — the batch filter
  // reads it back through getSkipTraces on the next request.
  TRACES.push({ id: created.id, leadId: row.leadId ?? null, status: row.status });
  return created;
});
const updateLeadMock = vi.fn(async (id: number, updates: any) => {
  const lead = LEADS.find((l) => l.id === id)!;
  Object.assign(lead, updates);
  return lead;
});

vi.mock("../../server/storage", () => ({
  storage: {
    getLeads: vi.fn(async () => LEADS),
    getLead: vi.fn(async (_orgId: number, id: number) => LEADS.find((l) => l.id === id)),
    getSkipTraces: vi.fn(async () => TRACES),
    createSkipTrace: (...args: any[]) => createSkipTraceMock(...(args as [any])),
    updateLead: (...args: any[]) => updateLeadMock(...(args as [number, any])),
  },
}));

const poolDebitMock = vi.fn(async ({ units }: { units: number }) => ({
  allowed: true,
  debitedCents: units * 20,
  remaining: 10_000,
  poolMonthly: 20_000,
}));
const refundPoolDebitMock = vi.fn(async () => ({}));

vi.mock("../../server/services/creditPool", () => ({
  poolDebit: (...args: any[]) => poolDebitMock(...(args as [any])),
  refundPoolDebit: (...args: any[]) => refundPoolDebitMock(...(args as [any])),
  poolRefusalDetails: vi.fn(() => ({ reason: "pool_exhausted" })),
}));

// Provider mock — per-test behavior via traceImpl.
let traceImpl: (input: any, orgId?: number) => Promise<any>;
const traceMock = vi.fn((input: any, orgId?: number) => traceImpl(input, orgId));

vi.mock("../../server/services/skipTracingService", () => ({
  skipTracingService: {
    trace: (...args: any[]) => traceMock(...(args as [any, number])),
    isConfigured: vi.fn(() => true),
  },
}));

// ── Module under test ───────────────────────────────────────────────────────

import router, {
  FINISHED_TRACE_STATUSES,
  finishedTraceLeadIds,
  selectUntracedLeads,
  deriveSkipTraceStats,
  buildLeadWriteBack,
  toStoredResults,
} from "../../server/routes-skip-tracing";
import type { SkipTraceResult } from "../../server/services/skipTracingService";

const ORG_ID = 42;
const USER_ID = "user-1";

// Required §1681b fields on every POST (the gate itself is mocked permissive
// here — see header note).
const FCRA_BODY = {
  purposeOfUse: "collection",
  justification: "Locating debtor for collection of delinquent note",
};

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.user = { id: USER_ID };
    req.organization = { id: ORG_ID, name: "Test Org" };
    req.organizationId = ORG_ID;
    next();
  });
  app.use("/api/skip-tracing", router);
  return app;
}

function lead(id: number, overrides: Partial<FakeLead> = {}): FakeLead {
  return {
    id,
    firstName: "Lead",
    lastName: `Number${id}`,
    phone: null,
    email: null,
    address: `${id} Main St`,
    city: "Austin",
    state: "TX",
    zip: "78701",
    ...overrides,
  };
}

function providerHit(overrides: Partial<SkipTraceResult> = {}): SkipTraceResult {
  return {
    success: true,
    source: "batch_skip_tracing",
    contacts: [
      { type: "phone", value: "512-555-0100", confidence: 0.8, isPrimary: true, lineType: "mobile" },
      { type: "email", value: "owner@example.com", confidence: 0.7, isPrimary: true },
    ],
    creditsUsed: 1,
    ...overrides,
  };
}

const providerMiss = (): SkipTraceResult => ({
  success: true,
  source: "batch_skip_tracing",
  contacts: [],
});

beforeEach(() => {
  LEADS = [];
  TRACES = [];
  nextTraceId = 1;
  traceImpl = async () => providerHit();
  vi.clearAllMocks();
});

// ── Pure helpers ────────────────────────────────────────────────────────────

describe("untraced-lead selection", () => {
  it("marks a lead traced only on a FINISHED trace (completed | no_results)", () => {
    expect([...FINISHED_TRACE_STATUSES].sort()).toEqual(["completed", "no_results"]);
    const ids = finishedTraceLeadIds([
      { leadId: 1, status: "completed" },
      { leadId: 2, status: "no_results" },
      { leadId: 3, status: "failed" }, // retryable — NOT traced
      { leadId: 4, status: "pending" },
      { leadId: null, status: "completed" }, // trace not tied to a lead
    ]);
    expect(ids).toEqual(new Set([1, 2]));
  });

  it("excludes traced leads and caps the batch", () => {
    const leads = [1, 2, 3, 4, 5].map((id) => ({ id }));
    const traces = [
      { leadId: 1, status: "completed" },
      { leadId: 3, status: "no_results" },
    ];
    const { batch, untracedTotal } = selectUntracedLeads(leads, traces, 2);
    expect(batch.map((l) => l.id)).toEqual([2, 4]);
    expect(untracedTotal).toBe(3);
  });
});

describe("deriveSkipTraceStats", () => {
  it("derives counts from real trace rows", () => {
    const leads = [1, 2, 3, 4].map((id) => ({ id }));
    const traces = [
      { leadId: 1, status: "completed" },
      { leadId: 2, status: "no_results" },
      { leadId: 3, status: "failed" },
      { leadId: 99, status: "completed" }, // deleted lead — not counted
    ];
    const stats = deriveSkipTraceStats(leads, traces, true);
    expect(stats).toEqual({
      configured: true,
      totalLeads: 4,
      tracedCount: 2,
      untracedCount: 2,
      foundCount: 1,
      foundRate: 50,
    });
  });

  it("reports foundRate as null (not a fabricated 0%) when nothing finished", () => {
    const stats = deriveSkipTraceStats([{ id: 1 }], [{ leadId: 1, status: "failed" }], false);
    expect(stats.tracedCount).toBe(0);
    expect(stats.foundRate).toBeNull();
    expect(stats.configured).toBe(false);
  });
});

describe("buildLeadWriteBack", () => {
  it("fills empty phone/email from the primary contacts", () => {
    const updates = buildLeadWriteBack({ phone: null, email: null }, providerHit());
    expect(updates).toEqual({ phone: "512-555-0100", email: "owner@example.com" });
  });

  it("never overwrites operator-entered contact info", () => {
    const updates = buildLeadWriteBack(
      { phone: "111-222-3333", email: "existing@example.com" },
      providerHit(),
    );
    expect(updates).toEqual({});
  });
});

describe("toStoredResults", () => {
  it("never mints verified:true", () => {
    const { results, hasAny } = toStoredResults(providerHit());
    expect(hasAny).toBe(true);
    expect(results.phones?.every((p) => p.verified === false)).toBe(true);
    expect(results.emails?.every((e) => e.verified === false)).toBe(true);
  });

  it("reports hasAny false on an empty result", () => {
    expect(toStoredResults(providerMiss()).hasAny).toBe(false);
  });
});

// ── GET /stats ──────────────────────────────────────────────────────────────

describe("GET /api/skip-tracing/stats", () => {
  it("returns the derived contract from real records", async () => {
    LEADS = [lead(1), lead(2), lead(3)];
    TRACES = [
      { id: 1, leadId: 1, status: "completed" },
      { id: 2, leadId: 2, status: "no_results" },
    ];
    const res = await request(makeApp()).get("/api/skip-tracing/stats");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      configured: true,
      totalLeads: 3,
      tracedCount: 2,
      untracedCount: 1,
      foundCount: 1,
      foundRate: 50,
    });
  });
});

// ── POST /trace/:leadId ─────────────────────────────────────────────────────

describe("POST /api/skip-tracing/trace/:leadId", () => {
  it("persists the trace and writes contacts back onto the lead", async () => {
    LEADS = [lead(7)];
    const res = await request(makeApp()).post("/api/skip-tracing/trace/7").send(FCRA_BODY);

    expect(res.status).toBe(200);
    expect(res.body.leadId).toBe(7);
    expect(res.body.status).toBe("completed");
    expect(res.body.phones).toEqual([
      { number: "512-555-0100", lineType: "mobile", confidence: 0.8, doNotCall: false },
    ]);
    expect(res.body.emails).toEqual([{ address: "owner@example.com", confidence: 0.7 }]);
    expect(res.body.leadUpdated).toEqual({ phone: true, email: true });

    // Trace row persisted — the marker stats + batch filtering read — and it
    // carries the §1681b audit fields the gate yielded.
    expect(createSkipTraceMock).toHaveBeenCalledTimes(1);
    expect(createSkipTraceMock.mock.calls[0][0]).toMatchObject({
      organizationId: ORG_ID,
      leadId: 7,
      status: "completed",
      provider: "batch_skip_tracing",
      purposeOfUse: FCRA_BODY.purposeOfUse,
      justification: FCRA_BODY.justification,
      attestingUserId: USER_ID,
      attestationVersion: "test-attestation-v1",
    });

    // Write-back landed on the fields the rest of the app reads.
    expect(updateLeadMock).toHaveBeenCalledWith(
      7,
      { phone: "512-555-0100", email: "owner@example.com" },
      ORG_ID,
    );
    expect(LEADS[0].phone).toBe("512-555-0100");
    expect(LEADS[0].email).toBe("owner@example.com");
  });

  it("does not overwrite existing lead contact info", async () => {
    LEADS = [lead(7, { phone: "111-222-3333", email: "kept@example.com" })];
    const res = await request(makeApp()).post("/api/skip-tracing/trace/7").send(FCRA_BODY);
    expect(res.status).toBe(200);
    expect(res.body.leadUpdated).toEqual({ phone: false, email: false });
    expect(updateLeadMock).not.toHaveBeenCalled();
    expect(LEADS[0].phone).toBe("111-222-3333");
  });

  it("records no_results honestly when the provider finds nothing", async () => {
    LEADS = [lead(7)];
    traceImpl = async () => providerMiss();
    const res = await request(makeApp()).post("/api/skip-tracing/trace/7").send(FCRA_BODY);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("no_results");
    expect(createSkipTraceMock.mock.calls[0][0]).toMatchObject({ status: "no_results", costCents: 0 });
    expect(updateLeadMock).not.toHaveBeenCalled();
  });

  it("refunds the debit and returns 503 when the provider fails", async () => {
    LEADS = [lead(7)];
    traceImpl = async () => ({ success: false, source: "none", contacts: [], error: "No skip tracing provider configured." });
    const res = await request(makeApp()).post("/api/skip-tracing/trace/7").send(FCRA_BODY);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("SERVICE_UNAVAILABLE");
    expect(refundPoolDebitMock).toHaveBeenCalledTimes(1);
    expect(createSkipTraceMock).not.toHaveBeenCalled();
  });

  it("404s a missing lead without debiting", async () => {
    const res = await request(makeApp()).post("/api/skip-tracing/trace/999").send(FCRA_BODY);
    expect(res.status).toBe(404);
    expect(poolDebitMock).not.toHaveBeenCalled();
  });
});

// ── POST /batch ─────────────────────────────────────────────────────────────

describe("POST /api/skip-tracing/batch", () => {
  it("traces ONLY untraced leads and debits exactly that many units", async () => {
    LEADS = [lead(1), lead(2), lead(3)];
    TRACES = [{ id: 1, leadId: 2, status: "completed" }]; // lead 2 already traced

    const res = await request(makeApp()).post("/api/skip-tracing/batch").send(FCRA_BODY);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ requested: 2, traced: 2, found: 2, failed: 0, untracedRemaining: 0 });

    // The already-traced lead was never re-traced (no re-charge).
    const tracedNames = traceMock.mock.calls.map(([input]) => input.lastName);
    expect(tracedNames).toEqual(["Number1", "Number3"]);
    expect(poolDebitMock).toHaveBeenCalledTimes(1);
    expect(poolDebitMock.mock.calls[0][0].units).toBe(2);
  });

  it("advances past the first page on consecutive runs", async () => {
    LEADS = [lead(1), lead(2), lead(3)];
    const app = makeApp();

    const first = await request(app).post("/api/skip-tracing/batch").send({ ...FCRA_BODY, limit: 2 });
    expect(first.body).toMatchObject({ requested: 2, traced: 2, untracedRemaining: 1 });
    expect(traceMock.mock.calls.map(([i]) => i.lastName)).toEqual(["Number1", "Number2"]);

    traceMock.mockClear();
    const second = await request(app).post("/api/skip-tracing/batch").send({ ...FCRA_BODY, limit: 2 });
    // NOT the same first page — leads 1-2 now carry finished trace rows.
    expect(second.body).toMatchObject({ requested: 1, traced: 1, untracedRemaining: 0 });
    expect(traceMock.mock.calls.map(([i]) => i.lastName)).toEqual(["Number3"]);
  });

  it("writes batch results back onto each lead", async () => {
    LEADS = [lead(1), lead(2, { phone: "kept" })];
    const res = await request(makeApp()).post("/api/skip-tracing/batch").send(FCRA_BODY);
    expect(res.status).toBe(200);
    expect(LEADS[0].phone).toBe("512-555-0100");
    expect(LEADS[0].email).toBe("owner@example.com");
    expect(LEADS[1].phone).toBe("kept"); // never overwritten
    expect(LEADS[1].email).toBe("owner@example.com");
    expect(createSkipTraceMock).toHaveBeenCalledTimes(2);
  });

  it("returns an honest zero without debiting when nothing is untraced", async () => {
    LEADS = [lead(1)];
    TRACES = [{ id: 1, leadId: 1, status: "no_results" }];
    const res = await request(makeApp()).post("/api/skip-tracing/batch").send(FCRA_BODY);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ requested: 0, traced: 0, found: 0, untracedRemaining: 0 });
    expect(poolDebitMock).not.toHaveBeenCalled();
    expect(traceMock).not.toHaveBeenCalled();
  });

  it("refunds units for failed lookups and reports them", async () => {
    LEADS = [lead(1), lead(2)];
    traceImpl = async (input) =>
      input.lastName === "Number1"
        ? providerHit()
        : { success: false, source: "none", contacts: [], error: "provider down" };

    const res = await request(makeApp()).post("/api/skip-tracing/batch").send(FCRA_BODY);
    expect(res.body).toMatchObject({ requested: 2, traced: 1, found: 1, failed: 1, untracedRemaining: 1 });
    // Debited 2 units (40c) → refund half for the failed lookup.
    expect(refundPoolDebitMock).toHaveBeenCalledTimes(1);
    expect(refundPoolDebitMock.mock.calls[0][0].amountCents).toBe(20);
  });

  it("rejects a non-positive limit", async () => {
    LEADS = [lead(1)];
    const res = await request(makeApp()).post("/api/skip-tracing/batch").send({ ...FCRA_BODY, limit: 0 });
    expect(res.status).toBe(400);
  });
});

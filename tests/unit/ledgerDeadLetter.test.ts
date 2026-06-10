/**
 * ledgerDeadLetter.test.ts — Tier 2B: dead-letter + replay for failed
 * financial_ledger postings.
 *
 * Covers:
 *   - recordLedgerDeadLetter captures the verbatim posting args, upserting on
 *     external_event_id, and never throws even when the DB write fails;
 *   - runLedgerDeadLetterSweep replays pending rows through the matching
 *     idempotent posting function (Date revival for postedAt included);
 *   - failed replays increment attempts and flip to `abandoned` at
 *     MAX_REPLAY_ATTEMPTS;
 *   - the accumulation check raises through the alert spine: warning when
 *     pending rows pile up, critical the moment anything is abandoned.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const state = vi.hoisted(() => ({
  pendingRows: [] as any[],
  counts: { pendingCount: 0, abandonedCount: 0 },
  inserts: [] as Array<{ values: any; conflict: any }>,
  updates: [] as Array<{ set: any }>,
  failNextInsert: false,
}));

vi.mock("../../server/db", () => {
  function selectBuilder(fields?: Record<string, unknown>) {
    const isCountQuery = !!fields && "pendingCount" in fields;
    const b: any = {
      from() { return b; },
      where() { return b; },
      orderBy() { return b; },
      limit() { return b; },
      then(onFulfilled: (rows: unknown[]) => unknown) {
        const rows = isCountQuery ? [state.counts] : state.pendingRows;
        return Promise.resolve(onFulfilled(rows));
      },
    };
    return b;
  }
  return {
    db: {
      select: (fields?: Record<string, unknown>) => selectBuilder(fields),
      insert: () => ({
        values: (v: any) => ({
          onConflictDoUpdate: (conflict: any) => {
            if (state.failNextInsert) {
              state.failNextInsert = false;
              return Promise.reject(new Error("db down"));
            }
            state.inserts.push({ values: v, conflict });
            return Promise.resolve();
          },
        }),
      }),
      update: () => ({
        set: (s: any) => ({
          where: () => {
            state.updates.push({ set: s });
            return Promise.resolve();
          },
        }),
      }),
    },
    withTransaction: async (fn: (tx: unknown) => unknown) => fn({}),
  };
});

const posting = vi.hoisted(() => ({
  postRevenue: vi.fn(async () => ({ rows: [], inserted: true })),
  postRefund: vi.fn(async () => ({ row: null, inserted: true })),
  postOpexSpent: vi.fn(async () => ({ row: null, inserted: true })),
}));
vi.mock("../../server/services/financial-ledger", () => posting);

const raiseAlert = vi.hoisted(() => vi.fn(async () => ({ paged: true, findingRecorded: true, systemAlertWritten: true })));
vi.mock("../../server/services/alertSpine", () => ({ raiseAlert }));

vi.mock("../../server/utils/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  recordLedgerDeadLetter,
  runLedgerDeadLetterSweep,
  MAX_REPLAY_ATTEMPTS,
  PENDING_WARNING_THRESHOLD,
} from "../../server/services/ledgerDeadLetter";

function pendingRow(overrides: Partial<any> = {}) {
  return {
    id: 1,
    organizationId: 7,
    kind: "revenue",
    externalEventId: "stripe:invoice:in_123",
    payload: {
      organizationId: 7,
      amountCents: 4900,
      externalEventId: "stripe:invoice:in_123",
      postedAt: "2026-06-09T12:00:00.000Z",
    },
    lastError: "boom",
    attempts: 0,
    status: "pending",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastAttemptAt: null,
    replayedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  state.pendingRows = [];
  state.counts = { pendingCount: 0, abandonedCount: 0 };
  state.inserts = [];
  state.updates = [];
  state.failNextInsert = false;
  posting.postRevenue.mockClear();
  posting.postRefund.mockClear();
  posting.postOpexSpent.mockClear();
  posting.postRevenue.mockResolvedValue({ rows: [], inserted: true } as any);
  raiseAlert.mockClear();
});

// ── Capture ──────────────────────────────────────────────────────────────────

describe("recordLedgerDeadLetter", () => {
  it("captures the verbatim posting args keyed on external_event_id", async () => {
    const payload = {
      organizationId: 7,
      amountCents: 4900,
      externalEventId: "stripe:invoice:in_123",
      notes: "Stripe invoice in_123",
    };
    const ok = await recordLedgerDeadLetter({
      kind: "revenue",
      externalEventId: "stripe:invoice:in_123",
      organizationId: 7,
      payload: payload as any,
      error: new Error("connection reset"),
    });

    expect(ok).toBe(true);
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0].values).toMatchObject({
      kind: "revenue",
      externalEventId: "stripe:invoice:in_123",
      organizationId: 7,
      payload,
      lastError: "connection reset",
      status: "pending",
    });
    // Upsert on the idempotency anchor — Stripe redelivery collapses to one row.
    expect(state.inserts[0].conflict.set.lastError).toBe("connection reset");
  });

  it("never throws, even when the capture write itself fails", async () => {
    state.failNextInsert = true;
    const ok = await recordLedgerDeadLetter({
      kind: "opex",
      externalEventId: "stripe:fee:ch_1",
      organizationId: 7,
      payload: { organizationId: 7, amountCents: 100 } as any,
      error: new Error("original"),
    });
    expect(ok).toBe(false);
  });
});

// ── Replay ───────────────────────────────────────────────────────────────────

describe("runLedgerDeadLetterSweep — replay", () => {
  it("replays a pending revenue row through postRevenue with postedAt revived", async () => {
    state.pendingRows = [pendingRow()];
    const result = await runLedgerDeadLetterSweep();

    expect(posting.postRevenue).toHaveBeenCalledTimes(1);
    const args = posting.postRevenue.mock.calls[0][0] as any;
    expect(args.externalEventId).toBe("stripe:invoice:in_123");
    expect(args.amountCents).toBe(4900);
    expect(args.postedAt).toBeInstanceOf(Date);

    expect(result.replayed).toBe(1);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].set.status).toBe("replayed");
    expect(state.updates[0].set.attempts).toBe(1);
  });

  it("dispatches refund and opex kinds to their posting functions", async () => {
    state.pendingRows = [
      pendingRow({ id: 1, kind: "refund", externalEventId: "stripe:refund:re_1", payload: { organizationId: 7, amountCents: 100, externalEventId: "stripe:refund:re_1" } }),
      pendingRow({ id: 2, kind: "opex", externalEventId: "stripe:fee:ch_1", payload: { organizationId: 7, amountCents: 30, category: "stripe_fee", feature: "subscription", providerName: "stripe", providerEventId: "ch_1", externalEventId: "stripe:fee:ch_1" } }),
    ];
    const result = await runLedgerDeadLetterSweep();
    expect(posting.postRefund).toHaveBeenCalledTimes(1);
    expect(posting.postOpexSpent).toHaveBeenCalledTimes(1);
    expect(result.replayed).toBe(2);
  });

  it("increments attempts on failure and abandons at MAX_REPLAY_ATTEMPTS", async () => {
    posting.postRevenue.mockRejectedValue(new Error("still broken"));

    // One fresh failure, one at the brink of abandonment.
    state.pendingRows = [
      pendingRow({ id: 1, attempts: 0 }),
      pendingRow({ id: 2, attempts: MAX_REPLAY_ATTEMPTS - 1, externalEventId: "stripe:invoice:in_999" }),
    ];
    const result = await runLedgerDeadLetterSweep();

    expect(result.failed).toBe(1);
    expect(result.abandoned).toBe(1);
    const sets = state.updates.map((u) => u.set);
    expect(sets[0].status).toBe("pending");
    expect(sets[0].attempts).toBe(1);
    expect(sets[0].lastError).toBe("still broken");
    expect(sets[1].status).toBe("abandoned");
    expect(sets[1].attempts).toBe(MAX_REPLAY_ATTEMPTS);
  });
});

// ── Accumulation alert (Tier 1D spine) ───────────────────────────────────────

describe("runLedgerDeadLetterSweep — accumulation alert", () => {
  it("raises a WARNING finding when pending entries accumulate", async () => {
    state.counts = { pendingCount: PENDING_WARNING_THRESHOLD, abandonedCount: 0 };
    const result = await runLedgerDeadLetterSweep();

    expect(result.alertSeverity).toBe("warning");
    expect(raiseAlert).toHaveBeenCalledTimes(1);
    const input = raiseAlert.mock.calls[0][0] as any;
    expect(input.severity).toBe("warning");
    expect(input.source).toBe("ledger_dead_letter");
    expect(input.domain).toBe("finance");
  });

  it("escalates to CRITICAL when any entry is abandoned", async () => {
    state.counts = { pendingCount: 0, abandonedCount: 1 };
    const result = await runLedgerDeadLetterSweep();

    expect(result.alertSeverity).toBe("critical");
    const input = raiseAlert.mock.calls[0][0] as any;
    expect(input.severity).toBe("critical");
  });

  it("stays silent when the queue is empty/draining", async () => {
    state.counts = { pendingCount: PENDING_WARNING_THRESHOLD - 1, abandonedCount: 0 };
    const result = await runLedgerDeadLetterSweep();
    expect(result.alertSeverity).toBe("none");
    expect(raiseAlert).not.toHaveBeenCalled();
  });
});
